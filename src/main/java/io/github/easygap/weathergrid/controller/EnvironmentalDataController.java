package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.dto.AirQualityReport;
import io.github.easygap.weathergrid.dto.PointForecastReport;
import io.github.easygap.weathergrid.service.EnvironmentalDataService;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;

/** Public point-forecast and AirKorea HTTP contract. */
@RestController
public final class EnvironmentalDataController {

    private static final Set<String> POINT_QUERY = Set.of(
            "latitude", "longitude", "baseDate", "baseTime");
    private static final Set<String> AIR_QUERY = Set.of(
            "minLat", "maxLat", "minLon", "maxLon");
    private static final String POINT_CACHE =
            "public, max-age=3600, stale-while-revalidate=300";
    private static final String AIR_CACHE =
            "public, max-age=300, stale-while-revalidate=300, stale-if-error=3600";

    private final EnvironmentalDataService data;
    private final WeatherRequestBudget rateLimiter;
    private final PublicRequestPolicy requests;

    public EnvironmentalDataController(EnvironmentalDataService data,
                                       WeatherRequestBudget rateLimiter,
                                       PublicRequestPolicy requests) {
        this.data = data;
        this.rateLimiter = rateLimiter;
        this.requests = requests;
    }

    @GetMapping("/api/weather/point-forecast")
    public ResponseEntity<PointForecastReport> pointForecast(
            HttpServletRequest request,
            @RequestParam double latitude,
            @RequestParam double longitude,
            @RequestParam String baseDate,
            @RequestParam String baseTime) {
        requests.requireExactQuery(request, POINT_QUERY);
        requests.requirePointForecast(latitude, longitude, baseDate, baseTime);
        rateLimiter.claimPublic(request, PublicRoute.POINT_FORECAST);
        return ResponseEntity.ok()
                .header("Cache-Control", POINT_CACHE)
                .body(data.getStationForecast(latitude, longitude, baseDate, baseTime));
    }

    @GetMapping("/api/environment/air-quality")
    public ResponseEntity<AirQualityReport> airQuality(
            HttpServletRequest request,
            @RequestParam double minLat,
            @RequestParam double maxLat,
            @RequestParam double minLon,
            @RequestParam double maxLon) {
        requests.requireExactQuery(request, AIR_QUERY);
        requests.requireViewport(minLat, maxLat, minLon, maxLon);
        rateLimiter.claimPublic(request, PublicRoute.AIR_QUALITY);
        AirQualityReport response = data.getAirQuality(minLat, maxLat, minLon, maxLon);
        return ResponseEntity.ok()
                .header("Cache-Control", response.staleSnapshot() ? "no-store" : AIR_CACHE)
                .body(response);
    }
}
