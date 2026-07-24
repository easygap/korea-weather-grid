package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RequestThrottledException;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import io.github.easygap.weathergrid.service.MapService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class WeatherLocationControllerTest {

    private static final String RELEASE_DATE = "20260721";

    @Mock
    private MapService maps;
    @Mock
    private WeatherRequestBudget rateLimiter;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        PublicRequestPolicy publicPolicy = new PublicRequestPolicy(Clock.fixed(
                Instant.parse("2026-07-22T03:00:00Z"), ZoneId.of("Asia/Seoul")));
        WeatherLocationController controller = new WeatherLocationController(
                maps, rateLimiter, new WeatherMapRequestPolicy(publicPolicy));
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new WeatherMapExceptionHandler())
                .build();
    }

    @Test
    void coverageUsesTheForecastCellWindowWithoutAnUpstreamCall() throws Exception {
        mvc.perform(get("/api/weather/coverage")
                        .param("latitude", "37.5")
                        .param("longitude", "127"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inside").value(true));
        mvc.perform(get("/api/weather/coverage")
                        .param("latitude", "40")
                        .param("longitude", "127"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inside").value(false));
        verifyNoInteractions(maps, rateLimiter);
    }

    @Test
    void stationSeriesUsesItsOwnBudgetAndFiveMinuteClientCache() throws Exception {
        when(maps.getStationData(37.5, 127, RELEASE_DATE, "0200", "wdws"))
                .thenReturn(List.of(new double[]{2.5, 270}));

        mvc.perform(series("wdws", "10m"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "public, max-age=300"))
                .andExpect(jsonPath("$[0][0]").value(2.5))
                .andExpect(jsonPath("$[0][1]").value(270));

        verify(rateLimiter).claimPublic(any(),
                eq(WeatherRequestBudget.PublicRoute.WEATHER_TIMESERIES));
        verify(maps).getStationData(37.5, 127, RELEASE_DATE, "0200", "wdws");
    }

    @Test
    void routesDetailedForecastElementsAndInvalidQueriesBeforeTheBudget() throws Exception {
        mvc.perform(series("pcp", "10m"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string(
                        "강수량 지점 시계열은 /api/weather/point-forecast를 사용해 주세요."));
        mvc.perform(series("wdws", "100m"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 height"));
        mvc.perform(get("/api/weather/coverage")
                        .param("latitude", "37.5")
                        .param("longitude", "127")
                        .param("cacheBust", "1"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 쿼리 파라미터"));

        verifyNoInteractions(maps, rateLimiter);
    }

    @Test
    void mapsSeriesRateLimitAndUnavailableResponsesWithoutLeakingDetails() throws Exception {
        doThrow(new RequestThrottledException(17)).when(rateLimiter)
                .claimPublic(any(), eq(WeatherRequestBudget.PublicRoute.WEATHER_TIMESERIES));
        mvc.perform(series("tmp", "10m"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "17"))
                .andExpect(content().string("rate limit exceeded"));
        verifyNoInteractions(maps);

        org.mockito.Mockito.reset(rateLimiter);
        when(maps.getStationData(37.5, 127, RELEASE_DATE, "0200", "tmp"))
                .thenThrow(new UpstreamUnavailableException("internal detail"));
        mvc.perform(series("tmp", "10m"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(content().string("weather data temporarily unavailable"));
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
    series(String element, String height) {
        return get("/api/weather/timeseries")
                .param("latitude", "37.5")
                .param("longitude", "127")
                .param("baseDate", RELEASE_DATE)
                .param("baseTime", "0200")
                .param("element", element)
                .param("height", height);
    }
}
