package io.github.easygap.weathergrid.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BrowserPolicyHeadersFilterTest {

    private final BrowserPolicyHeadersFilter filter = new BrowserPolicyHeadersFilter();

    @Test
    void plainHttpResponseUsesExplicitOriginsWithoutTransportUpgrade() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/");
        MockHttpServletResponse response = apply(request);

        String policy = response.getHeader("Content-Security-Policy");
        assertNotNull(policy);
        assertTrue(policy.contains("connect-src 'self' https://cctvsec.ktict.co.kr https://cctvsec.ktict.co.kr:8082"));
        assertTrue(policy.contains("media-src 'self' blob: https://cctvsec.ktict.co.kr https://cctvsec.ktict.co.kr:8082"));
        assertTrue(policy.contains("script-src 'self' https://dapi.kakao.com https://t1.daumcdn.net"));
        assertTrue(policy.contains("https://*.daumcdn.net"));
        assertTrue(policy.contains("https://*.kakaocdn.net"));
        assertFalse(policy.contains("connect-src 'self' https:;"));
        assertFalse(policy.contains("upgrade-insecure-requests"));
        assertNull(response.getHeader("Strict-Transport-Security"));
        assertEquals("DENY", response.getHeader("X-Frame-Options"));
    }

    @Test
    void secureResponseAddsHstsAndSubresourceUpgrade() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/");
        request.setSecure(true);
        MockHttpServletResponse response = apply(request);

        assertTrue(response.getHeader("Content-Security-Policy").contains("upgrade-insecure-requests"));
        assertEquals("max-age=31536000; includeSubDomains",
                response.getHeader("Strict-Transport-Security"));
    }

    private MockHttpServletResponse apply(MockHttpServletRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }
}
