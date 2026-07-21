package io.github.easygap.weathergrid.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"weather-grid.demo-mode=true", "kma.api.auth-key="})
class GeoJsonStaticResourceTest {

    @Value("${local.server.port}")
    private int port;

    @Test
    void servesGeoJsonWithStandardMimeTypeAndGzipCompression() throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port
                        + "/static/data/geodata/east-asia-land.geojson"))
                .header("Accept-Encoding", "gzip")
                .GET()
                .build();

        HttpResponse<byte[]> response = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofByteArray());

        assertEquals(200, response.statusCode());
        assertEquals("gzip", response.headers().firstValue("content-encoding").orElse(null));
        assertTrue(response.headers().firstValue("content-type")
                .orElse("")
                .startsWith("application/geo+json"));
        assertTrue(unzip(response.body()).contains("\"id\":\"east-asia-land\""));
    }

    private String unzip(byte[] compressed) throws IOException {
        try (GZIPInputStream input = new GZIPInputStream(new ByteArrayInputStream(compressed))) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
