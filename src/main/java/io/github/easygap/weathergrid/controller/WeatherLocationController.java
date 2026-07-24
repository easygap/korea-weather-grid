package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute;
import io.github.easygap.weathergrid.service.MapService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Public coverage and point-series endpoints. */
@RestController
public final class WeatherLocationController {

    private final MapService maps;
    private final WeatherRequestBudget rateLimiter;
    private final WeatherMapRequestPolicy requests;

    public WeatherLocationController(MapService maps, WeatherRequestBudget rateLimiter,
                                     WeatherMapRequestPolicy requests) {
        this.maps = maps;
        this.rateLimiter = rateLimiter;
        this.requests = requests;
    }

    @GetMapping("/api/weather/coverage")
    public ResponseEntity<Map<String, Boolean>> coverage(
            HttpServletRequest request,
            @RequestParam double latitude,
            @RequestParam double longitude) {
        WeatherMapRequestPolicy.Coordinate coordinate = requests.requireCoverage(
                request, latitude, longitude);
        boolean inside = KmaDfsProjection.STANDARD.isInsideMapWindow(
                coordinate.latitude(), coordinate.longitude());
        return ResponseEntity.ok(Map.of("inside", inside));
    }

    @GetMapping("/api/weather/timeseries")
    public ResponseEntity<List<double[]>> stationSeries(
            HttpServletRequest request,
            @RequestParam double latitude,
            @RequestParam double longitude,
            @RequestParam String baseDate,
            @RequestParam String baseTime,
            @RequestParam(defaultValue = "wdws") String element,
            @RequestParam(defaultValue = "10m") String height) {
        WeatherMapRequestPolicy.StationQuery query = requests.requireStationSeries(
                request, latitude, longitude, baseDate, baseTime, element, height);
        rateLimiter.claimPublic(request, PublicRoute.WEATHER_TIMESERIES);
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=300")
                .body(maps.getStationData(query.latitude(), query.longitude(),
                        query.baseDate(), query.baseTime(), query.element()));
    }
}
