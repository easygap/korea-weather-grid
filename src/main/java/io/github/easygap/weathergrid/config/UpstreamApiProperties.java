package io.github.easygap.weathergrid.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;

/** 공개 데이터 공급자별 주소와 자격 증명을 한 경계에서 관리한다. */
@ConfigurationProperties("weather-grid.upstream")
public record UpstreamApiProperties(
        Endpoint publicData,
        Endpoint trafficCctv
) {
    public UpstreamApiProperties {
        if (publicData == null || trafficCctv == null) {
            throw new IllegalArgumentException("Both upstream endpoints must be configured");
        }
    }

    public record Endpoint(URI baseUrl, String credential) {
        public Endpoint {
            if (baseUrl == null || !baseUrl.isAbsolute()
                    || !"https".equalsIgnoreCase(baseUrl.getScheme())
                    || baseUrl.getHost() == null
                    || baseUrl.getUserInfo() != null
                    || baseUrl.getQuery() != null
                    || baseUrl.getFragment() != null) {
                throw new IllegalArgumentException("Upstream base URL must be an absolute HTTPS URL");
            }
            credential = credential == null ? "" : credential.strip();
        }
    }
}
