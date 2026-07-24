package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;

/** URL 인코딩 전 원문 API 키만 허용한다. */
final class ApiCredential {

    private static final int MAX_LENGTH = 512;

    private final String value;

    ApiCredential(String raw) {
        value = raw == null ? "" : raw.strip();
        if (!value.isEmpty() && (value.length() > MAX_LENGTH || value.indexOf('%') >= 0
                || value.chars().anyMatch(character -> Character.isISOControl(character)
                || Character.isWhitespace(character)))) {
            throw new IllegalArgumentException("API credential must be an unencoded single-line value");
        }
    }

    String requiredValue() {
        if (value.isEmpty()) throw new UpstreamUnavailableException();
        return value;
    }
}
