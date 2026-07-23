package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AirQualityFeedContractTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void normalizesDocumentedMeasurementsAndUsesOnlyHourlyGrades() throws Exception {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        when(gateway.request(eq(PublicDataGateway.Dataset.AIR_QUALITY), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"00"},"body":{"totalCount":3,"items":[
                          {"stationName":"종로구","sidoName":"서울","mangName":"도시대기",
                           "dataTime":"2026-07-22 09:00","pm10Value":"42","pm25Value":"18",
                           "pm10Grade1h":"-","pm25Grade1h":"2","pm10Grade":"4",
                           "pm10Flag":"점검및교정","pm25Flag":"-"},
                          {"stationName":"청룡동","sidoName":"부산","dataTime":"2026-07-22 08:00",
                           "pm10Value":"31","pm25Value":"11","pm10Grade":"1","pm25Grade":"1"},
                          {"stationName":"손상","dataTime":"2026/07/22 09:00","pm10Value":"20"}
                        ]}}}
                        """));
        AirQualityFeed feed = new AirQualityFeed(gateway);

        var measurements = feed.fetchMeasurements();

        assertEquals(2, measurements.size());
        assertEquals(42.0, measurements.get(0).pm10());
        assertNull(measurements.get(0).pm10Grade());
        assertEquals(2, measurements.get(0).pm25Grade());
        assertEquals("점검및교정", measurements.get(0).pm10Flag());
        assertNull(measurements.get(0).pm25Flag());
        assertNull(measurements.get(1).pm10Grade(), "24-hour grade must not replace 1-hour grade");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> query = ArgumentCaptor.forClass(Map.class);
        verify(gateway).request(eq(PublicDataGateway.Dataset.AIR_QUALITY), query.capture());
        assertEquals(Map.of("returnType", "json", "sidoName", "전국", "ver", "1.3",
                "pageNo", 1, "numOfRows", 1_000), query.getValue());
    }

    @Test
    void acceptsDocumentedCoordinatesAndUnambiguousLegacyCoordinateOrder() throws Exception {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        when(gateway.request(eq(PublicDataGateway.Dataset.AIR_STATIONS), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"00"},"body":{"totalCount":3,"items":{"item":[
                          {"stationName":"종로구","addr":"서울특별시 종로구","mangName":"도시대기",
                           "dmX":"37.572025","dmY":"127.005028"},
                          {"stationName":"청룡동","addr":"부산광역시 금정구",
                           "dmX":"129.0","dmY":"35.2"},
                          {"stationName":"국외","addr":"범위 밖","dmX":"10","dmY":"10"}
                        ]}}}}
                        """));
        AirQualityFeed feed = new AirQualityFeed(gateway);

        var stations = feed.fetchStations();

        assertEquals(2, stations.size());
        assertEquals(37.572025, stations.get(0).latitude());
        assertEquals(127.005028, stations.get(0).longitude());
        assertEquals(35.2, stations.get(1).latitude());
        assertEquals(129.0, stations.get(1).longitude());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> query = ArgumentCaptor.forClass(Map.class);
        verify(gateway).request(eq(PublicDataGateway.Dataset.AIR_STATIONS), query.capture());
        assertEquals(Map.of("returnType", "json", "ver", "1.1",
                "pageNo", 1, "numOfRows", 1_000), query.getValue());
    }

    @Test
    void rejectsProviderErrorsEmptyPagesAndTruncatedPagination() throws Exception {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        AirQualityFeed feed = new AirQualityFeed(gateway);

        when(gateway.request(eq(PublicDataGateway.Dataset.AIR_QUALITY), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"03"},"body":{"totalCount":1}}}
                        """));
        assertThrows(UpstreamUnavailableException.class, feed::fetchMeasurements);

        when(gateway.request(eq(PublicDataGateway.Dataset.AIR_QUALITY), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"00"},"body":{"totalCount":1001,"items":[
                          {"stationName":"종로구","dataTime":"2026-07-22 09:00","pm10Value":"42"}
                        ]}}}
                        """));
        assertThrows(UpstreamUnavailableException.class, feed::fetchMeasurements);

        when(gateway.request(eq(PublicDataGateway.Dataset.AIR_STATIONS), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":[]}}}
                        """));
        assertThrows(UpstreamUnavailableException.class, feed::fetchStations);
    }
}
