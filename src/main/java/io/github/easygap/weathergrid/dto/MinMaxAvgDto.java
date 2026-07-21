package io.github.easygap.weathergrid.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 데이터 통계 (최소/평균/최대)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MinMaxAvgDto {
    private double min;
    private double avg;
    private double max;
}
