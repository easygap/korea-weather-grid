package io.github.easygap.weathergrid.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GridRawArchiveTest {

    private static final Clock JULY_22 = Clock.fixed(
            Instant.parse("2026-07-22T03:00:00Z"), ZoneOffset.UTC);

    @TempDir
    Path temporaryDirectory;

    @Test
    void entryIsDurablyPublishedWithoutLeavingPartialFiles() throws Exception {
        GridRawArchive archive = archive(14);
        GridArchiveKey key = GridArchiveKey.dfs("2026072102", "2026072103", "TMP");

        assertTrue(archive.store(key, "10 11 12"));

        assertEquals("10 11 12", archive.read(key).orElseThrow());
        assertTrue(Files.isRegularFile(archive.pathFor(key)));
        try (var siblings = Files.list(archive.pathFor(key).getParent())) {
            assertFalse(siblings.anyMatch(path -> path.getFileName().toString().endsWith(".part")));
        }
    }

    @Test
    void emptyAndOversizedEntriesNeverReachTheArchive() {
        GridRawArchive archive = archive(14);
        GridArchiveKey key = GridArchiveKey.dfs("2026072102", "2026072103", "TMP");

        assertFalse(archive.store(key, ""));
        assertFalse(archive.store(key, "x".repeat(GridRawArchive.MAX_ENTRY_BYTES + 1)));
        assertTrue(archive.read(key).isEmpty());
    }

    @Test
    void cleanupRemovesOnlyOwnedRunDirectoriesOlderThanTheRetentionDate() throws Exception {
        GridRawArchive archive = archive(14);
        GridArchiveKey expiredDfs = GridArchiveKey.dfs("2026070702", "2026070703", "TMP");
        GridArchiveKey retainedBoundary = GridArchiveKey.dfs("2026070802", "2026070803", "TMP");
        GridArchiveKey expiredKim = GridArchiveKey.kimSolar("2026070700", 6);
        assertTrue(archive.store(expiredDfs, "old-dfs"));
        assertTrue(archive.store(retainedBoundary, "boundary"));
        assertTrue(archive.store(expiredKim, "old-kim"));
        Path unrelated = temporaryDirectory.resolve("archive/dfs/not-a-run/owner.txt");
        Files.createDirectories(unrelated.getParent());
        Files.writeString(unrelated, "leave", StandardCharsets.UTF_8);

        archive.purgeExpiredRuns();

        assertFalse(Files.exists(archive.pathFor(expiredDfs).getParent()));
        assertFalse(Files.exists(archive.pathFor(expiredKim).getParent()));
        assertTrue(Files.isRegularFile(archive.pathFor(retainedBoundary)));
        assertTrue(Files.isRegularFile(unrelated));
    }

    @Test
    void invalidConfigurationAndPathSegmentsFailBeforeFilesystemAccess() {
        assertThrows(IllegalArgumentException.class,
                () -> new GridRawArchive(temporaryDirectory, 0, JULY_22));
        assertThrows(IllegalArgumentException.class,
                () -> new GridArchiveKey("../outside", "2026072102", "field.txt"));
        assertThrows(IllegalArgumentException.class,
                () -> GridArchiveKey.dfs("2026072102", "2026072103", "../../secret"));
    }

    private GridRawArchive archive(int retentionDays) {
        return new GridRawArchive(temporaryDirectory.resolve("archive"), retentionDays, JULY_22);
    }
}
