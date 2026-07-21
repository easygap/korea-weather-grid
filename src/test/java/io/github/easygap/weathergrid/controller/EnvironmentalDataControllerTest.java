package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.dto.AirQualityResponseDto;
import io.github.easygap.weathergrid.dto.CctvItemDto;
import io.github.easygap.weathergrid.dto.CctvResponseDto;
import io.github.easygap.weathergrid.dto.StationForecastResponseDto;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import io.github.easygap.weathergrid.service.CctvService;
import io.github.easygap.weathergrid.service.EnvironmentalDataService;
import io.github.easygap.weathergrid.service.EnvironmentalRateLimiter;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class EnvironmentalDataControllerTest {

    @Mock
    private EnvironmentalDataService environmentalDataService;
    @Mock
    private EnvironmentalRateLimiter environmentalRateLimiter;
    @Mock
    private CctvService cctvService;

    private MockMvc mockMvc;
    private String publishedDate;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(
                new EnvironmentalDataController(
                        environmentalDataService, environmentalRateLimiter, cctvService)).build();
        publishedDate = LocalDate.now(ZoneId.of("Asia/Seoul")).minusDays(1)
                .format(DateTimeFormatter.BASIC_ISO_DATE);
    }

    @Test
    void returnsForecastContractAndCachePolicy() throws Exception {
        when(environmentalDataService.getStationForecast(
                37.5665, 126.9780, publishedDate, "0200"))
                .thenReturn(new StationForecastResponseDto(
                        publishedDate, "0200", 37.5665, 126.9780,
                        "기상청 단기예보", List.of()));

        mockMvc.perform(get("/api/weather/point-forecast")
                        .param("latitude", "37.5665")
                        .param("longitude", "126.9780")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control",
                        "public, max-age=3600, stale-while-revalidate=300"))
                .andExpect(jsonPath("$.source").value("기상청 단기예보"))
                .andExpect(jsonPath("$.items").isArray());
    }

    @Test
    void rejectsNonFiniteCoordinateBeforeServiceCall() throws Exception {
        mockMvc.perform(get("/api/weather/point-forecast")
                        .param("latitude", "NaN")
                        .param("longitude", "126.9780")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(environmentalDataService);
    }

    @Test
    void rejectsZeroAreaBoundingBoxBeforeServiceCall() throws Exception {
        mockMvc.perform(get("/api/environment/air-quality")
                        .param("minLat", "37")
                        .param("maxLat", "37")
                        .param("minLon", "126")
                        .param("maxLon", "127"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(environmentalDataService);
    }

    @Test
    void rejectsDuplicateOrUnknownQueryParametersBeforeServiceCall() throws Exception {
        mockMvc.perform(get("/api/environment/air-quality")
                        .param("minLat", "32", "33")
                        .param("maxLat", "44")
                        .param("minLon", "122")
                        .param("maxLon", "134")
                        .param("cacheBust", "1"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(environmentalDataService);
    }

    @Test
    void staleAirSnapshotIsNeverCachedByClients() throws Exception {
        when(environmentalDataService.getAirQuality(32, 44, 122, 134))
                .thenReturn(new AirQualityResponseDto(
                        "2026-07-13 09:00", "2026-07-13 08:00",
                        true, "AirKorea", List.of()));

        mockMvc.perform(get("/api/environment/air-quality")
                        .param("minLat", "32")
                        .param("maxLat", "44")
                        .param("minLon", "122")
                        .param("maxLon", "134"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.dataTime").value("2026-07-13 09:00"))
                .andExpect(jsonPath("$.dataTimeFrom").value("2026-07-13 08:00"))
                .andExpect(jsonPath("$.stale").value(true));
    }

    @Test
    void returnsCctvContractWithNoStorePolicy() throws Exception {
        when(cctvService.getCctv(37.0, 37.2, 126.8, 127.0))
                .thenReturn(new CctvResponseDto(
                        "2026-07-13T00:00:00Z", false, false,
                        "국가교통정보센터(ITS)", List.of(new CctvItemDto(
                        "R|서울@37.1000000,126.9000000", "서울", 37.1, 126.9,
                        "https://cctvsec.ktict.co.kr/live/playlist.m3u8",
                        "HLS", "1280x720", "20260713090000", "R"))));

        mockMvc.perform(get("/api/traffic/cameras")
                        .param("minLat", "37.0")
                        .param("maxLat", "37.2")
                        .param("minLon", "126.8")
                        .param("maxLon", "127.0"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.fetchedAt").value("2026-07-13T00:00:00Z"))
                .andExpect(jsonPath("$.stale").value(false))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.source").value("국가교통정보센터(ITS)"))
                .andExpect(jsonPath("$.cctvs[0].name").value("서울"));
    }

    @Test
    void returnsCacheableWarningConnectionStateWithoutCallingUpstream() throws Exception {
        mockMvc.perform(get("/api/hazards/warnings"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control",
                        "public, max-age=60, stale-while-revalidate=60"))
                .andExpect(jsonPath("$.schema").value("bora.warnings/v1"))
                .andExpect(jsonPath("$.status").value("unavailable"))
                .andExpect(jsonPath("$.warnings").isArray());

        verifyNoInteractions(environmentalDataService, environmentalRateLimiter, cctvService);
    }

    @Test
    void rejectsWarningQueryParameters() throws Exception {
        mockMvc.perform(get("/api/hazards/warnings").param("cacheBust", "1"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsCctvUnknownDuplicateOrUpstreamParameters() throws Exception {
        mockMvc.perform(get("/api/traffic/cameras")
                        .param("minLat", "37.0", "37.1")
                        .param("maxLat", "37.2")
                        .param("minLon", "126.8")
                        .param("maxLon", "127.0")
                        .param("apiKey", "must-not-be-accepted")
                        .param("cctvType", "1"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(cctvService);
    }

    @Test
    void rejectsCctvAreasLargerThanTwentyFourTilesBeforeRateLimitOrService() throws Exception {
        mockMvc.perform(get("/api/traffic/cameras")
                        .param("minLat", "37.0")
                        .param("maxLat", "38.5")
                        .param("minLon", "126.0")
                        .param("maxLon", "127.25"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(environmentalRateLimiter, cctvService);
    }

    @Test
    void mapsCctvPublicBudgetToSharedRateLimitContract() throws Exception {
        doThrow(new RateLimitExceededException(19))
                .when(environmentalRateLimiter)
                .checkPublicRequest(any(), eq("traffic-cameras"));

        mockMvc.perform(get("/api/traffic/cameras")
                        .param("minLat", "37.0")
                        .param("maxLat", "37.2")
                        .param("minLon", "126.8")
                        .param("maxLon", "127.0"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "19"));

        verifyNoInteractions(cctvService);
    }

    @Test
    void mapsApprovalOrUpstreamFailureToServiceUnavailable() throws Exception {
        when(environmentalDataService.getAirQuality(32, 44, 122, 134))
                .thenThrow(new ExternalDataUnavailableException());

        mockMvc.perform(get("/api/environment/air-quality")
                        .param("minLat", "32")
                        .param("maxLat", "44")
                        .param("minLon", "122")
                        .param("maxLon", "134"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "60"));
    }

    @Test
    void mapsRequestBudgetToSharedRateLimitContract() throws Exception {
        doThrow(new RateLimitExceededException(37))
                .when(environmentalRateLimiter)
                .checkPublicRequest(any(), eq("weather-point-forecast"));

        mockMvc.perform(get("/api/weather/point-forecast")
                        .param("latitude", "37.5665")
                        .param("longitude", "126.9780")
                        .param("baseDate", publishedDate)
                        .param("baseTime", "0200")
                        .header("X-Forwarded-For", "198.51.100.77"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "37"))
                .andExpect(content().string("rate limit exceeded"));

        verifyNoInteractions(environmentalDataService);
    }
}
