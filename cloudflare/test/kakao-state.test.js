import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Kakao = require('../../src/main/resources/static/js/weather-grid-kakao-state.js');

test('런타임 설정은 활성 플래그와 32자리 16진수 키가 모두 맞을 때만 허용한다', () => {
    const key = 'a'.repeat(32);
    assert.deepEqual(Kakao.runtimeConfig({
        kakaoEnabled: true,
        kakaoJavascriptKey: key
    }), { enabled: true, key });
    assert.deepEqual(Kakao.runtimeConfig({
        kakaoEnabled: false,
        kakaoJavascriptKey: key
    }), { enabled: false, key: '' });
    assert.deepEqual(Kakao.runtimeConfig({
        kakaoEnabled: true,
        kakaoJavascriptKey: 'invalid'
    }), { enabled: false, key: '' });
});

test('OpenLayers 확대 수준은 Kakao 지도 수준 범위로 단조 변환된다', () => {
    assert.equal(Kakao.levelForZoom(6.5), 10);
    assert.equal(Kakao.levelForZoom(12.5), 4);
    assert.equal(Kakao.levelForZoom(100), 1);
    assert.equal(Kakao.levelForZoom(-100), 14);
});

test('뷰 계획은 중심 좌표를 검증하고 Kakao 지도 수준을 함께 반환한다', () => {
    assert.deepEqual(Kakao.viewPlan([127.5, 37.5], 8), {
        longitude: 127.5,
        latitude: 37.5,
        level: 8
    });
    assert.equal(Kakao.viewPlan([NaN, 37.5], 8), null);
    assert.equal(Kakao.viewPlan(null, 8), null);
});

test('공급자 상태 문구는 Kakao와 OSM 대체 상태를 구분한다', () => {
    assert.match(Kakao.providerMessage('kakao'), /Kakao/);
    assert.match(Kakao.providerMessage('osm'), /OpenStreetMap/);
});
