package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DfsFieldQualityTest {

    private static final double MISSING = -999;

    @Test
    void realZeroAndPhysicalBoundaryValuesAreUsable() {
        assertTrue(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(0), "PCP", MISSING));
        assertTrue(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(0), "WSD", MISSING));
        assertTrue(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(-100), "TMP", MISSING));
        assertTrue(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(4), "PTY", MISSING));
    }

    @Test
    void sentinelsOutliersAndUnknownCategoryCodesAreRejected() {
        assertFalse(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(MISSING), "REH", MISSING));
        assertFalse(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(101), "REH", MISSING));
        assertFalse(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(-0.1), "PCP", MISSING));
        assertFalse(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(5), "PTY", MISSING));
        assertFalse(DfsFieldQuality.hasUsableSample(fieldWithDisplayValue(2), "SKY", MISSING));
    }

    @Test
    void aValueOutsideThePublishedMapWindowCannotValidateAField() {
        double[][] field = missingField();
        field[0][0] = 50;

        assertFalse(DfsFieldQuality.hasUsableSample(field, "REH", MISSING));

        field[KmaDfsProjection.MAP_WINDOW.minY() - 1]
                [KmaDfsProjection.MAP_WINDOW.minX() - 1] = 50;
        assertTrue(DfsFieldQuality.hasUsableSample(field, "REH", MISSING));
    }

    private static double[][] fieldWithDisplayValue(double value) {
        double[][] field = missingField();
        field[KmaDfsProjection.MAP_WINDOW.minY() - 1]
                [KmaDfsProjection.MAP_WINDOW.minX() - 1] = value;
        return field;
    }

    private static double[][] missingField() {
        double[][] field = new double[253][149];
        for (double[] row : field) Arrays.fill(row, MISSING);
        return field;
    }
}
