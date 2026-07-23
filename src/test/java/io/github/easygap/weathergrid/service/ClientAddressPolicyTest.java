package io.github.easygap.weathergrid.service;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ClientAddressPolicyTest {

    @Test
    void forwardedAddressIsUsedOnlyForAnExplicitlyTrustedPeer() {
        ClientAddressPolicy policy = new ClientAddressPolicy("10.0.0.0/8, 2001:db8:1::/48");

        assertEquals("198.51.100.7", policy.identify(
                request("10.2.3.4", "198.51.100.7", "192.0.2.99")));
        assertEquals("203.0.113.8", policy.identify(
                request("203.0.113.8", "198.51.100.7", "192.0.2.99")));
        assertEquals("2001:db8:0:0:0:0:0:9", policy.identify(
                request("2001:db8:1::5", "2001:db8::9", null)));
    }

    @Test
    void malformedAddressesNeverTriggerDnsOrForwardedHeaderTrust() {
        ClientAddressPolicy policy = new ClientAddressPolicy("10.0.0.0/8");

        assertEquals("unknown", policy.identify(request("attacker.example", "198.51.100.7", null)));
        assertEquals("unknown", policy.identify(request("999.2.3.4", "198.51.100.7", null)));
        assertEquals("10.1.2.3", policy.identify(request("10.1.2.3", "bad.example", null)));
    }

    @Test
    void invalidTrustedProxyConfigurationFailsClosedAtStartup() {
        assertThrows(IllegalArgumentException.class,
                () -> new ClientAddressPolicy("10.0.0.0/99"));
        assertThrows(IllegalArgumentException.class,
                () -> new ClientAddressPolicy("proxy.example/24"));
    }

    private static HttpServletRequest request(String peer, String connectingIp, String forwardedFor) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn(peer);
        when(request.getHeader("CF-Connecting-IP")).thenReturn(connectingIp);
        when(request.getHeader("X-Forwarded-For")).thenReturn(forwardedFor);
        return request;
    }
}
