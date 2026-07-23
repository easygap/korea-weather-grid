import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const legend = require('../../src/main/resources/static/js/weather-grid-legend-model.js');

const metadata = {
    wdws: { legend: '풍속 분포' },
    pcp: { legend: '강수량 분포' },
    reh: { legend: '습도 분포' },
    pty: { legend: '강수형태 분포', categorical: true },
    swdn: { legend: '일사량 분포' }
};

function build(element, values, extras = {}) {
    return legend.build({
        element,
        data: { data: values },
        metadata,
        isValid: (_element, value) => Number.isFinite(value) && value >= 0,
        colorFor: (metric, value) => `${metric}:${value}`,
        ...extras
    });
}

test('풍속 경계값은 겹치지 않는 한 구간에만 집계된다', () => {
    const model = build('wdws', [0, 1, 1.1, 2, 12, 12.1]);

    assert.equal(model.validCount, 6);
    assert.equal(model.rows[0].label, '12 초과');
    assert.equal(model.rows[0].count, 1);
    assert.equal(model.rows.at(-1).label, '1 이하');
    assert.equal(model.rows.at(-1).count, 2);
    assert.equal(model.rows.reduce((sum, row) => sum + row.count, 0), 6);
    assert.match(model.rows[0].ariaLabel, /유효 격자 1개/);
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.rows));
});

test('강수량 0과 각 구간 하한은 지도 의미에 맞게 분리된다', () => {
    const model = build('pcp', [0, 0.5, 1, 3, 15, 30, 50]);

    assert.deepEqual(model.rows.map((row) => row.count), [1, 1, 1, 1, 1, 1, 1]);
    assert.equal(model.rows.at(-1).label, '강수 없음');
    assert.equal(model.rows.at(-1).color, 'rgba(119,139,160,.32)');
});

test('습도 경계 90은 80–90 구간에 포함된다', () => {
    const model = build('reh', [90]);

    assert.equal(model.rows.find((row) => row.label === '90–100').count, 0);
    assert.equal(model.rows.find((row) => row.label === '80–90').count, 1);
});

test('범주형 범례는 색상뿐 아니라 텍스트·분포·숨김 계약을 제공한다', () => {
    const model = build('pty', [0, 1, 3, 3]);

    assert.equal(model.categorical, true);
    assert.equal(model.rows.find((row) => row.label === '눈').shareText, '50%');
    assert.equal(model.rows.find((row) => row.label === '강수 없음').count, 1);
});

test('자료가 없을 때도 전체 구간과 명시적 빈 분포를 유지한다', () => {
    const model = build('pcp', []);

    assert.equal(model.validCount, 0);
    assert.ok(model.rows.every((row) => row.shareText === '—'));
    assert.ok(model.rows.every((row) => row.share === 0));
});

test('월별 일사 모델은 동일 팔레트의 역방향 그라데이션과 10개 버킷을 만든다', () => {
    const palette = Array.from({ length: 10 }, (_, index) => `c${index}`);
    const model = build('swdn', [0, 9, 10, 99, 100, 150], {
        month: 7,
        solarThresholds: { '07': [0, 25, 50, 75, 100] },
        solarPalette: palette
    });

    assert.equal(model.kind, 'solar');
    assert.deepEqual(model.solar.ticks, ['100', '50', '0']);
    assert.deepEqual(model.solar.gradientColors, palette.toReversed());
    assert.equal(model.solar.bins.length, 10);
    assert.equal(model.solar.bins[0].count, 3);
    assert.equal(model.solar.bins.at(-1).count, 2);
    assert.equal(model.unitText, '격자 분포 · W/㎡ · 7월');
});

test('범례 접힘 상태는 토글과 반응형 화면 전환을 결정적으로 처리한다', () => {
    let collapsed = legend.initialCollapsed(false);
    collapsed = legend.reduceCollapsed(collapsed, { type: 'toggle' });
    assert.equal(collapsed, true);
    collapsed = legend.reduceCollapsed(collapsed, { type: 'viewport', compact: false });
    assert.equal(collapsed, false);
});
