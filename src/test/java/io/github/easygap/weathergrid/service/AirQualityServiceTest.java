package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.integration.AirQualityFeed;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AirQualityServiceTest {

    @Test
    void disambiguatesRegionsDeduplicatesNewerRowsAndFiltersTheViewport() {
        AirQualitySnapshotCache cache = mock(AirQualitySnapshotCache.class);
        when(cache.read()).thenReturn(new AirQualitySnapshotCache.Snapshot(List.of(
                measurement("중앙동", "전북특별자치도", "2026-07-22 08:00", 30.0, 15.0, null),
                measurement("중앙동", "전북특별자치도", "2026-07-22 09:00", 40.0, 20.0, "점검중"),
                measurement("종로구 측정소", "서울", "2026-07-22 10:00", 22.0, 10.0, null)),
                List.of(
                        station("중앙동", "서울특별시 테스트", 37.5, 127.0),
                        station("중앙동 측정소", "전라북도 테스트", 35.8, 127.1),
                        station("종로구", "서울특별시 종로구", 37.57, 127.01)),
                true));
        AirQualityService service = new AirQualityService(cache);

        var response = service.get(34, 38, 126, 128);

        assertTrue(response.staleSnapshot());
        assertEquals("AirKorea", response.provider());
        assertEquals("2026-07-22 10:00", response.newestObservation());
        assertEquals("2026-07-22 09:00", response.oldestObservation());
        assertEquals(2, response.readings().size());
        assertEquals("종로구 측정소", response.readings().get(0).stationName());
        var central = response.readings().stream()
                .filter(station -> station.stationName().equals("중앙동"))
                .findFirst().orElseThrow();
        assertEquals("전라북도 테스트", central.streetAddress());
        assertNull(central.pm10Concentration(), "provider flag suppresses the concentration");
        assertEquals(20.0, central.pm25Concentration());
    }

    @Test
    void returnsAnEmptyViewportWithTheNationwideTimestampButRejectsNoMeasurements() {
        AirQualitySnapshotCache cache = mock(AirQualitySnapshotCache.class);
        AirQualityFeed.Station station = station(
                "종로구", "서울특별시 종로구", 37.57, 127.01);
        when(cache.read()).thenReturn(new AirQualitySnapshotCache.Snapshot(
                List.of(measurement("종로구", "서울", "2026-07-22 10:00",
                        22.0, 10.0, null)), List.of(station), false));
        AirQualityService service = new AirQualityService(cache);

        var outside = service.get(32, 33, 122, 123);
        assertFalse(outside.staleSnapshot());
        assertEquals("2026-07-22 10:00", outside.newestObservation());
        assertEquals("2026-07-22 10:00", outside.oldestObservation());
        assertTrue(outside.readings().isEmpty());

        when(cache.read()).thenReturn(new AirQualitySnapshotCache.Snapshot(
                List.of(measurement("종로구", "서울", "2026-07-22 10:00",
                        null, null, "점검중")), List.of(station), false));
        assertThrows(UpstreamUnavailableException.class,
                () -> service.get(32, 44, 122, 134));
    }

    @Test
    void rejectsInvalidViewportBeforeReadingTheCache() {
        AirQualitySnapshotCache cache = mock(AirQualitySnapshotCache.class);
        AirQualityService service = new AirQualityService(cache);

        assertThrows(IllegalArgumentException.class, () -> service.get(38, 37, 126, 128));
        assertThrows(IllegalArgumentException.class, () -> service.get(32, 44, 121, 134));
        verify(cache, never()).read();
    }

    private static AirQualityFeed.Measurement measurement(
            String name, String region, String time, Double pm10, Double pm25, String pm10Flag) {
        return new AirQualityFeed.Measurement(name, region, null, "도시대기",
                pm10, pm25, 2, 2, pm10Flag, null, time);
    }

    private static AirQualityFeed.Station station(
            String name, String address, double latitude, double longitude) {
        return new AirQualityFeed.Station(name, address, "도시대기", latitude, longitude);
    }
}
