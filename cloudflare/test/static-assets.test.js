import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourceMapScript = readFileSync(fileURLToPath(new URL(
    '../../src/main/resources/static/js/weather-grid.js', import.meta.url)), 'utf8');

test('기상 지점 마커는 래스터 자산 없이 OpenLayers 벡터 스타일을 사용한다', () => {
    assert.match(sourceMapScript, /createStationNodeStyles/);
    assert.match(sourceMapScript, /stationLabelStyle/);
    assert.doesNotMatch(sourceMapScript, /station[^'"\s]*\.(?:png|webp|svg)/i);
});
