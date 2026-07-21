package io.github.easygap.weathergrid.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** 국가교통정보센터 CCTV 메타데이터 전용 클라이언트. */
@Component
public class ItsApiClient {

    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private static final String BASE_URL = "https://openapi.its.go.kr:9443";
    private static final String CCTV_PATH = "/cctvInfo";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(12);

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final String apiKey;

    @Autowired
    public ItsApiClient(ObjectMapper objectMapper,
                        @Value("${its.api-key:}") String apiKey) {
        this(objectMapper, apiKey, buildWebClient());
    }

    ItsApiClient(ObjectMapper objectMapper, String apiKey, WebClient webClient) {
        this.objectMapper = objectMapper;
        String raw = apiKey == null ? "" : apiKey;
        boolean controlCharacter = raw.chars().anyMatch(Character::isISOControl);
        String candidate = raw.trim();
        // 이미 URL 인코딩된 값을 다시 인코딩해 인증 실패하는 구성을 허용하지 않는다.
        this.apiKey = controlCharacter || raw.length() > 512 || candidate.contains("%")
                ? "" : candidate;
        this.webClient = webClient;
    }

    public JsonNode getCctv(double minLat, double maxLat,
                            double minLon, double maxLon) {
        if (apiKey.isBlank()) throw new ExternalDataUnavailableException();

        try {
            String body = webClient.get()
                    .uri(builder -> builder.path(CCTV_PATH)
                            .queryParam("apiKey", "{itsApiKey}")
                            .queryParam("type", "all")
                            .queryParam("cctvType", "4")
                            .queryParam("minX", minLon)
                            .queryParam("maxX", maxLon)
                            .queryParam("minY", minLat)
                            .queryParam("maxY", maxLat)
                            .queryParam("getType", "json")
                            .build(Map.of("itsApiKey", apiKey)))
                    .accept(MediaType.APPLICATION_JSON)
                    .exchangeToMono(response -> {
                        if (!response.statusCode().is2xxSuccessful()) {
                            return response.releaseBody().thenReturn("");
                        }
                        if (response.headers().contentLength().orElse(0) > MAX_RESPONSE_BYTES) {
                            return response.releaseBody().thenReturn("");
                        }
                        return response.bodyToMono(String.class);
                    })
                    .block(REQUEST_TIMEOUT);
            if (body == null || body.isBlank()
                    || body.getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE_BYTES) {
                throw new ExternalDataUnavailableException();
            }
            return objectMapper.readTree(body);
        } catch (ExternalDataUnavailableException e) {
            throw e;
        } catch (Exception ignored) {
            // WebClient 예외에는 인증키가 든 전체 URL이 포함될 수 있으므로 원인을 버린다.
            throw new ExternalDataUnavailableException();
        }
    }

    private static WebClient buildWebClient() {
        ExchangeStrategies strategies = ExchangeStrategies.builder()
                .codecs(config -> config.defaultCodecs().maxInMemorySize(MAX_RESPONSE_BYTES))
                .build();
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5_000)
                .responseTimeout(REQUEST_TIMEOUT)
                .doOnConnected(connection -> connection.addHandlerLast(
                        new ReadTimeoutHandler(12, TimeUnit.SECONDS)));
        return WebClient.builder()
                .baseUrl(BASE_URL)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .exchangeStrategies(strategies)
                .build();
    }
}
