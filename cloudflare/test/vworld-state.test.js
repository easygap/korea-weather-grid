import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const VWorld = require('../../src/main/resources/static/js/weather-grid-vworld-state.js');
const key = '12345678-1234-1234-1234-123456789abc';

test('런타임 설정은 활성 플래그와 UUID 형식 키가 모두 맞을 때만 허용한다', () => {
    assert.deepEqual(VWorld.runtimeConfig({
        vworldEnabled: true,
        vworldApiKey: key
    }), { enabled: true, key });
    assert.deepEqual(VWorld.runtimeConfig({
        vworldEnabled: false,
        vworldApiKey: key
    }), { enabled: false, key: '' });
    assert.deepEqual(VWorld.runtimeConfig({
        vworldEnabled: true,
        vworldApiKey: 'invalid'
    }), { enabled: false, key: '' });
});

test('공식 벡터 지도 API URL은 z-x-y 순서를 사용한다', () => {
    const urls = VWorld.tileUrls(key);
    assert.match(urls.base, /\/Base\/\{z\}\/\{x\}\/\{y\}\.png$/);
    assert.match(urls.traffic, /\/traffic\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    assert.equal(VWorld.tileUrls('invalid'), null);
});

test('경로 문자가 섞인 키는 타일 URL로 만들지 않는다', () => {
    assert.equal(VWorld.tileUrls(`${key}/Base`), null);
    assert.equal(VWorld.tileUrls(` ${key}`), null);
});

test('공급자 상태 문구는 VWorld와 OSM 대체 상태를 구분한다', () => {
    assert.match(VWorld.providerMessage('vworld'), /VWorld/);
    assert.match(VWorld.providerMessage('osm'), /OpenStreetMap/);
});
