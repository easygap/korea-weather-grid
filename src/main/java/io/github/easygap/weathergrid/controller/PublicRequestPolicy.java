package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RequestRejectedException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Map;
import java.util.Set;

/** Validates the finite public query space before rate limits or upstream work run. */
@Component
public final class PublicRequestPolicy {

    private static final ZoneId KOREA_TIME = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter COMPACT_DAY = DateTimeFormatter
            .ofPattern("uuuuMMdd").withResolverStyle(ResolverStyle.STRICT);
    private static final Set<String> FORECAST_RELEASES = Set.of(
            "0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300");
    private static final int MAX_HISTORY_DAYS = 60;
    private static final int RELEASE_DELAY_MINUTES = 10;
    private static final double MIN_LATITUDE = 32;
    private static final double MAX_LATITUDE = 44;
    private static final double MIN_LONGITUDE = 122;
    private static final double MAX_LONGITUDE = 134;
    private static final double CAMERA_CELL_DEGREES = 0.25;
    private static final int MAX_CAMERA_CELLS = 24;

    private final Clock clock;

    public PublicRequestPolicy() {
        this(Clock.system(KOREA_TIME));
    }

    PublicRequestPolicy(Clock clock) {
        this.clock = clock;
    }

    public void requireExactQuery(HttpServletRequest request, Set<String> expectedNames) {
        requireQuery(request, expectedNames, Set.of());
    }

    public void requireQuery(HttpServletRequest request, Set<String> requiredNames,
                             Set<String> optionalNames) {
        Map<String, String[]> parameters = request.getParameterMap();
        Set<String> actualNames = parameters.keySet();
        require(actualNames.containsAll(requiredNames), "잘못된 쿼리 파라미터");
        require(requiredNames.stream().noneMatch(optionalNames::contains),
                "잘못된 쿼리 파라미터");
        require(actualNames.stream().allMatch(name -> requiredNames.contains(name)
                        || optionalNames.contains(name)),
                "잘못된 쿼리 파라미터");
        require(parameters.values().stream().allMatch(values -> values.length == 1),
                "잘못된 쿼리 파라미터");
    }

    public void requirePointForecast(double latitude, double longitude,
                                     String releaseDate, String releaseTime) {
        requireCoordinate(latitude, longitude);
        requireForecastRelease(releaseDate, releaseTime);
    }

    public void requireForecastRelease(String releaseDate, String releaseTime) {
        require(FORECAST_RELEASES.contains(releaseTime), "잘못된 baseTime");

        LocalDate date;
        try {
            date = LocalDate.parse(releaseDate, COMPACT_DAY);
        } catch (DateTimeException | NullPointerException ignored) {
            throw new RequestRejectedException("잘못된 baseDate");
        }
        LocalDate today = LocalDate.now(clock);
        require(!date.isAfter(today) && !date.isBefore(today.minusDays(MAX_HISTORY_DAYS)),
                "baseDate 범위 밖");

        int hour = Integer.parseInt(releaseTime.substring(0, 2));
        LocalDateTime availableAt = date.atTime(hour, 0).plusMinutes(RELEASE_DELAY_MINUTES);
        require(!availableAt.isAfter(LocalDateTime.now(clock)), "아직 발표되지 않은 시각");
    }

    public Viewport requireViewport(double minLat, double maxLat,
                                    double minLon, double maxLon) {
        requireCoordinate(minLat, minLon);
        requireCoordinate(maxLat, maxLon);
        require(minLat < maxLat, "위도 범위 순서 오류");
        require(minLon < maxLon, "경도 범위 순서 오류");
        return new Viewport(minLat, maxLat, minLon, maxLon);
    }

    public Viewport requireCameraViewport(double minLat, double maxLat,
                                          double minLon, double maxLon) {
        Viewport viewport = requireViewport(minLat, maxLat, minLon, maxLon);
        int latitudeCells = cellEnd(maxLat) - cellStart(minLat);
        int longitudeCells = cellEnd(maxLon) - cellStart(minLon);
        require((long) latitudeCells * longitudeCells <= MAX_CAMERA_CELLS,
                "CCTV 조회 영역이 너무 큼");
        return viewport;
    }

    private static int cellStart(double value) {
        return (int) Math.floor(value / CAMERA_CELL_DEGREES);
    }

    private static int cellEnd(double value) {
        return (int) Math.ceil(value / CAMERA_CELL_DEGREES);
    }

    public void requireCoordinate(double latitude, double longitude) {
        require(Double.isFinite(latitude) && latitude >= MIN_LATITUDE
                && latitude <= MAX_LATITUDE, "위도 범위 밖");
        require(Double.isFinite(longitude) && longitude >= MIN_LONGITUDE
                && longitude <= MAX_LONGITUDE, "경도 범위 밖");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new RequestRejectedException(message);
    }

    public record Viewport(double minLatitude, double maxLatitude,
                           double minLongitude, double maxLongitude) {
    }
}
