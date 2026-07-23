import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const locationState = require('../../src/main/resources/static/js/weather-grid-location-state.js');

test('지점 이름과 좌표를 공개 요청 정밀도로 정규화한다', () => {
    const location = locationState.normalizeLocation(' 서울 ', 37.566535, 126.977969, true);
    assert.deepEqual(location, {
        name: '서울', latitude: 37.566535, longitude: 126.977969,
        latitudeText: '37.5665', longitudeText: '126.9780'
    });
    assert.ok(Object.isFrozen(location));
    assert.equal(locationState.normalizeLocation('', 37, 127, true), null);
    assert.equal(locationState.normalizeLocation('서울', 91, 127, true), null);
});

test('일반 요소는 상세예보와 독립된 시계열 query를 만든다', () => {
    const built = locationState.timelineRequest({
        name: '서울', latitude: 37.5665, longitude: 126.978,
        baseDate: '20260723', baseTime: '08', element: 'wdws', height: '10m',
        includeForecast: false
    });
    assert.equal(built.valid, true);
    assert.equal(built.request.sharedForecast, false);
    assert.equal(built.request.loadForecast, false);
    assert.equal(built.request.chartDate, '2026072308');
    assert.equal(built.request.timeseriesPath,
        '/api/weather/timeseries?latitude=37.5665&longitude=126.9780&baseDate=20260723&baseTime=0800&element=wdws&height=10m');
});

test('강수 계열은 상세예보 응답을 차트와 공유하고 독립 시계열 요청을 생략한다', () => {
    for (const element of locationState.sharedForecastElements) {
        const built = locationState.timelineRequest({
            name: '', latitude: 35.1, longitude: 129.1,
            baseDate: '20260723', baseTime: '11', element: element, height: '10m',
            includeForecast: false
        });
        assert.equal(built.request.sharedForecast, true);
        assert.equal(built.request.loadForecast, true);
    }
});

test('지원하지 않는 요소·고도·발표시각과 잘못된 좌표는 요청을 만들지 않는다', () => {
    const base = {
        latitude: 37, longitude: 127, baseDate: '20260723', baseTime: '08',
        element: 'tmp', height: '10m'
    };
    assert.equal(locationState.timelineRequest({ ...base, element: 'unknown' }).valid, false);
    assert.equal(locationState.timelineRequest({ ...base, height: '100m' }).valid, false);
    assert.equal(locationState.timelineRequest({ ...base, baseTime: '09' }).valid, false);
    assert.equal(locationState.timelineRequest({ ...base, latitude: Number.NaN }).valid, false);
});

test('지도 좌표 확인 query는 위도·경도만 고정 순서로 직렬화한다', () => {
    assert.deepEqual(locationState.coverageRequest(33.499621, 126.531188), {
        location: {
            name: '', latitude: 33.499621, longitude: 126.531188,
            latitudeText: '33.4996', longitudeText: '126.5312'
        },
        path: '/api/weather/coverage?latitude=33.4996&longitude=126.5312'
    });
    assert.equal(locationState.coverageRequest(-91, 127), null);
});

test('새 요청은 진행 중 전송을 취소하고 이전 순번 응답을 무시한다', () => {
    const first = locationState.transition(locationState.initialChannel(), { type: 'request/start' });
    assert.deepEqual(first.effects, [{ type: 'request/send', sequence: 1 }]);
    const second = locationState.transition(first.state, { type: 'request/start' });
    assert.deepEqual(second.effects, [
        { type: 'request/abort' },
        { type: 'request/send', sequence: 2 }
    ]);
    const stale = locationState.transition(second.state, {
        type: 'request/succeeded', sequence: 1, result: { inside: true }
    });
    assert.equal(stale.state, second.state);
    assert.deepEqual(stale.effects, []);
});

test('성공·오류·취소·완료를 채널별 명시적 효과로 계산한다', () => {
    const started = locationState.transition(locationState.initialChannel(), { type: 'request/start' }).state;
    const success = locationState.transition(started, {
        type: 'request/succeeded', sequence: 1, result: { inside: true }
    });
    assert.deepEqual(success.effects, [{ type: 'request/present', result: { inside: true } }]);
    const failed = locationState.transition(started, {
        type: 'request/failed', sequence: 1, reason: 'timeout'
    });
    assert.deepEqual(failed.effects, [{ type: 'request/error', reason: 'timeout' }]);
    assert.deepEqual(locationState.transition(started, { type: 'request/cancel' }).effects,
        [{ type: 'request/abort' }]);
    assert.deepEqual(locationState.transition(started, {
        type: 'request/completed', sequence: 1
    }).effects, [{ type: 'request/settled' }]);
});

test('지점과 범위 오류 문구는 시간 초과와 일반 실패를 구분한다', () => {
    assert.match(locationState.stationError('timeout'), /시계열 응답 시간이 초과/);
    assert.match(locationState.stationError('module-timeout'), /차트 모듈 응답 시간이 초과/);
    assert.match(locationState.coverageMessage('outside'), /지원 범위 밖/);
    assert.match(locationState.coverageMessage('timeout'), /확인 시간이 초과/);
});
