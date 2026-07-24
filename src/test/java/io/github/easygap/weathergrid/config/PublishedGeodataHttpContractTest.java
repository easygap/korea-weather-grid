package io.github.easygap.weathergrid.config;

import io.github.easygap.weathergrid.WeatherGridRuntime;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;
import java.util.zip.GZIPInputStream;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(classes = WeatherGridRuntime.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"weather-grid.demo-mode=true", "kma.api.auth-key="})
class PublishedGeodataHttpContractTest {

    private static final ObjectMapper JSON = JsonMapper.builder().build();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @LocalServerPort
    private int port;

    @ParameterizedTest
    @MethodSource("publishedAssets")
    void publishedGeoJsonHasStableCompressedBytesSchemaAndCachePolicy(Asset asset) throws Exception {
        HttpResponse<byte[]> response = request(asset.path(), "gzip");
        byte[] representation = gunzip(response.body());
        JsonNode document = JSON.readTree(representation);

        assertEquals(200, response.statusCode());
        assertEquals("gzip", response.headers().firstValue("content-encoding").orElseThrow());
        assertTrue(response.headers().firstValue("content-type").orElseThrow()
                .startsWith("application/geo+json"));
        assertCachePolicy(response);
        assertEquals(asset.bytes(), representation.length);
        assertEquals(asset.sha256(), sha256(representation));
        assertEquals("FeatureCollection", document.path("type").asString());
        assertEquals("weather-grid.geojson/v1", document.path("schema").asString());
        assertEquals(asset.id(), document.path("id").asString());
        assertEquals(asset.featureCount(), document.path("features").size());
    }

    @Test
    void manifestPublishesOnlyTheTwoVerifiedInitialAssets() throws Exception {
        HttpResponse<byte[]> response = request(
                "/static/data/geodata/manifest.json", "identity");
        JsonNode manifest = JSON.readTree(response.body());
        List<String> paths = new ArrayList<>();
        for (JsonNode asset : manifest.path("assets")) {
            paths.add(asset.path("path").asString());
        }

        assertEquals(200, response.statusCode());
        assertTrue(response.headers().firstValue("content-type").orElseThrow()
                .startsWith("application/json"));
        assertCachePolicy(response);
        assertEquals("weather-grid.geodata-manifest/v1", manifest.path("schema").asString());
        assertEquals(List.of(
                "/static/data/geodata/east-asia-land.geojson",
                "/static/data/geodata/korea-admin1.geojson"), paths);
        assertEquals("koreaAdmin2", manifest.path("unavailable").get(0).path("key").asString());
    }

    private HttpResponse<byte[]> request(String path, String acceptedEncoding)
            throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(baseUri().resolve(path))
                .header("Accept-Encoding", acceptedEncoding)
                .GET()
                .build();
        return HTTP.send(request, HttpResponse.BodyHandlers.ofByteArray());
    }

    private URI baseUri() {
        return URI.create("http://127.0.0.1:" + port);
    }

    private static void assertCachePolicy(HttpResponse<?> response) {
        String policy = response.headers().firstValue("cache-control").orElse("");
        assertTrue(policy.contains("max-age=86400"));
        assertTrue(policy.contains("public"));
        assertTrue(policy.contains("stale-while-revalidate=604800"));
    }

    private static byte[] gunzip(byte[] bytes) throws IOException {
        try (GZIPInputStream compressed = new GZIPInputStream(new ByteArrayInputStream(bytes))) {
            return compressed.readAllBytes();
        }
    }

    private static String sha256(byte[] bytes) throws NoSuchAlgorithmException {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static Stream<Asset> publishedAssets() {
        return Stream.of(
                new Asset("/static/data/geodata/east-asia-land.geojson", "east-asia-land", 9,
                        112_824, "8c2f48eb0bde331c9388d4292410858cfb1bab976e17f6a80ce949ea950eccf7"),
                new Asset("/static/data/geodata/korea-admin1.geojson", "korea-admin1", 17,
                        73_886, "48ce313ba5f708493f8b2f6e3a9ede38fd30a48e0451240dc89cb97666a77407"));
    }

    private record Asset(String path, String id, int featureCount, int bytes, String sha256) { }
}
