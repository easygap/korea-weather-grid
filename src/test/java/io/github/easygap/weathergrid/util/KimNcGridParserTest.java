package io.github.easygap.weathergrid.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * KIM 전구모델 NC 조회 응답 파서 검증. 원격 응답 대신 합성 격자를 사용한다.
 */
class KimNcGridParserTest {

    private static String header() {
        return "# synthetic-grid: i = " + KimNcGridParser.NX + ", j = " + KimNcGridParser.NY
                + ", map = S (x_min = " + KimNcGridParser.X_MIN
                + ", y_min = " + KimNcGridParser.Y_MIN
                + ", x_max = " + KimNcGridParser.X_MAX
                + ", y_max = " + KimNcGridParser.Y_MAX + ")\n";
    }

    private static String syntheticGrid() {
        StringBuilder raw = new StringBuilder(header());
        for (int row = 0; row < KimNcGridParser.NY; row++) {
            raw.append("# synthetic row ").append(row + 1).append('\n');
            for (int col = 0; col < KimNcGridParser.NX; col++) {
                raw.append(row * KimNcGridParser.NX + col + 0.5).append(' ');
                if (col % 10 == 9) raw.append('\n');
            }
            raw.append('\n');
        }
        return raw.toString();
    }

    @Test
    void 합성응답_파싱_크기_및_행우선순서() {
        double[][] grid = KimNcGridParser.parse(syntheticGrid());

        assertNotNull(grid, "합성 응답 파싱 실패");
        assertEquals(KimNcGridParser.NY, grid.length);
        assertEquals(KimNcGridParser.NX, grid[0].length);

        assertEquals(0.5, grid[0][0], 0.01);
        assertEquals(KimNcGridParser.NX - 1 + 0.5,
                grid[0][KimNcGridParser.NX - 1], 0.01);
        assertEquals((KimNcGridParser.NY - 1) * KimNcGridParser.NX + 0.5,
                grid[KimNcGridParser.NY - 1][0], 0.01);
    }

    @Test
    void 위경도_인덱스_변환은_합성셀과_왕복한다() {
        double[][] grid = KimNcGridParser.parse(syntheticGrid());
        assertNotNull(grid);

        int expectedRow = 23;
        int expectedCol = 47;
        double[] point = KimNcGridParser.indexToLatLon(expectedRow, expectedCol);
        int[] actual = KimNcGridParser.latLonToIndex(point[0], point[1]);
        assertArrayEquals(new int[]{expectedRow, expectedCol}, actual);
        assertEquals(expectedRow * KimNcGridParser.NX + expectedCol + 0.5,
                grid[actual[0]][actual[1]], 0.01);

        double[] southWest = KimNcGridParser.indexToLatLon(0, 0);
        double[] northEast = KimNcGridParser.indexToLatLon(
                KimNcGridParser.NY - 1, KimNcGridParser.NX - 1);
        assertNull(KimNcGridParser.latLonToIndex(southWest[0], southWest[1] - 1.0));
        assertNull(KimNcGridParser.latLonToIndex(northEast[0] + 1.0, northEast[1]));
    }

    @Test
    void 인덱스_위경도_역변환() {
        double[] sw = KimNcGridParser.indexToLatLon(0, 0);
        assertEquals(31.0, sw[0], 0.001);       // lat(j=1452) = -90 + 1452/12
        assertEquals(123.417, sw[1], 0.001);    // lon(i=1482) = 1481/12

        double[] ne = KimNcGridParser.indexToLatLon(KimNcGridParser.NY - 1, KimNcGridParser.NX - 1);
        assertEquals(40.0, ne[0], 0.001);       // lat(j=1560)
        assertEquals(132.917, ne[1], 0.001);    // lon(i=1596)
    }

    @Test
    void 음수는_보존하고_비유한_숫자와_fill은_noData로_정렬_보존() {
        // 변수에 따라 음수도 유효하므로 파서 단계에서 임의로 0에 고정하지 않는다.
        StringBuilder sb = new StringBuilder();
        sb.append(header());
        int total = KimNcGridParser.NX * KimNcGridParser.NY;
        for (int i = 0; i < total; i++) {
            // 비유한 숫자도 셀 하나로 소비되어 뒤 값의 격자 위치가 밀리지 않아야 한다.
            if (i == 0) sb.append("-9.1 ");
            else if (i == 1) sb.append("-999 ");
            else if (i == 2) sb.append("1e20 ");
            else if (i == 3) sb.append("NaN ");
            else if (i == 4) sb.append("Infinity ");
            else if (i == 5) sb.append("-Infinity ");
            else if (i == 6) sb.append("1e309 ");
            else if (i == 7) sb.append("7.5 ");
            else sb.append("1.0 ");
            if (i % 10 == 9) sb.append('\n');
        }
        double[][] grid = KimNcGridParser.parse(sb.toString());
        assertNotNull(grid, "합성 응답 파싱 실패");
        assertEquals(-9.1, grid[0][0], 1e-9);    // 음수 바람 성분 보존
        assertEquals(KimNcGridParser.NO_DATA, grid[0][1], 1e-9);
        assertEquals(KimNcGridParser.NO_DATA, grid[0][2], 1e-9);
        assertEquals(KimNcGridParser.NO_DATA, grid[0][3], 1e-9);
        assertEquals(KimNcGridParser.NO_DATA, grid[0][4], 1e-9);
        assertEquals(KimNcGridParser.NO_DATA, grid[0][5], 1e-9);
        assertEquals(KimNcGridParser.NO_DATA, grid[0][6], 1e-9);
        assertEquals(7.5, grid[0][7], 1e-9);
    }

    @Test
    void 형식오류_응답은_null() {
        assertNull(KimNcGridParser.parse(null));
        assertNull(KimNcGridParser.parse(""));
        assertNull(KimNcGridParser.parse("# ERROR : synthetic failure\n"));
        assertNull(KimNcGridParser.parse("{ \"result\" : { \"status\" : 403 } }"));
        assertNull(KimNcGridParser.parse(header() + "1.0 2.0 3.0"));
    }
}
