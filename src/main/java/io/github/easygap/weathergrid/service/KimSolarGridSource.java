package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import io.github.easygap.weathergrid.util.KimGridGeometry;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** KIM NE57 downward-shortwave product for map grids and point series. */
@Service
public final class KimSolarGridSource {

    private static final double POINT_MISSING = 9999.0;
    private static final DateTimeFormatter RUN_KEY = DateTimeFormatter.ofPattern("yyyyMMddHH");
    private static final LocalDateTime HOURLY_CUTOVER_UTC = LocalDateTime.of(2026, 7, 1, 0, 0);

    private final GridDataRepository grids;
    private final WeatherGridWindow window;
    private final WeatherRuntimeOptions options;

    public KimSolarGridSource(GridDataRepository grids, WeatherGridWindow window,
                              WeatherRuntimeOptions options) {
        this.grids = grids;
        this.window = window;
        this.options = options;
    }

    public WeatherGridDataset loadGrid(ForecastReleaseClock.Release release, int requestedHour) {
        LocalDateTime referenceKst = release.dateTime();
        LocalDateTime requestedValidKst = referenceKst.plusHours(Math.max(requestedHour, 1));
        ModelGrid model = findGrid(referenceKst, requestedValidKst.minusHours(9));
        boolean demo = model == null;
        if (demo && !options.demoMode()) {
            throw new UpstreamUnavailableException("solar grid unavailable");
        }

        double[] values = new double[window.size()];
        int output = 0;
        for (int row = 0; row < window.rows(); row++) {
            int y = window.yAtPayloadRow(row);
            for (int column = 0; column < window.columns(); column++) {
                int x = window.xAt(column);
                values[output++] = demo
                        ? syntheticRadiation(x, y, requestedValidKst, requestedHour)
                        : sample(model.grid(), x, y);
            }
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("referenceTime", WeatherModelTimes.kst(referenceKst));
        metadata.put("requestedValidTime", WeatherModelTimes.kst(requestedValidKst));
        metadata.put("product", "KIM NE57 dswrsfc");
        if (model != null) {
            metadata.put("validTime", WeatherModelTimes.kst(model.validUtc().plusHours(9)));
            metadata.put("modelRunTime", WeatherModelTimes.utc(model.runUtc()));
            metadata.put("modelForecastHour", model.forecastHour());
            metadata.put("fallbackUsed", model.fallbackUsed());
            metadata.put("temporalResolutionHours", model.resolutionHours());
            metadata.put("timeAdjusted", !model.validUtc().equals(requestedValidKst.minusHours(9)));
        }
        return new WeatherGridDataset(values, demo, metadata, Map.of(), null);
    }

    public boolean supportsPoint(double latitude, double longitude) {
        return KimGridGeometry.locate(latitude, longitude).isPresent();
    }

    /** Returns the public 0..48 hour slots; slot zero mirrors the first visible hour. */
    public List<double[]> loadPointSeries(ForecastReleaseClock.Release release,
                                          double latitude, double longitude) {
        KimGridGeometry.Cell cell = KimGridGeometry.locate(latitude, longitude)
                .orElseThrow(() -> new IllegalArgumentException("Point is outside the KIM crop"));

        LocalDateTime baseKst = release.dateTime();
        LocalDateTime baseUtc = baseKst.minusHours(9);
        LocalDateTime run = availableRun(baseKst);
        int farthestHour = forecastHour(run, baseUtc.plusHours(48));
        double[][] farthest = grids.readKimSolar(run.format(RUN_KEY), farthestHour);
        if (farthest == null) {
            run = run.minusHours(6);
            farthestHour = forecastHour(run, baseUtc.plusHours(48));
            farthest = grids.readKimSolar(run.format(RUN_KEY), farthestHour);
        }

        Map<Integer, double[][]> byForecastHour = new HashMap<>();
        byForecastHour.put(farthestHour, farthest);
        String runKey = run.format(RUN_KEY);
        List<double[]> series = new ArrayList<>(49);
        for (int slot = 0; slot <= 48; slot++) {
            int visibleHour = Math.max(slot, 1);
            int modelHour = forecastHour(run, baseUtc.plusHours(visibleHour));
            double[][] grid = byForecastHour.computeIfAbsent(modelHour,
                    key -> grids.readKimSolar(runKey, key));
            double value = sampleAt(grid, cell.row(), cell.column(), POINT_MISSING);
            series.add(new double[]{normalize(value), 0});
        }
        return series;
    }

    private ModelGrid findGrid(LocalDateTime baseKst, LocalDateTime requestedValidUtc) {
        LocalDateTime run = availableRun(baseKst);
        for (int attempt = 0; attempt < 2; attempt++) {
            int resolution = run.isBefore(HOURLY_CUTOVER_UTC) ? 3 : 1;
            long exact = Duration.between(run, requestedValidUtc).toHours();
            int hour = resolution == 1
                    ? (int) Math.max(0, exact)
                    : (int) Math.max(0, Math.round(exact / 3.0) * 3);
            double[][] grid = grids.readKimSolar(run.format(RUN_KEY), hour);
            if (grid != null) {
                return new ModelGrid(grid, run, hour, run.plusHours(hour), resolution, attempt > 0);
            }
            run = run.minusHours(6);
        }
        return null;
    }

    private static LocalDateTime availableRun(LocalDateTime baseKst) {
        LocalDateTime baseUtc = baseKst.minusHours(9);
        LocalDateTime run = baseUtc.withHour((baseUtc.getHour() / 6) * 6);
        return Duration.between(run, baseUtc).toHours() < 5 ? run.minusHours(6) : run;
    }

    private static int forecastHour(LocalDateTime runUtc, LocalDateTime validUtc) {
        long exact = Math.max(0, Duration.between(runUtc, validUtc).toHours());
        return runUtc.isBefore(HOURLY_CUTOVER_UTC)
                ? (int) Math.max(0, Math.round(exact / 3.0) * 3)
                : (int) exact;
    }

    private static double sample(double[][] solar, int x, int y) {
        KmaDfsProjection.GeoPoint point = KmaDfsProjection.STANDARD.cellCenter(x, y);
        KimGridGeometry.Cell cell = KimGridGeometry.locate(
                point.latitude(), point.longitude()).orElse(null);
        return cell == null
                ? KimGridGeometry.NO_DATA
                : normalize(sampleAt(solar, cell.row(), cell.column(), KimGridGeometry.NO_DATA));
    }

    private static double sampleAt(double[][] grid, int row, int column, double missing) {
        if (grid == null || row < 0 || row >= grid.length || grid[row] == null
                || column < 0 || column >= grid[row].length) {
            return missing;
        }
        return grid[row][column];
    }

    private static double normalize(double value) {
        return Double.isFinite(value) && value > -900 ? Math.max(0, value) : value;
    }

    private static double syntheticRadiation(int x, int y, LocalDateTime validAt,
                                             int requestedHour) {
        KmaDfsProjection.GeoPoint point = KmaDfsProjection.STANDARD.cellCenter(x, y);
        double latitude = Math.toRadians(point.latitude());
        double declination = Math.toRadians(23.44)
                * Math.sin(2 * Math.PI * (284 + validAt.getDayOfYear()) / 365.0);
        double hourAngle = Math.toRadians(15 * (validAt.getHour() - 12.5));
        double elevation = Math.sin(latitude) * Math.sin(declination)
                + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
        if (elevation <= 0) return 0;
        double cloud = 0.76 + 0.14 * Math.sin(point.longitude() * 1.7
                + point.latitude() * 0.8 + requestedHour * 0.17);
        return Math.round(Math.max(0, 1080 * Math.pow(elevation, 1.2) * cloud));
    }

    private record ModelGrid(double[][] grid, LocalDateTime runUtc, int forecastHour,
                             LocalDateTime validUtc, int resolutionHours,
                             boolean fallbackUsed) { }
}
