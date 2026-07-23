import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const windState = require('../../src/main/resources/static/js/weather-grid-wind-state.js');

test('모바일 DPR 3은 선명도를 유지하면서 8MP 예산 안의 Canvas를 만든다', () => {
    const plan = windState.canvasPlan([393, 659], 3);
    assert.deepEqual(plan, {
        cssWidth: 393,
        cssHeight: 659,
        backingWidth: 1179,
        backingHeight: 1977,
        scale: 3,
        pixels: 2330883
    });
    assert.ok(Object.isFrozen(plan));
});

test('4K·8K 화면은 DPR보다 메모리 상한을 우선한다', () => {
    const fourK = windState.canvasPlan([3840, 2160], 2);
    const eightK = windState.canvasPlan([7680, 4320], 2);
    assert.ok(fourK.scale < 1);
    assert.ok(eightK.scale < 0.75);
    assert.ok(fourK.pixels <= windState.maxCanvasPixels);
    assert.ok(eightK.pixels <= windState.maxCanvasPixels);
    assert.equal(windState.canvasPlan([0, 100], 2), null);
});

test('풍장 표시 조건은 요소·레이어·3D·지도 크기를 각각 구분한다', () => {
    const ready = {
        fieldAvailable: true,
        metric: 'wdws',
        streamEnabled: true,
        view3dOpen: false,
        size: [1280, 720],
        devicePixelRatio: 1
    };
    assert.equal(windState.renderDecision(ready).render, true);
    assert.equal(windState.renderDecision({ ...ready, metric: 'tmp' }).reason, 'metric');
    assert.equal(windState.renderDecision({ ...ready, streamEnabled: false }).reason, 'layer');
    assert.equal(windState.renderDecision({ ...ready, view3dOpen: true }).reason, 'view3d');
    assert.equal(windState.renderDecision({ ...ready, fieldAvailable: false }).reason, 'no-field');
});

test('새 벡터장은 렌더러 교체 뒤 현재 화면 렌더를 요청한다', () => {
    const outcome = windState.transition(windState.initial(), { type: 'field/set' });
    assert.deepEqual(outcome.state, { hasField: true, status: 'ready', revision: 1 });
    assert.deepEqual(outcome.effects, [
        { type: 'renderer/replace' },
        { type: 'render/request' }
    ]);
    assert.ok(Object.isFrozen(outcome.state));
    assert.ok(Object.isFrozen(outcome.effects));
});

test('지도 이동과 resize는 렌더러를 즉시 멈추고 마지막 화면에서 한 번 재시작한다', () => {
    const ready = windState.transition(windState.initial(), { type: 'field/set' }).state;
    const moving = windState.transition(ready, { type: 'view/start' });
    assert.equal(moving.state.status, 'moving');
    assert.deepEqual(moving.effects.map((effect) => effect.type), [
        'render/cancel', 'renderer/stop', 'canvas/moving'
    ]);

    const moved = windState.transition(moving.state, { type: 'view/end' });
    assert.deepEqual(moved.effects, [{ type: 'render/schedule', delay: 80 }]);

    const resized = windState.transition(ready, { type: 'viewport/resize' });
    assert.deepEqual(resized.effects.map((effect) => effect.type), [
        'map/resize', 'renderer/stop', 'canvas/moving', 'render/schedule'
    ]);
    assert.equal(resized.effects.at(-1).delay, 140);
});

test('중단은 원본장을 보존하고 clear는 렌더러와 Canvas를 폐기한다', () => {
    const ready = windState.transition(windState.initial(), { type: 'field/set' }).state;
    const suspended = windState.transition(ready, { type: 'render/suspend' });
    assert.deepEqual(suspended.state, { hasField: true, status: 'suspended', revision: 1 });
    assert.deepEqual(suspended.effects.map((effect) => effect.type), [
        'renderer/stop', 'canvas/hide', 'canvas/settle'
    ]);

    const cleared = windState.transition(suspended.state, { type: 'field/clear' });
    assert.deepEqual(cleared.state, { hasField: false, status: 'empty', revision: 2 });
    assert.deepEqual(cleared.effects.map((effect) => effect.type), [
        'renderer/destroy', 'canvas/clear'
    ]);
});
