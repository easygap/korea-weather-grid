package io.github.easygap.weathergrid.service;

import tools.jackson.databind.JsonNode;
import io.github.easygap.weathergrid.dto.AirQualityResponseDto;
import io.github.easygap.weathergrid.dto.AirQualityStationDto;
import io.github.easygap.weathergrid.dto.StationForecastItemDto;
import io.github.easygap.weathergrid.dto.StationForecastResponseDto;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import io.github.easygap.weathergrid.util.CoordinateConverter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/** 공공데이터포털 단기예보와 AirKorea 데이터를 지도 응답 계약으로 정규화한다. */
@Service
public class EnvironmentalDataService {

    private static final String FORECAST_PATH =
            "/1360000/VilageFcstInfoService_2.0/getVilageFcst";
    private static final String AIR_MEASUREMENT_PATH =
            "/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
    private static final String AIR_STATION_PATH =
            "/B552584/MsrstnInfoInqireSvc/getMsrstnList";
    private static final String FORECAST_SOURCE = "기상청 단기예보";
    private static final String AIR_SOURCE = "AirKorea";
    private static final int PAGE_SIZE = 1_000;
    private static final int MAX_PAGES = 20;
    private static final int FORECAST_CACHE_MAX = 200;
    private static final Duration FORECAST_TTL = Duration.ofHours(1);
    private static final Duration AIR_MEASUREMENT_TTL = Duration.ofMinutes(60);
    private static final Duration AIR_MEASUREMENT_STALE_MAX = Duration.ofHours(6);
    private static final Duration AIR_STATION_TTL = Duration.ofDays(7);
    private static final Duration REFRESH_FAILURE_BACKOFF = Duration.ofMinutes(15);
    private static final DateTimeFormatter FORECAST_TIME = DateTimeFormatter.ofPattern("yyyyMMddHHmm");
    private static final Map<String, List<String>> REGION_ALIASES = Map.ofEntries(
            Map.entry("서울", List.of("서울특별시", "서울")),
            Map.entry("부산", List.of("부산광역시", "부산")),
            Map.entry("대구", List.of("대구광역시", "대구")),
            Map.entry("인천", List.of("인천광역시", "인천")),
            Map.entry("대전", List.of("대전광역시", "대전")),
            Map.entry("광주", List.of("광주광역시", "광주")),
            Map.entry("울산", List.of("울산광역시", "울산")),
            Map.entry("경기", List.of("경기도", "경기")),
            Map.entry("강원", List.of("강원특별자치도", "강원도", "강원")),
            Map.entry("충북", List.of("충청북도", "충북")),
            Map.entry("충남", List.of("충청남도", "충남")),
            Map.entry("전북", List.of("전북특별자치도", "전라북도", "전북")),
            Map.entry("전남", List.of("전라남도", "전남")),
            Map.entry("경북", List.of("경상북도", "경북")),
            Map.entry("경남", List.of("경상남도", "경남")),
            Map.entry("제주", List.of("제주특별자치도", "제주도", "제주")),
            Map.entry("세종", List.of("세종특별자치시", "세종")));

    private final DataGoApiClient apiClient;
    private final Clock clock;
    private final EnvironmentalRateLimiter rateLimiter;

    /** 발표시각·격자점별 예보를 1시간 TTL의 bounded LRU에 보관한다. */
    private final Map<String, TimedValue<List<StationForecastItemDto>>> forecastCache =
            Collections.synchronizedMap(new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(
                        Map.Entry<String, TimedValue<List<StationForecastItemDto>>> eldest) {
                    return size() > FORECAST_CACHE_MAX;
                }
            });
    private final Object[] forecastRefreshLocks = lockStripes(64);

    /** AirKorea는 전국 스냅샷 한 장만 보관해 캐시 키 공간을 고정한다. */
    private volatile TimedValue<List<AirMeasurement>> measurementCache;
    private volatile TimedValue<List<AirStationMeta>> stationCache;
    private volatile Instant measurementRetryAfter = Instant.EPOCH;
    private volatile Instant stationRetryAfter = Instant.EPOCH;
    private final Object measurementRefreshLock = new Object();
    private final Object stationRefreshLock = new Object();

    @Autowired
    public EnvironmentalDataService(DataGoApiClient apiClient,
                                    EnvironmentalRateLimiter rateLimiter) {
        this(apiClient, Clock.systemUTC(), rateLimiter);
    }

    EnvironmentalDataService(DataGoApiClient apiClient, Clock clock) {
        this(apiClient, clock, EnvironmentalRateLimiter.unlimited(clock));
    }

    EnvironmentalDataService(DataGoApiClient apiClient, Clock clock,
                             EnvironmentalRateLimiter rateLimiter) {
        this.apiClient = apiClient;
        this.clock = clock;
        this.rateLimiter = rateLimiter;
    }

    public StationForecastResponseDto getStationForecast(double latitude, double longitude,
                                                          String baseDate, String baseTime) {
        int[] grid = CoordinateConverter.latLonToGrid(latitude, longitude);
        String cacheKey = baseDate + baseTime + "_" + grid[0] + "_" + grid[1];
        TimedValue<List<StationForecastItemDto>> cached = forecastCache.get(cacheKey);
        List<StationForecastItemDto> items;
        if (fresh(cached, FORECAST_TTL)) {
            items = cached.value();
        } else {
            Object lock = forecastRefreshLocks[Math.floorMod(
                    cacheKey.hashCode(), forecastRefreshLocks.length)];
            synchronized (lock) {
                cached = forecastCache.get(cacheKey);
                if (fresh(cached, FORECAST_TTL)) {
                    items = cached.value();
                } else {
                    // 정정 발표를 반영하기 위해 만료 데이터는 실패 시에도 되돌려주지 않는다.
                    rateLimiter.acquireForecastRefresh();
                    items = loadStationForecast(baseDate, baseTime, grid[0], grid[1]);
                    forecastCache.put(cacheKey, new TimedValue<>(items, clock.instant()));
                }
            }
        }
        return new StationForecastResponseDto(baseDate, baseTime, latitude, longitude,
                FORECAST_SOURCE, items);
    }

    public AirQualityResponseDto getAirQuality(double minLat, double maxLat,
                                                double minLon, double maxLon) {
        CacheRead<List<AirMeasurement>> measurements = measurements();
        CacheRead<List<AirStationMeta>> stations = stations();
        List<AirQualityStationDto> joined = joinAirQuality(measurements.value(), stations.value());
        if (joined.isEmpty()) {
            // 별도 측정소정보 활용승인 실패 또는 스키마 변경을 빈 정상응답으로 숨기지 않는다.
            throw new ExternalDataUnavailableException();
        }

        boolean hasMeasurement = joined.stream()
                .anyMatch(station -> station.pm10() != null || station.pm25() != null);
        List<AirQualityStationDto> filtered = joined.stream()
                .filter(station -> station.latitude() >= minLat && station.latitude() <= maxLat
                        && station.longitude() >= minLon && station.longitude() <= maxLon)
                .sorted(Comparator.comparing(AirQualityStationDto::name)
                        .thenComparingDouble(AirQualityStationDto::latitude)
                        .thenComparingDouble(AirQualityStationDto::longitude))
                .toList();
        String dataTime = filtered.stream().map(AirQualityStationDto::dataTime)
                .filter(Objects::nonNull).max(String::compareTo)
                .orElseGet(() -> joined.stream().map(AirQualityStationDto::dataTime)
                        .filter(Objects::nonNull).max(String::compareTo).orElse(null));
        String dataTimeFrom = filtered.stream().map(AirQualityStationDto::dataTime)
                .filter(Objects::nonNull).min(String::compareTo).orElse(dataTime);
        if (!hasMeasurement || dataTime == null) throw new ExternalDataUnavailableException();
        return new AirQualityResponseDto(dataTime, dataTimeFrom,
                measurements.stale() || stations.stale(),
                AIR_SOURCE, filtered);
    }

    private List<StationForecastItemDto> loadStationForecast(String baseDate, String baseTime,
                                                               int nx, int ny) {
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("dataType", "JSON");
        parameters.put("base_date", baseDate);
        parameters.put("base_time", baseTime);
        parameters.put("nx", nx);
        parameters.put("ny", ny);
        List<JsonNode> rawItems = fetchAllPages(FORECAST_PATH, parameters);

        LocalDateTime base = LocalDateTime.parse(baseDate + baseTime, FORECAST_TIME);
        MutableForecastSlot[] slots = new MutableForecastSlot[49];
        for (int hour = 0; hour <= 48; hour++) {
            slots[hour] = new MutableForecastSlot(hour, base.plusHours(hour).format(FORECAST_TIME));
        }

        boolean recognized = false;
        for (JsonNode item : rawItems) {
            String forecastDate = text(item, "fcstDate");
            String forecastTime = text(item, "fcstTime");
            String category = text(item, "category");
            if (forecastDate == null || forecastTime == null || category == null) continue;

            LocalDateTime forecast;
            try {
                forecast = LocalDateTime.parse(forecastDate + forecastTime, FORECAST_TIME);
            } catch (Exception ignored) {
                continue;
            }
            long seconds = Duration.between(base, forecast).toSeconds();
            if (seconds < 0 || seconds > 48L * 3600 || seconds % 3600 != 0) continue;
            String value = text(item, "fcstValue");
            recognized |= slots[(int) (seconds / 3600)].apply(category, value);
        }
        if (!recognized) throw new ExternalDataUnavailableException();

        List<StationForecastItemDto> result = new ArrayList<>(49);
        for (MutableForecastSlot slot : slots) result.add(slot.toDto());
        return List.copyOf(result);
    }

    private CacheRead<List<AirMeasurement>> measurements() {
        TimedValue<List<AirMeasurement>> cached = measurementCache;
        if (fresh(cached, AIR_MEASUREMENT_TTL)) return new CacheRead<>(cached.value(), false);
        synchronized (measurementRefreshLock) {
            cached = measurementCache;
            if (fresh(cached, AIR_MEASUREMENT_TTL)) return new CacheRead<>(cached.value(), false);
            if (retryBlocked(measurementRetryAfter)) {
                if (fresh(cached, AIR_MEASUREMENT_STALE_MAX)) {
                    return new CacheRead<>(cached.value(), true);
                }
                throw new ExternalDataUnavailableException();
            }
            try {
                rateLimiter.acquireAirMeasurementRefresh();
                List<AirMeasurement> loaded = loadMeasurements();
                measurementCache = new TimedValue<>(loaded, clock.instant());
                measurementRetryAfter = Instant.EPOCH;
                return new CacheRead<>(loaded, false);
            } catch (RateLimitExceededException e) {
                if (fresh(cached, AIR_MEASUREMENT_STALE_MAX)) {
                    return new CacheRead<>(cached.value(), true);
                }
                throw e;
            } catch (ExternalDataUnavailableException e) {
                measurementRetryAfter = clock.instant().plus(REFRESH_FAILURE_BACKOFF);
                if (fresh(cached, AIR_MEASUREMENT_STALE_MAX)) {
                    return new CacheRead<>(cached.value(), true);
                }
                throw e;
            }
        }
    }

    private CacheRead<List<AirStationMeta>> stations() {
        TimedValue<List<AirStationMeta>> cached = stationCache;
        if (fresh(cached, AIR_STATION_TTL)) return new CacheRead<>(cached.value(), false);
        synchronized (stationRefreshLock) {
            cached = stationCache;
            if (fresh(cached, AIR_STATION_TTL)) return new CacheRead<>(cached.value(), false);
            if (retryBlocked(stationRetryAfter)) {
                if (cached != null) return new CacheRead<>(cached.value(), true);
                throw new ExternalDataUnavailableException();
            }
            try {
                rateLimiter.acquireAirStationRefresh();
                List<AirStationMeta> loaded = loadStations();
                stationCache = new TimedValue<>(loaded, clock.instant());
                stationRetryAfter = Instant.EPOCH;
                return new CacheRead<>(loaded, false);
            } catch (RateLimitExceededException e) {
                if (cached != null) return new CacheRead<>(cached.value(), true);
                throw e;
            } catch (ExternalDataUnavailableException e) {
                stationRetryAfter = clock.instant().plus(REFRESH_FAILURE_BACKOFF);
                if (cached != null) return new CacheRead<>(cached.value(), true);
                throw e;
            }
        }
    }

    private boolean fresh(TimedValue<?> value, Duration ttl) {
        return value != null && clock.instant().isBefore(value.loadedAt().plus(ttl));
    }

    private boolean retryBlocked(Instant retryAfter) {
        return clock.instant().isBefore(retryAfter);
    }

    private static Object[] lockStripes(int count) {
        Object[] locks = new Object[count];
        for (int index = 0; index < count; index++) locks[index] = new Object();
        return locks;
    }

    private List<AirMeasurement> loadMeasurements() {
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("returnType", "json");
        parameters.put("sidoName", "전국");
        parameters.put("ver", "1.3");
        List<AirMeasurement> result = new ArrayList<>();
        for (JsonNode item : fetchAllPages(AIR_MEASUREMENT_PATH, parameters)) {
            String name = text(item, "stationName");
            if (name == null) continue;
            result.add(new AirMeasurement(
                    name,
                    text(item, "sidoName"),
                    text(item, "addr"),
                    text(item, "mangName"),
                    boundedDouble(text(item, "pm10Value"), 0, 2_000),
                    boundedDouble(text(item, "pm25Value"), 0, 1_000),
                    // 화면은 1시간 농도 구간을 사용하므로 24시간 등급과 혼합하지 않는다.
                    grade(text(item, "pm10Grade1h")),
                    grade(text(item, "pm25Grade1h")),
                    text(item, "pm10Flag"),
                    text(item, "pm25Flag"),
                    text(item, "dataTime")));
        }
        if (result.isEmpty()) throw new ExternalDataUnavailableException();
        return List.copyOf(result);
    }

    private List<AirStationMeta> loadStations() {
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("returnType", "json");
        parameters.put("ver", "1.1");
        List<AirStationMeta> result = new ArrayList<>();
        for (JsonNode item : fetchAllPages(AIR_STATION_PATH, parameters)) {
            String name = text(item, "stationName");
            double[] coordinate = coordinate(text(item, "dmX"), text(item, "dmY"));
            if (name == null || coordinate == null) continue;
            result.add(new AirStationMeta(name, text(item, "addr"), text(item, "mangName"),
                    coordinate[0], coordinate[1]));
        }
        if (result.isEmpty()) throw new ExternalDataUnavailableException();
        return List.copyOf(result);
    }

    private List<JsonNode> fetchAllPages(String path, Map<String, Object> baseParameters) {
        List<JsonNode> result = new ArrayList<>();
        int totalCount = Integer.MAX_VALUE;
        for (int page = 1; page <= MAX_PAGES && result.size() < totalCount; page++) {
            Map<String, Object> parameters = new LinkedHashMap<>(baseParameters);
            parameters.put("pageNo", page);
            parameters.put("numOfRows", PAGE_SIZE);
            JsonNode response = apiClient.get(path, parameters).path("response");
            JsonNode header = response.path("header");
            if (!"00".equals(header.path("resultCode").asText(""))) {
                throw new ExternalDataUnavailableException();
            }
            JsonNode body = response.path("body");
            if (body.isMissingNode() || body.isNull()) throw new ExternalDataUnavailableException();
            totalCount = body.path("totalCount").asInt(-1);
            if (totalCount < 0 || totalCount > PAGE_SIZE * MAX_PAGES) {
                throw new ExternalDataUnavailableException();
            }
            List<JsonNode> pageItems = itemList(body.path("items"));
            if (totalCount == 0 && !pageItems.isEmpty()) {
                throw new ExternalDataUnavailableException();
            }
            result.addAll(pageItems);
            if (result.size() > totalCount) throw new ExternalDataUnavailableException();
            if (pageItems.isEmpty() || totalCount == 0) break;
        }
        if (result.isEmpty() || result.size() < totalCount) throw new ExternalDataUnavailableException();
        return result;
    }

    private static List<JsonNode> itemList(JsonNode items) {
        JsonNode candidate = items;
        if (items.isObject() && items.has("item")) candidate = items.path("item");
        List<JsonNode> result = new ArrayList<>();
        if (candidate.isArray()) candidate.forEach(result::add);
        else if (candidate.isObject()) result.add(candidate);
        return result;
    }

    private static List<AirQualityStationDto> joinAirQuality(List<AirMeasurement> measurements,
                                                              List<AirStationMeta> stations) {
        Map<String, List<AirStationMeta>> byName = new HashMap<>();
        for (AirStationMeta station : stations) {
            byName.computeIfAbsent(normalize(station.name()), ignored -> new ArrayList<>()).add(station);
        }

        Map<String, AirQualityStationDto> deduplicated = new LinkedHashMap<>();
        for (AirMeasurement measurement : measurements) {
            List<AirStationMeta> candidates = byName.getOrDefault(normalize(measurement.name()), List.of());
            AirStationMeta station = selectStation(measurement, candidates);
            if (station == null) continue;
            String network = measurement.network() != null ? measurement.network() : station.network();
            AirQualityStationDto value = new AirQualityStationDto(
                    measurement.name(), station.address(), network,
                    station.latitude(), station.longitude(),
                    measurement.pm10Flag() == null ? measurement.pm10() : null,
                    measurement.pm25Flag() == null ? measurement.pm25() : null,
                    measurement.pm10Grade(), measurement.pm25Grade(),
                    measurement.pm10Flag(), measurement.pm25Flag(), measurement.dataTime());
            String key = normalize(value.name()) + "@" + value.latitude() + "," + value.longitude();
            deduplicated.merge(key, value, EnvironmentalDataService::newer);
        }
        return new ArrayList<>(deduplicated.values());
    }

    private static AirQualityStationDto newer(AirQualityStationDto left, AirQualityStationDto right) {
        if (left.dataTime() == null) return right;
        if (right.dataTime() == null) return left;
        return left.dataTime().compareTo(right.dataTime()) >= 0 ? left : right;
    }

    private static AirStationMeta selectStation(AirMeasurement measurement, List<AirStationMeta> candidates) {
        if (candidates.isEmpty()) return null;
        List<AirStationMeta> narrowed = new ArrayList<>(candidates);

        if (measurement.address() != null) {
            String address = normalize(measurement.address());
            List<AirStationMeta> matches = narrowed.stream()
                    .filter(value -> normalize(value.address()).equals(address))
                    .toList();
            if (!matches.isEmpty()) narrowed = new ArrayList<>(matches);
        }
        String region = region(measurement.sidoName());
        if (narrowed.size() > 1 && region != null) {
            List<AirStationMeta> matches = narrowed.stream()
                    .filter(value -> region.equals(region(value.address())))
                    .toList();
            if (!matches.isEmpty()) narrowed = new ArrayList<>(matches);
        }
        if (narrowed.size() > 1 && measurement.network() != null) {
            String network = normalize(measurement.network());
            List<AirStationMeta> matches = narrowed.stream()
                    .filter(value -> normalize(value.network()).equals(network))
                    .toList();
            if (!matches.isEmpty()) narrowed = new ArrayList<>(matches);
        }
        return narrowed.size() == 1 ? narrowed.get(0) : null;
    }

    /** dmX/dmY 구버전 역전과 1.1 정상 방향을 값 범위로 모두 수용한다. */
    private static double[] coordinate(String dmX, String dmY) {
        Double x = finiteDouble(dmX);
        Double y = finiteDouble(dmY);
        if (x == null || y == null) return null;
        if (isKoreaLatitude(x) && isKoreaLongitude(y)) return new double[]{x, y};
        if (isKoreaLongitude(x) && isKoreaLatitude(y)) return new double[]{y, x};
        return null;
    }

    private static boolean isKoreaLatitude(double value) {
        return value >= 32 && value <= 44;
    }

    private static boolean isKoreaLongitude(double value) {
        return value >= 122 && value <= 134;
    }

    private static String region(String value) {
        if (value == null) return null;
        String normalized = normalize(value);
        for (Map.Entry<String, List<String>> entry : REGION_ALIASES.entrySet()) {
            if (entry.getValue().stream().anyMatch(normalized::startsWith)) return entry.getKey();
        }
        return null;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("[\\s()\\[\\],.·_-]+", "")
                .replace("측정소", "");
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) return null;
        String text = value.asText("").trim();
        return text.isEmpty() || "-".equals(text) ? null : text;
    }

    private static Double finiteDouble(String value) {
        if (value == null) return null;
        try {
            double parsed = Double.parseDouble(value);
            return Double.isFinite(parsed) ? parsed : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static Double boundedDouble(String value, double min, double max) {
        Double parsed = finiteDouble(value);
        return parsed != null && parsed >= min && parsed <= max ? parsed : null;
    }

    private static Integer boundedInteger(String value, int min, int max) {
        Double parsed = finiteDouble(value);
        if (parsed == null || parsed != Math.rint(parsed) || parsed < min || parsed > max) return null;
        return parsed.intValue();
    }

    private static Integer grade(String value) {
        return boundedInteger(value, 1, 4);
    }

    private static String amount(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() || "-".equals(trimmed) ? null : trimmed;
    }

    private static String skyLabel(Integer code) {
        if (code == null) return null;
        return switch (code) {
            case 1 -> "맑음";
            case 3 -> "구름많음";
            case 4 -> "흐림";
            default -> null;
        };
    }

    private static String precipitationTypeLabel(Integer code) {
        if (code == null) return null;
        return switch (code) {
            case 0 -> "없음";
            case 1 -> "비";
            case 2 -> "비/눈";
            case 3 -> "눈";
            case 4 -> "소나기";
            default -> null;
        };
    }

    private static final class MutableForecastSlot {
        private final int forecastHour;
        private final String forecastDateTime;
        private Double temperature;
        private Double humidity;
        private Double precipitationProbability;
        private String precipitationAmount;
        private String snowfallAmount;
        private Integer skyCode;
        private Integer precipitationType;
        private Double waveHeight;
        private Double windSpeed;
        private Double windDirection;

        private MutableForecastSlot(int forecastHour, String forecastDateTime) {
            this.forecastHour = forecastHour;
            this.forecastDateTime = forecastDateTime;
        }

        private boolean apply(String category, String value) {
            return switch (category) {
                case "TMP", "T1H" -> {
                    temperature = boundedDouble(value, -100, 80);
                    yield true;
                }
                case "REH" -> {
                    humidity = boundedDouble(value, 0, 100);
                    yield true;
                }
                case "POP" -> {
                    precipitationProbability = boundedDouble(value, 0, 100);
                    yield true;
                }
                case "PCP", "RN1" -> {
                    precipitationAmount = amount(value);
                    yield true;
                }
                case "SNO" -> {
                    snowfallAmount = amount(value);
                    yield true;
                }
                case "SKY" -> {
                    skyCode = boundedInteger(value, 1, 4);
                    if (skyLabel(skyCode) == null) skyCode = null;
                    yield true;
                }
                case "PTY" -> {
                    precipitationType = boundedInteger(value, 0, 4);
                    yield true;
                }
                case "WAV" -> {
                    waveHeight = boundedDouble(value, 0, 50);
                    yield true;
                }
                case "WSD" -> {
                    windSpeed = boundedDouble(value, 0, 150);
                    yield true;
                }
                case "VEC" -> {
                    windDirection = boundedDouble(value, 0, 360);
                    yield true;
                }
                default -> false;
            };
        }

        private StationForecastItemDto toDto() {
            return new StationForecastItemDto(forecastHour, forecastDateTime,
                    temperature, humidity, precipitationProbability,
                    precipitationAmount, snowfallAmount,
                    skyCode, skyLabel(skyCode), precipitationType,
                    precipitationTypeLabel(precipitationType), waveHeight,
                    windSpeed, windDirection);
        }
    }

    private record TimedValue<T>(T value, Instant loadedAt) {
    }

    private record CacheRead<T>(T value, boolean stale) {
    }

    private record AirMeasurement(String name, String sidoName, String address, String network,
                                  Double pm10, Double pm25, Integer pm10Grade, Integer pm25Grade,
                                  String pm10Flag, String pm25Flag, String dataTime) {
    }

    private record AirStationMeta(String name, String address, String network,
                                  double latitude, double longitude) {
    }
}
