package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/** Retrieves one DFS scalar variable and applies its public value-domain contract. */
@Service
public final class DfsScalarGridSource {

    private static final double MISSING = -999.0;
    private static final Map<Integer, String> PRECIPITATION_TYPES = Map.of(
            0, "없음", 1, "비", 2, "비/눈", 3, "눈", 4, "소나기");
    private static final Map<Integer, String> SKY_CONDITIONS = Map.of(
            1, "맑음", 3, "구름많음", 4, "흐림");
    private static final Map<String, ScalarProduct> PRODUCTS = Map.ofEntries(
            Map.entry("tmp", new ScalarProduct("TMP", "°C", -100, 80, Map.of(), null,
                    "KMA DFS TMP", "temperature grid unavailable")),
            Map.entry("pcp", new ScalarProduct("PCP", "mm", 0, 1_000, Map.of(), 1,
                    "KMA DFS PCP", "precipitation grid unavailable")),
            Map.entry("sno", new ScalarProduct("SNO", "cm", 0, 100, Map.of(), 1,
                    "KMA DFS SNO", "snowfall grid unavailable")),
            Map.entry("pty", new ScalarProduct("PTY", "code", 0, 0, PRECIPITATION_TYPES, null,
                    "KMA DFS PTY", "precipitation type grid unavailable")),
            Map.entry("reh", new ScalarProduct("REH", "%", 0, 100, Map.of(), null,
                    "KMA DFS REH", "humidity grid unavailable")),
            Map.entry("sky", new ScalarProduct("SKY", "code", 0, 0, SKY_CONDITIONS, null,
                    "KMA DFS SKY", "sky condition grid unavailable")),
            Map.entry("wav", new ScalarProduct("WAV", "m", 0, 50, Map.of(), null,
                    "KMA DFS WAV", "wave height grid unavailable")));

    private final GridDataRepository grids;
    private final WeatherGridWindow window;
    private final WeatherRuntimeOptions options;

    public DfsScalarGridSource(GridDataRepository grids, WeatherGridWindow window,
                               WeatherRuntimeOptions options) {
        this.grids = grids;
        this.window = window;
        this.options = options;
    }

    public boolean supports(String element) {
        return PRODUCTS.containsKey(element);
    }

    public WeatherGridDataset load(String element, ForecastReleaseClock.Release release,
                                   int requestedHour) {
        ScalarProduct product = PRODUCTS.get(element);
        if (product == null) throw new IllegalArgumentException("Unsupported DFS scalar element");

        LocalDateTime reference = release.dateTime();
        LocalDateTime validAt = reference.plusHours(Math.max(requestedHour, 1));
        ModelGrid model = findGrid(reference, validAt, product);
        boolean demo = model == null;
        if (demo && !(options.demoMode() && "tmp".equals(element))) {
            throw new UpstreamUnavailableException(product.unavailableMessage());
        }

        double[] values = new double[window.size()];
        int output = 0;
        for (int row = 0; row < window.rows(); row++) {
            int y = window.yAtPayloadRow(row);
            for (int column = 0; column < window.columns(); column++) {
                int x = window.xAt(column);
                double value = demo
                        ? syntheticTemperature(x, y, validAt, requestedHour)
                        : sample(model.grid(), x, y);
                values[output++] = product.valid(value) ? value : MISSING;
            }
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("referenceTime", WeatherModelTimes.kst(reference));
        metadata.put("validTime", WeatherModelTimes.kst(validAt));
        metadata.put("product", product.productName());
        metadata.put("unit", product.unit());
        if (product.accumulationHours() != null) {
            metadata.put("accumulationHours", product.accumulationHours());
        }
        if (!product.categories().isEmpty()) metadata.put("categories", product.categories());
        if (model != null) {
            metadata.put("modelRunTime", WeatherModelTimes.utcFromKst(model.runAt()));
            metadata.put("modelForecastHour", model.forecastHour());
            metadata.put("fallbackUsed", model.fallbackUsed());
        }
        return new WeatherGridDataset(values, demo, metadata, product.categories(), null);
    }

    private ModelGrid findGrid(LocalDateTime requestedRun, LocalDateTime validAt,
                               ScalarProduct product) {
        String validKey = validAt.format(WeatherModelTimes.COMPACT_HOUR);
        for (int attempt = 0; attempt < 2; attempt++) {
            LocalDateTime run = requestedRun.minusHours(attempt * 3L);
            double[][] candidate = grids.readDfs(run.format(WeatherModelTimes.COMPACT_HOUR),
                    validKey, product.variable(), MISSING);
            if (containsUsableCell(candidate, product)) {
                int forecastHour = Math.toIntExact(Duration.between(run, validAt).toHours());
                return new ModelGrid(candidate, run, forecastHour, attempt > 0);
            }
        }
        return null;
    }

    private boolean containsUsableCell(double[][] grid, ScalarProduct product) {
        for (int row = 0; row < window.rows(); row++) {
            int y = window.yAtPayloadRow(row);
            for (int column = 0; column < window.columns(); column++) {
                if (product.valid(sample(grid, window.xAt(column), y))) return true;
            }
        }
        return false;
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

    private static double syntheticTemperature(int x, int y, LocalDateTime validAt,
                                               int requestedHour) {
        KmaDfsProjection.GeoPoint point = KmaDfsProjection.STANDARD.cellCenter(x, y);
        double seasonal = 13.5 + 12 * Math.sin(
                2 * Math.PI * (validAt.getDayOfYear() - 109) / 365.25);
        double daily = 4.2 * Math.cos(2 * Math.PI * (validAt.getHour() - 15) / 24.0);
        double latitudeEffect = -0.72 * (point.latitude() - 36);
        double regional = 1.8 * Math.sin((point.longitude() - 126.4) * 0.85
                + (point.latitude() - 35.5) * 0.45 + requestedHour * 0.08);
        return Math.round((seasonal + daily + latitudeEffect + regional) * 10) / 10.0;
    }

    private record ModelGrid(double[][] grid, LocalDateTime runAt, int forecastHour,
                             boolean fallbackUsed) { }

    private record ScalarProduct(String variable, String unit, double minimum, double maximum,
                                 Map<Integer, String> categories, Integer accumulationHours,
                                 String productName, String unavailableMessage) {
        private boolean valid(double value) {
            if (!Double.isFinite(value) || value <= -900 || value >= 9_000) return false;
            if (!categories.isEmpty()) {
                return value == Math.rint(value) && categories.containsKey((int) value);
            }
            return value >= minimum && value <= maximum;
        }
    }
}
