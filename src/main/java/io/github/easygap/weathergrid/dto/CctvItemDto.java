package io.github.easygap.weathergrid.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 국가교통정보센터 원문을 브라우저에 필요한 필드만 남겨 정규화한 CCTV 지점. */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CctvItemDto(
        String id,
        String name,
        double latitude,
        double longitude,
        String streamUrl,
        String format,
        String resolution,
        String fileCreatedAt,
        String roadSectionId
) {
}
