package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/** Loads and normalizes the DFS 10 m wind product for the public map window. */
@Service
public final class DfsWindGridSource {

    private static final double MISSING = -999.0;
    private static final double MAX_COMPONENT = 150.0;
    private static final double MAX_SPEED = Math.sqrt(2.0) * MAX_COMPONENT;
    private static final int ENCODED_MISSING = -32768;

    private final GridDataRepository grids;
    private final WeatherGridWindow window;
    private final WeatherRuntimeOptions options;

    public DfsWindGridSource(GridDataRepository grids, WeatherGridWindow window,
                             WeatherRuntimeOptions options) {
        this.grids = grids;
        this.window = window;
        this.options = options;
    }

    public WeatherGridDataset load(ForecastReleaseClock.Release release, int requestedHour) {
        LocalDateTime reference = release.dateTime();
        int forecastHour = Math.max(requestedHour, 1);
        String runKey = reference.format(WeatherModelTimes.COMPACT_HOUR);
        String validKey = reference.plusHours(forecastHour).format(WeatherModelTimes.COMPACT_HOUR);

        double[][] speeds = grids.readDfs(runKey, validKey, "WSD", MISSING);
        double[][] eastward = grids.readDfs(runKey, validKey, "UUU", MISSING);
        double[][] northward = grids.readDfs(runKey, validKey, "VVV", MISSING);
        boolean demo = speeds == null && eastward == null && northward == null;
        if (demo && !options.demoMode()) {
            throw new UpstreamUnavailableException("wind grid unavailable");
        }

        double[] values = new double[window.size()];
        int[] encodedEastward = new int[window.size()];
        int[] encodedNorthward = new int[window.size()];
        int output = 0;
        for (int row = 0; row < window.rows(); row++) {
            int y = window.yAtPayloadRow(row);
            for (int column = 0; column < window.columns(); column++) {
                int x = window.xAt(column);
                WindCell cell = demo
                        ? syntheticCell(x, y, reference.plusHours(forecastHour))
                        : observedCell(speeds, eastward, northward, x, y);
                values[output] = cell.speed();
                if (validComponent(cell.eastward()) && validComponent(cell.northward())) {
                    encodedEastward[output] = (int) Math.round(cell.eastward() * 10);
                    encodedNorthward[output] = (int) Math.round(cell.northward() * 10);
                } else {
                    encodedEastward[output] = ENCODED_MISSING;
                    encodedNorthward[output] = ENCODED_MISSING;
                }
                output++;
            }
        }

        return new WeatherGridDataset(values, demo, Map.of(), Map.of(),
                windField(reference, requestedHour, forecastHour,
                        encodedEastward, encodedNorthward));
    }

    private WindCell observedCell(double[][] speeds, double[][] eastward, double[][] northward,
                                  int x, int y) {
        double u = sample(eastward, x, y);
        double v = sample(northward, x, y);
        boolean vectorAvailable = validComponent(u) && validComponent(v);
        double reportedSpeed = sample(speeds, x, y);
        double speed = validSpeed(reportedSpeed)
                ? reportedSpeed
                : vectorAvailable ? Math.hypot(u, v) : MISSING;
        return new WindCell(speed, u, v);
    }

    private static double sample(double[][] grid, int x, int y) {
        int row = y - 1;
        int column = x - 1;
        if (grid == null || row < 0 || row >= grid.length || grid[row] == null
                || column < 0 || column >= grid[row].length) {
            return MISSING;
        }
        return grid[row][column];
    }

    private static boolean validComponent(double value) {
        return Double.isFinite(value) && Math.abs(value) <= MAX_COMPONENT;
    }

    private static boolean validSpeed(double value) {
        return Double.isFinite(value) && value >= 0 && value <= MAX_SPEED;
    }

    /** Deterministic local preview; never used unless demo mode is explicitly enabled. */
    private static WindCell syntheticCell(int x, int y, LocalDateTime validAt) {
        double phase = validAt.getHour() * 0.11 + x * 0.045 - y * 0.018;
        double u = 2.4 + Math.sin(phase) * 1.7;
        double v = -0.6 + Math.cos(phase * 0.8) * 1.3;
        return new WindCell(Math.round(Math.hypot(u, v) * 10) / 10.0,
                Math.round(u * 10) / 10.0, Math.round(v * 10) / 10.0);
    }

    private Map<String, Object> windField(LocalDateTime reference, int requestedHour,
                                          int forecastHour, int[] eastward, int[] northward) {
        Map<String, Object> grid = new LinkedHashMap<>();
        grid.put("type", "kma-dfs-lcc");
        grid.put("nx", window.columns());
        grid.put("ny", window.rows());
        grid.put("nxMin", window.minX());
        grid.put("nyMin", window.minY());
        grid.put("step", window.step());
        grid.put("rowOrder", "north-to-south");
        grid.put("columnOrder", "west-to-east");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("schema", "weather-grid.wind-field/v1");
        payload.put("unit", "m/s");
        payload.put("scaleFactor", 0.1);
        payload.put("noData", ENCODED_MISSING);
        payload.put("vectorReference", "earth-relative");
        payload.put("heightMeters", 10);
        payload.put("requestedForecastHour", requestedHour);
        payload.put("forecastHour", forecastHour);
        payload.put("referenceTime", WeatherModelTimes.kst(reference));
        payload.put("validTime", WeatherModelTimes.kst(reference.plusHours(forecastHour)));
        payload.put("grid", grid);
        payload.put("u", eastward);
        payload.put("v", northward);
        return payload;
    }

    private record WindCell(double speed, double eastward, double northward) { }
}
