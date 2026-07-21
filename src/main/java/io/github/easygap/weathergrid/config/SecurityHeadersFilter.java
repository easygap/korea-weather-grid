package io.github.easygap.weathergrid.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/** 배포 환경의 브라우저 보안 정책과 소형 JSON POST 요청 한도를 공통 적용한다. */
@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {

    private static final long MAX_JSON_BODY_BYTES = 8 * 1024;
    private static final String CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; "
            + "frame-ancestors 'none'; form-action 'self'; script-src 'self'; script-src-attr 'none'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org "
            + "https://*.tile.openstreetmap.org; font-src 'self' data:; connect-src 'self' "
            + "https://cctvsec.ktict.co.kr https://cctvsec.ktict.co.kr:8082; media-src 'self' blob: "
            + "https://cctvsec.ktict.co.kr https://cctvsec.ktict.co.kr:8082; "
            + "worker-src 'self' blob:; manifest-src 'self'";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        response.setHeader("Content-Security-Policy", request.isSecure()
                ? CSP + "; upgrade-insecure-requests"
                : CSP);
        if (request.isSecure()) {
            response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        }

        HttpServletRequest filteredRequest = request;
        if ("POST".equalsIgnoreCase(request.getMethod())) {
            if (request.getContentLengthLong() > MAX_JSON_BODY_BYTES) {
                response.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
                return;
            }
            // Content-Length가 없는 청크 요청도 제한한다. 8KB+1까지만 읽으므로
            // 큰 본문이 애플리케이션 메모리/Jackson까지 도달하지 않는다.
            byte[] body = request.getInputStream().readNBytes((int) MAX_JSON_BODY_BYTES + 1);
            if (body.length > MAX_JSON_BODY_BYTES) {
                response.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
                return;
            }
            filteredRequest = new BufferedRequestWrapper(request, body);
        }
        filterChain.doFilter(filteredRequest, response);
    }

    private static final class BufferedRequestWrapper extends HttpServletRequestWrapper {
        private final byte[] body;

        private BufferedRequestWrapper(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public int getContentLength() {
            return body.length;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public int read() { return input.read(); }
                @Override public int read(byte[] bytes, int off, int len) { return input.read(bytes, off, len); }
                @Override public boolean isFinished() { return input.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener listener) {
                    if (listener == null) throw new IllegalArgumentException("listener");
                    try {
                        if (isFinished()) listener.onAllDataRead();
                        else listener.onDataAvailable();
                    } catch (IOException e) {
                        listener.onError(e);
                    }
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            String encoding = getCharacterEncoding();
            return new BufferedReader(new InputStreamReader(getInputStream(),
                    encoding == null ? StandardCharsets.UTF_8 : java.nio.charset.Charset.forName(encoding)));
        }
    }
}
