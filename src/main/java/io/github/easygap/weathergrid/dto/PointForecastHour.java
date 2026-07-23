package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Objects;

/** One public hourly slot assembled from normalized KMA point-forecast values. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PointForecastHour(
        @JsonProperty("forecastHour") int hour,
        @JsonProperty("forecastDateTime") String validTime,
        @JsonProperty("temperature") Double airTemperature,
        @JsonProperty("humidity") Double relativeHumidity,
        @JsonProperty("precipitationProbability") Double rainProbability,
        @JsonProperty("precipitationAmount") String rainAmount,
        @JsonProperty("snowfallAmount") String snowAmount,
        @JsonProperty("skyCode") Integer skyCode,
        @JsonProperty("skyLabel") String skyDescription,
        @JsonProperty("precipitationType") Integer precipitationCode,
        @JsonProperty("precipitationTypeLabel") String precipitationDescription,
        @JsonProperty("waveHeight") Double waveHeight,
        @JsonProperty("windSpeed") Double windSpeed,
        @JsonProperty("windDirection") Double windBearing) {

    public PointForecastHour {
        if (hour < 0 || hour > 48) throw new IllegalArgumentException("hour is outside 0..48");
        validTime = Objects.requireNonNull(validTime, "validTime");
    }
}
