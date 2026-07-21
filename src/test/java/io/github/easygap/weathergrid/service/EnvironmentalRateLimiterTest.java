package io.github.easygap.weathergrid.service;

import jakarta.servlet.http.HttpServletRequest;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EnvironmentalRateLimiterTest {

    private static final Clock CLOCK = Clock.fixed(
            Instant.parse("2026-07-13T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void ignoresForwardedHeadersFromAnUntrustedPeer() {
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                CLOCK, 1, 10, 1, 1, "");
        HttpServletRequest first = request("203.0.113.10", "198.51.100.1", "192.0.2.1");
        HttpServletRequest spoofed = request("203.0.113.10", "198.51.100.2", "192.0.2.2");

        limiter.checkPublicRequest(first, "weather-point-forecast");
        RateLimitExceededException error = assertThrows(RateLimitExceededException.class,
                () -> limiter.checkPublicRequest(spoofed, "weather-point-forecast"));

        assertEquals(60, error.retryAfterSeconds());
    }

    @Test
    void acceptsCloudflareClientIpOnlyFromAnExplicitlyTrustedProxy() {
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                CLOCK, 1, 10, 1, 1, "10.0.0.0/8");
        HttpServletRequest first = request("10.1.2.3", "198.51.100.1", "192.0.2.1");
        HttpServletRequest second = request("10.1.2.3", "198.51.100.2", "192.0.2.1");

        limiter.checkPublicRequest(first, "environment-air-quality");
        assertDoesNotThrow(() -> limiter.checkPublicRequest(second, "environment-air-quality"));
        assertThrows(RateLimitExceededException.class,
                () -> limiter.checkPublicRequest(first, "environment-air-quality"));
    }

    @Test
    void publicClientMapRemainsBounded() {
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                CLOCK, 100, 2, 1, 1, "");

        limiter.checkPublicRequest(request("192.0.2.1", null, null), "weather-point-forecast");
        limiter.checkPublicRequest(request("192.0.2.2", null, null), "weather-point-forecast");
        limiter.checkPublicRequest(request("192.0.2.3", null, null), "weather-point-forecast");

        assertEquals(2, limiter.trackedPublicClients());
    }

    @Test
    void gridAndStatisticsRequestsShareOnePublicClientBucket() {
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                CLOCK, 1, 10, 1, 1, "");
        HttpServletRequest grid = request("192.0.2.20", null, null);
        HttpServletRequest statistics = request("192.0.2.20", null, null);

        limiter.checkPublicRequest(grid, "weather-grid");
        RateLimitExceededException error = assertThrows(RateLimitExceededException.class,
                () -> limiter.checkPublicRequest(statistics, "weather-grid"));

        assertEquals(60, error.retryAfterSeconds());
    }

    @Test
    void forecastRefreshBudgetIsBoundedAndReturnsWindowRetry() {
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                CLOCK, 100, 10, 1, 1, "");

        limiter.acquireForecastRefresh();
        RateLimitExceededException error = assertThrows(RateLimitExceededException.class,
                limiter::acquireForecastRefresh);

        assertEquals(60, error.retryAfterSeconds());
    }

    @Test
    void cctvRefreshBudgetIsGlobalAndBoundedPerMinute() {
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                CLOCK, 100, 10, 10, 2, 1, "");

        limiter.acquireCctvRefresh();
        RateLimitExceededException error = assertThrows(RateLimitExceededException.class,
                limiter::acquireCctvRefresh);

        assertEquals(60, error.retryAfterSeconds());
    }

    private static HttpServletRequest request(String remoteAddress, String connectingIp,
                                              String forwardedFor) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(remoteAddress);
        when(request.getHeader("CF-Connecting-IP")).thenReturn(connectingIp);
        when(request.getHeader("X-Forwarded-For")).thenReturn(forwardedFor);
        return request;
    }
}
