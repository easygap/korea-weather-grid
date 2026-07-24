package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.dto.TrafficCameraView;
import io.github.easygap.weathergrid.dto.TrafficCameraReport;
import io.github.easygap.weathergrid.exception.RequestThrottledException;
import io.github.easygap.weathergrid.service.CctvService;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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
class TrafficCameraControllerTest {

    @Mock
    private CctvService cameras;
    @Mock
    private WeatherRequestBudget rateLimiter;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        TrafficCameraController controller = new TrafficCameraController(
                cameras, rateLimiter, new PublicRequestPolicy());
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new PublicApiExceptionHandler())
                .build();
    }

    @Test
    void returnsTheStableNoStoreCameraContract() throws Exception {
        when(cameras.getCctv(37.0, 37.2, 126.8, 127.0))
                .thenReturn(new TrafficCameraReport(
                        "2026-07-22T00:00:00Z", false, false,
                        "국가교통정보센터(ITS)", List.of(new TrafficCameraView(
                        "R|서울@37.1000000,126.9000000", "서울", 37.1, 126.9,
                        "https://cctvsec.ktict.co.kr/live/playlist.m3u8",
                        "HLS", "1280x720", "20260722090000", "R"))));

        mvc.perform(validRequest())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.source").value("국가교통정보센터(ITS)"))
                .andExpect(jsonPath("$.cctvs[0].name").value("서울"));

        verify(rateLimiter).claimPublic(any(),
                eq(WeatherRequestBudget.PublicRoute.TRAFFIC_CAMERAS));
        verify(cameras).getCctv(37.0, 37.2, 126.8, 127.0);
    }

    @Test
    void rejectsUnknownDuplicateAndOversizedViewportsBeforeTheBudget() throws Exception {
        mvc.perform(get("/api/traffic/cameras")
                        .param("minLat", "37.0", "37.1")
                        .param("maxLat", "37.2")
                        .param("minLon", "126.8")
                        .param("maxLon", "127.0")
                        .param("apiKey", "not-accepted"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 쿼리 파라미터"));

        mvc.perform(get("/api/traffic/cameras")
                        .param("minLat", "37.0")
                        .param("maxLat", "38.5")
                        .param("minLon", "126.0")
                        .param("maxLon", "127.25"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("CCTV 조회 영역이 너무 큼"));

        verifyNoInteractions(rateLimiter, cameras);
    }

    @Test
    void mapsTheSharedPublicBudgetBeforeCameraLookup() throws Exception {
        doThrow(new RequestThrottledException(19)).when(rateLimiter)
                .claimPublic(any(), eq(WeatherRequestBudget.PublicRoute.TRAFFIC_CAMERAS));

        mvc.perform(validRequest())
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Retry-After", "19"))
                .andExpect(content().string("rate limit exceeded"));

        verifyNoInteractions(cameras);
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
    validRequest() {
        return get("/api/traffic/cameras")
                .param("minLat", "37.0")
                .param("maxLat", "37.2")
                .param("minLon", "126.8")
                .param("maxLon", "127.0");
    }
}
