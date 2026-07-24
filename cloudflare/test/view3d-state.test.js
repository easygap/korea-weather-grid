import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const view3d = require('../../src/main/resources/static/js/weather-grid-view3d-state.js');
const adapterSource = readFileSync(fileURLToPath(new URL(
    '../../src/main/resources/static/js/weather-grid-view3d.js', import.meta.url)), 'utf8');

test('3D 열기 요청은 로딩 상태와 단일 모듈 효과를 만든다', () => {
    const initial = view3d.initial();
    const loading = view3d.transition(initial, { type: 'open/request' });
    const duplicate = view3d.transition(loading.state, { type: 'open/request' });

    assert.deepEqual(loading.state, { status: 'loading', errorCode: null });
    assert.deepEqual(loading.effects, [{ type: 'module/load' }]);
    assert.strictEqual(duplicate.state, loading.state);
    assert.deepEqual(duplicate.effects, []);
    assert.ok(Object.isFrozen(loading.state));
});

test('로딩 성공과 닫기는 모달 표시 상태를 대칭으로 전환한다', () => {
    const loading = view3d.transition(view3d.initial(), { type: 'open/request' }).state;
    const opened = view3d.transition(loading, { type: 'open/succeeded' });
    const closed = view3d.transition(opened.state, { type: 'close' });

    assert.deepEqual(view3d.render(opened.state), { busy: false, active: true, expanded: true });
    assert.deepEqual(opened.effects, [{ type: 'modal/open' }]);
    assert.deepEqual(closed.state, { status: 'idle', errorCode: null });
    assert.deepEqual(closed.effects, [{ type: 'modal/close' }]);
});

test('로딩 실패는 다시 시도 가능한 상태와 원인별 안내를 남긴다', () => {
    const loading = view3d.transition(view3d.initial(), { type: 'open/request' }).state;
    const failed = view3d.transition(loading, { type: 'open/failed', code: 'timeout' });
    const retry = view3d.transition(failed.state, { type: 'open/request' });

    assert.deepEqual(failed.state, { status: 'idle', errorCode: 'timeout' });
    assert.equal(view3d.render(failed.state).busy, false);
    assert.match(view3d.errorMessage('timeout'), /응답 시간이 초과/);
    assert.match(view3d.errorMessage('open'), /여는 중 오류/);
    assert.equal(retry.state.status, 'loading');
});

test('2D 바람장은 실제로 보이던 경우에만 3D 종료 뒤 복구한다', () => {
    const visible = view3d.streamWasVisible({
        metric: 'wdws', layers: { stream: true }, canvasVisible: true
    });

    assert.equal(visible, true);
    assert.equal(view3d.streamWasVisible({
        metric: 'tmp', layers: { stream: true }, canvasVisible: true
    }), false);
    assert.equal(view3d.shouldResumeStream(visible, {
        metric: 'wdws', layers: { stream: true }
    }), true);
    assert.equal(view3d.shouldResumeStream(visible, {
        metric: 'wdws', layers: { stream: false }
    }), false);
});

test('브라우저 어댑터는 단일 동적 import와 명시적 모달 생명주기를 사용한다', () => {
    assert.equal((adapterSource.match(/\bimport\s*\(/g) || []).length, 1);
    assert.match(adapterSource, /modulePromise/);
    assert.match(adapterSource, /aria-busy/);
    assert.match(adapterSource, /Interface\.modal\.registerCloser/);
    assert.doesNotMatch(adapterSource, /MutationObserver/);
});
