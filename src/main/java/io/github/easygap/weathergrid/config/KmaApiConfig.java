package io.github.easygap.weathergrid.config;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

@Configuration
public class KmaApiConfig {

    @Value("${kma.api.base-url}")
    private String baseUrl;

    @Value("${kma.api.auth-key}")
    private String authKey;

    @Value("${weather-grid.demo-mode:false}")
    private boolean demoMode;

    @Bean
    public WebClient kmaWebClient() {
        if (!demoMode && (authKey == null || authKey.isBlank())) {
            throw new IllegalStateException("KMA_API_AUTH_KEY must be configured outside demo mode");
        }
        ExchangeStrategies strategies = ExchangeStrategies.builder()
                .codecs(config -> config.defaultCodecs().maxInMemorySize(32 * 1024 * 1024))
                .build();

        // 전 격자 텍스트 응답을 안정적으로 수신할 수 있도록 연결·읽기 제한을 둔다.
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
                .responseTimeout(Duration.ofSeconds(60))
                .doOnConnected(conn ->
                        conn.addHandlerLast(new ReadTimeoutHandler(60, TimeUnit.SECONDS)));

        return WebClient.builder()
                .baseUrl(baseUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .exchangeStrategies(strategies)
                .build();
    }
}
