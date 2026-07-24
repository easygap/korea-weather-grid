package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.UpstreamApiProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.Map;

/** ITS 공식 CCTV 계약의 HTTPS HLS 조회만 노출한다. */
@Component
public final class TrafficCameraGateway {

    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private final DefaultUriBuilderFactory uris;
    private final ApiCredential credential;
    private final BoundedJsonTransport transport;

    @Autowired
    public TrafficCameraGateway(ObjectMapper json,
                                UpstreamApiProperties properties,
                                @Qualifier("trafficCctvWebClient") WebClient http) {
        this(json, properties.trafficCctv(), http);
    }

    TrafficCameraGateway(ObjectMapper json, UpstreamApiProperties.Endpoint endpoint, WebClient http) {
        uris = new DefaultUriBuilderFactory(endpoint.baseUrl().toASCIIString());
        uris.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.TEMPLATE_AND_VALUES);
        credential = new ApiCredential(endpoint.credential());
        transport = new BoundedJsonTransport(json, http, MAX_RESPONSE_BYTES);
    }

    public JsonNode fetch(double south, double north, double west, double east) {
        Viewport viewport = new Viewport(south, north, west, east);
        URI uri = uris.builder()
                .queryParam("apiKey", "{credential}")
                .queryParam("type", "all")
                .queryParam("cctvType", "4")
                .queryParam("minX", "{west}")
                .queryParam("maxX", "{east}")
                .queryParam("minY", "{south}")
                .queryParam("maxY", "{north}")
                .queryParam("getType", "json")
                .build(Map.of(
                        "credential", credential.requiredValue(),
                        "west", Double.toString(viewport.west),
                        "east", Double.toString(viewport.east),
                        "south", Double.toString(viewport.south),
                        "north", Double.toString(viewport.north)));
        return transport.get(uri);
    }

    public record Viewport(double south, double north, double west, double east) {
        public Viewport {
            if (!Double.isFinite(south) || !Double.isFinite(north)
                    || !Double.isFinite(west) || !Double.isFinite(east)
                    || south < -90 || north > 90 || west < -180 || east > 180
                    || south >= north || west >= east) {
                throw new IllegalArgumentException("Invalid CCTV viewport");
            }
        }
    }
}
