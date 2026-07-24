package io.github.easygap.weathergrid.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.regex.Pattern;

/** 브라우저 지도 공급자 설정. 키 원문은 로그나 서버 렌더링 모델에 넣지 않는다. */
@ConfigurationProperties("weather-grid.map")
public record MapProviderProperties(String vworldApiKey) {

    private static final Pattern VWORLD_API_KEY = Pattern.compile(
            "[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}");

    public MapProviderProperties {
        vworldApiKey = vworldApiKey == null ? "" : vworldApiKey.strip();
        if (!vworldApiKey.isEmpty() && !VWORLD_API_KEY.matcher(vworldApiKey).matches()) {
            throw new IllegalArgumentException(
                    "weather-grid.map.vworld-api-key must be empty or a UUID-formatted API key");
        }
    }

    public boolean vworldEnabled() {
        return !vworldApiKey.isEmpty();
    }
}
