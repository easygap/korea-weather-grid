package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Converts the two documented AirKorea feeds into provider-neutral records. */
@Component
public final class AirQualityFeed {

    private static final int PAGE_SIZE = 1_000;
    private static final int PAGE_LIMIT = 20;
    private static final DateTimeFormatter OBSERVED_AT = DateTimeFormatter
            .ofPattern("uuuu-MM-dd HH:mm").withResolverStyle(ResolverStyle.STRICT);

    private final PublicDataGateway gateway;

    public AirQualityFeed(PublicDataGateway gateway) {
        this.gateway = gateway;
    }

    public List<Measurement> fetchMeasurements() {
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("returnType", "json");
        query.put("sidoName", "전국");
        query.put("ver", "1.3");

        List<Measurement> result = new ArrayList<>();
        for (JsonNode item : fetchPages(PublicDataGateway.Dataset.AIR_QUALITY, query)) {
            String name = clean(item, "stationName", 80);
            String observedAt = observedAt(item);
            if (name == null || observedAt == null) continue;
            result.add(new Measurement(
                    name,
                    clean(item, "sidoName", 40),
                    clean(item, "addr", 512),
                    clean(item, "mangName", 80),
                    decimal(item, "pm10Value", 0, 2_000),
                    decimal(item, "pm25Value", 0, 1_000),
                    grade(item, "pm10Grade1h"),
                    grade(item, "pm25Grade1h"),
                    clean(item, "pm10Flag", 100),
                    clean(item, "pm25Flag", 100),
                    observedAt));
        }
        if (result.isEmpty()) throw new UpstreamUnavailableException();
        return List.copyOf(result);
    }

    public List<Station> fetchStations() {
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("returnType", "json");
        query.put("ver", "1.1");

        List<Station> result = new ArrayList<>();
        for (JsonNode item : fetchPages(PublicDataGateway.Dataset.AIR_STATIONS, query)) {
            String name = clean(item, "stationName", 80);
            double[] coordinate = coordinate(
                    clean(item, "dmX", 32), clean(item, "dmY", 32));
            if (name == null || coordinate == null) continue;
            result.add(new Station(name, clean(item, "addr", 512),
                    clean(item, "mangName", 80), coordinate[0], coordinate[1]));
        }
        if (result.isEmpty()) throw new UpstreamUnavailableException();
        return List.copyOf(result);
    }

    private List<JsonNode> fetchPages(PublicDataGateway.Dataset dataset,
                                      Map<String, Object> baseQuery) {
        List<JsonNode> result = new ArrayList<>();
        Integer expected = null;
        for (int page = 1; page <= PAGE_LIMIT; page++) {
            Map<String, Object> query = new LinkedHashMap<>(baseQuery);
            query.put("pageNo", page);
            query.put("numOfRows", PAGE_SIZE);
            JsonNode response = gateway.request(dataset, query).path("response");
            if (!"00".equals(response.path("header").path("resultCode").asString(""))) {
                throw new UpstreamUnavailableException();
            }
            JsonNode body = response.path("body");
            int pageTotal = body.path("totalCount").asInt(-1);
            if (pageTotal <= 0 || pageTotal > PAGE_SIZE * PAGE_LIMIT
                    || expected != null && pageTotal != expected) {
                throw new UpstreamUnavailableException();
            }
            expected = pageTotal;
            List<JsonNode> pageItems = items(body.path("items"));
            if (pageItems.isEmpty() || result.size() + pageItems.size() > expected) {
                throw new UpstreamUnavailableException();
            }
            result.addAll(pageItems);
            if (result.size() == expected) return result;
            if (pageItems.size() < PAGE_SIZE) throw new UpstreamUnavailableException();
        }
        throw new UpstreamUnavailableException();
    }

    private static List<JsonNode> items(JsonNode container) {
        JsonNode candidate = container.isObject() && container.has("item")
                ? container.path("item") : container;
        List<JsonNode> result = new ArrayList<>();
        if (candidate.isArray()) candidate.forEach(result::add);
        else if (candidate.isObject()) result.add(candidate);
        return result;
    }

    private static String observedAt(JsonNode item) {
        String value = clean(item, "dataTime", 16);
        if (value == null) return null;
        try {
            LocalDateTime.parse(value, OBSERVED_AT);
            return value;
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }

    private static String clean(JsonNode item, String field, int maximumLength) {
        JsonNode node = item.path(field);
        if (node.isMissingNode() || node.isNull()) return null;
        String value = node.asString("").trim();
        if (value.isEmpty() || "-".equals(value) || value.length() > maximumLength
                || value.chars().anyMatch(Character::isISOControl)) {
            return null;
        }
        return value;
    }

    private static Double decimal(JsonNode item, String field, double minimum, double maximum) {
        String raw = clean(item, field, 32);
        if (raw == null) return null;
        try {
            double value = Double.parseDouble(raw);
            return Double.isFinite(value) && value >= minimum && value <= maximum ? value : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static Integer grade(JsonNode item, String field) {
        Double value = decimal(item, field, 1, 4);
        return value != null && value == Math.rint(value) ? value.intValue() : null;
    }

    private static double[] coordinate(String first, String second) {
        Double x = number(first);
        Double y = number(second);
        if (x == null || y == null) return null;
        // Current AirKorea documentation defines dmX as latitude and dmY as longitude.
        if (latitude(x) && longitude(y)) return new double[]{x, y};
        // Older records have appeared with conventional X/Y ordering; accept only if unambiguous.
        if (longitude(x) && latitude(y)) return new double[]{y, x};
        return null;
    }

    private static Double number(String raw) {
        if (raw == null) return null;
        try {
            double value = Double.parseDouble(raw);
            return Double.isFinite(value) ? value : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static boolean latitude(double value) {
        return value >= 32 && value <= 44;
    }

    private static boolean longitude(double value) {
        return value >= 122 && value <= 134;
    }

    public record Measurement(
            String name,
            String region,
            String address,
            String network,
            Double pm10,
            Double pm25,
            Integer pm10Grade,
            Integer pm25Grade,
            String pm10Flag,
            String pm25Flag,
            String observedAt) {

        public Measurement {
            if (name == null || name.isBlank() || observedAt == null || observedAt.isBlank()) {
                throw new IllegalArgumentException("Invalid air-quality measurement");
            }
        }
    }

    public record Station(String name, String address, String network,
                          double latitude, double longitude) {
        public Station {
            if (name == null || name.isBlank()
                    || !AirQualityFeed.latitude(latitude)
                    || !AirQualityFeed.longitude(longitude)) {
                throw new IllegalArgumentException("Invalid air-quality station");
            }
        }
    }
}
