package io.github.easygap.weathergrid.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MapServiceTest {

    @Test
    void facadePublishesLatestReleaseAndDelegatesAllDataQueries() {
        ForecastReleaseClock releases = mock(ForecastReleaseClock.class);
        WeatherGridService grids = mock(WeatherGridService.class);
        WeatherStationSeriesService stations = mock(WeatherStationSeriesService.class);
        ForecastReleaseClock.Release release =
                new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 23);
        when(releases.current()).thenReturn(release);
        when(grids.grid("20260721", "2300", "tmp", 1)).thenReturn(Map.of("grid", true));
        when(grids.statistics("20260721", "2300", "tmp", 1)).thenReturn(Map.of("stats", true));
        when(stations.load(37.5, 127, "20260721", "2300", "tmp"))
                .thenReturn(List.of(new double[]{18, 0}));
        MapService service = new MapService(releases, grids, stations);

        assertEquals(Map.of(
                "baseDate", "20260721",
                "baseTime", "2300",
                "fileName", "2026072123_000"), service.getLatestInfo());
        assertEquals(Map.of("grid", true),
                service.getGridData("20260721", "2300", "tmp", 1));
        assertEquals(Map.of("stats", true),
                service.getDataStats("20260721", "2300", "tmp", 1));
        assertEquals(18, service.getStationData(
                37.5, 127, "20260721", "2300", "tmp").get(0)[0]);
        verify(grids).grid("20260721", "2300", "tmp", 1);
        verify(grids).statistics("20260721", "2300", "tmp", 1);
        verify(stations).load(37.5, 127, "20260721", "2300", "tmp");
    }
}
