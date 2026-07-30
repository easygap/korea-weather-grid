package io.github.easygap.weathergrid.config;

import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;

/** 지도 공급자 런타임 설정을 명시적으로 등록한다. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MapProviderProperties.class)
public class MapProviderConfiguration {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(4);
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(12);
    private static final int RESPONSE_BUFFER_BYTES = 2 * 1024 * 1024;

    @Bean
    @Qualifier("vworldWebClient")
    WebClient vworldWebClient() {
        HttpClient transport = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS,
                        Math.toIntExact(CONNECT_TIMEOUT.toMillis()))
                .responseTimeout(RESPONSE_TIMEOUT);
        return WebClient.builder()
                .baseUrl("https://api.vworld.kr")
                .clientConnector(new ReactorClientHttpConnector(transport))
                .codecs(codecs -> codecs.defaultCodecs()
                        .maxInMemorySize(RESPONSE_BUFFER_BYTES))
                .build();
    }
}
