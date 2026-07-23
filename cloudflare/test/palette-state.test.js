import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Palette = require('../../src/main/resources/static/js/weather-grid-palette-state.js');

test('공개 기상 요소 계약은 범주형과 연속형 기능을 구분한다', () => {
    assert.equal(Palette.elementMeta('wdws').unit, 'm/s');
    assert.equal(Palette.elementMeta('pty').categorical, true);
    assert.equal(Palette.elementMeta('sky').view3d, false);
    assert.equal(Palette.elementMeta('unknown'), Palette.elements.wdws);
    assert.equal(Object.isFrozen(Palette.elements), true);
    assert.equal(Object.isFrozen(Palette.elements.pcp), true);
});

test('일사 스케일은 월별 25개 구간과 같은 수의 색을 제공한다', () => {
    assert.equal(Palette.solarPalette.length, 25);
    assert.deepEqual(Object.keys(Palette.solarThresholds).sort(),
        ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
    assert.equal(Palette.solarThresholds['06'].length, 25);
    assert.ok(Palette.solarThresholds['06'].at(-1) > Palette.solarThresholds['12'].at(-1));
});

test('값 검증은 요소별 물리 범위와 범주 코드를 거부 우선으로 적용한다', () => {
    assert.equal(Palette.isValidValue('tmp', -100), true);
    assert.equal(Palette.isValidValue('tmp', 81), false);
    assert.equal(Palette.isValidValue('pty', 4), true);
    assert.equal(Palette.isValidValue('pty', 5), false);
    assert.equal(Palette.isValidValue('sky', 2), false);
    assert.equal(Palette.isValidValue('unknown', 1), false);
});

test('표시 문자열은 범주 레이블과 단위를 동일 계약에서 만든다', () => {
    assert.equal(Palette.valueText('pty', 2), '비/눈');
    assert.equal(Palette.valueText('tmp', 12.34), '12.3 ℃');
    assert.equal(Palette.valueText('reh', Number.NaN), '—');
});

test('풍속과 기온 팔레트는 모든 임계 경계에서 결정적이다', () => {
    assert.equal(Palette.windColor(1), 'rgba(44, 46, 126, 0.82)');
    assert.equal(Palette.windColor(1.01), 'rgba(39, 83, 155, 0.82)');
    assert.equal(Palette.windColor(20), 'rgba(216, 68, 112, 0.82)');
    assert.equal(Palette.temperatureColor(-15), 'rgba(55, 48, 163, 0.7)');
    assert.equal(Palette.temperatureColor(36), 'rgba(190, 18, 60, 0.7)');
});

test('강수·적설·습도·파고는 결측과 음수를 투명하게 처리한다', () => {
    [Palette.rainColor, Palette.snowColor, Palette.humidityColor, Palette.waveColor]
        .forEach((color) => assert.equal(color(-1), Palette.transparent));
    assert.equal(Palette.rainColor(0), 'rgba(119, 139, 160, 0)');
    assert.equal(Palette.snowColor(20), 'rgba(190, 55, 132, 0.9)');
    assert.equal(Palette.humidityColor(100), 'rgba(77, 92, 177, 0.84)');
    assert.equal(Palette.waveColor(5), 'rgba(205, 71, 111, 0.89)');
});

test('범주형 색상은 지원 코드만 노출한다', () => {
    assert.equal(Palette.precipitationTypeColor(0), 'rgba(119, 139, 160, 0)');
    assert.equal(Palette.precipitationTypeColor(9), Palette.transparent);
    assert.equal(Palette.skyColor(3), 'rgba(111, 151, 188, 0.78)');
    assert.equal(Palette.skyColor(0), Palette.transparent);
});

test('통합 색상 함수는 요소 검증 뒤 전용 팔레트로 위임한다', () => {
    assert.equal(Palette.colorFor('pcp', 16), Palette.rainColor(16));
    assert.equal(Palette.colorFor('swdn', 500, '06'), Palette.solarColor(500, '06'));
    assert.equal(Palette.colorFor('sky', 2), Palette.transparent);
    assert.equal(Palette.colorFor('unknown', 1), Palette.transparent);
});
