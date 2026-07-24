package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.NumericSummary;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Selects a weather product and assembles the stable public grid response. */
@Service
public final class WeatherGridService {

    private final ForecastReleaseClock releases;
    private final WeatherGridWindow window;
    private final DfsWindGridSource wind;
    private final DfsScalarGridSource scalar;
    private final KimSolarGridSource solar;

    public WeatherGridService(ForecastReleaseClock releases, WeatherGridWindow window,
                              DfsWindGridSource wind, DfsScalarGridSource scalar,
                              KimSolarGridSource solar) {
        this.releases = releases;
        this.window = window;
        this.wind = wind;
        this.scalar = scalar;
        this.solar = solar;
    }

    public Map<String, Object> grid(String baseDate, String baseTime,
                                    String element, int requestedHour) {
        return response(baseDate, baseTime, element, requestedHour, true);
    }

    public Map<String, Object> statistics(String baseDate, String baseTime,
                                          String element, int requestedHour) {
        Map<String, Object> complete = response(
                baseDate, baseTime, element, requestedHour, false);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("stats", complete.get("stats"));
        if (complete.containsKey("categoryCounts")) {
            result.put("categoryCounts", complete.get("categoryCounts"));
        }
        return result;
    }

    private Map<String, Object> response(String baseDate, String baseTime, String element,
                                         int requestedHour, boolean includePayload) {
        ForecastReleaseClock.Release release = releases.atOrBefore(baseDate, baseTime);
        WeatherGridDataset dataset = select(element, release, requestedHour);
        if (dataset.values().length != window.size()) {
            throw new IllegalStateException("Grid source returned an unexpected cell count");
        }

        Summary summary = summarize(dataset.values(), dataset.categories());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("stats", summary.stats());
        if (summary.categoryCounts() != null) {
            result.put("categoryCounts", summary.categoryCounts());
        }
        if (!includePayload) return result;

        List<Double> values = new ArrayList<>(dataset.values().length);
        for (double value : dataset.values()) values.add(value);
        KmaDfsProjection.GeoPoint southWest = window.southWest();
        KmaDfsProjection.GeoPoint northEast = window.northEast();
        result.put("data", values);
        result.put("nx", window.columns());
        result.put("ny", window.rows());
        result.put("nxMin", window.minX());
        result.put("nyMin", window.minY());
        result.put("step", window.step());
        result.put("baseDate", release.compactDate());
        result.put("baseTime", release.compactTime());
        result.put("swLat", southWest.latitude());
        result.put("swLon", southWest.longitude());
        result.put("neLat", northEast.latitude());
        result.put("neLon", northEast.longitude());
        result.put("mock", dataset.demo());
        result.putAll(dataset.metadata());
        result.put("windField", dataset.windField());
        return result;
    }

    private WeatherGridDataset select(String element, ForecastReleaseClock.Release release,
                                      int requestedHour) {
        if ("wdws".equals(element)) return wind.load(release, requestedHour);
        if (scalar.supports(element)) return scalar.load(element, release, requestedHour);
        if ("swdn".equals(element)) return solar.loadGrid(release, requestedHour);
        throw new RequestRejectedException("잘못된 element");
    }

    private static Summary summarize(double[] values, Map<Integer, String> categories) {
        boolean categorical = !categories.isEmpty();
        Map<Integer, Integer> counts = categorical ? new LinkedHashMap<>() : null;
        if (counts != null) categories.keySet().stream().sorted().forEach(code -> counts.put(code, 0));

        double minimum = Double.POSITIVE_INFINITY;
        double maximum = Double.NEGATIVE_INFINITY;
        double total = 0;
        int count = 0;
        for (double value : values) {
            if (!Double.isFinite(value) || value <= -900) continue;
            if (counts != null) counts.computeIfPresent((int) value, (code, current) -> current + 1);
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            total += value;
            count++;
        }

        if (categorical) {
            Map<String, Object> stats = new LinkedHashMap<>();
            stats.put("min", null);
            stats.put("avg", null);
            stats.put("max", null);
            stats.put("count", count);
            return new Summary(stats, counts);
        }

        if (count == 0) {
            minimum = 0;
            maximum = 0;
        }
        double average = count == 0 ? 0 : total / count;
        NumericSummary stats = new NumericSummary(
                roundOneDecimal(minimum),
                roundOneDecimal(average),
                roundOneDecimal(maximum));
        return new Summary(stats, null);
    }

    private static double roundOneDecimal(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private record Summary(Object stats, Map<Integer, Integer> categoryCounts) { }
}
