package io.github.easygap.weathergrid.config;

import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.net.URI;
import java.time.Duration;

/** 작은 JSON 공개 API를 기상청 대용량 격자 전송과 분리한다. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(UpstreamApiProperties.class)
public class UpstreamApiConfiguration {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(4);
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(12);
    private static final int PUBLIC_DATA_BUFFER_BYTES = 4 * 1024 * 1024;
    private static final int TRAFFIC_BUFFER_BYTES = 2 * 1024 * 1024;

    @Bean
    @Qualifier("publicDataWebClient")
    WebClient publicDataWebClient(UpstreamApiProperties properties) {
        return client(properties.publicData().baseUrl(), PUBLIC_DATA_BUFFER_BYTES);
    }

    @Bean
    @Qualifier("trafficCctvWebClient")
    WebClient trafficCctvWebClient(UpstreamApiProperties properties) {
        return client(properties.trafficCctv().baseUrl(), TRAFFIC_BUFFER_BYTES);
    }

    private static WebClient client(URI baseUrl, int bufferBytes) {
        HttpClient transport = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, Math.toIntExact(CONNECT_TIMEOUT.toMillis()))
                .responseTimeout(RESPONSE_TIMEOUT);
        return WebClient.builder()
                .baseUrl(baseUrl.toASCIIString())
                .clientConnector(new ReactorClientHttpConnector(transport))
                .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(bufferBytes))
                .build();
    }
}
