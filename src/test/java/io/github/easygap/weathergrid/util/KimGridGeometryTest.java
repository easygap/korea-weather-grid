package io.github.easygap.weathergrid.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KimGridGeometryTest {

    @Test
    void everyPublishedCellCenterRoundTripsToTheSameCropIndex() {
        int[][] samples = {{0, 0}, {23, 47},
                {KimGridGeometry.ROWS - 1, KimGridGeometry.COLUMNS - 1}};
        for (int[] sample : samples) {
            KimGridGeometry.Coordinate coordinate = KimGridGeometry.coordinateOf(sample[0], sample[1]);
            KimGridGeometry.Cell cell = KimGridGeometry.locate(
                    coordinate.latitude(), coordinate.longitude()).orElseThrow();
            assertEquals(sample[0], cell.row());
            assertEquals(sample[1], cell.column());
        }
    }

    @Test
    void cropCornersFollowTheDocumentedGlobalGridFormula() {
        KimGridGeometry.Coordinate southWest = KimGridGeometry.coordinateOf(0, 0);
        KimGridGeometry.Coordinate northEast = KimGridGeometry.coordinateOf(
                KimGridGeometry.ROWS - 1, KimGridGeometry.COLUMNS - 1);

        assertEquals(31.0, southWest.latitude(), 0.001);
        assertEquals(123.417, southWest.longitude(), 0.001);
        assertEquals(40.0, northEast.latitude(), 0.001);
        assertEquals(132.917, northEast.longitude(), 0.001);
    }

    @Test
    void nonFiniteCoordinatesAndOutsideIndicesAreRejected() {
        assertTrue(KimGridGeometry.locate(Double.NaN, 127).isEmpty());
        assertTrue(KimGridGeometry.locate(35, Double.POSITIVE_INFINITY).isEmpty());
        assertTrue(KimGridGeometry.locate(0, 0).isEmpty());
        assertThrows(IllegalArgumentException.class,
                () -> KimGridGeometry.coordinateOf(-1, 0));
        assertThrows(IllegalArgumentException.class,
                () -> KimGridGeometry.coordinateOf(0, KimGridGeometry.COLUMNS));
    }
}
