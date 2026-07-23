package io.github.easygap.weathergrid.service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Normalized, north-to-south grid values plus product-specific public metadata. */
public record WeatherGridDataset(
        double[] values,
        boolean demo,
        Map<String, Object> metadata,
        Map<Integer, String> categories,
        Map<String, Object> windField) {

    public WeatherGridDataset {
        Objects.requireNonNull(values);
        metadata = immutableCopy(metadata);
        categories = categories == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(categories));
        windField = windField == null ? null : immutableCopy(windField);
    }

    private static Map<String, Object> immutableCopy(Map<String, Object> source) {
        if (source == null || source.isEmpty()) return Map.of();
        return Collections.unmodifiableMap(new LinkedHashMap<>(source));
    }
}
