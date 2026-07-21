package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 단기예보 발표시각 기준 한 시간 슬롯. 값이 없는 요소는 null로 보존한다. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record StationForecastItemDto(
        int forecastHour,
        String forecastDateTime,
        Double temperature,
        Double humidity,
        Double precipitationProbability,
        String precipitationAmount,
        String snowfallAmount,
        Integer skyCode,
        String skyLabel,
        Integer precipitationType,
        String precipitationTypeLabel,
        Double waveHeight,
        Double windSpeed,
        Double windDirection
) {
}
