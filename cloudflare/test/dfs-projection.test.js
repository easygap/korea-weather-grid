import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projection = require('../../src/main/resources/static/js/weather-grid-dfs-projection.js');
const proj4 = require('../../src/main/resources/static/vendor/proj4-2.20.9.min.js');

function assertClose(actual, expected, tolerance = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${actual} is not within ${tolerance} of ${expected}`);
}

test('공개된 DFS 기준점과 네 모서리를 같은 구면 LCC 식으로 복원한다', () => {
    assert.deepEqual(projection.latLonToGridFraction(38, 126), [43, 136]);

    [
        { grid: [1, 1], expected: [31.7944, 123.7613] },
        { grid: [149, 1], expected: [31.6518, 131.6423] },
        { grid: [1, 253], expected: [43.3935, 123.3102] },
        { grid: [149, 253], expected: [43.2175, 132.7750] }
    ].forEach(({ grid, expected }) => {
        const actual = projection.gridToLatLon(grid[0], grid[1]);
        assertClose(actual[0], expected[0], 0.0001);
        assertClose(actual[1], expected[1], 0.0001);
    });
});

test('분수 격자와 위경도 변환은 정수 셀 사이에서도 왕복한다', () => {
    for (const grid of [[43.25, 136.75], [60.4, 127.2], [149, 162]]) {
        const latLon = projection.gridToLatLon(grid[0], grid[1]);
        const roundTrip = projection.latLonToGridFraction(latLon[0], latLon[1]);
        assertClose(roundTrip[0], grid[0], 1e-9);
        assertClose(roundTrip[1], grid[1], 1e-9);
    }
});

test('Proj4 정의는 DFS 격자 번호에 5 km를 곱한 표시 좌표와 일치한다', () => {
    proj4.defs(projection.code, projection.proj4Definition);
    for (const grid of [[1, 1], [43, 136], [149, 253], [60.5, 127.25]]) {
        const projected = projection.gridToProjected(grid[0], grid[1]);
        const latLon = projection.gridToLatLon(grid[0], grid[1]);
        const proj4Forward = proj4('EPSG:4326', projection.code)
            .forward([latLon[1], latLon[0]]);
        assertClose(proj4Forward[0], projected[0], 1e-6);
        assertClose(proj4Forward[1], projected[1], 1e-6);
        assert.deepEqual(projection.projectedToGrid(projected[0], projected[1]), grid);
    }
});

test('투영 상수와 잘못된 입력은 외부에서 조용히 변형되지 않는다', () => {
    assert.ok(Object.isFrozen(projection.published));
    assert.ok(Object.isFrozen(projection.parameters));
    assert.throws(() => projection.latLonToGridFraction(90, 126), /위도/);
    assert.throws(() => projection.latLonToGridFraction(38, Number.NaN), /경도/);
    assert.throws(() => projection.gridToLatLon(Number.NaN, 1), /격자/);
});
