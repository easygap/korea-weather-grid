package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDateTime;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VillageForecastFeedContractTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void decodesDocumentedRowsAndBuildsOneBoundedRequest() throws Exception {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        when(gateway.request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"00"},"body":{"totalCount":5,
                          "items":{"item":[
                            {"category":"TMP","fcstDate":"20260722","fcstTime":"0300","fcstValue":"0"},
                            {"category":"PCP","fcstDate":"20260722","fcstTime":"0400","fcstValue":"1.0mm 미만"},
                            {"category":"PTY","fcstDate":"20260722","fcstTime":"0500","fcstValue":"1"},
                            {"category":"UNKNOWN","fcstDate":"20260722","fcstTime":"0600","fcstValue":"7"},
                            {"category":"WSD","fcstDate":"bad","fcstTime":"0700","fcstValue":"2"}
                          ]}}}}
                        """));
        VillageForecastFeed feed = new VillageForecastFeed(gateway);

        var values = feed.fetch("20260722", "0200", 60, 127);

        assertEquals(3, values.size());
        assertEquals(new VillageForecastFeed.Value(
                VillageForecastFeed.Category.TEMPERATURE,
                LocalDateTime.of(2026, 7, 22, 3, 0), "0"), values.get(0));
        assertEquals(VillageForecastFeed.Category.PRECIPITATION_AMOUNT,
                values.get(1).category());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> query = ArgumentCaptor.forClass(Map.class);
        verify(gateway).request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), query.capture());
        assertEquals(Map.of(
                "dataType", "JSON", "base_date", "20260722", "base_time", "0200",
                "nx", 60, "ny", 127, "pageNo", 1, "numOfRows", 1_000), query.getValue());
    }

    @Test
    void rejectsTruncatedProviderErrorsAndQueriesOutsideThePublicContract() throws Exception {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        VillageForecastFeed feed = new VillageForecastFeed(gateway);

        assertThrows(IllegalArgumentException.class,
                () -> feed.fetch("20260230", "0200", 60, 127));
        assertThrows(IllegalArgumentException.class,
                () -> feed.fetch("20260722", "0300", 60, 127));
        assertThrows(IllegalArgumentException.class,
                () -> feed.fetch("20260722", "0200", 0, 127));
        verify(gateway, never()).request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap());

        when(gateway.request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"00"},"body":{"totalCount":2,
                          "items":{"item":[
                            {"category":"TMP","fcstDate":"20260722","fcstTime":"0300","fcstValue":"1"}
                          ]}}}}
                        """));
        assertThrows(UpstreamUnavailableException.class,
                () -> feed.fetch("20260722", "0200", 60, 127));

        when(gateway.request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap()))
                .thenReturn(JSON.readTree("""
                        {"response":{"header":{"resultCode":"03"},"body":{"totalCount":1}}}
                        """));
        assertThrows(UpstreamUnavailableException.class,
                () -> feed.fetch("20260722", "0200", 60, 127));
    }
}
