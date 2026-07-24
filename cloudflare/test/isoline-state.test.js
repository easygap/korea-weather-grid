import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contours = require('../../src/main/resources/static/js/weather-grid-isoline-state.js');

function pointKey(point) {
    return point.map((value) => value.toFixed(6)).join(',');
}

function segmentKeys(segments) {
    return segments.map((segment) => segment.map((entry) => pointKey(entry.point)).sort().join('|')).sort();
}

test('안장점은 bilinear 판별값에 따라 서로 다른 대각 연결을 선택한다', () => {
    const strongDiagonal = contours.cellSegments([4, 0, 4, 0], 0, 0, 1);
    const weakDiagonal = contours.cellSegments([1.1, 0, 1.1, 0], 0, 0, 1);

    assert.deepEqual(segmentKeys(strongDiagonal), [
        '0.000000,0.750000|0.250000,1.000000',
        '0.750000,0.000000|1.000000,0.250000'
    ]);
    assert.deepEqual(segmentKeys(weakDiagonal), [
        '0.000000,0.090909|0.090909,0.000000',
        '0.909091,1.000000|1.000000,0.909091'
    ]);
});

test('결측 셀과 맞닿은 값은 스무딩이 반대편 자료를 끌어오지 않는다', () => {
    const withGap = [
        0, 0, 0,
        Number.NaN, 16, 0,
        0, 0, 0
    ];
    const complete = [
        0, 0, 0,
        0, 16, 0,
        0, 0, 0
    ];
    const sample = (values) => (x, y) => values[y * 3 + x];

    assert.equal(contours.smoothField(sample(withGap), 3, 3, 1)(1, 1), 16);
    assert.equal(contours.smoothField(sample(complete), 3, 3, 1)(1, 1), 4);
});

test('대각선 결측과 자료 바깥쪽에서도 원래 값을 보존한다', () => {
    const values = [
        1, 1, 1, 1,
        1, 9, 1, 1,
        1, 1, Number.NaN, 1,
        8, 1, 1, 1
    ];
    const smoothed = contours.smoothField(
        (x, y) => values[y * 4 + x], 4, 4, 2);

    assert.equal(smoothed(1, 1), 9);
    assert.equal(smoothed(0, 3), 8);
});

test('닫힌 선의 코너 가공은 이음새를 열지 않는다', () => {
    const closed = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    const smoothed = contours.smoothLine(closed);

    assert.deepEqual(smoothed[0], smoothed[smoothed.length - 1]);
    assert.equal(smoothed.length, 9);
});

test('범주형과 알 수 없는 요소에는 등치선을 만들지 않는다', () => {
    assert.deepEqual(contours.levelsFor('pty'), []);
    assert.deepEqual(contours.levelsFor('sky'), []);
    assert.deepEqual(contours.levelsFor('unknown'), []);
    assert.equal(contours.smoothingPasses('pcp'), 1);
    assert.equal(contours.smoothingPasses('tmp'), 2);
});

test('일사 레벨은 실제 임계값 안에서 중복 없이 최대 여덟 개만 고른다', () => {
    const source = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 200];
    const levels = contours.levelsFor('swdn', source);

    assert.equal(levels.length, 8);
    assert.deepEqual(levels, [...new Set(levels)].sort((a, b) => a - b));
    levels.forEach((level) => assert.ok(source.includes(level) && level > 0));
});

test('결측 모서리가 있는 셀과 손상된 격자는 선을 만들지 않는다', () => {
    assert.deepEqual(contours.cellSegments([0, 2, Number.NaN, 0], 0, 0, 1), []);
    assert.deepEqual(contours.isolinesForLevel(() => 1, 1, 2, 1), []);
    assert.deepEqual(contours.isolinesForLevel(null, 2, 2, 1), []);
});

test('한 셀만 지나는 짧은 열린 등치선도 누락하지 않는다', () => {
    const values = [0, 2, 0, 2];
    const lines = contours.isolinesForLevel((x, y) => values[y * 2 + x], 2, 2, 1);

    assert.equal(lines.length, 1);
    assert.equal(lines[0].length, 2);
});

test('조회 교체 중 빈 응답과 잘못된 격자 간격은 안전하게 거부한다', () => {
    const valid = {
        nx: 2,
        ny: 2,
        nxMin: 1,
        nyMin: 1,
        step: 1,
        data: new Float32Array([0, 1, 2, 3])
    };

    assert.equal(contours.validGridResult(valid), true);
    assert.equal(contours.validGridResult(null), false);
    assert.equal(contours.validGridResult({ ...valid, step: 0 }), false);
    assert.equal(contours.validGridResult({ ...valid, data: [0, 1, 2] }), false);
});
