package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.config.KmaClientProperties;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.util.KimGridGeometry;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

import java.net.URI;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Map;
import java.util.Set;

/** Narrow client for the two KMA ASCII grids used by this application. */
@Component
public final class KmaTextGateway {

    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private static final String DFS_PATH = "/api/typ01/cgi-bin/url/nph-dfs_shrt_grd";
    private static final String KIM_PATH = "/api/typ06/cgi-bin/url/nph-kim_nc_xy_txt2_std";
    private static final String SOLAR_VARIABLE = "dswrsfc";
    private static final Set<String> DFS_VARIABLES = Set.of(
            "TMP", "TMX", "TMN", "UUU", "VVV", "VEC", "WSD",
            "SKY", "PTY", "POP", "PCP", "SNO", "REH", "WAV");
    private static final Set<Integer> DFS_RUN_HOURS = Set.of(2, 5, 8, 11, 14, 17, 20, 23);
    private static final Set<Integer> KIM_RUN_HOURS = Set.of(0, 6, 12, 18);
    private static final DateTimeFormatter API_HOUR = DateTimeFormatter
            .ofPattern("uuuuMMddHH")
            .withResolverStyle(ResolverStyle.STRICT);

    private final DefaultUriBuilderFactory uris;
    private final ApiCredential credential;
    private final BoundedTextTransport transport;

    public KmaTextGateway(KmaClientProperties properties,
                          @Qualifier("kmaWebClient") WebClient http) {
        uris = new DefaultUriBuilderFactory(properties.baseUrl());
        uris.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.TEMPLATE_AND_VALUES);
        credential = new ApiCredential(properties.authKey());
        transport = new BoundedTextTransport(http, MAX_RESPONSE_BYTES);
    }

    /** Returns one complete 149 x 253 DFS field, or {@code null} when upstream is unavailable. */
    public String downloadDfsGrid(String issuedAt, String validAt, String variable) {
        LocalDateTime issued = parseHour(issuedAt, "issuedAt");
        LocalDateTime valid = parseHour(validAt, "validAt");
        if (!DFS_RUN_HOURS.contains(issued.getHour()) || valid.isBefore(issued)
                || variable == null || !DFS_VARIABLES.contains(variable)) {
            throw new IllegalArgumentException("Unsupported DFS grid request");
        }

        try {
            URI uri = uris.builder().path(DFS_PATH)
                    .queryParam("tmfc", "{issuedAt}")
                    .queryParam("tmef", "{validAt}")
                    .queryParam("vars", "{variable}")
                    .queryParam("authKey", "{credential}")
                    .build(Map.of(
                            "issuedAt", issuedAt,
                            "validAt", validAt,
                            "variable", variable,
                            "credential", credential.requiredValue()));
            return transport.get(uri);
        } catch (UpstreamUnavailableException ignored) {
            return null;
        }
    }

    /** Returns the fixed Korea crop of KIM surface downward short-wave radiation. */
    public String downloadSurfaceSolarGrid(String modelRun, int forecastHour, String variable) {
        LocalDateTime run = parseHour(modelRun, "modelRun");
        if (!KIM_RUN_HOURS.contains(run.getHour()) || !SOLAR_VARIABLE.equals(variable)
                || !isSupportedForecastHour(forecastHour)) {
            throw new IllegalArgumentException("Unsupported KIM solar-grid request");
        }

        try {
            URI uri = uris.builder().path(KIM_PATH)
                    .queryParam("group", "KIMG")
                    .queryParam("nwp", "NE57")
                    .queryParam("data", "U")
                    .queryParam("name", SOLAR_VARIABLE)
                    .queryParam("level", "0")
                    .queryParam("map", "S")
                    .queryParam("sub", "{crop}")
                    .queryParam("sm", "0")
                    .queryParam("tmfc", "{modelRun}")
                    .queryParam("hf", "{forecastHour}")
                    .queryParam("disp", "A")
                    .queryParam("help", "0")
                    .queryParam("authKey", "{credential}")
                    .build(Map.of(
                            "crop", KimGridGeometry.SUBSET_QUERY,
                            "modelRun", modelRun,
                            "forecastHour", Integer.toString(forecastHour),
                            "credential", credential.requiredValue()));
            return transport.get(uri);
        } catch (UpstreamUnavailableException ignored) {
            return null;
        }
    }

    private static LocalDateTime parseHour(String value, String field) {
        try {
            return LocalDateTime.parse(value, API_HOUR);
        } catch (DateTimeParseException | NullPointerException ignored) {
            throw new IllegalArgumentException(field + " must use yyyyMMddHH");
        }
    }

    private static boolean isSupportedForecastHour(int hour) {
        return hour >= 0 && hour <= 288 && (hour <= 135 || hour % 3 == 0);
    }
}
