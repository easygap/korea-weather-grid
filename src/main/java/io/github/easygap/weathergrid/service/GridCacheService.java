package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.util.CoordinateConverter;
import io.github.easygap.weathergrid.util.DfsGridParser;
import io.github.easygap.weathergrid.util.KimNcGridParser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import org.springframework.scheduling.annotation.Scheduled;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Stream;

/**
 * 격자자료 캐시 서비스
 *
 * 격자자료 API 응답 원문을 로컬 캐시에 저장하고, 같은 (발표시각, 발효시각, 변수)
 * 요청은 디스크에서 읽는다. 서버를 재시작해도 캐시가 유지되므로
 * 개발 중 새로고침을 반복해도 API 한도가 소진되지 않는다.
 *
 * 조회 순서: 메모리(LRU) → 디스크 → API (성공 시 디스크+메모리에 적재)
 * 디스크 경로: {weather-grid.cache.path}/grid/{tmfc}/{VARS}_{tmef}.txt
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GridCacheService {

    private static final double MAX_WIND_COMPONENT = 150.0;
    private static final double MAX_WIND_SPEED = Math.sqrt(2.0) * MAX_WIND_COMPONENT;

    private final KmaApiService kmaApiService;

    @Value("${weather-grid.cache.path}")
    private String cachePath;

    /** 디스크 캐시 보존일수 — 지나면 발표시각 디렉터리째 삭제한다. */
    @Value("${weather-grid.cache.retention-days:14}")
    private int cacheRetentionDays;

    /** DFS/KIM 격자 LRU. */
    private static final int MEM_CACHE_MAX = 32;
    private final Map<String, double[][]> memCache =
            java.util.Collections.synchronizedMap(new LinkedHashMap<>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, double[][]> eldest) {
                    return size() > MEM_CACHE_MAX;
                }
            });

    /** 같은 캐시 키의 동시 miss를 하나의 상류 호출/파일 쓰기로 합친다. */
    private final ConcurrentHashMap<String, CompletableFuture<double[][]>> inFlight = new ConcurrentHashMap<>();

    /**
     * 격자 데이터 조회 — 캐시 우선, 최후에만 API 1콜
     *
     * @param tmfc 발표시각 (YYYYMMDDHH)
     * @param tmef 발효시각 (YYYYMMDDHH)
     * @param vars 예보변수 (WSD, UUU, VVV, ...)
     * @return grid[yi][xi] (yi=0 남쪽) / 조회 불가 시 null
     */
    public double[][] getGrid(String tmfc, String tmef, String vars) {
        return getGrid(tmfc, tmef, vars, 0.0);
    }

    /**
     * 결측 치환값을 지정하는 조회. 무풍·야간 일사·0℃의 실제 0과
     * 비관측영역을 구분하도록 운영 표출 경로는 -999를 사용한다.
     */
    public double[][] getGrid(String tmfc, String tmef, String vars, double missingAs) {
        // 결측 치환 방식이 다르면 별도 캐시 엔트리 (원문은 공유하므로 디스크는 동일 파일)
        String key = tmfc + "_" + vars + "_" + tmef + (missingAs == 0.0 ? "" : "_m");
        return loadSingleFlight("DFS_" + key, () -> loadGrid(tmfc, tmef, vars, missingAs, key));
    }

    private double[][] loadGrid(String tmfc, String tmef, String vars, double missingAs, String key) {
        // 1. 메모리
        double[][] grid = memCache.get(key);
        if (grid != null) {
            if (hasAnyValidValue(grid, vars, missingAs)) return grid;
            memCache.remove(key);
            log.warn("유효값 없는 격자 메모리 캐시 제거: tmfc={}, tmef={}, vars={}", tmfc, tmef, vars);
        }

        // 2. 디스크
        Path file = cacheFile(tmfc, tmef, vars);
        if (Files.exists(file)) {
            try {
                grid = DfsGridParser.parse(Files.readString(file, StandardCharsets.UTF_8), missingAs);
                if (grid != null && hasAnyValidValue(grid, vars, missingAs)) {
                    memCache.put(key, grid);
                    log.debug("격자 디스크 캐시 적중: {}", file);
                    return grid;
                }
                // 파싱 실패·전체 결측·요소 범위 밖 파일은 제거 후 API 재조회한다.
                Files.deleteIfExists(file);
                log.warn("격자 캐시 파일 검증 실패로 삭제: {}", file);
            } catch (IOException e) {
                log.warn("격자 캐시 파일 읽기 실패: {}", file, e);
            }
        }

        // 3. API (변수당 1콜)
        String raw = kmaApiService.fetchShortTermGridRaw(tmfc, tmef, vars);
        grid = DfsGridParser.parse(raw, missingAs);
        if (grid == null) {
            if (raw != null) {
                log.warn("격자자료 응답 파싱 실패 — 형식 확인 필요 (tmfc={}, tmef={}, vars={}, {}자)",
                        tmfc, tmef, vars, raw.length());
            }
            return null;
        }

        // 전체 결측이나 요소 정의 범위 밖 응답이 성공 캐시로 고착되는 것을 막는다.
        if (!hasAnyValidValue(grid, vars, missingAs)) {
            log.warn("격자자료에 유효값 없음 — 발표·발효시각·변수 확인 필요 (tmfc={}, tmef={}, vars={})",
                    tmfc, tmef, vars);
            return null;
        }

        // 성공 응답만 디스크에 적재 (원문 보존 — 파서 개선 시에도 재호출 불필요)
        try {
            writeAtomically(file, raw);
            log.info("격자자료 수신·적재: {} ({}자)", file, raw.length());
        } catch (IOException e) {
            log.warn("격자 캐시 파일 저장 실패(메모리 캐시로만 동작): {}", file, e);
        }

        memCache.put(key, grid);
        return grid;
    }

    /**
     * KIM 전구모델(NE57, 8km) 단일면 변수 크롭 격자 조회 — 동일한 3계층 캐시
     *
     * 하향단파복사(dswrsfc)처럼 단기예보 격자에 없는 변수용.
     * 야간 일사처럼 전체 0이 정상인 변수가 있어 hasAnyValue 검사를 하지 않는다
     * (형식 검증은 KimNcGridParser가 크기·크롭 echo로 수행).
     *
     * @param tmfc KIM 실행시각 UTC (YYYYMMDDHH)
     * @param hf   예측시간(시간)
     * @param name KIM 변수명(dswrsfc 등 — 대소문자 구분)
     * @return grid[row][col] (row 0 = 남쪽) / 조회 불가 시 null
     */
    public double[][] getKimGrid(String tmfc, int hf, String name) {
        String key = "KIM_" + name + "_" + tmfc + "_" + hf;
        return loadSingleFlight(key, () -> loadKimGrid(tmfc, hf, name, key));
    }

    private double[][] loadKimGrid(String tmfc, int hf, String name, String key) {
        // 1. 메모리
        double[][] grid = memCache.get(key);
        if (grid != null) return grid;

        // 2. 디스크
        Path file = kimCacheFile(tmfc, hf, name);
        if (Files.exists(file)) {
            try {
                grid = KimNcGridParser.parse(Files.readString(file, StandardCharsets.UTF_8));
                if (grid != null) {
                    memCache.put(key, grid);
                    log.debug("KIM {} 디스크 캐시 적중: {}", name, file);
                    return grid;
                }
                Files.deleteIfExists(file);
                log.warn("KIM {} 캐시 파일 파싱 실패로 삭제: {}", name, file);
            } catch (IOException e) {
                log.warn("KIM {} 캐시 파일 읽기 실패: {}", name, file, e);
            }
        }

        // 3. API (변수·발효시각당 1콜, 한반도 크롭 ≈165KB)
        String raw = kmaApiService.fetchKimNcGridRaw(tmfc, hf, name);
        grid = KimNcGridParser.parse(raw);
        if (grid == null) {
            if (raw != null) {
                log.warn("KIM {} 응답 파싱 실패 — 형식 확인 필요 (tmfc={}, hf={}, {}자)",
                        name, tmfc, hf, raw.length());
            }
            return null;
        }

        try {
            writeAtomically(file, raw);
            log.info("KIM {} 수신·적재: {} ({}자)", name, file, raw.length());
        } catch (IOException e) {
            log.warn("KIM {} 캐시 파일 저장 실패(메모리 캐시로만 동작): {}", name, file, e);
        }

        memCache.put(key, grid);
        return grid;
    }

    private Path cacheFile(String tmfc, String tmef, String vars) {
        return Path.of(cachePath, "grid", tmfc, vars + "_" + tmef + ".txt");
    }

    private Path kimCacheFile(String tmfc, int hf, String name) {
        return Path.of(cachePath, "grid", "kim", tmfc, String.format("%s_%03d.txt", name, hf));
    }

    private double[][] loadSingleFlight(String key, Supplier<double[][]> loader) {
        CompletableFuture<double[][]> created = new CompletableFuture<>();
        CompletableFuture<double[][]> active = inFlight.putIfAbsent(key, created);
        if (active != null) {
            try {
                return active.join();
            } catch (CompletionException e) {
                Throwable cause = e.getCause();
                if (cause instanceof RuntimeException runtime) throw runtime;
                if (cause instanceof Error error) throw error;
                throw new IllegalStateException("cache load failed", cause);
            }
        }

        try {
            double[][] result = loader.get();
            created.complete(result);
            return result;
        } catch (RuntimeException | Error e) {
            created.completeExceptionally(e);
            throw e;
        } finally {
            inFlight.remove(key, created);
        }
    }

    /**
     * 보존기간 지난 발표시각 디렉터리 정리.
     *
     * 캐시는 (tmfc, tmef/hf, 변수) 단위로 쌓이므로 정리가 없으면 디스크 사용량이 계속 증가한다.
     * 디렉터리명이 곧 발표(실행)시각(YYYYMMDDHH)이므로 이름만으로 판단하고,
     * 이름이 규칙과 다른 항목은 캐시 소유가 아니라고 보고 건드리지 않는다.
     * 기동 1분 후 1회 + 이후 6시간 간격.
     */
    @Scheduled(initialDelay = 60_000, fixedDelay = 6 * 3600_000)
    public void sweepOldCache() {
        String cutoff = LocalDate.now(ZoneOffset.UTC)
                .minusDays(cacheRetentionDays)
                .format(DateTimeFormatter.BASIC_ISO_DATE) + "00";
        long removedDirs = 0;
        for (Path root : new Path[]{
                Path.of(cachePath, "grid"),
                Path.of(cachePath, "grid", "kim")}) {
            if (!Files.isDirectory(root)) continue;
            try (Stream<Path> entries = Files.list(root)) {
                for (Path dir : entries.toList()) {
                    String name = dir.getFileName().toString();
                    // 발표시각 디렉터리만 대상 (grid/ 바로 아래의 kim 하위 루트는 이름 규칙에서 제외됨)
                    if (!Files.isDirectory(dir) || !name.matches("\\d{10}") || name.compareTo(cutoff) >= 0) continue;
                    deleteRecursively(dir);
                    removedDirs++;
                }
            } catch (IOException e) {
                log.warn("캐시 정리 중 목록 조회 실패: {}", root, e);
            }
        }
        if (removedDirs > 0) {
            log.info("격자 디스크 캐시 정리: 보존 {}일 경과 디렉터리 {}개 삭제", cacheRetentionDays, removedDirs);
        }
    }

    private void deleteRecursively(Path dir) {
        try (Stream<Path> walk = Files.walk(dir)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        } catch (IOException e) {
            log.warn("캐시 디렉터리 삭제 실패(다음 주기에 재시도): {}", dir, e);
        }
    }

    private void writeAtomically(Path file, String contents) throws IOException {
        Path parent = file.getParent();
        Files.createDirectories(parent);
        Path temp = Files.createTempFile(parent, file.getFileName().toString(), ".tmp");
        try {
            Files.writeString(temp, contents, StandardCharsets.UTF_8);
            try {
                Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    /**
     * 실제 기상값 존재 여부. 지도 표출 변수는 MapService의 바람 한계와
     * DfsElementDescriptor 물리 범위·범주 코드를 같은 값으로 적용한다.
     * 새 변수를 추가할 때 두 정의와 GridCacheServiceTest를 함께 갱신해야 한다.
     */
    private boolean hasAnyValidValue(double[][] grid, String vars, double missingAs) {
        boolean displayArea = validatesForecastDisplayArea(vars);
        int yStart = displayArea
                ? CoordinateConverter.FORECAST_NY_MIN - 1 : 0;
        int yEnd = displayArea
                ? Math.min(CoordinateConverter.FORECAST_NY_MAX, grid.length) : grid.length;
        int xStart = displayArea
                ? CoordinateConverter.FORECAST_NX_MIN - 1 : 0;
        int xEnd = displayArea
                ? CoordinateConverter.FORECAST_NX_MAX : Integer.MAX_VALUE;

        for (int y = yStart; y < yEnd; y++) {
            double[] row = grid[y];
            if (row == null) continue;
            for (int x = xStart; x < Math.min(xEnd, row.length); x++) {
                double v = row[x];
                if (Double.isFinite(v) && v != missingAs && validForVariable(vars, v)) return true;
            }
        }
        return false;
    }

    private boolean validatesForecastDisplayArea(String vars) {
        return switch (vars) {
            case "WSD", "UUU", "VVV", "TMP", "PCP", "SNO", "PTY", "REH", "SKY", "WAV" -> true;
            default -> false;
        };
    }

    private boolean validForVariable(String vars, double value) {
        return switch (vars) {
            case "WSD" -> value >= 0 && value <= MAX_WIND_SPEED;
            case "UUU", "VVV" -> Math.abs(value) <= MAX_WIND_COMPONENT;
            case "TMP" -> value >= -100 && value <= 80;
            case "PCP" -> value >= 0 && value <= 1_000;
            case "SNO" -> value >= 0 && value <= 100;
            case "REH" -> value >= 0 && value <= 100;
            case "WAV" -> value >= 0 && value <= 50;
            case "PTY" -> value == Math.rint(value)
                    && (value == 0 || value == 1 || value == 2 || value == 3 || value == 4);
            case "SKY" -> value == Math.rint(value)
                    && (value == 1 || value == 3 || value == 4);
            default -> true;
        };
    }
}
