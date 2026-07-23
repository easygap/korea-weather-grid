package io.github.easygap.weathergrid.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class DfsAsciiFieldReaderTest {

    @Test
    void mixedSeparatorsPreserveSouthToNorthRowMajorOrder() {
        double[][] field = DfsAsciiFieldReader.read(dfsText(-99, false), -777);

        assertNotNull(field);
        assertEquals(DfsAsciiFieldReader.ROWS, field.length);
        assertEquals(DfsAsciiFieldReader.COLUMNS, field[0].length);
        assertEquals(-777, field[0][0]);
        assertEquals(1.25, field[0][1]);
        assertEquals(DfsAsciiFieldReader.COLUMNS + 0.25, field[1][0]);
        assertEquals(DfsAsciiFieldReader.COLUMNS * DfsAsciiFieldReader.ROWS - 1 + 0.25,
                field[DfsAsciiFieldReader.ROWS - 1][DfsAsciiFieldReader.COLUMNS - 1]);
    }

    @Test
    void nonFiniteTokensConsumeTheirCellsAsMissingWithoutShiftingLaterSamples() {
        String[] exceptional = {"NaN", "Infinity", "-Infinity", "1e309", "7.5"};
        StringBuilder raw = new StringBuilder("# synthetic DFS field\n");
        int count = DfsAsciiFieldReader.COLUMNS * DfsAsciiFieldReader.ROWS;
        for (int index = 0; index < count; index++) {
            raw.append(index < exceptional.length ? exceptional[index] : "1").append(' ');
        }

        double[][] field = DfsAsciiFieldReader.read(raw.toString(), -999);

        assertNotNull(field);
        assertEquals(-999, field[0][0]);
        assertEquals(-999, field[0][1]);
        assertEquals(-999, field[0][2]);
        assertEquals(-999, field[0][3]);
        assertEquals(7.5, field[0][4]);
    }

    @Test
    void incompleteExcessAndNonNumericDataFailClosed() {
        assertNull(DfsAsciiFieldReader.read(null, -999));
        assertNull(DfsAsciiFieldReader.read("", -999));
        assertNull(DfsAsciiFieldReader.read("1 2 3", -999));
        assertNull(DfsAsciiFieldReader.read(dfsText(1, false) + " 4", -999));
        assertNull(DfsAsciiFieldReader.read(dfsText(1, true), -999));
        assertNull(DfsAsciiFieldReader.read(dfsText(1, false), Double.NaN));
    }

    private static String dfsText(double firstValue, boolean injectWord) {
        StringBuilder raw = new StringBuilder("  # generated fixture\n");
        int count = DfsAsciiFieldReader.COLUMNS * DfsAsciiFieldReader.ROWS;
        for (int index = 0; index < count; index++) {
            if (injectWord && index == 10) raw.append("unit");
            else raw.append(index == 0 ? firstValue : index + 0.25);
            int column = index % DfsAsciiFieldReader.COLUMNS;
            raw.append(column == DfsAsciiFieldReader.COLUMNS - 1
                    ? '\n' : (column % 2 == 0 ? ',' : ' '));
        }
        return raw.toString();
    }
}
