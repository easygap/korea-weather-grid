package io.github.easygap.weathergrid.service;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ForecastReleaseClockTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    @Test
    void publicationDelaySwitchesAtExactlyTenMinutesPastRelease() {
        ForecastReleaseClock before = clockAt("2026-07-21T17:09:00Z"); // 02:09 KST
        ForecastReleaseClock after = clockAt("2026-07-21T17:10:00Z");  // 02:10 KST

        assertEquals(new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 23),
                before.current());
        assertEquals(new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 22), 2),
                after.current());
    }

    @Test
    void requestedTimesFloorAcrossSameDayAndMidnight() {
        ForecastReleaseClock schedule = clockAt("2026-07-22T05:20:00Z");

        assertEquals(new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 22), 14),
                schedule.atOrBefore("20260722", "1400"));
        assertEquals(new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 22), 14),
                schedule.atOrBefore("20260722", "1659"));
        assertEquals(new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 21), 23),
                schedule.atOrBefore("20260722", "0100"));
    }

    @Test
    void malformedSelectionFallsBackToCurrentRelease() {
        ForecastReleaseClock schedule = clockAt("2026-07-22T05:20:00Z"); // 14:20 KST

        assertEquals(new ForecastReleaseClock.Release(LocalDate.of(2026, 7, 22), 14),
                schedule.atOrBefore("not-a-day", "bad"));
    }

    private static ForecastReleaseClock clockAt(String instant) {
        return new ForecastReleaseClock(Clock.fixed(Instant.parse(instant), KST));
    }
}
