package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.integration.TrafficCameraFeed;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CctvTileCacheTest {

    private CctvTileCache cache;

    @AfterEach
    void closeCache() {
        if (cache != null) cache.close();
    }

    @Test
    void overlappingQueriesReuseTheSameFreshCell() {
        TrafficCameraFeed feed = mock(TrafficCameraFeed.class);
        WeatherRequestBudget budget = mock(WeatherRequestBudget.class);
        when(feed.retrieve(37.0, 37.25, 126.75, 127.0))
                .thenReturn(new TrafficCameraFeed.Batch(List.of(camera("a")), false));
        cache = new CctvTileCache(feed, budget,
                new MutableClock(Instant.parse("2026-07-22T03:00:00Z")), Duration.ofSeconds(1));

        CctvTileCache.Result first = cache.load(
                new CctvTileCache.Viewport(37.05, 37.20, 126.80, 126.98));
        CctvTileCache.Result second = cache.load(
                new CctvTileCache.Viewport(37.10, 37.21, 126.85, 126.99));

        assertFalse(first.stale());
        assertFalse(second.stale());
        verify(feed).retrieve(37.0, 37.25, 126.75, 127.0);
        verify(budget).claimRefresh(WeatherRequestBudget.RefreshSource.TRAFFIC_CAMERAS);
    }

    @Test
    void failureUsesRecentStaleDataAndBackoffSuppressesRepeatedCalls() {
        TrafficCameraFeed feed = mock(TrafficCameraFeed.class);
        WeatherRequestBudget budget = mock(WeatherRequestBudget.class);
        MutableClock clock = new MutableClock(Instant.parse("2026-07-22T03:00:00Z"));
        when(feed.retrieve(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(new TrafficCameraFeed.Batch(List.of(camera("a")), false))
                .thenThrow(new UpstreamUnavailableException());
        cache = new CctvTileCache(feed, budget, clock, Duration.ofSeconds(1));
        CctvTileCache.Viewport viewport =
                new CctvTileCache.Viewport(37.05, 37.20, 126.80, 126.98);

        assertFalse(cache.load(viewport).stale());
        clock.advance(Duration.ofSeconds(61));
        assertTrue(cache.load(viewport).stale());
        assertTrue(cache.load(viewport).stale());
        verify(feed, times(2)).retrieve(anyDouble(), anyDouble(), anyDouble(), anyDouble());

        clock.advance(Duration.ofMinutes(4));
        assertThrows(UpstreamUnavailableException.class, () -> cache.load(viewport));
        verify(feed, times(3)).retrieve(anyDouble(), anyDouble(), anyDouble(), anyDouble());
    }

    @Test
    void concurrentColdReadsCollapseToOneProviderCall() throws Exception {
        TrafficCameraFeed feed = mock(TrafficCameraFeed.class);
        WeatherRequestBudget budget = mock(WeatherRequestBudget.class);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(feed.retrieve(anyDouble(), anyDouble(), anyDouble(), anyDouble())).thenAnswer(call -> {
            entered.countDown();
            assertTrue(release.await(1, TimeUnit.SECONDS));
            return new TrafficCameraFeed.Batch(List.of(camera("a")), false);
        });
        cache = new CctvTileCache(feed, budget,
                new MutableClock(Instant.parse("2026-07-22T03:00:00Z")), Duration.ofSeconds(2));
        CctvTileCache.Viewport viewport =
                new CctvTileCache.Viewport(37.05, 37.20, 126.80, 126.98);

        var callers = Executors.newFixedThreadPool(2);
        try {
            var first = callers.submit(() -> cache.load(viewport));
            assertTrue(entered.await(1, TimeUnit.SECONDS));
            var second = callers.submit(() -> cache.load(viewport));
            release.countDown();
            assertFalse(first.get(2, TimeUnit.SECONDS).stale());
            assertFalse(second.get(2, TimeUnit.SECONDS).stale());
        } finally {
            callers.shutdownNow();
        }
        verify(feed).retrieve(anyDouble(), anyDouble(), anyDouble(), anyDouble());
    }

    @Test
    void rejectsInvalidOrExcessiveViewportsBeforeProviderUse() {
        TrafficCameraFeed feed = mock(TrafficCameraFeed.class);
        cache = new CctvTileCache(feed, mock(WeatherRequestBudget.class),
                new MutableClock(Instant.EPOCH), Duration.ofSeconds(1));

        assertThrows(RequestRejectedException.class,
                () -> new CctvTileCache.Viewport(38, 37, 126, 127));
        assertThrows(RequestRejectedException.class, () -> cache.load(
                new CctvTileCache.Viewport(37.0, 38.5, 126.0, 127.25)));
    }

    @Test
    void cacheRetainsOnlyTheMostRecentTwoHundredFiftySixCells() {
        TrafficCameraFeed feed = mock(TrafficCameraFeed.class);
        when(feed.retrieve(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(new TrafficCameraFeed.Batch(List.of(), false));
        cache = new CctvTileCache(feed, mock(WeatherRequestBudget.class),
                new MutableClock(Instant.EPOCH), Duration.ofSeconds(1));

        for (int latitude = 0; latitude < 17; latitude++) {
            for (int longitude = 0; longitude < 16; longitude++) {
                double south = 32 + latitude * CctvTileCache.CELL_DEGREES + 0.01;
                double west = 122 + longitude * CctvTileCache.CELL_DEGREES + 0.01;
                cache.load(new CctvTileCache.Viewport(
                        south, south + 0.01, west, west + 0.01));
            }
        }

        assertEquals(256, cache.trackedCells());
    }

    private static TrafficCameraFeed.Camera camera(String id) {
        return new TrafficCameraFeed.Camera(id, id, 37.1, 126.9,
                "https://cctvsec.ktict.co.kr/live/" + id + ".m3u8",
                "1280x720", "20260722120000", null);
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
