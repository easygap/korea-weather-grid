import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const VWorld = require('../../src/main/resources/static/js/weather-grid-vworld-state.js');
const tileBase = '/api/map/vworld';

test('런타임 설정은 활성 플래그와 고정된 같은 출처 타일 경로가 모두 맞을 때만 허용한다', () => {
    assert.deepEqual(VWorld.runtimeConfig({
        vworldEnabled: true,
        vworldTileBase: tileBase
    }), { enabled: true, tileBase });
    assert.deepEqual(VWorld.runtimeConfig({
        vworldEnabled: false,
        vworldTileBase: tileBase
    }), { enabled: false, tileBase: '' });
    assert.deepEqual(VWorld.runtimeConfig({
        vworldEnabled: true,
        vworldTileBase: 'https://evil.example/tiles'
    }), { enabled: false, tileBase: '' });
});

test('같은 출처 타일 프록시 URL은 z-x-y 순서를 사용한다', () => {
    const urls = VWorld.tileUrls(tileBase);
    assert.match(urls.base, /\/base\/\{z\}\/\{x\}\/\{y\}\.png$/);
    assert.match(urls.traffic, /\/traffic\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    assert.equal(VWorld.tileUrls('invalid'), null);
});

test('외부 주소나 경로 확장은 타일 URL로 만들지 않는다', () => {
    assert.equal(VWorld.tileUrls(`${tileBase}/base`), null);
    assert.equal(VWorld.tileUrls(` ${tileBase}`), null);
    assert.equal(VWorld.tileUrls('https://evil.example/api/map/vworld'), null);
});

test('공급자 상태 문구는 VWorld와 OSM 대체 상태를 구분한다', () => {
    assert.match(VWorld.providerMessage('vworld'), /VWorld/);
    assert.match(VWorld.providerMessage('osm'), /OpenStreetMap/);
});
