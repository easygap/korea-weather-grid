package io.github.easygap.weathergrid.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.regex.Pattern;

/** 브라우저 지도 공급자 설정. 키 원문은 로그나 서버 렌더링 모델에 넣지 않는다. */
@ConfigurationProperties("weather-grid.map")
public record MapProviderProperties(String kakaoJavascriptKey) {

    private static final Pattern KAKAO_JAVASCRIPT_KEY = Pattern.compile("[0-9a-fA-F]{32}");

    public MapProviderProperties {
        kakaoJavascriptKey = kakaoJavascriptKey == null ? "" : kakaoJavascriptKey.strip();
        if (!kakaoJavascriptKey.isEmpty() && !KAKAO_JAVASCRIPT_KEY.matcher(kakaoJavascriptKey).matches()) {
            throw new IllegalArgumentException(
                    "weather-grid.map.kakao-javascript-key must be empty or a 32-character hexadecimal key");
        }
    }

    public boolean kakaoEnabled() {
        return !kakaoJavascriptKey.isEmpty();
    }
}
