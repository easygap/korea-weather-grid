package io.github.easygap.weathergrid.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Objects;
import java.util.Set;

/** Resolves the eight daily KMA forecast releases in Korea Standard Time. */
@Service
public final class ForecastReleaseClock {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int PUBLICATION_DELAY_MINUTES = 10;
    private static final int[] RELEASE_HOURS_DESCENDING = {23, 20, 17, 14, 11, 8, 5, 2};
    private static final Set<Integer> RELEASE_HOURS = Set.of(2, 5, 8, 11, 14, 17, 20, 23);
    private static final DateTimeFormatter COMPACT_DAY = DateTimeFormatter
            .ofPattern("uuuuMMdd").withResolverStyle(ResolverStyle.STRICT);

    private final Clock clock;

    @Autowired
    public ForecastReleaseClock() {
        this(Clock.system(KST));
    }

    ForecastReleaseClock(Clock clock) {
        this.clock = Objects.requireNonNull(clock);
    }

    /** Latest release expected to be available after the documented publication delay. */
    public Release current() {
        ZonedDateTime availableAt = ZonedDateTime.now(clock)
                .withZoneSameInstant(KST)
                .minusMinutes(PUBLICATION_DELAY_MINUTES);
        return floor(availableAt.toLocalDateTime());
    }

    /** Floors a requested local timestamp to the nearest valid KMA release. */
    public Release atOrBefore(String compactDate, String compactTime) {
        try {
            LocalDate day = LocalDate.parse(compactDate, COMPACT_DAY);
            if (compactTime == null || compactTime.length() != 4
                    || !compactTime.chars().allMatch(Character::isDigit)) {
                return current();
            }
            LocalTime time = LocalTime.of(
                    Integer.parseInt(compactTime.substring(0, 2)),
                    Integer.parseInt(compactTime.substring(2, 4)));
            return floor(LocalDateTime.of(day, time));
        } catch (DateTimeException | NumberFormatException ignored) {
            return current();
        }
    }

    private static Release floor(LocalDateTime requested) {
        for (int hour : RELEASE_HOURS_DESCENDING) {
            if (requested.getHour() >= hour) return new Release(requested.toLocalDate(), hour);
        }
        return new Release(requested.toLocalDate().minusDays(1), 23);
    }

    public record Release(LocalDate date, int hour) {
        public Release {
            Objects.requireNonNull(date);
            if (!RELEASE_HOURS.contains(hour)) {
                throw new IllegalArgumentException("Unsupported forecast release hour");
            }
        }

        public String compactDate() {
            return date.format(COMPACT_DAY);
        }

        public String compactTime() {
            return String.format("%02d00", hour);
        }

        public LocalDateTime dateTime() {
            return date.atTime(hour, 0);
        }
    }
}
