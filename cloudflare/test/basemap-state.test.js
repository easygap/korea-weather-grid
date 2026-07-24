import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Basemap = require('../../src/main/resources/static/js/weather-grid-basemap-state.js');

test('첫 배경지도 상태는 화면 폭에 따라 대표 지역 표시만 달라진다', () => {
    assert.deepEqual(Basemap.initialState(false), {
        mode: 'weather',
        regionLabels: true,
        provinceBoundaries: false,
        stationsVisible: true
    });
    assert.equal(Basemap.initialState(true).stationsVisible, false);
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
    assert.equal(plan.weather.fill, '#ffffff');
    assert.equal(plan.vector.fill, '#fbfaf2');
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
    assert.deepEqual(Basemap.initialGeoExtent(false), [123.9, 31.7, 132.4, 39.2]);
    assert.deepEqual(Basemap.initialGeoExtent(true), [123.8, 31.6, 132.5, 39.2]);
    assert.deepEqual(Basemap.initialPadding(360), [108, 12, 104, 12]);
    assert.deepEqual(Basemap.initialPadding(640), [64, 16, 96, 16]);
    assert.deepEqual(Basemap.initialPadding(900), [116, 20, 100, 20]);
    assert.deepEqual(Basemap.initialPadding(1200), [84, 160, 92, 292]);
});
