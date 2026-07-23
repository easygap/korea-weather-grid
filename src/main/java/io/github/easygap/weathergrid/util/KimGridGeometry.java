package io.github.easygap.weathergrid.util;

import java.util.Optional;

/** Fixed NE57 latitude/longitude crop used for the KIM solar product. */
public final class KimGridGeometry {

    public static final int GLOBAL_COLUMNS = 4_320;
    public static final int GLOBAL_ROWS = 2_160;
    public static final int WEST_INDEX = 1_482;
    public static final int SOUTH_INDEX = 1_452;
    public static final int EAST_INDEX = 1_596;
    public static final int NORTH_INDEX = 1_560;
    public static final int COLUMNS = EAST_INDEX - WEST_INDEX + 1;
    public static final int ROWS = NORTH_INDEX - SOUTH_INDEX + 1;
    public static final double NO_DATA = -999;
    public static final String SUBSET_QUERY = WEST_INDEX + "," + SOUTH_INDEX + ","
            + EAST_INDEX + "," + NORTH_INDEX;

    private static final double CELL_DEGREES = 360.0 / GLOBAL_COLUMNS;

    private KimGridGeometry() { }

    public static Optional<Cell> locate(double latitude, double longitude) {
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)) return Optional.empty();
        long globalColumn = Math.round(longitude / CELL_DEGREES) + 1;
        long globalRow = Math.round((latitude + 90) / CELL_DEGREES);
        if (globalColumn < WEST_INDEX || globalColumn > EAST_INDEX
                || globalRow < SOUTH_INDEX || globalRow > NORTH_INDEX) return Optional.empty();
        return Optional.of(new Cell((int) globalRow - SOUTH_INDEX,
                (int) globalColumn - WEST_INDEX));
    }

    public static Coordinate coordinateOf(int row, int column) {
        if (row < 0 || row >= ROWS || column < 0 || column >= COLUMNS) {
            throw new IllegalArgumentException("KIM crop index is outside the product");
        }
        double longitude = (WEST_INDEX + column - 1) * CELL_DEGREES;
        double latitude = -90 + (SOUTH_INDEX + row) * CELL_DEGREES;
        return new Coordinate(latitude, longitude);
    }

    public record Cell(int row, int column) { }

    public record Coordinate(double latitude, double longitude) { }
}
