package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.KmaClientProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.DateTimeException;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** KMA API Hub client for one documented village-forecast grid point. */
@Component
public final class KmaPointForecastGateway {

    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private static final String PATH =
            "/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst";
    private static final Set<String> RELEASE_TIMES = Set.of(
            "0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300");
    private static final DateTimeFormatter DAY = DateTimeFormatter
            .ofPattern("uuuuMMdd").withResolverStyle(ResolverStyle.STRICT);
    private static final DateTimeFormatter VALID_TIME = DateTimeFormatter
            .ofPattern("uuuuMMddHHmm").withResolverStyle(ResolverStyle.STRICT);

    private final DefaultUriBuilderFactory uris;
    private final ApiCredential credential;
    private final BoundedJsonTransport transport;

    public KmaPointForecastGateway(ObjectMapper json,
                                   KmaClientProperties properties,
                                   @Qualifier("kmaWebClient") WebClient http) {
        uris = new DefaultUriBuilderFactory(properties.baseUrl());
        uris.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.TEMPLATE_AND_VALUES);
        credential = new ApiCredential(properties.authKey());
        transport = new BoundedJsonTransport(json, http, MAX_RESPONSE_BYTES);
    }

    public List<ForecastValue> fetch(String releaseDate, String releaseTime, int gridX, int gridY) {
        validate(releaseDate, releaseTime, gridX, gridY);
        try {
            URI uri = uris.builder().path(PATH)
                    .queryParam("pageNo", "1")
                    .queryParam("numOfRows", "1000")
                    .queryParam("dataType", "JSON")
                    .queryParam("base_date", "{releaseDate}")
                    .queryParam("base_time", "{releaseTime}")
                    .queryParam("nx", "{gridX}")
                    .queryParam("ny", "{gridY}")
                    .queryParam("authKey", "{credential}")
                    .build(Map.of(
                            "releaseDate", releaseDate,
                            "releaseTime", releaseTime,
                            "gridX", Integer.toString(gridX),
                            "gridY", Integer.toString(gridY),
                            "credential", credential.requiredValue()));
            return parse(transport.get(uri));
        } catch (UpstreamUnavailableException ignored) {
            return List.of();
        }
    }

    private static List<ForecastValue> parse(JsonNode root) {
        JsonNode response = root.path("response");
        if (!"00".equals(text(response.path("header").path("resultCode")))) {
            return List.of();
        }
        JsonNode items = response.path("body").path("items").path("item");
        if (!items.isArray()) return List.of();

        List<ForecastValue> values = new ArrayList<>();
        for (JsonNode item : items) {
            Category category = Category.fromCode(text(item.path("category")));
            if (category == null) continue;
            try {
                LocalDateTime validAt = LocalDateTime.parse(
                        text(item.path("fcstDate")) + text(item.path("fcstTime")),
                        VALID_TIME);
                double value = Double.parseDouble(text(item.path("fcstValue")));
                if (Double.isFinite(value)) values.add(new ForecastValue(category, validAt, value));
            } catch (DateTimeParseException | NumberFormatException ignored) {
                // A malformed item cannot invalidate the other forecast hours.
            }
        }
        return List.copyOf(values);
    }

    private static String text(JsonNode node) {
        return node.isMissingNode() || node.isNull() ? "" : node.asString();
    }

    private static void validate(String releaseDate, String releaseTime, int gridX, int gridY) {
        try {
            LocalDate.parse(releaseDate, DAY);
            LocalTime.of(Integer.parseInt(releaseTime.substring(0, 2)),
                    Integer.parseInt(releaseTime.substring(2, 4)));
        } catch (DateTimeException | IndexOutOfBoundsException | NumberFormatException
                 | NullPointerException ignored) {
            throw new IllegalArgumentException("Invalid KMA point-forecast release");
        }
        if (!RELEASE_TIMES.contains(releaseTime) || gridX < 1 || gridX > 149
                || gridY < 1 || gridY > 253) {
            throw new IllegalArgumentException("Unsupported KMA point-forecast request");
        }
    }

    public record ForecastValue(Category category, LocalDateTime validAt, double value) {
        public ForecastValue {
            if (category == null || validAt == null || !Double.isFinite(value)) {
                throw new IllegalArgumentException("Invalid forecast value");
            }
        }
    }

    public enum Category {
        WIND_SPEED,
        WIND_DIRECTION,
        EAST_WIND,
        NORTH_WIND,
        TEMPERATURE;

        private static Category fromCode(String code) {
            return switch (code) {
                case "WSD" -> WIND_SPEED;
                case "VEC" -> WIND_DIRECTION;
                case "UUU" -> EAST_WIND;
                case "VVV" -> NORTH_WIND;
                case "TMP", "T1H" -> TEMPERATURE;
                default -> null;
            };
        }
    }
}
