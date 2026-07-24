package io.github.easygap.weathergrid.exception;

/** Public request budget exhaustion with a bounded retry delay. */
public final class RequestThrottledException extends PublicServiceException {

    public RequestThrottledException(long retryAfterSeconds) {
        super(Kind.THROTTLED, "rate limit exceeded", Math.max(1, retryAfterSeconds));
    }
}
