package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.NumericSummary;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeatherGridServiceTest {

    private static final ForecastReleaseClock.Release RELEASE =
            new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 2);

    @Test
    void publicPayloadAddsWindowGeometryAndRoundedStatistics() {
        TestContext context = context();
        double[] values = values(-999);
        values[0] = 0;
        values[1] = 4.24;
        values[2] = 8.15;
        WeatherGridDataset dataset = new WeatherGridDataset(
                values, false, Map.of("product", "KMA DFS PCP"), Map.of(), null);
        when(context.scalar().supports("pcp")).thenReturn(true);
        when(context.scalar().load("pcp", RELEASE, 1)).thenReturn(dataset);

        Map<String, Object> result = context.service().grid("20260721", "0200", "pcp", 1);
        NumericSummary stats = (NumericSummary) result.get("stats");

        assertEquals(0, stats.minimum());
        assertEquals(4.1, stats.average());
        assertEquals(8.2, stats.maximum());
        assertEquals(145 * 162, ((java.util.List<?>) result.get("data")).size());
        assertEquals(145, result.get("nx"));
        assertEquals(162, result.get("ny"));
        assertEquals(5, result.get("nxMin"));
        assertEquals(1, result.get("nyMin"));
        assertEquals("20260721", result.get("baseDate"));
        assertEquals("0200", result.get("baseTime"));
        assertEquals("KMA DFS PCP", result.get("product"));
        assertNull(result.get("windField"));
    }

    @Test
    void categoricalStatisticsCountCodesWithoutInventingNumericAverages() {
        TestContext context = context();
        double[] values = values(-999);
        values[0] = 0;
        values[1] = 4;
        values[2] = 4;
        WeatherGridDataset dataset = new WeatherGridDataset(values, false, Map.of(),
                Map.of(0, "없음", 4, "소나기"), null);
        when(context.scalar().supports("pty")).thenReturn(true);
        when(context.scalar().load("pty", RELEASE, 1)).thenReturn(dataset);

        Map<String, Object> result = context.service()
                .statistics("20260721", "0200", "pty", 1);
        Map<?, ?> stats = (Map<?, ?>) result.get("stats");

        assertNull(stats.get("min"));
        assertNull(stats.get("avg"));
        assertEquals(3, stats.get("count"));
        assertEquals(Map.of(0, 1, 4, 2), result.get("categoryCounts"));
    }

    @Test
    void routesEachProductFamilyAndRejectsUnknownElements() {
        TestContext context = context();
        WeatherGridDataset empty = new WeatherGridDataset(values(-999), false, Map.of(), Map.of(), null);
        when(context.wind().load(RELEASE, 0)).thenReturn(empty);
        when(context.solar().loadGrid(RELEASE, 2)).thenReturn(empty);

        context.service().grid("20260721", "0200", "wdws", 0);
        context.service().grid("20260721", "0200", "swdn", 2);

        verify(context.wind()).load(RELEASE, 0);
        verify(context.solar()).loadGrid(RELEASE, 2);
        assertThrows(RequestRejectedException.class,
                () -> context.service().grid("20260721", "0200", "rn1", 1));
    }

    private static TestContext context() {
        ForecastReleaseClock releases = mock(ForecastReleaseClock.class);
        when(releases.atOrBefore("20260721", "0200")).thenReturn(RELEASE);
        DfsWindGridSource wind = mock(DfsWindGridSource.class);
        DfsScalarGridSource scalar = mock(DfsScalarGridSource.class);
        KimSolarGridSource solar = mock(KimSolarGridSource.class);
        WeatherGridService service = new WeatherGridService(
                releases, new WeatherGridWindow(1), wind, scalar, solar);
        return new TestContext(service, wind, scalar, solar);
    }

    private static double[] values(double value) {
        double[] values = new double[145 * 162];
        java.util.Arrays.fill(values, value);
        return values;
    }

    private record TestContext(WeatherGridService service, DfsWindGridSource wind,
                               DfsScalarGridSource scalar, KimSolarGridSource solar) { }
}
