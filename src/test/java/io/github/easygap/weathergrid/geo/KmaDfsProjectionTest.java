package io.github.easygap.weathergrid.geo;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KmaDfsProjectionTest {

    private static final KmaDfsProjection PROJECTION = KmaDfsProjection.STANDARD;

    @Test
    void officialGridCornersMatchPublishedKmaCoordinates() {
        assertPoint(PROJECTION.cellCenter(1, 1), 31.7944, 123.7613);
        assertPoint(PROJECTION.cellCenter(149, 1), 31.6518, 131.6423);
        assertPoint(PROJECTION.cellCenter(1, 253), 43.3935, 123.3102);
        assertPoint(PROJECTION.cellCenter(149, 253), 43.2175, 132.7750);
    }

    @Test
    void cellCenterRoundTripReturnsTheOriginalCell() {
        for (KmaDfsProjection.Cell cell : new KmaDfsProjection.Cell[]{
                new KmaDfsProjection.Cell(1, 1),
                new KmaDfsProjection.Cell(60, 127),
                new KmaDfsProjection.Cell(149, 253)}) {
            KmaDfsProjection.GeoPoint point = PROJECTION.cellCenter(cell.x(), cell.y());
            assertEquals(cell, PROJECTION.nearestCell(point.latitude(), point.longitude()));
        }
    }

    @Test
    void publicMapWindowHasExplicitInclusiveBounds() {
        assertTrue(KmaDfsProjection.MAP_WINDOW.contains(5, 1));
        assertTrue(KmaDfsProjection.MAP_WINDOW.contains(149, 162));
        assertFalse(KmaDfsProjection.MAP_WINDOW.contains(4, 1));
        assertFalse(KmaDfsProjection.MAP_WINDOW.contains(150, 162));
        assertFalse(KmaDfsProjection.MAP_WINDOW.contains(5, 0));
        assertFalse(KmaDfsProjection.MAP_WINDOW.contains(149, 163));
    }

    @Test
    void geographicCoverageUsesNearestDfsCell() {
        KmaDfsProjection.GeoPoint inside = PROJECTION.cellCenter(149, 162);
        KmaDfsProjection.GeoPoint eastOutside = PROJECTION.cellCenter(150, 162);
        KmaDfsProjection.GeoPoint northOutside = PROJECTION.cellCenter(149, 163);

        assertTrue(PROJECTION.isInsideMapWindow(inside.latitude(), inside.longitude()));
        assertFalse(PROJECTION.isInsideMapWindow(eastOutside.latitude(), eastOutside.longitude()));
        assertFalse(PROJECTION.isInsideMapWindow(northOutside.latitude(), northOutside.longitude()));
    }

    @Test
    void invalidGeographicInputsAreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> PROJECTION.nearestCell(Double.NaN, 127.0));
        assertThrows(IllegalArgumentException.class,
                () -> PROJECTION.nearestCell(90.0, 127.0));
    }

    private static void assertPoint(KmaDfsProjection.GeoPoint actual,
                                    double expectedLatitude, double expectedLongitude) {
        assertEquals(expectedLatitude, actual.latitude(), 0.0001);
        assertEquals(expectedLongitude, actual.longitude(), 0.0001);
    }
}
