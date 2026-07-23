package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.util.KimGridGeometry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class KimSolarGridSourceTest {

    private static final ForecastReleaseClock.Release RELEASE =
            new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 2);

    @Test
    void hourlyGridPublishesModelTimesAndClampsNighttimeNoise() {
        GridDataRepository cache = mock(GridDataRepository.class);
        double[][] grid = WeatherGridTestData.kim(-0.03);
        for (int row = 0; row < grid.length; row++) {
            for (int column = row % 2; column < grid[row].length; column += 2) {
                grid[row][column] = KimGridGeometry.NO_DATA;
            }
        }
        when(cache.readKimSolar("2026072012", 7)).thenReturn(grid);

        WeatherGridDataset dataset = source(cache, false).loadGrid(RELEASE, 2);

        assertFalse(dataset.demo());
        assertTrue(java.util.Arrays.stream(dataset.values())
                .allMatch(value -> value == KimGridGeometry.NO_DATA || value == 0));
        assertTrue(java.util.Arrays.stream(dataset.values())
                .anyMatch(value -> value == KimGridGeometry.NO_DATA));
        assertTrue(java.util.Arrays.stream(dataset.values()).anyMatch(value -> value == 0));
        assertEquals("2026-07-21T04:00:00+09:00", dataset.metadata().get("requestedValidTime"));
        assertEquals("2026-07-21T04:00:00+09:00", dataset.metadata().get("validTime"));
        assertEquals("2026-07-20T12:00:00Z", dataset.metadata().get("modelRunTime"));
        assertEquals(7, dataset.metadata().get("modelForecastHour"));
        assertEquals(1, dataset.metadata().get("temporalResolutionHours"));
        assertEquals(false, dataset.metadata().get("timeAdjusted"));
    }

    @Test
    void unavailableOperationalGridFailsAfterOnePreviousRun() {
        GridDataRepository cache = mock(GridDataRepository.class);

        UpstreamUnavailableException error = assertThrows(
                UpstreamUnavailableException.class,
                () -> source(cache, false).loadGrid(RELEASE, 2));

        assertEquals("solar grid unavailable", error.getMessage());
        verify(cache).readKimSolar("2026072012", 7);
        verify(cache).readKimSolar("2026072006", 13);
    }

    @Test
    void pointSeriesKeepsEveryHourlySlotAfterTheCutover() {
        GridDataRepository cache = mock(GridDataRepository.class);
        when(cache.readKimSolar(eq("2026072012"), anyInt()))
                .thenAnswer(call -> WeatherGridTestData.kim(((Integer) call.getArgument(1)).doubleValue()));

        List<double[]> series = source(cache, false)
                .loadPointSeries(RELEASE, 37.5665, 126.9780);

        assertEquals(49, series.size());
        assertEquals(6, series.get(0)[0]);
        assertEquals(6, series.get(1)[0]);
        for (int slot = 2; slot <= 48; slot++) {
            assertEquals(slot + 5, series.get(slot)[0]);
        }
        ArgumentCaptor<Integer> hours = ArgumentCaptor.forClass(Integer.class);
        verify(cache, times(48)).readKimSolar(eq("2026072012"), hours.capture());
        assertEquals(48, hours.getAllValues().stream().distinct().count());
    }

    @Test
    void demoGridIsFiniteAndNonNegative() {
        WeatherGridDataset dataset = source(mock(GridDataRepository.class), true)
                .loadGrid(RELEASE, 10);

        assertTrue(dataset.demo());
        assertEquals(145 * 162, dataset.values().length);
        assertTrue(java.util.Arrays.stream(dataset.values())
                .allMatch(value -> Double.isFinite(value) && value >= 0));
        assertTrue(java.util.Arrays.stream(dataset.values()).anyMatch(value -> value > 0));
    }

    private static KimSolarGridSource source(GridDataRepository cache, boolean demoMode) {
        return new KimSolarGridSource(
                cache, new WeatherGridWindow(1), new WeatherRuntimeOptions(demoMode));
    }
}
