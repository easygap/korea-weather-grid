package io.github.easygap.weathergrid.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Decoder for one fixed-subset KIM NC ASCII response. */
public final class KimAsciiCropReader {

    private static final Pattern DIMENSIONS = Pattern.compile(
            "\\bi\\s*=\\s*(\\d+)\\s*,\\s*j\\s*=\\s*(\\d+)");
    private static final Pattern BOUNDS = Pattern.compile(
            "\\bx_min\\s*=\\s*(\\d+)\\s*,\\s*y_min\\s*=\\s*(\\d+)"
                    + "\\s*,\\s*x_max\\s*=\\s*(\\d+)\\s*,\\s*y_max\\s*=\\s*(\\d+)");

    private KimAsciiCropReader() { }

    public static double[][] read(String rawText) {
        Header header = inspectHeader(rawText);
        if (header == null || !header.matchesExpectedProduct()) return null;
        double[] samples = AsciiNumberStream.decode(rawText,
                KimGridGeometry.COLUMNS * KimGridGeometry.ROWS, false,
                KimAsciiCropReader::normalize);
        if (samples == null) return null;

        double[][] crop = new double[KimGridGeometry.ROWS][KimGridGeometry.COLUMNS];
        for (int row = 0; row < KimGridGeometry.ROWS; row++) {
            System.arraycopy(samples, row * KimGridGeometry.COLUMNS,
                    crop[row], 0, KimGridGeometry.COLUMNS);
        }
        return crop;
    }

    private static Header inspectHeader(String rawText) {
        if (rawText == null || rawText.isBlank()) return null;
        Header found = null;
        for (String originalLine : rawText.split("\\R", -1)) {
            String line = originalLine.strip();
            if (!line.startsWith("#")) continue;
            if (line.regionMatches(true, 0, "# ERROR", 0, 7)) return null;
            Matcher dimensions = DIMENSIONS.matcher(line);
            Matcher bounds = BOUNDS.matcher(line);
            if (!dimensions.find() && !bounds.find()) continue;

            Integer columns = dimensions.reset().find() ? integer(dimensions.group(1)) : null;
            Integer rows = dimensions.reset().find() ? integer(dimensions.group(2)) : null;
            int[] subset = null;
            if (bounds.reset().find()) {
                subset = new int[]{integer(bounds.group(1)), integer(bounds.group(2)),
                        integer(bounds.group(3)), integer(bounds.group(4))};
            }
            Header candidate = new Header(columns, rows, subset);
            found = found == null ? candidate : found.merge(candidate);
            if (found == null) return null;
        }
        return found;
    }

    private static int integer(String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException failure) {
            return Integer.MIN_VALUE;
        }
    }

    private static double normalize(double value) {
        return Double.isFinite(value) && value > -900 && value <= 100_000
                ? value : KimGridGeometry.NO_DATA;
    }

    private record Header(Integer columns, Integer rows, int[] subset) {
        private Header merge(Header other) {
            Integer mergedColumns = merge(columns, other.columns);
            Integer mergedRows = merge(rows, other.rows);
            int[] mergedSubset = merge(subset, other.subset);
            if ((columns != null || other.columns != null) && mergedColumns == null) return null;
            if ((rows != null || other.rows != null) && mergedRows == null) return null;
            if ((subset != null || other.subset != null) && mergedSubset == null) return null;
            return new Header(mergedColumns, mergedRows, mergedSubset);
        }

        private boolean matchesExpectedProduct() {
            return columns != null && columns == KimGridGeometry.COLUMNS
                    && rows != null && rows == KimGridGeometry.ROWS
                    && subset != null
                    && subset[0] == KimGridGeometry.WEST_INDEX
                    && subset[1] == KimGridGeometry.SOUTH_INDEX
                    && subset[2] == KimGridGeometry.EAST_INDEX
                    && subset[3] == KimGridGeometry.NORTH_INDEX;
        }

        private static Integer merge(Integer left, Integer right) {
            if (left == null) return right;
            if (right == null || left.equals(right)) return left;
            return null;
        }

        private static int[] merge(int[] left, int[] right) {
            if (left == null) return right;
            if (right == null || java.util.Arrays.equals(left, right)) return left;
            return null;
        }
    }
}
