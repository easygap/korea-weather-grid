package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.config.MapProviderProperties;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MapRuntimeConfigControllerTest {

    @Test
    void returnsTheSameOriginProxyWithoutExposingTheConfiguredKey() throws Exception {
        String key = "12345678-1234-1234-1234-123456789abc";
        MockMvc mvc = mvc(new MapProviderProperties(key));

        mvc.perform(get("/api/runtime/map-config"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.vworldEnabled").value(true))
                .andExpect(jsonPath("$.vworldTileBase").value("/api/map/vworld"))
                .andExpect(jsonPath("$.vworldApiKey").doesNotExist());
    }

    @Test
    void returnsAnExplicitDisabledContractWhenNoKeyIsConfigured() throws Exception {
        MockMvc mvc = mvc(new MapProviderProperties(""));

        mvc.perform(get("/api/runtime/map-config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.vworldEnabled").value(false))
                .andExpect(jsonPath("$.vworldTileBase").value(""))
                .andExpect(jsonPath("$.vworldApiKey").doesNotExist());
    }

    @Test
    void rejectsUnexpectedQueryParameters() throws Exception {
        MockMvc mvc = mvc(new MapProviderProperties(""));

        mvc.perform(get("/api/runtime/map-config?callback=attacker"))
                .andExpect(status().isBadRequest())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().contentTypeCompatibleWith("application/json"));
    }

    private static MockMvc mvc(MapProviderProperties properties) {
        return MockMvcBuilders.standaloneSetup(new MapRuntimeConfigController(properties)).build();
    }
}
