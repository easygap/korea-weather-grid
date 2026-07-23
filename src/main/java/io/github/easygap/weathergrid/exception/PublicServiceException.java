package io.github.easygap.weathergrid.exception;

/** One typed failure model shared by every public weather endpoint. */
public abstract sealed class PublicServiceException extends RuntimeException
        permits RequestRejectedException, RequestThrottledException, UpstreamUnavailableException {

    public enum Kind {
        REJECTED,
        THROTTLED,
        UPSTREAM_UNAVAILABLE
    }

    private final Kind kind;
    private final long retryAfterSeconds;

    protected PublicServiceException(Kind kind, String detail, long retryAfterSeconds) {
        super(detail);
        this.kind = kind;
        this.retryAfterSeconds = Math.max(0, retryAfterSeconds);
    }

    public final Kind kind() {
        return kind;
    }

    public final long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
