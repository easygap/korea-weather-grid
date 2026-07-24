/**
 * BORA 등치선(isoline) 오버레이
 *
 * 마지막 /api/weather/grid 응답(window.lastGridResult)에서 마칭 스퀘어로 등치선을
 * 추출해 OpenLayers 벡터 레이어로 그린다. 값 라벨은 선을 따라 반복 배치(기상도 관례).
 *
 *   · 레벨 = 범례와 동일한 구간 경계(바람/기온 고정 구간, 일사 월 스케일)
 *   · 정점 변환: 격자(소수) → 공식 LCC 역변환 → 위경도 → 현재 도법
 *     — 히트맵과 같은 변환 사슬이라 도법 3종 모두에서 좌표 정합이 유지된다
 *   · 유효성: 모든 요소에서 유한한 v>-900 (실제 0 포함, 통계·범례와 동일 규칙)
 *
 * weather-grid.js의 렌더링 계약과 weather-grid-layers.js의 표현 상태가 이 오버레이를 공유한다.
 */
(function () {
    'use strict';

    var renderedResult = null;
    var renderedProjection = null;
    var renderedElement = null;
    var renderedMonth = null;

    /* 기상청 공개 DFS 투영 사양에 따른 등치선 정점 역투영. */
    var RE = 6371.00877, GRID = 5.0, DEGRAD = Math.PI / 180.0, RADDEG = 180.0 / Math.PI;
    var SLAT1 = 30.0 * DEGRAD, SLAT2 = 60.0 * DEGRAD;
    var OLON = 126.0 * DEGRAD, OLAT = 38.0 * DEGRAD, XO = 43, YO = 136;
    var re = RE / GRID;
    var sn = Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
    sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(sn);
    var sf = Math.pow(Math.tan(Math.PI * 0.25 + SLAT1 * 0.5), sn) * Math.cos(SLAT1) / sn;
    var ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + OLAT * 0.5), sn);

    function gridToLatLon(nx, ny) {
        var xn = nx - XO, yn = ro - ny + YO;
        var ra = Math.sqrt(xn * xn + yn * yn);
        if (sn < 0) ra = -ra;
        var alat = Math.pow(re * sf / ra, 1.0 / sn);
        alat = 2.0 * Math.atan(alat) - Math.PI * 0.5;
        var theta;
        if (Math.abs(xn) <= 0.0) theta = 0.0;
        else if (Math.abs(yn) <= 0.0) { theta = Math.PI * 0.5; if (xn < 0) theta = -theta; }
        else theta = Math.atan2(xn, yn);
        var alon = theta / sn + OLON;
        return [alat * RADDEG, alon * RADDEG];
    }

    /* ---------- 마칭 스퀘어 ---------- */

    function interp(a, b, lv) {
        var t = (lv - a) / (b - a);
        return t < 0 ? 0 : (t > 1 ? 1 : t);
    }

    /**
     * 한 레벨의 등치선 세그먼트 추출 → 폴리라인으로 연결
     * get(i, j): 열 i(0..nx-1), 남쪽부터 행 j(0..ny-1)의 값 (무효는 NaN)
     */
    function isolinesForLevel(get, nx, ny, lv) {
        var segs = [];
        for (var j = 0; j < ny - 1; j++) {
            for (var i = 0; i < nx - 1; i++) {
                var v00 = get(i, j), v10 = get(i + 1, j), v11 = get(i + 1, j + 1), v01 = get(i, j + 1);
                if (isNaN(v00) || isNaN(v10) || isNaN(v11) || isNaN(v01)) continue;
                var idx = (v00 >= lv ? 1 : 0) | (v10 >= lv ? 2 : 0) | (v11 >= lv ? 4 : 0) | (v01 >= lv ? 8 : 0);
                if (idx === 0 || idx === 15) continue;
                var b = [i + interp(v00, v10, lv), j];          // 아래 변
                var r = [i + 1, j + interp(v10, v11, lv)];      // 오른 변
                var t = [i + interp(v01, v11, lv), j + 1];      // 위 변
                var l = [i, j + interp(v00, v01, lv)];          // 왼 변
                switch (idx) {
                    case 1: case 14: segs.push([l, b]); break;
                    case 2: case 13: segs.push([b, r]); break;
                    case 3: case 12: segs.push([l, r]); break;
                    case 4: case 11: segs.push([r, t]); break;
                    case 6: case 9: segs.push([b, t]); break;
                    case 7: case 8: segs.push([l, t]); break;
                    case 5: segs.push([l, t], [b, r]); break;   // 안장점
                    case 10: segs.push([l, b], [r, t]); break;  // 안장점
                }
            }
        }
        return chainSegments(segs);
    }

    /** 세그먼트들을 끝점 공유 기준으로 이어 붙여 폴리라인 목록으로 */
    function chainSegments(segs) {
        var key = function (p) { return p[0].toFixed(3) + ',' + p[1].toFixed(3); };
        var adj = {};    // 끝점 → 미사용 세그먼트 인덱스 목록
        var used = new Array(segs.length);
        segs.forEach(function (s, si) {
            [key(s[0]), key(s[1])].forEach(function (k) {
                (adj[k] || (adj[k] = [])).push(si);
            });
        });
        var take = function (k, cur) {
            var list = adj[k];
            if (!list) return -1;
            while (list.length) {
                var si = list[list.length - 1];
                if (used[si] || si === cur) { list.pop(); continue; }
                return si;
            }
            return -1;
        };
        var lines = [];
        for (var s0 = 0; s0 < segs.length; s0++) {
            if (used[s0]) continue;
            used[s0] = true;
            var line = [segs[s0][0], segs[s0][1]];
            // 앞뒤 양방향으로 연장
            for (var dirn = 0; dirn < 2; dirn++) {
                for (;;) {
                    var end = dirn === 0 ? line[line.length - 1] : line[0];
                    var si = take(key(end), -1);
                    if (si < 0) break;
                    used[si] = true;
                    var seg = segs[si];
                    var next = key(seg[0]) === key(end) ? seg[1] : seg[0];
                    dirn === 0 ? line.push(next) : line.unshift(next);
                }
            }
            if (line.length >= 3) lines.push(line);    // 한 칸짜리 부스러기는 제외
        }
        return lines;
    }

    /* ---------- 레벨(등치선 값) ---------- */

    // 연속형 요소만 범례 구간 경계에서 선을 만든다.
    function levelsFor(element) {
        if (element === 'wdws') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
        if (element === 'tmp') return [-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35];
        if (element === 'pcp') return [1, 3, 15, 30, 50];
        if (element === 'sno') return [1, 3, 5, 10, 20];
        if (element === 'reh') return [20, 40, 60, 80, 90];
        if (element === 'wav') return [0.5, 1, 2, 3, 4];
        if (element === 'pty' || element === 'sky') return [];
        var m = (typeof month !== 'undefined' && month) ? month : '07';
        var ranges = (typeof monthlySolarThresholds !== 'undefined' && (monthlySolarThresholds[m] || monthlySolarThresholds['07'])) || [];
        var lv = ranges.filter(function (v) { return v > 0; });
        while (lv.length > 8) lv = lv.filter(function (_, i) { return i % 2 === 0; });
        return lv;
    }

    /* ---------- 등치선 전용 스무딩 ---------- */

    /** 3×3 이웃 평균 N회 — 셀 단위 노이즈를 눌러 기상도처럼 매끈한 선을 얻는다.
     *  등치선 계산용 복사본에만 적용하므로 히트맵·툴팁 값은 그대로다. */
    function smoothField(get, nx, ny, passes) {
        var cur = new Array(nx * ny);
        for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) cur[j * nx + i] = get(i, j);
        for (var ps = 0; ps < passes; ps++) {
            var nxt = cur.slice();
            for (var j2 = 0; j2 < ny; j2++) {
                for (var i2 = 0; i2 < nx; i2++) {
                    if (isNaN(cur[j2 * nx + i2])) continue;    // 결측(육지 밖 등)은 경계 보존
                    var s = 0, n = 0;
                    for (var dj = -1; dj <= 1; dj++) {
                        for (var di = -1; di <= 1; di++) {
                            var ii = i2 + di, jj = j2 + dj;
                            if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
                            var v = cur[jj * nx + ii];
                            if (!isNaN(v)) { s += v; n++; }
                        }
                    }
                    if (n) nxt[j2 * nx + i2] = s / n;
                }
            }
            cur = nxt;
        }
        return function (i, j) { return cur[j * nx + i]; };
    }

    /** Chaikin 코너 컷 1회 — 마칭 스퀘어의 계단을 완만한 곡선으로 */
    function chaikin(line) {
        if (line.length < 3) return line;
        var out = [line[0]];
        for (var i = 0; i < line.length - 1; i++) {
            var a = line[i], b = line[i + 1];
            out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
            out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        out.push(line[line.length - 1]);
        return out;
    }

    /* ---------- OpenLayers 레이어 ---------- */

    var isoLayer = null;
    var isoStyleMode = 'dark';
    var isoStyleCache = new Map();
    var ISO_STYLE_CACHE_LIMIT = 32;
    var isoStylePrimitives = {
        light: {
            stroke: new ol.style.Stroke({ color: 'rgba(30,41,59,0.82)', width: 1.3 }),
            fill: new ol.style.Fill({ color: 'rgba(30,41,59,0.82)' }),
            halo: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 3 })
        },
        dark: {
            stroke: new ol.style.Stroke({ color: 'rgba(165,205,255,0.92)', width: 1.3 }),
            fill: new ol.style.Fill({ color: 'rgba(165,205,255,0.92)' }),
            halo: new ol.style.Stroke({ color: 'rgba(5,10,20,0.85)', width: 3 })
        }
    };

    /** 거리지도는 테마와 무관하게 밝으므로 어두운 잉크를 사용한다. */
    function resolveIsoStyleMode() {
        return document.documentElement.getAttribute('data-theme') === 'light'
            || !!document.querySelector('#basemap_streets.is-selected-basemap') ? 'light' : 'dark';
    }

    function refreshIsoStyleMode() {
        isoStyleMode = resolveIsoStyleMode();
        if (isoLayer) isoLayer.changed();
    }

    function ensureLayer() {
        if (isoLayer) return isoLayer;
        isoLayer = new ol.layer.Vector({
            title: 'isoline',
            source: new ol.source.Vector(),
            declutter: true,
            zIndex: 85,    // 히트맵(조회 후 80으로 재설정됨) 위, 지점 마커(100) 아래
            visible: false,
            style: styleFn
        });
        weatherMap.addLayer(isoLayer);
        isoStyleMode = resolveIsoStyleMode();
        // 테마 전환 시 선·라벨 색 갱신
        new MutationObserver(refreshIsoStyleMode)
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        // 배경지도 선택은 벡터 데이터 로드 뒤 비동기로 바뀔 수도 있어 class 변화를 직접 감시한다.
        var sel = document.getElementById('basemap_choices');
        if (sel) new MutationObserver(refreshIsoStyleMode)
            .observe(sel, { subtree: true, attributes: true, attributeFilter: ['class'] });
        return isoLayer;
    }

    function styleFn(feature) {
        var lv = feature.get('level');
        var label = String(Math.round(lv * 10) / 10);
        var key = isoStyleMode + ':' + label;
        var cached = isoStyleCache.get(key);
        if (cached) return cached;

        // 레벨은 범례 경계에서만 생성되지만 외부 피처가 추가돼도 캐시는 유한하게 유지한다.
        if (isoStyleCache.size >= ISO_STYLE_CACHE_LIMIT) isoStyleCache.clear();
        var primitives = isoStylePrimitives[isoStyleMode];
        cached = new ol.style.Style({
            stroke: primitives.stroke,
            text: new ol.style.Text({
                text: label,
                font: '700 11px system-ui, sans-serif',
                placement: 'line',
                repeat: 320,
                fill: primitives.fill,
                stroke: primitives.halo,
                overflow: false
            })
        });
        isoStyleCache.set(key, cached);
        return cached;
    }

    /** lastGridResult 로부터 등치선 피처 재생성 (도법·요소·시각 변경 시 호출) */
    function rebuild() {
        var r = window.lastGridResult;
        var layer = ensureLayer();
        var src = layer.getSource();
        var element = window.lastGridElement || 'wdws';
        var viewProj = window.WEATHER_GRID_VIEW_PROJ || 'KMA_GRID_LCC';
        var currentMonth = element === 'swdn' && typeof month !== 'undefined' ? month : null;
        if (renderedResult === r && renderedProjection === viewProj
                && renderedElement === element && renderedMonth === currentMonth) return;

        src.clear(true);
        renderedResult = r;
        renderedProjection = viewProj;
        renderedElement = element;
        renderedMonth = currentMonth;
        if (!r || !r.data) return;

        var step = r.step || 1;
        var raw = function (i, jS) {
            var v = r.data[(r.ny - 1 - jS) * r.nx + i];
            return window.WEATHER_GRID_WEATHER_VALUE_VALID
                ? (window.WEATHER_GRID_WEATHER_VALUE_VALID(element, v) ? v : NaN)
                : (Number.isFinite(v) && v > -900 && v < 9000 ? v : NaN);
        };
        var get = smoothField(raw, r.nx, r.ny, 2);
        var feats = [];
        levelsFor(element).forEach(function (lv) {
            isolinesForLevel(get, r.nx, r.ny, lv).forEach(function (line) {
                var coords = chaikin(line).map(function (p) {
                    var gx = r.nxMin + p[0] * step;
                    var gy = r.nyMin + p[1] * step;
                    var ll = gridToLatLon(gx, gy);
                    return ol.proj.transform([ll[1], ll[0]], 'EPSG:4326', viewProj);
                });
                var f = new ol.Feature(new ol.geom.LineString(coords));
                f.set('level', lv);
                feats.push(f);
            });
        });
        src.addFeatures(feats);
    }

    window.WEATHER_GRID_ISO = {
        show: function () {
            var element = window.lastGridElement || (document.getElementById('element') || {}).value || 'wdws';
            var meta = window.WEATHER_GRID_WEATHER_ELEMENTS && window.WEATHER_GRID_WEATHER_ELEMENTS[element];
            if (meta && meta.isoline === false) {
                if (isoLayer) isoLayer.setVisible(false);
                return;
            }
            rebuild();
            ensureLayer().setVisible(true);
        },
        hide: function () { if (isoLayer) isoLayer.setVisible(false); },
        /** 새 데이터 도착·도법 전환 후 — 표시 중이면 다시 계산 */
        refresh: function () {
            if (isoLayer && isoLayer.getVisible()) rebuild();
        }
    };
})();
