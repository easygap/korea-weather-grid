package io.github.easygap.weathergrid.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 모든 브라우저 응답에 동일한 최소 권한 정책을 적용한다. */
@Component
@Order(10)
public class BrowserPolicyHeadersFilter extends OncePerRequestFilter {

    private static final String CCTV_ORIGIN = "https://cctvsec.ktict.co.kr";
    private static final String CONTENT_SECURITY_POLICY = String.join("; ", List.of(
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "script-src 'self'",
            "script-src-attr 'none'",
            "style-src 'self'",
            "style-src-elem 'self'",
            "style-src-attr 'unsafe-inline'",
            "img-src 'self' data: blob: https://tile.openstreetmap.org "
                    + "https://*.tile.openstreetmap.org",
            "font-src 'self' data:",
            "connect-src 'self' " + CCTV_ORIGIN,
            "media-src 'self' blob: " + CCTV_ORIGIN,
            "worker-src 'self' blob:",
            "manifest-src 'self'"
    ));
    private static final Map<String, String> BASE_HEADERS = baseHeaders();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        BASE_HEADERS.forEach(response::setHeader);
        response.setHeader("Content-Security-Policy", request.isSecure()
                ? CONTENT_SECURITY_POLICY + "; upgrade-insecure-requests"
                : CONTENT_SECURITY_POLICY);
        if (request.isSecure()) {
            response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        }
        chain.doFilter(request, response);
    }

    private static Map<String, String> baseHeaders() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.put("X-Frame-Options", "DENY");
        headers.put("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        headers.put("Cross-Origin-Opener-Policy", "same-origin");
        headers.put("Cross-Origin-Resource-Policy", "same-origin");
        return Map.copyOf(headers);
    }
}
