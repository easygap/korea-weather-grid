package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.AirQualityReport;
import io.github.easygap.weathergrid.dto.PointForecastReport;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EnvironmentalDataServiceTest {

    @Test
    void delegatesForecastsAndAirQualityWithoutOwningParsingOrCachePolicy() {
        PointForecastTimeline forecasts = mock(PointForecastTimeline.class);
        AirQualityService airQuality = mock(AirQualityService.class);
        PointForecastReport forecastResponse = new PointForecastReport(
                "20260722", "0200", 37.5, 127, "기상청 단기예보", List.of());
        AirQualityReport airResponse = new AirQualityReport(
                "2026-07-22 10:00", "2026-07-22 09:00", false, "AirKorea", List.of());
        when(forecasts.get(37.5, 127, "20260722", "0200")).thenReturn(forecastResponse);
        when(airQuality.get(32, 44, 122, 134)).thenReturn(airResponse);
        EnvironmentalDataService service = new EnvironmentalDataService(forecasts, airQuality);

        assertSame(forecastResponse,
                service.getStationForecast(37.5, 127, "20260722", "0200"));
        assertSame(airResponse, service.getAirQuality(32, 44, 122, 134));
        verify(forecasts).get(37.5, 127, "20260722", "0200");
        verify(airQuality).get(32, 44, 122, 134);
    }
}
