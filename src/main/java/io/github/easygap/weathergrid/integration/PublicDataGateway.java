package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.UpstreamApiProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import org.springframework.web.util.UriBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** 승인한 공공데이터포털 세 API만 호출할 수 있는 JSON gateway. */
@Component
public final class PublicDataGateway {

    static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

    private final DefaultUriBuilderFactory uris;
    private final ApiCredential credential;
    private final BoundedJsonTransport transport;

    @Autowired
    public PublicDataGateway(ObjectMapper json,
                             UpstreamApiProperties properties,
                             @Qualifier("publicDataWebClient") WebClient http) {
        this(json, properties.publicData(), http);
    }

    PublicDataGateway(ObjectMapper json, UpstreamApiProperties.Endpoint endpoint, WebClient http) {
        uris = new DefaultUriBuilderFactory(endpoint.baseUrl().toASCIIString());
        uris.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.TEMPLATE_AND_VALUES);
        credential = new ApiCredential(endpoint.credential());
        transport = new BoundedJsonTransport(json, http, MAX_RESPONSE_BYTES);
    }

    public JsonNode request(Dataset dataset, Map<String, ?> parameters) {
        if (dataset == null || parameters == null || !dataset.allowedParameters.containsAll(parameters.keySet())) {
            throw new IllegalArgumentException("Unsupported public-data request");
        }

        UriBuilder builder = uris.builder().path(dataset.path)
                .queryParam("serviceKey", "{credential}");
        Map<String, Object> variables = new LinkedHashMap<>();
        variables.put("credential", credential.requiredValue());

        int index = 0;
        for (Map.Entry<String, ?> parameter : parameters.entrySet()) {
            String placeholder = "value" + index++;
            builder.queryParam(parameter.getKey(), "{" + placeholder + "}");
            variables.put(placeholder, scalar(parameter.getValue()));
        }
        return transport.get(builder.build(variables));
    }

    private static String scalar(Object value) {
        if (!(value instanceof CharSequence || value instanceof Number || value instanceof Boolean)) {
            throw new IllegalArgumentException("Query values must be scalar");
        }
        String text = value.toString();
        if (text.isEmpty() || text.length() > 200
                || text.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Invalid query value");
        }
        return text;
    }

    public enum Dataset {
        VILLAGE_FORECAST(
                "/1360000/VilageFcstInfoService_2.0/getVilageFcst",
                Set.of("dataType", "base_date", "base_time", "nx", "ny", "pageNo", "numOfRows")),
        AIR_QUALITY(
                "/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
                Set.of("returnType", "sidoName", "ver", "pageNo", "numOfRows")),
        AIR_STATIONS(
                "/B552584/MsrstnInfoInqireSvc/getMsrstnList",
                Set.of("returnType", "ver", "pageNo", "numOfRows"));

        private final String path;
        private final Set<String> allowedParameters;

        Dataset(String path, Set<String> allowedParameters) {
            this.path = path;
            this.allowedParameters = allowedParameters;
        }
    }
}
