package io.github.easygap.weathergrid;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class StaticShellParityTest {

    private static final Path JSP = Path.of("src/main/webapp/WEB-INF/jsp/weather-grid.jsp");
    private static final Path JSP_ROOT = JSP.toAbsolutePath().normalize().getParent();
    private static final Path CLOUDFLARE = Path.of("cloudflare/public/index.html");
    private static final Pattern INCLUDE = Pattern.compile("<%@\\s*include\\s+file=\"([^\"]+)\"\\s*%>");

    @Test
    void springAndCloudflareShellsExposeTheSameInteractiveSurface() throws IOException {
        String jsp = expandJsp(JSP.toAbsolutePath().normalize(), new ArrayList<>());
        String cloudflare = Files.readString(CLOUDFLARE);

        List<String> requiredIds = List.of(
                "map", "height", "forecast_scrubber", "weather_stations",
                "station_chart_summary", "station_data_table");
        requiredIds.forEach(id -> {
            assertTrue(jsp.contains("id=\"" + id + "\""), "JSP missing #" + id);
            assertTrue(cloudflare.contains("id=\"" + id + "\""), "Cloudflare shell missing #" + id);
        });

        List<String> versionedAssets = List.of(
                "css/style.css", "js/app-bootstrap.js", "js/geodata-loader.js", "js/infra.js",
                "js/station-charts.js", "js/weather-grid-dfs-projection.js",
                "js/wind-grid.js", "js/windy.js",
                "js/weather-grid-vworld-state.js", "js/weather-grid-vworld.js",
                "js/weather-grid-map-bootstrap.js", "js/weather-grid.js",
                "js/weather-grid-isoline-state.js", "js/isoline.js", "js/air-quality.js",
                "js/weather-grid-interface-state.js", "js/weather-grid-interface.js",
                "js/weather-grid-control-state.js", "js/weather-grid-controls.js",
                "js/weather-grid-legend-model.js", "js/weather-grid-legend.js",
                "js/weather-grid-navigation-state.js", "js/weather-grid-navigation.js",
                "js/weather-grid-map-state.js", "js/weather-grid-projection.js",
                "js/weather-grid-readout.js", "js/weather-grid-layer-state.js",
                "js/weather-grid-layers.js", "js/weather-grid-run-state.js",
                "js/weather-grid-runs.js", "js/weather-grid-explore-state.js",
                "js/weather-grid-explore.js", "js/weather-grid-view3d-state.js",
                "js/weather-grid-view3d.js", "js/weather-grid-infrastructure-state.js",
                "js/weather-grid-infrastructure.js",
                "js/weather-grid-session.js");
        versionedAssets.forEach(asset -> assertEquals(
                assetVersion(jsp, asset), assetVersion(cloudflare, asset),
                asset + " cache versions differ"));

        assertContentContract(jsp, "JSP");
        assertContentContract(cloudflare, "Cloudflare shell");
    }

    private String expandJsp(Path source, List<Path> ancestors) throws IOException {
        Path normalized = source.toAbsolutePath().normalize();
        assertTrue(normalized.startsWith(JSP_ROOT), "JSP include must stay below the template root");
        assertFalse(ancestors.contains(normalized), "JSP include cycle: " + normalized);

        List<Path> nextAncestors = new ArrayList<>(ancestors);
        nextAncestors.add(normalized);
        Matcher matcher = INCLUDE.matcher(Files.readString(normalized));
        StringBuilder expanded = new StringBuilder();
        while (matcher.find()) {
            Path child = normalized.getParent().resolve(matcher.group(1)).normalize();
            matcher.appendReplacement(expanded, Matcher.quoteReplacement(expandJsp(child, nextAncestors)));
        }
        matcher.appendTail(expanded);
        return expanded.toString();
    }

    private String assetVersion(String source, String asset) {
        Pattern pattern = Pattern.compile("static/" + Pattern.quote(asset) + "\\?v=([0-9.]+)");
        Matcher matcher = pattern.matcher(source);
        assertTrue(matcher.find(), asset + " has no cache version");
        return matcher.group(1);
    }

    private void assertContentContract(String source, String shellName) {
        assertEquals(1, countOccurrences(source, "<option value=\"10m\">10m</option>"),
                shellName + " must expose exactly one supported height option");
        assertTrue(source.contains("<strong>일사강도</strong><small>W/㎡</small>"),
                shellName + " has an inconsistent solar label");
        assertFalse(source.contains("data-explore-mode=\"air\""));
        assertFalse(source.contains("data-explore-mode=\"road\""));
        assertFalse(source.contains("btn_cal_day"));
    }

    private int countOccurrences(String source, String token) {
        int count = 0;
        int offset = 0;
        while ((offset = source.indexOf(token, offset)) >= 0) {
            count++;
            offset += token.length();
        }
        return count;
    }
}
