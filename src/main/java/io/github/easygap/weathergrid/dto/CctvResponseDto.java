package io.github.easygap.weathergrid.dto;

import java.util.List;

/** 현재 지도 영역에 포함되는 ITS CCTV 메타데이터 응답. */
public record CctvResponseDto(
        String fetchedAt,
        boolean stale,
        boolean truncated,
        String source,
        List<CctvItemDto> cctvs
) {
}
