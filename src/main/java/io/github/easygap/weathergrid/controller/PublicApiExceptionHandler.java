package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.PublicServiceException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.nio.charset.StandardCharsets;

/** Maps the environmental public APIs to their stable text error contract. */
@RestControllerAdvice(assignableTypes = {
        EnvironmentalDataController.class,
        TrafficCameraController.class,
        HazardStatusController.class
})
public final class PublicApiExceptionHandler {

    private static final MediaType UTF8_TEXT = new MediaType(
            "text", "plain", StandardCharsets.UTF_8);

    @ExceptionHandler(PublicServiceException.class)
    public ResponseEntity<String> serviceFailure(PublicServiceException failure) {
        return switch (failure.kind()) {
            case REJECTED -> ResponseEntity.badRequest()
                    .contentType(UTF8_TEXT)
                    .body(failure.getMessage());
            case THROTTLED -> ResponseEntity.status(429)
                    .contentType(UTF8_TEXT)
                    .header("Cache-Control", "no-store")
                    .header("Retry-After", Long.toString(failure.retryAfterSeconds()))
                    .body("rate limit exceeded");
            case UPSTREAM_UNAVAILABLE -> ResponseEntity.status(503)
                    .contentType(UTF8_TEXT)
                    .header("Cache-Control", "no-store")
                    .header("Retry-After", Long.toString(failure.retryAfterSeconds()))
                    .body("data temporarily unavailable");
        };
    }

    @ExceptionHandler({MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<String> invalidBinding() {
        return ResponseEntity.badRequest().contentType(UTF8_TEXT).body("잘못된 요청");
    }

}
