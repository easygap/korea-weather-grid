import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Basemap = require('../../src/main/resources/static/js/weather-grid-basemap-state.js');

test('첫 배경지도는 화면 크기와 관계없이 대표 지역을 표시한다', () => {
    assert.deepEqual(Basemap.initialState(false), {
        mode: 'weather',
        regionLabels: true,
        provinceBoundaries: false,
        stationsVisible: true
    });
    assert.equal(Basemap.initialState(true).stationsVisible, true);
});

test('행정 경계 모드는 라벨을 켜고 도 경계를 초기화한다', () => {
    const changed = Basemap.selectMode({
        mode: 'streets',
        regionLabels: false,
        provinceBoundaries: true,
        stationsVisible: true
    }, 'boundaries');
    assert.deepEqual(changed, {
        mode: 'boundaries',
        regionLabels: true,
        provinceBoundaries: false,
        stationsVisible: true
    });
    assert.equal(Basemap.selectMode(changed, 'satellite'), changed);
});

test('경계 옵션과 대표 지역 표시는 불변 상태 전이로 계산한다', () => {
    const start = Basemap.initialState(false);
    const labelsOff = Basemap.toggleBoundary(start, 'labels');
    const provincesOn = Basemap.toggleBoundary(labelsOff, 'provinces');
    const stationsOff = Basemap.setStationsVisible(provincesOn, false);
    assert.equal(start.regionLabels, true);
    assert.equal(labelsOff.regionLabels, false);
    assert.equal(provincesOn.provinceBoundaries, true);
    assert.equal(stationsOff.stationsVisible, false);
    assert.equal(Object.isFrozen(stationsOff), true);
});

test('배경지도 모드마다 한 종류의 바탕만 보인다', () => {
    assert.deepEqual(Basemap.layerVisibility('weather'),
        { weather: true, boundaries: false, streets: false });
    assert.deepEqual(Basemap.layerVisibility('boundaries'),
        { weather: false, boundaries: true, streets: false });
    assert.deepEqual(Basemap.layerVisibility('streets'),
        { weather: false, boundaries: false, streets: true });
    assert.equal(Basemap.layerVisibility('unknown'), null);
});

test('테마 스타일 계획은 경계와 라벨 토글을 색상 효과로 변환한다', () => {
    const state = Basemap.toggleBoundary(
        Basemap.toggleBoundary(Basemap.selectMode(Basemap.initialState(false), 'boundaries'), 'labels'),
        'provinces');
    const plan = Basemap.stylePlan(state, 'light');
    assert.equal(plan.weather.fill, '#f0f1ed');
    assert.equal(plan.vector.fill, '#e7ebe5');
    assert.equal(plan.provinces.labelField, null);
    assert.equal(plan.provinces.stroke, plan.palette.boundary);
});

test('지도 픽셀 비율은 일반 화면 DPR을 유지하고 큰 화면은 예산 아래로 낮춘다', () => {
    assert.equal(Basemap.pixelRatio({
        viewportWidth: 1280,
        viewportHeight: 720,
        screenWidth: 1280,
        screenHeight: 720,
        devicePixelRatio: 2
    }), 2);
    const large = Basemap.pixelRatio({
        viewportWidth: 7680,
        viewportHeight: 4320,
        screenWidth: 7680,
        screenHeight: 4320,
        devicePixelRatio: 2
    });
    assert.ok(large < 1);
    assert.ok(7680 * 4320 * large * large < Basemap.maxRenderPixels);
});

test('초기 영역과 UI 여백은 화면 구간별 공개 상수에서 계산한다', () => {
    assert.deepEqual(Basemap.initialGeoExtent(false), [124.7, 32.4, 131.6, 38.9]);
    assert.deepEqual(Basemap.initialGeoExtent(true), [124.7, 32.4, 131.6, 38.9]);
    assert.deepEqual(Basemap.initialPadding(360), [120, 32, 238, 20]);
    assert.deepEqual(Basemap.initialPadding(640), [120, 36, 238, 20]);
    assert.deepEqual(Basemap.initialPadding(900), [120, 66, 234, 28]);
    assert.deepEqual(Basemap.initialPadding(1200), [110, 100, 170, 278]);
});
