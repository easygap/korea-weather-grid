package io.github.easygap.weathergrid.service;

import tools.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import io.github.easygap.weathergrid.dto.CctvItemDto;
import io.github.easygap.weathergrid.dto.CctvResponseDto;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import io.github.easygap.weathergrid.exception.InvalidRequestException;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/** ITS CCTV 데이터를 고정 타일 캐시로 보호하고 공개 응답 계약으로 정규화한다. */
@Service
public class CctvService {

    static final double TILE_SIZE = 0.25;
    static final int MAX_TILES = 24;
    static final int MAX_CCTVS = 1_000;
    private static final int MAX_RAW_ITEMS = 5_000;
    private static final int CACHE_MAX = 256;
    private static final double MIN_LAT = 32;
    private static final double MAX_LAT = 44;
    private static final double MIN_LON = 122;
    private static final double MAX_LON = 134;
    private static final Duration FRESH_TTL = Duration.ofSeconds(60);
    private static final Duration STALE_MAX = Duration.ofMinutes(5);
    private static final Duration FAILURE_BACKOFF = Duration.ofSeconds(60);
    private static final Duration REQUEST_DEADLINE = Duration.ofSeconds(10);
    private static final int TILE_CONCURRENCY = 6;
    private static final String SOURCE = "국가교통정보센터(ITS)";
    private static final String STREAM_HOST = "cctvsec.ktict.co.kr";
    private static final AtomicInteger THREAD_SEQUENCE = new AtomicInteger();

    private final ItsApiClient apiClient;
    private final Clock clock;
    private final EnvironmentalRateLimiter rateLimiter;
    private final Duration requestDeadline;
    private final Map<TileKey, TileState> tileStates = Collections.synchronizedMap(
            new LinkedHashMap<>(CACHE_MAX + 1, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<TileKey, TileState> eldest) {
                    return size() > CACHE_MAX;
                }
            });
    private final Object[] refreshLocks = lockStripes(64);
    private final ThreadPoolExecutor tileExecutor = newTileExecutor();

    @Autowired
    public CctvService(ItsApiClient apiClient, EnvironmentalRateLimiter rateLimiter) {
        this(apiClient, Clock.systemUTC(), rateLimiter, REQUEST_DEADLINE);
    }

    CctvService(ItsApiClient apiClient, Clock clock) {
        this(apiClient, clock, EnvironmentalRateLimiter.unlimited(clock), REQUEST_DEADLINE);
    }

    CctvService(ItsApiClient apiClient, Clock clock,
                EnvironmentalRateLimiter rateLimiter) {
        this(apiClient, clock, rateLimiter, REQUEST_DEADLINE);
    }

    CctvService(ItsApiClient apiClient, Clock clock,
                EnvironmentalRateLimiter rateLimiter, Duration requestDeadline) {
        this.apiClient = apiClient;
        this.clock = clock;
        this.rateLimiter = rateLimiter;
        if (requestDeadline == null || requestDeadline.isZero() || requestDeadline.isNegative()) {
            throw new IllegalArgumentException("requestDeadline");
        }
        this.requestDeadline = requestDeadline;
    }

    public CctvResponseDto getCctv(double minLat, double maxLat,
                                   double minLon, double maxLon) {
        validateBounds(minLat, maxLat, minLon, maxLon);
        List<TileKey> tiles = tilesFor(minLat, maxLat, minLon, maxLon);
        if (tiles.size() > MAX_TILES) {
            throw new InvalidRequestException("CCTV 조회 영역이 너무 큼");
        }

        LinkedHashMap<String, CctvItemDto> unique = new LinkedHashMap<>();
        boolean stale = false;
        boolean truncated = false;
        Instant oldestFetchedAt = null;

        List<TileRead> tileReads = readTiles(tiles);
        for (int index = 0; index < tiles.size(); index++) {
            TileRead read = tileReads.get(index);
            stale |= read.stale();
            truncated |= read.value().truncated();
            Instant loadedAt = read.value().loadedAt();
            if (oldestFetchedAt == null || loadedAt.isBefore(oldestFetchedAt)) {
                oldestFetchedAt = loadedAt;
            }
            for (CctvItemDto item : read.value().items()) {
                if (!inside(item, minLat, maxLat, minLon, maxLon)) continue;
                unique.putIfAbsent(item.id(), item);
            }
        }

        if (oldestFetchedAt == null) throw new ExternalDataUnavailableException();
        List<CctvItemDto> cctvs = new ArrayList<>(unique.values());
        cctvs.sort(Comparator.comparing(CctvItemDto::name)
                .thenComparingDouble(CctvItemDto::latitude)
                .thenComparingDouble(CctvItemDto::longitude));
        if (cctvs.size() > MAX_CCTVS) {
            cctvs = new ArrayList<>(cctvs.subList(0, MAX_CCTVS));
            truncated = true;
        }
        return new CctvResponseDto(DateTimeFormatter.ISO_INSTANT.format(oldestFetchedAt),
                stale, truncated, SOURCE, List.copyOf(cctvs));
    }

    private List<TileRead> readTiles(List<TileKey> tiles) {
        List<Future<TileRead>> futures = new ArrayList<>(tiles.size());
        try {
            for (TileKey tile : tiles) futures.add(tileExecutor.submit(() -> readTile(tile)));
        } catch (RejectedExecutionException e) {
            cancel(futures);
            throw new ExternalDataUnavailableException();
        }

        long deadline = System.nanoTime() + requestDeadline.toNanos();
        List<TileRead> result = new ArrayList<>(tiles.size());
        try {
            for (Future<TileRead> future : futures) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) throw new TimeoutException();
                result.add(future.get(remaining, TimeUnit.NANOSECONDS));
            }
            return List.copyOf(result);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            cancel(futures);
            throw new ExternalDataUnavailableException();
        } catch (TimeoutException e) {
            cancel(futures);
            throw new ExternalDataUnavailableException();
        } catch (ExecutionException e) {
            cancel(futures);
            if (e.getCause() instanceof RateLimitExceededException rateLimit) throw rateLimit;
            if (e.getCause() instanceof ExternalDataUnavailableException unavailable) {
                throw unavailable;
            }
            throw new ExternalDataUnavailableException();
        }
    }

    private void cancel(List<Future<TileRead>> futures) {
        for (Future<TileRead> future : futures) future.cancel(true);
        tileExecutor.purge();
    }

    private TileRead readTile(TileKey tile) {
        TileState state = stateFor(tile);
        TileValue cached = state.value;
        if (fresh(cached, FRESH_TTL)) return new TileRead(cached, false);

        Object lock = refreshLocks[Math.floorMod(tile.hashCode(), refreshLocks.length)];
        synchronized (lock) {
            state = stateFor(tile);
            cached = state.value;
            if (fresh(cached, FRESH_TTL)) return new TileRead(cached, false);
            if (clock.instant().isBefore(state.retryAfter)) {
                if (fresh(cached, STALE_MAX)) return new TileRead(cached, true);
                throw new ExternalDataUnavailableException();
            }

            try {
                rateLimiter.acquireCctvRefresh();
                TilePayload loaded = normalize(apiClient.getCctv(
                        tile.minLat(), tile.maxLat(), tile.minLon(), tile.maxLon()), tile);
                TileValue value = new TileValue(loaded.items(), loaded.truncated(), clock.instant());
                state.value = value;
                state.retryAfter = Instant.EPOCH;
                touch(tile, state);
                return new TileRead(value, false);
            } catch (RateLimitExceededException e) {
                if (fresh(cached, STALE_MAX)) return new TileRead(cached, true);
                throw e;
            } catch (ExternalDataUnavailableException e) {
                state.retryAfter = clock.instant().plus(FAILURE_BACKOFF);
                touch(tile, state);
                if (fresh(cached, STALE_MAX)) return new TileRead(cached, true);
                throw e;
            }
        }
    }

    private TilePayload normalize(JsonNode root, TileKey tile) {
        if (root == null || !root.isObject()) throw new ExternalDataUnavailableException();
        JsonNode response = root.path("response");
        if (!response.isObject()) response = root;
        JsonNode header = response.path("header");
        JsonNode resultCodeNode = header.get("resultCode");
        String resultCode = text(header, "resultCode");
        if (resultCodeNode != null
                && !"0".equals(resultCode) && !"00".equals(resultCode)) {
            throw new ExternalDataUnavailableException();
        }

        JsonNode body = response.path("body");
        if (!body.isObject()) body = response;
        int declaredCount = count(body, response, root);
        JsonNode container = itemContainer(body, response, root);
        RawItems raw = nodes(container);
        if (declaredCount > 0 && container == null) {
            throw new ExternalDataUnavailableException();
        }

        LinkedHashMap<String, CctvItemDto> normalized = new LinkedHashMap<>();
        boolean truncated = raw.truncated() || declaredCount != raw.totalCount();
        for (JsonNode item : raw.items()) {
            CctvItemDto value = normalizeItem(item);
            if (value == null || !insideTile(value, tile)) {
                truncated = true;
                continue;
            }
            normalized.putIfAbsent(value.id(), value);
        }
        if (declaredCount > 0 && normalized.isEmpty()) {
            throw new ExternalDataUnavailableException();
        }
        List<CctvItemDto> values = new ArrayList<>(normalized.values());
        values.sort(Comparator.comparing(CctvItemDto::name)
                .thenComparingDouble(CctvItemDto::latitude)
                .thenComparingDouble(CctvItemDto::longitude));
        if (values.size() > MAX_CCTVS) {
            values = new ArrayList<>(values.subList(0, MAX_CCTVS));
            truncated = true;
        }
        return new TilePayload(List.copyOf(values), truncated);
    }

    private static CctvItemDto normalizeItem(JsonNode item) {
        if (item == null || !item.isObject()) return null;
        String name = boundedText(item, 200, "cctvname", "cctvName");
        String streamUrl = boundedText(item, 2_048, "cctvurl", "cctvUrl");
        JsonNode typeNode = firstNode(item, "cctvtype", "cctvType");
        String type = text(item, "cctvtype");
        if (type == null) type = text(item, "cctvType");
        String format = boundedText(item, 32, "cctvformat", "cctvFormat");
        Double longitude = decimal(item, "coordx", "coordX");
        Double latitude = decimal(item, "coordy", "coordY");
        if (name == null || streamUrl == null || latitude == null || longitude == null
                || latitude < MIN_LAT || latitude > MAX_LAT
                || longitude < MIN_LON || longitude > MAX_LON
                || (typeNode != null && !"4".equals(type))
                || !"HLS".equals(format)
                || !safeStreamUrl(streamUrl)) {
            return null;
        }

        String roadSectionId = boundedText(item, 128, "roadsectionid", "roadSectionId");
        String id = String.format(Locale.ROOT, "%s%s@%.7f,%.7f",
                roadSectionId == null ? "" : roadSectionId + "|",
                name, latitude, longitude);
        return new CctvItemDto(id, name, latitude, longitude, streamUrl,
                "HLS",
                boundedText(item, 64, "cctvresolution", "cctvResolution"),
                boundedText(item, 32, "filecreatetime", "fileCreateTime"),
                roadSectionId);
    }

    private static boolean safeStreamUrl(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && STREAM_HOST.equalsIgnoreCase(uri.getHost())
                    && uri.getUserInfo() == null
                    && uri.getFragment() == null
                    && uri.getRawQuery() == null
                    && uri.getRawPath() != null
                    && !uri.getRawPath().isBlank()
                    && !"/".equals(uri.getRawPath())
                    && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static int count(JsonNode... parents) {
        for (JsonNode parent : parents) {
            for (String name : List.of("datacount", "dataCount", "totalCount")) {
                JsonNode node = parent.get(name);
                if (node == null || node.isNull()) continue;
                String raw = node.asText();
                if (containsControl(raw)) throw new ExternalDataUnavailableException();
                String value = raw.trim();
                if (!value.matches("\\d{1,7}")) throw new ExternalDataUnavailableException();
                try {
                    int count = Integer.parseInt(value);
                    if (count < 0 || count > 100_000) {
                        throw new ExternalDataUnavailableException();
                    }
                    return count;
                } catch (NumberFormatException e) {
                    throw new ExternalDataUnavailableException();
                }
            }
        }
        throw new ExternalDataUnavailableException();
    }

    private static JsonNode itemContainer(JsonNode body, JsonNode response, JsonNode root) {
        for (JsonNode parent : List.of(body, response, root)) {
            for (String name : List.of("items", "data")) {
                JsonNode value = parent.get(name);
                if (value == null || value.isNull()) continue;
                if (value.isObject() && value.has("item")) return value.get("item");
                return value;
            }
        }
        return null;
    }

    private static RawItems nodes(JsonNode container) {
        if (container == null || container.isNull()) return new RawItems(List.of(), 0, false);
        if (container.isArray()) {
            int totalCount = container.size();
            int limit = Math.min(totalCount, MAX_RAW_ITEMS);
            List<JsonNode> result = new ArrayList<>(limit);
            for (int index = 0; index < limit; index++) result.add(container.get(index));
            return new RawItems(List.copyOf(result), totalCount, totalCount > MAX_RAW_ITEMS);
        }
        if (container.isObject()) return new RawItems(List.of(container), 1, false);
        throw new ExternalDataUnavailableException();
    }

    private static String text(JsonNode parent, String name) {
        if (parent == null) return null;
        JsonNode node = parent.get(name);
        if (node == null || node.isNull() || !node.isValueNode()) return null;
        String raw = node.asText();
        if (containsControl(raw)) return null;
        String value = raw.trim();
        return value.isEmpty() ? null : value;
    }

    private static JsonNode firstNode(JsonNode parent, String... names) {
        for (String name : names) {
            JsonNode value = parent.get(name);
            if (value != null && !value.isNull()) return value;
        }
        return null;
    }

    private static boolean containsControl(String value) {
        return value.chars().anyMatch(Character::isISOControl);
    }

    private static String boundedText(JsonNode parent, int maxLength, String... names) {
        for (String name : names) {
            String value = text(parent, name);
            if (value == null) continue;
            return value.length() <= maxLength ? value : null;
        }
        return null;
    }

    private static Double decimal(JsonNode parent, String... names) {
        for (String name : names) {
            String value = text(parent, name);
            if (value == null) continue;
            try {
                double parsed = Double.parseDouble(value);
                return Double.isFinite(parsed) ? parsed : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static List<TileKey> tilesFor(double minLat, double maxLat,
                                          double minLon, double maxLon) {
        int minLatIndex = (int) Math.floor(minLat / TILE_SIZE);
        int maxLatExclusive = (int) Math.ceil(maxLat / TILE_SIZE);
        int minLonIndex = (int) Math.floor(minLon / TILE_SIZE);
        int maxLonExclusive = (int) Math.ceil(maxLon / TILE_SIZE);
        long count = (long) (maxLatExclusive - minLatIndex)
                * (maxLonExclusive - minLonIndex);
        if (count > MAX_TILES) throw new InvalidRequestException("CCTV 조회 영역이 너무 큼");

        List<TileKey> result = new ArrayList<>((int) count);
        for (int lat = minLatIndex; lat < maxLatExclusive; lat++) {
            for (int lon = minLonIndex; lon < maxLonExclusive; lon++) {
                result.add(new TileKey(lat, lon));
            }
        }
        return List.copyOf(result);
    }

    private static void validateBounds(double minLat, double maxLat,
                                       double minLon, double maxLon) {
        if (!Double.isFinite(minLat) || !Double.isFinite(maxLat)
                || !Double.isFinite(minLon) || !Double.isFinite(maxLon)
                || minLat < MIN_LAT || maxLat > MAX_LAT
                || minLon < MIN_LON || maxLon > MAX_LON
                || minLat >= maxLat || minLon >= maxLon) {
            throw new InvalidRequestException("잘못된 CCTV 조회 영역");
        }
    }

    private static boolean inside(CctvItemDto item, double minLat, double maxLat,
                                  double minLon, double maxLon) {
        return item.latitude() >= minLat && item.latitude() <= maxLat
                && item.longitude() >= minLon && item.longitude() <= maxLon;
    }

    private static boolean insideTile(CctvItemDto item, TileKey tile) {
        return item.latitude() >= tile.minLat() && item.latitude() <= tile.maxLat()
                && item.longitude() >= tile.minLon() && item.longitude() <= tile.maxLon();
    }

    private boolean fresh(TileValue value, Duration duration) {
        return value != null && clock.instant().isBefore(value.loadedAt().plus(duration));
    }

    private TileState stateFor(TileKey tile) {
        synchronized (tileStates) {
            return tileStates.computeIfAbsent(tile, ignored -> new TileState());
        }
    }

    private void touch(TileKey tile, TileState state) {
        synchronized (tileStates) {
            tileStates.put(tile, state);
        }
    }

    int trackedTiles() {
        synchronized (tileStates) {
            return tileStates.size();
        }
    }

    private static Object[] lockStripes(int count) {
        Object[] locks = new Object[count];
        for (int index = 0; index < count; index++) locks[index] = new Object();
        return locks;
    }

    private static ThreadPoolExecutor newTileExecutor() {
        return new ThreadPoolExecutor(TILE_CONCURRENCY, TILE_CONCURRENCY,
                0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAX_TILES * 4),
                runnable -> {
                    Thread thread = new Thread(runnable,
                            "weather-grid-cctv-tile-" + THREAD_SEQUENCE.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy());
    }

    @PreDestroy
    void shutdownTileExecutor() {
        tileExecutor.shutdownNow();
    }

    private record TileKey(int latIndex, int lonIndex) {
        private double minLat() { return latIndex * TILE_SIZE; }
        private double maxLat() { return (latIndex + 1) * TILE_SIZE; }
        private double minLon() { return lonIndex * TILE_SIZE; }
        private double maxLon() { return (lonIndex + 1) * TILE_SIZE; }
    }

    private static final class TileState {
        private volatile TileValue value;
        private volatile Instant retryAfter = Instant.EPOCH;
    }

    private record TileValue(List<CctvItemDto> items, boolean truncated, Instant loadedAt) {
    }

    private record TileRead(TileValue value, boolean stale) {
    }

    private record TilePayload(List<CctvItemDto> items, boolean truncated) {
    }

    private record RawItems(List<JsonNode> items, int totalCount, boolean truncated) {
    }
}
