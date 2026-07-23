package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.UpstreamApiProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublicDataGatewayContractTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final URI BASE_URL = URI.create("https://apis.data.go.kr");

    @Test
    void buildsOnlyTheDocumentedAirQualityRequestAndEncodesValuesOnce() {
        AtomicReference<ClientRequest> captured = new AtomicReference<>();
        WebClient http = responding(captured, HttpStatus.OK,
                "{\"response\":{\"header\":{\"resultCode\":\"00\"}}}");
        PublicDataGateway gateway = gateway("raw+key/=", http);
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("returnType", "json");
        parameters.put("sidoName", "전국");
        parameters.put("ver", "1.3");
        parameters.put("pageNo", 1);
        parameters.put("numOfRows", 1000);

        assertEquals("00", gateway.request(PublicDataGateway.Dataset.AIR_QUALITY, parameters)
                .path("response").path("header").path("resultCode").asString());

        URI uri = captured.get().url();
        assertEquals("/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty", uri.getPath());
        assertTrue(uri.getRawQuery().contains("serviceKey=raw%2Bkey%2F%3D"));
        assertTrue(uri.getRawQuery().contains("sidoName=%EC%A0%84%EA%B5%AD"));
        assertFalse(uri.getRawQuery().contains("raw+key"));
    }

    @Test
    void rejectsUnknownParametersAndPreEncodedCredentialsBeforeNetworkUse() {
        AtomicInteger calls = new AtomicInteger();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("{}").build());
        }).build();
        PublicDataGateway gateway = gateway("raw-key", http);

        assertThrows(IllegalArgumentException.class, () -> gateway.request(
                PublicDataGateway.Dataset.AIR_STATIONS, Map.of("redirect", "https://example.com")));
        assertThrows(IllegalArgumentException.class, () -> gateway("encoded%2Bkey", http));
        assertEquals(0, calls.get());
    }

    @Test
    void mapsMissingCredentialsHttpFailuresAndOversizedBodiesToOneSanitizedError() {
        UpstreamUnavailableException missing = assertThrows(UpstreamUnavailableException.class,
                () -> gateway("", responding(new AtomicReference<>(), HttpStatus.OK, "{}"))
                        .request(PublicDataGateway.Dataset.AIR_STATIONS, Map.of()));
        assertNull(missing.getCause());

        UpstreamUnavailableException failed = assertThrows(UpstreamUnavailableException.class,
                () -> gateway("key", responding(new AtomicReference<>(), HttpStatus.BAD_GATEWAY, "secret"))
                        .request(PublicDataGateway.Dataset.AIR_STATIONS, Map.of()));
        assertNull(failed.getCause());

        WebClient oversized = WebClient.builder().exchangeFunction(request -> Mono.just(
                ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_LENGTH,
                                Integer.toString(PublicDataGateway.MAX_RESPONSE_BYTES + 1))
                        .body("{}")
                        .build())).build();
        UpstreamUnavailableException tooLarge = assertThrows(UpstreamUnavailableException.class,
                () -> gateway("key", oversized)
                        .request(PublicDataGateway.Dataset.AIR_STATIONS, Map.of()));
        assertNull(tooLarge.getCause());
    }

    private static PublicDataGateway gateway(String credential, WebClient http) {
        return new PublicDataGateway(JSON,
                new UpstreamApiProperties.Endpoint(BASE_URL, credential), http);
    }

    private static WebClient responding(AtomicReference<ClientRequest> captured,
                                        HttpStatus status, String body) {
        return WebClient.builder().exchangeFunction(request -> {
            captured.set(request);
            return Mono.just(ClientResponse.create(status).body(body).build());
        }).build();
    }
}
