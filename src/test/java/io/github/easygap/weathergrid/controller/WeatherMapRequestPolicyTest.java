package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RequestRejectedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WeatherMapRequestPolicyTest {

    private WeatherMapRequestPolicy policy;

    @BeforeEach
    void setUp() {
        PublicRequestPolicy publicPolicy = new PublicRequestPolicy(Clock.fixed(
                Instant.parse("2026-07-22T03:00:00Z"), ZoneId.of("Asia/Seoul")));
        policy = new WeatherMapRequestPolicy(publicPolicy);
    }

    @Test
    void acceptsEveryDocumentedGridElementAndOptionalDefaults() {
        for (String element : List.of(
                "wdws", "tmp", "pcp", "sno", "pty", "reh", "sky", "wav", "swdn")) {
            MockHttpServletRequest request = gridRequest(element, false);
            WeatherMapRequestPolicy.GridQuery query = policy.requireGrid(
                    request, "20260721", "0200", element, "10m", 0);
            assertEquals(element, query.element());
        }
    }

    @Test
    void rejectsUnknownOrDuplicateGridQueryEvenWhenBoundArgumentsLookValid() {
        MockHttpServletRequest unknown = gridRequest("wdws", false);
        unknown.addParameter("authKey", "not-accepted");
        assertThrows(RequestRejectedException.class, () -> policy.requireGrid(
                unknown, "20260721", "0200", "wdws", "10m", 0));

        MockHttpServletRequest duplicate = gridRequest("wdws", false);
        duplicate.addParameter("baseTime", "0500");
        assertThrows(RequestRejectedException.class, () -> policy.requireGrid(
                duplicate, "20260721", "0200", "wdws", "10m", 0));
    }

    @Test
    void stationSeriesAllowsOnlyFieldsNotOwnedByTheDetailedForecastEndpoint() {
        for (String element : List.of("wdws", "tmp", "swdn")) {
            MockHttpServletRequest request = seriesRequest(element);
            assertDoesNotThrow(() -> policy.requireStationSeries(
                    request, 37.5, 127, "20260721", "0200", element, "10m"));
        }

        for (String element : List.of("pcp", "sno", "pty", "reh", "sky", "wav")) {
            MockHttpServletRequest request = seriesRequest(element);
            RequestRejectedException failure = assertThrows(RequestRejectedException.class,
                    () -> policy.requireStationSeries(
                            request, 37.5, 127, "20260721", "0200", element, "10m"));
            org.junit.jupiter.api.Assertions.assertTrue(
                    failure.getMessage().contains("/api/weather/point-forecast"));
        }
    }

    private static MockHttpServletRequest gridRequest(String element, boolean includeOptional) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addParameter("baseDate", "20260721");
        request.addParameter("baseTime", "0200");
        request.addParameter("element", element);
        if (includeOptional) {
            request.addParameter("height", "10m");
            request.addParameter("leadHours", "0");
        }
        return request;
    }

    private static MockHttpServletRequest seriesRequest(String element) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addParameter("latitude", "37.5");
        request.addParameter("longitude", "127");
        request.addParameter("baseDate", "20260721");
        request.addParameter("baseTime", "0200");
        request.addParameter("element", element);
        request.addParameter("height", "10m");
        return request;
    }
}
