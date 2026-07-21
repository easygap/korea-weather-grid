package io.github.easygap.weathergrid.dto;

import java.util.List;

public record StationForecastResponseDto(
        String baseDate,
        String baseTime,
        double latitude,
        double longitude,
        String source,
        List<StationForecastItemDto> items
) {
}
