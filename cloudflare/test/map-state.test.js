import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mapState = require('../../src/main/resources/static/js/weather-grid-map-state.js');

test('허용된 도법 요청은 이전·다음 코드와 변경 여부를 불변 결과로 남긴다', () => {
    const transition = mapState.projectionTransition('KMA_GRID_LCC', 'EPSG:3857');

    assert.deepEqual(transition, {
        accepted: true,
        changed: true,
        previousCode: 'KMA_GRID_LCC',
        code: 'EPSG:3857'
    });
    assert.ok(Object.isFrozen(transition));
});

test('현재 도법 재선택과 알 수 없는 도법은 뷰 교체를 만들지 않는다', () => {
    assert.deepEqual(mapState.projectionTransition('EPSG:4326', 'EPSG:4326'), {
        accepted: true,
        changed: false,
        previousCode: 'EPSG:4326',
        code: 'EPSG:4326'
    });
    assert.deepEqual(mapState.projectionTransition('EPSG:4326', 'EPSG:9999'), {
        accepted: false,
        changed: false,
        previousCode: 'EPSG:4326',
        code: 'EPSG:4326'
    });
});

test('도법 전환 후 줌 범위는 현재 화면의 다섯 단계 폭을 유지한다', () => {
    assert.deepEqual(mapState.viewLimits(7.8, false), { minZoom: 7, maxZoom: 12 });
    assert.deepEqual(mapState.viewLimits(7.8, true), { minZoom: 2.5, maxZoom: 12 });
});

test('남쪽 기준 격자 행을 북쪽부터 저장된 배열 인덱스로 변환한다', () => {
    const grid = {
        nx: 2, ny: 3, nxMin: 10, nyMin: 20, step: 1,
        data: ['north-west', 'north-east', 'middle-west', 'middle-east', 'south-west', 'south-east']
    };

    assert.deepEqual(mapState.sampleGrid(grid, { x: 10, y: 20 }), {
        inside: true, column: 0, rowFromSouth: 0, index: 4, value: 'south-west'
    });
    assert.deepEqual(mapState.sampleGrid(grid, { x: 11, y: 22 }), {
        inside: true, column: 1, rowFromSouth: 2, index: 1, value: 'north-east'
    });
});

test('간격이 있는 격자는 가장 가까운 셀을 선택한다', () => {
    const grid = { nx: 2, ny: 2, nxMin: 50, nyMin: 70, step: 2, data: [1, 2, 3, 4] };

    assert.deepEqual(mapState.sampleGrid(grid, { x: 51.2, y: 70.8 }), {
        inside: true, column: 1, rowFromSouth: 0, index: 3, value: 4
    });
});

test('격자 밖 좌표와 손상된 응답은 값 대신 명시적인 outside 결과를 낸다', () => {
    const grid = { nx: 2, ny: 2, nxMin: 0, nyMin: 0, step: 1, data: [1, 2, 3, 4] };
    const outside = { inside: false, column: -1, rowFromSouth: -1, index: -1, value: null };

    assert.deepEqual(mapState.sampleGrid(grid, { x: 4, y: 0 }), outside);
    assert.deepEqual(mapState.sampleGrid({ ...grid, step: -1 }, { x: 0, y: 0 }), outside);
    assert.deepEqual(mapState.sampleGrid({ ...grid, data: [1] }, { x: 1, y: 1 }), outside);
});

test('typed array 격자도 동일한 표본 계약을 사용한다', () => {
    const grid = {
        nx: 2, ny: 2, nxMin: 0, nyMin: 0, step: 1,
        data: new Float32Array([10, 20, 30, 40])
    };

    assert.equal(mapState.sampleGrid(grid, { x: 0, y: 1 }).value, 10);
});

test('리드아웃은 좌표와 격자값을 색상에 의존하지 않는 접근성 문구로 만든다', () => {
    const label = mapState.readoutText(37.5665, 126.978, '3.2 m/s');

    assert.deepEqual(label, {
        coordinateText: '37.566°N 126.978°E',
        valueText: '3.2 m/s',
        accessibleText: '37.566°N 126.978°E, 격자값 3.2 m/s'
    });
    assert.ok(Object.isFrozen(label));
    assert.equal(mapState.readoutText(Number.NaN, 126, '—'), null);
});
