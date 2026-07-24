package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.exception.RequestRejectedException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PublicRequestPolicyTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Test
    void opensAReleaseExactlyTenMinutesAfterItsDocumentedTime() {
        PublicRequestPolicy before = policyAt("2026-07-21T17:09:59Z");
        RequestRejectedException early = assertThrows(RequestRejectedException.class,
                () -> before.requirePointForecast(37.5, 127, "20260722", "0200"));
        assertEquals("아직 발표되지 않은 시각", early.getMessage());

        PublicRequestPolicy available = policyAt("2026-07-21T17:10:00Z");
        assertDoesNotThrow(() -> available.requirePointForecast(
                37.5, 127, "20260722", "0200"));
    }

    @Test
    void enforcesCalendarHistoryReleaseAndCoordinateBoundaries() {
        PublicRequestPolicy policy = policyAt("2026-07-22T03:00:00Z");
        assertDoesNotThrow(() -> policy.requirePointForecast(
                32, 122, "20260523", "0200"));
        assertThrows(RequestRejectedException.class, () -> policy.requirePointForecast(
                32, 122, "20260522", "0200"));
        assertThrows(RequestRejectedException.class, () -> policy.requirePointForecast(
                32, 122, "20260230", "0200"));
        assertThrows(RequestRejectedException.class, () -> policy.requirePointForecast(
                32, 122, "20260721", "0300"));
        assertThrows(RequestRejectedException.class, () -> policy.requirePointForecast(
                Double.POSITIVE_INFINITY, 127, "20260721", "0200"));
    }

    @Test
    void requiresAnExactSingleValuedQuery() {
        PublicRequestPolicy policy = policyAt("2026-07-22T03:00:00Z");
        MockHttpServletRequest valid = new MockHttpServletRequest();
        valid.addParameter("minLat", "32");
        valid.addParameter("maxLat", "44");
        assertDoesNotThrow(() -> policy.requireExactQuery(
                valid, Set.of("minLat", "maxLat")));

        MockHttpServletRequest duplicate = new MockHttpServletRequest();
        duplicate.addParameter("minLat", "32", "33");
        duplicate.addParameter("maxLat", "44");
        assertThrows(RequestRejectedException.class, () -> policy.requireExactQuery(
                duplicate, Set.of("minLat", "maxLat")));

        valid.addParameter("serviceKey", "not-accepted");
        assertThrows(RequestRejectedException.class, () -> policy.requireExactQuery(
                valid, Set.of("minLat", "maxLat")));
    }

    @Test
    void validatesNonEmptyViewportAndTheTwentyFourCameraCellLimit() {
        PublicRequestPolicy policy = policyAt("2026-07-22T03:00:00Z");
        assertDoesNotThrow(() -> policy.requireViewport(32, 44, 122, 134));
        assertThrows(RequestRejectedException.class,
                () -> policy.requireViewport(37, 37, 126, 127));
        assertDoesNotThrow(() -> policy.requireCameraViewport(37, 37.5, 126, 127));
        assertThrows(RequestRejectedException.class,
                () -> policy.requireCameraViewport(37, 38.5, 126, 127.25));
    }

    private static PublicRequestPolicy policyAt(String instant) {
        return new PublicRequestPolicy(Clock.fixed(Instant.parse(instant), KST));
    }
}
