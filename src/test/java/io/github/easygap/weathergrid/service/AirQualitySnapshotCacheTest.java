package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.integration.AirQualityFeed;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AirQualitySnapshotCacheTest {

    @Test
    void servesFreshThenBoundedStaleDataAndPausesFailedRetries() {
        AirQualityFeed feed = mock(AirQualityFeed.class);
        when(feed.fetchMeasurements())
                .thenReturn(List.of(measurement()))
                .thenThrow(new UpstreamUnavailableException());
        when(feed.fetchStations()).thenReturn(List.of(station()));
        MutableClock clock = new MutableClock(Instant.parse("2026-07-22T00:00:00Z"));
        AirQualitySnapshotCache cache = new AirQualitySnapshotCache(
                feed, WeatherRequestBudget.unrestricted(), clock);

        assertFalse(cache.read().stale());
        assertFalse(cache.read().stale());
        verify(feed).fetchMeasurements();
        verify(feed).fetchStations();

        clock.advance(Duration.ofHours(2));
        assertTrue(cache.read().stale());
        assertTrue(cache.read().stale(), "15-minute retry pause should reuse stale data");
        verify(feed, times(2)).fetchMeasurements();
        verify(feed).fetchStations();

        clock.advance(Duration.ofHours(5));
        assertThrows(UpstreamUnavailableException.class, cache::read);
        verify(feed, times(3)).fetchMeasurements();
    }

    @Test
    void concurrentColdReadsShareOneRefresh() throws Exception {
        AirQualityFeed feed = mock(AirQualityFeed.class);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(feed.fetchMeasurements()).thenAnswer(ignored -> {
            entered.countDown();
            assertTrue(release.await(2, TimeUnit.SECONDS));
            return List.of(measurement());
        });
        when(feed.fetchStations()).thenReturn(List.of(station()));
        Clock clock = Clock.fixed(Instant.parse("2026-07-22T00:00:00Z"), ZoneOffset.UTC);
        AirQualitySnapshotCache cache = new AirQualitySnapshotCache(
                feed, WeatherRequestBudget.unrestricted(), clock);

        CompletableFuture<AirQualitySnapshotCache.Snapshot> first =
                CompletableFuture.supplyAsync(cache::read);
        assertTrue(entered.await(2, TimeUnit.SECONDS));
        CompletableFuture<AirQualitySnapshotCache.Snapshot> second =
                CompletableFuture.supplyAsync(cache::read);
        release.countDown();

        assertFalse(first.get(2, TimeUnit.SECONDS).stale());
        assertFalse(second.get(2, TimeUnit.SECONDS).stale());
        verify(feed).fetchMeasurements();
        verify(feed).fetchStations();
    }

    private static AirQualityFeed.Measurement measurement() {
        return new AirQualityFeed.Measurement("종로구", "서울", null, "도시대기",
                42.0, 18.0, 2, 2, null, null, "2026-07-22 09:00");
    }

    private static AirQualityFeed.Station station() {
        return new AirQualityFeed.Station(
                "종로구", "서울특별시 종로구", "도시대기", 37.57, 127.0);
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
            return ZoneOffset.UTC;
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
