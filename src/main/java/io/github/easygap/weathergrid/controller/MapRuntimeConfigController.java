package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.config.MapProviderProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 정적 셸이 사용할 수 있는 최소 브라우저 지도 설정만 반환한다. */
@RestController
@RequestMapping("/api/runtime")
public final class MapRuntimeConfigController {

    private static final String VWORLD_TILE_BASE = "/api/map/vworld";

    private final MapProviderProperties providers;

    public MapRuntimeConfigController(MapProviderProperties providers) {
        this.providers = providers;
    }

    @GetMapping("/map-config")
    public ResponseEntity<MapRuntimeConfig> mapConfig(HttpServletRequest request) {
        if (!request.getParameterMap().isEmpty()) {
            return ResponseEntity.badRequest()
                    .cacheControl(CacheControl.noStore())
                    .body(new MapRuntimeConfig(false, ""));
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new MapRuntimeConfig(
                        providers.vworldEnabled(),
                        providers.vworldEnabled() ? VWORLD_TILE_BASE : ""));
    }

    public record MapRuntimeConfig(boolean vworldEnabled, String vworldTileBase) {
    }
}
