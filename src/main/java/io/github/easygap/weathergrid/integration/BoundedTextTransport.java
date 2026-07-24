package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** Declared and streamed byte limits for upstream plain-text products. */
final class BoundedTextTransport {

    private static final Duration TOTAL_TIMEOUT = Duration.ofSeconds(35);

    private final WebClient http;
    private final int byteLimit;

    BoundedTextTransport(WebClient http, int byteLimit) {
        if (byteLimit < 1) throw new IllegalArgumentException("byteLimit must be positive");
        this.http = http;
        this.byteLimit = byteLimit;
    }

    String get(URI uri) {
        try {
            TextBody body = http.get()
                    .uri(uri)
                    .accept(MediaType.TEXT_PLAIN, MediaType.APPLICATION_OCTET_STREAM)
                    .exchangeToMono(this::readBody)
                    .block(TOTAL_TIMEOUT);
            if (body == null || body.bytes.length == 0) throw new TransportFailure();

            String text = new String(body.bytes, body.charset);
            String leading = text.stripLeading();
            if (leading.isEmpty() || leading.startsWith("{") || leading.startsWith("<")
                    || leading.regionMatches(true, 0, "# ERROR", 0, 7)) {
                throw new TransportFailure();
            }
            return text;
        } catch (Exception ignored) {
            // WebClient failures can contain the credential-bearing URI; never retain the cause.
            throw new UpstreamUnavailableException();
        }
    }

    private Mono<TextBody> readBody(ClientResponse response) {
        if (!response.statusCode().is2xxSuccessful()) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        long declaredBytes = response.headers().contentLength().orElse(-1L);
        if (declaredBytes == 0 || declaredBytes > byteLimit) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        Charset charset = response.headers().contentType()
                .flatMap(mediaType -> java.util.Optional.ofNullable(mediaType.getCharset()))
                .orElse(StandardCharsets.UTF_8);
        return DataBufferUtils.join(response.bodyToFlux(DataBuffer.class), byteLimit)
                .map(buffer -> {
                    try {
                        byte[] bytes = new byte[buffer.readableByteCount()];
                        buffer.read(bytes);
                        return new TextBody(bytes, charset);
                    } finally {
                        DataBufferUtils.release(buffer);
                    }
                })
                .switchIfEmpty(Mono.error(new TransportFailure()));
    }

    private record TextBody(byte[] bytes, Charset charset) {
    }

    private static final class TransportFailure extends RuntimeException {
    }
}
