package io.github.easygap.weathergrid.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import io.github.easygap.weathergrid.dto.AirQualityResponseDto;
import io.github.easygap.weathergrid.dto.AirQualityStationDto;
import io.github.easygap.weathergrid.dto.StationForecastItemDto;
import io.github.easygap.weathergrid.dto.StationForecastResponseDto;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class EnvironmentalDataServiceTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final String FORECAST_PATH =
            "/1360000/VilageFcstInfoService_2.0/getVilageFcst";
    private static final String MEASUREMENT_PATH =
            "/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
    private static final String STATION_PATH =
            "/B552584/MsrstnInfoInqireSvc/getMsrstnList";

    @Test
    void forecastKeepsZeroValuesStringsAndMissingSlots() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(FORECAST_PATH), anyMap())).thenReturn(forecastFixture());
        EnvironmentalDataService service = new EnvironmentalDataService(client,
                Clock.fixed(Instant.parse("2026-07-13T00:00:00Z"), ZoneOffset.UTC));

        StationForecastResponseDto response = service.getStationForecast(
                37.5665, 126.9780, "20260712", "0200");

        assertEquals("기상청 단기예보", response.source());
        assertEquals(49, response.items().size());
        StationForecastItemDto hour0 = response.items().get(0);
        assertEquals(0, hour0.forecastHour());
        assertEquals("202607120200", hour0.forecastDateTime());
        assertNull(hour0.temperature());
        assertNull(hour0.precipitationProbability());

        StationForecastItemDto hour1 = response.items().get(1);
        assertEquals(-3.2, hour1.temperature());
        assertEquals(85.0, hour1.humidity());
        assertEquals(0.0, hour1.precipitationProbability());
        assertEquals("1.0mm 미만", hour1.precipitationAmount());
        assertEquals("적설없음", hour1.snowfallAmount());
        assertEquals(3, hour1.skyCode());
        assertEquals("구름많음", hour1.skyLabel());
        assertEquals(0, hour1.precipitationType());
        assertEquals("없음", hour1.precipitationTypeLabel());
        assertEquals(1.4, hour1.waveHeight());
        assertEquals(2.5, hour1.windSpeed());
        assertEquals(270.0, hour1.windDirection());
        assertNull(response.items().get(2).waveHeight(), "파고 sentinel은 결측으로 보존한다");

        // 같은 발표·격자 재조회는 상류를 다시 호출하지 않는다.
        service.getStationForecast(37.5665, 126.9780, "20260712", "0200");
        verify(client, times(1)).get(eq(FORECAST_PATH), anyMap());
    }

    @Test
    void expiredForecastIsRefetchedAndNeverFallsBackIndefinitely() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(FORECAST_PATH), anyMap()))
                .thenReturn(forecastFixture())
                .thenThrow(new ExternalDataUnavailableException());
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T00:00:00Z"));
        EnvironmentalDataService service = new EnvironmentalDataService(client, clock);

        service.getStationForecast(37.5665, 126.9780, "20260712", "0200");
        clock.advance(Duration.ofHours(2));

        assertThrows(ExternalDataUnavailableException.class,
                () -> service.getStationForecast(37.5665, 126.9780, "20260712", "0200"));
        verify(client, times(2)).get(eq(FORECAST_PATH), anyMap());
    }

    @Test
    void airQualityJoinsBothCoordinateDirectionsAndPreservesMissingFlags() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(MEASUREMENT_PATH), anyMap())).thenReturn(measurementFixture());
        when(client.get(eq(STATION_PATH), anyMap())).thenReturn(stationFixture());
        EnvironmentalDataService service = new EnvironmentalDataService(client,
                Clock.fixed(Instant.parse("2026-07-13T00:00:00Z"), ZoneOffset.UTC));

        AirQualityResponseDto response = service.getAirQuality(32, 44, 122, 134);

        assertFalse(response.stale());
        assertEquals("AirKorea", response.source());
        assertEquals("2026-07-13 09:00", response.dataTime());
        assertEquals("2026-07-13 08:00", response.dataTimeFrom());
        assertEquals(2, response.stations().size());

        AirQualityStationDto jongno = response.stations().stream()
                .filter(value -> value.name().equals("종로구"))
                .findFirst().orElseThrow();
        assertEquals(37.572025, jongno.latitude());
        assertEquals(127.005028, jongno.longitude());
        assertNull(jongno.pm10());
        assertEquals(18.0, jongno.pm25());
        assertEquals(2, jongno.pm25Grade());
        assertEquals("점검및교정", jongno.pm10Flag());
        assertNull(jongno.pm25Flag());

        AirQualityStationDto busan = response.stations().stream()
                .filter(value -> value.name().equals("청룡동"))
                .findFirst().orElseThrow();
        assertEquals(35.2, busan.latitude());
        assertEquals(129.0, busan.longitude());
        assertNull(busan.pm10Grade(), "24시간 등급을 1시간 농도 등급으로 대체하면 안 된다");
        assertNull(busan.pm25Grade(), "24시간 등급을 1시간 농도 등급으로 대체하면 안 된다");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> measurementParams = ArgumentCaptor.forClass(Map.class);
        verify(client).get(eq(MEASUREMENT_PATH), measurementParams.capture());
        assertEquals("전국", measurementParams.getValue().get("sidoName"));
        assertEquals("1.3", measurementParams.getValue().get("ver"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> stationParams = ArgumentCaptor.forClass(Map.class);
        verify(client).get(eq(STATION_PATH), stationParams.capture());
        assertEquals("1.1", stationParams.getValue().get("ver"));
    }

    @Test
    void recentlyExpiredAirSnapshotFallsBackAsStaleWhenRefreshFails() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(MEASUREMENT_PATH), anyMap()))
                .thenReturn(measurementFixture())
                .thenThrow(new ExternalDataUnavailableException());
        when(client.get(eq(STATION_PATH), anyMap()))
                .thenReturn(stationFixture());
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T00:00:00Z"));
        EnvironmentalDataService service = new EnvironmentalDataService(client, clock);

        assertFalse(service.getAirQuality(32, 44, 122, 134).stale());
        clock.advance(Duration.ofHours(2));

        AirQualityResponseDto stale = service.getAirQuality(32, 44, 122, 134);
        assertTrue(stale.stale());
        assertEquals(2, stale.stations().size());
        assertTrue(service.getAirQuality(32, 44, 122, 134).stale());
        verify(client, times(2)).get(eq(MEASUREMENT_PATH), anyMap());
        verify(client, times(1)).get(eq(STATION_PATH), anyMap());
    }

    @Test
    void airMeasurementOlderThanSixHoursIsNotServed() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(MEASUREMENT_PATH), anyMap()))
                .thenReturn(measurementFixture())
                .thenThrow(new ExternalDataUnavailableException());
        when(client.get(eq(STATION_PATH), anyMap())).thenReturn(stationFixture());
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T00:00:00Z"));
        EnvironmentalDataService service = new EnvironmentalDataService(client, clock);

        assertFalse(service.getAirQuality(32, 44, 122, 134).stale());
        clock.advance(Duration.ofHours(7));

        assertThrows(ExternalDataUnavailableException.class,
                () -> service.getAirQuality(32, 44, 122, 134));
        verify(client, times(2)).get(eq(MEASUREMENT_PATH), anyMap());
        verify(client, times(1)).get(eq(STATION_PATH), anyMap());
    }

    @Test
    void forecastRefreshBudgetStopsDistinctColdCacheMisses() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(FORECAST_PATH), anyMap())).thenReturn(forecastFixture());
        MutableClock clock = new MutableClock(Instant.parse("2026-07-13T00:00:00Z"));
        EnvironmentalRateLimiter limiter = new EnvironmentalRateLimiter(
                clock, 100, 100, 1, 1, "");
        EnvironmentalDataService service = new EnvironmentalDataService(client, clock, limiter);

        service.getStationForecast(37.5665, 126.9780, "20260712", "0200");

        assertThrows(RateLimitExceededException.class,
                () -> service.getStationForecast(35.1796, 129.0756, "20260712", "0200"));
        verify(client, times(1)).get(eq(FORECAST_PATH), anyMap());
    }

    @Test
    void airQualityMatchesFullProvinceNamesToShortAliases() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(MEASUREMENT_PATH), anyMap())).thenReturn(MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":[
                  {"stationName":"중앙동","sidoName":"전북특별자치도","dataTime":"2026-07-13 10:00",
                   "pm10Value":"20","pm25Value":"10"}
                ]}}}
                """));
        when(client.get(eq(STATION_PATH), anyMap())).thenReturn(MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":2,"items":[
                  {"stationName":"중앙동","addr":"서울특별시 테스트","dmX":"127","dmY":"37.5"},
                  {"stationName":"중앙동","addr":"전라북도 테스트","dmX":"127.1","dmY":"35.8"}
                ]}}}
                """));
        EnvironmentalDataService service = new EnvironmentalDataService(client,
                Clock.fixed(Instant.parse("2026-07-13T00:00:00Z"), ZoneOffset.UTC));

        AirQualityResponseDto response = service.getAirQuality(32, 44, 122, 134);

        assertEquals(1, response.stations().size());
        assertEquals("전라북도 테스트", response.stations().get(0).address());
    }

    @Test
    void airQualityRejectsAnAllNullNationwideSnapshot() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(MEASUREMENT_PATH), anyMap())).thenReturn(MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":[
                  {"stationName":"점검소","sidoName":"충북","dataTime":"2026-07-13 10:00",
                   "pm10Value":"-","pm25Value":"-","pm10Flag":"점검중","pm25Flag":"점검중"}
                ]}}}
                """));
        when(client.get(eq(STATION_PATH), anyMap())).thenReturn(MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":[
                  {"stationName":"점검소","addr":"충청북도 테스트","dmX":"127","dmY":"36"}
                ]}}}
                """));
        EnvironmentalDataService service = new EnvironmentalDataService(client,
                Clock.fixed(Instant.parse("2026-07-13T00:00:00Z"), ZoneOffset.UTC));

        assertThrows(ExternalDataUnavailableException.class,
                () -> service.getAirQuality(32, 44, 122, 134));
    }

    @Test
    void forecastAcceptsOnlyDocumentedShortTermPrecipitationTypeCodes() throws Exception {
        DataGoApiClient client = mock(DataGoApiClient.class);
        when(client.get(eq(FORECAST_PATH), anyMap())).thenReturn(MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":6,"items":{"item":[
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0300","fcstValue":"0"},
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0400","fcstValue":"1"},
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0500","fcstValue":"2"},
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0600","fcstValue":"3"},
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0700","fcstValue":"4"},
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0800","fcstValue":"5"}
                ]}}}}
                """));
        EnvironmentalDataService service = new EnvironmentalDataService(client,
                Clock.fixed(Instant.parse("2026-07-13T00:00:00Z"), ZoneOffset.UTC));

        StationForecastResponseDto response = service.getStationForecast(
                37.5665, 126.9780, "20260712", "0200");

        assertEquals(0, response.items().get(1).precipitationType());
        assertEquals("없음", response.items().get(1).precipitationTypeLabel());
        assertEquals("비", response.items().get(2).precipitationTypeLabel());
        assertEquals("비/눈", response.items().get(3).precipitationTypeLabel());
        assertEquals("눈", response.items().get(4).precipitationTypeLabel());
        assertEquals("소나기", response.items().get(5).precipitationTypeLabel());
        assertNull(response.items().get(6).precipitationType());
        assertNull(response.items().get(6).precipitationTypeLabel());
    }

    private static JsonNode forecastFixture() throws Exception {
        return MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":11,"items":{"item":[
                  {"category":"TMP","fcstDate":"20260712","fcstTime":"0300","fcstValue":"-3.2"},
                  {"category":"REH","fcstDate":"20260712","fcstTime":"0300","fcstValue":"85"},
                  {"category":"POP","fcstDate":"20260712","fcstTime":"0300","fcstValue":"0"},
                  {"category":"PCP","fcstDate":"20260712","fcstTime":"0300","fcstValue":"1.0mm 미만"},
                  {"category":"SNO","fcstDate":"20260712","fcstTime":"0300","fcstValue":"적설없음"},
                  {"category":"SKY","fcstDate":"20260712","fcstTime":"0300","fcstValue":"3"},
                  {"category":"PTY","fcstDate":"20260712","fcstTime":"0300","fcstValue":"0"},
                  {"category":"WAV","fcstDate":"20260712","fcstTime":"0300","fcstValue":"1.4"},
                  {"category":"WAV","fcstDate":"20260712","fcstTime":"0400","fcstValue":"9999"},
                  {"category":"WSD","fcstDate":"20260712","fcstTime":"0300","fcstValue":"2.5"},
                  {"category":"VEC","fcstDate":"20260712","fcstTime":"0300","fcstValue":"270"}
                ]}}}}
                """);
    }

    private static JsonNode measurementFixture() throws Exception {
        return MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":2,"items":[
                  {"stationName":"종로구","sidoName":"서울","mangName":"도시대기","dataTime":"2026-07-13 09:00",
                   "pm10Value":"42","pm25Value":"18","pm10Grade1h":"-","pm25Grade1h":"2",
                   "pm10Flag":"점검및교정","pm25Flag":"-"},
                  {"stationName":"청룡동","sidoName":"부산","mangName":"도시대기","dataTime":"2026-07-13 08:00",
                   "pm10Value":"31","pm25Value":"11","pm10Grade":"1","pm25Grade":"1",
                   "pm10Flag":"","pm25Flag":""}
                ]}}}
                """);
    }

    private static JsonNode stationFixture() throws Exception {
        return MAPPER.readTree("""
                {"response":{"header":{"resultCode":"00"},"body":{"totalCount":2,"items":[
                  {"stationName":"종로구","addr":"서울특별시 종로구","mangName":"도시대기",
                   "dmX":"37.572025","dmY":"127.005028"},
                  {"stationName":"청룡동","addr":"부산광역시 금정구","mangName":"도시대기",
                   "dmX":"129.0","dmY":"35.2"}
                ]}}}
                """);
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
