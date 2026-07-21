package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import io.github.easygap.weathergrid.exception.WeatherDataUnavailableException;
import io.github.easygap.weathergrid.service.EnvironmentalRateLimiter;
import io.github.easygap.weathergrid.service.MapService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class MapControllerTest {

    @Mock
    private MapService mapService;
    @Mock
    private EnvironmentalRateLimiter environmentalRateLimiter;

    private MockMvc mockMvc;
    private String publishedDate;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(
                new MapController(mapService, environmentalRateLimiter)).build();
        publishedDate = LocalDate.now(ZoneId.of("Asia/Seoul")).minusDays(1)
                .format(DateTimeFormatter.BASIC_ISO_DATE);
    }

    @Test
    void rejectsLeadHoursAboveGridContractRange() throws Exception {
        mockMvc.perform(get("/api/weather/grid")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "wdws")
                        .param("leadHours", "49"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(mapService);
        verifyNoInteractions(environmentalRateLimiter);
    }

    @Test
    void rejectsUnknownWindHeightBeforeServiceCall() throws Exception {
        mockMvc.perform(get("/api/weather/grid")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "wdws")
                        .param("height", "100m"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(mapService);
    }

    @Test
    void removedStreamlineEndpointIsNotRoutable() throws Exception {
        mockMvc.perform(post("/api/unsupported/streamline"))
                .andExpect(status().isNotFound());

        verifyNoInteractions(mapService);
    }

    @Test
    void mapsWeatherFailureToServiceUnavailable() throws Exception {
        when(mapService.getGridData(publishedDate, "0200", "wdws", 0))
                .thenThrow(new WeatherDataUnavailableException("upstream unavailable"));

        mockMvc.perform(get("/api/weather/grid")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "wdws"))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void statisticsEndpointUsesStatsOnlyServicePath() throws Exception {
        when(mapService.getDataStats(publishedDate, "0200", "wdws", 0))
                .thenReturn(Map.of("stats", Map.of("min", 1)));

        mockMvc.perform(get("/api/weather/grid/stats")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "wdws"))
                .andExpect(status().isOk());

        verify(mapService).getDataStats(publishedDate, "0200", "wdws", 0);
        verify(mapService, never()).getGridData(anyString(), anyString(), anyString(), anyInt());
        verify(environmentalRateLimiter).checkPublicRequest(any(), eq("weather-grid"));
    }

    @Test
    void gridAndStatisticsEndpointsShareThePublicRequestBucket() throws Exception {
        when(mapService.getGridData(publishedDate, "0200", "wdws", 0))
                .thenReturn(Map.of("data", List.of()));
        when(mapService.getDataStats(publishedDate, "0200", "wdws", 0))
                .thenReturn(Map.of("stats", Map.of("min", 0)));

        for (String endpoint : List.of("/api/weather/grid", "/api/weather/grid/stats")) {
            mockMvc.perform(get(endpoint)
                            .param("baseDate", publishedDate)
                            .param("baseTime", "0200")
                            .param("element", "wdws"))
                    .andExpect(status().isOk());
        }

        verify(environmentalRateLimiter, times(2))
                .checkPublicRequest(any(), eq("weather-grid"));
    }

    @Test
    void mapsGridPublicBudgetToSharedRateLimitContractBeforeServiceCall() throws Exception {
        doThrow(new RateLimitExceededException(23))
                .when(environmentalRateLimiter)
                .checkPublicRequest(any(), eq("weather-grid"));

        for (String endpoint : List.of("/api/weather/grid", "/api/weather/grid/stats")) {
            mockMvc.perform(get(endpoint)
                            .param("baseDate", publishedDate)
                            .param("baseTime", "0200")
                            .param("element", "wdws"))
                    .andExpect(status().isTooManyRequests())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(header().string("Retry-After", "23"))
                    .andExpect(content().string("rate limit exceeded"));
        }

        verifyNoInteractions(mapService);
    }

    @Test
    void acceptsPrecipitationForGridAndStatisticsEndpoints() throws Exception {
        when(mapService.getGridData(publishedDate, "0200", "pcp", 1))
                .thenReturn(Map.of("unit", "mm"));
        when(mapService.getDataStats(publishedDate, "0200", "pcp", 1))
                .thenReturn(Map.of("stats", Map.of("min", 0)));

        mockMvc.perform(get("/api/weather/grid")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "pcp")
                        .param("leadHours", "1"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/weather/grid/stats")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "pcp")
                        .param("leadHours", "1"))
                .andExpect(status().isOk());

        verify(mapService).getGridData(publishedDate, "0200", "pcp", 1);
        verify(mapService).getDataStats(publishedDate, "0200", "pcp", 1);
    }

    @Test
    void acceptsAdditionalForecastElementsForGridAndStatisticsEndpoints() throws Exception {
        for (String element : List.of("sno", "pty", "reh", "sky", "wav")) {
            when(mapService.getGridData(publishedDate, "0200", element, 1))
                    .thenReturn(Map.of("element", element));
            when(mapService.getDataStats(publishedDate, "0200", element, 1))
                    .thenReturn(Map.of("stats", Map.of("count", 1)));

            mockMvc.perform(get("/api/weather/grid")
                            .param("baseDate", publishedDate)
                            .param("baseTime", "0200")
                            .param("element", element)
                            .param("leadHours", "1"))
                    .andExpect(status().isOk());
            mockMvc.perform(get("/api/weather/grid/stats")
                            .param("baseDate", publishedDate)
                            .param("baseTime", "0200")
                            .param("element", element)
                            .param("leadHours", "1"))
                    .andExpect(status().isOk());

            verify(mapService).getGridData(publishedDate, "0200", element, 1);
            verify(mapService).getDataStats(publishedDate, "0200", element, 1);
        }
    }

    @Test
    void rejectsUltraShortRainProductAndRoutesPointPrecipitationToStructuredForecast() throws Exception {
        mockMvc.perform(get("/api/weather/grid")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "rn1"))
                .andExpect(status().isBadRequest());

        Map<String, String> forecastBacked = Map.of(
                "pcp", "강수량", "sno", "신적설", "pty", "강수형태",
                "reh", "상대습도", "sky", "하늘상태", "wav", "파고");
        for (Map.Entry<String, String> entry : forecastBacked.entrySet()) {
            mockMvc.perform(get("/api/weather/timeseries")
                            .param("latitude", "37.5")
                            .param("longitude", "127.0")
                            .param("baseDate", publishedDate)
                            .param("baseTime", "0200")
                            .param("element", entry.getKey()))
                    .andExpect(status().isBadRequest())
                    .andExpect(result -> assertEquals(
                            entry.getValue() + " 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.",
                            result.getResolvedException().getMessage()));
        }

        verifyNoInteractions(mapService);
    }

    @Test
    void lonlatUsesTheForecastGridInsteadOfABoundingBox() throws Exception {
        mockMvc.perform(get("/api/weather/coverage")
                        .param("latitude", "37.5")
                        .param("longitude", "127.0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inside").value(true));

        // 입력 허용 범위에는 들지만 DFS 표출 격자의 북쪽 밖이다.
        mockMvc.perform(get("/api/weather/coverage")
                        .param("latitude", "40.0")
                        .param("longitude", "127.0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inside").value(false));

        verifyNoInteractions(mapService);
    }

    @Test
    void rejectsUnsupportedStationSeriesHeightOutsideForecastGrid() throws Exception {
        mockMvc.perform(get("/api/weather/timeseries")
                        .param("latitude", "40.0")
                        .param("longitude", "127.0")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "wdws")
                        .param("height", "unsupported"))
                .andExpect(status().isBadRequest())
                .andExpect(result -> assertEquals("잘못된 height",
                        result.getResolvedException().getMessage()));

        verifyNoInteractions(mapService);
    }

    @Test
    void rejectsUnsupportedStationSeriesHeightInsideForecastGrid() throws Exception {
        double latitude = 39.008217648247744;
        double longitude = 132.3171196829101;

        mockMvc.perform(get("/api/weather/timeseries")
                        .param("latitude", Double.toString(latitude))
                        .param("longitude", Double.toString(longitude))
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .param("element", "wdws")
                        .param("height", "unsupported"))
                .andExpect(status().isBadRequest())
                .andExpect(result -> assertEquals("잘못된 height",
                        result.getResolvedException().getMessage()));

        verifyNoInteractions(mapService);
    }
}
