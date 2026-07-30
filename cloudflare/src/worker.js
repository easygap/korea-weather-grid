/**
 * BORA — Cloudflare Worker 백엔드
 *
 * Spring 백엔드와 동일한 표출 API 계약을 제공한다.
 * 응답 형태(JSON 키·값 규칙)는 두 런타임에서 일관되어야 하며,
 * 로컬 parity 스크립트로 두 서버의 응답을 대조 검증한다.
 *
 *   GET  /api/weather/grid    분포도 격자 + 통계 + 스트림라인
 *                        (wdws | tmp | pcp | sno | pty | reh | sky | wav | swdn, 10m)
 *   GET  /api/weather/timeseries     지점 49시간 시계열
 *   GET  /api/weather/point-forecast 지점 단기예보 상세(+0~48h)
 *   GET  /api/environment/air-quality  AirKorea PM10·PM2.5 측정소
 *   GET  /api/traffic/cameras        국가교통정보센터(ITS) 실시간 CCTV
 *   GET  /api/hazards/typhoons     최신 태풍 분석·예보
 *   GET  /api/hazards/lightning   최근 15·30·60분 낙뢰관측
 *   GET  /api/hazards/warnings    현재 기상특보
 *   GET  /api/weather/coverage      한반도 bbox 검사
 *   GET  /api/weather/grid/stats  격자 통계만
 *   GET  / , /    정적 index.html (Workers Assets)
 *
 * 캐시: Cache API(caches.default) — 같은 발표·발효시각 원문 재조회는 업스트림 0콜.
 * 시크릿: env.KMA_API_AUTH_KEY, env.DATA_GO_KR_SERVICE_KEY(공공데이터포털 Decoding 키),
 *         env.ITS_API_KEY
 */

const KMA_BASE = 'https://apihub.kma.go.kr';
const DATA_GO_BASE = 'https://apis.data.go.kr';
const ITS_BASE = 'https://openapi.its.go.kr:9443';
const KMA = {
    MAX_DFS_BYTES: 2 * 1024 * 1024,
    MAX_KIM_BYTES: 1024 * 1024,
    MAX_KIM_POINT_BYTES: 64 * 1024,
    MAX_STATION_BYTES: 2 * 1024 * 1024,
    UPSTREAM_TIMEOUT_MS: 15000
};
const MAX_WIND_COMPONENT = 150;
const MAX_WIND_SPEED = Math.SQRT2 * MAX_WIND_COMPONENT;
const GRID_NO_DATA = -999;
const KIM_NO_DATA = GRID_NO_DATA;
const isValidWindComponent = (value) => Number.isFinite(value) && Math.abs(value) <= MAX_WIND_COMPONENT;
const isValidWindSpeed = (value) => Number.isFinite(value) && value >= 0 && value <= MAX_WIND_SPEED;
// KMA 텍스트 격자는 10진수/과학 표기 토큰으로 셀 순서를 표현한다. 1e309처럼
// JS에서 Infinity가 되는 유효 숫자 문법도 셀 하나로 소비해 Java 파서와 정렬을 맞춘다.
const GRID_NUMERIC_TOKEN = /^[+-]?(?:NaN|Infinity|(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))$/;
const isGridNumericToken = (token) => GRID_NUMERIC_TOKEN.test(token);

function logUpstreamFailure(provider, dataset, reason, details = {}) {
    console.warn(JSON.stringify({
        event: 'upstream_failed',
        provider,
        dataset,
        reason,
        ...details
    }));
}

function classifyKmaGridFailure(text) {
    if (typeof text !== 'string') return 'no_response';
    if (text.includes('"status" : 403') || text.includes('활용신청')) return 'not_authorized';
    if (text.includes('# ERROR') && /file is not exist/i.test(text)) return 'not_published';
    if (text.includes('# ERROR')) return 'upstream_error';
    return 'invalid_schema';
}

function kmaUrl(path, params) {
    const url = new URL(path, KMA_BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url.toString();
}

/* ==================== DFS(단기예보) 격자 ==================== */

const DFS = { NX: 149, NY: 253, MISSING: -99.0 };

/** 격자자료 텍스트 → [ny][nx] (yi=0 남쪽). 실패 시 null — Spring DfsGridParser와 동일 규칙 */
function parseDfsGrid(text, missingAs = 0.0) {
    if (!text) return null;
    const total = DFS.NX * DFS.NY;
    const values = new Float64Array(total);
    let count = 0;
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        for (const tok of t.split(/[\s,]+/)) {
            if (!tok) continue;
            if (!isGridNumericToken(tok)) continue;
            const v = Number(tok);
            if (count >= total) return null;
            values[count++] = !Number.isFinite(v) || v <= DFS.MISSING ? missingAs : v;
        }
    }
    if (count !== total) return null;
    const grid = [];
    for (let yi = 0; yi < DFS.NY; yi++) grid.push(values.subarray(yi * DFS.NX, (yi + 1) * DFS.NX));
    return grid;    // 첫 행 = 남쪽 (실응답 검증 완료 규칙)
}

/* ==================== KIM 전구모델(NE57) 크롭 격자 ==================== */

const KIM = {
    X_MIN: 1482, Y_MIN: 1452, X_MAX: 1596, Y_MAX: 1560,
    NX: 115, NY: 109, DEG: 360 / 4320,
    SUB: '1482,1452,1596,1560'
};

function parseKimGrid(text) {
    if (!text || text.includes('# ERROR')) return null;
    let dimsOk = false, subOk = false;
    const total = KIM.NX * KIM.NY;
    const values = new Float64Array(total);
    let count = 0;
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith('#')) {
            const md = t.match(/i\s*=\s*(\d+),\s*j\s*=\s*(\d+)/);
            if (md && !dimsOk) {
                if (+md[1] !== KIM.NX || +md[2] !== KIM.NY) return null;
                dimsOk = true;
            }
            const ms = t.match(/x_min\s*=\s*(\d+),\s*y_min\s*=\s*(\d+),\s*x_max\s*=\s*(\d+),\s*y_max\s*=\s*(\d+)/);
            if (ms) {
                if (+ms[1] !== KIM.X_MIN || +ms[2] !== KIM.Y_MIN || +ms[3] !== KIM.X_MAX || +ms[4] !== KIM.Y_MAX) return null;
                subOk = true;
            }
            continue;
        }
        for (const tok of t.split(/\s+/)) {
            if (!tok) continue;
            if (!isGridNumericToken(tok)) continue;
            let v = Number(tok);
            if (count >= total) return null;
            // 결측 sentinel·NC fill 방어만 — 바람 성분(u/v)의 음수는 물리값이므로 보존
            if (!Number.isFinite(v) || v <= -900 || v > 100000) v = KIM_NO_DATA;
            values[count++] = v;
        }
    }
    if (!dimsOk || !subOk || count !== total) return null;
    const grid = [];
    for (let r = 0; r < KIM.NY; r++) grid.push(values.subarray(r * KIM.NX, (r + 1) * KIM.NX));
    return grid;    // row 0 = 남쪽
}

/** 위경도 → KIM 크롭 인덱스 [row, col] / 영역 밖 null (lon=(i-1)/12°, lat=-90+j/12°) */
function kimLatLonToIndex(lat, lon) {
    const i = Math.round(lon / KIM.DEG) + 1;
    const j = Math.round((lat + 90) / KIM.DEG);
    if (i < KIM.X_MIN || i > KIM.X_MAX || j < KIM.Y_MIN || j > KIM.Y_MAX) return null;
    return [j - KIM.Y_MIN, i - KIM.X_MIN];
}

/* ==================== 기상청 DFS LCC 좌표변환 ==================== */

const LCC = (() => {
    const RE = 6371.00877, GRID = 5.0, DEGRAD = Math.PI / 180, RADDEG = 180 / Math.PI;
    const SLAT1 = 30 * DEGRAD, SLAT2 = 60 * DEGRAD, OLON = 126 * DEGRAD, OLAT = 38 * DEGRAD, XO = 43, YO = 136;
    const re = RE / GRID;
    let sn = Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
    sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(sn);
    const sf = Math.pow(Math.tan(Math.PI * 0.25 + SLAT1 * 0.5), sn) * Math.cos(SLAT1) / sn;
    const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + OLAT * 0.5), sn);
    return {
        latLonToGrid(lat, lon) {
            const ra = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5), sn);
            let theta = lon * DEGRAD - OLON;
            if (theta > Math.PI) theta -= 2 * Math.PI;
            if (theta < -Math.PI) theta += 2 * Math.PI;
            theta *= sn;
            return [Math.floor(ra * Math.sin(theta) + XO + 0.5), Math.floor(ro - ra * Math.cos(theta) + YO + 0.5)];
        },
        gridToLatLon(nx, ny) {
            const xn = nx - XO, yn = ro - ny + YO;
            let ra = Math.sqrt(xn * xn + yn * yn);
            if (sn < 0) ra = -ra;
            let alat = Math.pow(re * sf / ra, 1 / sn);
            alat = 2 * Math.atan(alat) - Math.PI * 0.5;
            let theta;
            if (Math.abs(xn) <= 0) theta = 0;
            else if (Math.abs(yn) <= 0) { theta = Math.PI * 0.5; if (xn < 0) theta = -theta; }
            else theta = Math.atan2(xn, yn);
            return [alat * RADDEG, theta / sn * RADDEG + 126.0];
        }
    };
})();

/* ==================== 시각 로직 (KST — Worker는 UTC이므로 명시적 +9h) ==================== */

const p2 = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`; };
const parseYmdH = (yyyymmdd, hh) => Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8), hh);
const RELEASE_TIMES = new Set(['0200', '0500', '0800', '1100', '1400', '1700', '2000', '2300']);

function parseYmdStrict(value) {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const ms = Date.UTC(year, month - 1, day);
    const date = new Date(ms);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? ms : null;
}

/** 현재 기준 최신 단기예보 발표시각 [baseDate, baseTime] — Spring getLatestBaseDateTime 동일 */
function latestBase() {
    const k = Date.now() + 9 * 3600e3;    // KST
    const d = new Date(k);
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    for (const bt of [23, 20, 17, 14, 11, 8, 5, 2]) {
        if (h > bt || (h === bt && m >= 10)) return [ymd(k), p2(bt) + '00'];
    }
    return [ymd(k - 86400e3), '2300'];
}

/** 임의 발표시각을 직전 유효 발표시각(02,05,...,23)으로 보정 — snapToValidBaseDateTime 동일 */
function snapBase(baseDate, baseTime) {
    const hour = parseInt(baseTime?.slice(0, 2), 10);
    if (!/^\d{8}$/.test(baseDate || '') || !Number.isFinite(hour)) return latestBase();
    if (hour >= 2 && (hour - 2) % 3 === 0) return [baseDate, p2(hour) + '00'];
    if (hour < 2) return [ymd(parseYmdH(baseDate, 0) - 86400e3), '2300'];
    return [baseDate, p2(2 + 3 * Math.floor((hour - 2) / 3)) + '00'];
}

/** 발표 + leadHours시간 → [yyyymmdd, HH] */
function addHours(baseDate, baseHour, hours) {
    const t = parseYmdH(baseDate, baseHour) + hours * 3600e3;
    return [ymd(t), new Date(t).getUTCHours()];
}

/** 발표시각(KST) → KIM 실행시각(UTC 6h 단위) ms */
function kimRunUtcMs(baseDate, baseHour) {
    const baseUtcMs = parseYmdH(baseDate, baseHour) - 9 * 3600e3;
    const d = new Date(baseUtcMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(d.getUTCHours() / 6) * 6);
}
const kimTmfc = (runMs) => { const d = new Date(runMs); return ymd(runMs) + p2(d.getUTCHours()); };
const snap3 = (h) => Math.max(0, Math.round(h / 3) * 3);
const KIM_HOURLY_START_TMFC = '2026070100';
const KIM_COMPLETE_LAG_HOURS = 5;

/** 선택 시각에 전체 예측장이 게시 완료된 최신 KIM 런을 결정한다. */
function kimAvailableRunUtcMs(baseDate, baseHour) {
    const baseUtcMs = parseYmdH(baseDate, baseHour) - 9 * 3600e3;
    let runMs = kimRunUtcMs(baseDate, baseHour);
    if ((baseUtcMs - runMs) / 3600e3 < KIM_COMPLETE_LAG_HOURS) runMs -= 6 * 3600e3;
    return runMs;
}

import {
    readSevereWeatherSnapshot,
    refreshSevereWeather,
    severeWeatherCacheControl
} from './severe-weather.js';

/**
 * NE57은 2026-07-01 00UTC 런부터 +135h까지 1시간 간격으로 제공된다.
 * 그 이전 자료만 기존 3시간 간격에 맞춰 가장 가까운 모델 시각을 사용한다.
 */
function kimOutputTime(runMs, requestedValidUtcMs) {
    const exactHour = Math.max(0, Math.round((requestedValidUtcMs - runMs) / 3600e3));
    const temporalResolutionHours = kimTmfc(runMs) >= KIM_HOURLY_START_TMFC ? 1 : 3;
    const forecastHour = temporalResolutionHours === 1 ? exactHour : snap3(exactHour);
    const validUtcMs = runMs + forecastHour * 3600e3;
    return {
        forecastHour,
        validUtcMs,
        temporalResolutionHours,
        timeAdjusted: validUtcMs !== requestedValidUtcMs
    };
}

/* ==================== 업스트림 + Cache API ==================== */

async function cachedText(cacheKeyPath, upstreamUrl, validate,
    { ttl = 604800, maxBytes, timeoutMs = KMA.UPSTREAM_TIMEOUT_MS, beforeFetch = null } = {}) {
    const cache = caches.default;
    const key = new Request('https://bora-cache.internal' + cacheKeyPath);
    const isValid = (value) => !validate || validate(value);
    const matchText = async () => {
        try {
            const hit = await cache.match(key);
            if (!hit) return null;
            const value = await hit.text();
            // 배포 전 이미 저장된 오염 값도 상류 정상값처럼 재사용하지 않는다.
            if (isValid(value)) return value;
            await cache.delete(key).catch(() => false);
            return null;
        } catch {
            return null;
        }
    };
    const hit = await matchText();
    if (hit !== null) return hit;

    // Cache API에는 원자적 lock이 없다. isolate 전역 Promise Map은 다른 요청의 I/O
    // context를 공유하므로 사용하지 않는다. 엄밀한 cross-request single-flight가
    // 필요하면 Durable Object 같은 명시적인 조정 계층을 둬야 한다.
    const raced = await matchText();
    if (raced !== null) return raced;

    if (typeof beforeFetch === 'function') await beforeFetch();
    const text = await fetchKmaText(upstreamUrl, maxBytes, timeoutMs);
    if (text === null) return null;
    if (text.includes('"status" : 403') || text.includes('활용신청')) return null;
    if (!isValid(text)) return null;    // 유효 응답만 캐시 (전체 결측·형식 오류 차단)

    try {
        await cache.put(key, new Response(text, {
            headers: { 'Cache-Control': `public, max-age=${ttl}`, 'Content-Type': 'text/plain; charset=utf-8' }
        }));
    } catch {
        // 캐시 저장 실패가 검증을 통과한 KMA 응답을 오류로 바꾸지 않도록 한다.
    }
    return text;
}

/**
 * 상류 텍스트를 Content-Length 선검사와 실제 스트림 바이트 수로 이중 제한한다.
 * TextDecoder의 stream 모드를 사용해 UTF-8 문자가 청크 경계에서 갈라져도 보존한다.
 */
async function readTextResponseLimited(response, maxBytes, fatalUtf8 = true) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        if (response.body) await response.body.cancel('invalid response limit').catch(() => { });
        return null;
    }
    if (!response.ok || !response.body) {
        if (response.body) await response.body.cancel('upstream response rejected').catch(() => { });
        return null;
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body.cancel('response too large').catch(() => { });
        return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: fatalUtf8 });
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel('response too large').catch(() => { });
                return null;
            }
            chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        return chunks.join('');
    } catch {
        await reader.cancel('invalid or interrupted response').catch(() => { });
        return null;
    } finally {
        reader.releaseLock();
    }
}

async function fetchKmaText(url, maxBytes, timeoutMs = KMA.UPSTREAM_TIMEOUT_MS) {
    const endpoint = (() => {
        try { return new URL(url).pathname; } catch { return 'invalid-url'; }
    })();
    try {
        const response = await fetch(url, {
            headers: { Accept: 'text/plain', 'User-Agent': 'bora-weather/1.0' },
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store'
        });
        if (!response.ok) {
            logUpstreamFailure('kma', 'text-api', `http_${response.status}`, { endpoint });
            if (response.body) await response.body.cancel('upstream response rejected').catch(() => { });
            return null;
        }
        // KMA 수치모델 텍스트의 주석 헤더 일부는 CP949 바이트를 포함한다. 숫자·ASCII
        // 메타데이터는 그대로 보존하고 잘못된 문자만 U+FFFD로 치환한다.
        const text = await readTextResponseLimited(response, maxBytes, false);
        if (text === null) {
            logUpstreamFailure('kma', 'text-api', 'invalid_or_oversized_body', {
                endpoint,
                declaredBytes: response.headers.get('content-length') || null
            });
        }
        return text;
    } catch (error) {
        logUpstreamFailure('kma', 'text-api', error?.name === 'TimeoutError' ? 'timeout' : 'fetch_error', {
            endpoint
        });
        return null;
    }
}

function dfsGridUrl(env, tmfc, tmef, vars) {
    return kmaUrl('/api/typ01/cgi-bin/url/nph-dfs_shrt_grd', {
        tmfc, tmef, vars, authKey: env.KMA_API_AUTH_KEY
    });
}
function kimGridUrl(env, tmfc, hf, name) {
    // 기존 활용승인 키와 호환되는 NE57 경량화 조회. 표준화 typ06 서비스는
    // 별도 활용승인이 필요하므로 운영 키 전환 전까지 이 주소를 유지한다.
    return kmaUrl('/api/typ01/cgi-bin/url/nph-kim_nc_xy_txt2', {
        group: 'KIMG', nwp: 'NE57', data: 'U', name, level: 0, map: 'S', sub: KIM.SUB,
        sm: 0, disp: 'A', tmfc, hf, authKey: env.KMA_API_AUTH_KEY
    });
}

function kimPointUrl(env, tmfc, hf, name, row, column) {
    return kmaUrl('/api/typ01/cgi-bin/url/nph-kim_nc_pt_txt2', {
        group: 'KIMG', nwp: 'NE57', data: 'U', name, level: 0,
        X: KIM.X_MIN + column, Y: KIM.Y_MIN + row,
        tmfc, hf, disp: 'A', help: 0, authKey: env.KMA_API_AUTH_KEY
    });
}

function isValidDfsVectorValue(variable, value) {
    if (variable === 'WSD') return isValidWindSpeed(value);
    if (variable === 'UUU' || variable === 'VVV') return isValidWindComponent(value);
    return Number.isFinite(value) && value !== GRID_NO_DATA;
}

/** DFS 격자 (파싱 결과) — 형식과 호출 요소의 물리 계약을 통과할 때만 캐시 */
async function getDfsGrid(env, tmfc, tmef, vars, missingAs = 0.0, beforeFetch = null,
    scalarDescriptor = null) {
    let validatedGrid = null;
    const text = await cachedText(`/dfs/${tmfc}/${vars}_${tmef}`, dfsGridUrl(env, tmfc, tmef, vars), (t) => {
        const g = parseDfsGrid(t, -999);
        if (!g) return false;
        if (scalarDescriptor) {
            if (!usableDfsScalarGrid(g, scalarDescriptor)) return false;
            validatedGrid = g;
            return true;
        }
        for (const row of g) for (const v of row) if (isValidDfsVectorValue(vars, v)) {
            validatedGrid = g;
            return true;
        }
        return false;
    }, { maxBytes: KMA.MAX_DFS_BYTES, beforeFetch });
    if (!text) return null;
    // cold miss 검증에서 이미 파싱한 격자를 재사용한다. 다른 결측값 표현이
    // 필요한 잠재 호출자와 cache hit 경로는 기존처럼 한 번 파싱한다.
    return validatedGrid && missingAs === -999 ? validatedGrid : parseDfsGrid(text, missingAs);
}

/** KIM 크롭 격자 — 야간 전체 0도 유효값이므로 형식 검증만 */
async function getKimGrid(env, tmfc, hf, name, beforeFetch = null) {
    let rejectedReason = null;
    let validatedGrid = null;
    const text = await cachedText(`/kim/${tmfc}/${name}_${hf}`, kimGridUrl(env, tmfc, hf, name),
        (t) => {
            validatedGrid = parseKimGrid(t);
            if (!validatedGrid) rejectedReason = classifyKmaGridFailure(t);
            return !!validatedGrid;
        }, { maxBytes: KMA.MAX_KIM_BYTES, beforeFetch });
    if (!text) {
        logUpstreamFailure('kma', 'kim-ne57', rejectedReason || 'request_failed', { tmfc, hf, variable: name });
    }
    return text ? (validatedGrid ?? parseKimGrid(text)) : null;
}

const SOLAR_SERIES = {
    CACHE_TTL: 1800,
    // Workers의 동시 outgoing connection 상한과 맞춘다.
    FETCH_CONCURRENCY: 6,
    UPSTREAM_TIMEOUT_MS: 4000
};

function validSolarSeries(value) {
    return Array.isArray(value) && value.length === 49
        && value.every((slot) => Array.isArray(slot) && slot.length === 2
            && Number.isFinite(slot[0]) && slot[0] < 9000 && slot[0] > -900 && slot[1] === 0);
}

async function fetchKimCell(env, tmfc, hf, row, column) {
    const text = await fetchKmaText(kimPointUrl(env, tmfc, hf, 'dswrsfc', row, column),
        KMA.MAX_KIM_POINT_BYTES, SOLAR_SERIES.UPSTREAM_TIMEOUT_MS);
    if (text === null || text.includes('"status" : 403') || text.includes('활용신청')) return null;
    for (const line of text.split('\n')) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length < 5 || !/^\d{10}$/.test(tokens[0]) || !/^\d{10}$/.test(tokens[1])) continue;
        const value = Number(tokens[4]);
        return Number.isFinite(value) && value > -900 && value <= 100000 ? Math.max(0, value) : null;
    }
    // 합성 회귀 fixture와 과거 캐시 형식을 허용한다. 운영 point 응답은 위에서 종료된다.
    const grid = parseKimGrid(text);
    const value = grid ? grid[row][column] : null;
    return Number.isFinite(value) && value > -900 ? Math.max(0, value) : null;
}

async function mapSolarForecastHours(hours, mapper) {
    const results = new Map();
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(SOLAR_SERIES.FETCH_CONCURRENCY, hours.length) }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= hours.length) return;
            const hf = hours[index];
            results.set(hf, await mapper(hf));
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * 지점 일사강도는 화면에 노출되는 +1~+48h만 단일 격자점 API로 조회한다.
 * composite cache match 1 + upstream 48 + cache put 1로 Free 플랜 50 subrequest
 * 한도를 지키며, 2026-07-01 이후의 시간별 KIM 자료를 반복값 없이 보존한다.
 */
async function solarStationSeries(env, baseDate, baseTime, row, column, beforeFetch) {
    const cache = caches.default;
    const key = new Request(`https://bora-cache.internal/stn-solar/v3/${baseDate}${baseTime}/${row}_${column}`);
    try {
        const hit = await cache.match(key);
        if (hit) {
            const cached = await hit.json();
            if (validSolarSeries(cached)) return cached;
        }
    } catch {
        // Cache API 장애는 miss로 취급한다.
    }

    // 다중 IP가 서로 다른 지점을 바꿔 캐시 miss를 만드는 경우에도
    // PoP 공유 refresh budget을 먼저 소비한 후에만 KIM 격자를 조회한다.
    if (typeof beforeFetch === 'function') await beforeFetch();

    const baseHour = Number(baseTime.slice(0, 2));
    const baseUtcMs = parseYmdH(baseDate, baseHour) - 9 * 3600e3;
    const run = kimAvailableRunUtcMs(baseDate, baseHour);
    const outputForHour = (hour) => kimOutputTime(run, baseUtcMs + hour * 3600e3);
    const forecastHours = [...new Set(Array.from({ length: 48 }, (_, index) =>
        outputForHour(index + 1).forecastHour))];
    const tmfc = kimTmfc(run);
    const values = await mapSolarForecastHours(forecastHours,
        (hf) => fetchKimCell(env, tmfc, hf, row, column));

    // +0h는 프론트 호환 슬롯일 뿐 노출하지 않는다. +1h를 복제해 추가 호출을 피한다.
    const series = Array.from({ length: 49 }, (_, hour) => {
        const visibleHour = Math.max(hour, 1);
        const value = values.get(outputForHour(visibleHour).forecastHour);
        return [value === null || value === undefined ? 9999 : value, 0];
    });

    if (validSolarSeries(series)) {
        try {
            await cache.put(key, new Response(JSON.stringify(series), {
                headers: {
                    'Cache-Control': `public, max-age=${SOLAR_SERIES.CACHE_TTL}`,
                    'Content-Type': 'application/json'
                }
            }));
        } catch {
            // 정상 상류 응답은 캐시 저장 실패와 무관하게 반환한다.
        }
    } else {
        logUpstreamFailure('kma', 'kim-ne57-station', 'no_valid_slots', {
            tmfc,
            requestedForecastHours: forecastHours.length
        });
    }
    return series;
}

/** KIM 격자 + 직전 런(-6h) 폴백. 실제 모델 런·발효시각도 함께 반환한다. */
async function getKimWithFallback(env, baseDate, baseHour, validUtcMs, name, beforeFetch = null) {
    let run = kimAvailableRunUtcMs(baseDate, baseHour);
    for (let attempt = 0; attempt < 2; attempt++) {
        const output = kimOutputTime(run, validUtcMs);
        const grid = await getKimGrid(env, kimTmfc(run), output.forecastHour, name, beforeFetch);
        if (grid) {
            return {
                grid,
                runMs: run,
                modelForecastHour: output.forecastHour,
                modelValidUtcMs: output.validUtcMs,
                temporalResolutionHours: output.temporalResolutionHours,
                timeAdjusted: output.timeAdjusted,
                fallbackUsed: attempt > 0
            };
        }
        run -= 6 * 3600e3;
    }
    return null;
}

/* ==================== 표출 서브그리드 (Spring MapService 동일) ==================== */

const SUB = { NX_MIN: 5, NX_MAX: 149, NY_MIN: 1, NY_MAX: 162, STEP: 1 };
const GNX = (SUB.NX_MAX - SUB.NX_MIN) / SUB.STEP + 1;    // 145
const GNY = (SUB.NY_MAX - SUB.NY_MIN) / SUB.STEP + 1;    // 162

function isInsideForecastGrid(nx, ny) {
    return nx >= SUB.NX_MIN && nx <= SUB.NX_MAX
        && ny >= SUB.NY_MIN && ny <= SUB.NY_MAX;
}

/** 서브그리드 셀 중심 위경도 (1회 계산 후 재사용) */
const CELL_LL = (() => {
    const arr = [];
    for (let yi = 0; yi < GNY; yi++) {
        const row = [];
        for (let xi = 0; xi < GNX; xi++) {
            row.push(LCC.gridToLatLon(SUB.NX_MIN + xi * SUB.STEP, SUB.NY_MIN + yi * SUB.STEP));
        }
        arr.push(row);
    }
    return arr;
})();

function round1(v) { return Math.round(v * 10) / 10; }

/** 10m 바람 그리드 {u,v,ws}[GNY][GNX] — DFS WSD/UUU/VVV */
async function fetchWindGrid(env, baseDate, baseTime, leadHours, beforeFetch = null) {
    const baseHour = +baseTime.slice(0, 2);
    const tmfc = baseDate + baseTime.slice(0, 2);
    const [fd, fh] = addHours(baseDate, baseHour, Math.max(leadHours, 1));
    const tmef = fd + p2(fh);
    const [wsd, uuu, vvv] = await Promise.all([
        getDfsGrid(env, tmfc, tmef, 'WSD', -999, beforeFetch),
        getDfsGrid(env, tmfc, tmef, 'UUU', -999, beforeFetch),
        getDfsGrid(env, tmfc, tmef, 'VVV', -999, beforeFetch)
    ]);
    if (!wsd && !uuu && !vvv) return null;
    const grid = [];
    for (let yi = 0; yi < GNY; yi++) {
        const row = [];
        for (let xi = 0; xi < GNX; xi++) {
            const nx = SUB.NX_MIN + xi * SUB.STEP, ny = SUB.NY_MIN + yi * SUB.STEP;
            const u = uuu ? uuu[ny - 1][nx - 1] : GRID_NO_DATA;
            const v = vvv ? vvv[ny - 1][nx - 1] : GRID_NO_DATA;
            const vectorValid = isValidWindComponent(u) && isValidWindComponent(v);
            const wsSource = wsd ? wsd[ny - 1][nx - 1] : GRID_NO_DATA;
            const ws = isValidWindSpeed(wsSource)
                ? wsSource : vectorValid ? Math.hypot(u, v) : GRID_NO_DATA;
            row.push({ u, v, ws });
        }
        grid.push(row);
    }
    return { grid, modelRunTime: null, modelForecastHour: null };
}

const GRID_CATEGORY_LABELS = Object.freeze({
    pty: Object.freeze({ 0: '없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기' }),
    sky: Object.freeze({ 1: '맑음', 3: '구름많음', 4: '흐림' })
});

/**
 * DFS 단일 요소 계약. 선택한 descriptor의 variable 하나만 지연 조회하며,
 * 상류의 -99/-999/9999와 물리적으로 불가능한 값은 모두 같은 no-data로 정규화한다.
 */
const DFS_GRID_ELEMENTS = Object.freeze({
    tmp: Object.freeze({
        variable: 'TMP', alias: 'temp', unit: '°C', min: -100, max: 80,
        product: 'KMA DFS TMP', unavailable: 'temperature grid unavailable'
    }),
    pcp: Object.freeze({
        variable: 'PCP', alias: 'pcp', unit: 'mm', min: 0, max: 1000,
        accumulationHours: 1, product: 'KMA DFS PCP', unavailable: 'precipitation grid unavailable'
    }),
    sno: Object.freeze({
        variable: 'SNO', alias: 'sno', unit: 'cm', min: 0, max: 100,
        accumulationHours: 1, product: 'KMA DFS SNO', unavailable: 'snowfall grid unavailable'
    }),
    pty: Object.freeze({
        variable: 'PTY', alias: 'pty', unit: 'code', categories: GRID_CATEGORY_LABELS.pty,
        product: 'KMA DFS PTY', unavailable: 'precipitation type grid unavailable'
    }),
    reh: Object.freeze({
        variable: 'REH', alias: 'reh', unit: '%', min: 0, max: 100,
        product: 'KMA DFS REH', unavailable: 'humidity grid unavailable'
    }),
    sky: Object.freeze({
        variable: 'SKY', alias: 'sky', unit: 'code', categories: GRID_CATEGORY_LABELS.sky,
        product: 'KMA DFS SKY', unavailable: 'sky condition grid unavailable'
    }),
    wav: Object.freeze({
        variable: 'WAV', alias: 'wav', unit: 'm', min: 0, max: 50,
        product: 'KMA DFS WAV', unavailable: 'wave height grid unavailable'
    })
});
const GRID_ELEMENTS = Object.freeze(['wdws', ...Object.keys(DFS_GRID_ELEMENTS), 'swdn']);
const FORECAST_BACKED_STATION_LABELS = Object.freeze({
    pcp: '강수량', sno: '신적설', pty: '강수형태',
    reh: '상대습도', sky: '하늘상태', wav: '파고'
});

function isValidDfsScalar(value, descriptor) {
    if (!Number.isFinite(value) || value <= -900 || value >= 9000) return false;
    if (descriptor.categories) {
        return Number.isInteger(value)
            && Object.prototype.hasOwnProperty.call(descriptor.categories, String(value));
    }
    return value >= descriptor.min && value <= descriptor.max;
}

/** 공유 DFS 캐시는 읽기 전용으로 재사용하고, 실제 표출 셀이 하나라도 있는지만 확인한다. */
function usableDfsScalarGrid(grid, descriptor) {
    if (!Array.isArray(grid)) return null;
    for (let yi = 0; yi < GNY; yi++) {
        const row = grid[(SUB.NY_MIN + yi * SUB.STEP) - 1];
        if (!row || typeof row.length !== 'number' || row.length < SUB.NX_MAX) return null;
        for (let xi = 0; xi < GNX; xi++) {
            const value = row[(SUB.NX_MIN + xi * SUB.STEP) - 1];
            if (isValidDfsScalar(value, descriptor)) return grid;
        }
    }
    return null;
}

const DFS_SCALAR_FALLBACK_ALIAS_TTL = 90;

function dfsScalarFallbackAliasKey(aliasName, requestedTmfc, tmef) {
    return new Request(`https://bora-cache.internal/dfs-${aliasName}-run/v1/${requestedTmfc}/${tmef}`);
}

async function readDfsScalarFallbackAlias(aliasName, requestedTmfc, tmef, expectedTmfc) {
    try {
        const hit = await caches.default.match(dfsScalarFallbackAliasKey(aliasName, requestedTmfc, tmef));
        if (!hit) return null;
        const actualTmfc = (await hit.text()).trim();
        return actualTmfc === expectedTmfc ? actualTmfc : null;
    } catch {
        return null;
    }
}

async function writeDfsScalarFallbackAlias(aliasName, requestedTmfc, tmef, actualTmfc) {
    try {
        await caches.default.put(dfsScalarFallbackAliasKey(aliasName, requestedTmfc, tmef),
            new Response(actualTmfc, {
                headers: {
                    'Cache-Control': `public, max-age=${DFS_SCALAR_FALLBACK_ALIAS_TTL}`,
                    'Content-Type': 'text/plain; charset=utf-8'
                }
            }));
    } catch {
        // alias 저장 실패는 검증을 통과한 DFS 자료를 오류로 바꾸지 않는다.
    }
}

function dfsScalarGridResult(grid, runMs, validMs, fallbackUsed) {
    return {
        grid,
        // parseYmdH는 KST 벽시각을 UTC 성분으로 보관하므로 실제 UTC instant로 9시간 보정한다.
        modelRunTime: new Date(runMs - 9 * 3600e3).toISOString().replace('.000Z', 'Z'),
        modelForecastHour: Math.round((validMs - runMs) / 3600e3),
        fallbackUsed
    };
}

/**
 * DFS 단일 요소는 새 발표본의 첫 시간값이 늦게 게시될 수 있다. 요청한 발효시각은
 * 유지하고 최신 런에 자료가 없을 때만 직전 3시간 런을 한 번 조회한다.
 * 짧은 alias는 게시 지연 중 같은 요청이 최신 미게시 런을 반복 조회하는 것을 막는다.
 */
async function fetchDfsScalarGrid(env, baseDate, baseTime, leadHours,
    descriptor, beforeFetch = null) {
    const baseHour = +baseTime.slice(0, 2);
    const validMs = parseYmdH(baseDate, baseHour) + Math.max(leadHours, 1) * 3600e3;
    const validDate = ymd(validMs);
    const validHour = new Date(validMs).getUTCHours();
    const initialRunMs = parseYmdH(baseDate, baseHour);
    const requestedTmfc = baseDate + p2(baseHour);
    const tmef = validDate + p2(validHour);
    const fallbackRunMs = initialRunMs - 3 * 3600e3;
    const fallbackTmfc = ymd(fallbackRunMs) + p2(new Date(fallbackRunMs).getUTCHours());

    const aliasedTmfc = await readDfsScalarFallbackAlias(
        descriptor.alias, requestedTmfc, tmef, fallbackTmfc);
    let fallbackAttempted = false;
    if (aliasedTmfc) {
        fallbackAttempted = true;
        const rawGrid = await getDfsGrid(
            env, aliasedTmfc, tmef, descriptor.variable, -999, beforeFetch, descriptor);
        const grid = usableDfsScalarGrid(rawGrid, descriptor);
        if (grid) return dfsScalarGridResult(grid, fallbackRunMs, validMs, true);
    }

    const attemptCount = fallbackAttempted ? 1 : 2;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
        const runMs = initialRunMs - attempt * 3 * 3600e3;
        const runHour = new Date(runMs).getUTCHours();
        const runDate = ymd(runMs);
        const tmfc = runDate + p2(runHour);
        const rawGrid = await getDfsGrid(
            env, tmfc, tmef, descriptor.variable, -999, beforeFetch, descriptor);
        const grid = usableDfsScalarGrid(rawGrid, descriptor);
        if (grid) {
            if (attempt > 0) {
                await writeDfsScalarFallbackAlias(descriptor.alias, requestedTmfc, tmef, tmfc);
            }
            return dfsScalarGridResult(grid, runMs, validMs, attempt > 0);
        }
    }
    return null;
}

/** mock 바람 그리드 — API 미연결 시 폴백 (형태만 유지, 결정적) */
function mockWindGrid() {
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    const grid = [];
    for (let yi = 0; yi < GNY; yi++) {
        const row = [];
        for (let xi = 0; xi < GNX; xi++) {
            const lat = 32 + (yi / GNY) * 6, lon = 124.8 + (xi / GNX) * 6.8;
            let u = 2 + Math.sin(lat * 0.5) * 3 + rand();
            let v = -1 + Math.cos(lon * 0.3) * 2 + rand();
            let ws = Math.hypot(u, v);
            const isLand = (lon > 125.5 && lon < 130.5 && lat > 33 && lat < 38.5) || (lon > 125 && lat > 34 && lat < 37);
            if (!isLand) ws *= 1.5;
            row.push({ u: round1(u), v: round1(v), ws: round1(ws) });
        }
        grid.push(row);
    }
    return grid;
}

/* ==================== 스트림라인 벡터장 ==================== */

function kstIso(baseDate, baseHour, offsetHours = 0) {
    const ms = parseYmdH(baseDate, baseHour) + offsetHours * 3600e3;
    const date = new Date(ms);
    const compactDate = ymd(ms);
    const isoDate = `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
    return `${isoDate}T${p2(date.getUTCHours())}:${p2(date.getUTCMinutes())}:00+09:00`;
}

/** UTC instant를 명시적인 KST ISO-8601 문자열로 변환한다. */
function utcInstantToKstIso(utcMs) {
    const kstWallMs = utcMs + 9 * 3600e3;
    return kstIso(ymd(kstWallMs), new Date(kstWallMs).getUTCHours());
}

function buildWindField(grid, baseDate, baseTime, leadHours,
    modelRunTime = null, modelForecastHour = null) {
    const noData = -32768;
    const forecastHour = Math.max(leadHours, 1);
    const uData = [], vData = [];
    for (let yi = GNY - 1; yi >= 0; yi--) {
        for (let xi = 0; xi < GNX; xi++) {
            const c = grid[yi][xi];
            const valid = c && isValidWindComponent(c.u) && isValidWindComponent(c.v);
            uData.push(valid ? Math.round(c.u * 10) : noData);
            vData.push(valid ? Math.round(c.v * 10) : noData);
        }
    }
    const baseHour = Number(baseTime.slice(0, 2));
    const field = {
        schema: 'weather-grid.wind-field/v1',
        unit: 'm/s',
        scaleFactor: 0.1,
        noData,
        vectorReference: 'earth-relative',
        heightMeters: 10,
        requestedForecastHour: leadHours,
        // 단기예보에는 발표 +0h 슬롯이 없어 화면의 +0h 요청도 +1h 자료를 사용한다.
        forecastHour,
        referenceTime: kstIso(baseDate, baseHour),
        validTime: kstIso(baseDate, baseHour, forecastHour),
        grid: {
            type: 'kma-dfs-lcc', nx: GNX, ny: GNY,
            nxMin: SUB.NX_MIN, nyMin: SUB.NY_MIN, step: SUB.STEP,
            rowOrder: 'north-to-south', columnOrder: 'west-to-east'
        },
        u: uData,
        v: vData
    };
    if (modelRunTime && Number.isInteger(modelForecastHour)) {
        field.modelRunTime = modelRunTime;
        field.modelForecastHour = modelForecastHour;
    }
    return field;
}

/* ==================== gridData 조립 ==================== */

// 통계 응답에서도 캐시 TTL을 결정하되 공개 JSON 계약에는 노출하지 않는 내부 메타데이터.
const GRID_BUILD_METADATA = Symbol('gridBuildMetadata');

class WeatherUnavailableError extends Error { }

class RateLimitExceededError extends Error {
    constructor(retryAfterSeconds = 60) {
        super('rate limit exceeded');
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** 요청 지점이 해당 자료의 영구 커버리지 밖 — 재시도해도 달라지지 않으므로 503이 아닌 400 */
class OutOfCoverageError extends Error { }

const allowMockData = (env) => String(env.ALLOW_MOCK_DATA || '').toLowerCase() === 'true';

async function buildGridData(env, baseDateIn, baseTimeIn, element, leadHours, statsOnly = false) {
    const [baseDate, baseTime] = snapBase(baseDateIn, baseTimeIn);
    const baseHour = +baseTime.slice(0, 2);
    const isWind = element === 'wdws';
    const scalarDescriptor = DFS_GRID_ELEMENTS[element] || null;
    let mock = false;
    let refreshLimitPromise = null;
    const acquireGridRefresh = () => {
        refreshLimitPromise ||= acquireRateLimit(env.GRID_REFRESH_LIMITER, 'kma:grid-refresh');
        return refreshLimitPromise;
    };

    let windGrid = null, solar = null, scalarGrid = null;
    let solarMetadata = null;
    let scalarMetadata = null;
    let windModelRunTime = null, windModelForecastHour = null;
    if (isWind) {
        const windResult = await fetchWindGrid(env, baseDate, baseTime, leadHours, acquireGridRefresh);
        if (!windResult) {
            if (!allowMockData(env)) throw new WeatherUnavailableError('wind grid unavailable');
            windGrid = mockWindGrid();
            mock = true;
        } else {
            windGrid = windResult.grid;
            windModelRunTime = windResult.modelRunTime;
            windModelForecastHour = windResult.modelForecastHour;
        }
    } else if (scalarDescriptor) {
        const scalarResult = await fetchDfsScalarGrid(
            env, baseDate, baseTime, leadHours, scalarDescriptor, acquireGridRefresh);
        if (!scalarResult) throw new WeatherUnavailableError(scalarDescriptor.unavailable);
        scalarGrid = scalarResult.grid;
        scalarMetadata = scalarResult;
    } else {
        const validUtcMs = parseYmdH(baseDate, baseHour) + Math.max(leadHours, 1) * 3600e3 - 9 * 3600e3;
        solarMetadata = await getKimWithFallback(
            env, baseDate, baseHour, validUtcMs, 'dswrsfc', acquireGridRefresh);
        solar = solarMetadata?.grid || null;
        if (!solar) {
            if (!allowMockData(env)) throw new WeatherUnavailableError('solar grid unavailable');
            mock = true;
        }
    }

    const data = statsOnly ? null : [];
    const isCategorical = Boolean(scalarDescriptor?.categories);
    const categoryCounts = isCategorical
        ? Object.fromEntries(Object.keys(scalarDescriptor.categories).map((code) => [code, 0]))
        : null;
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let yi = GNY - 1; yi >= 0; yi--) {
        for (let xi = 0; xi < GNX; xi++) {
            let val = GRID_NO_DATA;
            if (isWind) {
                val = windGrid[yi][xi] ? windGrid[yi][xi].ws : GRID_NO_DATA;
            } else if (scalarDescriptor) {
                val = scalarGrid[(SUB.NY_MIN + yi * SUB.STEP) - 1]
                    [(SUB.NX_MIN + xi * SUB.STEP) - 1];
                val = isValidDfsScalar(val, scalarDescriptor) ? val : GRID_NO_DATA;
            } else {
                if (solar) {
                    const idx = kimLatLonToIndex(CELL_LL[yi][xi][0], CELL_LL[yi][xi][1]);
                    const sourceValue = idx ? solar[idx[0]][idx[1]] : GRID_NO_DATA;
                    // 하향단파복사의 야간 미세 음수는 모델 수치 잡음이므로 0으로 표출한다.
                    val = sourceValue > -900 ? Math.max(0, sourceValue) : GRID_NO_DATA;
                }
            }
            if (!statsOnly) data.push(val);
            const valid = Number.isFinite(val) && val > -900;
            if (valid) {
                if (isCategorical) categoryCounts[String(val)]++;
                if (val < min) min = val;
                if (val > max) max = val;
                sum += val;
                count++;
            }
        }
    }
    if (count === 0) { min = 0; max = 0; }
    const result = {
        stats: isCategorical
            ? { min: null, avg: null, max: null, count }
            : { min: round1(min), avg: round1(count ? sum / count : 0), max: round1(max) },
        ...(categoryCounts ? { categoryCounts } : {}),
        mock
    };
    result[GRID_BUILD_METADATA] = {
        fallbackUsed: Boolean(scalarMetadata?.fallbackUsed || solarMetadata?.fallbackUsed)
    };
    if (statsOnly) return result;

    const sw = LCC.gridToLatLon(SUB.NX_MIN, SUB.NY_MIN);
    const ne = LCC.gridToLatLon(SUB.NX_MAX, SUB.NY_MAX);
    return {
        ...result, data,
        nx: GNX, ny: GNY, nxMin: SUB.NX_MIN, nyMin: SUB.NY_MIN, step: SUB.STEP,
        baseDate, baseTime,
        swLat: sw[0], swLon: sw[1], neLat: ne[0], neLon: ne[1],
        mock,
        ...(scalarMetadata ? {
            referenceTime: kstIso(baseDate, baseHour),
            validTime: kstIso(baseDate, baseHour, Math.max(leadHours, 1)),
            modelRunTime: scalarMetadata.modelRunTime,
            modelForecastHour: scalarMetadata.modelForecastHour,
            fallbackUsed: scalarMetadata.fallbackUsed,
            product: scalarDescriptor.product,
            unit: scalarDescriptor.unit,
            ...(Number.isInteger(scalarDescriptor.accumulationHours)
                ? { accumulationHours: scalarDescriptor.accumulationHours } : {}),
            ...(scalarDescriptor.categories ? { categories: scalarDescriptor.categories } : {})
        } : solarMetadata ? {
            referenceTime: kstIso(baseDate, baseHour),
            requestedValidTime: kstIso(baseDate, baseHour, Math.max(leadHours, 1)),
            validTime: utcInstantToKstIso(solarMetadata.modelValidUtcMs),
            modelRunTime: new Date(solarMetadata.runMs).toISOString().replace('.000Z', 'Z'),
            modelForecastHour: solarMetadata.modelForecastHour,
            fallbackUsed: solarMetadata.fallbackUsed,
            temporalResolutionHours: solarMetadata.temporalResolutionHours,
            timeAdjusted: solarMetadata.timeAdjusted,
            product: 'KIM NE57 dswrsfc'
        } : {}),
        windField: isWind
            ? buildWindField(windGrid, baseDate, baseTime, leadHours,
                windModelRunTime, windModelForecastHour)
            : null
    };
}

/* ==================== 공공데이터포털 단기예보·대기질 ==================== */

const DATA_GO = {
    KMA_FORECAST_PATH: '/1360000/VilageFcstInfoService_2.0/getVilageFcst',
    AIR_MEASURE_PATH: '/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty',
    AIR_STATION_PATH: '/B552584/MsrstnInfoInqireSvc/getMsrstnList',
    FORECAST_TTL: 3600,
    AIR_FRESH_TTL: 3600,
    AIR_STALE_TTL: 6 * 3600,
    AIR_STATION_TTL: 7 * 86400,
    AIR_FAILURE_TTL: 15 * 60,
    MAX_FORECAST_BYTES: 2 * 1024 * 1024,
    MAX_AIR_BYTES: 4 * 1024 * 1024,
    MAX_FORECAST_ITEMS: 1000,
    MAX_AIR_STATION_ITEMS: 2000,
    MAX_AIR_MEASURE_ITEMS: 1000,
    UPSTREAM_TIMEOUT_MS: 15000
};

const CCTV = {
    PATH: '/cctvInfo',
    TILE_SCALE: 4,              // 공개 bbox 제한을 계산하는 0.25° base tile
    SUPERTILE_SCALE: 2,         // Cache API + fetch subrequest를 줄이는 0.5° upstream tile
    MAX_TILES: 24,
    MAX_SUPERTILES: 14,
    MAX_RESULTS: 1000,
    MAX_UPSTREAM_ITEMS: 5000,
    MAX_DECLARED_COUNT: 100000,
    FRESH_TTL: 60,
    STALE_TTL: 300,
    // ITS 장애를 PoP 전체에서 2분간 공유해 요청마다 6초 timeout을 반복하지 않는다.
    CIRCUIT_FAILURE_TTL: 120,
    MAX_RESPONSE_BYTES: 2 * 1024 * 1024,
    // live ITS가 느려도 요청 전체가 오래 점유되지 않게 제한한다.
    UPSTREAM_TIMEOUT_MS: 6000,
    OVERALL_TIMEOUT_MS: 10000,
    STREAM_ORIGIN: 'https://cctvsec.ktict.co.kr',
    MAX_STREAM_URL_LENGTH: 2048,
    FETCH_CONCURRENCY: 6
};

const dataGoCacheKey = (path) => new Request('https://bora-cache.internal/data-go' + path);
const itsCacheKey = (path) => new Request('https://bora-cache.internal/its' + path);

/**
 * 공공데이터포털 Decoding 키를 URLSearchParams가 정확히 한 번 인코딩한다.
 * 포털의 Encoding 키(%3D 등)를 시크릿에 넣으면 %가 다시 인코딩되므로 명시적으로 거부한다.
 */
function dataGoUrl(env, path, params) {
    const serviceKey = typeof env.DATA_GO_KR_SERVICE_KEY === 'string'
        ? env.DATA_GO_KR_SERVICE_KEY.trim() : '';
    if (!serviceKey || /%[0-9a-f]{2}/i.test(serviceKey)) return null;

    const url = new URL(path, DATA_GO_BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('serviceKey', serviceKey);
    return url;
}

const hasDataGoKey = (env) => dataGoUrl(env, '/', {}) !== null;

async function acquireRateLimit(binding, key) {
    if (!binding || typeof binding.limit !== 'function') throw new WeatherUnavailableError();
    let outcome;
    try {
        outcome = await binding.limit({ key });
    } catch {
        throw new WeatherUnavailableError();
    }
    if (outcome?.success !== true) throw new RateLimitExceededError(60);
}

/** 상류 응답을 제한된 크기로 읽어 JSON 폭탄·비정상 대용량 응답을 차단한다. */
async function readJsonResponseLimited(response, maxBytes) {
    const source = await readTextResponseLimited(response, maxBytes);
    if (source === null) return null;
    try {
        return JSON.parse(source);
    } catch {
        return null;
    }
}

async function fetchDataGoJson(env, path, params, maxBytes) {
    const url = dataGoUrl(env, path, params);
    if (!url) return null;
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': 'bora-weather/1.0' },
            signal: AbortSignal.timeout(DATA_GO.UPSTREAM_TIMEOUT_MS),
            cache: 'no-store'
        });
        return await readJsonResponseLimited(response, maxBytes);
    } catch {
        return null;
    }
}

function dataGoItems(payload) {
    const response = payload?.response;
    const resultCode = String(response?.header?.resultCode ?? '');
    if (resultCode !== '00') return null;
    const items = response?.body?.items?.item ?? response?.body?.items;
    if (Array.isArray(items)) return items;
    return items && typeof items === 'object' ? [items] : null;
}

async function fetchAllDataGoItems(env, path, baseParams, maxBytes, maxItems) {
    const pageSize = 1000;
    if (!Number.isInteger(maxItems) || maxItems < 1) return null;
    // 일부 샌드박스는 numOfRows를 지키지 않으므로 한 페이지의 여유를 두되,
    // 누적 item 상한으로 메모리 사용량은 고정한다.
    const maxPages = Math.min(20, Math.ceil(maxItems / pageSize) + 1);
    const all = [];
    let totalCount = null;
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        const payload = await fetchDataGoJson(env, path, {
            ...baseParams, pageNo, numOfRows: pageSize
        }, maxBytes);
        const items = dataGoItems(payload);
        if (!items) return null;

        const declaredTotal = payload?.response?.body?.totalCount;
        if (declaredTotal !== undefined && declaredTotal !== null && declaredTotal !== '') {
            const rawTotal = Number(declaredTotal);
            if (!Number.isInteger(rawTotal) || rawTotal < 0 || rawTotal > maxItems
                || (totalCount !== null && totalCount !== rawTotal)) return null;
            totalCount = rawTotal;
        } else if (totalCount === null) {
            // 일부 샌드박스 응답은 totalCount를 생략한다. 이때는 단일 페이지로만 인정한다.
            totalCount = items.length;
        }
        if (all.length + items.length > maxItems) return null;
        all.push(...items);
        if (all.length >= totalCount) return all.slice(0, totalCount);
        if (!items.length) return null;
    }
    return null;
}

async function getCachedJson(path) {
    try {
        const hit = await caches.default.match(dataGoCacheKey(path));
        return hit ? await hit.json() : null;
    } catch {
        return null;
    }
}

async function putCachedJson(path, value, ttl) {
    try {
        await caches.default.put(dataGoCacheKey(path), new Response(JSON.stringify(value), {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` }
        }));
        return true;
    } catch {
        // 캐시는 호출량·지연 최적화 수단이다. 저장 실패가 정상 상류 응답을 503으로 바꾸면 안 된다.
        return false;
    }
}

const cleanText = (value) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return !text || text === '-' ? null : text;
};

const finiteNumber = (value, allowNegative = true) => {
    const text = cleanText(value);
    if (text === null) return null;
    const number = Number(text);
    if (!Number.isFinite(number) || (!allowNegative && number < 0)) return null;
    return number;
};

const boundedNumber = (value, min, max) => {
    const number = finiteNumber(value);
    return number !== null && number >= min && number <= max ? number : null;
};

// PCP/SNO는 "강수없음", "1.0mm 미만" 같은 공식 표현 자체가 정보이므로 문자열로 보존한다.
const forecastAmount = (value) => cleanText(value);

const skyLabel = (code) => GRID_CATEGORY_LABELS.sky[code] ?? null;
const precipitationTypeLabel = (code) => GRID_CATEGORY_LABELS.pty[code] ?? null;
const FORECAST_CATEGORIES = new Set([
    'TMP', 'T1H', 'REH', 'POP', 'PCP', 'RN1', 'SNO', 'SKY', 'PTY', 'WAV', 'WSD', 'VEC'
]);

function forecastDateTime(baseMs, hour) {
    const at = baseMs + hour * 3600e3;
    return ymd(at) + p2(new Date(at).getUTCHours()) + '00';
}

function forecastItemOffset(item, baseMs) {
    const fcstDate = cleanText(item?.fcstDate);
    const fcstTime = cleanText(item?.fcstTime);
    if (!fcstDate || !/^\d{8}$/.test(fcstDate) || !fcstTime || !/^\d{4}$/.test(fcstTime)) return null;
    if (parseYmdStrict(fcstDate) === null) return null;
    const hour = Number(fcstTime.slice(0, 2));
    const minute = Number(fcstTime.slice(2, 4));
    if (hour > 23 || minute > 59) return null;
    const at = parseYmdH(fcstDate, hour) + minute * 60000;
    const offset = (at - baseMs) / 3600e3;
    return Number.isInteger(offset) && offset >= 0 && offset <= 48 ? offset : null;
}

function hasRecognizedForecast(items, baseDate, baseTime) {
    const baseMs = parseYmdH(baseDate, Number(baseTime.slice(0, 2)));
    return items.some((item) => FORECAST_CATEGORIES.has(item?.category)
        && forecastItemOffset(item, baseMs) !== null);
}

function parseForecastItems(items, baseDate, baseTime) {
    const baseMs = parseYmdH(baseDate, Number(baseTime.slice(0, 2)));
    const slots = Array.from({ length: 49 }, (_, forecastHour) => ({
        forecastHour,
        forecastDateTime: forecastDateTime(baseMs, forecastHour),
        temperature: null,
        humidity: null,
        precipitationProbability: null,
        precipitationAmount: null,
        snowfallAmount: null,
        skyCode: null,
        skyLabel: null,
        precipitationType: null,
        precipitationTypeLabel: null,
        waveHeight: null,
        windSpeed: null,
        windDirection: null
    }));

    for (const item of items) {
        const offset = forecastItemOffset(item, baseMs);
        if (offset === null) continue;

        const slot = slots[offset];
        switch (item.category) {
            case 'TMP': case 'T1H': slot.temperature = boundedNumber(item.fcstValue, -100, 80); break;
            case 'REH': slot.humidity = boundedNumber(item.fcstValue, 0, 100); break;
            case 'POP': slot.precipitationProbability = boundedNumber(item.fcstValue, 0, 100); break;
            case 'PCP': case 'RN1': slot.precipitationAmount = forecastAmount(item.fcstValue); break;
            case 'SNO': slot.snowfallAmount = forecastAmount(item.fcstValue); break;
            case 'SKY': {
                const code = finiteNumber(item.fcstValue, false);
                slot.skyCode = Number.isInteger(code) && [1, 3, 4].includes(code) ? code : null;
                slot.skyLabel = skyLabel(slot.skyCode);
                break;
            }
            case 'PTY': {
                const code = finiteNumber(item.fcstValue, false);
                slot.precipitationType = Number.isInteger(code) && code >= 0 && code <= 4 ? code : null;
                slot.precipitationTypeLabel = precipitationTypeLabel(slot.precipitationType);
                break;
            }
            case 'WAV': slot.waveHeight = boundedNumber(item.fcstValue, 0, 50); break;
            case 'WSD': slot.windSpeed = boundedNumber(item.fcstValue, 0, 150); break;
            case 'VEC': slot.windDirection = boundedNumber(item.fcstValue, 0, 360); break;
        }
    }
    return slots;
}

async function loadForecastItems(env, baseDate, baseTime, nx, ny) {
    const cachePath = `/forecast/${baseDate}${baseTime}/${nx}_${ny}`;
    const cached = await getCachedJson(cachePath);
    if (Array.isArray(cached) && cached.length > 0 && hasRecognizedForecast(cached, baseDate, baseTime)) return cached;

    // 좌표를 바꿔 캐시 miss를 계속 만드는 공개 프록시 남용을 상류 호출 직전에 차단한다.
    // Rate Limiting binding은 PoP 로컬·eventually consistent이므로 정확한 과금 장부가 아니라
    // cold burst 완화용 refresh budget으로 사용한다.
    await acquireRateLimit(env.FORECAST_REFRESH_LIMITER, 'data-go:forecast-refresh');
    const raced = await getCachedJson(cachePath);
    if (Array.isArray(raced) && raced.length > 0 && hasRecognizedForecast(raced, baseDate, baseTime)) return raced;

    const items = await fetchAllDataGoItems(env, DATA_GO.KMA_FORECAST_PATH, {
        dataType: 'JSON',
        base_date: baseDate,
        base_time: baseTime,
        nx,
        ny
    }, DATA_GO.MAX_FORECAST_BYTES, DATA_GO.MAX_FORECAST_ITEMS);
    if (!items?.length || !hasRecognizedForecast(items, baseDate, baseTime)) return null;
    await putCachedJson(cachePath, items, DATA_GO.FORECAST_TTL);
    return items;
}

async function buildStationForecast(env, latitude, longitude, baseDate, baseTime) {
    const [nx, ny] = LCC.latLonToGrid(latitude, longitude);
    const items = await loadForecastItems(env, baseDate, baseTime, nx, ny);
    if (!items) throw new WeatherUnavailableError();
    return {
        baseDate,
        baseTime,
        latitude,
        longitude,
        source: '기상청 단기예보',
        items: parseForecastItems(items, baseDate, baseTime)
    };
}

function stationCoordinate(item) {
    const x = finiteNumber(item?.dmX);
    const y = finiteNumber(item?.dmY);
    if (x === null || y === null) return null;
    if (x >= 122 && x <= 134 && y >= 32 && y <= 44) return { latitude: y, longitude: x };
    if (y >= 122 && y <= 134 && x >= 32 && x <= 44) return { latitude: x, longitude: y };
    return null;
}

function normalizeStationLocations(items) {
    const unique = new Map();
    for (const item of items) {
        const name = cleanText(item?.stationName);
        const coordinate = stationCoordinate(item);
        if (!name || !coordinate) continue;
        const station = {
            name,
            address: cleanText(item.addr),
            network: cleanText(item.mangName),
            ...coordinate
        };
        const key = `${normalizeStationKey(name)}@${station.latitude},${station.longitude}`;
        unique.set(key, station);
    }
    return [...unique.values()];
}

function normalizeGrade(value) {
    const grade = finiteNumber(value, false);
    return Number.isInteger(grade) && grade >= 1 && grade <= 4 ? grade : null;
}

// 지도는 1시간 농도 구간을 사용하므로 24시간 등급(pm*Grade)을 섞지 않는다.
function hourlyGrade(value) { return normalizeGrade(value); }

function normalizeStationKey(value) {
    return String(value ?? '').toLowerCase()
        .replace(/[\s(),.·_-]+|\[|\]/g, '')
        .replace(/측정소/g, '');
}

const STATION_REGION_ALIASES = [
    ['서울', ['서울특별시', '서울']], ['부산', ['부산광역시', '부산']],
    ['대구', ['대구광역시', '대구']], ['인천', ['인천광역시', '인천']],
    ['대전', ['대전광역시', '대전']], ['광주', ['광주광역시', '광주']],
    ['울산', ['울산광역시', '울산']], ['경기', ['경기도', '경기']],
    ['강원', ['강원특별자치도', '강원도', '강원']], ['충북', ['충청북도', '충북']],
    ['충남', ['충청남도', '충남']], ['전북', ['전북특별자치도', '전라북도', '전북']],
    ['전남', ['전라남도', '전남']], ['경북', ['경상북도', '경북']],
    ['경남', ['경상남도', '경남']], ['제주', ['제주특별자치도', '제주도', '제주']],
    ['세종', ['세종특별자치시', '세종']]
];

function stationRegion(value) {
    const normalized = normalizeStationKey(value);
    for (const [region, names] of STATION_REGION_ALIASES) {
        if (names.some((name) => normalized.startsWith(name))) return region;
    }
    return null;
}

function selectStationLocation(measurement, candidates) {
    if (!candidates.length) return null;
    let narrowed = candidates.slice();

    const region = stationRegion(measurement?.sidoName);
    if (narrowed.length > 1 && region) {
        const matches = narrowed.filter((value) => stationRegion(value.address) === region);
        if (matches.length) narrowed = matches;
    }
    const address = cleanText(measurement?.addr);
    if (narrowed.length > 1 && address) {
        const normalizedAddress = normalizeStationKey(address);
        const matches = narrowed.filter((value) => normalizeStationKey(value.address) === normalizedAddress);
        if (matches.length) narrowed = matches;
    }
    const network = cleanText(measurement?.mangName);
    if (narrowed.length > 1 && network) {
        const normalizedNetwork = normalizeStationKey(network);
        const matches = narrowed.filter((value) => normalizeStationKey(value.network) === normalizedNetwork);
        if (matches.length) narrowed = matches;
    }
    return narrowed.length === 1 ? narrowed[0] : null;
}

function buildAirSnapshot(measureItems, locations) {
    const locationsByName = new Map();
    for (const station of locations) {
        const key = normalizeStationKey(station.name);
        if (!locationsByName.has(key)) locationsByName.set(key, []);
        locationsByName.get(key).push(station);
    }
    const deduplicated = new Map();
    let dataTime = null;

    for (const item of measureItems) {
        const name = cleanText(item?.stationName);
        const stationTime = cleanText(item?.dataTime);
        if (stationTime && (!dataTime || stationTime > dataTime)) dataTime = stationTime;
        const candidates = name ? (locationsByName.get(normalizeStationKey(name)) || []) : [];
        const location = selectStationLocation(item, candidates);
        if (!location) continue;
        const pm10Flag = cleanText(item.pm10Flag);
        const pm25Flag = cleanText(item.pm25Flag);
        const pm10 = pm10Flag ? null : boundedNumber(item.pm10Value, 0, 2000);
        const pm25 = pm25Flag ? null : boundedNumber(item.pm25Value, 0, 1000);
        const value = {
            name,
            address: location.address,
            network: cleanText(item.mangName) ?? location.network,
            latitude: location.latitude,
            longitude: location.longitude,
            pm10,
            pm25,
            pm10Grade: hourlyGrade(item.pm10Grade1h),
            pm25Grade: hourlyGrade(item.pm25Grade1h),
            pm10Flag,
            pm25Flag,
            dataTime: stationTime
        };
        const key = `${normalizeStationKey(name)}@${location.latitude},${location.longitude}`;
        const previous = deduplicated.get(key);
        if (!previous || previous.dataTime === null
            || (value.dataTime !== null && value.dataTime > previous.dataTime)) deduplicated.set(key, value);
    }
    const stations = [...deduplicated.values()];
    if (!stations.length || !dataTime
        || !stations.some((station) => station.pm10 !== null || station.pm25 !== null)) return null;
    stations.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { dataTime, source: 'AirKorea', stations };
}

async function loadStationLocations(env) {
    const cachePath = '/air/stations';
    const cached = await getCachedJson(cachePath);
    if (Array.isArray(cached) && cached.length > 0) return cached;

    await acquireRateLimit(env.AIR_REFRESH_LIMITER, 'data-go:air-stations-refresh');
    const raced = await getCachedJson(cachePath);
    if (Array.isArray(raced) && raced.length > 0) return raced;

    const items = await fetchAllDataGoItems(env, DATA_GO.AIR_STATION_PATH, {
        returnType: 'json', ver: '1.1'
    }, DATA_GO.MAX_AIR_BYTES, DATA_GO.MAX_AIR_STATION_ITEMS);
    const locations = normalizeStationLocations(items || []);
    if (!locations.length) return null;
    await putCachedJson(cachePath, locations, DATA_GO.AIR_STATION_TTL);
    return locations;
}

async function loadAirSnapshot(env) {
    const freshPath = '/air/latest';
    const stalePath = '/air/latest-stale';
    const failedPath = '/air/refresh-failed';
    const fresh = await getCachedJson(freshPath);
    if (fresh?.source === 'AirKorea' && Array.isArray(fresh.stations) && fresh.stations.length) {
        return { ...fresh, stale: false };
    }

    // 미승인·장애 상태에서 공개 요청마다 500/day 개발 한도를 소진하지 않도록
    // 한 번 실패하면 같은 PoP의 갱신을 15분 동안 차단한다.
    const refreshBlocked = (await getCachedJson(failedPath))?.failed === true;
    let rateLimitError = null;
    if (!refreshBlocked) {
        try {
            const locations = await loadStationLocations(env);
            if (locations) {
                await acquireRateLimit(env.AIR_REFRESH_LIMITER, 'data-go:air-measurements-refresh');
                const raced = await getCachedJson(freshPath);
                if (raced?.source === 'AirKorea' && Array.isArray(raced.stations) && raced.stations.length) {
                    return { ...raced, stale: false };
                }
                const measureItems = await fetchAllDataGoItems(env, DATA_GO.AIR_MEASURE_PATH, {
                    returnType: 'json', sidoName: '전국', ver: '1.3'
                }, DATA_GO.MAX_AIR_BYTES, DATA_GO.MAX_AIR_MEASURE_ITEMS);
                const snapshot = buildAirSnapshot(measureItems || [], locations);
                if (snapshot) {
                    // Cache API와 Rate Limiting binding은 모두 PoP 단위다. 전역 일일 한도는
                    // 단일 수집기 + KV/R2 snapshot 구조 없이는 엄밀하게 보장할 수 없다.
                    await Promise.all([
                        putCachedJson(freshPath, snapshot, DATA_GO.AIR_FRESH_TTL),
                        putCachedJson(stalePath, snapshot, DATA_GO.AIR_STALE_TTL)
                    ]);
                    return { ...snapshot, stale: false };
                }
            }
            await putCachedJson(failedPath, { failed: true }, DATA_GO.AIR_FAILURE_TTL);
        } catch (error) {
            if (error instanceof RateLimitExceededError) rateLimitError = error;
            else throw error;
        }
    }

    const stale = await getCachedJson(stalePath);
    if (stale?.source === 'AirKorea' && Array.isArray(stale.stations) && stale.stations.length) {
        return { ...stale, stale: true };
    }
    if (rateLimitError) throw rateLimitError;
    return null;
}

async function buildAirQuality(env, bounds) {
    const snapshot = await loadAirSnapshot(env);
    if (!snapshot) throw new WeatherUnavailableError();
    const stations = snapshot.stations.filter((station) =>
        station.latitude >= bounds.minLat && station.latitude <= bounds.maxLat
        && station.longitude >= bounds.minLon && station.longitude <= bounds.maxLon);
    const times = stations.map((station) => station.dataTime).filter(Boolean).sort();
    return {
        dataTime: times.at(-1) || snapshot.dataTime,
        dataTimeFrom: times[0] || snapshot.dataTime,
        stale: snapshot.stale,
        source: snapshot.source,
        stations
    };
}

/* ==================== 국가교통정보센터(ITS) CCTV ==================== */

const cctvProperty = (item, ...names) => {
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(item, name)) return item[name];
    }
    return undefined;
};

function cctvText(value, maxLength) {
    if (value === undefined || value === null) return { value: null, malformed: false };
    if (typeof value !== 'string') return { value: null, malformed: true };
    const normalized = value.trim();
    if (!normalized || normalized === '-') return { value: null, malformed: false };
    if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
        return { value: null, malformed: true };
    }
    return { value: normalized, malformed: false };
}

function cctvCoordinate(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,12})?$/.test(value.trim())) return null;
    const coordinate = Number(value);
    return Number.isFinite(coordinate) ? coordinate : null;
}

function cctvStreamUrl(value) {
    const textValue = cctvText(value, CCTV.MAX_STREAM_URL_LENGTH);
    if (textValue.value === null || textValue.malformed || /[\s?#]/.test(textValue.value)) return null;
    const authority = textValue.value.slice(textValue.value.indexOf('://') + 3).split('/', 1)[0];
    if (authority.includes('@')) return null;
    let url;
    try {
        url = new URL(textValue.value);
    } catch {
        return null;
    }
    if (url.origin !== CCTV.STREAM_ORIGIN || url.protocol !== 'https:'
        || url.username || url.password || url.hash || url.search
        || !url.pathname || url.pathname === '/') return null;
    return url.href;
}

function cctvCount(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value >= 0 && value <= CCTV.MAX_DECLARED_COUNT ? value : null;
    }
    if (typeof value !== 'string' || !/^\d{1,6}$/.test(value.trim())) return null;
    const parsed = Number(value);
    return parsed <= CCTV.MAX_DECLARED_COUNT ? parsed : null;
}

function compareCctvs(a, b) {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return a.latitude - b.latitude || a.longitude - b.longitude;
}

function cctvTiles(bounds) {
    const minLatIndex = Math.floor(bounds.minLat * CCTV.TILE_SCALE);
    const maxLatIndex = Math.ceil(bounds.maxLat * CCTV.TILE_SCALE) - 1;
    const minLonIndex = Math.floor(bounds.minLon * CCTV.TILE_SCALE);
    const maxLonIndex = Math.ceil(bounds.maxLon * CCTV.TILE_SCALE) - 1;
    const tileCount = (maxLatIndex - minLatIndex + 1) * (maxLonIndex - minLonIndex + 1);
    if (!Number.isInteger(tileCount) || tileCount < 1 || tileCount > CCTV.MAX_TILES) return null;

    const tiles = [];
    for (let latIndex = minLatIndex; latIndex <= maxLatIndex; latIndex++) {
        for (let lonIndex = minLonIndex; lonIndex <= maxLonIndex; lonIndex++) {
            tiles.push({
                latIndex,
                lonIndex,
                minLat: latIndex / CCTV.TILE_SCALE,
                maxLat: (latIndex + 1) / CCTV.TILE_SCALE,
                minLon: lonIndex / CCTV.TILE_SCALE,
                maxLon: (lonIndex + 1) / CCTV.TILE_SCALE
            });
        }
    }
    return tiles;
}

function cctvSupertiles(baseTiles) {
    const unique = new Map();
    for (const baseTile of baseTiles) {
        const latIndex = Math.floor(baseTile.latIndex / 2);
        const lonIndex = Math.floor(baseTile.lonIndex / 2);
        const key = `${latIndex}_${lonIndex}`;
        if (unique.has(key)) continue;
        unique.set(key, {
            latIndex,
            lonIndex,
            minLat: latIndex / CCTV.SUPERTILE_SCALE,
            maxLat: (latIndex + 1) / CCTV.SUPERTILE_SCALE,
            minLon: lonIndex / CCTV.SUPERTILE_SCALE,
            maxLon: (lonIndex + 1) / CCTV.SUPERTILE_SCALE
        });
    }
    const supertiles = [...unique.values()];
    return supertiles.length <= CCTV.MAX_SUPERTILES ? supertiles : null;
}

function normalizeCctvItem(raw, tile) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = cctvText(cctvProperty(raw, 'cctvname', 'cctvName'), 200);
    const latitude = cctvCoordinate(cctvProperty(raw, 'coordy', 'coordY', 'latitude'));
    const longitude = cctvCoordinate(cctvProperty(raw, 'coordx', 'coordX', 'longitude'));
    const streamUrl = cctvStreamUrl(cctvProperty(raw, 'cctvurl', 'cctvUrl', 'streamUrl'));
    const rawType = cctvProperty(raw, 'cctvtype', 'cctvType');
    const coordinateEpsilon = 1e-7;
    if (name.value === null || name.malformed || latitude === null || longitude === null || streamUrl === null
        || (rawType !== undefined && rawType !== null
            && !((typeof rawType === 'string' || typeof rawType === 'number') && String(rawType).trim() === '4'))
        || latitude < 32 || latitude > 44 || longitude < 122 || longitude > 134
        || latitude < tile.minLat - coordinateEpsilon || latitude > tile.maxLat + coordinateEpsilon
        || longitude < tile.minLon - coordinateEpsilon || longitude > tile.maxLon + coordinateEpsilon) return null;

    const format = cctvText(cctvProperty(raw, 'cctvformat', 'cctvFormat', 'format'), 32);
    const resolution = cctvText(cctvProperty(raw, 'cctvresolution', 'cctvResolution', 'resolution'), 64);
    const fileCreatedAt = cctvText(cctvProperty(raw, 'filecreatetime', 'fileCreateTime', 'fileCreatedAt'), 32);
    const roadSectionId = cctvText(cctvProperty(raw, 'roadsectionid', 'roadSectionId'), 128);
    if (format.value !== 'HLS' || format.malformed) return null;
    const malformedOptional = format.malformed || resolution.malformed
        || fileCreatedAt.malformed || roadSectionId.malformed;
    const id = `${roadSectionId.value ? `${roadSectionId.value}|` : ''}${name.value}`
        + `@${latitude.toFixed(7)},${longitude.toFixed(7)}`;
    return {
        value: {
            id,
            name: name.value,
            latitude,
            longitude,
            streamUrl,
            format: format.value,
            resolution: resolution.value,
            fileCreatedAt: fileCreatedAt.value,
            roadSectionId: roadSectionId.value
        },
        malformedOptional
    };
}

function normalizeCctvPayload(payload, tile) {
    const root = payload?.response ?? payload;
    if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
    const resultCode = root?.header?.resultCode;
    if (resultCode !== undefined && !['0', '00'].includes(String(resultCode))) return null;

    const body = root.body && typeof root.body === 'object' && !Array.isArray(root.body) ? root.body : null;
    const declaredCount = cctvCount(root.datacount ?? root.dataCount ?? root.totalCount
        ?? body?.datacount ?? body?.dataCount ?? body?.totalCount);
    if (declaredCount === null) return null;

    let rawData = body?.items ?? body?.data ?? root.items ?? root.data;
    if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        && Object.prototype.hasOwnProperty.call(rawData, 'item')) rawData = rawData.item;
    let items;
    if (Array.isArray(rawData)) items = rawData;
    else if (rawData && typeof rawData === 'object') items = [rawData];
    else if (declaredCount === 0 && (rawData === undefined || rawData === null)) items = [];
    else return null;

    let truncated = declaredCount !== items.length || items.length > CCTV.MAX_UPSTREAM_ITEMS;
    const normalized = new Map();
    const processCount = Math.min(items.length, CCTV.MAX_UPSTREAM_ITEMS);
    for (let index = 0; index < processCount; index++) {
        const item = normalizeCctvItem(items[index], tile);
        if (!item) {
            truncated = true;
            continue;
        }
        if (!normalized.has(item.value.id)) normalized.set(item.value.id, item.value);
    }
    if (declaredCount > 0 && normalized.size === 0) return null;
    const cctvs = [...normalized.values()].sort(compareCctvs);
    return { cctvs, truncated };
}

function validateCachedCctvSnapshot(value, tile) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.fetchedAt !== 'string' || value.fetchedAt.length > 40
        || !Number.isFinite(Date.parse(value.fetchedAt)) || typeof value.truncated !== 'boolean'
        || !Array.isArray(value.cctvs) || value.cctvs.length > CCTV.MAX_UPSTREAM_ITEMS) return null;

    const cctvs = [];
    for (const item of value.cctvs) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
            || typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 384) return null;
        const normalized = normalizeCctvItem({
            cctvname: item.name,
            coordy: item.latitude,
            coordx: item.longitude,
            cctvurl: item.streamUrl,
            cctvformat: item.format,
            cctvresolution: item.resolution,
            filecreatetime: item.fileCreatedAt,
            roadsectionid: item.roadSectionId
        }, tile);
        if (!normalized || normalized.malformedOptional || normalized.value.id !== item.id) return null;
        cctvs.push(normalized.value);
    }
    return { fetchedAt: value.fetchedAt, truncated: value.truncated, cctvs };
}

const cctvTimestamp = (value) => Number.isSafeInteger(value) && value >= 0;

function validateCachedCctvState(value, tile) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !cctvTimestamp(value.freshUntil) || !cctvTimestamp(value.staleUntil)
        || !cctvTimestamp(value.retryAfter)) return null;

    if (value.snapshot === null) {
        return value.freshUntil === 0 && value.staleUntil === 0 && value.retryAfter > 0
            ? { snapshot: null, freshUntil: 0, staleUntil: 0, retryAfter: value.retryAfter }
            : null;
    }
    const snapshot = validateCachedCctvSnapshot(value.snapshot, tile);
    if (!snapshot) return null;
    const fetchedAt = Date.parse(snapshot.fetchedAt);
    if (value.freshUntil !== fetchedAt + CCTV.FRESH_TTL * 1000
        || value.staleUntil !== fetchedAt + CCTV.STALE_TTL * 1000) return null;
    return {
        snapshot,
        freshUntil: value.freshUntil,
        staleUntil: value.staleUntil,
        retryAfter: value.retryAfter
    };
}

function itsApiUrl(env, tile) {
    const apiKey = typeof env.ITS_API_KEY === 'string' ? env.ITS_API_KEY.trim() : '';
    if (!apiKey || apiKey.length > 512 || apiKey.includes('%')
        || /[\u0000-\u001f\u007f]/.test(apiKey)) return null;
    const url = new URL(CCTV.PATH, ITS_BASE);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('type', 'all');
    url.searchParams.set('cctvType', '4');
    url.searchParams.set('minX', String(tile.minLon));
    url.searchParams.set('maxX', String(tile.maxLon));
    url.searchParams.set('minY', String(tile.minLat));
    url.searchParams.set('maxY', String(tile.maxLat));
    url.searchParams.set('getType', 'json');
    return url;
}

async function getItsCachedJson(path) {
    try {
        const hit = await caches.default.match(itsCacheKey(path));
        return hit ? await hit.json() : null;
    } catch {
        return null;
    }
}

async function putItsCachedJson(path, value, ttl) {
    try {
        await caches.default.put(itsCacheKey(path), new Response(JSON.stringify(value), {
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` }
        }));
        return true;
    } catch {
        return false;
    }
}

const cctvStateCachePath = (tile) => `/cctv/v2/${tile.latIndex}_${tile.lonIndex}/state`;
const CCTV_CIRCUIT_CACHE_PATH = '/cctv/v2/live-circuit';

function validateCachedCctvCircuit(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !cctvTimestamp(value.retryAfter)) return null;
    return { retryAfter: value.retryAfter };
}

class CctvDeadlineError extends Error { }

function ensureCctvDeadline(signal, deadlineAt) {
    if (signal?.aborted || Date.now() >= deadlineAt) throw new CctvDeadlineError();
}

function cctvUpstreamSignal(parentSignal) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timeout = setTimeout(() => controller.abort(), CCTV.UPSTREAM_TIMEOUT_MS);
    return {
        signal: controller.signal,
        cleanup() {
            clearTimeout(timeout);
            parentSignal?.removeEventListener('abort', abortFromParent);
        }
    };
}

async function fetchCctvSupertile(env, tile, parentSignal, deadlineAt) {
    ensureCctvDeadline(parentSignal, deadlineAt);
    const url = itsApiUrl(env, tile);
    if (!url) return null;
    const upstream = cctvUpstreamSignal(parentSignal);
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': 'bora-weather/1.0' },
            signal: upstream.signal,
            cache: 'no-store'
        });
        if (!response.ok) {
            logUpstreamFailure('its', 'cctv', `http_${response.status}`);
            if (response.body) await response.body.cancel('upstream response rejected').catch(() => { });
            return null;
        }
        const payload = await readJsonResponseLimited(response, CCTV.MAX_RESPONSE_BYTES);
        const normalized = normalizeCctvPayload(payload, tile);
        if (!normalized) {
            logUpstreamFailure('its', 'cctv', payload === null ? 'invalid_or_oversized_body' : 'invalid_schema');
        }
        ensureCctvDeadline(parentSignal, deadlineAt);
        return normalized ? { fetchedAt: new Date().toISOString(), ...normalized } : null;
    } catch (error) {
        if (parentSignal?.aborted || Date.now() >= deadlineAt) throw new CctvDeadlineError();
        logUpstreamFailure('its', 'cctv', error?.name === 'AbortError' ? 'timeout' : 'fetch_error');
        return null;
    } finally {
        upstream.cleanup();
    }
}

async function loadCctvSupertile(env, tile, parentSignal, deadlineAt, circuitOpen, markLiveFailure) {
    ensureCctvDeadline(parentSignal, deadlineAt);
    const statePath = cctvStateCachePath(tile);
    const state = validateCachedCctvState(await getItsCachedJson(statePath), tile);
    ensureCctvDeadline(parentSignal, deadlineAt);
    const now = Date.now();
    if (state?.snapshot && now < state.freshUntil) return { ...state.snapshot, stale: false };

    // 잘못된 키 요청이 타일의 negative cache를 만들어 정상 키 요청까지 막지 않게 한다.
    if (!itsApiUrl(env, tile)) return null;
    if (state && now < state.retryAfter) {
        if (state.snapshot && now < state.staleUntil) return { ...state.snapshot, stale: true };
        return null;
    }
    if (circuitOpen) {
        if (state?.snapshot && now < state.staleUntil) return { ...state.snapshot, stale: true };
        return null;
    }

    let refreshError = null;
    try {
        await acquireRateLimit(env.CCTV_REFRESH_LIMITER, 'its:cctv-refresh');
        ensureCctvDeadline(parentSignal, deadlineAt);
        const snapshot = await fetchCctvSupertile(env, tile, parentSignal, deadlineAt);
        if (snapshot) {
            ensureCctvDeadline(parentSignal, deadlineAt);
            const fetchedAt = Date.parse(snapshot.fetchedAt);
            await putItsCachedJson(statePath, {
                snapshot,
                freshUntil: fetchedAt + CCTV.FRESH_TTL * 1000,
                staleUntil: fetchedAt + CCTV.STALE_TTL * 1000,
                retryAfter: 0
            }, CCTV.STALE_TTL);
            return { ...snapshot, stale: false };
        }

        ensureCctvDeadline(parentSignal, deadlineAt);
        markLiveFailure();
        const failedAt = Date.now();
        const staleSnapshot = state?.snapshot && failedAt < state.staleUntil ? state.snapshot : null;
        if (staleSnapshot) return { ...staleSnapshot, stale: true };

        // 실패 상태는 타일마다 쓰지 않는다. 요청이 끝날 때 PoP 전역 circuit을 한 번만
        // 저장해, 14개 supertile 최악 경로도 Free 플랜 50 subrequest 안에 둔다.
        return null;
    } catch (error) {
        if (parentSignal?.aborted || Date.now() >= deadlineAt) throw new CctvDeadlineError();
        if (error instanceof RateLimitExceededError || error instanceof WeatherUnavailableError) refreshError = error;
        else throw error;
    }

    const staleAt = Date.now();
    if (state?.snapshot && staleAt < state.staleUntil) return { ...state.snapshot, stale: true };
    if (refreshError) throw refreshError;
    return null;
}

async function mapCctvSupertiles(tiles, mapper, controller, deadlineAt) {
    const results = new Array(tiles.length);
    let nextIndex = 0;
    let firstError = null;
    const workers = Array.from({ length: Math.min(CCTV.FETCH_CONCURRENCY, tiles.length) }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= tiles.length) return;
            if (firstError) continue;
            try {
                ensureCctvDeadline(controller.signal, deadlineAt);
                results[index] = await mapper(tiles[index]);
            } catch (error) {
                firstError ||= error;
                if (!controller.signal.aborted) controller.abort(error);
            }
        }
    });
    await Promise.all(workers);
    if (firstError) throw firstError;
    return results;
}

async function buildCctv(env, bounds, supertiles) {
    const hasValidApiKey = Boolean(supertiles[0] && itsApiUrl(env, supertiles[0]));
    if (!hasValidApiKey) throw new WeatherUnavailableError();

    const controller = new AbortController();
    const deadlineAt = Date.now() + CCTV.OVERALL_TIMEOUT_MS;
    const deadline = setTimeout(() => controller.abort(new CctvDeadlineError()), CCTV.OVERALL_TIMEOUT_MS);
    // 인증키가 없거나 잘못된 경우에는 circuit을 읽거나 쓰지 않아 정상 키의 PoP 상태를
    // 오염시키지 않는다. Cache API 오류는 miss/write 실패로만 취급한다.
    const circuitState = validateCachedCctvCircuit(await getItsCachedJson(CCTV_CIRCUIT_CACHE_PATH));
    const circuitOpen = Boolean(circuitState && Date.now() < circuitState.retryAfter);
    let firstLiveFailureAt = 0;
    const markLiveFailure = () => { firstLiveFailureAt ||= Date.now(); };
    let tileSnapshots;
    try {
        tileSnapshots = await mapCctvSupertiles(supertiles,
            (tile) => loadCctvSupertile(env, tile, controller.signal, deadlineAt,
                circuitOpen, markLiveFailure),
            controller, deadlineAt);
        ensureCctvDeadline(controller.signal, deadlineAt);
    } catch (error) {
        if (error instanceof CctvDeadlineError) throw new WeatherUnavailableError();
        throw error;
    } finally {
        clearTimeout(deadline);
        if (firstLiveFailureAt) {
            await putItsCachedJson(CCTV_CIRCUIT_CACHE_PATH, {
                retryAfter: firstLiveFailureAt + CCTV.CIRCUIT_FAILURE_TTL * 1000
            }, CCTV.CIRCUIT_FAILURE_TTL);
        }
    }
    if (tileSnapshots.some((snapshot) => !snapshot)) throw new WeatherUnavailableError();

    let fetchedAt = null;
    let stale = false;
    let truncated = false;
    const deduplicated = new Map();
    for (const snapshot of tileSnapshots) {
        if (fetchedAt === null || snapshot.fetchedAt < fetchedAt) fetchedAt = snapshot.fetchedAt;
        stale ||= snapshot.stale;
        truncated ||= snapshot.truncated;
        for (const cctv of snapshot.cctvs) {
            if (cctv.latitude < bounds.minLat || cctv.latitude > bounds.maxLat
                || cctv.longitude < bounds.minLon || cctv.longitude > bounds.maxLon) continue;
            if (!deduplicated.has(cctv.id)) deduplicated.set(cctv.id, cctv);
        }
    }

    const all = [...deduplicated.values()].sort(compareCctvs);
    if (all.length > CCTV.MAX_RESULTS) truncated = true;
    return {
        fetchedAt,
        stale,
        truncated,
        source: '국가교통정보센터(ITS)',
        cctvs: all.slice(0, CCTV.MAX_RESULTS)
    };
}

/* ==================== 지점 시계열 ==================== */

const STATION_SERIES_CATEGORIES = new Set(['WSD', 'VEC', 'TMP', 'T1H']);

function finiteForecastNumber(value) {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** getVilageFcst 49슬롯 병합 — Spring getStationTimeSeries 동일 (slot: {ws,dir,tmp}) */
async function vilageSeries(env, baseDate, baseTime, nx, ny, beforeFetch) {
    const url = kmaUrl('/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst', {
        pageNo: 1, numOfRows: 1000, dataType: 'JSON', base_date: baseDate, base_time: baseTime,
        nx, ny, authKey: env.KMA_API_AUTH_KEY
    });
    let validatedItems = null;
    const text = await cachedText(`/stn/${baseDate}${baseTime}/${nx}_${ny}`, url, (t) => {
        // resultCode 00이어도 items가 빈 응답이 있다 — 캐시에 박히면 1시간 동안 503이
        // 고정되므로(Spring은 비어 있으면 캐시하지 않음) 실데이터 존재까지 확인한다
        try {
            const parsed = JSON.parse(t);
            if (parsed?.response?.header?.resultCode !== '00') return false;
            const items = parsed.response?.body?.items?.item;
            const valid = Array.isArray(items) && items.some((item) =>
                STATION_SERIES_CATEGORIES.has(item?.category)
                && finiteForecastNumber(item?.fcstValue) !== null);
            if (valid) validatedItems = items;
            return valid;
        } catch { return false; }
    }, { ttl: 3600, maxBytes: KMA.MAX_STATION_BYTES, beforeFetch });
    if (!text) return null;

    let items = validatedItems;
    if (!items) {
        try { items = JSON.parse(text).response.body.items.item; } catch { return null; }
    }
    if (!Array.isArray(items)) return null;

    const merged = new Map();    // fcstDate+fcstTime → {ws,dir,tmp}; null은 카테고리 누락
    for (const it of items) {
        if (!STATION_SERIES_CATEGORIES.has(it?.category)) continue;
        const value = finiteForecastNumber(it.fcstValue);
        if (value === null) continue;
        const key = it.fcstDate + it.fcstTime;
        if (!merged.has(key)) merged.set(key, { ws: null, dir: null, tmp: null });
        const m = merged.get(key);
        switch (it.category) {
            case 'WSD': m.ws = value; break;
            case 'VEC': m.dir = value; break;
            case 'TMP': case 'T1H': m.tmp = value; break;
        }
    }
    if (merged.size === 0) return null;

    const baseMs = parseYmdH(baseDate, +baseTime.slice(0, 2));
    const slots = new Array(49).fill(null);
    for (const [key, m] of merged) {
        const fcstMs = parseYmdH(key.slice(0, 8), +key.slice(8, 10));
        const off = Math.round((fcstMs - baseMs) / 3600e3);
        if (off < 0 || off > 48) continue;
        slots[off] = m;
    }
    return slots;
}

async function buildStationData(env, lat, lon, baseDateIn, baseTimeIn, element) {
    const [baseDate, baseTime] = snapBase(baseDateIn, baseTimeIn);
    let refreshLimitPromise = null;
    const acquireStationRefresh = () => {
        refreshLimitPromise ||= acquireRateLimit(env.STATION_REFRESH_LIMITER, 'kma:station-refresh');
        return refreshLimitPromise;
    };

    // 일사강도 시계열 — KIM NE57 dswrsfc. 2026-07-01 이후 실제 시간별 자료를 사용한다.
    if (element === 'swdn') {
        const idx = kimLatLonToIndex(lat, lon);
        // KIM 크롭(≤40.0N) 밖은 영구 결측 — 업스트림 호출 전에 400으로 끊는다 (Spring 동일 정책)
        if (!idx) throw new OutOfCoverageError('일사강도 지원 범위 밖 지점');
        return await solarStationSeries(env, baseDate, baseTime, idx[0], idx[1], acquireStationRefresh);
    }

    // DFS 단기예보 시계열 (바람 10m / 기온)
    const [nx, ny] = LCC.latLonToGrid(lat, lon);
    const slots = await vilageSeries(env, baseDate, baseTime, nx, ny, acquireStationRefresh);
    const out = [];
    for (let h = 0; h <= 48; h++) {
        const s = slots ? slots[h] : null;
        if (!s) { out.push([9999, element === 'tmp' ? 0 : 9999]); continue; }
        out.push(element === 'tmp'
            ? [Number.isFinite(s.tmp) ? s.tmp : 9999, 0]
            : [Number.isFinite(s.ws) ? s.ws : 9999,
                Number.isFinite(s.dir) ? s.dir : 9999]);
    }
    // 단기예보 조회는 발표 +1시간부터 제공 — 분포도의 leadHours=0→+1h 보정과 같은 규칙으로 첫 슬롯 백필
    if (out.length >= 2) {
        const v0 = out[0][0], v1 = out[1][0];
        if ((v0 >= 9000 || v0 <= -900) && v1 < 9000 && v1 > -900) out[0] = out[1].slice();
    }
    return out;
}

/* ==================== 라우팅 ==================== */

// 모든 응답에 붙는 보안 헤더 (정적 자산은 public/_headers가 담당)
const SEC_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
};
const json = (obj, options = {}) => new Response(JSON.stringify(obj), {
    status: options.status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS, ...(options.headers || {}) }
});
const text = (s, options = {}) => new Response(s, {
    status: options.status || 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS, ...(options.headers || {}) }
});
const hasKmaKey = (env) => typeof env.KMA_API_AUTH_KEY === 'string' && env.KMA_API_AUTH_KEY.trim().length > 0;

function isLocalHttp(url) {
    return url.protocol === 'http:' && (
        url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname === '[::1]'
    );
}

function redirectToHttps(url) {
    const target = new URL(url);
    target.protocol = 'https:';
    return new Response(null, {
        status: 308,
        headers: {
            Location: target.href,
            'Cache-Control': 'public, max-age=3600',
            ...SEC_HEADERS
        }
    });
}

function parseLeadHours(value, defaultValue = 0) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'number') return Number.isInteger(value) ? value : NaN;
    return typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : NaN;
}

function hasExactQueryParams(searchParams, requiredNames, optionalNames = []) {
    const allowed = new Set([...requiredNames, ...optionalNames]);
    for (const name of searchParams.keys()) if (!allowed.has(name)) return false;
    return requiredNames.every((name) => searchParams.getAll(name).length === 1)
        && optionalNames.every((name) => searchParams.getAll(name).length <= 1);
}

function parseDecimalQuery(value) {
    if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,8})?$/.test(value)) return NaN;
    return Number(value);
}

function workerClientId(request) {
    // Cloudflare edge가 직접 수신한 요청에서는 CF-Connecting-IP를 덮어쓴다.
    // 클라이언트가 임의로 앞쪽 값을 추가할 수 있는 X-Forwarded-For는 사용하지 않는다.
    const candidate = request.headers.get('cf-connecting-ip')?.trim() || '';
    const ipv4 = candidate.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4 && ipv4.slice(1).every((part) => Number(part) <= 255)) return `ip:${candidate}`;
    if (candidate.length <= 45 && candidate.includes(':') && /^[0-9a-f:.]+$/i.test(candidate)) {
        return `ip:${candidate.toLowerCase()}`;
    }
    return 'anonymous';
}

async function enforcePublicEnvironmentalLimit(request, env, route) {
    await acquireRateLimit(env.PUBLIC_ENVIRONMENTAL_LIMITER, `${route}:${workerClientId(request)}`);
}

/**
 * 요청 파라미터 화이트리스트 검증.
 *
 * 이 Worker는 배포자의 KMA 인증키로 상류 API를 호출하는 공개 프록시라서,
 * 임의 파라미터를 흘려보내면 캐시가 불가능한 요청 폭주로 키의 일일 한도를
 * 남이 소진시킬 수 있다. 유효한 조합(유한한 키 공간)만 통과시켜
 * 사실상 모든 요청이 캐시 히트로 수렴하게 한다.
 */
function validateQuery(p) {
    if (p.baseDate !== undefined) {
        const requestedMs = parseYmdStrict(p.baseDate);
        if (requestedMs === null) return '잘못된 baseDate';
        // 과거 60일 ~ 오늘(KST)만 — 아카이브 보존 범위 밖·미래 발표는 존재하지 않는다
        const todayMs = parseYmdStrict(ymd(Date.now() + 9 * 3600e3));
        if (requestedMs > todayMs || requestedMs < todayMs - 60 * 86400e3) return 'baseDate 범위 밖';
    }
    if (p.baseTime !== undefined && (typeof p.baseTime !== 'string' || !RELEASE_TIMES.has(p.baseTime))) return '잘못된 baseTime';
    if (p.baseDate !== undefined && p.baseTime !== undefined) {
        const [latestDate, latestTime] = latestBase();
        if (p.baseDate + p.baseTime > latestDate + latestTime) return '아직 발표되지 않은 시각';
    }
    if (p.element !== undefined && !GRID_ELEMENTS.includes(p.element)) return '잘못된 element';
    if (p.height !== undefined && p.height !== '10m') return '잘못된 height';
    if (p.leadHours !== undefined && !(Number.isInteger(p.leadHours) && p.leadHours >= 0 && p.leadHours <= 48)) return '잘못된 leadHours';
    if (p.lat !== undefined && !(Number.isFinite(p.lat) && p.lat >= 32 && p.lat <= 44)) return '위도 범위 밖';
    if (p.lon !== undefined && !(Number.isFinite(p.lon) && p.lon >= 122 && p.lon <= 134)) return '경도 범위 밖';
    return null;
}

function stationCoverageError(p) {
    const forecastLabel = FORECAST_BACKED_STATION_LABELS[p.element];
    if (forecastLabel) return `${forecastLabel} 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.`;
    if (p.element === 'swdn' && !kimLatLonToIndex(p.lat, p.lon)) return '일사강도 지원 범위 밖 지점';
    return null;
}

const badRequest = (msg) => new Response(msg, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS } });
const serviceUnavailable = () => text('data temporarily unavailable', {
    status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' }
});
const rateLimited = (retryAfterSeconds = 60) => text('rate limit exceeded', {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSeconds) }
});

function gridResponseCacheKey({ baseDate, baseTime, element, height, leadHours }, statsOnly) {
    const kind = statsOnly ? 'stats' : 'grid';
    // v2는 fallback 완성 응답을 1시간 저장하던 이전 엔트리와 분리한다.
    return new Request('https://bora-cache.internal/api/weather/grid/v3/'
        + `${kind}/${baseDate}${baseTime}/${element}/${height}/${leadHours}`);
}

const GRID_FALLBACK_RESPONSE_TTL = 90;

async function matchGridResponseCache(key) {
    try {
        const cache = globalThis.caches?.default;
        return cache ? await cache.match(key) : null;
    } catch {
        return null;
    }
}

/**
 * 완성 JSON을 짧게 재사용해 limiter·격자 순회·직렬화를 모두 생략한다.
 * 운영 runtime은 waitUntil로 응답과 분리하고, 단위 테스트 환경에서만 put을 기다린다.
 * cold miss Promise를 모듈 전역에 보관하면 다른 요청의 fetch/cache I/O context를
 * 공유할 수 있으므로 병합하지 않는다. 엄밀한 요청 병합은 Durable Object 경계가 필요하다.
 */
async function putGridResponseCache(key, response, ctx) {
    let operation;
    try {
        const cache = globalThis.caches?.default;
        if (!cache) return;
        operation = cache.put(key, response.clone()).catch(() => { });
    } catch {
        return;
    }
    if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(operation);
        return;
    }
    await operation;
}

const methodNotAllowed = (allow) => new Response('method not allowed', {
    status: 405,
    headers: { Allow: allow, 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS }
});

function severeWeatherPublicCacheKey(kind, minutes) {
    const suffix = kind === 'lightning' ? `/${minutes}` : '';
    return new Request(`https://bora-cache.internal/api/hazards/v2/${kind}${suffix}`);
}

async function matchSevereWeatherPublicCache(kind, minutes) {
    try {
        const cache = globalThis.caches?.default;
        return cache ? await cache.match(severeWeatherPublicCacheKey(kind, minutes)) : null;
    } catch {
        // Cache API is an optimization. KV remains the source of truth.
        return null;
    }
}

async function putSevereWeatherPublicCache(kind, minutes, response, ctx) {
    let operation;
    try {
        const cache = globalThis.caches?.default;
        if (!cache) return;
        operation = cache.put(severeWeatherPublicCacheKey(kind, minutes), response.clone()).catch(() => { });
    } catch {
        return;
    }
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(operation);
    else await operation;
}

function etagMatches(request, etag) {
    const value = request.headers.get('if-none-match');
    if (!value || !etag) return false;
    return value.split(',').some((candidate) => {
        const normalized = candidate.trim();
        return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
    });
}

function severeWeatherNotModified(response) {
    return new Response(null, {
        status: 304,
        headers: {
            ...SEC_HEADERS,
            ETag: response.headers.get('ETag') || '',
            'Cache-Control': response.headers.get('Cache-Control') || 'no-cache'
        }
    });
}

async function serveSevereWeather(request, env, ctx, kind, minutes = null) {
    const cached = await matchSevereWeatherPublicCache(kind, minutes);
    if (cached) return etagMatches(request, cached.headers.get('ETag'))
        ? severeWeatherNotModified(cached) : cached;

    await enforcePublicEnvironmentalLimit(request, env, kind);
    const snapshot = await readSevereWeatherSnapshot(env, kind, { minutes });
    if (!snapshot) {
        /* 공개 화면은 세 자료를 함께 조회한다. 아직 정상 snapshot이 없을 때 503을
         * 반복하기보다, 실제 0건과 구분되는 준비 상태를 같은 응답 계약으로 돌려준다. */
        const unavailablePayload = kind === 'typhoon' ? {
            schema: 'bora.typhoon/v1',
            source: '기상청 태풍 분석·예보',
            status: 'unavailable',
            active: []
        } : kind === 'lightning' ? {
            schema: 'bora.lightning/v1',
            source: '기상청 낙뢰관측',
            status: 'unavailable',
            from: null,
            to: null,
            truncated: false,
            strikes: []
        } : {
            schema: 'bora.warnings/v1',
            source: '기상청 기상특보',
            status: 'unavailable',
            warnings: []
        };
        const unavailable = json(unavailablePayload, {
            headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=60' }
        });
        await putSevereWeatherPublicCache(kind, minutes, unavailable, ctx);
        return unavailable;
    }
    const headers = {
        'Cache-Control': severeWeatherCacheControl(kind, snapshot.stale, snapshot.ageSeconds),
        ETag: `"${snapshot.revision}"`
    };
    const response = json(snapshot, { headers });
    await putSevereWeatherPublicCache(kind, minutes, response, ctx);
    if (etagMatches(request, headers.ETag)) return severeWeatherNotModified(response);
    return response;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const q = url.searchParams;
        if (url.protocol === 'http:' && !isLocalHttp(url)) return redirectToHttps(url);

        try {
            switch (url.pathname) {
                case '/':
                    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
                    // Assets는 /index.html을 /로 정규화(307)하므로 루트 경로로 요청한다
                    return env.ASSETS.fetch(new Request(new URL('/', url), request));

                case '/api/runtime/map-config': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    if ([...q.keys()].length !== 0) return badRequest('허용되지 않은 파라미터');
                    return json({
                        vworldEnabled: false,
                        vworldTileBase: ''
                    }, { headers: { 'Cache-Control': 'no-store' } });
                }

                case '/api/weather/grid':
                case '/api/weather/grid/stats': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    if (!hasExactQueryParams(q, ['baseDate', 'baseTime', 'element'], ['height', 'leadHours'])) {
                        return badRequest('필수 파라미터 누락 또는 허용되지 않은 파라미터');
                    }
                    const leadHoursRaw = q.get('leadHours');
                    const heightRaw = q.get('height');
                    const p = {
                        baseDate: q.get('baseDate'), baseTime: q.get('baseTime'),
                        element: q.get('element'), height: heightRaw === null ? '10m' : heightRaw,
                        leadHours: parseLeadHours(leadHoursRaw)
                    };
                    if (p.baseDate === null || p.baseTime === null || p.element === null) {
                        return badRequest('필수 파라미터 누락');
                    }
                    const err = validateQuery(p);
                    if (err) return badRequest(err);
                    if (!hasKmaKey(env)) return serviceUnavailable();
                    const statsOnly = url.pathname === '/api/weather/grid/stats';
                    const responseCacheKey = gridResponseCacheKey(p, statsOnly);
                    const cachedResponse = await matchGridResponseCache(responseCacheKey);
                    if (cachedResponse) return cachedResponse;

                    await enforcePublicEnvironmentalLimit(request, env, 'weather-grid');
                    const r = await buildGridData(env, p.baseDate, p.baseTime, p.element, p.leadHours, statsOnly);
                    const responseHeaders = r.mock
                        ? { 'X-Bora-Data-Source': 'mock', 'Cache-Control': 'no-store' }
                        : r[GRID_BUILD_METADATA]?.fallbackUsed
                            ? { 'Cache-Control': `public, max-age=${GRID_FALLBACK_RESPONSE_TTL}, s-maxage=${GRID_FALLBACK_RESPONSE_TTL}` }
                            : { 'Cache-Control': 'public, max-age=300, s-maxage=3600' };
                    const response = statsOnly
                        ? json({
                            stats: r.stats,
                            ...(r.categoryCounts ? { categoryCounts: r.categoryCounts } : {})
                        }, { headers: responseHeaders })
                        : json(r, { headers: responseHeaders });
                    if (!r.mock) await putGridResponseCache(responseCacheKey, response, ctx);
                    return response;
                }

                case '/api/weather/point-forecast': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    const required = ['latitude', 'longitude', 'baseDate', 'baseTime'];
                    if (!hasExactQueryParams(q, required)) return badRequest('필수 파라미터 누락 또는 허용되지 않은 파라미터');
                    const p = {
                        lat: parseDecimalQuery(q.get('latitude')),
                        lon: parseDecimalQuery(q.get('longitude')),
                        baseDate: q.get('baseDate'),
                        baseTime: q.get('baseTime')
                    };
                    const err = validateQuery(p);
                    if (err) return badRequest(err);
                    if (!hasDataGoKey(env)) return serviceUnavailable();
                    await enforcePublicEnvironmentalLimit(request, env, 'weather-point-forecast');
                    const result = await buildStationForecast(env, p.lat, p.lon, p.baseDate, p.baseTime);
                    return json(result, { headers: {
                        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300'
                    } });
                }

                case '/api/environment/air-quality': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    const required = ['minLat', 'maxLat', 'minLon', 'maxLon'];
                    if (!hasExactQueryParams(q, required)) return badRequest('필수 파라미터 누락 또는 허용되지 않은 파라미터');
                    const bounds = {
                        minLat: parseDecimalQuery(q.get('minLat')),
                        maxLat: parseDecimalQuery(q.get('maxLat')),
                        minLon: parseDecimalQuery(q.get('minLon')),
                        maxLon: parseDecimalQuery(q.get('maxLon'))
                    };
                    if (!Object.values(bounds).every(Number.isFinite)
                        || bounds.minLat < 32 || bounds.maxLat > 44 || bounds.minLat >= bounds.maxLat
                        || bounds.minLon < 122 || bounds.maxLon > 134 || bounds.minLon >= bounds.maxLon) {
                        return badRequest('잘못된 bbox');
                    }
                    if (!hasDataGoKey(env)) return serviceUnavailable();
                    await enforcePublicEnvironmentalLimit(request, env, 'environment-air-quality');
                    const result = await buildAirQuality(env, bounds);
                    return json(result, { headers: {
                        'Cache-Control': result.stale ? 'no-store'
                            : 'public, max-age=300, stale-while-revalidate=300, stale-if-error=3600'
                    } });
                }

                case '/api/traffic/cameras': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    const required = ['minLat', 'maxLat', 'minLon', 'maxLon'];
                    if (!hasExactQueryParams(q, required)) {
                        return badRequest('필수 파라미터 누락 또는 허용되지 않은 파라미터');
                    }
                    const bounds = {
                        minLat: parseDecimalQuery(q.get('minLat')),
                        maxLat: parseDecimalQuery(q.get('maxLat')),
                        minLon: parseDecimalQuery(q.get('minLon')),
                        maxLon: parseDecimalQuery(q.get('maxLon'))
                    };
                    if (!Object.values(bounds).every(Number.isFinite)
                        || bounds.minLat < 32 || bounds.maxLat > 44 || bounds.minLat >= bounds.maxLat
                        || bounds.minLon < 122 || bounds.maxLon > 134 || bounds.minLon >= bounds.maxLon) {
                        return badRequest('잘못된 bbox');
                    }
                    const baseTiles = cctvTiles(bounds);
                    if (!baseTiles) return badRequest('bbox 타일 수가 24개를 초과합니다.');
                    const supertiles = cctvSupertiles(baseTiles);
                    if (!supertiles) return serviceUnavailable();
                    if (!itsApiUrl(env, supertiles[0])) return serviceUnavailable();
                    await enforcePublicEnvironmentalLimit(request, env, 'traffic-cameras');
                    const result = await buildCctv(env, bounds, supertiles);
                    return json(result, { headers: { 'Cache-Control': 'no-store' } });
                }

                case '/api/hazards/typhoons': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    if (!hasExactQueryParams(q, [])) return badRequest('허용되지 않은 파라미터');
                    return await serveSevereWeather(request, env, ctx, 'typhoon');
                }

                case '/api/hazards/lightning': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    if (!hasExactQueryParams(q, ['minutes']) || !['15', '30', '60'].includes(q.get('minutes'))) {
                        return badRequest('minutes는 15, 30, 60 중 하나여야 합니다.');
                    }
                    return await serveSevereWeather(request, env, ctx, 'lightning', Number(q.get('minutes')));
                }

                case '/api/hazards/warnings': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    if (!hasExactQueryParams(q, [])) return badRequest('허용되지 않은 파라미터');
                    return await serveSevereWeather(request, env, ctx, 'warnings');
                }

                case '/api/weather/timeseries': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    const latitude = q.get('latitude'), longitude = q.get('longitude');
                    const elementRaw = q.get('element'), heightRaw = q.get('height');
                    const p = {
                        lat: parseDecimalQuery(latitude), lon: parseDecimalQuery(longitude),
                        baseDate: q.get('baseDate'), baseTime: q.get('baseTime'),
                        element: elementRaw === null ? 'wdws' : elementRaw,
                        height: heightRaw === null ? '10m' : heightRaw
                    };
                    if (p.baseDate === null || p.baseTime === null) return badRequest('필수 파라미터 누락');
                    const err = validateQuery(p);
                    if (err) return badRequest(err);
                    const coverageError = stationCoverageError(p);
                    if (coverageError) return badRequest(coverageError);
                    if (!hasKmaKey(env)) return serviceUnavailable();
                    await enforcePublicEnvironmentalLimit(request, env, 'weather-timeseries');
                    const r = await buildStationData(env, p.lat, p.lon, p.baseDate, p.baseTime, p.element);
                    if (!r.some((slot) => Array.isArray(slot) && Number.isFinite(slot[0]) && slot[0] < 9000 && slot[0] > -900)) {
                        return serviceUnavailable();
                    }
                    return json(r, { headers: { 'Cache-Control': 'public, max-age=300' } });
                }

                case '/api/weather/coverage': {
                    if (request.method !== 'GET') return methodNotAllowed('GET');
                    const lat = Number(q.get('latitude')), lon = Number(q.get('longitude'));
                    const err = validateQuery({ lat, lon });
                    if (err) return badRequest(err);
                    const [nx, ny] = LCC.latLonToGrid(lat, lon);
                    return json({ inside: isInsideForecastGrid(nx, ny) });
                }
            }
        } catch (e) {
            if (e instanceof OutOfCoverageError) return badRequest(e.message);
            if (e instanceof RateLimitExceededError) return rateLimited(e.retryAfterSeconds);
            if (e instanceof WeatherUnavailableError) return serviceUnavailable();
            console.error(JSON.stringify({ message: 'request failed', path: url.pathname,
                error: e instanceof Error ? e.name : 'UnknownError' }));
            return new Response('server error', { status: 500, headers: SEC_HEADERS });
        }
        return new Response('not found', { status: 404, headers: SEC_HEADERS });
    },

    scheduled(controller, env, ctx) {
        const operation = refreshSevereWeather(env, controller.scheduledTime, {
            kmaUrl,
            fetchText: fetchKmaText
        }).catch((error) => {
            console.error(JSON.stringify({
                event: 'severe_weather_schedule_failed',
                reason: 'refresh_failed',
                errorType: error instanceof Error ? error.name : 'UnknownError'
            }));
        });
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(operation);
        else return operation;
    }
};
