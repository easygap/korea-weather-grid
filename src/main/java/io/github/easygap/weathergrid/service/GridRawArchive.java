package io.github.easygap.weathergrid.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Comparator;
import java.util.Optional;
import java.util.stream.Stream;

/** Durable raw-text archive with bounded entries and owned-directory cleanup. */
@Component
public final class GridRawArchive {

    static final int MAX_ENTRY_BYTES = 2 * 1024 * 1024;
    private static final Logger log = LoggerFactory.getLogger(GridRawArchive.class);
    private static final DateTimeFormatter RUN_HOUR = DateTimeFormatter
            .ofPattern("uuuuMMddHH").withResolverStyle(ResolverStyle.STRICT);

    private final Path root;
    private final int retentionDays;
    private final Clock clock;

    @Autowired
    public GridRawArchive(
            @Value("${weather-grid.cache.path}") String configuredRoot,
            @Value("${weather-grid.cache.retention-days:14}") int retentionDays) {
        this(Path.of(configuredRoot).resolve("grid-v2"), retentionDays, Clock.systemUTC());
    }

    GridRawArchive(Path root, int retentionDays, Clock clock) {
        if (root == null) throw new IllegalArgumentException("archive root is required");
        if (retentionDays < 1 || retentionDays > 3_650) {
            throw new IllegalArgumentException("retentionDays must be between 1 and 3650");
        }
        this.root = root.toAbsolutePath().normalize();
        this.retentionDays = retentionDays;
        this.clock = java.util.Objects.requireNonNull(clock, "clock");
    }

    Optional<String> read(GridArchiveKey key) {
        Path file = resolve(key);
        try {
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) return Optional.empty();
            long length = Files.size(file);
            if (length < 1 || length > MAX_ENTRY_BYTES) {
                discard(key);
                return Optional.empty();
            }
            return Optional.of(Files.readString(file, StandardCharsets.UTF_8));
        } catch (IOException failure) {
            log.warn("Unable to read grid archive entry: {}", file, failure);
            return Optional.empty();
        }
    }

    boolean store(GridArchiveKey key, String rawText) {
        if (rawText == null) return false;
        byte[] bytes = rawText.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 1 || bytes.length > MAX_ENTRY_BYTES) return false;

        Path destination = resolve(key);
        Path temporary = null;
        try {
            Files.createDirectories(destination.getParent());
            temporary = Files.createTempFile(destination.getParent(), ".grid-", ".part");
            try (FileChannel channel = FileChannel.open(temporary,
                    StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
                ByteBuffer source = ByteBuffer.wrap(bytes);
                while (source.hasRemaining()) channel.write(source);
                channel.force(true);
            }
            Files.move(temporary, destination,
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            temporary = null;
            return true;
        } catch (AtomicMoveNotSupportedException unsupported) {
            log.warn("Atomic grid archive move is unavailable; entry remains memory-only: {}", destination);
            return false;
        } catch (IOException failure) {
            log.warn("Unable to store grid archive entry: {}", destination, failure);
            return false;
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    log.debug("Unable to remove temporary grid archive file: {}", temporary);
                }
            }
        }
    }

    void discard(GridArchiveKey key) {
        Path file = resolve(key);
        try {
            Files.deleteIfExists(file);
        } catch (IOException failure) {
            log.warn("Unable to discard invalid grid archive entry: {}", file, failure);
        }
    }

    @Scheduled(initialDelay = 60_000, fixedDelay = 6 * 60 * 60 * 1_000)
    public void purgeExpiredRuns() {
        LocalDate oldestRetainedDate = LocalDate.now(clock).minusDays(retentionDays);
        int removed = purgeFamily("dfs", oldestRetainedDate) + purgeFamily("kim", oldestRetainedDate);
        if (removed > 0) log.info("Removed {} expired weather-grid archive directories", removed);
    }

    Path pathFor(GridArchiveKey key) {
        return resolve(key);
    }

    private int purgeFamily(String family, LocalDate oldestRetainedDate) {
        Path familyRoot = root.resolve(family);
        if (!Files.isDirectory(familyRoot, LinkOption.NOFOLLOW_LINKS)) return 0;
        int removed = 0;
        try (Stream<Path> children = Files.list(familyRoot)) {
            for (Path child : children.toList()) {
                if (!Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) continue;
                LocalDate runDate = parseRunDate(child.getFileName().toString());
                if (runDate == null || !runDate.isBefore(oldestRetainedDate)) continue;
                if (deleteTree(child)) removed++;
            }
        } catch (IOException failure) {
            log.warn("Unable to enumerate weather-grid archive family: {}", familyRoot, failure);
        }
        return removed;
    }

    private static LocalDate parseRunDate(String directoryName) {
        try {
            return LocalDateTime.parse(directoryName, RUN_HOUR).toLocalDate();
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }

    private static boolean deleteTree(Path directory) {
        try (Stream<Path> entries = Files.walk(directory)) {
            for (Path entry : entries.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(entry);
            }
            return true;
        } catch (IOException failure) {
            log.warn("Unable to remove expired grid archive directory: {}", directory, failure);
            return false;
        }
    }

    private Path resolve(GridArchiveKey key) {
        Path resolved = root.resolve(key.relativePath()).normalize();
        if (!resolved.startsWith(root)) throw new IllegalArgumentException("Grid archive path escapes root");
        return resolved;
    }
}
