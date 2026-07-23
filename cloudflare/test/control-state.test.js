import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const controls = require('../../src/main/resources/static/js/weather-grid-control-state.js');

function next(state, event) {
    return controls.transition(state, event);
}

test('초기 제어 상태와 요소 기억값은 불변 스냅샷이다', () => {
    const state = controls.initial({ selectedMetric: 'pcp' });

    assert.deepEqual(state, {
        playing: false,
        awaitingGrid: false,
        timerPending: false,
        wrapPending: false,
        selectedMetric: 'pcp',
        lastPrecipitationMetric: 'pcp',
        lastWeatherMetric: 'wdws'
    });
    assert.ok(Object.isFrozen(state));
});

test('강수 세부 요소와 사용자 기상 요소를 서로 독립적으로 기억한다', () => {
    let state = controls.initial({ selectedMetric: 'wdws' });
    state = next(state, { type: 'metric/select', metric: 'sno', rememberWeather: true }).state;
    assert.equal(state.lastPrecipitationMetric, 'sno');
    assert.equal(state.lastWeatherMetric, 'sno');

    state = next(state, { type: 'metric/select', metric: 'tmp', rememberWeather: false }).state;
    assert.equal(state.selectedMetric, 'tmp');
    assert.equal(state.lastPrecipitationMetric, 'sno');
    assert.equal(state.lastWeatherMetric, 'sno');
});

test('재생은 현재 시간에서 3시간 뒤를 즉시 선택한다', () => {
    const outcome = next(controls.initial(), {
        type: 'play/start', currentHour: 1, loading: false
    });

    assert.equal(outcome.state.playing, true);
    assert.equal(outcome.state.awaitingGrid, true);
    assert.deepEqual(outcome.effects, [{ type: 'timeline/select', hour: 4 }]);
    assert.ok(Object.isFrozen(outcome));
    assert.ok(Object.isFrozen(outcome.effects));
});

test('성공한 프레임은 6.2초 후 다음 3시간 프레임을 예약한다', () => {
    let outcome = next(controls.initial(), {
        type: 'play/start', currentHour: 1, loading: false
    });
    outcome = next(outcome.state, {
        type: 'grid/settled', currentHour: 4, success: true
    });
    assert.equal(outcome.state.timerPending, true);
    assert.deepEqual(outcome.effects, [{ type: 'timer/schedule', delay: 6200 }]);

    outcome = next(outcome.state, {
        type: 'timer/fired', currentHour: 4, loading: false
    });
    assert.deepEqual(outcome.effects, [{ type: 'timeline/select', hour: 7 }]);
    assert.equal(outcome.state.awaitingGrid, true);
});

test('마지막 시간에서 시작한 재생은 첫 유효 시간으로 순환한다', () => {
    const immediate = next(controls.initial(), {
        type: 'play/start', currentHour: 48, loading: false
    });
    assert.deepEqual(immediate.effects, [{ type: 'timeline/select', hour: 1 }]);
    assert.equal(immediate.state.wrapPending, false);

    let waiting = next(controls.initial(), {
        type: 'play/start', currentHour: 48, loading: true
    });
    assert.equal(waiting.state.wrapPending, true);
    waiting = next(waiting.state, {
        type: 'grid/settled', currentHour: 48, success: true
    });
    waiting = next(waiting.state, {
        type: 'timer/fired', currentHour: 48, loading: false
    });
    assert.deepEqual(waiting.effects, [{ type: 'timeline/select', hour: 1 }]);
});

test('정상 순서로 마지막 프레임에 도달하면 재생을 끝낸다', () => {
    let outcome = next(controls.initial(), {
        type: 'play/start', currentHour: 45, loading: false
    });
    assert.deepEqual(outcome.effects, [{ type: 'timeline/select', hour: 48 }]);

    outcome = next(outcome.state, {
        type: 'grid/settled', currentHour: 48, success: true
    });
    assert.equal(outcome.state.playing, false);
    assert.deepEqual(outcome.effects, [{ type: 'timer/cancel' }]);
});

test('조회 실패와 수동 중지는 예약을 취소하고 정지 상태로 돌아간다', () => {
    let outcome = next(controls.initial(), {
        type: 'play/start', currentHour: 1, loading: false
    });
    outcome = next(outcome.state, {
        type: 'grid/settled', currentHour: 4, success: false
    });
    assert.equal(outcome.state.playing, false);
    assert.deepEqual(outcome.effects, [{ type: 'timer/cancel' }]);

    outcome = next(controls.initial(), {
        type: 'play/start', currentHour: 1, loading: true
    });
    outcome = next(outcome.state, { type: 'play/stop' });
    assert.equal(outcome.state.awaitingGrid, false);
    assert.deepEqual(outcome.effects, [{ type: 'timer/cancel' }]);
});

test('타이머 만료 중 다른 조회가 진행되면 완료 신호를 다시 기다린다', () => {
    let outcome = next(controls.initial(), {
        type: 'play/start', currentHour: 1, loading: false
    });
    outcome = next(outcome.state, {
        type: 'grid/settled', currentHour: 4, success: true
    });
    outcome = next(outcome.state, {
        type: 'timer/fired', currentHour: 4, loading: true
    });
    assert.equal(outcome.state.awaitingGrid, true);
    assert.equal(outcome.state.timerPending, false);
    assert.deepEqual(outcome.effects, []);

    outcome = next(outcome.state, {
        type: 'grid/settled', currentHour: 4, success: true
    });
    assert.deepEqual(outcome.effects, [{ type: 'timer/schedule', delay: 6200 }]);
});
