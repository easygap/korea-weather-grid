package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RequestRejectedException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;

/** Defines the finite request space for grid, statistics, coverage, and station-series APIs. */
@Component
public final class WeatherMapRequestPolicy {

    private static final Set<String> GRID_REQUIRED = Set.of("baseDate", "baseTime", "element");
    private static final Set<String> GRID_OPTIONAL = Set.of("height", "leadHours");
    private static final Set<String> COVERAGE_QUERY = Set.of("latitude", "longitude");
    private static final Set<String> SERIES_REQUIRED = Set.of(
            "latitude", "longitude", "baseDate", "baseTime");
    private static final Set<String> SERIES_OPTIONAL = Set.of("element", "height");
    private static final Set<String> GRID_ELEMENTS = Set.of(
            "wdws", "tmp", "pcp", "sno", "pty", "reh", "sky", "wav", "swdn");
    private static final Map<String, String> DETAILED_FORECAST_ELEMENTS = Map.of(
            "pcp", "강수량",
            "sno", "신적설",
            "pty", "강수형태",
            "reh", "상대습도",
            "sky", "하늘상태",
            "wav", "파고");

    private final PublicRequestPolicy publicRequests;

    public WeatherMapRequestPolicy(PublicRequestPolicy publicRequests) {
        this.publicRequests = publicRequests;
    }

    public GridQuery requireGrid(HttpServletRequest request, String baseDate, String baseTime,
                                 String element, String height, int leadHours) {
        publicRequests.requireQuery(request, GRID_REQUIRED, GRID_OPTIONAL);
        publicRequests.requireForecastRelease(baseDate, baseTime);
        require(GRID_ELEMENTS.contains(element), "잘못된 element");
        require("10m".equals(height), "잘못된 height");
        require(leadHours >= 0 && leadHours <= 48, "잘못된 leadHours");
        return new GridQuery(baseDate, baseTime, element, leadHours);
    }

    public Coordinate requireCoverage(HttpServletRequest request,
                                      double latitude, double longitude) {
        publicRequests.requireExactQuery(request, COVERAGE_QUERY);
        publicRequests.requireCoordinate(latitude, longitude);
        return new Coordinate(latitude, longitude);
    }

    public StationQuery requireStationSeries(HttpServletRequest request,
                                             double latitude, double longitude,
                                             String baseDate, String baseTime,
                                             String element, String height) {
        publicRequests.requireQuery(request, SERIES_REQUIRED, SERIES_OPTIONAL);
        publicRequests.requirePointForecast(latitude, longitude, baseDate, baseTime);
        require(GRID_ELEMENTS.contains(element), "잘못된 element");
        require("10m".equals(height), "잘못된 height");
        String detailedName = DETAILED_FORECAST_ELEMENTS.get(element);
        if (detailedName != null) {
            throw new RequestRejectedException(
                    detailedName + " 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.");
        }
        return new StationQuery(latitude, longitude, baseDate, baseTime, element);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new RequestRejectedException(message);
    }

    public record GridQuery(String baseDate, String baseTime, String element, int leadHours) {
    }

    public record Coordinate(double latitude, double longitude) {
    }

    public record StationQuery(double latitude, double longitude,
                               String baseDate, String baseTime, String element) {
    }
}
