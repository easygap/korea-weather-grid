package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.service.MapService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.model;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

class MapPageControllerTest {

    @Test
    void rendersTheShellWithLatestReleaseMetadata() throws Exception {
        MapService maps = mock(MapService.class);
        when(maps.getLatestInfo()).thenReturn(Map.of(
                "fileName", "202607210200",
                "baseDate", "20260721",
                "baseTime", "0200"));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new MapPageController(maps)).build();

        mvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(view().name("weather-grid"))
                .andExpect(model().attribute("fileName", "202607210200"))
                .andExpect(model().attribute("baseDate", "20260721"))
                .andExpect(model().attribute("baseTime", "0200"));
        verify(maps).getLatestInfo();
    }
}
