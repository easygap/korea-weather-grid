package io.github.easygap.weathergrid.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 기상청 API에서 가져온 기상 데이터를 담는 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WeatherDataDto {
    private double windSpeed;       // 풍속 (m/s)
    private double windDirection;   // 풍향 (도)
    private double uWind;           // U 성분 (동서 바람)
    private double vWind;           // V 성분 (남북 바람)
    private double solarRadiation;  // 하향단파복사 (W/m²)
    private double temperature;     // 기온 (°C)
    private String baseDate;        // 발표일자 (YYYYMMDD)
    private String baseTime;        // 발표시각 (HHMM)
    private String fcstDate;        // 예측일자
    private String fcstTime;        // 예측시각
    private int nx;                 // 격자 X
    private int ny;                 // 격자 Y
}
