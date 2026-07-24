package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Objects;

/** Browser-safe projection of one provider-normalized traffic camera. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record TrafficCameraView(
        @JsonProperty("id") String cameraId,
        @JsonProperty("name") String displayName,
        @JsonProperty("latitude") double latitude,
        @JsonProperty("longitude") double longitude,
        @JsonProperty("streamUrl") String playbackUrl,
        @JsonProperty("format") String streamFormat,
        @JsonProperty("resolution") String imageSize,
        @JsonProperty("fileCreatedAt") String sourceTimestamp,
        @JsonProperty("roadSectionId") String roadSegmentId) {

    public TrafficCameraView {
        cameraId = Objects.requireNonNull(cameraId, "cameraId");
        displayName = Objects.requireNonNull(displayName, "displayName");
        playbackUrl = Objects.requireNonNull(playbackUrl, "playbackUrl");
        streamFormat = Objects.requireNonNull(streamFormat, "streamFormat");
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new IllegalArgumentException("camera coordinate is invalid");
        }
    }
}
