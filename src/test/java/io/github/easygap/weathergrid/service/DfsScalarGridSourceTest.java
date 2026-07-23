package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.InOrder;

import java.time.LocalDate;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class DfsScalarGridSourceTest {

    private static final ForecastReleaseClock.Release RELEASE =
            new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 2);

    @ParameterizedTest
    @MethodSource("products")
    void eachPublicElementUsesOneDocumentedDfsVariable(ProductCase product) {
        GridDataRepository cache = mock(GridDataRepository.class);
        when(cache.readDfs("2026072102", "2026072103", product.variable(), -999))
                .thenReturn(WeatherGridTestData.dfs(product.value()));

        WeatherGridDataset dataset = source(cache, false).load(product.element(), RELEASE, 1);

        assertFalse(dataset.demo());
        assertEquals(product.value(), dataset.values()[0]);
        assertEquals(product.productName(), dataset.metadata().get("product"));
        assertEquals(product.unit(), dataset.metadata().get("unit"));
        assertEquals(product.accumulationHours(), dataset.metadata().get("accumulationHours"));
        assertEquals("2026-07-21T03:00:00+09:00", dataset.metadata().get("validTime"));
        assertEquals(1, dataset.metadata().get("modelForecastHour"));
        assertEquals(false, dataset.metadata().get("fallbackUsed"));
    }

    @Test
    void categoricalProductsPreserveOnlyKnownCodes() {
        GridDataRepository cache = mock(GridDataRepository.class);
        double[][] type = WeatherGridTestData.dfs(4);
        type[161][4] = 7;
        type[161][5] = 2.5;
        when(cache.readDfs("2026072102", "2026072103", "PTY", -999)).thenReturn(type);

        WeatherGridDataset dataset = source(cache, false).load("pty", RELEASE, 1);

        assertEquals(-999, dataset.values()[0]);
        assertEquals(-999, dataset.values()[1]);
        assertEquals(4, dataset.values()[2]);
        assertEquals(Map.of(0, "없음", 1, "비", 2, "비/눈", 3, "눈", 4, "소나기"),
                dataset.categories());
    }

    @Test
    void retriesThePreviousThreeHourRunWithoutChangingRequestedValidTime() {
        GridDataRepository cache = mock(GridDataRepository.class);
        ForecastReleaseClock.Release afternoon =
                new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 14);
        when(cache.readDfs("2026072114", "2026072115", "PCP", -999)).thenReturn(null);
        when(cache.readDfs("2026072111", "2026072115", "PCP", -999))
                .thenReturn(WeatherGridTestData.dfs(4.2));

        WeatherGridDataset dataset = source(cache, false).load("pcp", afternoon, 1);

        assertEquals(4.2, dataset.values()[0]);
        assertEquals("2026-07-21T15:00:00+09:00", dataset.metadata().get("validTime"));
        assertEquals("2026-07-21T02:00:00Z", dataset.metadata().get("modelRunTime"));
        assertEquals(4, dataset.metadata().get("modelForecastHour"));
        assertEquals(true, dataset.metadata().get("fallbackUsed"));
        InOrder order = inOrder(cache);
        order.verify(cache).readDfs("2026072114", "2026072115", "PCP", -999);
        order.verify(cache).readDfs("2026072111", "2026072115", "PCP", -999);
        verifyNoMoreInteractions(cache);
    }

    @Test
    void rejectsMissingNonDemoProductsAfterTwoRuns() {
        GridDataRepository cache = mock(GridDataRepository.class);

        UpstreamUnavailableException error = assertThrows(
                UpstreamUnavailableException.class,
                () -> source(cache, false).load("sno", RELEASE, 1));

        assertEquals("snowfall grid unavailable", error.getMessage());
    }

    @Test
    void demoTemperatureUsesACompletePhysicalField() {
        WeatherGridDataset dataset = source(mock(GridDataRepository.class), true)
                .load("tmp", RELEASE, 8);

        assertTrue(dataset.demo());
        assertEquals(145 * 162, dataset.values().length);
        assertTrue(Stream.of(dataset.values()[0], dataset.values()[500], dataset.values()[2000])
                .allMatch(value -> Double.isFinite(value) && value > -100 && value < 80));
        assertEquals("KMA DFS TMP", dataset.metadata().get("product"));
    }

    private static Stream<ProductCase> products() {
        return Stream.of(
                new ProductCase("tmp", "TMP", 18.5, "KMA DFS TMP", "°C", null),
                new ProductCase("pcp", "PCP", 0, "KMA DFS PCP", "mm", 1),
                new ProductCase("sno", "SNO", 2.4, "KMA DFS SNO", "cm", 1),
                new ProductCase("pty", "PTY", 4, "KMA DFS PTY", "code", null),
                new ProductCase("reh", "REH", 75, "KMA DFS REH", "%", null),
                new ProductCase("sky", "SKY", 3, "KMA DFS SKY", "code", null),
                new ProductCase("wav", "WAV", 1.8, "KMA DFS WAV", "m", null));
    }

    private static DfsScalarGridSource source(GridDataRepository cache, boolean demoMode) {
        return new DfsScalarGridSource(
                cache, new WeatherGridWindow(1), new WeatherRuntimeOptions(demoMode));
    }

    private record ProductCase(String element, String variable, double value,
                               String productName, String unit, Integer accumulationHours) { }
}
