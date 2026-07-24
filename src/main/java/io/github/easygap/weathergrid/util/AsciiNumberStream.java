package io.github.easygap.weathergrid.util;

import java.util.function.DoubleUnaryOperator;

/** Strict decoder for finite-size ASCII numeric products with whole-line comments. */
final class AsciiNumberStream {

    private AsciiNumberStream() { }

    static double[] decode(String source, int expectedValues, boolean commasAreSeparators,
                           DoubleUnaryOperator normalizer) {
        if (source == null || source.isBlank() || expectedValues < 1 || normalizer == null) return null;
        double[] values = new double[expectedValues];
        int count = 0;

        for (String originalLine : source.split("\\R", -1)) {
            String line = originalLine.strip();
            if (line.isEmpty() || line.startsWith("#")) continue;
            int tokenStart = -1;
            for (int cursor = 0; cursor <= line.length(); cursor++) {
                boolean atEnd = cursor == line.length();
                char character = atEnd ? ' ' : line.charAt(cursor);
                boolean separator = Character.isWhitespace(character)
                        || (commasAreSeparators && character == ',');
                if (!separator) {
                    if (tokenStart < 0) tokenStart = cursor;
                    continue;
                }
                if (tokenStart < 0) continue;
                if (count == values.length) return null;
                try {
                    values[count++] = normalizer.applyAsDouble(
                            Double.parseDouble(line.substring(tokenStart, cursor)));
                } catch (NumberFormatException failure) {
                    return null;
                }
                tokenStart = -1;
            }
        }
        return count == expectedValues ? values : null;
    }
}
