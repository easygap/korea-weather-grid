package io.github.easygap.weathergrid.config;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class RequestBodyLimitFilterTest {

    private final RequestBodyLimitFilter filter = new RequestBodyLimitFilter();

    @Test
    void acceptedPostBodyCanBeReadByTheControllerChain() throws Exception {
        byte[] expected = "{\"region\":\"seoul\"}".getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/example");
        request.setContent(expected);
        AtomicReference<byte[]> observed = new AtomicReference<>();
        FilterChain chain = (filteredRequest, response) ->
                observed.set(filteredRequest.getInputStream().readAllBytes());

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertArrayEquals(expected, observed.get());
    }

    @Test
    void declaredOversizeBodyIsRejectedBeforeTheChain() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/example") {
            @Override
            public long getContentLengthLong() {
                return RequestBodyLimitFilter.MAX_POST_BYTES + 1L;
            }
        };
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<byte[]> observed = new AtomicReference<>();

        filter.doFilter(request, response,
                (filteredRequest, filteredResponse) -> observed.set(new byte[0]));

        assertEquals(413, response.getStatus());
        assertNull(observed.get());
    }

    @Test
    void undeclaredOversizeBodyIsBoundedWhileReading() throws Exception {
        byte[] oversized = new byte[RequestBodyLimitFilter.MAX_POST_BYTES + 1];
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/example") {
            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
        request.setContent(oversized);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (filteredRequest, filteredResponse) -> { });

        assertEquals(413, response.getStatus());
    }
}
