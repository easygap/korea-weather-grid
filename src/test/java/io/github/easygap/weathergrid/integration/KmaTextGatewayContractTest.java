package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.KmaClientProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.util.KimGridGeometry;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KmaTextGatewayContractTest {

    private static final String BASE_URL = "https://apihub.kma.go.kr";

    @Test
    void buildsTheDocumentedDfsRequestAndEncodesCredentialOnce() {
        AtomicReference<ClientRequest> captured = new AtomicReference<>();
        KmaTextGateway gateway = gateway("raw+key/=", responding(captured, HttpStatus.OK, "1 2 3"));

        assertEquals("1 2 3", gateway.downloadDfsGrid("2026072214", "2026072215", "TMP"));

        URI uri = captured.get().url();
        assertEquals("/api/typ01/cgi-bin/url/nph-dfs_shrt_grd", uri.getPath());
        assertTrue(uri.getRawQuery().contains("tmfc=2026072214"));
        assertTrue(uri.getRawQuery().contains("tmef=2026072215"));
        assertTrue(uri.getRawQuery().contains("vars=TMP"));
        assertTrue(uri.getRawQuery().contains("authKey=raw%2Bkey%2F%3D"));
        assertFalse(uri.getRawQuery().contains("raw+key"));
    }

    @Test
    void usesTheCurrentStandardizedKimEndpointAndFixedSolarProduct() {
        AtomicReference<ClientRequest> captured = new AtomicReference<>();
        KmaTextGateway gateway = gateway("key", responding(captured, HttpStatus.OK, "# grid\n0"));

        assertEquals("# grid\n0",
                gateway.downloadSurfaceSolarGrid("2026072212", 138, "dswrsfc"));

        URI uri = captured.get().url();
        assertEquals("/api/typ06/cgi-bin/url/nph-kim_nc_xy_txt2_std", uri.getPath());
        String query = uri.getRawQuery();
        for (String fixed : new String[]{
                "group=KIMG", "nwp=NE57", "data=U", "name=dswrsfc", "level=0",
                "map=S", "sm=0", "tmfc=2026072212", "hf=138", "disp=A", "help=0"}) {
            assertTrue(query.contains(fixed), fixed);
        }
        assertTrue(query.contains("sub=" + KimGridGeometry.SUBSET_QUERY)
                || query.contains("sub=" + KimGridGeometry.SUBSET_QUERY.replace(",", "%2C")));
    }

    @Test
    void rejectsUnsupportedProductsAndTimesBeforeNetworkUse() {
        AtomicInteger calls = new AtomicInteger();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("grid").build());
        }).build();
        KmaTextGateway gateway = gateway("key", http);

        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadDfsGrid("2026072204", "2026072205", "TMP"));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadDfsGrid("2026072214", "2026072213", "TMP"));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadDfsGrid("2026072214", "2026072215", "SCRIPT"));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadDfsGrid("2026072214", "2026072215", null));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadSurfaceSolarGrid("2026072203", 6, "dswrsfc"));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadSurfaceSolarGrid("2026072212", 136, "dswrsfc"));
        assertThrows(IllegalArgumentException.class,
                () -> gateway.downloadSurfaceSolarGrid("2026072212", 6, "t2m"));
        assertEquals(0, calls.get());
    }

    @Test
    void rejectsMissingOrPreEncodedCredentialsWithoutLeakingFailureDetails() {
        AtomicInteger calls = new AtomicInteger();
        WebClient http = WebClient.builder().exchangeFunction(request -> {
            calls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK).body("grid").build());
        }).build();

        assertNull(gateway("", http).downloadDfsGrid("2026072214", "2026072215", "WSD"));
        assertThrows(IllegalArgumentException.class, () -> gateway("encoded%2Bkey", http));
        assertEquals(0, calls.get());

        UpstreamUnavailableException failure = assertThrows(UpstreamUnavailableException.class,
                () -> new BoundedTextTransport(
                        responding(new AtomicReference<>(), HttpStatus.BAD_GATEWAY, "upstream-secret"), 100)
                        .get(URI.create(BASE_URL + "/grid?authKey=never-print-this")));
        assertNull(failure.getCause());
        assertFalse(failure.getMessage().contains("never-print-this"));
    }

    @Test
    void discardsStatusFailuresErrorDocumentsAndOversizedBodies() {
        assertNull(gateway("key", responding(new AtomicReference<>(), HttpStatus.FORBIDDEN, "denied"))
                .downloadDfsGrid("2026072214", "2026072215", "REH"));
        assertNull(gateway("key", responding(new AtomicReference<>(), HttpStatus.OK,
                        "{\"status\":403,\"message\":\"denied\"}"))
                .downloadDfsGrid("2026072214", "2026072215", "REH"));

        WebClient declaredOversize = WebClient.builder().exchangeFunction(request -> Mono.just(
                ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_LENGTH,
                                Integer.toString(KmaTextGateway.MAX_RESPONSE_BYTES + 1))
                        .body("grid")
                        .build())).build();
        assertNull(gateway("key", declaredOversize)
                .downloadDfsGrid("2026072214", "2026072215", "REH"));

        String actualOversize = "x".repeat(KmaTextGateway.MAX_RESPONSE_BYTES + 1);
        assertNull(gateway("key", responding(new AtomicReference<>(), HttpStatus.OK, actualOversize))
                .downloadDfsGrid("2026072214", "2026072215", "REH"));
    }

    private static KmaTextGateway gateway(String credential, WebClient http) {
        return new KmaTextGateway(new KmaClientProperties(BASE_URL, credential), http);
    }

    private static WebClient responding(AtomicReference<ClientRequest> captured,
                                        HttpStatus status, String body) {
        return WebClient.builder().exchangeFunction(request -> {
            captured.set(request);
            return Mono.just(ClientResponse.create(status).body(body).build());
        }).build();
    }
}
