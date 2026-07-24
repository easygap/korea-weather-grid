package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Normalizes one documented KMA village-forecast response into typed values. */
@Component
public final class VillageForecastFeed {

    private static final int PAGE_CAPACITY = 1_000;
    private static final Set<String> RELEASE_TIMES = Set.of(
            "0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300");
    private static final DateTimeFormatter DAY = DateTimeFormatter
            .ofPattern("uuuuMMdd").withResolverStyle(ResolverStyle.STRICT);
    private static final DateTimeFormatter VALID_AT = DateTimeFormatter
            .ofPattern("uuuuMMddHHmm").withResolverStyle(ResolverStyle.STRICT);

    private final PublicDataGateway gateway;

    public VillageForecastFeed(PublicDataGateway gateway) {
        this.gateway = gateway;
    }

    public List<Value> fetch(String releaseDate, String releaseTime, int gridX, int gridY) {
        validateQuery(releaseDate, releaseTime, gridX, gridY);

        Map<String, Object> query = new LinkedHashMap<>();
        query.put("dataType", "JSON");
        query.put("base_date", releaseDate);
        query.put("base_time", releaseTime);
        query.put("nx", gridX);
        query.put("ny", gridY);
        query.put("pageNo", 1);
        query.put("numOfRows", PAGE_CAPACITY);

        JsonNode response = gateway.request(PublicDataGateway.Dataset.VILLAGE_FORECAST, query)
                .path("response");
        if (!"00".equals(response.path("header").path("resultCode").asString(""))) {
            throw new UpstreamUnavailableException();
        }
        JsonNode body = response.path("body");
        int expected = body.path("totalCount").asInt(-1);
        List<JsonNode> rawItems = items(body.path("items"));
        if (expected <= 0 || expected > PAGE_CAPACITY || rawItems.size() != expected) {
            throw new UpstreamUnavailableException();
        }

        List<Value> result = new ArrayList<>();
        for (JsonNode item : rawItems) {
            Category category = Category.fromCode(clean(item.path("category"), 8));
            String date = clean(item.path("fcstDate"), 8);
            String time = clean(item.path("fcstTime"), 4);
            String rawValue = clean(item.path("fcstValue"), 64);
            if (category == null || date == null || time == null || rawValue == null) continue;
            try {
                result.add(new Value(category, LocalDateTime.parse(date + time, VALID_AT), rawValue));
            } catch (DateTimeParseException ignored) {
                // A malformed row is isolated from other documented forecast categories.
            }
        }
        if (result.isEmpty()) throw new UpstreamUnavailableException();
        return List.copyOf(result);
    }

    private static void validateQuery(String date, String time, int gridX, int gridY) {
        try {
            LocalDate.parse(date, DAY);
            LocalTime.of(Integer.parseInt(time.substring(0, 2)),
                    Integer.parseInt(time.substring(2, 4)));
        } catch (DateTimeException | IndexOutOfBoundsException | NumberFormatException
                 | NullPointerException ignored) {
            throw new IllegalArgumentException("Invalid village-forecast release");
        }
        if (!RELEASE_TIMES.contains(time) || gridX < 1 || gridX > 149
                || gridY < 1 || gridY > 253) {
            throw new IllegalArgumentException("Unsupported village-forecast query");
        }
    }

    private static List<JsonNode> items(JsonNode container) {
        JsonNode candidate = container.isObject() ? container.path("item") : container;
        List<JsonNode> result = new ArrayList<>();
        if (candidate.isArray()) candidate.forEach(result::add);
        else if (candidate.isObject()) result.add(candidate);
        return result;
    }

    private static String clean(JsonNode node, int maxLength) {
        if (node.isMissingNode() || node.isNull()) return null;
        String value = node.asString("").trim();
        if (value.isEmpty() || value.length() > maxLength
                || value.chars().anyMatch(Character::isISOControl)) {
            return null;
        }
        return value;
    }

    public record Value(Category category, LocalDateTime validAt, String rawValue) {
        public Value {
            if (category == null || validAt == null || rawValue == null || rawValue.isBlank()
                    || rawValue.length() > 64
                    || rawValue.chars().anyMatch(Character::isISOControl)) {
                throw new IllegalArgumentException("Invalid village-forecast value");
            }
        }
    }

    public enum Category {
        TEMPERATURE,
        HUMIDITY,
        PRECIPITATION_PROBABILITY,
        PRECIPITATION_AMOUNT,
        SNOWFALL_AMOUNT,
        SKY,
        PRECIPITATION_TYPE,
        WAVE_HEIGHT,
        WIND_SPEED,
        WIND_DIRECTION;

        private static Category fromCode(String code) {
            if (code == null) return null;
            return switch (code) {
                case "TMP", "T1H" -> TEMPERATURE;
                case "REH" -> HUMIDITY;
                case "POP" -> PRECIPITATION_PROBABILITY;
                case "PCP", "RN1" -> PRECIPITATION_AMOUNT;
                case "SNO" -> SNOWFALL_AMOUNT;
                case "SKY" -> SKY;
                case "PTY" -> PRECIPITATION_TYPE;
                case "WAV" -> WAVE_HEIGHT;
                case "WSD" -> WIND_SPEED;
                case "VEC" -> WIND_DIRECTION;
                default -> null;
            };
        }
    }
}
