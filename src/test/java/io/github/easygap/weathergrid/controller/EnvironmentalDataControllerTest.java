package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.dto.AirQualityReport;
import io.github.easygap.weathergrid.dto.PointForecastReport;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.exception.RequestThrottledException;
import io.github.easygap.weathergrid.service.EnvironmentalDataService;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
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
class EnvironmentalDataControllerTest {

    private static final String RELEASE_DATE = "20260721";

    @Mock
    private EnvironmentalDataService data;
    @Mock
    private WeatherRequestBudget rateLimiter;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(Instant.parse("2026-07-22T03:00:00Z"),
                ZoneId.of("Asia/Seoul"));
        EnvironmentalDataController controller = new EnvironmentalDataController(
                data, rateLimiter, new PublicRequestPolicy(clock));
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new PublicApiExceptionHandler())
                .build();
    }

    @Test
    void returnsThePointForecastContractWithItsCachePolicy() throws Exception {
        when(data.getStationForecast(37.5665, 126.978, RELEASE_DATE, "0200"))
                .thenReturn(new PointForecastReport(
                        RELEASE_DATE, "0200", 37.5665, 126.978,
                        "기상청 단기예보", List.of()));

        mvc.perform(pointForecast())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control",
                        "public, max-age=3600, stale-while-revalidate=300"))
                .andExpect(jsonPath("$.baseDate").value(RELEASE_DATE))
                .andExpect(jsonPath("$.source").value("기상청 단기예보"))
                .andExpect(jsonPath("$.items").isArray());

        verify(rateLimiter).claimPublic(any(),
                eq(WeatherRequestBudget.PublicRoute.POINT_FORECAST));
        verify(data).getStationForecast(37.5665, 126.978, RELEASE_DATE, "0200");
    }

    @Test
    void changesTheAirQualityCachePolicyWhenTheSnapshotIsStale() throws Exception {
        when(data.getAirQuality(32, 44, 122, 134))
                .thenReturn(new AirQualityReport(
                        "2026-07-22 11:00", "2026-07-22 10:00",
                        false, "AirKorea", List.of()))
                .thenReturn(new AirQualityReport(
                        "2026-07-22 11:00", "2026-07-22 10:00",
                        true, "AirKorea", List.of()));

        mvc.perform(airQuality())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control",
                        "public, max-age=300, stale-while-revalidate=300, stale-if-error=3600"))
                .andExpect(jsonPath("$.stale").value(false));
        mvc.perform(airQuality())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.stale").value(true));
    }

    @Test
    void rejectsNonFiniteDuplicateAndUnknownInputBeforeBudgetsOrServices() throws Exception {
        mvc.perform(get("/api/weather/point-forecast")
                        .param("latitude", "NaN")
                        .param("longitude", "126.978")
                        .param("baseDate", RELEASE_DATE)
                        .param("baseTime", "0200"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("위도 범위 밖"));

        mvc.perform(get("/api/environment/air-quality")
                        .param("minLat", "32", "33")
                        .param("maxLat", "44")
                        .param("minLon", "122")
                        .param("maxLon", "134")
                        .param("serviceKey", "not-accepted"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 쿼리 파라미터"));

        verifyNoInteractions(data, rateLimiter);
    }

    @Test
    void mapsMissingAndWronglyTypedParametersToTheBindingContract() throws Exception {
        mvc.perform(get("/api/weather/point-forecast")
                        .param("latitude", "37.5")
                        .param("longitude", "not-a-number")
                        .param("baseDate", RELEASE_DATE))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 요청"));
        verifyNoInteractions(data, rateLimiter);
    }

    @Test
    void mapsUpstreamFailureAndPublicBudgetWithoutCallingPastTheBoundary() throws Exception {
        when(data.getAirQuality(32, 44, 122, 134))
                .thenThrow(new UpstreamUnavailableException());
        mvc.perform(airQuality())
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "60"))
                .andExpect(content().string("data temporarily unavailable"));

        doThrow(new RequestThrottledException(37)).when(rateLimiter)
                .claimPublic(any(), eq(WeatherRequestBudget.PublicRoute.POINT_FORECAST));
        mvc.perform(pointForecast())
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "37"))
                .andExpect(content().string("rate limit exceeded"));
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
    pointForecast() {
        return get("/api/weather/point-forecast")
                .param("latitude", "37.5665")
                .param("longitude", "126.978")
                .param("baseDate", RELEASE_DATE)
                .param("baseTime", "0200");
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
    airQuality() {
        return get("/api/environment/air-quality")
                .param("minLat", "32")
                .param("maxLat", "44")
                .param("minLon", "122")
                .param("maxLon", "134");
    }
}
