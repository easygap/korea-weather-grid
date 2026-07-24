package io.github.easygap.weathergrid.exception;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PublicServiceExceptionTest {

    @Test
    void eachFailureKindCarriesOnlyItsRequiredPublicControlData() {
        PublicServiceException rejected = new RequestRejectedException("잘못된 좌표");
        PublicServiceException throttled = new RequestThrottledException(0);
        PublicServiceException unavailable = new UpstreamUnavailableException("internal detail");

        assertEquals(PublicServiceException.Kind.REJECTED, rejected.kind());
        assertEquals("잘못된 좌표", rejected.getMessage());
        assertEquals(0, rejected.retryAfterSeconds());
        assertEquals(PublicServiceException.Kind.THROTTLED, throttled.kind());
        assertEquals(1, throttled.retryAfterSeconds());
        assertEquals(PublicServiceException.Kind.UPSTREAM_UNAVAILABLE, unavailable.kind());
        assertEquals(60, unavailable.retryAfterSeconds());
    }

    @Test
    void rejectedRequestsMustAlwaysHaveASafeClientMessage() {
        assertThrows(IllegalArgumentException.class, () -> new RequestRejectedException(" "));
    }
}
