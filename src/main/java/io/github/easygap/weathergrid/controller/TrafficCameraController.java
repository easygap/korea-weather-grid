package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.dto.TrafficCameraReport;
import io.github.easygap.weathergrid.service.CctvService;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;

/** Public traffic-camera viewport contract; upstream credentials and options are never accepted. */
@RestController
public final class TrafficCameraController {

    private static final Set<String> QUERY = Set.of("minLat", "maxLat", "minLon", "maxLon");

    private final CctvService cameras;
    private final WeatherRequestBudget rateLimiter;
    private final PublicRequestPolicy requests;

    public TrafficCameraController(CctvService cameras,
                                   WeatherRequestBudget rateLimiter,
                                   PublicRequestPolicy requests) {
        this.cameras = cameras;
        this.rateLimiter = rateLimiter;
        this.requests = requests;
    }

    @GetMapping("/api/traffic/cameras")
    public ResponseEntity<TrafficCameraReport> cameras(
            HttpServletRequest request,
            @RequestParam double minLat,
            @RequestParam double maxLat,
            @RequestParam double minLon,
            @RequestParam double maxLon) {
        requests.requireExactQuery(request, QUERY);
        requests.requireCameraViewport(minLat, maxLat, minLon, maxLon);
        rateLimiter.claimPublic(request, PublicRoute.TRAFFIC_CAMERAS);
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(cameras.getCctv(minLat, maxLat, minLon, maxLon));
    }
}
