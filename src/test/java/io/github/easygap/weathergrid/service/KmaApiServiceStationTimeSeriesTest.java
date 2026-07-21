package io.github.easygap.weathergrid.service;

import tools.jackson.databind.json.JsonMapper;
import io.github.easygap.weathergrid.dto.StationDataDto;
import io.github.easygap.weathergrid.dto.WeatherDataDto;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class KmaApiServiceStationTimeSeriesTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void distinguishesMissingCategoriesFromRealZeroValues() {
        KmaApiService parser = new KmaApiService(null, MAPPER);
        String response = """
                {
                  "response": {
                    "header": {"resultCode": "00"},
                    "body": {"items": {"item": [
                      {"category":"TMP","fcstDate":"20260714","fcstTime":"0300","fcstValue":"0"},
                      {"category":"WSD","fcstDate":"20260714","fcstTime":"0400","fcstValue":"0"},
                      {"category":"VEC","fcstDate":"20260714","fcstTime":"0400","fcstValue":"0"},
                      {"category":"WSD","fcstDate":"20260714","fcstTime":"0500","fcstValue":"NaN"}
                    ]}}
                  }
                }
                """;

        @SuppressWarnings("unchecked")
        List<WeatherDataDto> parsed = (List<WeatherDataDto>) ReflectionTestUtils.invokeMethod(
                parser, "parseVilageFcstResponse", response);
        assertNotNull(parsed);
        assertEquals(3, parsed.size(), "비유한 예보값은 실제 0으로 바뀌지 않아야 한다");

        KmaApiService service = new KmaApiService(null, MAPPER) {
            @Override
            public List<WeatherDataDto> getShortTermForecast(
                    String baseDate, String baseTime, int nx, int ny) {
                return parsed;
            }
        };

        List<StationDataDto> series = service.getStationTimeSeries(
                "20260714", "0200", 60, 127, "wdws");

        assertEquals(49, series.size());
        StationDataDto temperatureOnly = series.get(1);
        assertEquals(0.0, temperatureOnly.getTemperature());
        assertEquals(9999.0, temperatureOnly.getWindSpeed());
        assertEquals(9999.0, temperatureOnly.getWindDirection());

        StationDataDto calmWind = series.get(2);
        assertEquals(0.0, calmWind.getWindSpeed());
        assertEquals(0.0, calmWind.getWindDirection());
        assertEquals(9999.0, calmWind.getTemperature());

        StationDataDto invalidWind = series.get(3);
        assertEquals(9999.0, invalidWind.getWindSpeed());
        assertEquals(9999.0, invalidWind.getTemperature());
    }
}
