import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dataState = require('../../src/main/resources/static/js/weather-grid-data-state.js');

const latest = Object.freeze({ date: '2026-07-23', time: '11' });
const validInput = Object.freeze({
    element: 'tmp', height: '10m', date: '2026-07-23', baseTime: '08', leadHour: 7
});

function selection(overrides = {}) {
    return dataState.buildRequest({ ...validInput, ...overrides }, latest);
}

function gridResult(overrides = {}) {
    return {
        data: [1, 2, 3, 4], nx: 2, ny: 2, nxMin: 10, nyMin: 20, step: 1,
        ...overrides
    };
}

test('유효한 선택을 고정된 격자 요청과 쿼리 문자열로 정규화한다', () => {
    const built = selection();

    assert.deepEqual(built.request, {
        element: 'tmp', baseDate: '20260723', baseTime: '08', leadHours: '007', height: '10m'
    });
    assert.equal(dataState.query(built.request),
        '/api/weather/grid?baseDate=20260723&baseTime=0800&element=tmp&height=10m&leadHours=7');
    assert.ok(Object.isFrozen(built));
    assert.ok(Object.isFrozen(built.request));
});

test('지원 범위 밖의 요소·고도·발표·발효 선택을 거부한다', () => {
    assert.equal(selection({ element: 'unknown' }).error, 'element');
    assert.equal(selection({ height: '2m' }).error, 'height');
    assert.equal(selection({ date: '2026-02-29' }).error, 'date');
    assert.equal(selection({ baseTime: '03' }).error, 'baseTime');
    assert.equal(selection({ date: '2026-07-23', baseTime: '14' }).error, 'futureRun');
    assert.equal(selection({ date: '2026-05-23' }).error, 'dateRange');
    assert.equal(selection({ leadHour: 0 }).error, 'leadHour');
    assert.equal(selection({ leadHour: 49 }).error, 'leadHour');
});

test('첫 조회는 화면 초기화와 네트워크 요청 효과를 순서대로 만든다', () => {
    const next = dataState.transition(dataState.initial(), {
        type: 'request/start', selection: selection()
    });

    assert.equal(next.state.activeSequence, 1);
    assert.equal(next.state.status, 'loading');
    assert.deepEqual(next.effects.map((effect) => effect.type), ['grid/reset', 'request/fetch']);
    assert.equal(next.effects[1].sequence, 1);
    assert.ok(Object.isFrozen(next.state));
    assert.ok(Object.isFrozen(next.effects));
});

test('새 조회는 진행 중인 전송을 중단하고 이전 순번 응답을 무시한다', () => {
    const first = dataState.transition(dataState.initial(), {
        type: 'request/start', selection: selection()
    });
    const second = dataState.transition(first.state, {
        type: 'request/start', selection: selection({ element: 'reh' })
    });
    const stale = dataState.transition(second.state, {
        type: 'request/succeeded', sequence: 1, result: gridResult()
    });

    assert.deepEqual(second.effects.map((effect) => effect.type),
        ['request/abort', 'grid/reset', 'request/fetch']);
    assert.equal(second.state.activeSequence, 2);
    assert.equal(stale.state, second.state);
    assert.deepEqual(stale.effects, []);
});

test('정상 격자 응답은 표시하고 완료 이벤트에 성공 여부를 전달한다', () => {
    const started = dataState.transition(dataState.initial(), {
        type: 'request/start', selection: selection()
    });
    const succeeded = dataState.transition(started.state, {
        type: 'request/succeeded', sequence: 1, request: selection().request, result: gridResult()
    });
    const completed = dataState.transition(succeeded.state, {
        type: 'request/completed', sequence: 1
    });

    assert.equal(succeeded.effects[0].type, 'grid/present');
    assert.equal(succeeded.state.successful, true);
    assert.deepEqual(completed.effects, [{ type: 'grid/settled', success: true }]);
    assert.equal(completed.state.activeSequence, null);
});

test('빈 응답과 구조가 깨진 응답을 서로 다른 화면 효과로 분류한다', () => {
    const started = dataState.transition(dataState.initial(), {
        type: 'request/start', selection: selection()
    });
    const empty = dataState.transition(started.state, {
        type: 'request/succeeded', sequence: 1, request: selection().request, result: { data: [] }
    });
    const invalid = dataState.transition(started.state, {
        type: 'request/succeeded', sequence: 1, request: selection().request,
        result: gridResult({ data: [1] })
    });

    assert.deepEqual(empty.effects.map((effect) => [effect.type, effect.reason]), [['grid/empty', 'empty']]);
    assert.deepEqual(invalid.effects.map((effect) => [effect.type, effect.reason]),
        [['grid/error', 'invalid-response']]);
});

test('선택 오류와 전송 오류 메시지를 상태 모델이 일관되게 결정한다', () => {
    const rejected = dataState.transition(dataState.initial(), {
        type: 'request/start', selection: selection({ leadHour: 50 })
    });
    const started = dataState.transition(dataState.initial(), {
        type: 'request/start', selection: selection()
    });
    const failed = dataState.transition(started.state, {
        type: 'request/failed', sequence: 1, reason: 'timeout'
    });

    assert.equal(rejected.effects[0].type, 'selection/rejected');
    assert.deepEqual(failed.effects.map((effect) => effect.type), ['grid/error']);
    assert.match(dataState.errorMessage('timeout'), /시간이 초과/);
    assert.match(dataState.errorMessage('network', 429), /요청이 많아/);
    assert.match(dataState.errorMessage('invalid-response'), /응답 형식/);
});
