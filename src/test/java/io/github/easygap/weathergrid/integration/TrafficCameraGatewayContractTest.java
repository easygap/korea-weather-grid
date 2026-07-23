package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.UpstreamApiProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TrafficCameraGatewayContractTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final URI ENDPOINT = URI.create("https://openapi.its.go.kr:9443/cctvInfo");

    @Test
    void fixesTheOfficialHttpsHlsAndJsonParametersAroundAValidatedViewport() {
        AtomicReference<ClientRequest> captured = new AtomicReference<>();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            captured.set(request);
            return Mono.just(ClientResponse.create(HttpStatus.OK)
                    .body("{\"response\":{\"datacount\":0,\"data\":[]}}")
                    .build());
        }).build();
        TrafficCameraGateway gateway = gateway("plain+key", http);

        assertEquals(0, gateway.fetch(37.0, 37.25, 126.75, 127.0)
                .path("response").path("datacount").asInt());

        URI uri = captured.get().url();
        assertEquals("/cctvInfo", uri.getPath());
        String query = uri.getRawQuery();
        assertTrue(query.contains("apiKey=plain%2Bkey"));
        assertTrue(query.contains("type=all"));
        assertTrue(query.contains("cctvType=4"));
        assertTrue(query.contains("minX=126.75"));
        assertTrue(query.contains("maxX=127.0"));
        assertTrue(query.contains("minY=37.0"));
        assertTrue(query.contains("maxY=37.25"));
        assertTrue(query.contains("getType=json"));
    }

    @Test
    void rejectsInvalidViewportAndCredentialWithoutCallingTheProvider() {
        AtomicInteger calls = new AtomicInteger();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("{}").build());
        }).build();
        TrafficCameraGateway gateway = gateway("key", http);

        assertThrows(IllegalArgumentException.class,
                () -> gateway.fetch(37.25, 37.0, 126.75, 127.0));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.fetch(37.0, 37.25, Double.NaN, 127.0));
        assertThrows(IllegalArgumentException.class, () -> gateway("key\nvalue", http));
        assertEquals(0, calls.get());
    }

    @Test
    void rejectsAChunkedBodyThatCrossesTheTwoMebibyteLimit() {
        String oversizedJson = "{\"payload\":\"" + "x".repeat(TrafficCameraGateway.MAX_RESPONSE_BYTES) + "\"}";
        WebClient http = WebClient.builder().exchangeFunction(request -> Mono.just(
                ClientResponse.create(HttpStatus.OK).body(oversizedJson).build())).build();

        UpstreamUnavailableException error = assertThrows(UpstreamUnavailableException.class,
                () -> gateway("key", http).fetch(37.0, 37.25, 126.75, 127.0));
        assertNull(error.getCause());
    }

    private static TrafficCameraGateway gateway(String credential, WebClient http) {
        return new TrafficCameraGateway(JSON,
                new UpstreamApiProperties.Endpoint(ENDPOINT, credential), http);
    }
}
