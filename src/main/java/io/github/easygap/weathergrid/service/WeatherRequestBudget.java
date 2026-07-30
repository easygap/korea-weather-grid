package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.RequestThrottledException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.LongSupplier;

/** Strongly typed request budgets for public routes and provider refreshes. */
@Component
public final class WeatherRequestBudget {

    public enum PublicRoute {
        POINT_FORECAST,
        AIR_QUALITY,
        TRAFFIC_CAMERAS,
        WEATHER_GRID,
        WEATHER_TIMESERIES,
        VWORLD_TILES
    }

    public enum RefreshSource {
        POINT_FORECAST,
        AIR_STATIONS,
        AIR_OBSERVATIONS,
        TRAFFIC_CAMERAS
    }

    private final LongSupplier ticker;
    private final ClientAddressPolicy clientAddresses;
    private final MonotonicQuota publicQuota;
    private final Map<RefreshSource, MonotonicQuota> refreshQuotas;
    private final boolean unrestricted;

    @Autowired
    public WeatherRequestBudget(
            @Value("${weather-grid.request-budget.public-per-minute:60}") int publicPerMinute,
            @Value("${weather-grid.request-budget.maximum-client-buckets:10000}") int maximumClients,
            @Value("${weather-grid.request-budget.point-forecast-per-minute:20}") int pointForecastPerMinute,
            @Value("${weather-grid.request-budget.air-per-hour:2}") int airPerHour,
            @Value("${weather-grid.request-budget.traffic-cameras-per-minute:30}") int camerasPerMinute,
            @Value("${weather-grid.request-budget.trusted-proxy-cidrs:}") String trustedProxyCidrs) {
        this(System::nanoTime, publicPerMinute, maximumClients, pointForecastPerMinute,
                airPerHour, camerasPerMinute, trustedProxyCidrs, false);
    }

    WeatherRequestBudget(LongSupplier ticker, int publicPerMinute, int maximumClients,
                         int pointForecastPerMinute, int airPerHour, int camerasPerMinute,
                         String trustedProxyCidrs) {
        this(ticker, publicPerMinute, maximumClients, pointForecastPerMinute,
                airPerHour, camerasPerMinute, trustedProxyCidrs, false);
    }

    private WeatherRequestBudget(LongSupplier ticker, int publicPerMinute, int maximumClients,
                                 int pointForecastPerMinute, int airPerHour, int camerasPerMinute,
                                 String trustedProxyCidrs, boolean unrestricted) {
        this.ticker = Objects.requireNonNull(ticker, "ticker");
        this.clientAddresses = new ClientAddressPolicy(trustedProxyCidrs);
        this.publicQuota = new MonotonicQuota(
                publicPerMinute, Duration.ofMinutes(1), maximumClients);
        EnumMap<RefreshSource, MonotonicQuota> quotas = new EnumMap<>(RefreshSource.class);
        quotas.put(RefreshSource.POINT_FORECAST,
                new MonotonicQuota(pointForecastPerMinute, Duration.ofMinutes(1), 1));
        quotas.put(RefreshSource.AIR_STATIONS,
                new MonotonicQuota(airPerHour, Duration.ofHours(1), 1));
        quotas.put(RefreshSource.AIR_OBSERVATIONS,
                new MonotonicQuota(airPerHour, Duration.ofHours(1), 1));
        quotas.put(RefreshSource.TRAFFIC_CAMERAS,
                new MonotonicQuota(camerasPerMinute, Duration.ofMinutes(1), 1));
        this.refreshQuotas = Map.copyOf(quotas);
        this.unrestricted = unrestricted;
    }

    static WeatherRequestBudget unrestricted() {
        return new WeatherRequestBudget(() -> 0, 1, 1, 1, 1, 1, "", true);
    }

    public void claimPublic(HttpServletRequest request, PublicRoute route) {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(route, "route");
        if (unrestricted) return;
        claim(publicQuota, route.name() + ':' + clientAddresses.identify(request));
    }

    public void claimRefresh(RefreshSource source) {
        Objects.requireNonNull(source, "source");
        if (unrestricted) return;
        claim(refreshQuotas.get(source), source.name());
    }

    int trackedClientBuckets() {
        return publicQuota.trackedKeys();
    }

    private void claim(MonotonicQuota quota, String key) {
        long retryAfter = quota.claim(key, ticker.getAsLong());
        if (retryAfter > 0) throw new RequestThrottledException(retryAfter);
    }
}
