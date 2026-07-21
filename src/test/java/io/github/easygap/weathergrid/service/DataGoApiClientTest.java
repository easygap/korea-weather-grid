package io.github.easygap.weathergrid.service;

import tools.jackson.databind.json.JsonMapper;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class DataGoApiClientTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void encodesDecodedServiceKeyExactlyOnce() {
        AtomicReference<URI> capturedUri = new AtomicReference<>();
        WebClient webClient = WebClient.builder()
                .baseUrl("https://example.test")
                .exchangeFunction(request -> {
                    capturedUri.set(request.url());
                    return Mono.just(ClientResponse.create(HttpStatus.OK)
                            .body("{\"response\":{}}")
                            .build());
                })
                .build();
        DataGoApiClient client = new DataGoApiClient(
                MAPPER, "test+key/with==", webClient);

        client.get("/sample", Map.of("returnType", "json"));

        String rawQuery = capturedUri.get().getRawQuery();
        assertFalse(rawQuery.contains("%25"));
        String encodedKey = java.util.Arrays.stream(rawQuery.split("&"))
                .filter(value -> value.startsWith("serviceKey="))
                .findFirst()
                .orElseThrow()
                .substring("serviceKey=".length());
        assertEquals("test+key/with==",
                URLDecoder.decode(encodedKey, StandardCharsets.UTF_8));
    }

    @Test
    void rejectsAlreadyEncodedServiceKeyWithoutMakingRequest() {
        WebClient webClient = WebClient.builder()
                .baseUrl("https://example.test")
                .exchangeFunction(request -> {
                    throw new AssertionError("request must not be sent");
                })
                .build();
        DataGoApiClient client = new DataGoApiClient(
                MAPPER, "test%2Bkey%2Fwith%3D%3D", webClient);

        assertThrows(ExternalDataUnavailableException.class,
                () -> client.get("/sample", Map.of()));
    }
}
