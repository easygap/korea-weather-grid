package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.TrafficCameraView;
import io.github.easygap.weathergrid.dto.TrafficCameraReport;
import io.github.easygap.weathergrid.integration.TrafficCameraFeed;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;

/** Produces the public CCTV response from bounded, provider-normalized tile data. */
@Service
@RequiredArgsConstructor
public class CctvService {

    private static final int RESPONSE_LIMIT = 1_000;
    private static final String SOURCE = "국가교통정보센터(ITS)";

    private final CctvTileCache tileCache;

    public TrafficCameraReport getCctv(double minLat, double maxLat,
                                   double minLon, double maxLon) {
        CctvTileCache.Viewport viewport =
                new CctvTileCache.Viewport(minLat, maxLat, minLon, maxLon);
        CctvTileCache.Result loaded = tileCache.load(viewport);

        LinkedHashMap<String, TrafficCameraFeed.Camera> byId = new LinkedHashMap<>();
        for (TrafficCameraFeed.Camera camera : loaded.cameras()) {
            if (camera.latitude() >= minLat && camera.latitude() <= maxLat
                    && camera.longitude() >= minLon && camera.longitude() <= maxLon) {
                byId.putIfAbsent(camera.id(), camera);
            }
        }

        List<TrafficCameraFeed.Camera> selected = new ArrayList<>(byId.values());
        selected.sort(Comparator.comparing(TrafficCameraFeed.Camera::name)
                .thenComparingDouble(TrafficCameraFeed.Camera::latitude)
                .thenComparingDouble(TrafficCameraFeed.Camera::longitude));
        boolean truncated = loaded.truncated();
        if (selected.size() > RESPONSE_LIMIT) {
            selected = new ArrayList<>(selected.subList(0, RESPONSE_LIMIT));
            truncated = true;
        }

        List<TrafficCameraView> items = selected.stream().map(CctvService::toDto).toList();
        return new TrafficCameraReport(
                DateTimeFormatter.ISO_INSTANT.format(loaded.fetchedAt()),
                loaded.stale(), truncated, SOURCE, items);
    }

    private static TrafficCameraView toDto(TrafficCameraFeed.Camera camera) {
        return new TrafficCameraView(camera.id(), camera.name(), camera.latitude(), camera.longitude(),
                camera.streamUrl(), "HLS", camera.resolution(), camera.fileCreatedAt(),
                camera.roadSectionId());
    }
}
