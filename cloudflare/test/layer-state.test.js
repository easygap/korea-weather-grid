import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const layers = require('../../src/main/resources/static/js/weather-grid-layer-state.js');

test('기본 바람 표현은 색상과 흐름선을 켜고 등치선을 끈다', () => {
    const state = layers.initial();

    assert.deepEqual(state, { heat: true, stream: true, iso: false });
    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(layers.keys));
});

test('바람이 아닌 요소에서는 흐름선 선택을 상태에서 제거한다', () => {
    const state = layers.normalize(
        { heat: false, stream: true, iso: true }, 'tmp', { isoline: true }
    );

    assert.deepEqual(state, { heat: false, stream: false, iso: true });
});

test('범주형 요소는 색상면을 보장하고 등치선을 허용하지 않는다', () => {
    const state = layers.normalize(
        { heat: false, stream: true, iso: true }, 'pty', { categorical: true, isoline: false }
    );
    const available = layers.availability('pty', { categorical: true, isoline: false });

    assert.deepEqual(state, { heat: true, stream: false, iso: false });
    assert.deepEqual(available.heat, { enabled: false, required: true });
    assert.equal(available.iso.enabled, false);
    assert.ok(Object.isFrozen(available));
    assert.ok(Object.isFrozen(available.heat));
});

test('사용 가능한 레이어 토글만 상태를 변경한다', () => {
    const wind = layers.initial();
    const heat = layers.transition(wind, { type: 'layer/toggle', layer: 'heat' }, {
        metric: 'wdws', metadata: { isoline: true }
    });
    const unavailableStream = layers.transition(heat.state, {
        type: 'layer/toggle', layer: 'stream'
    }, { metric: 'tmp', metadata: { isoline: true } });

    assert.deepEqual(heat.state, { heat: false, stream: true, iso: false });
    assert.equal(heat.changed, true);
    assert.deepEqual(unavailableStream.state, { heat: false, stream: false, iso: false });
    assert.equal(unavailableStream.changed, false);
    assert.ok(Object.isFrozen(heat));
});

test('알 수 없는 사건과 레이어 이름은 상태를 바꾸지 않는다', () => {
    const state = layers.initial();

    assert.equal(layers.transition(state, { type: 'layer/toggle', layer: 'fog' }, {
        metric: 'wdws'
    }).changed, false);
    assert.equal(layers.transition(state, { type: 'unknown' }, {
        metric: 'wdws'
    }).changed, false);
});
