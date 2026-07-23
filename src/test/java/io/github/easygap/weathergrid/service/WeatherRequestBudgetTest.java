package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.RequestThrottledException;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute.AIR_QUALITY;
import static io.github.easygap.weathergrid.service.WeatherRequestBudget.PublicRoute.WEATHER_GRID;
import static io.github.easygap.weathergrid.service.WeatherRequestBudget.RefreshSource.AIR_OBSERVATIONS;
import static io.github.easygap.weathergrid.service.WeatherRequestBudget.RefreshSource.AIR_STATIONS;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WeatherRequestBudgetTest {

    @Test
    void routeAndResolvedClientTogetherDefineAPublicBucket() {
        AtomicLong ticker = new AtomicLong();
        WeatherRequestBudget budget = budget(ticker, 1, 10, "10.0.0.0/8");
        HttpServletRequest first = request("10.1.2.3", "198.51.100.1");
        HttpServletRequest second = request("10.1.2.3", "198.51.100.2");

        budget.claimPublic(first, WEATHER_GRID);
        assertDoesNotThrow(() -> budget.claimPublic(second, WEATHER_GRID));
        assertDoesNotThrow(() -> budget.claimPublic(first, AIR_QUALITY));
        RequestThrottledException limited = assertThrows(RequestThrottledException.class,
                () -> budget.claimPublic(first, WEATHER_GRID));

        assertEquals(60, limited.retryAfterSeconds());
    }

    @Test
    void publicBucketStorageRemainsBoundedAndUsesAccessOrder() {
        AtomicLong ticker = new AtomicLong();
        WeatherRequestBudget budget = budget(ticker, 1, 2, "");

        budget.claimPublic(request("192.0.2.1", null), WEATHER_GRID);
        budget.claimPublic(request("192.0.2.2", null), WEATHER_GRID);
        assertThrows(RequestThrottledException.class,
                () -> budget.claimPublic(request("192.0.2.1", null), WEATHER_GRID));
        budget.claimPublic(request("192.0.2.3", null), WEATHER_GRID);
        assertDoesNotThrow(() -> budget.claimPublic(request("192.0.2.2", null), WEATHER_GRID));

        assertEquals(2, budget.trackedClientBuckets());
    }

    @Test
    void refreshSourcesHaveIndependentGlobalBudgetsAndMonotonicRetryTime() {
        AtomicLong ticker = new AtomicLong();
        WeatherRequestBudget budget = budget(ticker, 10, 10, "");

        budget.claimRefresh(AIR_OBSERVATIONS);
        budget.claimRefresh(AIR_STATIONS);
        RequestThrottledException initial = assertThrows(RequestThrottledException.class,
                () -> budget.claimRefresh(AIR_OBSERVATIONS));
        ticker.set(Duration.ofMinutes(59).plusSeconds(30).toNanos());
        RequestThrottledException nearBoundary = assertThrows(RequestThrottledException.class,
                () -> budget.claimRefresh(AIR_OBSERVATIONS));
        ticker.set(Duration.ofHours(1).toNanos());

        assertEquals(3_600, initial.retryAfterSeconds());
        assertEquals(30, nearBoundary.retryAfterSeconds());
        assertDoesNotThrow(() -> budget.claimRefresh(AIR_OBSERVATIONS));
    }

    @Test
    void unrestrictedBudgetIsAnExplicitTestOnlyNoOp() {
        WeatherRequestBudget budget = WeatherRequestBudget.unrestricted();

        for (int index = 0; index < 100; index++) {
            budget.claimPublic(request("192.0.2.1", null), WEATHER_GRID);
            budget.claimRefresh(AIR_OBSERVATIONS);
        }

        assertEquals(0, budget.trackedClientBuckets());
    }

    private static WeatherRequestBudget budget(AtomicLong ticker, int publicLimit,
                                                int maximumClients, String trustedProxies) {
        return new WeatherRequestBudget(ticker::get, publicLimit, maximumClients,
                1, 1, 1, trustedProxies);
    }

    private static HttpServletRequest request(String peer, String connectingIp) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(peer);
        when(request.getHeader("CF-Connecting-IP")).thenReturn(connectingIp);
        return request;
    }
}
