package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Objects;

/** Immutable AirKorea viewport response with explicit public JSON names. */
public record AirQualityReport(
        @JsonProperty("dataTime") String newestObservation,
        @JsonProperty("dataTimeFrom") String oldestObservation,
        @JsonProperty("stale") boolean staleSnapshot,
        @JsonProperty("source") String provider,
        @JsonProperty("stations") List<AirQualityReading> readings) {

    public AirQualityReport {
        newestObservation = requireText(newestObservation, "newestObservation");
        oldestObservation = requireText(oldestObservation, "oldestObservation");
        provider = requireText(provider, "provider");
        readings = List.copyOf(Objects.requireNonNull(readings, "readings"));
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is blank");
        return value;
    }
}
