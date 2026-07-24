package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.PointForecastHour;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.integration.VillageForecastFeed;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.HUMIDITY;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.PRECIPITATION_AMOUNT;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.PRECIPITATION_PROBABILITY;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.PRECIPITATION_TYPE;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.SKY;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.SNOWFALL_AMOUNT;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.TEMPERATURE;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.WAVE_HEIGHT;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.WIND_DIRECTION;
import static io.github.easygap.weathergrid.integration.VillageForecastFeed.Category.WIND_SPEED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PointForecastTimelineTest {

    private static final LocalDateTime RELEASE = LocalDateTime.of(2026, 7, 22, 2, 0);

    @Test
    void createsFortyNineSlotsWithoutConfusingZeroStringsAndMissingValues() {
        VillageForecastFeed feed = mock(VillageForecastFeed.class);
        when(feed.fetch("20260722", "0200", 60, 127)).thenReturn(List.of(
                value(TEMPERATURE, 1, "-3.2"),
                value(HUMIDITY, 1, "85"),
                value(PRECIPITATION_PROBABILITY, 1, "0"),
                value(PRECIPITATION_AMOUNT, 1, "1.0mm 미만"),
                value(SNOWFALL_AMOUNT, 1, "적설없음"),
                value(SKY, 1, "3"),
                value(PRECIPITATION_TYPE, 1, "0"),
                value(WAVE_HEIGHT, 1, "1.4"),
                value(WIND_SPEED, 1, "0"),
                value(WIND_DIRECTION, 1, "360"),
                value(WAVE_HEIGHT, 2, "9999"),
                value(TEMPERATURE, 49, "20"),
                new VillageForecastFeed.Value(
                        TEMPERATURE, RELEASE.plusMinutes(90), "9")));
        Clock clock = Clock.fixed(Instant.parse("2026-07-22T00:00:00Z"), ZoneOffset.UTC);
        PointForecastTimeline timeline = new PointForecastTimeline(
                feed, WeatherRequestBudget.unrestricted(), clock);

        var response = timeline.get(37.5665, 126.9780, "20260722", "0200");

        assertEquals("기상청 단기예보", response.provider());
        assertEquals(49, response.hours().size());
        assertNull(response.hours().get(0).airTemperature());
        PointForecastHour hourOne = response.hours().get(1);
        assertEquals("202607220300", hourOne.validTime());
        assertEquals(-3.2, hourOne.airTemperature());
        assertEquals(85.0, hourOne.relativeHumidity());
        assertEquals(0.0, hourOne.rainProbability());
        assertEquals("1.0mm 미만", hourOne.rainAmount());
        assertEquals("적설없음", hourOne.snowAmount());
        assertEquals("구름많음", hourOne.skyDescription());
        assertEquals("없음", hourOne.precipitationDescription());
        assertEquals(0.0, hourOne.windSpeed());
        assertEquals(360.0, hourOne.windBearing());
        assertNull(response.hours().get(2).waveHeight());
        assertEquals("202607240200", response.hours().get(48).validTime());

        assertEquals(response, timeline.get(37.5665, 126.9780, "20260722", "0200"));
        verify(feed).fetch("20260722", "0200", 60, 127);
    }

    @Test
    void expiredOrUnusableResultsAreNotReturnedOrCached() {
        VillageForecastFeed feed = mock(VillageForecastFeed.class);
        when(feed.fetch("20260722", "0200", 60, 127))
                .thenReturn(List.of(value(TEMPERATURE, 1, "10")))
                .thenThrow(new UpstreamUnavailableException());
        MutableClock clock = new MutableClock(Instant.parse("2026-07-22T00:00:00Z"));
        PointForecastTimeline timeline = new PointForecastTimeline(
                feed, WeatherRequestBudget.unrestricted(), clock);

        timeline.get(37.5665, 126.9780, "20260722", "0200");
        clock.advance(Duration.ofHours(2));
        assertThrows(UpstreamUnavailableException.class,
                () -> timeline.get(37.5665, 126.9780, "20260722", "0200"));
        verify(feed, times(2)).fetch("20260722", "0200", 60, 127);

        VillageForecastFeed unusable = mock(VillageForecastFeed.class);
        when(unusable.fetch("20260722", "0200", 60, 127))
                .thenReturn(List.of(value(WAVE_HEIGHT, 1, "9999")));
        PointForecastTimeline empty = new PointForecastTimeline(
                unusable, WeatherRequestBudget.unrestricted(), clock);
        assertThrows(UpstreamUnavailableException.class,
                () -> empty.get(37.5665, 126.9780, "20260722", "0200"));
    }

    private static VillageForecastFeed.Value value(
            VillageForecastFeed.Category category, int hour, String raw) {
        return new VillageForecastFeed.Value(category, RELEASE.plusHours(hour), raw);
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
