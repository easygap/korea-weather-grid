package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute;
import io.github.easygap.weathergrid.service.MapService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Public grid and statistics endpoints sharing one request-budget bucket. */
@RestController
public final class WeatherGridController {


    private final MapService maps;
    private final WeatherRequestBudget rateLimiter;
    private final WeatherMapRequestPolicy requests;

    public WeatherGridController(MapService maps, WeatherRequestBudget rateLimiter,
                                 WeatherMapRequestPolicy requests) {
        this.maps = maps;
        this.rateLimiter = rateLimiter;
        this.requests = requests;
    }

    @GetMapping("/api/weather/grid")
    public ResponseEntity<Map<String, Object>> grid(
            HttpServletRequest request,
            @RequestParam String baseDate,
            @RequestParam String baseTime,
            @RequestParam String element,
            @RequestParam(defaultValue = "10m") String height,
            @RequestParam(defaultValue = "0") int leadHours) {
        WeatherMapRequestPolicy.GridQuery query = requests.requireGrid(
                request, baseDate, baseTime, element, height, leadHours);
        rateLimiter.claimPublic(request, PublicRoute.WEATHER_GRID);
        return ResponseEntity.ok(maps.getGridData(
                query.baseDate(), query.baseTime(), query.element(), query.leadHours()));
    }

    @GetMapping("/api/weather/grid/stats")
    public ResponseEntity<Map<String, Object>> statistics(
            HttpServletRequest request,
            @RequestParam String baseDate,
            @RequestParam String baseTime,
            @RequestParam String element,
            @RequestParam(defaultValue = "10m") String height,
            @RequestParam(defaultValue = "0") int leadHours) {
        WeatherMapRequestPolicy.GridQuery query = requests.requireGrid(
                request, baseDate, baseTime, element, height, leadHours);
        rateLimiter.claimPublic(request, PublicRoute.WEATHER_GRID);
        return ResponseEntity.ok(maps.getDataStats(
                query.baseDate(), query.baseTime(), query.element(), query.leadHours()));
    }
}
