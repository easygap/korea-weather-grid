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
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ItsApiClientTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void sendsOnlyFixedCctvParametersAndEncodesKeyExactlyOnce() {
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
        ItsApiClient client = new ItsApiClient(
                MAPPER, "test+key/with==", webClient);

        client.getCctv(37.0, 37.25, 126.75, 127.0);

        URI uri = capturedUri.get();
        assertEquals("/cctvInfo", uri.getPath());
        assertFalse(uri.getRawQuery().contains("%25"));
        Map<String, String> query = Arrays.stream(uri.getRawQuery().split("&"))
                .map(value -> value.split("=", 2))
                .collect(Collectors.toMap(
                        value -> value[0],
                        value -> URLDecoder.decode(value.length == 2 ? value[1] : "",
                                StandardCharsets.UTF_8)));
        assertEquals(Map.of(
                "apiKey", "test+key/with==",
                "type", "all",
                "cctvType", "4",
                "minX", "126.75",
                "maxX", "127.0",
                "minY", "37.0",
                "maxY", "37.25",
                "getType", "json"), query);
    }

    @Test
    void rejectsMissingEncodedOverlongOrControlCharacterKeysBeforeRequest() {
        AtomicInteger requests = new AtomicInteger();
        WebClient webClient = WebClient.builder()
                .baseUrl("https://example.test")
                .exchangeFunction(request -> {
                    requests.incrementAndGet();
                    throw new AssertionError("request must not be sent");
                })
                .build();

        assertThrows(ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, "", webClient)
                        .getCctv(37, 37.25, 126.75, 127));
        assertThrows(ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, "encoded%2Bkey", webClient)
                        .getCctv(37, 37.25, 126.75, 127));
        assertThrows(ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, "plain%key", webClient)
                        .getCctv(37, 37.25, 126.75, 127));
        assertThrows(ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, "a".repeat(513), webClient)
                        .getCctv(37, 37.25, 126.75, 127));
        assertThrows(ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, "key\nvalue", webClient)
                        .getCctv(37, 37.25, 126.75, 127));
        assertEquals(0, requests.get());
    }

    @Test
    void rejectsOversizedOrFailedResponsesWithoutLeakingTheKey() {
        String key = "sensitive-test-key";
        WebClient oversized = WebClient.builder()
                .baseUrl("https://example.test")
                .exchangeFunction(request -> Mono.just(ClientResponse.create(HttpStatus.OK)
                        .header("Content-Length",
                                Integer.toString(ItsApiClient.MAX_RESPONSE_BYTES + 1))
                        .body("{}")
                        .build()))
                .build();
        ExternalDataUnavailableException oversizedError = assertThrows(
                ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, key, oversized)
                        .getCctv(37, 37.25, 126.75, 127));
        assertFalse(oversizedError.toString().contains(key));

        WebClient failed = WebClient.builder()
                .baseUrl("https://example.test")
                .exchangeFunction(request -> Mono.just(ClientResponse.create(HttpStatus.FORBIDDEN)
                        .body("denied")
                        .build()))
                .build();
        ExternalDataUnavailableException failedError = assertThrows(
                ExternalDataUnavailableException.class,
                () -> new ItsApiClient(MAPPER, key, failed)
                        .getCctv(37, 37.25, 126.75, 127));
        assertFalse(failedError.toString().contains(key));
    }
}
