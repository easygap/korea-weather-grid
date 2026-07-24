package io.github.easygap.weathergrid.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** 기상청 API 접속 정보. 비밀값은 환경 변수에서 바인딩하고 코드에 기본값을 두지 않는다. */
@ConfigurationProperties("kma.api")
public record KmaClientProperties(String baseUrl, String authKey) {

    public KmaClientProperties {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalArgumentException("kma.api.base-url is required");
        }
    }

    public boolean hasCredential() {
        return authKey != null && !authKey.isBlank();
    }
}
