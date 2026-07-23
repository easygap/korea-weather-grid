package io.github.easygap.weathergrid.exception;

/** Safe client-visible explanation for a rejected public request. */
public final class RequestRejectedException extends PublicServiceException {

    public RequestRejectedException(String publicMessage) {
        super(Kind.REJECTED, publicMessage, 0);
        if (publicMessage == null || publicMessage.isBlank()) {
            throw new IllegalArgumentException("publicMessage is blank");
        }
    }
}
