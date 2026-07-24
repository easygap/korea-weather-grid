package io.github.easygap.weathergrid.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class HazardStatusControllerTest {

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(
                        new HazardStatusController(new PublicRequestPolicy()))
                .setControllerAdvice(new PublicApiExceptionHandler())
                .build();
    }

    @Test
    void reportsASeparateCacheableConnectionState() throws Exception {
        mvc.perform(get("/api/hazards/warnings"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control",
                        "public, max-age=60, stale-while-revalidate=60"))
                .andExpect(jsonPath("$.schema").value("bora.warnings/v1"))
                .andExpect(jsonPath("$.source").value("기상청 기상특보"))
                .andExpect(jsonPath("$.status").value("unavailable"))
                .andExpect(jsonPath("$.warnings").isEmpty());
    }

    @Test
    void rejectsEveryWarningQueryParameter() throws Exception {
        mvc.perform(get("/api/hazards/warnings").param("cacheBust", "1"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("잘못된 쿼리 파라미터"));
    }
}
