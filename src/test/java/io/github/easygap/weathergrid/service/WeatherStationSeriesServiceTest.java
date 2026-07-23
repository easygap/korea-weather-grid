package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.StationSeriesSlot;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeatherStationSeriesServiceTest {

    private static final ForecastReleaseClock.Release RELEASE =
            new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 2);

    @Test
    void temperatureCopiesTheFirstVisibleForecastIntoCompatibilitySlotZero() {
        TestContext context = context(false);
        when(context.pointForecast().load(eq(RELEASE), anyInt(), anyInt())).thenReturn(List.of(
                slot(9999, 9999, 9999),
                slot(12.5, 3.4, 210),
                slot(13.2, 4.1, 220)));

        List<double[]> series = context.service()
                .load(37.5665, 126.9780, "20260721", "0200", "tmp");

        assertArrayEquals(new double[]{12.5, 0}, series.get(0));
        assertArrayEquals(new double[]{12.5, 0}, series.get(1));
        assertArrayEquals(new double[]{13.2, 0}, series.get(2));
        verify(context.pointForecast()).load(eq(RELEASE), anyInt(), anyInt());
    }

    @Test
    void windSeriesKeepsSpeedAndDirectionTogether() {
        TestContext context = context(false);
        when(context.pointForecast().load(eq(RELEASE), anyInt(), anyInt()))
                .thenReturn(List.of(slot(18, 5.6, 245)));

        List<double[]> series = context.service()
                .load(35.1, 129.1, "20260721", "0200", "wdws");

        assertArrayEquals(new double[]{5.6, 245}, series.get(0));
    }

    @Test
    void solarSeriesUsesTheKimPointProduct() {
        TestContext context = context(false);
        List<double[]> expected = List.of(new double[]{320, 0}, new double[]{410, 0});
        when(context.solar().supportsPoint(37.5, 127)).thenReturn(true);
        when(context.solar().loadPointSeries(RELEASE, 37.5, 127)).thenReturn(expected);

        List<double[]> result = context.service()
                .load(37.5, 127, "20260721", "0200", "swdn");

        assertEquals(expected, result);
        verify(context.solar()).loadPointSeries(RELEASE, 37.5, 127);
    }

    @ParameterizedTest
    @ValueSource(strings = {"pcp", "sno", "pty", "reh", "sky", "wav"})
    void detailedProductsRedirectToThePointForecastContract(String element) {
        TestContext context = context(false);

        RequestRejectedException error = assertThrows(RequestRejectedException.class,
                () -> context.service().load(
                        37.5, 127, "20260721", "0200", element));

        assertEquals(true, error.getMessage().contains("/api/weather/point-forecast"));
    }

    @Test
    void rejectsSolarPointsOutsideThePublishedCrop() {
        TestContext context = context(false);
        when(context.solar().supportsPoint(41, 127)).thenReturn(false);

        RequestRejectedException error = assertThrows(RequestRejectedException.class,
                () -> context.service().load(
                        41, 127, "20260721", "0200", "swdn"));

        assertEquals("일사강도 지원 범위 밖 지점", error.getMessage());
    }

    @Test
    void operationalModeRejectsAnEntirelyMissingSeries() {
        TestContext context = context(false);
        when(context.pointForecast().load(eq(RELEASE), anyInt(), anyInt()))
                .thenReturn(List.of(slot(9999, 9999, 9999), slot(9999, 9999, 9999)));

        UpstreamUnavailableException error = assertThrows(
                UpstreamUnavailableException.class,
                () -> context.service().load(
                        37.5, 127, "20260721", "0200", "tmp"));

        assertEquals("station data unavailable", error.getMessage());
    }

    @Test
    void unknownCompactSeriesElementsAreRejected() {
        TestContext context = context(false);

        assertThrows(RequestRejectedException.class,
                () -> context.service().load(
                        37.5, 127, "20260721", "0200", "uuu"));
    }

    private static StationSeriesSlot slot(double temperature, double speed, double direction) {
        return new StationSeriesSlot(0, speed, direction, 9999,
                temperature, "202607210200");
    }

    private static TestContext context(boolean demoMode) {
        ForecastReleaseClock releases = mock(ForecastReleaseClock.class);
        when(releases.atOrBefore("20260721", "0200")).thenReturn(RELEASE);
        StationForecastService point = mock(StationForecastService.class);
        KimSolarGridSource solar = mock(KimSolarGridSource.class);
        WeatherStationSeriesService service = new WeatherStationSeriesService(
                releases, point, solar, new WeatherRuntimeOptions(demoMode));
        return new TestContext(service, point, solar);
    }

    private record TestContext(WeatherStationSeriesService service,
                               StationForecastService pointForecast,
                               KimSolarGridSource solar) { }
}
