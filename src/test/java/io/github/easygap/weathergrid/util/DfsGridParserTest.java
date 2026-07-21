package io.github.easygap.weathergrid.util;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 격자자료 파서 검증. 모든 입력은 테스트에서 결정적으로 생성한 합성 값이다.
 */
class DfsGridParserTest {

    /** 1-base 격자번호(nx, ny)로 값 조회 */
    private static double cell(double[][] grid, int nx, int ny) {
        return grid[ny - 1][nx - 1];
    }

    private static String syntheticGrid() {
        StringBuilder raw = new StringBuilder(DfsGridParser.NX * DfsGridParser.NY * 8);
        for (int row = 0; row < DfsGridParser.NY; row++) {
            for (int col = 0; col < DfsGridParser.NX; col++) {
                int index = row * DfsGridParser.NX + col;
                double value = index == 0 ? -99.0 : index + 0.25;
                raw.append(value);
                raw.append(col == DfsGridParser.NX - 1 ? '\n' : (col % 2 == 0 ? ',' : ' '));
            }
        }
        return raw.toString();
    }

    @Test
    void 합성응답_파싱_격자크기_및_행우선순서() {
        double[][] grid = DfsGridParser.parse(syntheticGrid());

        assertNotNull(grid, "합성 응답 파싱 실패");
        assertEquals(DfsGridParser.NY, grid.length);
        assertEquals(DfsGridParser.NX, grid[0].length);

        assertEquals(1.25, cell(grid, 2, 1), 0.01);
        assertEquals(DfsGridParser.NX + 0.25, cell(grid, 1, 2), 0.01);
        assertEquals(DfsGridParser.NX * DfsGridParser.NY - 1 + 0.25,
                cell(grid, DfsGridParser.NX, DfsGridParser.NY), 0.01);
    }

    @Test
    void 결측값은_0으로_치환() {
        double[][] grid = DfsGridParser.parse(syntheticGrid());
        assertNotNull(grid);
        assertEquals(0.0, cell(grid, 1, 1), 0.01);
    }

    @Test
    void 형식오류_응답은_null() {
        assertNull(DfsGridParser.parse(null));
        assertNull(DfsGridParser.parse(""));
        // 미신청 403 JSON — 숫자 토큰 수가 격자 개수와 달라 거부되어야 함
        assertNull(DfsGridParser.parse("{ \"result\" : { \"status\" : 403 } }"));
        // 값 개수 부족
        assertNull(DfsGridParser.parse("1.0, 2.0, 3.0"));
    }

    @Test
    void 비유한_숫자는_결측으로_소비하고_뒤_셀_정렬을_보존() {
        String[] values = new String[DfsGridParser.NX * DfsGridParser.NY];
        Arrays.fill(values, "1.0");
        values[0] = "NaN";
        values[1] = "Infinity";
        values[2] = "-Infinity";
        values[3] = "+Infinity";
        values[4] = "1e309";
        values[5] = "7.5";

        double[][] grid = DfsGridParser.parse("unit\n" + String.join(",", values), -999.0);

        assertNotNull(grid);
        assertEquals(-999.0, cell(grid, 1, 1));
        assertEquals(-999.0, cell(grid, 2, 1));
        assertEquals(-999.0, cell(grid, 3, 1));
        assertEquals(-999.0, cell(grid, 4, 1));
        assertEquals(-999.0, cell(grid, 5, 1));
        assertEquals(7.5, cell(grid, 6, 1));
    }
}
