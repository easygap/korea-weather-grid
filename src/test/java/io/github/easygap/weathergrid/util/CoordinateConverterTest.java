package io.github.easygap.weathergrid.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CoordinateConverterTest {

    @Test
    void forecastGridUsesTheSameInclusiveCellBoundsAsTheWorker() {
        assertTrue(CoordinateConverter.isInsideForecastGrid(5, 1));
        assertTrue(CoordinateConverter.isInsideForecastGrid(149, 162));

        assertFalse(CoordinateConverter.isInsideForecastGrid(4, 1));
        assertFalse(CoordinateConverter.isInsideForecastGrid(150, 162));
        assertFalse(CoordinateConverter.isInsideForecastGrid(5, 0));
        assertFalse(CoordinateConverter.isInsideForecastGrid(149, 163));
    }

    @Test
    void geographicCoordinatesAreRoundedToTheirDfsCellBeforeCoverageCheck() {
        double[] northeastInside = CoordinateConverter.gridToLatLon(149, 162);
        double[] eastOutside = CoordinateConverter.gridToLatLon(150, 162);
        double[] northOutside = CoordinateConverter.gridToLatLon(149, 163);

        assertTrue(CoordinateConverter.isInsideForecastGrid(northeastInside[0], northeastInside[1]));
        assertFalse(CoordinateConverter.isInsideForecastGrid(eastOutside[0], eastOutside[1]));
        assertFalse(CoordinateConverter.isInsideForecastGrid(northOutside[0], northOutside[1]));
    }
}
