package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.TrafficCameraReport;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.integration.TrafficCameraFeed;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CctvServiceTest {

    @Test
    void filtersExactViewportDeduplicatesAndSortsProviderNeutralCameras() {
        CctvTileCache cache = mock(CctvTileCache.class);
        CctvTileCache.Viewport viewport =
                new CctvTileCache.Viewport(37.05, 37.20, 126.80, 126.98);
        when(cache.load(viewport)).thenReturn(new CctvTileCache.Result(List.of(
                camera("b", "나", 37.11, 126.91),
                camera("a", "가", 37.10, 126.90),
                camera("a", "중복", 37.10, 126.90),
                camera("outside", "범위 밖", 37.30, 126.90)),
                Instant.parse("2026-07-22T03:00:00Z"), true, false));

        TrafficCameraReport response = new CctvService(cache)
                .getCctv(37.05, 37.20, 126.80, 126.98);

        assertEquals("2026-07-22T03:00:00Z", response.collectedAt());
        assertTrue(response.staleSnapshot());
        assertEquals("국가교통정보센터(ITS)", response.provider());
        assertEquals(List.of("a", "b"), response.cameras().stream()
                .map(item -> item.cameraId()).toList());
        assertEquals(List.of("가", "나"), response.cameras().stream()
                .map(item -> item.displayName()).toList());
        assertEquals("HLS", response.cameras().get(0).streamFormat());
    }

    @Test
    void capsThePublicResponseAndPreservesUpstreamTruncation() {
        CctvTileCache cache = mock(CctvTileCache.class);
        CctvTileCache.Viewport viewport =
                new CctvTileCache.Viewport(37.05, 37.20, 126.80, 126.98);
        List<TrafficCameraFeed.Camera> cameras = new ArrayList<>();
        for (int index = 0; index < 1_001; index++) {
            cameras.add(camera(String.format("%04d", index), String.format("카메라%04d", index),
                    37.1, 126.9));
        }
        when(cache.load(viewport)).thenReturn(new CctvTileCache.Result(
                cameras, Instant.EPOCH, false, false));

        TrafficCameraReport response = new CctvService(cache)
                .getCctv(37.05, 37.20, 126.80, 126.98);

        assertEquals(1_000, response.cameras().size());
        assertTrue(response.resultLimited());
    }

    @Test
    void invalidViewportNeverTouchesTheCache() {
        CctvTileCache cache = mock(CctvTileCache.class);

        assertThrows(RequestRejectedException.class,
                () -> new CctvService(cache).getCctv(38, 37, 126, 127));
        verifyNoInteractions(cache);
    }

    private static TrafficCameraFeed.Camera camera(String id, String name,
                                                    double latitude, double longitude) {
        return new TrafficCameraFeed.Camera(id, name, latitude, longitude,
                "https://cctvsec.ktict.co.kr/live/" + id + ".m3u8",
                "1280x720", "20260722120000", null);
    }
}
