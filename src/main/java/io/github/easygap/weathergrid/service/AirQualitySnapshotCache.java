package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.exception.RequestThrottledException;
import io.github.easygap.weathergrid.integration.AirQualityFeed;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Maintains bounded-age AirKorea measurements and station metadata independently. */
@Service
public final class AirQualitySnapshotCache {

    private static final Duration MEASUREMENT_FRESH = Duration.ofHours(1);
    private static final Duration MEASUREMENT_STALE_LIMIT = Duration.ofHours(6);
    private static final Duration STATION_FRESH = Duration.ofDays(7);
    private static final Duration STATION_STALE_LIMIT = Duration.ofDays(30);
    private static final Duration RETRY_PAUSE = Duration.ofMinutes(15);

    private final Resource<List<AirQualityFeed.Measurement>> measurementCache;
    private final Resource<List<AirQualityFeed.Station>> stationCache;

    @Autowired
    public AirQualitySnapshotCache(AirQualityFeed feed,
                                   WeatherRequestBudget rateLimiter) {
        this(feed, rateLimiter, Clock.systemUTC());
    }

    AirQualitySnapshotCache(AirQualityFeed feed, WeatherRequestBudget rateLimiter,
                            Clock clock) {
        measurementCache = new Resource<>(clock, MEASUREMENT_FRESH, MEASUREMENT_STALE_LIMIT,
                () -> rateLimiter.claimRefresh(WeatherRequestBudget.RefreshSource.AIR_OBSERVATIONS),
                feed::fetchMeasurements);
        stationCache = new Resource<>(clock, STATION_FRESH, STATION_STALE_LIMIT,
                () -> rateLimiter.claimRefresh(WeatherRequestBudget.RefreshSource.AIR_STATIONS),
                feed::fetchStations);
    }

    public Snapshot read() {
        Read<List<AirQualityFeed.Measurement>> measurements = measurementCache.read();
        Read<List<AirQualityFeed.Station>> stations = stationCache.read();
        return new Snapshot(measurements.value(), stations.value(),
                measurements.stale() || stations.stale());
    }

    public record Snapshot(List<AirQualityFeed.Measurement> measurements,
                           List<AirQualityFeed.Station> stations,
                           boolean stale) {
        public Snapshot {
            measurements = List.copyOf(measurements);
            stations = List.copyOf(stations);
        }
    }

    private static final class Resource<T> {
        private final Clock clock;
        private final Duration freshFor;
        private final Duration staleFor;
        private final Runnable budget;
        private final Supplier<T> loader;
        private final ReentrantLock refreshLock = new ReentrantLock();
        private volatile Entry<T> entry;
        private volatile Instant retryAt = Instant.EPOCH;

        private Resource(Clock clock, Duration freshFor, Duration staleFor,
                         Runnable budget, Supplier<T> loader) {
            this.clock = clock;
            this.freshFor = freshFor;
            this.staleFor = staleFor;
            this.budget = budget;
            this.loader = loader;
        }

        private Read<T> read() {
            Entry<T> observed = entry;
            if (youngerThan(observed, freshFor)) return new Read<>(observed.value(), false);
            refreshLock.lock();
            try {
                Entry<T> current = entry;
                if (youngerThan(current, freshFor)) return new Read<>(current.value(), false);
                if (clock.instant().isBefore(retryAt)) return stale(current);
                try {
                    budget.run();
                    T loaded = loader.get();
                    entry = new Entry<>(loaded, clock.instant());
                    retryAt = Instant.EPOCH;
                    return new Read<>(loaded, false);
                } catch (RequestThrottledException failure) {
                    if (youngerThan(current, staleFor)) return new Read<>(current.value(), true);
                    throw failure;
                } catch (UpstreamUnavailableException failure) {
                    retryAt = clock.instant().plus(RETRY_PAUSE);
                    if (youngerThan(current, staleFor)) return new Read<>(current.value(), true);
                    throw failure;
                }
            } finally {
                refreshLock.unlock();
            }
        }

        private Read<T> stale(Entry<T> current) {
            if (youngerThan(current, staleFor)) return new Read<>(current.value(), true);
            throw new UpstreamUnavailableException();
        }

        private boolean youngerThan(Entry<T> candidate, Duration maximumAge) {
            return candidate != null
                    && clock.instant().isBefore(candidate.loadedAt().plus(maximumAge));
        }
    }

    private record Entry<T>(T value, Instant loadedAt) {
    }

    private record Read<T>(T value, boolean stale) {
    }
}
