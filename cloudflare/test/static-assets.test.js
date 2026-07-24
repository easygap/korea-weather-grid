import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mapBootstrapScript = readFileSync(fileURLToPath(new URL(
    '../../src/main/resources/static/js/weather-grid-map-bootstrap.js', import.meta.url)), 'utf8');
const vworldAdapterScript = readFileSync(fileURLToPath(new URL(
    '../../src/main/resources/static/js/weather-grid-vworld.js', import.meta.url)), 'utf8');
const vworldStateScript = readFileSync(fileURLToPath(new URL(
    '../../src/main/resources/static/js/weather-grid-vworld-state.js', import.meta.url)), 'utf8');

test('기상 지점 마커는 래스터 자산 없이 OpenLayers 벡터 스타일을 사용한다', () => {
    assert.match(mapBootstrapScript, /function nodeStyles\(/);
    assert.match(mapBootstrapScript, /function labelStyle\(/);
    assert.doesNotMatch(mapBootstrapScript, /station[^'"\s]*\.(?:png|webp|svg)/i);
});

test('도로 배경지도는 VWorld 벡터 API 어댑터와 OSM 대체 레이어를 분리한다', () => {
    assert.match(vworldStateScript, /api\.vworld\.kr/);
    assert.match(vworldAdapterScript, /\/api\/runtime\/map-config/);
    assert.match(vworldAdapterScript, /new ol\.source\.Vector/);
    assert.match(vworldAdapterScript, /featureProjection: plan\.projection/);
    assert.match(mapBootstrapScript, /VWorldBasemap\.show\(map\)/);
    assert.match(mapBootstrapScript, /new ol\.source\.OSM/);
});
