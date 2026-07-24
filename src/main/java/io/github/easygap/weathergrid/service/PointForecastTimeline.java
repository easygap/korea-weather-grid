package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.PointForecastHour;
import io.github.easygap.weathergrid.dto.PointForecastReport;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import io.github.easygap.weathergrid.integration.VillageForecastFeed;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Creates the public +0..+48 hour point-forecast timeline from normalized KMA rows. */
@Service
public final class PointForecastTimeline {

    private static final String SOURCE = "기상청 단기예보";
    private static final int SLOT_COUNT = 49;
    private static final int CACHE_LIMIT = 200;
    private static final Duration CACHE_TTL = Duration.ofHours(1);
    private static final DateTimeFormatter COMPACT_TIME = DateTimeFormatter.ofPattern("yyyyMMddHHmm");

    private final VillageForecastFeed feed;
    private final WeatherRequestBudget rateLimiter;
    private final Clock clock;
    private final Object[] refreshStripes = locks(64);
    private final Map<Query, Cached<List<PointForecastHour>>> cache =
            Collections.synchronizedMap(new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(
                        Map.Entry<Query, Cached<List<PointForecastHour>>> eldest) {
                    return size() > CACHE_LIMIT;
                }
            });

    @Autowired
    public PointForecastTimeline(VillageForecastFeed feed,
                                 WeatherRequestBudget rateLimiter) {
        this(feed, rateLimiter, Clock.systemUTC());
    }

    PointForecastTimeline(VillageForecastFeed feed, WeatherRequestBudget rateLimiter,
                          Clock clock) {
        this.feed = feed;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
    }

    public PointForecastReport get(double latitude, double longitude,
                                          String releaseDate, String releaseTime) {
        KmaDfsProjection.Cell cell = KmaDfsProjection.STANDARD.nearestCell(latitude, longitude);
        Query query = new Query(releaseDate, releaseTime, cell.x(), cell.y());
        Cached<List<PointForecastHour>> cached = cache.get(query);
        List<PointForecastHour> items;
        if (isFresh(cached)) {
            items = cached.value();
        } else {
            Object lock = refreshStripes[Math.floorMod(query.hashCode(), refreshStripes.length)];
            synchronized (lock) {
                cached = cache.get(query);
                if (isFresh(cached)) {
                    items = cached.value();
                } else {
                    rateLimiter.claimRefresh(WeatherRequestBudget.RefreshSource.POINT_FORECAST);
                    items = assemble(query, feed.fetch(
                            releaseDate, releaseTime, cell.x(), cell.y()));
                    cache.put(query, new Cached<>(items, clock.instant()));
                }
            }
        }
        return new PointForecastReport(releaseDate, releaseTime,
                latitude, longitude, SOURCE, items);
    }

    private List<PointForecastHour> assemble(
            Query query, List<VillageForecastFeed.Value> values) {
        LocalDateTime release;
        try {
            release = LocalDateTime.parse(query.date() + query.time(), COMPACT_TIME);
        } catch (DateTimeParseException ignored) {
            throw new IllegalArgumentException("Invalid point-forecast release");
        }

        Slot[] slots = new Slot[SLOT_COUNT];
        for (int index = 0; index < SLOT_COUNT; index++) slots[index] = new Slot();
        boolean populated = false;
        for (VillageForecastFeed.Value value : values) {
            long minutes = Duration.between(release, value.validAt()).toMinutes();
            if (minutes < 0 || minutes > (SLOT_COUNT - 1L) * 60 || minutes % 60 != 0) continue;
            populated |= slots[Math.toIntExact(minutes / 60)].accept(
                    value.category(), value.rawValue());
        }
        if (!populated) throw new UpstreamUnavailableException();

        List<PointForecastHour> result = new ArrayList<>(SLOT_COUNT);
        for (int hour = 0; hour < SLOT_COUNT; hour++) {
            result.add(slots[hour].toDto(hour, release.plusHours(hour)));
        }
        return List.copyOf(result);
    }

    private boolean isFresh(Cached<?> value) {
        return value != null && clock.instant().isBefore(value.loadedAt().plus(CACHE_TTL));
    }

    private static Object[] locks(int count) {
        Object[] result = new Object[count];
        for (int index = 0; index < count; index++) result[index] = new Object();
        return result;
    }

    private static Double number(String raw, double minimum, double maximum) {
        try {
            double parsed = Double.parseDouble(raw);
            return Double.isFinite(parsed) && parsed >= minimum && parsed <= maximum
                    ? parsed : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static Integer integer(String raw, int minimum, int maximum) {
        Double parsed = number(raw, minimum, maximum);
        return parsed != null && parsed == Math.rint(parsed) ? parsed.intValue() : null;
    }

    private static String amount(String raw) {
        String value = raw.trim();
        return value.isEmpty() || "-".equals(value) ? null : value;
    }

    private static String skyLabel(Integer code) {
        if (code == null) return null;
        return switch (code) {
            case 1 -> "맑음";
            case 3 -> "구름많음";
            case 4 -> "흐림";
            default -> null;
        };
    }

    private static String precipitationLabel(Integer code) {
        if (code == null) return null;
        return switch (code) {
            case 0 -> "없음";
            case 1 -> "비";
            case 2 -> "비/눈";
            case 3 -> "눈";
            case 4 -> "소나기";
            default -> null;
        };
    }

    private record Query(String date, String time, int gridX, int gridY) {
    }

    private record Cached<T>(T value, java.time.Instant loadedAt) {
    }

    private static final class Slot {
        private Double temperature;
        private Double humidity;
        private Double precipitationProbability;
        private String precipitationAmount;
        private String snowfallAmount;
        private Integer skyCode;
        private Integer precipitationType;
        private Double waveHeight;
        private Double windSpeed;
        private Double windDirection;

        private boolean accept(VillageForecastFeed.Category category, String raw) {
            return switch (category) {
                case TEMPERATURE -> (temperature = number(raw, -100, 80)) != null;
                case HUMIDITY -> (humidity = number(raw, 0, 100)) != null;
                case PRECIPITATION_PROBABILITY ->
                        (precipitationProbability = number(raw, 0, 100)) != null;
                case PRECIPITATION_AMOUNT ->
                        (precipitationAmount = amount(raw)) != null;
                case SNOWFALL_AMOUNT -> (snowfallAmount = amount(raw)) != null;
                case SKY -> {
                    Integer candidate = integer(raw, 1, 4);
                    skyCode = skyLabel(candidate) == null ? null : candidate;
                    yield skyCode != null;
                }
                case PRECIPITATION_TYPE ->
                        (precipitationType = integer(raw, 0, 4)) != null;
                case WAVE_HEIGHT -> (waveHeight = number(raw, 0, 50)) != null;
                case WIND_SPEED -> (windSpeed = number(raw, 0, 150)) != null;
                case WIND_DIRECTION -> (windDirection = number(raw, 0, 360)) != null;
            };
        }

        private PointForecastHour toDto(int hour, LocalDateTime validAt) {
            return new PointForecastHour(hour, validAt.format(COMPACT_TIME),
                    temperature, humidity, precipitationProbability,
                    precipitationAmount, snowfallAmount,
                    skyCode, skyLabel(skyCode), precipitationType,
                    precipitationLabel(precipitationType), waveHeight,
                    windSpeed, windDirection);
        }
    }
}
