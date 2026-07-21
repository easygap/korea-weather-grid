import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const windGrid = require('../../src/main/resources/static/js/wind-grid.js');

function payload(overrides = {}) {
    return {
        schema: windGrid.SCHEMA,
        unit: 'm/s',
        scaleFactor: 0.1,
        noData: -32768,
        vectorReference: 'earth-relative',
        grid: {
            type: 'kma-dfs-lcc',
            nx: 1,
            ny: 1,
            nxMin: 43,
            nyMin: 136,
            step: 1,
            rowOrder: 'north-to-south',
            columnOrder: 'west-to-east'
        },
        u: [25],
        v: [-40],
        ...overrides
    };
}

test('KMA DFS origin and encoded m/s scale are preserved', () => {
    const gridPoint = windGrid.latLonToGridFraction(38, 126);
    assert.ok(Math.abs(gridPoint[0] - 43) < 1e-9);
    assert.ok(Math.abs(gridPoint[1] - 136) < 1e-9);

    const vector = windGrid.create(payload()).sample(126, 38);
    assert.deepEqual(vector.slice(0, 2), [2.5, -4]);
    assert.ok(Math.abs(vector[2] - Math.hypot(2.5, -4)) < 1e-12);
    assert.equal(vector[3], 1);
});

test('visual edge opacity tapers smoothly without extending the data grid', () => {
    assert.equal(windGrid.edgeOpacityAt(-0.5, 5, 11, 11), 0);
    assert.equal(windGrid.edgeOpacityAt(5, 5, 11, 11), 1);
    assert.ok(windGrid.edgeOpacityAt(0, 5, 11, 11) < windGrid.edgeOpacityAt(2, 5, 11, 11));
    assert.equal(windGrid.edgeOpacityAt(0, 0, 1, 1), 1);
});

test('station support range follows the shared displayed DFS cells', () => {
    assert.deepEqual(windGrid.SUPPORTED_GRID, {
        nxMin: 5, nxMax: 149, nyMin: 1, nyMax: 162
    });
    assert.equal(windGrid.isInsideSupportedGrid(37.5665, 126.978), true);
    assert.equal(windGrid.isInsideSupportedGrid(42, 127), false);
    assert.equal(windGrid.isInsideSupportedGrid(Number.NaN, 127), false);
});

test('bilinear sampling follows north-to-south row order', () => {
    const longitude = 127;
    const latitude = 37.5;
    const point = windGrid.latLonToGridFraction(latitude, longitude);
    const nxMin = Math.floor(point[0]);
    const nyMin = Math.floor(point[1]);
    const tx = point[0] - nxMin;
    const ty = 1 - (point[1] - nyMin);
    const data = payload({
        grid: {
            type: 'kma-dfs-lcc', nx: 2, ny: 2, nxMin, nyMin, step: 1,
            rowOrder: 'north-to-south', columnOrder: 'west-to-east'
        },
        u: [10, 20, 30, 40],
        v: [0, 0, 0, 0]
    });
    const expectedEncoded = 10 * (1 - tx) * (1 - ty) + 20 * tx * (1 - ty)
        + 30 * (1 - tx) * ty + 40 * tx * ty;
    const sampled = windGrid.create(data).sample(longitude, latitude);
    assert.ok(Math.abs(sampled[0] - expectedEncoded * 0.1) < 1e-9);
    assert.ok(Math.abs(sampled[1]) < 1e-12);
});

test('patch index LUT matches scalar DFS projection', () => {
    const options = {
        width: 17, height: 11,
        lonMin: 124, lonMax: 132.3,
        latMin: 31.8, latMax: 39,
        nx: 145, ny: 162, nxMin: 5, nyMin: 1, step: 1
    };
    const lut = windGrid.createNearestIndexLut(options);
    assert.equal(lut.length, options.width * options.height);

    for (let y = 0; y < options.height; y += 1) {
        const latitude = options.latMax
            - (y + 0.5) / options.height * (options.latMax - options.latMin);
        for (let x = 0; x < options.width; x += 1) {
            const longitude = options.lonMin
                + (x + 0.5) / options.width * (options.lonMax - options.lonMin);
            const point = windGrid.latLonToGridFraction(latitude, longitude);
            const column = Math.round((point[0] - options.nxMin) / options.step);
            const southRow = Math.round((point[1] - options.nyMin) / options.step);
            const expected = column < 0 || column >= options.nx || southRow < 0 || southRow >= options.ny
                ? -1
                : (options.ny - 1 - southRow) * options.nx + column;
            assert.equal(lut[y * options.width + x], expected);
        }
    }
});

test('missing vectors and incompatible payloads fail closed', () => {
    assert.equal(windGrid.create(payload({ u: [-32768] })).sample(126, 38), null);
    assert.throws(() => windGrid.create(payload({ unit: 'knots' })), /unit/);
    assert.throws(() => windGrid.create(payload({ vectorReference: 'grid-relative' })), /vectorReference/);
});
