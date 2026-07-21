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

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * apis.data.go.kr 전용 소형 클라이언트.
 *
 * <p>디코딩된 서비스 키를 queryParam 값으로 넘겨 WebClient가 정확히 한 번만
 * URL 인코딩하게 한다. 예외에는 요청 URL을 보존하지 않아 키가 로그에 섞이지 않는다.</p>
 */
@Component
public class DataGoApiClient {

    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(20);

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final String serviceKey;

    @Autowired
    public DataGoApiClient(
            ObjectMapper objectMapper,
            @Value("${data-go.base-url:https://apis.data.go.kr}") String baseUrl,
            @Value("${data-go.service-key:}") String serviceKey) {
        this(objectMapper, serviceKey, buildWebClient(baseUrl));
    }

    DataGoApiClient(ObjectMapper objectMapper, String serviceKey, WebClient webClient) {
        this.objectMapper = objectMapper;
        String candidate = serviceKey == null ? "" : serviceKey.trim();
        // URL Encoding 키를 queryParam에 넣으면 %가 다시 인코딩된다. 디코딩 키만 허용한다.
        this.serviceKey = candidate.matches(".*%[0-9A-Fa-f]{2}.*") ? "" : candidate;
        this.webClient = webClient;
    }

    public JsonNode get(String path, Map<String, ?> parameters) {
        if (serviceKey.isBlank()) throw new ExternalDataUnavailableException();

        try {
            String body = webClient.get()
                    .uri(builder -> {
                        // URI 변수로 확장해야 '+', '/', '=' 같은 Base64 문자가 값으로 인코딩된다.
                        // queryParam에 원문을 직접 넣으면 일부 WebClient 구성에서 '+'가 그대로 전송된다.
                        builder.path(path).queryParam("serviceKey", "{dataGoServiceKey}");
                        parameters.forEach((name, value) -> builder.queryParam(name, value));
                        return builder.build(Map.of("dataGoServiceKey", serviceKey));
                    })
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(REQUEST_TIMEOUT);
            if (body == null || body.isBlank()) throw new ExternalDataUnavailableException();
            return objectMapper.readTree(body);
        } catch (ExternalDataUnavailableException e) {
            throw e;
        } catch (Exception ignored) {
            // WebClient 예외 메시지에는 serviceKey가 포함된 URL이 들어갈 수 있어 원인을 넘기지 않는다.
            throw new ExternalDataUnavailableException();
        }
    }

    private static WebClient buildWebClient(String baseUrl) {
        ExchangeStrategies strategies = ExchangeStrategies.builder()
                .codecs(config -> config.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5_000)
                .responseTimeout(REQUEST_TIMEOUT)
                .doOnConnected(connection ->
                        connection.addHandlerLast(new ReadTimeoutHandler(20, TimeUnit.SECONDS)));
        return WebClient.builder()
                .baseUrl(baseUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .exchangeStrategies(strategies)
                .build();
    }
}
