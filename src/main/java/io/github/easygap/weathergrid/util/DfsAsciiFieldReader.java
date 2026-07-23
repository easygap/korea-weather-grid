package io.github.easygap.weathergrid.util;

/** Decoder for the KMA DFS 149 by 253 south-to-north ASCII field. */
public final class DfsAsciiFieldReader {

    public static final int COLUMNS = 149;
    public static final int ROWS = 253;
    private static final double SOURCE_MISSING = -99;

    private DfsAsciiFieldReader() { }

    public static double[][] read(String rawText, double missingReplacement) {
        if (!Double.isFinite(missingReplacement)) return null;
        double[] samples = AsciiNumberStream.decode(rawText, COLUMNS * ROWS, true,
                value -> Double.isFinite(value) && value > SOURCE_MISSING
                        ? value : missingReplacement);
        if (samples == null) return null;

        double[][] field = new double[ROWS][COLUMNS];
        for (int row = 0; row < ROWS; row++) {
            System.arraycopy(samples, row * COLUMNS, field[row], 0, COLUMNS);
        }
        return field;
    }
}
