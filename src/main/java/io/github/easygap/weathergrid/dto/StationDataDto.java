package io.github.easygap.weathergrid.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 지점별 시계열 데이터
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StationDataDto {
    private int forecastHour;       // 예측 시간 (0~48)
    private double windSpeed;       // 풍속
    private double windDirection;   // 풍향
    private double solarRadiation;  // 지표면 하향단파복사 강도 (W/m²)
    private double temperature;     // 기온 (℃)
    private String fcstDateTime;    // 예측 일시
}
