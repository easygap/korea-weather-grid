package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.StationSeriesSlot;
import io.github.easygap.weathergrid.integration.KmaPointForecastGateway;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static io.github.easygap.weathergrid.integration.KmaPointForecastGateway.Category.TEMPERATURE;
import static io.github.easygap.weathergrid.integration.KmaPointForecastGateway.Category.WIND_DIRECTION;
import static io.github.easygap.weathergrid.integration.KmaPointForecastGateway.Category.WIND_SPEED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StationForecastServiceTest {

    private static final ForecastReleaseClock.Release RELEASE =
            new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 22), 2);

    @Test
    void buildsExactlyFortyNineSlotsAndPreservesRealZeroValues() {
        KmaPointForecastGateway gateway = mock(KmaPointForecastGateway.class);
        when(gateway.fetch("20260722", "0200", 60, 127)).thenReturn(List.of(
                value(TEMPERATURE, 1, 0),
                value(WIND_SPEED, 2, 0),
                value(WIND_DIRECTION, 2, 0),
                value(TEMPERATURE, 49, 22),
                new KmaPointForecastGateway.ForecastValue(
                        TEMPERATURE, RELEASE.dateTime().plusMinutes(90), 11)));
        StationForecastService service = new StationForecastService(gateway);

        List<StationSeriesSlot> series = service.load(RELEASE, 60, 127);

        assertEquals(49, series.size());
        assertEquals(9999, series.get(0).airTemperature());
        assertEquals(0, series.get(1).airTemperature());
        assertEquals(9999, series.get(1).windSpeed());
        assertEquals(0, series.get(2).windSpeed());
        assertEquals(0, series.get(2).windBearing());
        assertEquals(9999, series.get(3).airTemperature());
        assertEquals("202607240200", series.get(48).validTime());

        assertEquals(series, service.load(RELEASE, 60, 127));
        verify(gateway).fetch("20260722", "0200", 60, 127);
    }

    @Test
    void emptyFailuresAreNotCachedAndInvalidCellsNeverReachGateway() {
        KmaPointForecastGateway gateway = mock(KmaPointForecastGateway.class);
        StationForecastService service = new StationForecastService(gateway);

        service.load(RELEASE, 60, 127);
        service.load(RELEASE, 60, 127);
        verify(gateway, times(2)).fetch("20260722", "0200", 60, 127);

        assertThrows(IllegalArgumentException.class, () -> service.load(RELEASE, 0, 127));
    }

    private static KmaPointForecastGateway.ForecastValue value(
            KmaPointForecastGateway.Category category, int hour, double value) {
        return new KmaPointForecastGateway.ForecastValue(
                category, RELEASE.dateTime().plusHours(hour), value);
    }
}
