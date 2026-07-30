package io.github.easygap.weathergrid.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;

/** 기상청 API 접속 정보. 비밀값은 환경 변수에서 바인딩하고 코드에 기본값을 두지 않는다. */
@ConfigurationProperties("kma.api")
public record KmaClientProperties(String baseUrl, String authKey) {

    public KmaClientProperties {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalArgumentException("kma.api.base-url is required");
        }
        URI endpoint;
        try {
            endpoint = URI.create(baseUrl.strip());
        } catch (IllegalArgumentException ignored) {
            throw new IllegalArgumentException("kma.api.base-url must be an absolute HTTPS URL");
        }
        if (!endpoint.isAbsolute() || !"https".equalsIgnoreCase(endpoint.getScheme())
                || endpoint.getHost() == null || endpoint.getUserInfo() != null
                || endpoint.getQuery() != null || endpoint.getFragment() != null) {
            throw new IllegalArgumentException("kma.api.base-url must be an absolute HTTPS URL");
        }
        baseUrl = endpoint.toASCIIString();
    }

    public boolean hasCredential() {
        return authKey != null && !authKey.isBlank();
    }
}
