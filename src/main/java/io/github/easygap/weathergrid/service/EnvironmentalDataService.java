package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.AirQualityReport;
import io.github.easygap.weathergrid.dto.PointForecastReport;
import org.springframework.stereotype.Service;

/** Stable controller-facing facade for independently implemented environmental features. */
@Service
public class EnvironmentalDataService {

    private final PointForecastTimeline pointForecasts;
    private final AirQualityService airQuality;

    public EnvironmentalDataService(PointForecastTimeline pointForecasts,
                                    AirQualityService airQuality) {
        this.pointForecasts = pointForecasts;
        this.airQuality = airQuality;
    }

    public PointForecastReport getStationForecast(double latitude, double longitude,
                                                          String baseDate, String baseTime) {
        return pointForecasts.get(latitude, longitude, baseDate, baseTime);
    }

    public AirQualityReport getAirQuality(double minLat, double maxLat,
                                                double minLon, double maxLon) {
        return airQuality.get(minLat, maxLat, minLon, maxLon);
    }
}
