import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const infrastructure = require('../../src/main/resources/static/js/weather-grid-infrastructure-state.js');
const adapterSource = readFileSync(fileURLToPath(new URL(
    '../../src/main/resources/static/js/weather-grid-infrastructure.js', import.meta.url)), 'utf8');

test('초기 상태는 데이터가 있는 종류만 표시 가능하게 고정한다', () => {
    const state = infrastructure.initial({
        available: { bridge: true, airport: false, port: true },
        visible: { bridge: true, airport: true }
    });

    assert.deepEqual(state.available, { bridge: true, airport: false, port: true });
    assert.deepEqual(state.visible, { bridge: true, airport: false, port: false });
    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(state.available));
    assert.ok(Object.isFrozen(state.visible));
});

test('각 인프라 토글은 다른 종류의 표시 상태를 보존한다', () => {
    const initial = infrastructure.initial({ available: { bridge: true, airport: true, port: true } });
    const bridge = infrastructure.transition(initial, { type: 'toggle', key: 'bridge' });
    const airport = infrastructure.transition(bridge.state, { type: 'set', key: 'airport', visible: true });

    assert.deepEqual(bridge.effects, [{ type: 'layer/visibility', key: 'bridge', visible: true }]);
    assert.deepEqual(airport.state.visible, { bridge: true, airport: true, port: false });
    assert.ok(Object.isFrozen(bridge.effects));
    assert.ok(Object.isFrozen(bridge.effects[0]));
});

test('알 수 없거나 데이터가 없는 종류는 상태와 효과를 만들지 않는다', () => {
    const state = infrastructure.initial({ available: { bridge: true } });

    assert.strictEqual(infrastructure.transition(state, { type: 'toggle', key: 'airport' }).state, state);
    assert.deepEqual(infrastructure.transition(state, { type: 'toggle', key: 'unknown' }).effects, []);
});

test('이미 적용된 표시 상태를 다시 설정하면 중복 효과를 내지 않는다', () => {
    const state = infrastructure.initial({ available: { port: true } });
    const result = infrastructure.transition(state, { type: 'set', key: 'port', visible: false });

    assert.strictEqual(result.state, state);
    assert.deepEqual(result.effects, []);
});

test('세 종류는 색상 외에도 서로 다른 벡터 형태 계약을 가진다', () => {
    assert.deepEqual(infrastructure.keys, ['bridge', 'airport', 'port']);
    assert.equal(infrastructure.catalog.bridge.shape, 'diamond');
    assert.equal(infrastructure.catalog.airport.shape, 'triangle');
    assert.equal(infrastructure.catalog.port.shape, 'square');
    assert.equal(new Set(infrastructure.keys.map((key) => infrastructure.catalog[key].colorToken)).size, 3);
    assert.match(adapterSource, /new ol\.style\.RegularShape/);
    assert.doesNotMatch(adapterSource, /🌉|✈|⚓/u);
});

test('도법 단위를 환산해 라벨 표시 임계값을 동일하게 적용한다', () => {
    assert.equal(infrastructure.metersPerPixel(500, 'm'), 500);
    assert.equal(infrastructure.metersPerPixel(0.005, 'degrees'), 556.6);
    assert.equal(infrastructure.labelsVisible(799.9, 'm'), true);
    assert.equal(infrastructure.labelsVisible(800, 'm'), false);
    assert.equal(infrastructure.labelsVisible(0.01, 'degrees'), false);
});

test('예보 지점은 이름을 정리하고 좌표를 네 자리로 제한한다', () => {
    const location = infrastructure.location('airport', '  인천국제공항  ', 126.4407123, 37.4602567);

    assert.deepEqual(location, {
        key: 'airport', name: '인천국제공항', longitude: 126.4407, latitude: 37.4603
    });
    assert.ok(Object.isFrozen(location));
});

test('범위를 벗어난 좌표와 잘못된 이름은 예보 요청으로 만들지 않는다', () => {
    assert.equal(infrastructure.location('port', '', 129, 35), null);
    assert.equal(infrastructure.location('port', '부산항', 181, 35), null);
    assert.equal(infrastructure.location('unknown', '지점', 127, 37), null);
});
