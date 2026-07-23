package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Objects;

/** Immutable point-forecast response tied to one public KMA release. */
public record PointForecastReport(
        @JsonProperty("baseDate") String releaseDate,
        @JsonProperty("baseTime") String releaseTime,
        @JsonProperty("latitude") double latitude,
        @JsonProperty("longitude") double longitude,
        @JsonProperty("source") String provider,
        @JsonProperty("items") List<PointForecastHour> hours) {

    public PointForecastReport {
        releaseDate = Objects.requireNonNull(releaseDate, "releaseDate");
        releaseTime = Objects.requireNonNull(releaseTime, "releaseTime");
        provider = Objects.requireNonNull(provider, "provider");
        hours = List.copyOf(Objects.requireNonNull(hours, "hours"));
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new IllegalArgumentException("forecast coordinate is invalid");
        }
    }
}
