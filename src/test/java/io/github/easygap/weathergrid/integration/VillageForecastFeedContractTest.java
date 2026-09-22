package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
    void readsAll1052RowsFromAnEveningForecast() {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        List<Map<String, Object>> queries = new ArrayList<>();
        when(gateway.request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap()))
                .thenAnswer(invocation -> {
                    Map<String, Object> query = invocation.getArgument(1);
                    queries.add(Map.copyOf(query));
                    int page = (int) query.get("pageNo");
                    var rows = new ArrayList<Map<String, String>>();
                    for (int i = 0; i < (page == 1 ? 1_000 : 52); i++) {
                        rows.add(Map.of("category", page == 1 ? "TMP" : "REH",
                                "fcstDate", "20260922", "fcstTime", "1800",
                                "fcstValue", page == 1 ? "18" : "62"));
                    }
                    return JSON.valueToTree(Map.of("response", Map.of(
                            "header", Map.of("resultCode", "00"),
                            "body", Map.of("totalCount", 1_052, "items", Map.of("item", rows)))));
                });

        var values = new VillageForecastFeed(gateway).fetch("20260922", "1700", 98, 76);

        assertEquals(1_052, values.size());
        assertEquals(VillageForecastFeed.Category.HUMIDITY, values.get(1_051).category());
        assertEquals("62", values.get(1_051).rawValue());
        assertEquals(List.of(1, 2), queries.stream().map(query -> query.get("pageNo")).toList());
        assertEquals(List.of(1_000, 1_000), queries.stream().map(query -> query.get("numOfRows")).toList());
    }

    @Test
    void rejectsOversizedAndInconsistentPagination() {
        PublicDataGateway gateway = mock(PublicDataGateway.class);
        when(gateway.request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap()))
                .thenReturn(JSON.valueToTree(Map.of("response", Map.of(
                        "header", Map.of("resultCode", "00"),
                        "body", Map.of("totalCount", 2_001, "items", List.of())))));
        var feed = new VillageForecastFeed(gateway);
        assertThrows(UpstreamUnavailableException.class, () -> feed.fetch("20260922", "1700", 98, 76));
        verify(gateway, times(1)).request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap());

        when(gateway.request(eq(PublicDataGateway.Dataset.VILLAGE_FORECAST), anyMap()))
                .thenAnswer(invocation -> {
                    Map<String, Object> query = invocation.getArgument(1);
                    int page = (int) query.get("pageNo");
                    var row = Map.of("category", "TMP", "fcstDate", "20260922",
                            "fcstTime", "1800", "fcstValue", "18");
                    return JSON.valueToTree(Map.of("response", Map.of(
                            "header", Map.of("resultCode", "00"),
                            "body", Map.of("totalCount", page == 1 ? 1_052 : 1_053,
                                    "items", java.util.Collections.nCopies(page == 1 ? 1_000 : 52, row)))));
                });
        assertThrows(UpstreamUnavailableException.class, () -> feed.fetch("20260922", "1700", 98, 76));
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
