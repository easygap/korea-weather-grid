package io.github.easygap.weathergrid.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class KimAsciiCropReaderTest {

    @Test
    void separateDimensionAndSubsetHeadersProduceASouthFirstCrop() {
        double[][] crop = KimAsciiCropReader.read(kimText(false));

        assertNotNull(crop);
        assertEquals(KimGridGeometry.ROWS, crop.length);
        assertEquals(KimGridGeometry.COLUMNS, crop[0].length);
        assertEquals(0.5, crop[0][0]);
        assertEquals(KimGridGeometry.COLUMNS - 1 + 0.5,
                crop[0][KimGridGeometry.COLUMNS - 1]);
        assertEquals((KimGridGeometry.ROWS - 1) * KimGridGeometry.COLUMNS + 0.5,
                crop[KimGridGeometry.ROWS - 1][0]);
    }

    @Test
    void fillAndNonFiniteValuesBecomeNoDataWhileFiniteNegativeValuesRemain() {
        String[] prefix = {"-9.1", "-999", "1e20", "NaN", "Infinity", "-Infinity", "7.5"};
        StringBuilder raw = new StringBuilder(header());
        int count = KimGridGeometry.COLUMNS * KimGridGeometry.ROWS;
        for (int index = 0; index < count; index++) {
            raw.append(index < prefix.length ? prefix[index] : "1").append(' ');
        }

        double[][] crop = KimAsciiCropReader.read(raw.toString());

        assertNotNull(crop);
        assertEquals(-9.1, crop[0][0]);
        for (int column = 1; column <= 5; column++) {
            assertEquals(KimGridGeometry.NO_DATA, crop[0][column]);
        }
        assertEquals(7.5, crop[0][6]);
    }

    @Test
    void missingMismatchedOrConflictingHeadersAreRejected() {
        String values = "1 ".repeat(KimGridGeometry.COLUMNS * KimGridGeometry.ROWS);
        assertNull(KimAsciiCropReader.read(values));
        assertNull(KimAsciiCropReader.read(
                "# i = 1, j = 1\n" + subsetHeader() + values));
        assertNull(KimAsciiCropReader.read(
                dimensionsHeader() + "# i = 1, j = 1\n" + subsetHeader() + values));
        assertNull(KimAsciiCropReader.read(
                dimensionsHeader() + "# x_min = 1, y_min = 2, x_max = 3, y_max = 4\n" + values));
        assertNull(KimAsciiCropReader.read("# ERROR upstream rejected the request\n"));
    }

    @Test
    void incompleteExcessCommaSeparatedAndNonNumericBodiesFailClosed() {
        assertNull(KimAsciiCropReader.read(null));
        assertNull(KimAsciiCropReader.read(header() + "1 2 3"));
        assertNull(KimAsciiCropReader.read(kimText(false) + " 4"));
        assertNull(KimAsciiCropReader.read(kimText(true)));
        assertNull(KimAsciiCropReader.read(header()
                + "1,".repeat(KimGridGeometry.COLUMNS * KimGridGeometry.ROWS)));
    }

    private static String kimText(boolean injectWord) {
        StringBuilder raw = new StringBuilder(header());
        int count = KimGridGeometry.COLUMNS * KimGridGeometry.ROWS;
        for (int index = 0; index < count; index++) {
            raw.append(injectWord && index == 10 ? "unit" : index + 0.5).append(' ');
            if (index % 17 == 16) raw.append('\n');
        }
        return raw.toString();
    }

    private static String header() {
        return dimensionsHeader() + subsetHeader();
    }

    private static String dimensionsHeader() {
        return "# KIM crop i = " + KimGridGeometry.COLUMNS
                + ", j = " + KimGridGeometry.ROWS + "\n";
    }

    private static String subsetHeader() {
        return "# map = S (x_min = " + KimGridGeometry.WEST_INDEX
                + ", y_min = " + KimGridGeometry.SOUTH_INDEX
                + ", x_max = " + KimGridGeometry.EAST_INDEX
                + ", y_max = " + KimGridGeometry.NORTH_INDEX + ")\n";
    }
}
