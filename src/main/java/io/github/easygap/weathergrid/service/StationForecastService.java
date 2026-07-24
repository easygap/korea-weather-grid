package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.StationSeriesSlot;
import io.github.easygap.weathergrid.integration.KmaPointForecastGateway;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Builds the browser's fixed 49-hour station series from normalized forecast values. */
@Service
@RequiredArgsConstructor
public class StationForecastService {

    private static final int SLOT_COUNT = 49;
    private static final double MISSING = 9999.0;
    private static final int CACHE_LIMIT = 200;
    private static final DateTimeFormatter SLOT_TIME = DateTimeFormatter.ofPattern("yyyyMMddHHmm");

    private final KmaPointForecastGateway gateway;
    private final Map<Query, List<StationSeriesSlot>> cache = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<Query, List<StationSeriesSlot>> eldest) {
                    return size() > CACHE_LIMIT;
                }
            });

    public List<StationSeriesSlot> load(ForecastReleaseClock.Release release, int gridX, int gridY) {
        Query query = new Query(release, gridX, gridY);
        List<StationSeriesSlot> cached = cache.get(query);
        if (cached != null) return cached;

        List<KmaPointForecastGateway.ForecastValue> values = gateway.fetch(
                release.compactDate(), release.compactTime(), gridX, gridY);
        Slot[] slots = new Slot[SLOT_COUNT];
        boolean populated = false;
        for (KmaPointForecastGateway.ForecastValue value : values) {
            long minutes = Duration.between(release.dateTime(), value.validAt()).toMinutes();
            if (minutes < 0 || minutes > (SLOT_COUNT - 1L) * 60 || minutes % 60 != 0) continue;
            int index = Math.toIntExact(minutes / 60);
            Slot slot = slots[index];
            if (slot == null) slots[index] = slot = new Slot();
            switch (value.category()) {
                case WIND_SPEED -> {
                    slot.windSpeed = value.value();
                    populated = true;
                }
                case WIND_DIRECTION -> {
                    slot.windDirection = value.value();
                    populated = true;
                }
                case TEMPERATURE -> {
                    slot.temperature = value.value();
                    populated = true;
                }
                case EAST_WIND, NORTH_WIND -> { }
            }
        }

        List<StationSeriesSlot> result = java.util.stream.IntStream.range(0, SLOT_COUNT)
                .mapToObj(hour -> toDto(hour, release.dateTime().plusHours(hour), slots[hour]))
                .toList();
        if (populated) cache.put(query, result);
        return result;
    }

    private static StationSeriesSlot toDto(int hour, LocalDateTime validAt, Slot slot) {
        return new StationSeriesSlot(
                hour,
                slot == null ? MISSING : slot.windSpeed,
                slot == null ? MISSING : slot.windDirection,
                MISSING,
                slot == null ? MISSING : slot.temperature,
                validAt.format(SLOT_TIME));
    }

    private record Query(ForecastReleaseClock.Release release, int gridX, int gridY) {
        private Query {
            if (release == null || gridX < 1 || gridX > 149 || gridY < 1 || gridY > 253) {
                throw new IllegalArgumentException("Invalid station forecast query");
            }
        }
    }

    private static final class Slot {
        private double windSpeed = MISSING;
        private double windDirection = MISSING;
        private double temperature = MISSING;
    }
}
