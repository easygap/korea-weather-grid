import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const interfaceState = require('../../src/main/resources/static/js/weather-grid-interface-state.js');

test('초기 UI 상태는 닫힌 설정 패널과 검증된 테마를 사용한다', () => {
    const state = interfaceState.initial({ theme: 'unknown', compact: true, dockOpen: true });

    assert.deepEqual(state, {
        theme: 'dark',
        compact: true,
        dockOpen: false,
        activeModal: null
    });
    assert.ok(Object.isFrozen(state));
});

test('테마 전이는 허용된 두 테마 사이에서만 일어난다', () => {
    let state = interfaceState.initial({ theme: 'dark' });
    state = interfaceState.transition(state, { type: 'theme/toggle' });
    assert.equal(state.theme, 'light');

    state = interfaceState.transition(state, { type: 'theme/set', theme: 'sepia' });
    assert.equal(state.theme, 'dark');
});

test('좁은 화면으로 바뀌면 열려 있던 설정 패널을 닫는다', () => {
    let state = interfaceState.initial({ compact: false });
    state = interfaceState.transition(state, { type: 'dock/open' });
    assert.equal(state.dockOpen, true);

    state = interfaceState.transition(state, { type: 'viewport/change', compact: true });
    assert.equal(state.compact, true);
    assert.equal(state.dockOpen, false);
});

test('모달과 모바일 설정 패널은 동시에 활성화되지 않는다', () => {
    let state = interfaceState.initial({ compact: true });
    state = interfaceState.transition(state, { type: 'dock/open' });
    state = interfaceState.transition(state, { type: 'modal/open', modalId: 'station-forecast' });

    assert.equal(state.dockOpen, false);
    assert.equal(state.activeModal, 'station-forecast');

    const unchanged = interfaceState.transition(state, { type: 'dock/open' });
    assert.equal(unchanged.dockOpen, false);

    const wrongModal = interfaceState.transition(state, { type: 'modal/close', modalId: 'view3d' });
    assert.strictEqual(wrongModal, state);

    state = interfaceState.transition(state, { type: 'modal/close', modalId: 'station-forecast' });
    assert.equal(state.activeModal, null);
});
