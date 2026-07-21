package io.github.easygap.weathergrid.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SecurityHeadersFilterTest {

    @Test
    void allowsOnlyTheApprovedCctvMediaOrigin() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new SecurityHeadersFilter().doFilter(request, response, new MockFilterChain());

        String csp = response.getHeader("Content-Security-Policy");
        assertNotNull(csp);
        assertTrue(csp.contains(
                "connect-src 'self' https://cctvsec.ktict.co.kr https://cctvsec.ktict.co.kr:8082;"));
        assertTrue(csp.contains(
                "media-src 'self' blob: https://cctvsec.ktict.co.kr https://cctvsec.ktict.co.kr:8082;"));
        assertFalse(csp.contains("connect-src 'self' https:;"));
        assertFalse(csp.contains("media-src 'self' blob: https:;"));
        assertFalse(csp.contains("upgrade-insecure-requests"));
    }

    @Test
    void upgradesSubresourcesOnlyForHttpsResponses() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/");
        request.setSecure(true);
        MockHttpServletResponse response = new MockHttpServletResponse();

        new SecurityHeadersFilter().doFilter(request, response, new MockFilterChain());

        assertTrue(response.getHeader("Content-Security-Policy").contains("upgrade-insecure-requests"));
        assertTrue(response.getHeader("Strict-Transport-Security").contains("max-age=31536000"));
    }
}
