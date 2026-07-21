import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicShell = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const springShell = readFileSync(fileURLToPath(
    new URL('../../src/main/webapp/WEB-INF/jsp/weather-grid.jsp', import.meta.url)), 'utf8');
const weatherGridScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid.js', import.meta.url)), 'utf8');
const stationChartsScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/station-charts.js', import.meta.url)), 'utf8');

function matches(source, pattern, label) {
    const values = [];
    for (const match of source.matchAll(pattern)) values.push(match[1]);
    assert.ok(values.length > 0, `${label}을(를) 찾지 못했습니다.`);
    return values;
}

function normalizedFragment(source, pattern, label) {
    const match = source.match(pattern);
    assert.ok(match, `${label}을(를) 찾지 못했습니다.`);
    return match[0].replace(/\s+/g, ' ').trim();
}

test('Spring JSP와 Cloudflare 정적 셸의 DOM ID 및 정적 자산 버전이 같다', () => {
    const ids = (source) => matches(source, /\bid="([^"]+)"/g, 'DOM ID');
    const staticAssets = (source) => matches(source,
        /(?:src|href)="[^"]*\/static\/([^"]+)"/g, '정적 자산');

    assert.deepEqual(ids(springShell), ids(publicShell));
    assert.deepEqual(staticAssets(springShell), staticAssets(publicShell));
});

test('지점 차트는 내장 SVG 렌더러만 사용한다', () => {
    assert.match(stationChartsScript, /data-chart-renderer[^\n]+native-svg/);
    assert.doesNotMatch(stationChartsScript, /loadScript\s*\(/);
});

test('두 셸은 지원되는 고도 선택 하나만 노출한다', () => {
    const policy = (source) => ({
        heightSelect: normalizedFragment(source, /<select\s+class="height"\s+id="height"[\s\S]*?<\/select>/i, '바람 높이 select'),
        exploreModes: matches(source, /data-explore-mode="([^"]+)"/g, '빠른 보기 모드')
    });

    [springShell, publicShell].forEach((source) => {
        const heightSelect = normalizedFragment(source,
            /<select\s+class="height"\s+id="height"[\s\S]*?<\/select>/i, '바람 높이 select');
        assert.equal((heightSelect.match(/<option\b/g) || []).length, 1);
        assert.match(heightSelect, /<option\s+value="10m">10m<\/option>/);
    });
    assert.deepEqual(policy(springShell), policy(publicShell));
});

test('두 셸은 브라우저 날짜 입력을 사용한다', () => {
    [springShell, publicShell].forEach((source) => {
        const dateInput = normalizedFragment(source,
            /<input[^>]+id="forecast_date"[^>]*>/i, '발표 날짜 input');
        assert.match(dateInput, /type="date"/);
    });
});

test('두 셸은 대표 지역·일사강도·AirKorea 자료 성격을 같은 문구로 안내한다', () => {
    [springShell, publicShell].forEach((source) => {
        assert.match(source, /<button[^>]+id="weather_stations"[^>]*>[\s\S]*?대표 지역 표시<\/button>/);
        assert.doesNotMatch(source, /예보 지점 표시/);
        assert.match(source, /data-val="swdn"[^>]*>[\s\S]*?<strong>일사강도<\/strong><small>W\/㎡<\/small>/);
        assert.doesNotMatch(source, />일사량</);
        assert.equal((source.match(/실시간 측정값은 미확정 자료이며 통신·장비 상태에 따라 오류가 있을 수 있습니다\./g) || []).length, 2,
            '대기질 범례와 측정소 상세에 미확정 자료 고지가 모두 필요합니다.');
    });
});

test('두 셸은 확대를 막지 않고 키보드용 문서 구조와 네이티브 좌표 검색을 제공한다', () => {
    [springShell, publicShell].forEach((source) => {
        const viewport = normalizedFragment(source,
            /<meta\s+name="viewport"[^>]*>/i, 'viewport meta');
        assert.doesNotMatch(viewport, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?/i);
        assert.match(source, /<h1\b[^>]*>[^<]+<\/h1>/i);
        assert.match(source, /<a\s+class="skip-link"\s+href="#map">/i);
        assert.match(source, /<div\s+id="map"[^>]+role="region"[^>]+tabindex="0"[^>]+aria-label=/i);
        assert.match(source, /<div[^>]+id="coordinate_search_dialog"[^>]+aria-labelledby="coordinate_search_title"/i);
        assert.match(source, /<form\s+id="coordinate_search_form">[\s\S]*?<button\s+type="submit"\s+class="coordinate_lookup">/i);
        assert.match(source, /<input\s+type="number"[^>]+id="coordinate_latitude"[^>]+step="any"[^>]+required/i);
        assert.match(source, /<input\s+type="number"[^>]+id="coordinate_longitude"[^>]+step="any"[^>]+required/i);
        assert.doesNotMatch(source, /\son(?:click|change|input|submit|keydown|keyup)\s*=/i);
    });
    assert.match(weatherGridScript, /coordinate_search_form'\)\.addEventListener\('submit'/);
    assert.match(weatherGridScript, /event\.key === 'Enter' && !event\.isComposing/);
    assert.doesNotMatch(weatherGridScript, /\bkeypress\b|event\.which/);
});

test('두 셸의 정적 폼 컨트롤과 이미지는 이름 및 크기 정보를 가진다', () => {
    [springShell, publicShell].forEach((source) => {
        for (const match of source.matchAll(/<input\b([^>]*)>/gi)) {
            const attributes = match[1];
            if (/\btype="hidden"/i.test(attributes)) continue;
            const id = attributes.match(/\bid="([^"]+)"/i)?.[1];
            assert.ok(id, `input에 id가 필요합니다: ${match[0]}`);
            assert.match(attributes, /\bname="[^"]+"/i, `${id} input에 name이 필요합니다.`);
            const hasAriaLabel = /\baria-label="[^"]+"/i.test(attributes);
            const hasLabel = new RegExp(`<label\\b[^>]*\\bfor="${id}"`, 'i').test(source);
            assert.ok(hasAriaLabel || hasLabel, `${id} input에 연결된 label이 필요합니다.`);
        }

        for (const match of source.matchAll(/<img\b([^>]*)>/gi)) {
            assert.match(match[1], /\balt="[^"]*"/i);
            assert.match(match[1], /\bwidth="\d+"/i);
            assert.match(match[1], /\bheight="\d+"/i);
        }
        for (const match of source.matchAll(/<button\b([^>]*)>/gi)) {
            assert.match(match[1], /\btype="(?:button|submit|reset)"/i);
        }
    });
});

test('두 셸의 토글 및 보조 텍스트 ARIA 상태가 실제 초기 상태와 일치한다', () => {
    [springShell, publicShell].forEach((source) => {
        for (const match of source.matchAll(/<button\b([^>]*)>/gi)) {
            if (/\baria-expanded="true"/i.test(match[1])) assert.doesNotMatch(match[1], /\baria-label="[^"]*펼치기/i);
        }
        assert.match(source, /class="map_status_panel"\s+role="status"\s+aria-label="현재 지도 정보"/i);
        assert.match(source, /id="air_popup_gauges"\s+role="group"\s+aria-label=/i);
        assert.match(source, /id="view3d_scale"\s+role="group"\s+aria-label=/i);
        assert.match(source, /aria-hidden="true">㎍\/㎥<\/span><span\s+class="sr-only">마이크로그램 퍼 세제곱미터<\/span>/i);
        assert.match(source, /id="theme_toggle"[^>]+aria-label="라이트 테마로 전환"[^>]+aria-pressed="false"/i);
        assert.match(source, /<aside\s+class="dock collapsed"[^>]+aria-hidden="true"\s+inert>/i);
        assert.match(source, /class="station_modal"[^>]+aria-hidden="true"[^>]+tabindex="-1"/i);
    });
});
