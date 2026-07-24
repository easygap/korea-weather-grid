package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DfsWindGridSourceTest {

    private static final ForecastReleaseClock.Release RELEASE =
            new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 2);

    @Test
    void combinesReportedSpeedWithVectorFallbackAndEncodesMissingVectors() {
        GridDataRepository cache = mock(GridDataRepository.class);
        double[][] speed = WeatherGridTestData.dfs(2.6);
        double[][] east = WeatherGridTestData.dfs(1.2);
        double[][] north = WeatherGridTestData.dfs(-2.3);
        // First public row is DFS y=162. Exercise missing, derived, and calm values.
        east[161][4] = -999;
        speed[161][5] = 9999;
        speed[161][6] = 0;
        when(cache.readDfs("2026072102", "2026072103", "WSD", -999)).thenReturn(speed);
        when(cache.readDfs("2026072102", "2026072103", "UUU", -999)).thenReturn(east);
        when(cache.readDfs("2026072102", "2026072103", "VVV", -999)).thenReturn(north);

        WeatherGridDataset dataset = source(cache, false).load(RELEASE, 0);
        Map<String, Object> field = dataset.windField();
        int[] u = (int[]) field.get("u");
        int[] v = (int[]) field.get("v");

        assertFalse(dataset.demo());
        assertEquals(2.6, dataset.values()[0]);
        assertEquals(Math.hypot(1.2, -2.3), dataset.values()[1], 1e-12);
        assertEquals(0, dataset.values()[2]);
        assertEquals(-32768, u[0]);
        assertEquals(-32768, v[0]);
        assertEquals(12, u[1]);
        assertEquals(-23, v[1]);
        assertEquals("weather-grid.wind-field/v1", field.get("schema"));
        assertEquals(0, field.get("requestedForecastHour"));
        assertEquals(1, field.get("forecastHour"));
        assertEquals("2026-07-21T03:00:00+09:00", field.get("validTime"));
        Map<?, ?> grid = (Map<?, ?>) field.get("grid");
        assertEquals("north-to-south", grid.get("rowOrder"));
        assertEquals(145, grid.get("nx"));
        assertEquals(162, grid.get("ny"));
    }

    @Test
    void rejectsAnUnavailableProductOutsideDemoMode() {
        GridDataRepository cache = mock(GridDataRepository.class);

        UpstreamUnavailableException error = assertThrows(
                UpstreamUnavailableException.class,
                () -> source(cache, false).load(RELEASE, 3));

        assertEquals("wind grid unavailable", error.getMessage());
        verify(cache).readDfs("2026072102", "2026072105", "WSD", -999);
        verify(cache).readDfs("2026072102", "2026072105", "UUU", -999);
        verify(cache).readDfs("2026072102", "2026072105", "VVV", -999);
    }

    @Test
    void demoModeProducesFiniteDeterministicWind() {
        WeatherGridDataset dataset = source(mock(GridDataRepository.class), true).load(RELEASE, 4);

        assertTrue(dataset.demo());
        assertEquals(145 * 162, dataset.values().length);
        assertTrue(List.of(dataset.values()[0], dataset.values()[100], dataset.values()[1000])
                .stream().allMatch(value -> Double.isFinite(value) && value >= 0));
    }

    private static DfsWindGridSource source(GridDataRepository cache, boolean demoMode) {
        return new DfsWindGridSource(
                cache, new WeatherGridWindow(1), new WeatherRuntimeOptions(demoMode));
    }
}
