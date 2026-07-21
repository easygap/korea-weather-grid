package io.github.easygap.weathergrid.controller;

import jakarta.servlet.http.HttpServletRequest;
import io.github.easygap.weathergrid.dto.AirQualityResponseDto;
import io.github.easygap.weathergrid.dto.CctvResponseDto;
import io.github.easygap.weathergrid.dto.StationForecastResponseDto;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import io.github.easygap.weathergrid.exception.InvalidRequestException;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import io.github.easygap.weathergrid.service.CctvService;
import io.github.easygap.weathergrid.service.EnvironmentalDataService;
import io.github.easygap.weathergrid.service.EnvironmentalRateLimiter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** 단기예보 확장 및 AirKorea 지도 API. 상류 파라미터는 서버가 고정한다. */
@RestController
@RequiredArgsConstructor
public class EnvironmentalDataController {

    private static final Pattern YMD = Pattern.compile("\\d{8}");
    private static final DateTimeFormatter YMD_FORMAT = DateTimeFormatter.BASIC_ISO_DATE;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Set<String> RELEASE_TIMES = Set.of(
            "0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300");
    private static final Set<String> FORECAST_PARAMETERS = Set.of(
            "latitude", "longitude", "baseDate", "baseTime");
    private static final Set<String> AIR_PARAMETERS = Set.of(
            "minLat", "maxLat", "minLon", "maxLon");
    private static final Set<String> CCTV_PARAMETERS = Set.of(
            "minLat", "maxLat", "minLon", "maxLon");
    private static final double CCTV_TILE_SIZE = 0.25;
    private static final int CCTV_MAX_TILES = 24;

    private final EnvironmentalDataService environmentalDataService;
    private final EnvironmentalRateLimiter environmentalRateLimiter;
    private final CctvService cctvService;

    @GetMapping("/api/weather/point-forecast")
    public ResponseEntity<StationForecastResponseDto> stationForecast(
            HttpServletRequest request,
            @RequestParam double latitude,
            @RequestParam double longitude,
            @RequestParam String baseDate,
            @RequestParam String baseTime) {
        validateParameters(request, FORECAST_PARAMETERS);
        validateCoordinate(latitude, longitude);
        validateRelease(baseDate, baseTime);
        environmentalRateLimiter.checkPublicRequest(request, "weather-point-forecast");
        StationForecastResponseDto response = environmentalDataService.getStationForecast(
                latitude, longitude, baseDate, baseTime);
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=3600, stale-while-revalidate=300")
                .body(response);
    }

    @GetMapping("/api/environment/air-quality")
    public ResponseEntity<AirQualityResponseDto> airQuality(
            HttpServletRequest request,
            @RequestParam double minLat,
            @RequestParam double maxLat,
            @RequestParam double minLon,
            @RequestParam double maxLon) {
        validateParameters(request, AIR_PARAMETERS);
        validateBounds(minLat, maxLat, minLon, maxLon);
        environmentalRateLimiter.checkPublicRequest(request, "environment-air-quality");
        AirQualityResponseDto response = environmentalDataService.getAirQuality(
                minLat, maxLat, minLon, maxLon);
        String cacheControl = response.stale()
                ? "no-store"
                : "public, max-age=300, stale-while-revalidate=300, stale-if-error=3600";
        return ResponseEntity.ok().header("Cache-Control", cacheControl).body(response);
    }

    @GetMapping("/api/traffic/cameras")
    public ResponseEntity<CctvResponseDto> cctv(
            HttpServletRequest request,
            @RequestParam double minLat,
            @RequestParam double maxLat,
            @RequestParam double minLon,
            @RequestParam double maxLon) {
        validateParameters(request, CCTV_PARAMETERS);
        validateBounds(minLat, maxLat, minLon, maxLon);
        validateCctvTileCount(minLat, maxLat, minLon, maxLon);
        environmentalRateLimiter.checkPublicRequest(request, "traffic-cameras");
        CctvResponseDto response = cctvService.getCctv(minLat, maxLat, minLon, maxLon);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(response);
    }

    /**
     * 위험기상 원자료는 운영 Worker에서만 연동한다. Spring 개발 서버는 404를 내거나
     * 상류를 반복 호출하지 않고, UI가 자료 없음과 구분할 수 있는 연결 대기 계약을 반환한다.
     */
    @GetMapping("/api/hazards/warnings")
    public ResponseEntity<Map<String, Object>> warningsUnavailable(HttpServletRequest request) {
        validateParameters(request, Set.of());
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60, stale-while-revalidate=60")
                .body(Map.of(
                        "schema", "bora.warnings/v1",
                        "source", "기상청 기상특보",
                        "status", "unavailable",
                        "warnings", List.of()));
    }

    @ExceptionHandler(InvalidRequestException.class)
    public ResponseEntity<String> invalidRequest(InvalidRequestException exception) {
        return ResponseEntity.badRequest().body(exception.getMessage());
    }

    @ExceptionHandler({MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<String> invalidBinding() {
        return ResponseEntity.badRequest().body("잘못된 요청");
    }

    @ExceptionHandler(ExternalDataUnavailableException.class)
    public ResponseEntity<String> unavailable() {
        return ResponseEntity.status(503)
                .header("Cache-Control", "no-store")
                .header("Retry-After", "60")
                .body("data temporarily unavailable");
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<String> rateLimited(RateLimitExceededException exception) {
        return ResponseEntity.status(429)
                .header("Cache-Control", "no-store")
                .header("Retry-After", Long.toString(exception.retryAfterSeconds()))
                .body("rate limit exceeded");
    }

    private static void validateRelease(String baseDate, String baseTime) {
        require(baseDate != null && YMD.matcher(baseDate).matches(), "잘못된 baseDate");
        require(baseTime != null && RELEASE_TIMES.contains(baseTime), "잘못된 baseTime");
        try {
            LocalDate requestedDate = LocalDate.parse(baseDate, YMD_FORMAT);
            LocalDate today = LocalDate.now(KST);
            require(!requestedDate.isAfter(today) && !requestedDate.isBefore(today.minusDays(60)),
                    "baseDate 범위 밖");
            int hour = Integer.parseInt(baseTime.substring(0, 2));
            require(!requestedDate.atTime(hour, 0).isAfter(LocalDateTime.now(KST).minusMinutes(10)),
                    "아직 발표되지 않은 시각");
        } catch (DateTimeParseException e) {
            throw new InvalidRequestException("잘못된 baseDate");
        }
    }

    private static void validateCoordinate(double latitude, double longitude) {
        require(Double.isFinite(latitude) && latitude >= 32 && latitude <= 44, "위도 범위 밖");
        require(Double.isFinite(longitude) && longitude >= 122 && longitude <= 134, "경도 범위 밖");
    }

    private static void validateBounds(double minLat, double maxLat, double minLon, double maxLon) {
        validateCoordinate(minLat, minLon);
        validateCoordinate(maxLat, maxLon);
        require(minLat < maxLat, "위도 범위 순서 오류");
        require(minLon < maxLon, "경도 범위 순서 오류");
    }

    private static void validateCctvTileCount(double minLat, double maxLat,
                                              double minLon, double maxLon) {
        int latTiles = (int) Math.ceil(maxLat / CCTV_TILE_SIZE)
                - (int) Math.floor(minLat / CCTV_TILE_SIZE);
        int lonTiles = (int) Math.ceil(maxLon / CCTV_TILE_SIZE)
                - (int) Math.floor(minLon / CCTV_TILE_SIZE);
        require((long) latTiles * lonTiles <= CCTV_MAX_TILES, "CCTV 조회 영역이 너무 큼");
    }

    private static void validateParameters(HttpServletRequest request, Set<String> allowed) {
        Map<String, String[]> parameters = request.getParameterMap();
        require(parameters.keySet().equals(allowed)
                        && parameters.values().stream().allMatch(values -> values.length == 1),
                "잘못된 쿼리 파라미터");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new InvalidRequestException(message);
    }
}
