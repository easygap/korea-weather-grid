package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.geo.KmaDfsProjection;

import java.util.Set;

/** Product-aware acceptance rules for one parsed DFS field. */
final class DfsFieldQuality {

    private static final Set<String> DISPLAY_FIELDS = Set.of(
            "WSD", "UUU", "VVV", "TMP", "PCP", "SNO", "PTY", "REH", "SKY", "WAV");
    private static final Set<Double> PRECIPITATION_TYPES = Set.of(0d, 1d, 2d, 3d, 4d);
    private static final Set<Double> SKY_STATES = Set.of(1d, 3d, 4d);
    private static final double MAX_COMPONENT = 150;
    private static final double MAX_SPEED = Math.hypot(MAX_COMPONENT, MAX_COMPONENT);

    private DfsFieldQuality() { }

    static boolean hasUsableSample(double[][] field, String variable, double missingValue) {
        if (field == null) return false;
        int firstRow = 0;
        int rowLimit = field.length;
        int firstColumn = 0;
        int columnLimit = Integer.MAX_VALUE;
        if (DISPLAY_FIELDS.contains(variable)) {
            firstRow = KmaDfsProjection.MAP_WINDOW.minY() - 1;
            rowLimit = Math.min(rowLimit, KmaDfsProjection.MAP_WINDOW.maxY());
            firstColumn = KmaDfsProjection.MAP_WINDOW.minX() - 1;
            columnLimit = KmaDfsProjection.MAP_WINDOW.maxX();
        }

        for (int rowIndex = Math.max(0, firstRow); rowIndex < rowLimit; rowIndex++) {
            double[] row = field[rowIndex];
            if (row == null) continue;
            for (int columnIndex = Math.max(0, firstColumn);
                 columnIndex < Math.min(row.length, columnLimit); columnIndex++) {
                double sample = row[columnIndex];
                if (Double.isFinite(sample) && Double.compare(sample, missingValue) != 0
                        && allowed(variable, sample)) return true;
            }
        }
        return false;
    }

    private static boolean allowed(String variable, double value) {
        return switch (variable) {
            case "WSD" -> value >= 0 && value <= MAX_SPEED;
            case "UUU", "VVV" -> Math.abs(value) <= MAX_COMPONENT;
            case "TMP" -> value >= -100 && value <= 80;
            case "PCP" -> value >= 0 && value <= 1_000;
            case "SNO" -> value >= 0 && value <= 100;
            case "REH" -> value >= 0 && value <= 100;
            case "WAV" -> value >= 0 && value <= 50;
            case "PTY" -> whole(value) && PRECIPITATION_TYPES.contains(value);
            case "SKY" -> whole(value) && SKY_STATES.contains(value);
            default -> true;
        };
    }

    private static boolean whole(double value) {
        return value == Math.rint(value);
    }
}
