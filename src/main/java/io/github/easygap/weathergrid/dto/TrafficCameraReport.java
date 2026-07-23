package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Objects;

/** Immutable ITS camera response for a bounded map viewport. */
public record TrafficCameraReport(
        @JsonProperty("fetchedAt") String collectedAt,
        @JsonProperty("stale") boolean staleSnapshot,
        @JsonProperty("truncated") boolean resultLimited,
        @JsonProperty("source") String provider,
        @JsonProperty("cctvs") List<TrafficCameraView> cameras) {

    public TrafficCameraReport {
        if (collectedAt == null || collectedAt.isBlank()) {
            throw new IllegalArgumentException("collectedAt is blank");
        }
        if (provider == null || provider.isBlank()) throw new IllegalArgumentException("provider is blank");
        cameras = List.copyOf(Objects.requireNonNull(cameras, "cameras"));
    }
}
