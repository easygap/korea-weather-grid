package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.MapProviderProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static io.github.easygap.weathergrid.integration.VworldTileGateway.TileKind.BASE;
import static io.github.easygap.weathergrid.integration.VworldTileGateway.TileKind.TRAFFIC;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class VworldTileGatewayContractTest {

    private static final String KEY = "12345678-1234-1234-1234-123456789abc";
    private static final byte[] PNG = {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1
    };

    @Test
    void buildsOnlyTheFixedVworldTileAddress() {
        AtomicReference<ClientRequest> captured = new AtomicReference<>();
        VworldTileGateway gateway = gateway(KEY,
                responding(captured, HttpStatus.OK, MediaType.IMAGE_PNG, PNG));

        VworldTileGateway.TileBody body = gateway.fetch(
                new VworldTileGateway.TileRequest(BASE, 7, 109, 49));

        assertArrayEquals(PNG, body.bytes());
        assertEquals(MediaType.IMAGE_PNG, body.contentType());
        assertEquals("/req/wmts/vector/" + KEY + "/Base/7/109/49.png",
                captured.get().url().getPath());
        assertNull(captured.get().url().getQuery());
    }

    @Test
    void refusesMissingKeysBeforeNetworkUse() {
        AtomicInteger calls = new AtomicInteger();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.error(new AssertionError("network must not be used"));
        }).build();

        UpstreamUnavailableException failure = assertThrows(UpstreamUnavailableException.class,
                () -> gateway("", http).fetch(
                        new VworldTileGateway.TileRequest(TRAFFIC, 7, 109, 49)));

        assertEquals(0, calls.get());
        assertNull(failure.getCause());
    }

    @Test
    void rejectsWrongTypesInvalidPngAndOversizedBodiesWithoutLeakingTheKey() {
        UpstreamUnavailableException wrongType = assertThrows(UpstreamUnavailableException.class,
                () -> gateway(KEY, responding(new AtomicReference<>(), HttpStatus.OK,
                        MediaType.TEXT_HTML, "<html>".getBytes())).fetch(
                        new VworldTileGateway.TileRequest(BASE, 7, 109, 49)));
        assertNull(wrongType.getCause());
        assertFalse(wrongType.getMessage().contains(KEY));

        assertThrows(UpstreamUnavailableException.class,
                () -> gateway(KEY, responding(new AtomicReference<>(), HttpStatus.OK,
                        MediaType.IMAGE_PNG, "not-png".getBytes())).fetch(
                        new VworldTileGateway.TileRequest(BASE, 7, 109, 49)));

        WebClient oversized = WebClient.builder().exchangeFunction(request -> Mono.just(
                ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_TYPE, MediaType.IMAGE_PNG_VALUE)
                        .header(HttpHeaders.CONTENT_LENGTH,
                                Integer.toString(512 * 1024 + 1))
                        .body(Flux.just(DefaultDataBufferFactory.sharedInstance.wrap(PNG)))
                        .build())).build();
        assertThrows(UpstreamUnavailableException.class,
                () -> gateway(KEY, oversized).fetch(
                        new VworldTileGateway.TileRequest(BASE, 7, 109, 49)));
    }

    private static VworldTileGateway gateway(String key, WebClient http) {
        return new VworldTileGateway(new MapProviderProperties(key), http);
    }

    private static WebClient responding(AtomicReference<ClientRequest> captured,
                                        HttpStatus status, MediaType contentType, byte[] body) {
        return WebClient.builder().exchangeFunction(request -> {
            captured.set(request);
            return Mono.just(ClientResponse.create(status)
                    .header(HttpHeaders.CONTENT_TYPE, contentType.toString())
                    .body(Flux.just(DefaultDataBufferFactory.sharedInstance.wrap(body)))
                    .build());
        }).build();
    }
}
