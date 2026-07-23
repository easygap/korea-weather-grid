package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.integration.KmaTextGateway;
import io.github.easygap.weathergrid.util.DfsAsciiFieldReader;
import io.github.easygap.weathergrid.util.KimAsciiCropReader;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/** Parsed grid repository backed by memory, a validated raw archive and KMA gateways. */
@Service
public final class GridDataRepository {

    private static final int DEFAULT_MEMORY_ENTRIES = 32;
    private static final String KIM_SOLAR_VARIABLE = "dswrsfc";
    private static final DateTimeFormatter HOUR = DateTimeFormatter
            .ofPattern("uuuuMMddHH").withResolverStyle(ResolverStyle.STRICT);
    private static final Set<String> DFS_VARIABLES = Set.of(
            "TMP", "TMX", "TMN", "UUU", "VVV", "VEC", "WSD",
            "SKY", "PTY", "POP", "PCP", "SNO", "REH", "WAV");
    private static final Set<Integer> DFS_RUN_HOURS = Set.of(2, 5, 8, 11, 14, 17, 20, 23);
    private static final Set<Integer> KIM_RUN_HOURS = Set.of(0, 6, 12, 18);

    private final KmaTextGateway gateway;
    private final GridRawArchive archive;
    private final Map<Lookup, double[][]> memory;
    private final ConcurrentHashMap<Lookup, CompletableFuture<double[][]>> pending =
            new ConcurrentHashMap<>();

    @Autowired
    public GridDataRepository(KmaTextGateway gateway, GridRawArchive archive) {
        this(gateway, archive, DEFAULT_MEMORY_ENTRIES);
    }

    GridDataRepository(KmaTextGateway gateway, GridRawArchive archive, int memoryEntries) {
        this.gateway = java.util.Objects.requireNonNull(gateway, "gateway");
        this.archive = java.util.Objects.requireNonNull(archive, "archive");
        if (memoryEntries < 1) throw new IllegalArgumentException("memoryEntries must be positive");
        this.memory = Collections.synchronizedMap(new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Lookup, double[][]> eldest) {
                return size() > memoryEntries;
            }
        });
    }

    public double[][] readDfs(String issuedAt, String validAt, String variable, double missingValue) {
        DfsLookup lookup = DfsLookup.create(issuedAt, validAt, variable, missingValue);
        return oneLoaderPerKey(lookup, () -> loadDfs(lookup));
    }

    public double[][] readKimSolar(String modelRun, int forecastHour) {
        KimSolarLookup lookup = KimSolarLookup.create(modelRun, forecastHour);
        return oneLoaderPerKey(lookup, () -> loadKimSolar(lookup));
    }

    int memoryEntries() {
        return memory.size();
    }

    private double[][] loadDfs(DfsLookup lookup) {
        double[][] remembered = memory.get(lookup);
        if (remembered != null) return remembered;

        GridArchiveKey address = GridArchiveKey.dfs(
                lookup.issuedAt(), lookup.validAt(), lookup.variable());
        String archived = archive.read(address).orElse(null);
        if (archived != null) {
            double[][] parsed = parseDfs(archived, lookup);
            if (parsed != null) {
                memory.put(lookup, parsed);
                return parsed;
            }
            archive.discard(address);
        }

        String downloaded = gateway.downloadDfsGrid(
                lookup.issuedAt(), lookup.validAt(), lookup.variable());
        double[][] parsed = parseDfs(downloaded, lookup);
        if (parsed == null) return null;
        archive.store(address, downloaded);
        memory.put(lookup, parsed);
        return parsed;
    }

    private double[][] loadKimSolar(KimSolarLookup lookup) {
        double[][] remembered = memory.get(lookup);
        if (remembered != null) return remembered;

        GridArchiveKey address = GridArchiveKey.kimSolar(lookup.modelRun(), lookup.forecastHour());
        String archived = archive.read(address).orElse(null);
        if (archived != null) {
            double[][] parsed = KimAsciiCropReader.read(archived);
            if (parsed != null) {
                memory.put(lookup, parsed);
                return parsed;
            }
            archive.discard(address);
        }

        String downloaded = gateway.downloadSurfaceSolarGrid(
                lookup.modelRun(), lookup.forecastHour(), KIM_SOLAR_VARIABLE);
        double[][] parsed = downloaded == null ? null : KimAsciiCropReader.read(downloaded);
        if (parsed == null) return null;
        archive.store(address, downloaded);
        memory.put(lookup, parsed);
        return parsed;
    }

    private static double[][] parseDfs(String raw, DfsLookup lookup) {
        if (raw == null) return null;
        double[][] parsed = DfsAsciiFieldReader.read(raw, lookup.missingValue());
        return DfsFieldQuality.hasUsableSample(
                parsed, lookup.variable(), lookup.missingValue()) ? parsed : null;
    }

    private double[][] oneLoaderPerKey(Lookup lookup, Supplier<double[][]> loader) {
        CompletableFuture<double[][]> leader = new CompletableFuture<>();
        CompletableFuture<double[][]> existing = pending.putIfAbsent(lookup, leader);
        if (existing != null) return await(existing);
        try {
            double[][] result = loader.get();
            leader.complete(result);
            return result;
        } catch (RuntimeException | Error failure) {
            leader.completeExceptionally(failure);
            throw failure;
        } finally {
            pending.remove(lookup, leader);
        }
    }

    private static double[][] await(CompletableFuture<double[][]> result) {
        try {
            return result.join();
        } catch (CompletionException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            if (cause instanceof Error error) throw error;
            throw new IllegalStateException("Grid load failed", cause);
        }
    }

    private static LocalDateTime parseHour(String value, String field) {
        try {
            return LocalDateTime.parse(value, HOUR);
        } catch (DateTimeParseException | NullPointerException ignored) {
            throw new IllegalArgumentException(field + " must use yyyyMMddHH");
        }
    }

    private sealed interface Lookup permits DfsLookup, KimSolarLookup { }

    private record DfsLookup(String issuedAt, String validAt, String variable,
                             double missingValue) implements Lookup {
        private static DfsLookup create(String issuedAt, String validAt,
                                        String variable, double missingValue) {
            LocalDateTime issue = parseHour(issuedAt, "issuedAt");
            LocalDateTime valid = parseHour(validAt, "validAt");
            if (!DFS_RUN_HOURS.contains(issue.getHour()) || valid.isBefore(issue)
                    || variable == null || !DFS_VARIABLES.contains(variable)
                    || !Double.isFinite(missingValue)) {
                throw new IllegalArgumentException("Unsupported DFS grid lookup");
            }
            return new DfsLookup(issuedAt, validAt, variable, missingValue);
        }
    }

    private record KimSolarLookup(String modelRun, int forecastHour) implements Lookup {
        private static KimSolarLookup create(String modelRun, int forecastHour) {
            LocalDateTime run = parseHour(modelRun, "modelRun");
            if (!KIM_RUN_HOURS.contains(run.getHour()) || forecastHour < 0 || forecastHour > 288
                    || (forecastHour > 135 && forecastHour % 3 != 0)) {
                throw new IllegalArgumentException("Unsupported KIM solar lookup");
            }
            return new KimSolarLookup(modelRun, forecastHour);
        }
    }
}
