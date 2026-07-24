import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runs = require('../../src/main/resources/static/js/weather-grid-run-state.js');

test('KST 발표 날짜와 시각을 UTC epoch로 왕복한다', () => {
    const epoch = runs.parse('2026-07-23', '02');

    assert.equal(epoch, Date.UTC(2026, 6, 22, 17));
    assert.deepEqual(runs.parts(epoch), { date: '2026-07-23', hour: '02' });
    assert.ok(Object.isFrozen(runs.parts(epoch)));
});

test('실재하지 않는 날짜와 발표 주기 밖의 시각은 거부한다', () => {
    assert.equal(runs.parse('2026-02-29', '02'), null);
    assert.equal(runs.parse('2026-07-23', '03'), null);
    assert.equal(runs.parse('', '02'), null);
});

test('이전과 다음 발표는 날짜 경계를 넘어 정확히 3시간씩 이동한다', () => {
    const latest = runs.parse('2026-07-23', '02');
    const previous = runs.shift(latest, latest, -1);

    assert.deepEqual(runs.parts(previous), { date: '2026-07-22', hour: '23' });
    assert.equal(runs.shift(previous, latest, 1), latest);
});

test('최신 발표 이후와 60일 경계 이전으로는 이동하지 않는다', () => {
    const latest = runs.parse('2026-07-23', '11');
    const earliest = runs.limits(latest).earliest;

    assert.equal(runs.shift(latest, latest, 1), null);
    assert.equal(runs.shift(earliest, latest, -1), null);
    assert.deepEqual(runs.availability(latest, latest), {
        valid: true, previous: true, next: false, latest: true
    });
});

test('날짜 입력은 최신 발표일과 60일 범위 안으로 제한한다', () => {
    assert.equal(runs.clampDate('2026-07-24', '2026-07-23'), '2026-07-23');
    assert.equal(runs.clampDate('2026-05-01', '2026-07-23'), '2026-05-24');
    assert.equal(runs.clampDate('2026-06-30', '2026-07-23'), '2026-06-30');
    assert.equal(runs.clampDate('invalid', '2026-07-23'), null);
});

test('조회 경계와 발표 시각 카탈로그는 외부에서 변경할 수 없다', () => {
    const latest = runs.parse('2026-07-23', '23');
    const boundary = runs.limits(latest);

    assert.equal(boundary.latest - boundary.earliest, 60 * 24 * 60 * 60 * 1000);
    assert.ok(Object.isFrozen(boundary));
    assert.ok(Object.isFrozen(runs.baseTimes));
});
