package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.MapProviderProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.time.Duration;

/**
 * VWorld 자격 증명을 서버 경계 안에 유지하면서 검증된 지도 타일만 가져온다.
 */
@Component
public final class VworldTileGateway {

    private static final String UPSTREAM_ROOT = "https://api.vworld.kr/req/wmts/vector";
    private static final Duration TOTAL_TIMEOUT = Duration.ofSeconds(15);
    private static final byte[] PNG_SIGNATURE = {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    };

    private final MapProviderProperties providers;
    private final WebClient http;

    @Autowired
    public VworldTileGateway(
            MapProviderProperties providers,
            @Qualifier("vworldWebClient") WebClient http) {
        this.providers = providers;
        this.http = http;
    }

    public TileBody fetch(TileRequest tile) {
        if (!providers.vworldEnabled()) {
            throw new UpstreamUnavailableException();
        }
        URI uri = upstreamUri(providers.vworldApiKey(), tile);
        try {
            byte[] bytes = http.get()
                    .uri(uri)
                    .accept(tile.kind().mediaType())
                    .exchangeToMono(response -> readBody(response, tile.kind()))
                    .block(TOTAL_TIMEOUT);
            if (bytes == null || bytes.length == 0) throw new TransportFailure();
            return new TileBody(bytes, tile.kind().mediaType());
        } catch (Exception ignored) {
            // WebClient 예외에는 키가 포함된 요청 URI가 들어갈 수 있으므로 원인을 보존하지 않는다.
            throw new UpstreamUnavailableException();
        }
    }

    private static URI upstreamUri(String key, TileRequest tile) {
        String suffix = tile.zoom() + "/" + tile.x() + "/" + tile.y();
        String raw = tile.kind() == TileKind.BASE
                ? UPSTREAM_ROOT + "/" + key + "/Base/" + suffix + ".png"
                : UPSTREAM_ROOT + "/getTile/" + key + "/traffic/" + suffix + ".pbf";
        return URI.create(raw);
    }

    private static Mono<byte[]> readBody(ClientResponse response, TileKind kind) {
        if (!response.statusCode().is2xxSuccessful()) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        MediaType contentType = response.headers().contentType().orElse(null);
        if (!kind.accepts(contentType)) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        long declaredBytes = response.headers().contentLength().orElse(-1L);
        if (declaredBytes == 0 || declaredBytes > kind.maxBytes()) {
            return response.releaseBody().then(Mono.error(new TransportFailure()));
        }
        return DataBufferUtils.join(response.bodyToFlux(DataBuffer.class), kind.maxBytes())
                .map(buffer -> {
                    try {
                        byte[] bytes = new byte[buffer.readableByteCount()];
                        buffer.read(bytes);
                        if (bytes.length == 0
                                || kind == TileKind.BASE && !hasPngSignature(bytes)) {
                            throw new TransportFailure();
                        }
                        return bytes;
                    } finally {
                        DataBufferUtils.release(buffer);
                    }
                })
                .switchIfEmpty(Mono.error(new TransportFailure()));
    }

    private static boolean hasPngSignature(byte[] bytes) {
        if (bytes.length < PNG_SIGNATURE.length) return false;
        for (int index = 0; index < PNG_SIGNATURE.length; index++) {
            if (bytes[index] != PNG_SIGNATURE[index]) return false;
        }
        return true;
    }

    public enum TileKind {
        BASE(MediaType.IMAGE_PNG, 512 * 1024),
        TRAFFIC(MediaType.parseMediaType("application/x-protobuf"), 2 * 1024 * 1024);

        private static final MediaType VECTOR_TILE =
                MediaType.parseMediaType("application/vnd.mapbox-vector-tile");

        private final MediaType mediaType;
        private final int maxBytes;

        TileKind(MediaType mediaType, int maxBytes) {
            this.mediaType = mediaType;
            this.maxBytes = maxBytes;
        }

        public MediaType mediaType() {
            return mediaType;
        }

        int maxBytes() {
            return maxBytes;
        }

        boolean accepts(MediaType candidate) {
            if (candidate == null) return false;
            if (this == BASE) return MediaType.IMAGE_PNG.isCompatibleWith(candidate);
            return mediaType.isCompatibleWith(candidate)
                    || VECTOR_TILE.isCompatibleWith(candidate)
                    || MediaType.APPLICATION_OCTET_STREAM.isCompatibleWith(candidate);
        }
    }

    public record TileRequest(TileKind kind, int zoom, int x, int y) {
        public TileRequest {
            if (kind == null || zoom < 0 || zoom > 30 || x < 0 || y < 0) {
                throw new IllegalArgumentException("Invalid VWorld tile");
            }
        }
    }

    public record TileBody(byte[] bytes, MediaType contentType) {
        public TileBody {
            if (bytes == null || bytes.length == 0 || contentType == null) {
                throw new IllegalArgumentException("Invalid VWorld tile body");
            }
            bytes = bytes.clone();
        }

        @Override
        public byte[] bytes() {
            return bytes.clone();
        }
    }

    private static final class TransportFailure extends RuntimeException {
    }
}
