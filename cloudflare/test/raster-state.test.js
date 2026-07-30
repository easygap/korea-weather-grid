import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rasterState = require('../../src/main/resources/static/js/weather-grid-raster-state.js');

test('출력 크기에 맞춰 도서 지역을 보존하는 균일 표본 계획을 만든다', () => {
    assert.deepEqual(rasterState.samplePlan(640, 480), {
        width: 640,
        height: 480,
        stride: 2,
        sampleWidth: 320,
        sampleHeight: 240,
        sampleCount: 76800
    });
    assert.deepEqual(rasterState.samplePlan(1280, 720), {
        width: 1280,
        height: 720,
        stride: 2,
        sampleWidth: 640,
        sampleHeight: 360,
        sampleCount: 230400
    });
    const qhd = rasterState.samplePlan(2560, 1440);
    assert.deepEqual(qhd, {
        width: 2560,
        height: 1440,
        stride: 5,
        sampleWidth: 512,
        sampleHeight: 288,
        sampleCount: 147456
    });
    assert.ok(Object.isFrozen(qhd));
    assert.equal(rasterState.samplePlan(0, 480), null);
});

test('래스터 LUT 키는 화면·도법·격자·테마 조건을 모두 포함한다', () => {
    const base = {
        projectionCode: 'KMA_GRID_LCC',
        viewProjectionCode: 'KMA_GRID_LCC',
        extent: [1, 2, 3, 4],
        resolution: 100,
        pixelRatio: 1,
        devicePixelRatio: 1,
        size: [640, 480],
        sampleWidth: 214,
        sampleHeight: 160,
        nxMin: 10,
        nyMin: 20,
        step: 1,
        nx: 3,
        ny: 4,
        theme: 'dark'
    };
    const key = rasterState.lookupKey(base);
    assert.equal(rasterState.lookupKey({ ...base }), key);
    for (const changed of [
        { extent: [2, 2, 3, 4] },
        { size: [800, 480] },
        { pixelRatio: 2 },
        { projectionCode: 'EPSG:3857' },
        { nx: 4 },
        { theme: 'light' }
    ]) {
        assert.notEqual(rasterState.lookupKey({ ...base, ...changed }), key);
    }
});

test('남쪽 기준 행을 북쪽 우선 배열 인덱스로 변환한다', () => {
    assert.equal(rasterState.cellIndex(0, 0, 2, 3), 4);
    assert.equal(rasterState.cellIndex(1, 2, 2, 3), 1);
    assert.equal(rasterState.cellIndex(0.6, 0.4, 2, 3), 5);
    assert.equal(rasterState.cellIndex(-1, 0, 2, 3), -1);
    assert.equal(rasterState.cellIndex(0, 3, 2, 3), -1);
});

test('숫자 통계는 유효값만 집계하고 범주형에는 수치 요약을 만들지 않는다', () => {
    const validWeatherValue = (value) => Number.isFinite(value) && value > -900;
    const summary = rasterState.summarize([3, -999, 9, Number.NaN, 6], validWeatherValue, false);
    assert.deepEqual(summary, { kind: 'numeric', count: 3, min: 3, avg: 6, max: 9 });
    assert.ok(Object.isFrozen(summary));

    assert.deepEqual(rasterState.summarize([3, 9], () => true, true), {
        kind: 'categorical', count: 0, min: null, avg: null, max: null
    });
    assert.deepEqual(rasterState.summarize([], Number.isFinite, false), {
        kind: 'numeric', count: 0, min: 0, avg: 0, max: 0
    });
});

test('CSS rgb 색상을 Canvas RGBA 바이트로 안전하게 변환한다', () => {
    assert.deepEqual(rasterState.parseCssColor('rgb(12, 34, 56)'), [12, 34, 56, 255]);
    assert.deepEqual(rasterState.parseCssColor('rgba(12, 34, 56, 0.5)'), [12, 34, 56, 128]);
    assert.deepEqual(rasterState.parseCssColor('rgba(300, -2, 10, 2)'), [255, 0, 10, 255]);
    assert.deepEqual(rasterState.parseCssColor('not-a-color'), [0, 0, 0, 0]);
    assert.ok(Object.isFrozen(rasterState.parseCssColor('rgb(1, 2, 3)')));
});
