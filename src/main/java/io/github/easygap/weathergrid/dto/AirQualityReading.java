package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/** One geocoded AirKorea observation; provider flags intentionally preserve missing values. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AirQualityReading(
        @JsonProperty("name") String stationName,
        @JsonProperty("address") String streetAddress,
        @JsonProperty("network") String networkType,
        @JsonProperty("latitude") double latitude,
        @JsonProperty("longitude") double longitude,
        @JsonProperty("pm10") Double pm10Concentration,
        @JsonProperty("pm25") Double pm25Concentration,
        @JsonProperty("pm10Grade") Integer pm10HourlyGrade,
        @JsonProperty("pm25Grade") Integer pm25HourlyGrade,
        @JsonProperty("pm10Flag") String pm10Status,
        @JsonProperty("pm25Flag") String pm25Status,
        @JsonProperty("dataTime") String observedAt) {

    public AirQualityReading {
        if (stationName == null || stationName.isBlank()) {
            throw new IllegalArgumentException("stationName is blank");
        }
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new IllegalArgumentException("station coordinate is invalid");
        }
    }
}
