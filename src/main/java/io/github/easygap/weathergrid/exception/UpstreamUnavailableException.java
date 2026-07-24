package io.github.easygap.weathergrid.exception;

/** Internal provider failure; controllers replace the detail with their scoped public message. */
public final class UpstreamUnavailableException extends PublicServiceException {

    public UpstreamUnavailableException() {
        this("upstream data unavailable");
    }

    public UpstreamUnavailableException(String internalDetail) {
        super(Kind.UPSTREAM_UNAVAILABLE,
                internalDetail == null || internalDetail.isBlank()
                        ? "upstream data unavailable" : internalDetail,
                60);
    }
}
