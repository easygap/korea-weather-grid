package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.KmaClientProperties;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KmaPointForecastGatewayContractTest {

    private static final String BASE_URL = "https://apihub.kma.go.kr";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void requestsOneDocumentedGridPointAndNormalizesSupportedValues() {
        AtomicReference<ClientRequest> captured = new AtomicReference<>();
        KmaPointForecastGateway gateway = gateway("raw+key/=", responding(captured, HttpStatus.OK, """
                {"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[
                  {"category":"TMP","fcstDate":"20260722","fcstTime":"0300","fcstValue":"0"},
                  {"category":"WSD","fcstDate":"20260722","fcstTime":"0400","fcstValue":"0"},
                  {"category":"VEC","fcstDate":"20260722","fcstTime":"0400","fcstValue":"360"},
                  {"category":"UUU","fcstDate":"20260722","fcstTime":"0400","fcstValue":"-1.5"},
                  {"category":"WSD","fcstDate":"20260722","fcstTime":"0500","fcstValue":"NaN"},
                  {"category":"POP","fcstDate":"20260722","fcstTime":"0500","fcstValue":"20"},
                  {"category":"TMP","fcstDate":"bad","fcstTime":"0500","fcstValue":"10"}
                ]}}}}
                """));

        List<KmaPointForecastGateway.ForecastValue> values =
                gateway.fetch("20260722", "0200", 60, 127);

        assertEquals(4, values.size());
        assertEquals(new KmaPointForecastGateway.ForecastValue(
                KmaPointForecastGateway.Category.TEMPERATURE,
                LocalDateTime.of(2026, 7, 22, 3, 0), 0), values.get(0));
        assertEquals(KmaPointForecastGateway.Category.EAST_WIND, values.get(3).category());

        URI uri = captured.get().url();
        assertEquals("/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst", uri.getPath());
        for (String query : new String[]{
                "pageNo=1", "numOfRows=1000", "dataType=JSON", "base_date=20260722",
                "base_time=0200", "nx=60", "ny=127", "authKey=raw%2Bkey%2F%3D"}) {
            assertTrue(uri.getRawQuery().contains(query), query);
        }
        assertFalse(uri.getRawQuery().contains("raw+key"));
    }

    @Test
    void rejectsInvalidReleaseAndCellBeforeNetworkUse() {
        AtomicInteger calls = new AtomicInteger();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("{}").build());
        }).build();
        KmaPointForecastGateway gateway = gateway("key", http);

        assertThrows(IllegalArgumentException.class,
                () -> gateway.fetch("20260230", "0200", 60, 127));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.fetch("20260722", "0300", 60, 127));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.fetch("20260722", "0200", 0, 127));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.fetch("20260722", "0200", 60, 254));
        assertEquals(0, calls.get());
    }

    @Test
    void convertsCredentialAndUpstreamFailuresToAnEmptyResult() {
        AtomicInteger calls = new AtomicInteger();
        WebClient neverCalled = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("{}").build());
        }).build();
        assertTrue(gateway("", neverCalled).fetch("20260722", "0200", 60, 127).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> gateway("encoded%2Bkey", neverCalled));
        assertEquals(0, calls.get());

        assertTrue(gateway("key", responding(new AtomicReference<>(), HttpStatus.FORBIDDEN, "denied"))
                .fetch("20260722", "0200", 60, 127).isEmpty());
        assertTrue(gateway("key", responding(new AtomicReference<>(), HttpStatus.OK,
                "{\"response\":{\"header\":{\"resultCode\":\"03\"}}}"))
                .fetch("20260722", "0200", 60, 127).isEmpty());

        WebClient oversized = WebClient.builder().exchangeFunction(request -> Mono.just(
                ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_LENGTH,
                                Integer.toString(KmaPointForecastGateway.MAX_RESPONSE_BYTES + 1))
                        .body("{}")
                        .build())).build();
        assertTrue(gateway("key", oversized).fetch("20260722", "0200", 60, 127).isEmpty());
    }

    private static KmaPointForecastGateway gateway(String credential, WebClient http) {
        return new KmaPointForecastGateway(
                JSON, new KmaClientProperties(BASE_URL, credential), http);
    }

    private static WebClient responding(AtomicReference<ClientRequest> captured,
                                        HttpStatus status, String body) {
        return WebClient.builder().exchangeFunction(request -> {
            captured.set(request);
            return Mono.just(ClientResponse.create(status).body(body).build());
        }).build();
    }
}
