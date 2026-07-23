import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const navigation = require('../../src/main/resources/static/js/weather-grid-navigation-state.js');

const context = {
    element: 'wdws',
    date: '2026-07-22',
    latestDate: '2026-07-22',
    baseTime: '11',
    latestTime: '11',
    forecastHour: 1,
    projection: 'KMA_GRID_LCC',
    layers: { heat: true, stream: true, iso: false },
    metadata: {
        wdws: { isoline: true },
        pty: { isoline: false },
        tmp: { isoline: true }
    }
};

test('공유 URL은 허용된 날짜·시각·도법·부가 레이어를 복원한다', () => {
    const restored = navigation.decode(
        '#e=tmp&h=unsupported&d=2026-07-01&t=23&f=13&proj=EPSG%3A3857&v=heat%2Ciso'
        + '&air=pm25&cctv=1&haz=typhoon%2Clightning&lwin=30',
        context
    );

    assert.deepEqual(restored, {
        element: 'tmp',
        height: '10m',
        date: '2026-07-01',
        baseTime: '23',
        forecastHour: 13,
        projection: 'EPSG:3857',
        layers: { heat: true, stream: false, iso: true },
        air: 'pm25',
        cctv: true,
        hazards: { typhoon: true, lightning: true, lightningMinutes: 30 }
    });
    assert.ok(Object.isFrozen(restored));
    assert.ok(Object.isFrozen(restored.layers));
});

test('잘못된 값과 미래 발표 시각은 현재의 안전한 기본값으로 정규화된다', () => {
    const restored = navigation.decode(
        '#e=unknown&d=2026-02-30&t=23&f=99&proj=EPSG%3A9999&v=cheat%2Cupstream&haz=storm&lwin=45',
        context
    );

    assert.equal(restored.element, 'wdws');
    assert.equal(restored.date, '2026-07-22');
    assert.equal(restored.baseTime, '11');
    assert.equal(restored.forecastHour, 1);
    assert.equal(restored.projection, 'KMA_GRID_LCC');
    assert.deepEqual(restored.layers, { heat: false, stream: false, iso: false });
    assert.deepEqual(restored.hazards, { typhoon: false, lightning: false, lightningMinutes: 60 });
});

test('레이어 이름은 부분 문자열이 아니라 정확한 토큰으로만 허용된다', () => {
    const restored = navigation.decode('#e=wdws&v=cheat%2Cstreamline%2Cisobar%2Cstream', context);

    assert.deepEqual(restored.layers, { heat: false, stream: true, iso: false });
});

test('범주형 요소는 등치선을 끄고 기본 색상면을 보장한다', () => {
    const restored = navigation.decode('#e=pty&v=iso', context);

    assert.deepEqual(restored.layers, { heat: true, stream: false, iso: false });
});

test('구버전 r=iso 링크는 명시적인 현재 레이어 상태로 변환된다', () => {
    const restored = navigation.decode('#e=wdws&r=iso', context);

    assert.deepEqual(restored.layers, { heat: false, stream: true, iso: true });
});

test('예보 조회 범위는 최신 날짜를 포함한 60일로 제한된다', () => {
    assert.equal(navigation.earliestDate('2026-07-22'), '2026-05-23');
    assert.equal(navigation.decode('#d=2026-05-23', context).date, '2026-05-23');
    assert.equal(navigation.decode('#d=2026-05-22', context).date, context.date);
});

test('직렬화 결과는 고정 순서이며 비활성 선택지는 생략한다', () => {
    const encoded = navigation.encode({
        element: 'pcp',
        date: '2026-07-20',
        baseTime: '08',
        forecastHour: 7,
        projection: 'EPSG:4326',
        layers: { heat: true, stream: false, iso: true },
        air: 'off',
        cctv: false,
        hazards: { typhoon: true, lightning: false, lightningMinutes: 15 }
    });

    assert.equal(encoded,
        'e=pcp&h=10m&d=2026-07-20&t=08&f=7&proj=EPSG%3A4326&v=heat%2Ciso&haz=typhoon');
});

test('빈 해시는 복원할 탐색 상태가 아니다', () => {
    assert.equal(navigation.decode('', context), null);
    assert.equal(navigation.decode('#', context), null);
});
