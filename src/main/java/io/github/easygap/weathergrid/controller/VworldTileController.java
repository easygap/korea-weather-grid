package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.integration.VworldTileGateway;
import io.github.easygap.weathergrid.integration.VworldTileGateway.TileBody;
import io.github.easygap.weathergrid.integration.VworldTileGateway.TileKind;
import io.github.easygap.weathergrid.integration.VworldTileGateway.TileRequest;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 검증된 국내 지도 범위만 VWorld 동일 출처 타일로 중계한다. */
@RestController
public final class VworldTileController {

    private static final Pattern TILE_FILE = Pattern.compile("(\\d{1,8})\\.(png|pbf)");
    private static final int MIN_ZOOM = 2;
    private static final int MAX_ZOOM = 14;
    private static final double MIN_LONGITUDE = 116;
    private static final double MAX_LONGITUDE = 140;
    private static final double MIN_LATITUDE = 29;
    private static final double MAX_LATITUDE = 46;
    private static final CacheControl CACHE_POLICY = CacheControl.maxAge(Duration.ofDays(1))
            .cachePublic()
            .staleWhileRevalidate(Duration.ofDays(7));

    private final VworldTileGateway tiles;
    private final WeatherRequestBudget rateLimiter;
    private final PublicRequestPolicy requests;

    public VworldTileController(VworldTileGateway tiles,
                                WeatherRequestBudget rateLimiter,
                                PublicRequestPolicy requests) {
        this.tiles = tiles;
        this.rateLimiter = rateLimiter;
        this.requests = requests;
    }

    @GetMapping("/api/map/vworld/{kind}/{zoom}/{x}/{file}")
    public ResponseEntity<byte[]> tile(
            HttpServletRequest request,
            @PathVariable String kind,
            @PathVariable int zoom,
            @PathVariable int x,
            @PathVariable String file) {
        requests.requireExactQuery(request, Set.of());
        TileRequest tile = requireTile(kind, zoom, x, file);
        rateLimiter.claimPublic(request, PublicRoute.VWORLD_TILES);
        TileBody body = tiles.fetch(tile);
        return ResponseEntity.ok()
                .cacheControl(CACHE_POLICY)
                .contentType(body.contentType())
                .body(body.bytes());
    }

    static TileRequest requireTile(String rawKind, int zoom, int x, String file) {
        Matcher fileMatch = TILE_FILE.matcher(file == null ? "" : file);
        if (!fileMatch.matches()) throw rejected();

        TileKind kind = switch (rawKind == null ? "" : rawKind.toLowerCase(Locale.ROOT)) {
            case "base" -> TileKind.BASE;
            case "traffic" -> TileKind.TRAFFIC;
            default -> throw rejected();
        };
        String extension = fileMatch.group(2);
        if (kind == TileKind.BASE && !"png".equals(extension)
                || kind == TileKind.TRAFFIC && !"pbf".equals(extension)) {
            throw rejected();
        }

        int y;
        try {
            y = Integer.parseInt(fileMatch.group(1));
        } catch (NumberFormatException ignored) {
            throw rejected();
        }
        if (!intersectsAllowedArea(zoom, x, y)) throw rejected();
        return new TileRequest(kind, zoom, x, y);
    }

    private static boolean intersectsAllowedArea(int zoom, int x, int y) {
        if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return false;
        int edge = 1 << zoom;
        if (x < 0 || y < 0 || x >= edge || y >= edge) return false;

        double west = x / (double) edge * 360.0 - 180.0;
        double east = (x + 1.0) / edge * 360.0 - 180.0;
        double north = tileLatitude(y, edge);
        double south = tileLatitude(y + 1, edge);
        return east >= MIN_LONGITUDE && west <= MAX_LONGITUDE
                && north >= MIN_LATITUDE && south <= MAX_LATITUDE;
    }

    private static double tileLatitude(int y, int edge) {
        double mercator = Math.PI * (1.0 - 2.0 * y / edge);
        return Math.toDegrees(Math.atan(Math.sinh(mercator)));
    }

    private static RequestRejectedException rejected() {
        return new RequestRejectedException("잘못된 지도 타일 요청");
    }
}
