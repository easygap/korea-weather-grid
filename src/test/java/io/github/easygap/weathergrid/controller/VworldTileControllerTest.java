package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.integration.VworldTileGateway;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static io.github.easygap.weathergrid.integration.VworldTileGateway.TileKind.BASE;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class VworldTileControllerTest {

    @Mock
    private VworldTileGateway tiles;
    @Mock
    private WeatherRequestBudget rateLimiter;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        VworldTileController controller = new VworldTileController(
                tiles, rateLimiter, new PublicRequestPolicy());
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new PublicApiExceptionHandler())
                .build();
    }

    @Test
    void returnsAValidatedCacheableSameOriginTile() throws Exception {
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47};
        VworldTileGateway.TileRequest request =
                new VworldTileGateway.TileRequest(BASE, 7, 109, 49);
        when(tiles.fetch(request))
                .thenReturn(new VworldTileGateway.TileBody(png, MediaType.IMAGE_PNG));

        mvc.perform(get("/api/map/vworld/base/7/109/49.png"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(content().bytes(png))
                .andExpect(header().string("Cache-Control",
                        "max-age=86400, public, stale-while-revalidate=604800"));

        verify(rateLimiter).claimPublic(any(),
                eq(WeatherRequestBudget.PublicRoute.VWORLD_TILES));
        verify(tiles).fetch(request);
    }

    @Test
    void rejectsUnknownQueriesKindsExtensionsAndOutOfAreaTilesBeforeNetworkUse()
            throws Exception {
        mvc.perform(get("/api/map/vworld/base/7/109/49.png?key=attacker"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/map/vworld/custom/7/109/49.png"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/map/vworld/base/7/109/49.pbf"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/map/vworld/base/7/1/1.png"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(rateLimiter, tiles);
    }

    @Test
    void sanitizesProviderFailures() throws Exception {
        when(tiles.fetch(any())).thenThrow(new UpstreamUnavailableException("secret URI"));

        mvc.perform(get("/api/map/vworld/base/7/109/49.png"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().string("data temporarily unavailable"));
    }
}
