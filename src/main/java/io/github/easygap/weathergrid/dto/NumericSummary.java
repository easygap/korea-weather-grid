package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Rounded numeric statistics exposed by a map-grid product. */
public record NumericSummary(
        @JsonProperty("min") double minimum,
        @JsonProperty("avg") double average,
        @JsonProperty("max") double maximum) {

    public NumericSummary {
        if (!Double.isFinite(minimum) || !Double.isFinite(average) || !Double.isFinite(maximum)
                || minimum > maximum) {
            throw new IllegalArgumentException("numeric summary is invalid");
        }
    }
}
