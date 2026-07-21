package io.github.easygap.weathergrid.controller;

import jakarta.servlet.http.HttpServletRequest;
import io.github.easygap.weathergrid.exception.InvalidRequestException;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import io.github.easygap.weathergrid.exception.WeatherDataUnavailableException;
import io.github.easygap.weathergrid.service.EnvironmentalRateLimiter;
import io.github.easygap.weathergrid.service.MapService;
import io.github.easygap.weathergrid.util.CoordinateConverter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/** 기상 격자와 지점 예보 요청을 검증하고 응답하는 지도 컨트롤러. */
@Slf4j
@Controller
@RequiredArgsConstructor
public class MapController {

    private final MapService mapService;
    private final EnvironmentalRateLimiter environmentalRateLimiter;

    private static final String GRID_RATE_LIMIT_ROUTE = "weather-grid";

    // ---------- 파라미터 화이트리스트 ----------
    // 이 서버는 배포자의 KMA 인증키로 상류 API를 호출하므로, 임의 파라미터를
    // 흘려보내면 캐시 불가능한 요청으로 키의 일일 한도를 남이 소진시킬 수 있다.
    // 유효한 조합만 통과시켜 요청 공간을 유한하게 유지한다. (Worker validateQuery와 동일 정책)

    private static final java.util.regex.Pattern YMD = java.util.regex.Pattern.compile("\\d{8}");
    private static final java.util.Set<String> RELEASE_TIMES = java.util.Set.of(
            "0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300");
    private static final java.util.Set<String> GRID_ELEMENTS = java.util.Set.of(
            "wdws", "tmp", "pcp", "sno", "pty", "reh", "sky", "wav", "swdn");
    private static final Map<String, String> FORECAST_BACKED_STATION_LABELS = Map.of(
            "pcp", "강수량", "sno", "신적설", "pty", "강수형태",
            "reh", "상대습도", "sky", "하늘상태", "wav", "파고");
    private static final DateTimeFormatter YMD_FORMAT = DateTimeFormatter.BASIC_ISO_DATE;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static void require(boolean ok, String msg) {
        if (!ok) throw new InvalidRequestException(msg);
    }

    private static void validate(String baseDate, String baseTime, String element, String height, int leadHours) {
        LocalDate requested = null;
        if (baseDate != null) {
            require(YMD.matcher(baseDate).matches(), "잘못된 baseDate");
            try {
                requested = LocalDate.parse(baseDate, YMD_FORMAT);
                LocalDate today = LocalDate.now(KST);
                require(!requested.isAfter(today) && !requested.isBefore(today.minusDays(60)), "baseDate 범위 밖");
            } catch (DateTimeParseException e) {
                throw new InvalidRequestException("잘못된 baseDate");
            }
        }
        require(baseTime == null || RELEASE_TIMES.contains(baseTime), "잘못된 baseTime");
        if (requested != null && baseTime != null) {
            int releaseHour = Integer.parseInt(baseTime.substring(0, 2));
            LocalDateTime release = requested.atTime(releaseHour, 0);
            require(!release.isAfter(LocalDateTime.now(KST).minusMinutes(10)), "아직 발표되지 않은 시각");
        }
        require(element == null || GRID_ELEMENTS.contains(element), "잘못된 element");
        // 지원하지 않는 고도 값은 상류 호출 전에 차단한다.
        require(height == null || height.equals("10m"), "잘못된 height");
        require(leadHours >= 0 && leadHours <= 48, "잘못된 leadHours");
    }

    /** 검증 실패는 500이 아닌 400으로 — 상류 호출 전에 끊는다 */
    @ExceptionHandler(InvalidRequestException.class)
    @ResponseBody
    public ResponseEntity<String> onBadRequest(InvalidRequestException e) {
        return ResponseEntity.badRequest().body(e.getMessage());
    }

    @ExceptionHandler(WeatherDataUnavailableException.class)
    @ResponseBody
    public ResponseEntity<String> onWeatherUnavailable() {
        return ResponseEntity.status(503)
                .header("Retry-After", "60")
                .header("Cache-Control", "no-store")
                .body("weather data temporarily unavailable");
    }

    /** 공개 격자 조회도 환경자료 API와 동일한 429 응답 계약을 사용한다. */
    @ExceptionHandler(RateLimitExceededException.class)
    @ResponseBody
    public ResponseEntity<String> onRateLimited(RateLimitExceededException exception) {
        return ResponseEntity.status(429)
                .header("Cache-Control", "no-store")
                .header("Retry-After", Long.toString(exception.retryAfterSeconds()))
                .body("rate limit exceeded");
    }

    /** 최신 발표 시각과 함께 메인 페이지를 렌더링한다. */
    @GetMapping("/")
    public String renderMainPage(Model model) {
        Map<String, String> latestInfo = mapService.getLatestInfo();
        model.addAttribute("fileName", latestInfo.get("fileName"));
        model.addAttribute("baseDate", latestInfo.get("baseDate"));
        model.addAttribute("baseTime", latestInfo.get("baseTime"));
        return "weather-grid";
    }

    /** 분포도 렌더링에 필요한 격자 데이터를 반환한다. */
    @ResponseBody
    @GetMapping("/api/weather/grid")
    public ResponseEntity<Map<String, Object>> getGridData(
            HttpServletRequest request,
            @RequestParam("baseDate") String baseDate,
            @RequestParam("baseTime") String baseTime,
            @RequestParam("element") String element,
            @RequestParam(value = "height", defaultValue = "10m") String height,
            @RequestParam(value = "leadHours", defaultValue = "0") int leadHours) {
        validate(baseDate, baseTime, element, height, leadHours);
        environmentalRateLimiter.checkPublicRequest(request, GRID_RATE_LIMIT_ROUTE);
        Map<String, Object> gridData = mapService.getGridData(baseDate, baseTime, element, leadHours);
        return ResponseEntity.ok(gridData);
    }

    /** 현재 분포도와 동일한 DFS 셀 범위인지 확인한다. */
    @ResponseBody
    @GetMapping("/api/weather/coverage")
    public ResponseEntity<Map<String, Boolean>> existStation(
            @RequestParam("latitude") double latitude,
            @RequestParam("longitude") double longitude) {
        require(latitude >= 32 && latitude <= 44 && longitude >= 122 && longitude <= 134, "좌표 범위 밖");
        boolean inside = CoordinateConverter.isInsideForecastGrid(latitude, longitude);
        return ResponseEntity.ok(Map.of("inside", inside));
    }

    /** 선택 좌표의 시간대별 데이터를 반환한다. */
    @ResponseBody
    @GetMapping("/api/weather/timeseries")
    public ResponseEntity<List<double[]>> getStationData(
            @RequestParam("latitude") double latitude,
            @RequestParam("longitude") double longitude,
            @RequestParam("baseDate") String baseDate,
            @RequestParam("baseTime") String baseTime,
            @RequestParam(value = "element", defaultValue = "wdws") String element,
            @RequestParam(value = "height", defaultValue = "10m") String height) {
        validate(baseDate, baseTime, element, height, 0);
        require(latitude >= 32 && latitude <= 44 && longitude >= 122 && longitude <= 134, "좌표 범위 밖");
        String forecastLabel = FORECAST_BACKED_STATION_LABELS.get(element);
        require(forecastLabel == null,
                forecastLabel + " 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.");
        List<double[]> stationData = mapService.getStationData(
                latitude, longitude, baseDate, baseTime, element);
        return ResponseEntity.ok(stationData);
    }

    /** 현재 격자의 최솟값·평균·최댓값을 반환한다. */
    @ResponseBody
    @GetMapping("/api/weather/grid/stats")
    public ResponseEntity<Map<String, Object>> getDataMinMax(
            HttpServletRequest request,
            @RequestParam("baseDate") String baseDate,
            @RequestParam("baseTime") String baseTime,
            @RequestParam("element") String element,
            @RequestParam(value = "height", defaultValue = "10m") String height,
            @RequestParam(value = "leadHours", defaultValue = "0") int leadHours) {
        validate(baseDate, baseTime, element, height, leadHours);
        // 통계 경로도 전체 격자와 같은 버킷을 사용해 우회 호출로 한도가 배가되지 않게 한다.
        environmentalRateLimiter.checkPublicRequest(request, GRID_RATE_LIMIT_ROUTE);
        return ResponseEntity.ok(mapService.getDataStats(baseDate, baseTime, element, leadHours));
    }

}
