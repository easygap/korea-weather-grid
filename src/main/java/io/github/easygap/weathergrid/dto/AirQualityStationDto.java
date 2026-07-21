package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** AirKorea 원문 값과 상태 플래그를 보존한 지도용 측정소 스냅샷. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AirQualityStationDto(
        String name,
        String address,
        String network,
        double latitude,
        double longitude,
        Double pm10,
        Double pm25,
        Integer pm10Grade,
        Integer pm25Grade,
        String pm10Flag,
        String pm25Flag,
        String dataTime
) {
}
