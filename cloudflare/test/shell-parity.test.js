import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expandJspShell } from '../jsp-shell.mjs';

const publicShell = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const springShell = expandJspShell(fileURLToPath(
    new URL('../../src/main/webapp/WEB-INF/jsp/weather-grid.jsp', import.meta.url)));
const weatherGridScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid.js', import.meta.url)), 'utf8');
const stationChartsScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/station-charts.js', import.meta.url)), 'utf8');
const weatherGridDataScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-data.js', import.meta.url)), 'utf8');
const weatherGridRasterScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-raster.js', import.meta.url)), 'utf8');
const weatherGridWindScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-wind.js', import.meta.url)), 'utf8');
const weatherGridLocationScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-location.js', import.meta.url)), 'utf8');
const weatherGridPaletteScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-palette-state.js', import.meta.url)), 'utf8');
const weatherGridBasemapScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-basemap-state.js', import.meta.url)), 'utf8');
const weatherGridKakaoScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-kakao.js', import.meta.url)), 'utf8');
const weatherGridMapBootstrapScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-map-bootstrap.js', import.meta.url)), 'utf8');
const weatherGridSearchScript = readFileSync(fileURLToPath(
    new URL('../../src/main/resources/static/js/weather-grid-search.js', import.meta.url)), 'utf8');

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
        assert.match(source, /<div\s+id="map"[^>]+role="region"[^>]+tabindex="0"[^>]+aria-labelledby="map_workspace_title"/i);
        assert.match(source, /<section[^>]+id="coordinate_search_dialog"[^>]+aria-labelledby="coordinate_search_title"/i);
        assert.match(source, /<form\s+id="coordinate_search_form">[\s\S]*?<button\s+type="submit"\s+class="coordinate_lookup">/i);
        assert.match(source, /<input\s+type="number"[^>]+id="coordinate_latitude"[^>]+step="any"[^>]+required/i);
        assert.match(source, /<input\s+type="number"[^>]+id="coordinate_longitude"[^>]+step="any"[^>]+required/i);
        assert.doesNotMatch(source, /\son(?:click|change|input|submit|keydown|keyup)\s*=/i);
    });
    assert.match(weatherGridSearchScript, /coordinateForm\.addEventListener\('submit'/);
    assert.match(weatherGridSearchScript, /event\.key === 'Enter' && !event\.isComposing/);
    assert.doesNotMatch(weatherGridSearchScript, /\bkeypress\b|event\.which/);
});

test('두 셸은 명명된 랜드마크·폼 그룹·대화상자 계약을 공유한다', () => {
    [springShell, publicShell].forEach((source) => {
        assert.match(source,
            /<main\s+class="map_workspace"\s+aria-labelledby="map_workspace_title">[\s\S]*?<h2\s+class="sr-only"\s+id="map_workspace_title">한국 기상 격자 지도<\/h2>/i);
        assert.match(source,
            /<form\s+id="station_search_form"\s+role="search"\s+aria-label="대표 지역 검색">[\s\S]*?<button\s+type="submit"[^>]+id="station_search_button"/i);
        const stationSearch = normalizedFragment(source,
            /<form\s+id="station_search_form"[\s\S]*?<\/form>/i, '대표 지역 검색 form');
        assert.doesNotMatch(stationSearch, /coordinate_search_form/);

        assert.match(source,
            /<aside\s+class="legend_stack"\s+aria-labelledby="legend_stack_title">[\s\S]*?<h2\s+class="sr-only"\s+id="legend_stack_title">지도 범례<\/h2>/i);
        assert.match(source,
            /<section\s+class="timeline"\s+aria-labelledby="timeline_title">[\s\S]*?<h2\s+class="sr-only"\s+id="timeline_title">예보 시간 탐색<\/h2>/i);
        assert.match(source,
            /<fieldset\s+class="field metric_field"[^>]*>[\s\S]*?<legend\s+class="flabel"\s+id="field_element_label">날씨 정보<\/legend>/i);
        assert.match(source,
            /<fieldset\s+class="field"[^>]*>[\s\S]*?<legend\s+class="flabel"\s+id="map_background_label">배경 지도<\/legend>/i);
        assert.match(source,
            /<section\s+class="station_modal"[^>]+role="dialog"[^>]+aria-labelledby="station_chart_title"/i);
        assert.match(source,
            /<section\s+id="view3d"[^>]+role="dialog"[^>]+aria-labelledby="view3d_dialog_title"/i);

        ['coordinate_popup', 'air_popup', 'cctv_popup', 'hazard_popup', 'warning_panel']
            .forEach((className) => {
                assert.doesNotMatch(source,
                    new RegExp(`<[^>]+class="${className}"[^>]+role="region"`, 'i'));
            });
    });
});

test('격자 조회는 순수 상태 뒤의 fetch 어댑터로 로드하고 jQuery AJAX에 의존하지 않는다', () => {
    [springShell, publicShell].forEach((source) => {
        const stateIndex = source.indexOf('/static/js/weather-grid-data-state.js');
        const adapterIndex = source.indexOf('/static/js/weather-grid-data.js');
        const sessionIndex = source.indexOf('/static/js/weather-grid-session.js');
        assert.ok(stateIndex >= 0 && stateIndex < adapterIndex);
        assert.ok(adapterIndex < sessionIndex);
    });
    assert.match(weatherGridDataScript, /window\.fetch\(/);
    assert.match(weatherGridDataScript, /new AbortController\(\)/);
    assert.doesNotMatch(weatherGridDataScript, /\$\.ajax\s*\(/);
    assert.doesNotMatch(weatherGridScript, /\$\.ajax\s*\(/);
    assert.match(weatherGridScript, /addEventListener\('DOMContentLoaded', initializeWeatherGrid/);
});

test('래스터 표본 상태와 OpenLayers 어댑터는 조회 어댑터보다 먼저 독립 로드된다', () => {
    [springShell, publicShell].forEach((source) => {
        const stateIndex = source.indexOf('/static/js/weather-grid-raster-state.js');
        const adapterIndex = source.indexOf('/static/js/weather-grid-raster.js');
        const dataIndex = source.indexOf('/static/js/weather-grid-data.js');
        assert.ok(stateIndex >= 0 && stateIndex < adapterIndex);
        assert.ok(adapterIndex < dataIndex);
    });
    assert.match(weatherGridRasterScript, /State\.samplePlan\(/);
    assert.match(weatherGridRasterScript, /new window\.ol\.source\.ImageCanvas\(/);
    assert.match(weatherGridRasterScript, /window\.getGridRenderLookupCacheStats = diagnostics/);
    assert.doesNotMatch(weatherGridScript, /renderWeatherRaster|gridRenderLookupCache|new ol\.source\.ImageCanvas/);
});

test('풍장 상태와 Canvas 어댑터는 레이어·조회 소비자보다 먼저 독립 로드된다', () => {
    [springShell, publicShell].forEach((source) => {
        const stateIndex = source.indexOf('/static/js/weather-grid-wind-state.js');
        const adapterIndex = source.indexOf('/static/js/weather-grid-wind.js');
        const layersIndex = source.indexOf('/static/js/weather-grid-layers.js');
        const dataIndex = source.indexOf('/static/js/weather-grid-data.js');
        assert.ok(stateIndex >= 0 && stateIndex < adapterIndex);
        assert.ok(adapterIndex < layersIndex);
        assert.ok(adapterIndex < dataIndex);
    });
    assert.match(weatherGridWindScript, /State\.transition\(/);
    assert.match(weatherGridWindScript, /new window\.Windy\(/);
    assert.match(weatherGridWindScript, /window\.getWindDiagnostics = diagnostics/);
    assert.doesNotMatch(weatherGridScript,
        /windRenderer|createWindRenderer|restartWindParticles|clearWindStreamlines|MAX_STREAM_CANVAS_PIXELS/);
});

test('지점·좌표 요청 상태와 fetch 어댑터는 레이어·격자 조회보다 먼저 독립 로드된다', () => {
    [springShell, publicShell].forEach((source) => {
        const stateIndex = source.indexOf('/static/js/weather-grid-location-state.js');
        const adapterIndex = source.indexOf('/static/js/weather-grid-location.js');
        const layersIndex = source.indexOf('/static/js/weather-grid-layers.js');
        const dataIndex = source.indexOf('/static/js/weather-grid-data.js');
        assert.ok(stateIndex >= 0 && stateIndex < adapterIndex);
        assert.ok(adapterIndex < layersIndex);
        assert.ok(adapterIndex < dataIndex);
    });
    assert.match(weatherGridLocationScript, /State\.timelineRequest\(/);
    assert.match(weatherGridLocationScript, /new AbortController\(\)/);
    assert.match(weatherGridLocationScript, /window\.fetch\(/);
    assert.doesNotMatch(weatherGridScript,
        /stnQuerySeq|pointQuerySeq|stnRequestController|pointRequestController|\/api\/weather\/(?:timeseries|coverage)/);
});

test('팔레트와 기본 지도 생성은 핵심 셸보다 먼저 독립 상태·어댑터로 로드된다', () => {
    [springShell, publicShell].forEach((source) => {
        const paletteIndex = source.indexOf('/static/js/weather-grid-palette-state.js');
        const stateIndex = source.indexOf('/static/js/weather-grid-basemap-state.js');
        const kakaoStateIndex = source.indexOf('/static/js/weather-grid-kakao-state.js');
        const kakaoAdapterIndex = source.indexOf('/static/js/weather-grid-kakao.js');
        const bootstrapIndex = source.indexOf('/static/js/weather-grid-map-bootstrap.js');
        const coreIndex = source.indexOf('/static/js/weather-grid.js');
        assert.ok(paletteIndex >= 0 && paletteIndex < bootstrapIndex);
        assert.ok(stateIndex >= 0 && stateIndex < bootstrapIndex);
        assert.ok(kakaoStateIndex >= 0 && kakaoStateIndex < kakaoAdapterIndex);
        assert.ok(kakaoAdapterIndex < bootstrapIndex);
        assert.ok(bootstrapIndex < coreIndex);
        assert.match(source, /id="kakao_basemap"[^>]+aria-hidden="true"[^>]+hidden/);
    });
    assert.match(weatherGridPaletteScript, /function colorFor\(/);
    assert.match(weatherGridBasemapScript, /function pixelRatio\(/);
    assert.match(weatherGridKakaoScript, /https:\/\/dapi\.kakao\.com\/v2\/maps\/sdk\.js/);
    assert.doesNotMatch(weatherGridKakaoScript, /map\d?\.daumcdn\.net\/map_2d/);
    assert.match(weatherGridMapBootstrapScript, /new ol\.Map\(/);
    assert.match(weatherGridMapBootstrapScript, /WeatherGridGeodata\.loadInitial\(\)/);
    assert.match(weatherGridScript, /paletteState\.colorFor\(/);
    assert.doesNotMatch(weatherGridScript,
        /new ol\.Map\(|cappedMapPixelRatio|WeatherGridGeodata\.loadInitial|stationSearchAnchors|displayBaseMap/);
});

test('대표 지역 검색은 위치 조회 뒤의 순수 검색 상태와 DOM 어댑터가 소유한다', () => {
    [springShell, publicShell].forEach((source) => {
        const locationIndex = source.indexOf('/static/js/weather-grid-location.js');
        const stateIndex = source.indexOf('/static/js/weather-grid-search-state.js');
        const adapterIndex = source.indexOf('/static/js/weather-grid-search.js');
        const layersIndex = source.indexOf('/static/js/weather-grid-layers.js');
        assert.ok(locationIndex >= 0 && locationIndex < stateIndex);
        assert.ok(stateIndex < adapterIndex);
        assert.ok(adapterIndex < layersIndex);
    });
    assert.match(weatherGridSearchScript, /State\.suggestions\(/);
    assert.match(weatherGridSearchScript, /MapRuntime\.stationAnchors\(\)/);
    assert.match(weatherGridSearchScript, /stationForm\.addEventListener\('submit'/);
    assert.match(weatherGridSearchScript, /Location\.submitCoordinate\(\)/);
    assert.doesNotMatch(weatherGridScript,
        /normalizedRegionName|stationSuggestionList|coordinateSearchToggle|coordinate_search_form/);
});

test('주요 지점 토글은 종류별 벡터 표식과 지도 키보드 선택을 설명한다', () => {
    [springShell, publicShell].forEach((source) => {
        assert.match(source, /id="infra_bridge"[^>]+data-infrastructure="bridge"[^>]+aria-pressed="false"/);
        assert.match(source, /id="infra_airport"[^>]+data-infrastructure="airport"[^>]+aria-pressed="false"/);
        assert.match(source, /id="infra_port"[^>]+data-infrastructure="port"[^>]+aria-pressed="false"/);
        assert.match(source, /id="map_keyboard_help"[^>]*>[^<]*표시한 주요 지점/);
        assert.doesNotMatch(source, /🌉|✈|⚓/u);
    });
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
