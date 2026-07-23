package io.github.easygap.weathergrid.config;

import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;

/** 기상청의 대용량 격자 응답을 위한 전용 HTTP 클라이언트 구성. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(KmaClientProperties.class)
public class KmaClientConfiguration {

    private static final int RESPONSE_BUFFER_BYTES = 32 * 1024 * 1024;
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(60);

    @Bean
    WebClient kmaWebClient(KmaClientProperties properties,
                           @Value("${weather-grid.demo-mode:false}") boolean demoMode) {
        if (!demoMode && !properties.hasCredential()) {
            throw new IllegalStateException("KMA_API_AUTH_KEY must be configured outside demo mode");
        }

        HttpClient transport = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, Math.toIntExact(CONNECT_TIMEOUT.toMillis()))
                .responseTimeout(RESPONSE_TIMEOUT);

        return WebClient.builder()
                .baseUrl(properties.baseUrl())
                .clientConnector(new ReactorClientHttpConnector(transport))
                .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(RESPONSE_BUFFER_BYTES))
                .build();
    }
}
