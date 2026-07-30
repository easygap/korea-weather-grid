package io.github.easygap.weathergrid.config;

import org.junit.jupiter.api.Test;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CredentialEndpointPropertiesTest {

    @Test
    void acceptsOnlyAbsoluteHttpsUpstreamAddresses() {
        URI secure = URI.create("https://apis.data.go.kr/service");
        assertEquals(secure, new UpstreamApiProperties.Endpoint(secure, " key ").baseUrl());

        assertThrows(IllegalArgumentException.class, () ->
                new UpstreamApiProperties.Endpoint(URI.create("http://apis.data.go.kr"), "key"));
        assertThrows(IllegalArgumentException.class, () ->
                new UpstreamApiProperties.Endpoint(URI.create("https://user@apis.data.go.kr"), "key"));
        assertThrows(IllegalArgumentException.class, () ->
                new UpstreamApiProperties.Endpoint(URI.create("https://apis.data.go.kr?next=x"), "key"));
    }

    @Test
    void acceptsOnlyAbsoluteHttpsKmaAddress() {
        assertEquals("https://apihub.kma.go.kr",
                new KmaClientProperties(" https://apihub.kma.go.kr ", "key").baseUrl());

        assertThrows(IllegalArgumentException.class,
                () -> new KmaClientProperties("http://apihub.kma.go.kr", "key"));
        assertThrows(IllegalArgumentException.class,
                () -> new KmaClientProperties("//apihub.kma.go.kr", "key"));
        assertThrows(IllegalArgumentException.class,
                () -> new KmaClientProperties("https://apihub.kma.go.kr?q=key", "key"));
    }
}
