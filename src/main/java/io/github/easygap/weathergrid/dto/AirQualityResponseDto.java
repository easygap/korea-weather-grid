package io.github.easygap.weathergrid.dto;

import java.util.List;

public record AirQualityResponseDto(
        String dataTime,
        String dataTimeFrom,
        boolean stale,
        String source,
        List<AirQualityStationDto> stations
) {
}
