package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.time.Duration;

/** 상태 코드와 선언·실제 크기를 모두 제한한 JSON 전송기. 요청 URI를 오류에 포함하지 않는다. */
final class BoundedJsonTransport {

    private static final Duration TOTAL_TIMEOUT = Duration.ofSeconds(15);

    private final ObjectMapper json;
    private final WebClient http;
    private final int byteLimit;

    BoundedJsonTransport(ObjectMapper json, WebClient http, int byteLimit) {
        if (byteLimit < 1) throw new IllegalArgumentException("byteLimit must be positive");
        this.json = json;
        this.http = http;
        this.byteLimit = byteLimit;
    }

    JsonNode get(URI uri) {
        try {
            byte[] body = http.get()
                    .uri(uri)
                    .accept(MediaType.APPLICATION_JSON)
                    .exchangeToMono(this::readBody)
                    .block(TOTAL_TIMEOUT);
            if (body == null || body.length == 0) throw new TransportFailure();
            JsonNode root = json.readTree(body);
            if (root == null || !root.isObject()) throw new TransportFailure();
            return root;
        } catch (Exception ignored) {
            // WebClient 예외는 자격 증명이 포함된 URI를 가질 수 있으므로 원인을 외부로 전달하지 않는다.
            throw new UpstreamUnavailableException();
        }
    }

    private Mono<byte[]> readBody(ClientResponse response) {
        if (!response.statusCode().is2xxSuccessful()) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        long declaredBytes = response.headers().contentLength().orElse(-1L);
        if (declaredBytes == 0 || declaredBytes > byteLimit) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        return DataBufferUtils.join(response.bodyToFlux(DataBuffer.class), byteLimit)
                .map(buffer -> {
                    try {
                        byte[] bytes = new byte[buffer.readableByteCount()];
                        buffer.read(bytes);
                        return bytes;
                    } finally {
                        DataBufferUtils.release(buffer);
                    }
                })
                .switchIfEmpty(Mono.error(new TransportFailure()));
    }

    private static final class TransportFailure extends RuntimeException {
    }
}
