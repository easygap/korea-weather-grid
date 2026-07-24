import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const explore = require('../../src/main/resources/static/js/weather-grid-explore-state.js');

test('초기 탐색 상태와 공개 카탈로그는 변경할 수 없게 고정한다', () => {
    const state = explore.initial();

    assert.deepEqual(state, { activeMode: 'wind', lastWeatherMode: 'wind' });
    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(explore.modeCopy));
    assert.ok(Object.isFrozen(explore.modeCopy.wind));
});

test('기상 빠른 보기는 요소·레이어·배경지도 효과를 명시한다', () => {
    const wind = explore.plan('wind', { compact: false });
    const precipitation = explore.plan('precipitation', { lastPrecipitation: 'sno' });
    const solar = explore.plan('solar');

    assert.deepEqual(wind.layers, { heat: true, stream: true, iso: false });
    assert.equal(wind.metric, 'wdws');
    assert.equal(wind.stations, true);
    assert.equal(wind.basemap, 'weather');
    assert.equal(precipitation.metric, 'sno');
    assert.deepEqual(precipitation.layers, { heat: true, stream: false, iso: false });
    assert.equal(solar.metric, 'swdn');
    assert.ok(Object.isFrozen(wind));
    assert.ok(Object.isFrozen(wind.environment));
});

test('위험기상·대기질·교통은 서로 겹치지 않는 오버레이 계획을 만든다', () => {
    const hazards = explore.plan('hazards');
    const air = explore.plan('air');
    const road = explore.plan('road');

    assert.deepEqual(hazards.hazards, { typhoon: true, lightning: true });
    assert.equal(hazards.stopPlayback, true);
    assert.deepEqual(hazards.layers, { heat: false, stream: false, iso: false });
    assert.deepEqual(air.environment, { air: 'pm25', cctv: false });
    assert.deepEqual(air.layers, { heat: false, stream: true, iso: false });
    assert.deepEqual(road.environment, { air: 'off', cctv: true });
    assert.equal(road.basemap, 'streets');
});

test('작은 화면과 직접 조정 모드는 지점·레이어 제약을 보존한다', () => {
    const compactWind = explore.plan('wind', { compact: true });
    const custom = explore.plan('custom', {
        lastWeather: 'wav',
        layers: { heat: false, stream: true, iso: true },
        metricMeta: { isoline: false }
    });

    assert.equal(compactWind.stations, false);
    assert.equal(custom.metric, 'wav');
    assert.deepEqual(custom.layers, { heat: true, stream: false, iso: false });
});

test('현재 화면 추론은 환경 오버레이를 기상 레이어보다 우선한다', () => {
    const wind = { metric: 'wdws', layers: { heat: true, stream: true, iso: false } };

    assert.equal(explore.infer({ ...wind, air: 'pm25', cctv: true }), 'air');
    assert.equal(explore.infer({ ...wind, air: 'off', cctv: true }), 'road');
    assert.equal(explore.infer({ ...wind, air: 'off', cctv: false }), 'wind');
});

test('기상 요소와 레이어 조합에서 표준 모드 또는 사용자 설정을 추론한다', () => {
    const scalar = { heat: true, stream: false, iso: false };

    assert.equal(explore.infer({ metric: 'tmp', layers: scalar }), 'temperature');
    assert.equal(explore.infer({ metric: 'pty', layers: scalar }), 'precipitation');
    assert.equal(explore.infer({ metric: 'swdn', layers: scalar }), 'solar');
    assert.equal(explore.infer({ metric: 'reh', layers: scalar }), 'custom');
    assert.equal(explore.infer({
        metric: 'tmp', layers: { heat: false, stream: false, iso: false },
        hazards: { typhoon: true }
    }), 'hazards');
});

test('탐색 문맥은 요소별 설명과 도메인·설정 제목을 함께 계산한다', () => {
    const precipitation = explore.context('precipitation', 'pty', 'precipitation');
    const marine = explore.context('custom', 'wav', 'marine');
    const air = explore.context('air', 'wdws', 'wind');

    assert.equal(precipitation.title, '강수형태');
    assert.equal(precipitation.timeline, '강수·적설 예보');
    assert.equal(marine.dockContext, '기상 · 해상');
    assert.equal(air.domain, 'air');
    assert.equal(air.dockContext, '대기질 · 미세먼지');
    assert.ok(Object.isFrozen(precipitation));
});

test('데이터 영역을 왕복하면 마지막 기상 보기를 복구한다', () => {
    let state = explore.transition(explore.initial(), {
        type: 'mode/select', mode: 'temperature'
    }).state;
    state = explore.transition(state, { type: 'domain/select', domain: 'air' }).state;
    const restored = explore.transition(state, { type: 'domain/select', domain: 'weather' });

    assert.equal(state.activeMode, 'air');
    assert.equal(state.lastWeatherMode, 'temperature');
    assert.equal(restored.state.activeMode, 'temperature');
    assert.deepEqual(restored.effects, [{ type: 'explore/apply', mode: 'temperature' }]);
});

test('해상·부가 요소의 사용자 설정만 마지막 기상 보기로 기억한다', () => {
    const initial = explore.initial({ activeMode: 'temperature', lastWeatherMode: 'temperature' });
    const ordinary = explore.transition(initial, {
        type: 'state/observe', metricGroup: 'basic',
        snapshot: { metric: 'reh', layers: { heat: true, stream: false, iso: false } }
    });
    const marine = explore.transition(initial, {
        type: 'state/observe', metricGroup: 'marine',
        snapshot: { metric: 'wav', layers: { heat: true, stream: false, iso: false } }
    });

    assert.equal(ordinary.state.lastWeatherMode, 'temperature');
    assert.equal(marine.state.lastWeatherMode, 'custom');
    assert.deepEqual(ordinary.effects, []);
});
