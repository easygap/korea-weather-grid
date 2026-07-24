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
import java.util.Map;

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
class WeatherGridControllerTest {

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
        WeatherGridController controller = new WeatherGridController(
                maps, rateLimiter, new WeatherMapRequestPolicy(publicPolicy));
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new WeatherMapExceptionHandler())
                .build();
    }

    @Test
    void gridAndStatisticsUseSeparateServicePathsAndOneBudgetBucket() throws Exception {
        when(maps.getGridData(RELEASE_DATE, "0200", "pcp", 1))
                .thenReturn(Map.of("data", List.of(0.0), "unit", "mm"));
        when(maps.getDataStats(RELEASE_DATE, "0200", "pcp", 1))
                .thenReturn(Map.of("stats", Map.of("min", 0)));

        mvc.perform(request("/api/weather/grid", "pcp", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unit").value("mm"));
        mvc.perform(request("/api/weather/grid/stats", "pcp", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stats.min").value(0));

        verify(maps).getGridData(RELEASE_DATE, "0200", "pcp", 1);
        verify(maps).getDataStats(RELEASE_DATE, "0200", "pcp", 1);
        verify(rateLimiter, org.mockito.Mockito.times(2))
                .claimPublic(any(), eq(WeatherRequestBudget.PublicRoute.WEATHER_GRID));
    }

    @Test
    void rejectsUnknownDuplicateHeightAndLeadInputsBeforeTheBudget() throws Exception {
        mvc.perform(request("/api/weather/grid", "rn1", "1"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 element"));
        mvc.perform(get("/api/weather/grid")
                        .param("baseDate", RELEASE_DATE)
                        .param("baseTime", "0200")
                        .param("element", "wdws")
                        .param("height", "100m"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 height"));
        mvc.perform(request("/api/weather/grid", "wdws", "49"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 leadHours"));
        mvc.perform(get("/api/weather/grid")
                        .param("baseDate", RELEASE_DATE)
                        .param("baseTime", "0200", "0500")
                        .param("element", "wdws")
                        .param("serviceKey", "not-accepted"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 쿼리 파라미터"));

        verifyNoInteractions(maps, rateLimiter);
    }

    @Test
    void mapsBindingUpstreamAndRateLimitFailuresToStableTextResponses() throws Exception {
        mvc.perform(get("/api/weather/grid")
                        .param("baseDate", RELEASE_DATE)
                        .param("baseTime", "0200")
                        .param("element", "wdws")
                        .param("leadHours", "not-a-number"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 요청"));

        when(maps.getGridData(RELEASE_DATE, "0200", "wdws", 0))
                .thenThrow(new UpstreamUnavailableException("upstream detail"));
        mvc.perform(request("/api/weather/grid", "wdws", "0"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(content().string("weather data temporarily unavailable"));

        doThrow(new RequestThrottledException(23)).when(rateLimiter)
                .claimPublic(any(), eq(WeatherRequestBudget.PublicRoute.WEATHER_GRID));
        mvc.perform(request("/api/weather/grid/stats", "tmp", "0"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "23"))
                .andExpect(content().string("rate limit exceeded"));
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
    request(String path, String element, String leadHours) {
        return get(path)
                .param("baseDate", RELEASE_DATE)
                .param("baseTime", "0200")
                .param("element", element)
                .param("height", "10m")
                .param("leadHours", leadHours);
    }
}
