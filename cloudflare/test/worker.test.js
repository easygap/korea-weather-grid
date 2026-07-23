import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

class MemoryCache {
    constructor() {
        this.entries = new Map();
        this.keys = [];
        this.matchCalls = 0;
        this.putCalls = 0;
        this.deleteCalls = 0;
    }

    async match(request) {
        this.matchCalls++;
        const key = typeof request === 'string' ? request : request.url;
        const hit = this.entries.get(key);
        return hit ? hit.clone() : undefined;
    }

    async put(request, response) {
        this.putCalls++;
        const key = typeof request === 'string' ? request : request.url;
        this.keys.push(key);
        this.entries.set(key, response.clone());
    }

    async delete(request) {
        this.deleteCalls++;
        const key = typeof request === 'string' ? request : request.url;
        return this.entries.delete(key);
    }
}

class RejectingCache {
    constructor() {
        this.matchCalls = 0;
        this.putCalls = 0;
    }

    async match() {
        this.matchCalls++;
        throw new Error('cache match unavailable');
    }

    async put() {
        this.putCalls++;
        throw new Error('cache put unavailable');
    }
}

const jsonResponse = (body) => new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' }
});

function apiPayload(items, totalCount) {
    const payload = {
        response: {
            header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
            body: { items: { item: items } }
        }
    };
    if (totalCount !== undefined) payload.response.body.totalCount = totalCount;
    return payload;
}

function yesterday() {
    const date = new Date(Date.now() + 9 * 3600e3 - 86400e3);
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function request(path) {
    return new Request('https://bora.test' + path);
}

function isoDate(baseDate) {
    return `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6, 8)}`;
}

function dfsSource(baseDate, baseHour, requestedHour, fallbackHours = 0) {
    const requestedRunMs = Date.UTC(
        Number(baseDate.slice(0, 4)), Number(baseDate.slice(4, 6)) - 1,
        Number(baseDate.slice(6, 8)), baseHour);
    const runMs = requestedRunMs - fallbackHours * 3600e3;
    const validMs = requestedRunMs + Math.max(requestedHour, 1) * 3600e3;
    const compact = (ms) => new Date(ms).toISOString().slice(0, 13)
        .replaceAll('-', '').replace('T', '');
    const kstIso = (ms) => `${new Date(ms).toISOString().slice(0, 16)}:00+09:00`;
    return {
        tmfc: compact(runMs),
        tmef: compact(validMs),
        referenceTime: kstIso(requestedRunMs),
        validTime: kstIso(validMs),
        modelRunTime: new Date(runMs - 9 * 3600e3).toISOString().replace('.000Z', 'Z'),
        modelForecastHour: Math.round((validMs - runMs) / 3600e3)
    };
}

function dfsGridPayload(defaultValue, overrides = new Map()) {
    const values = new Array(149 * 253).fill(String(defaultValue));
    for (const [index, value] of overrides) values[index] = String(value);
    return values.join(',');
}

function kimGridPayload(defaultValue, overrides = new Map()) {
    const values = new Array(115 * 109).fill(String(defaultValue));
    for (const [index, value] of overrides) values[index] = String(value);
    return '# i = 115, j = 109, map = S '
        + '(x_min = 1482, y_min = 1452, x_max = 1596, y_max = 1560)\n'
        + values.join(' ');
}

function kimPointPayload(tmfc, hf, value) {
    const runMs = Date.UTC(
        Number(tmfc.slice(0, 4)), Number(tmfc.slice(4, 6)) - 1,
        Number(tmfc.slice(6, 8)), Number(tmfc.slice(8, 10)));
    const validMs = runMs + hf * 3600e3;
    const valid = new Date(validMs).toISOString().slice(0, 13)
        .replaceAll('-', '').replace('T', '');
    return '# tmfc tmef X Y value variable\n'
        + `${tmfc} ${valid} 1527 1510 ${value} dswrsfc(W/m2)\n`;
}

function kimHourlySource(baseDate, baseHour) {
    const baseLikeKst = Date.UTC(
        Number(baseDate.slice(0, 4)), Number(baseDate.slice(4, 6)) - 1,
        Number(baseDate.slice(6, 8)), baseHour);
    const baseUtcMs = baseLikeKst - 9 * 3600e3;
    const baseUtc = new Date(baseUtcMs);
    let runMs = Date.UTC(baseUtc.getUTCFullYear(), baseUtc.getUTCMonth(),
        baseUtc.getUTCDate(), Math.floor(baseUtc.getUTCHours() / 6) * 6);
    if ((baseUtcMs - runMs) / 3600e3 < 5) runMs -= 6 * 3600e3;
    const run = new Date(runMs);
    const tmfc = `${run.getUTCFullYear()}${String(run.getUTCMonth() + 1).padStart(2, '0')}`
        + `${String(run.getUTCDate()).padStart(2, '0')}${String(run.getUTCHours()).padStart(2, '0')}`;
    return {
        tmfc,
        firstForecastHour: Math.round((baseUtcMs + 3600e3 - runMs) / 3600e3)
    };
}

function byteStream(totalBytes, onCancel, chunkBytes = 512 * 1024) {
    let remaining = totalBytes;
    return new ReadableStream({
        pull(controller) {
            if (remaining <= 0) {
                controller.close();
                return;
            }
            const size = Math.min(chunkBytes, remaining);
            controller.enqueue(new Uint8Array(size).fill(48));
            remaining -= size;
        },
        cancel(reason) {
            onCancel?.(reason);
        }
    });
}

const allowLimiter = () => ({ async limit() { return { success: true }; } });

function gridEnv(overrides = {}) {
    return {
        KMA_API_AUTH_KEY: 'test-key',
        PUBLIC_ENVIRONMENTAL_LIMITER: allowLimiter(),
        GRID_REFRESH_LIMITER: allowLimiter(),
        ...overrides
    };
}

function stationEnv(overrides = {}) {
    return {
        KMA_API_AUTH_KEY: 'test-key',
        PUBLIC_ENVIRONMENTAL_LIMITER: allowLimiter(),
        STATION_REFRESH_LIMITER: allowLimiter(),
        ...overrides
    };
}

function dataGoEnv(serviceKey = 'test==', overrides = {}) {
    return {
        DATA_GO_KR_SERVICE_KEY: serviceKey,
        PUBLIC_ENVIRONMENTAL_LIMITER: allowLimiter(),
        FORECAST_REFRESH_LIMITER: allowLimiter(),
        AIR_REFRESH_LIMITER: allowLimiter(),
        ...overrides
    };
}

function cctvEnv(apiKey = 'its-test-key', overrides = {}) {
    return {
        ITS_API_KEY: apiKey,
        PUBLIC_ENVIRONMENTAL_LIMITER: allowLimiter(),
        CCTV_REFRESH_LIMITER: allowLimiter(),
        ...overrides
    };
}

function cctvPayload(items, dataCount = items.length) {
    return { response: { coordtype: 1, datacount: dataCount, data: items } };
}

const CCTV_CIRCUIT_KEY = 'https://bora-cache.internal/its/cctv/v2/live-circuit';

test('runtime map config exposes only a validated optional Kakao JavaScript key', async () => {
    const key = 'a'.repeat(32);
    const enabled = await worker.fetch(
        request('/api/runtime/map-config'), { KAKAO_MAP_JAVASCRIPT_KEY: key }, {});
    assert.equal(enabled.status, 200);
    assert.equal(enabled.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await enabled.json(), {
        kakaoEnabled: true,
        kakaoJavascriptKey: key
    });

    for (const env of [{}, { KAKAO_MAP_JAVASCRIPT_KEY: 'malformed' }]) {
        const disabled = await worker.fetch(request('/api/runtime/map-config'), env, {});
        assert.deepEqual(await disabled.json(), {
            kakaoEnabled: false,
            kakaoJavascriptKey: ''
        });
    }

    assert.equal((await worker.fetch(
        request('/api/runtime/map-config?callback=attacker'), {}, {})).status, 400);
    assert.equal((await worker.fetch(new Request('https://bora.test/api/runtime/map-config', {
        method: 'POST'
    }), {}, {})).status, 405);
});

test('gridData returns the structured 10m wind field contract', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    const firstNorthwestIndex = 161 * 149 + 4;
    const dfsPayloads = new Map([
        ['WSD', dfsGridPayload(2.6, new Map([
            [0, '1e309'],
            [firstNorthwestIndex + 1, 'Infinity'],
            [firstNorthwestIndex + 4, 'Infinity'],
            [firstNorthwestIndex + 5, 0]
        ]))],
        ['UUU', dfsGridPayload(1.2, new Map([
            [1, 'Infinity'],
            [firstNorthwestIndex, -999],
            [firstNorthwestIndex + 2, 151],
            [firstNorthwestIndex + 3, 9999],
            [firstNorthwestIndex + 4, 'NaN']
        ]))],
        ['VVV', dfsGridPayload(-2.3, new Map([
            [2, '-Infinity'],
            [firstNorthwestIndex + 4, '-Infinity']
        ]))]
    ]);
    globalThis.fetch = async (url) => {
        upstreamCalls++;
        const vars = new URL(String(url)).searchParams.get('vars');
        if (dfsPayloads.has(vars)) return new Response(dfsPayloads.get(vars));
        return new Response('upstream unavailable', { status: 503 });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const env = gridEnv();
    const tenMeterResponse = await worker.fetch(
        request(`/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=wdws&height=10m&leadHours=0`), env, {});
    assert.equal(tenMeterResponse.status, 200);
    assert.equal(tenMeterResponse.headers.get('X-Bora-Data-Source'), null);
    assert.equal(tenMeterResponse.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=3600');
    const tenMeter = await tenMeterResponse.json();
    const field = tenMeter.windField;

    assert.equal(field.schema, 'weather-grid.wind-field/v1');
    assert.equal(field.unit, 'm/s');
    assert.equal(field.scaleFactor, 0.1);
    assert.equal(field.noData, -32768);
    assert.equal(field.vectorReference, 'earth-relative');
    assert.equal(field.heightMeters, 10);
    assert.equal(field.requestedForecastHour, 0);
    assert.equal(field.forecastHour, 1);
    assert.equal(field.referenceTime, `${isoDate(baseDate)}T02:00:00+09:00`);
    assert.equal(field.validTime, `${isoDate(baseDate)}T03:00:00+09:00`);
    assert.deepEqual(field.grid, {
        type: 'kma-dfs-lcc', nx: 145, ny: 162, nxMin: 5, nyMin: 1, step: 1,
        rowOrder: 'north-to-south', columnOrder: 'west-to-east'
    });
    assert.equal(field.u.length, 145 * 162);
    assert.equal(field.v.length, 145 * 162);
    assert.ok(field.u.every(Number.isInteger));
    assert.ok(field.v.every(Number.isInteger));
    assert.equal(field.u[0], field.noData);
    assert.equal(field.v[0], field.noData);
    assert.equal(field.u[1], 12);
    assert.equal(field.v[1], -23);
    assert.equal(field.u[2], field.noData);
    assert.equal(field.v[2], field.noData);
    assert.equal(field.u[3], field.noData);
    assert.equal(field.v[3], field.noData);
    assert.equal(tenMeter.data[0], 2.6, 'overflow token must consume one no-data cell without dropping WSD grid');
    assert.ok(Math.abs(tenMeter.data[1] - Math.hypot(1.2, -2.3)) < 1e-12);
    assert.equal(tenMeter.data[4], -999);
    assert.equal(tenMeter.data[5], 0);
    assert.equal(tenMeter.stats.min, 0);

    const minMaxResponse = await worker.fetch(request(
        `/api/weather/grid/stats?baseDate=${baseDate}&baseTime=0200&element=wdws&height=10m&leadHours=0`), env, {});
    assert.equal(minMaxResponse.status, 200);
    assert.equal(minMaxResponse.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=3600');
    assert.deepEqual(await minMaxResponse.json(), { stats: tenMeter.stats });
    assert.equal(upstreamCalls, 3, 'statistics reuse the three cached DFS source grids');
});

test('wind raw cache hits reject all-9999 WSD UUU VVV fields and refetch each variable', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const baseDate = yesterday();
    const source = dfsSource(baseDate, 2, 1);
    const values = { WSD: 2.5, UUU: 1.2, VVV: -1.1 };
    const upstreamVariables = [];
    globalThis.fetch = async (url) => {
        const variable = new URL(url).searchParams.get('vars');
        upstreamVariables.push(variable);
        return new Response(dfsGridPayload(values[variable]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    for (const variable of Object.keys(values)) {
        const rawKey = `https://bora-cache.internal/dfs/${source.tmfc}/${variable}_${source.tmef}`;
        await cache.put(rawKey, new Response(dfsGridPayload(9999), {
            headers: { 'Cache-Control': 'public, max-age=604800' }
        }));
    }

    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=wdws&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.data.every((value) => value === values.WSD));
    assert.deepEqual(upstreamVariables.sort(), ['UUU', 'VVV', 'WSD']);
    assert.equal(cache.deleteCalls, 3);
    for (const [variable, value] of Object.entries(values)) {
        const rawKey = `https://bora-cache.internal/dfs/${source.tmfc}/${variable}_${source.tmef}`;
        assert.equal(await cache.entries.get(rawKey).clone().text(), dfsGridPayload(value));
    }
});

test('public grid and station routes reject unsupported heights before any work', async (t) => {
    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    let limiterCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('invalid height requests must not reach an upstream service');
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const env = {
        ...gridEnv(),
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit() { limiterCalls++; return { success: true }; }
        }
    };
    const baseDate = yesterday();
    const grid = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=wdws&height=unsupported&leadHours=1`), env, {});
    const station = await worker.fetch(request(
        `/api/weather/timeseries?latitude=37.5&longitude=127&baseDate=${baseDate}`
        + '&baseTime=0200&element=wdws&height=unsupported'), env, {});

    for (const response of [grid, station]) {
        assert.equal(response.status, 400);
        assert.equal(await response.text(), '잘못된 height');
    }
    assert.equal(limiterCalls, 0);
    assert.equal(upstreamCalls, 0);
});

test('grid routes reject malformed requests before consuming public or refresh limits', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    let refreshCalls = 0;
    const publicKeys = [];
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('limited grid requests must not reach KMA');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const guardedEnv = gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit({ key }) {
                publicKeys.push(key);
                return { success: false };
            }
        },
        GRID_REFRESH_LIMITER: {
            async limit() {
                refreshCalls++;
                return { success: true };
            }
        }
    });
    const baseDate = yesterday();
    const validPath = `/api/weather/grid?baseDate=${baseDate}&baseTime=0200`
        + '&element=tmp&height=10m&leadHours=1';

    const invalidDate = await worker.fetch(request(validPath.replace(baseDate, 'not-a-date')), guardedEnv, {});
    assert.equal(invalidDate.status, 400);
    const duplicate = await worker.fetch(request(validPath + '&leadHours=2'), guardedEnv, {});
    assert.equal(duplicate.status, 400);
    const unexpected = await worker.fetch(request(validPath + '&serviceKey=attacker'), guardedEnv, {});
    assert.equal(unexpected.status, 400);
    const unsupportedHeight = await worker.fetch(
        request(validPath.replace('height=10m', 'height=120m')), guardedEnv, {});
    assert.equal(unsupportedHeight.status, 400);
    assert.equal(await unsupportedHeight.text(), '잘못된 height');
    const unsupportedRainProduct = await worker.fetch(
        request(validPath.replace('element=tmp', 'element=rn1')), guardedEnv, {});
    assert.equal(unsupportedRainProduct.status, 400);
    assert.equal(await unsupportedRainProduct.text(), '잘못된 element');
    assert.deepEqual(publicKeys, []);

    const missingKey = await worker.fetch(request(validPath), { ...guardedEnv, KMA_API_AUTH_KEY: '' }, {});
    assert.equal(missingKey.status, 503);
    assert.deepEqual(publicKeys, []);

    const limited = await worker.fetch(new Request('https://bora.test' + validPath, {
        headers: { 'CF-Connecting-IP': '203.0.113.12' }
    }), guardedEnv, {});
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
    assert.deepEqual(publicKeys, ['weather-grid:ip:203.0.113.12']);
    assert.equal(refreshCalls, 0);
    assert.equal(upstreamCalls, 0);
});

test('grid cold misses share one refresh limit while cache hits consume none', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const events = [];
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response(dfsGridPayload(5));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const publicLimiter = {
        async limit({ key }) {
            events.push(`public:${key}`);
            return { success: true };
        }
    };
    const allowRefresh = {
        async limit({ key }) {
            events.push(`refresh:${key}`);
            return { success: true };
        }
    };
    const blockRefresh = {
        async limit({ key }) {
            events.push(`refresh-blocked:${key}`);
            return { success: false };
        }
    };
    const baseDate = yesterday();
    const path = `/api/weather/grid?baseDate=${baseDate}&baseTime=0200`
        + '&element=wdws&height=10m&leadHours=1';

    const cold = await worker.fetch(request(path), gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter,
        GRID_REFRESH_LIMITER: allowRefresh
    }), {});
    assert.equal(cold.status, 200);
    assert.deepEqual(events, [
        'public:weather-grid:anonymous',
        'refresh:kma:grid-refresh'
    ]);
    assert.equal(upstreamCalls, 3, 'WSD/UUU/VVV는 한 refresh budget 안에서 병렬 조회한다');

    const cached = await worker.fetch(request(path), gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter,
        GRID_REFRESH_LIMITER: blockRefresh
    }), {});
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=3600');
    assert.deepEqual(events, [
        'public:weather-grid:anonymous',
        'refresh:kma:grid-refresh'
    ], '완성 응답 cache hit은 public/refresh limiter와 grid build를 모두 생략한다');
    assert.equal(upstreamCalls, 3);
    assert.ok(globalThis.caches.default.keys.some((key) => key.includes('/api/weather/grid/v3/grid/')));

    const otherForecast = await worker.fetch(request(path.replace('leadHours=1', 'leadHours=2')), gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter,
        GRID_REFRESH_LIMITER: blockRefresh
    }), {});
    assert.equal(otherForecast.status, 429);
    assert.deepEqual(events.slice(-2), [
        'public:weather-grid:anonymous',
        'refresh-blocked:kma:grid-refresh'
    ]);
    assert.equal(upstreamCalls, 3, 'refresh limit 초과 뒤에는 KMA를 호출하지 않는다');
});

test('DFS cache read and write failures do not replace a valid KMA response', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new RejectingCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response(dfsGridPayload(7));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=tmp&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    const source = dfsSource(baseDate, 2, 1);
    assert.deepEqual(body.stats, { min: 7, avg: 7, max: 7 });
    assert.equal(body.referenceTime, source.referenceTime);
    assert.equal(body.validTime, source.validTime);
    assert.equal(body.modelRunTime, source.modelRunTime);
    assert.equal(body.modelForecastHour, 1);
    assert.equal(body.fallbackUsed, false);
    assert.equal(upstreamCalls, 1);
    assert.equal(cache.matchCalls, 4, '완성 응답, alias, DFS raw cache 실패 뒤에도 상류를 사용한다');
    assert.equal(cache.putCalls, 2, 'DFS raw와 완성 응답 cache 쓰기 실패를 모두 무시한다');
});

test('temperature 14 run keeps 15 valid time, falls back to 11, and reuses the alias', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const upstreamUrls = [];
    let refreshCalls = 0;
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        upstreamUrls.push(parsed);
        const tmfc = parsed.searchParams.get('tmfc');
        if (tmfc.endsWith('14')) return new Response('# ERROR : file is not exist (test)');
        if (tmfc.endsWith('11')) return new Response(dfsGridPayload(8));
        throw new Error(`unexpected DFS run: ${tmfc}`);
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const current = dfsSource(baseDate, 14, 1);
    const fallback = dfsSource(baseDate, 14, 1, 3);
    const path = `/api/weather/grid?baseDate=${baseDate}&baseTime=1400&element=tmp&height=10m&leadHours=1`;
    const env = gridEnv({
        GRID_REFRESH_LIMITER: {
            async limit() {
                refreshCalls++;
                return { success: true };
            }
        }
    });
    const response = await worker.fetch(request(path), env, {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.stats, { min: 8, avg: 8, max: 8 });
    assert.equal(body.baseDate, baseDate);
    assert.equal(body.baseTime, '1400');
    assert.equal(body.referenceTime, current.referenceTime);
    assert.equal(body.validTime, current.validTime);
    assert.equal(body.modelRunTime, fallback.modelRunTime);
    assert.equal(body.modelForecastHour, 4);
    assert.equal(body.fallbackUsed, true);
    assert.deepEqual(upstreamUrls.map((url) => ({
        tmfc: url.searchParams.get('tmfc'),
        tmef: url.searchParams.get('tmef')
    })), [
        { tmfc: current.tmfc, tmef: current.tmef },
        { tmfc: fallback.tmfc, tmef: current.tmef }
    ]);
    assert.equal(refreshCalls, 1, '최신·직전 런은 요청당 하나의 refresh budget을 공유한다');

    const repeated = await worker.fetch(request(path), env, {});
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).modelRunTime, fallback.modelRunTime);
    assert.equal(upstreamUrls.length, 2, '90초 alias와 DFS 캐시가 원점 재조회를 막는다');
    assert.equal(refreshCalls, 1, 'alias cache hit은 refresh budget을 소비하지 않는다');
    assert.ok(cache.keys.some((key) => key.includes('/dfs-temp-run/v1/')));
});

test('temperature 02 run crosses midnight to the previous 23 run with the same valid time', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        upstreamUrls.push(parsed);
        return new Response(upstreamUrls.length === 1
            ? '# ERROR : file is not exist (test)'
            : dfsGridPayload(6));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const current = dfsSource(baseDate, 2, 1);
    const fallback = dfsSource(baseDate, 2, 1, 3);
    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=tmp&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.validTime, current.validTime);
    assert.equal(body.modelRunTime, fallback.modelRunTime);
    assert.equal(body.modelForecastHour, 4);
    assert.equal(body.fallbackUsed, true);
    assert.deepEqual(upstreamUrls.map((url) => ({
        tmfc: url.searchParams.get('tmfc'),
        tmef: url.searchParams.get('tmef')
    })), [
        { tmfc: current.tmfc, tmef: current.tmef },
        { tmfc: fallback.tmfc, tmef: current.tmef }
    ]);
    assert.ok(fallback.tmfc.endsWith('23'));
});

test('temperature stops after the latest and one previous DFS run both fail', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        upstreamUrls.push(new URL(url));
        return new Response('# ERROR : file is not exist (test)');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const current = dfsSource(baseDate, 14, 1);
    const fallback = dfsSource(baseDate, 14, 1, 3);
    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=1400&element=tmp&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(upstreamUrls.map((url) => ({
        tmfc: url.searchParams.get('tmfc'),
        tmef: url.searchParams.get('tmef')
    })), [
        { tmfc: current.tmfc, tmef: current.tmef },
        { tmfc: fallback.tmfc, tmef: current.tmef }
    ]);
});

test('precipitation accepts an all-zero field and publishes one-hour accumulation metadata', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        upstreamUrls.push(new URL(url));
        return new Response(dfsGridPayload(0));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const source = dfsSource(baseDate, 2, 0);
    const path = `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=pcp&height=10m&leadHours=0`;
    const response = await worker.fetch(request(path), gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.stats, { min: 0, avg: 0, max: 0 });
    assert.equal(body.data.length, 145 * 162);
    assert.ok(body.data.every((value) => value === 0), '0mm는 결측이 아닌 무강수다');
    assert.equal(body.referenceTime, source.referenceTime);
    assert.equal(body.validTime, source.validTime);
    assert.equal(body.modelRunTime, source.modelRunTime);
    assert.equal(body.modelForecastHour, 1);
    assert.equal(body.fallbackUsed, false);
    assert.equal(body.product, 'KMA DFS PCP');
    assert.equal(body.unit, 'mm');
    assert.equal(body.accumulationHours, 1);
    assert.equal(body.windField, null);
    assert.equal(upstreamUrls[0].searchParams.get('vars'), 'PCP');
    assert.equal(upstreamUrls[0].searchParams.get('tmfc'), source.tmfc);
    assert.equal(upstreamUrls[0].searchParams.get('tmef'), source.tmef);

    const repeated = await worker.fetch(request(path), gridEnv(), {});
    assert.equal(repeated.status, 200);
    assert.equal(upstreamUrls.length, 1, '같은 PCP 발표·발효시각은 DFS 캐시를 재사용한다');
});

test('precipitation keeps valid time while falling back three hours and preserves only sentinel as no-data', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const upstreamUrls = [];
    const firstOutputIndex = 161 * 149 + 4;
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        upstreamUrls.push(parsed);
        const tmfc = parsed.searchParams.get('tmfc');
        if (tmfc.endsWith('14')) return new Response('# ERROR : file is not exist (test)');
        if (tmfc.endsWith('11')) {
            return new Response(dfsGridPayload(4.2, new Map([
                [firstOutputIndex, -99],
                [firstOutputIndex + 1, 0]
            ])));
        }
        throw new Error(`unexpected DFS run: ${tmfc}`);
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const current = dfsSource(baseDate, 14, 1);
    const fallback = dfsSource(baseDate, 14, 1, 3);
    const path = `/api/weather/grid?baseDate=${baseDate}&baseTime=1400&element=pcp&height=10m&leadHours=1`;
    const response = await worker.fetch(request(path), gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.data[0], -999);
    assert.equal(body.data[1], 0);
    assert.deepEqual(body.stats, { min: 0, avg: 4.2, max: 4.2 });
    assert.equal(body.validTime, current.validTime);
    assert.equal(body.modelRunTime, fallback.modelRunTime);
    assert.equal(body.modelForecastHour, 4);
    assert.equal(body.fallbackUsed, true);
    assert.deepEqual(upstreamUrls.map((url) => ({
        vars: url.searchParams.get('vars'),
        tmfc: url.searchParams.get('tmfc'),
        tmef: url.searchParams.get('tmef')
    })), [
        { vars: 'PCP', tmfc: current.tmfc, tmef: current.tmef },
        { vars: 'PCP', tmfc: fallback.tmfc, tmef: current.tmef }
    ]);

    const repeated = await worker.fetch(request(path), gridEnv(), {});
    assert.equal(repeated.status, 200);
    assert.equal(upstreamUrls.length, 2, 'PCP fallback alias가 미게시 최신 런 재조회를 막는다');
    assert.ok(cache.keys.some((key) => key.includes('/dfs-pcp-run/v1/')));
});

test('new scalar grid elements fetch only the selected DFS variable and publish descriptor metadata', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        upstreamUrls.push(parsed);
        const values = { SNO: 2.4, PTY: 4, REH: 75, SKY: 3, WAV: 1.8 };
        return new Response(dfsGridPayload(values[parsed.searchParams.get('vars')]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const cases = [
        { element: 'sno', variable: 'SNO', value: 2.4, product: 'KMA DFS SNO', unit: 'cm', accumulationHours: 1 },
        { element: 'pty', variable: 'PTY', value: 4, product: 'KMA DFS PTY', unit: 'code', categories: { 0: '없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기' } },
        { element: 'reh', variable: 'REH', value: 75, product: 'KMA DFS REH', unit: '%' },
        { element: 'sky', variable: 'SKY', value: 3, product: 'KMA DFS SKY', unit: 'code', categories: { 1: '맑음', 3: '구름많음', 4: '흐림' } },
        { element: 'wav', variable: 'WAV', value: 1.8, product: 'KMA DFS WAV', unit: 'm' }
    ];

    for (const [index, expected] of cases.entries()) {
        const path = `/api/weather/grid?baseDate=${baseDate}&baseTime=0200`
            + `&element=${expected.element}&height=10m&leadHours=1`;
        const response = await worker.fetch(request(path), gridEnv(), {});
        assert.equal(response.status, 200, expected.element);
        const body = await response.json();
        assert.equal(body.product, expected.product);
        assert.equal(body.unit, expected.unit);
        assert.equal(body.accumulationHours, expected.accumulationHours);
        if (expected.categories) {
            assert.deepEqual(body.categories, expected.categories);
            assert.deepEqual(body.stats, {
                min: null,
                avg: null,
                max: null,
                count: body.data.length
            });
            assert.deepEqual(body.categoryCounts, Object.fromEntries(
                Object.keys(expected.categories).map((code) => [
                    code,
                    Number(code) === expected.value ? body.data.length : 0
                ])
            ));
        }
        assert.ok(body.data.every((value) => value === expected.value));
        assert.equal(upstreamUrls.length, index + 1, `${expected.element}는 DFS 한 변수만 조회한다`);
        assert.equal(upstreamUrls.at(-1).searchParams.get('vars'), expected.variable);

        const repeated = await worker.fetch(request(path), gridEnv({
            PUBLIC_ENVIRONMENTAL_LIMITER: {
                async limit() { throw new Error('response cache hit must bypass limiter'); }
            }
        }), {});
        assert.equal(repeated.status, 200);
        assert.equal(upstreamUrls.length, index + 1);
    }
});

test('scalar descriptors convert sentinels and out-of-range values to no-data before statistics', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const firstOutputIndex = 161 * 149 + 4;
    globalThis.fetch = async () => new Response(dfsGridPayload(60, new Map([
        [firstOutputIndex, 9999],
        [firstOutputIndex + 1, -999],
        [firstOutputIndex + 2, 101],
        [firstOutputIndex + 3, 0],
        [firstOutputIndex + 4, 100]
    ])));
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=0500&element=reh&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.slice(0, 5), [-999, -999, -999, 0, 100]);
    assert.equal(body.stats.min, 0);
    assert.equal(body.stats.max, 100);
});

test('an all-invalid scalar run falls back once without changing the requested valid time', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        upstreamUrls.push(parsed);
        return new Response(dfsGridPayload(parsed.searchParams.get('tmfc').endsWith('14') ? 9999 : 2));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const current = dfsSource(baseDate, 14, 1);
    const fallback = dfsSource(baseDate, 14, 1, 3);
    await cache.put(`https://bora-cache.internal/api/weather/grid/v2/grid/${baseDate}1400/sno/10m/1`,
        new Response(JSON.stringify({ stats: { min: 99, avg: 99, max: 99 }, fallbackUsed: true }), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=300, s-maxage=3600'
            }
        }));
    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${baseDate}&baseTime=1400&element=sno&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=90, s-maxage=90');
    const body = await response.json();
    assert.deepEqual(body.stats, { min: 2, avg: 2, max: 2 },
        'v1의 장기 fallback 완성 응답은 새 캐시 세대에서 재사용하지 않는다');
    assert.equal(body.validTime, current.validTime);
    assert.equal(body.modelRunTime, fallback.modelRunTime);
    assert.equal(body.fallbackUsed, true);
    assert.ok(body.data.every((value) => value === 2));
    assert.deepEqual(upstreamUrls.map((url) => url.searchParams.get('tmfc')),
        [current.tmfc, fallback.tmfc]);

    const currentRawKey = `https://bora-cache.internal/dfs/${current.tmfc}/SNO_${current.tmef}`;
    const fallbackRawKey = `https://bora-cache.internal/dfs/${fallback.tmfc}/SNO_${current.tmef}`;
    assert.equal(cache.entries.has(currentRawKey), false,
        'descriptor상 전부 결측인 최신 원문은 7일 캐시에 저장하지 않는다');
    assert.equal(cache.entries.get(fallbackRawKey)?.headers.get('Cache-Control'),
        'public, max-age=604800');
    const gridCacheEntry = [...cache.entries.entries()]
        .find(([key]) => key.includes('/api/weather/grid/v3/grid/'))?.[1];
    assert.equal(gridCacheEntry?.headers.get('Cache-Control'), 'public, max-age=90, s-maxage=90');

    const stats = await worker.fetch(request(
        `/api/weather/grid/stats?baseDate=${baseDate}&baseTime=1400&element=sno&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(stats.status, 200);
    assert.equal(stats.headers.get('Cache-Control'), 'public, max-age=90, s-maxage=90');
    assert.deepEqual(await stats.json(), { stats: { min: 2, avg: 2, max: 2 } });
    const statsCacheEntry = [...cache.entries.entries()]
        .find(([key]) => key.includes('/api/weather/grid/v3/stats/'))?.[1];
    assert.equal(statsCacheEntry?.headers.get('Cache-Control'), 'public, max-age=90, s-maxage=90');
    assert.equal(upstreamUrls.length, 2, '통계는 검증된 fallback 원문을 재사용한다');
});

test('scalar raw cache hits must pass continuous and categorical descriptor validation', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const baseDate = yesterday();
    const source = dfsSource(baseDate, 2, 1);
    const cases = [
        { element: 'reh', variable: 'REH', cachedValue: 101, upstreamValue: 65 },
        { element: 'pty', variable: 'PTY', cachedValue: 7, upstreamValue: 2 }
    ];
    const upstreamVariables = [];
    globalThis.fetch = async (url) => {
        const variable = new URL(url).searchParams.get('vars');
        upstreamVariables.push(variable);
        const current = cases.find((item) => item.variable === variable);
        return new Response(dfsGridPayload(current.upstreamValue));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    for (const expected of cases) {
        const rawKey = `https://bora-cache.internal/dfs/${source.tmfc}/${expected.variable}_${source.tmef}`;
        await cache.put(rawKey, new Response(dfsGridPayload(expected.cachedValue), {
            headers: { 'Cache-Control': 'public, max-age=604800' }
        }));

        const response = await worker.fetch(request(
            `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=${expected.element}&height=10m&leadHours=1`),
        gridEnv(), {});
        assert.equal(response.status, 200, expected.element);
        const body = await response.json();
        assert.ok(body.data.every((value) => value === expected.upstreamValue), expected.element);
        assert.equal(await cache.entries.get(rawKey).clone().text(), dfsGridPayload(expected.upstreamValue),
            `${expected.variable} 오염 cache hit은 정상 상류 원문으로 교체한다`);
    }

    assert.deepEqual(upstreamVariables, ['REH', 'PTY']);
    assert.equal(cache.deleteCalls, 2, '오염된 raw cache key는 cold fetch 전에 제거한다');
});

test('categorical statistics responses keep counts, avoid averages, and use an independent cache key', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    let publicLimitCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response(dfsGridPayload(4));
    };
    const publicLimiter = {
        async limit() {
            publicLimitCalls++;
            return { success: true };
        }
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const query = `baseDate=${baseDate}&baseTime=0200&element=pty&height=10m&leadHours=1`;
    const statsPath = `/api/weather/grid/stats?${query}`;
    const first = await worker.fetch(request(statsPath), gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter
    }), {});
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.deepEqual(body.stats, { min: null, avg: null, max: null, count: 145 * 162 });
    assert.deepEqual(body.categoryCounts, {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 145 * 162
    });

    const repeated = await worker.fetch(request(statsPath), gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit() { throw new Error('statistics cache hit must bypass limiter'); }
        }
    }), {});
    assert.equal(repeated.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(publicLimitCalls, 1);

    const grid = await worker.fetch(request(`/api/weather/grid?${query}`), gridEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter
    }), {});
    assert.equal(grid.status, 200, '통계 cache는 전체 grid 응답과 충돌하지 않는다');
    assert.equal(publicLimitCalls, 2);
    assert.ok(cache.keys.some((key) => key.includes('/api/weather/grid/v3/stats/')));
    assert.ok(cache.keys.some((key) => key.includes('/api/weather/grid/v3/grid/')));
});

test('KMA text responses are bounded by both Content-Length and streamed bytes', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let declaredCancelled = 0;
    let streamedCancelled = 0;
    const signals = [];
    const baseDate = yesterday();
    const path = `/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=tmp&height=10m&leadHours=1`;
    globalThis.caches = { default: new MemoryCache() };
    globalThis.fetch = async (_url, options) => {
        signals.push(options.signal);
        return new Response(byteStream(1024 * 1024, () => { declaredCancelled++; }), {
            headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) }
        });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    assert.equal((await worker.fetch(request(path), gridEnv(), {})).status, 503);
    assert.equal(declaredCancelled, 2, '최신·직전 런의 대용량 응답을 모두 중단한다');

    globalThis.caches = { default: new MemoryCache() };
    globalThis.fetch = async (_url, options) => {
        signals.push(options.signal);
        return new Response(byteStream(4 * 1024 * 1024, () => { streamedCancelled++; }));
    };
    assert.equal((await worker.fetch(request(path), gridEnv(), {})).status, 503);
    assert.equal(streamedCancelled, 2, '최신·직전 런의 스트림을 모두 중단한다');
    assert.equal(signals.length, 4);
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
});

test('KMA upstream timeout aborts a pending fetch and maps to the shared 503 contract', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const originalTimeout = AbortSignal.timeout;
    globalThis.caches = { default: new MemoryCache() };
    let aborted = 0;
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException('timed out', 'TimeoutError'));
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        const onAbort = () => {
            aborted++;
            reject(options.signal.reason);
        };
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
    });
    t.after(() => {
        AbortSignal.timeout = originalTimeout;
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${yesterday()}&baseTime=0200&element=tmp&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(aborted, 2, '최신 런과 직전 런이 각각 독립적으로 timeout 제어를 받는다');
});

test('solar keeps fill cells as no-data and clamps numerical negative noise to zero', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const cells = new Map();
    for (let index = 0; index < 115 * 109; index++) {
        if (index % 2 === 0) cells.set(index, -999);
        else if (index % 4 === 1) cells.set(index, 0);
    }
    cells.set(1, '1e309');
    globalThis.fetch = async () => new Response(kimGridPayload(-0.03, cells));
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const response = await worker.fetch(
        request(`/api/weather/grid?baseDate=${baseDate}&baseTime=0200&element=swdn&height=10m&leadHours=1`),
        gridEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.data.includes(-999));
    assert.ok(body.data.includes(0));
    assert.ok(body.data.every((value) => value === -999 || value >= 0));
    assert.deepEqual(body.stats, { min: 0, avg: 0, max: 0 });
    assert.equal(body.windField, null);
});

test('KMA numeric grids tolerate legacy CP949 bytes in comment headers', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const payload = new TextEncoder().encode(kimGridPayload(3));
    const bytes = new Uint8Array(payload.length + 5);
    bytes.set([35, 32, 0xb0, 0xa1, 10]); // "# 가\n" in CP949, invalid UTF-8
    bytes.set(payload, 5);
    globalThis.fetch = async () => new Response(bytes, {
        headers: { 'Content-Type': 'text/plain' }
    });
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(
        `/api/weather/grid?baseDate=${yesterday()}&baseTime=0200&element=swdn&height=10m&leadHours=1`),
    gridEnv(), {});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).stats, { min: 3, avg: 3, max: 3 });
});

test('solar station uses 48 exact hourly point forecasts within the Free subrequest budget', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(String(url));
        upstreamUrls.push(parsed);
        const tmfc = parsed.searchParams.get('tmfc');
        const hf = Number(parsed.searchParams.get('hf'));
        return new Response(kimPointPayload(tmfc, hf, hf));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const path = `/api/weather/timeseries?latitude=37.5&longitude=127&baseDate=${baseDate}`
        + '&baseTime=0200&element=swdn&height=10m';
    const first = await worker.fetch(request(path), stationEnv(), {});
    assert.equal(first.status, 200);
    const series = await first.json();
    const source = kimHourlySource(baseDate, 2);
    const expectedForecastHours = Array.from({ length: 48 }, (_, index) =>
        source.firstForecastHour + index);
    assert.equal(series.length, 49);
    assert.deepEqual(series[0], series[1], '+0h compatibility slot must copy +1h without another fetch');
    assert.deepEqual(series.slice(1).map((slot) => slot[0]), expectedForecastHours);
    assert.ok(series.every((slot) => slot[1] === 0));
    assert.equal(upstreamUrls.length, 48);
    assert.deepEqual(upstreamUrls.map((url) => Number(url.searchParams.get('hf'))).sort((a, b) => a - b),
        expectedForecastHours);
    assert.ok(upstreamUrls.every((url) => url.searchParams.get('tmfc') === source.tmfc));
    assert.ok(source.tmfc >= '2026070100', 'hourly KIM contract applies only to post-2026-07-01 runs');
    assert.equal(cache.matchCalls, 1);
    assert.equal(cache.putCalls, 1);
    assert.equal(cache.matchCalls + cache.putCalls + upstreamUrls.length, 50);
    assert.ok(upstreamUrls.every((url) =>
        url.pathname === '/api/typ01/cgi-bin/url/nph-kim_nc_pt_txt2'
        && url.searchParams.get('name') === 'dswrsfc'
        && url.searchParams.has('X') && url.searchParams.has('Y')));
    assert.equal(cache.keys.length, 1);
    assert.match(cache.keys[0], new RegExp(`/stn-solar/v3/${baseDate}0200/\\d+_\\d+$`));
    assert.ok(!cache.keys[0].includes('/kim/'));

    const callsAfterColdRequest = upstreamUrls.length;
    const second = await worker.fetch(request(path), stationEnv(), {});
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), series);
    assert.equal(upstreamUrls.length, callsAfterColdRequest);
    assert.equal(cache.putCalls, 1);
});

test('solar station does not cache an all-missing upstream result', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('# ERROR : file is not exist (test)');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(
        `/api/weather/timeseries?latitude=37.5&longitude=127&baseDate=${yesterday()}`
        + '&baseTime=0200&element=swdn&height=10m'),
    stationEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(cache.putCalls, 0);
    assert.ok(cache.matchCalls + upstreamCalls <= 50);
});

test('removed internal endpoints return 404 without touching an upstream service', async (t) => {
    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('must not be called');
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    for (const path of ['/api/unsupported/streamline', '/api/unsupported/warm-layer']) {
        const response = await worker.fetch(request(path), {}, {});
        assert.equal(response.status, 404);
    }
    assert.equal(upstreamCalls, 0);
});

test('station series keeps real zero values and marks missing categories as no-data', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const baseDate = yesterday();
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return jsonResponse(apiPayload([
            { fcstDate: baseDate, fcstTime: '0300', category: 'TMP', fcstValue: '0' },
            { fcstDate: baseDate, fcstTime: '0400', category: 'WSD', fcstValue: '0' },
            { fcstDate: baseDate, fcstTime: '0400', category: 'VEC', fcstValue: '0' },
            { fcstDate: baseDate, fcstTime: '0500', category: 'WSD', fcstValue: '1e309' }
        ]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const common = `latitude=37.5&longitude=127&baseDate=${baseDate}&baseTime=0200&height=10m`;
    const windResponse = await worker.fetch(
        request(`/api/weather/timeseries?${common}&element=wdws`), stationEnv(), {});
    assert.equal(windResponse.status, 200);
    assert.equal(windResponse.headers.get('Cache-Control'), 'public, max-age=300');
    const wind = await windResponse.json();
    assert.deepEqual(wind[1], [9999, 9999], 'TMP-only slot is not calm wind');
    assert.deepEqual(wind[2], [0, 0], 'actual calm wind and north direction remain valid zeroes');
    assert.deepEqual(wind[3], [9999, 9999], 'overflow forecast value is not converted to calm wind');

    const temperatureResponse = await worker.fetch(
        request(`/api/weather/timeseries?${common}&element=tmp`), stationEnv(), {});
    assert.equal(temperatureResponse.status, 200);
    assert.equal(temperatureResponse.headers.get('Cache-Control'), 'public, max-age=300');
    const temperature = await temperatureResponse.json();
    assert.deepEqual(temperature[0], [0, 0], 'the first slot is backfilled from the valid +1h zero temperature');
    assert.deepEqual(temperature[1], [0, 0]);
    assert.deepEqual(temperature[2], [9999, 0], 'wind-only slot is not reported as 0 degrees');
    assert.equal(upstreamCalls, 1, 'the shared station response is cached once for both elements');
});

test('stnData validates the request and KMA key before consuming the per-IP limiter', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('must not be called');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const publicKeys = [];
    let refreshCalls = 0;
    const guardedEnv = stationEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit({ key }) {
                publicKeys.push(key);
                return { success: false };
            }
        },
        STATION_REFRESH_LIMITER: {
            async limit() {
                refreshCalls++;
                return { success: true };
            }
        }
    });
    const baseDate = yesterday();
    const validPath = `/api/weather/timeseries?latitude=37.5&longitude=127&baseDate=${baseDate}`
        + '&baseTime=0200&element=wdws&height=10m';

    const invalid = await worker.fetch(request(validPath.replace(baseDate, 'not-a-date')), guardedEnv, {});
    assert.equal(invalid.status, 400);
    assert.deepEqual(publicKeys, []);

    const encodedCoordinate = await worker.fetch(request(validPath.replace('latitude=37.5', 'latitude=0x25')),
        guardedEnv, {});
    assert.equal(encodedCoordinate.status, 400);
    assert.deepEqual(publicKeys, []);

    const unsupportedHeight = await worker.fetch(request(
        validPath.replace('latitude=37.5', 'latitude=40').replace('height=10m', 'height=unsupported')),
    guardedEnv, {});
    assert.equal(unsupportedHeight.status, 400);
    assert.equal(await unsupportedHeight.text(), '잘못된 height');
    assert.deepEqual(publicKeys, []);

    const forecastBacked = {
        pcp: '강수량', sno: '신적설', pty: '강수형태',
        reh: '상대습도', sky: '하늘상태', wav: '파고'
    };
    for (const [element, label] of Object.entries(forecastBacked)) {
        const response = await worker.fetch(request(validPath.replace('element=wdws', `element=${element}`)),
            guardedEnv, {});
        assert.equal(response.status, 400, element);
        assert.equal(await response.text(), `${label} 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.`);
        assert.deepEqual(publicKeys, []);
    }

    const missingKey = await worker.fetch(request(validPath), { ...guardedEnv, KMA_API_AUTH_KEY: '' }, {});
    assert.equal(missingKey.status, 503);
    assert.deepEqual(publicKeys, []);

    const limited = await worker.fetch(new Request('https://bora.test' + validPath, {
        headers: {
            'CF-Connecting-IP': '203.0.113.11',
            'X-Forwarded-For': '198.51.100.11'
        }
    }), guardedEnv, {});
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
    assert.equal(limited.headers.get('Cache-Control'), 'no-store');
    assert.equal(await limited.text(), 'rate limit exceeded');
    assert.deepEqual(publicKeys, ['weather-timeseries:ip:203.0.113.11']);
    assert.equal(refreshCalls, 0);
    assert.equal(upstreamCalls, 0);
});

test('stnData uses the shared refresh limiter only after a validated cold cache miss', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const baseDate = yesterday();
    const events = [];
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return jsonResponse(apiPayload([
            { fcstDate: baseDate, fcstTime: '0300', category: 'WSD', fcstValue: '2.5' },
            { fcstDate: baseDate, fcstTime: '0300', category: 'VEC', fcstValue: '180' }
        ]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const publicLimiter = {
        async limit({ key }) {
            events.push(`public:${key}`);
            return { success: true };
        }
    };
    const allowRefresh = {
        async limit({ key }) {
            events.push(`refresh:${key}`);
            return { success: true };
        }
    };
    const blockRefresh = {
        async limit({ key }) {
            events.push(`refresh-blocked:${key}`);
            return { success: false };
        }
    };
    const path = `/api/weather/timeseries?latitude=37.5&longitude=127&baseDate=${baseDate}`
        + '&baseTime=0200&element=wdws&height=10m';

    const cold = await worker.fetch(request(path), stationEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter,
        STATION_REFRESH_LIMITER: allowRefresh
    }), {});
    assert.equal(cold.status, 200);
    assert.deepEqual(events, [
        'public:weather-timeseries:anonymous',
        'refresh:kma:station-refresh'
    ]);
    assert.equal(upstreamCalls, 1);

    const cached = await worker.fetch(request(path), stationEnv({
        PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter,
        STATION_REFRESH_LIMITER: blockRefresh
    }), {});
    assert.equal(cached.status, 200);
    assert.deepEqual(events, [
        'public:weather-timeseries:anonymous',
        'refresh:kma:station-refresh',
        'public:weather-timeseries:anonymous'
    ], 'cache hit은 공개 limiter만 통과하고 refresh budget을 소비하지 않는다');
    assert.equal(upstreamCalls, 1);

    const otherCell = await worker.fetch(request(path.replace('longitude=127', 'longitude=128')),
        stationEnv({
            PUBLIC_ENVIRONMENTAL_LIMITER: publicLimiter,
            STATION_REFRESH_LIMITER: blockRefresh
        }), {});
    assert.equal(otherCell.status, 429);
    assert.equal(otherCell.headers.get('Retry-After'), '60');
    assert.deepEqual(events.slice(-2), [
        'public:weather-timeseries:anonymous',
        'refresh-blocked:kma:station-refresh'
    ]);
    assert.equal(upstreamCalls, 1);
});

test('lonlat follows the displayed forecast-grid coverage', async (t) => {
    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('out-of-coverage requests must stop before the upstream service');
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const inside = await worker.fetch(request('/api/weather/coverage?latitude=37.5&longitude=127'), {}, {});
    assert.equal(inside.status, 200);
    assert.deepEqual(await inside.json(), { inside: true });

    // DFS (149,162)의 중심은 포함하고 바로 동쪽 (150,162)는 제외한다.
    const northeastEdge = await worker.fetch(
        request('/api/weather/coverage?latitude=39.008217648247744&longitude=132.3171196829101'), {}, {});
    assert.equal(northeastEdge.status, 200);
    assert.deepEqual(await northeastEdge.json(), { inside: true });

    const eastOutside = await worker.fetch(
        request('/api/weather/coverage?latitude=39.004554620259725&longitude=132.37646467588422'), {}, {});
    assert.equal(eastOutside.status, 200);
    assert.deepEqual(await eastOutside.json(), { inside: false });

    const northOutside = await worker.fetch(request('/api/weather/coverage?latitude=40&longitude=127'), {}, {});
    assert.equal(northOutside.status, 200);
    assert.deepEqual(await northOutside.json(), { inside: false });

    assert.equal(upstreamCalls, 0);
});

test('stnForecast encodes the decoded service key exactly once and keeps it out of cache keys', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const baseDate = yesterday();
    const decodedKey = 'test+key/with==';
    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        upstreamUrls.push(String(url));
        return jsonResponse(apiPayload([
            { fcstDate: baseDate, fcstTime: '0300', category: 'TMP', fcstValue: '21.5' },
            { fcstDate: baseDate, fcstTime: '0300', category: 'PCP', fcstValue: '1.0mm 미만' },
            { fcstDate: baseDate, fcstTime: '0300', category: 'SNO', fcstValue: '적설없음' },
            { fcstDate: baseDate, fcstTime: '0300', category: 'SKY', fcstValue: '3' },
            { fcstDate: baseDate, fcstTime: '0300', category: 'PTY', fcstValue: '0' },
            { fcstDate: baseDate, fcstTime: '0300', category: 'WAV', fcstValue: '1.4' },
            { fcstDate: baseDate, fcstTime: '0400', category: 'PTY', fcstValue: '4' },
            { fcstDate: baseDate, fcstTime: '0400', category: 'WAV', fcstValue: '9999' },
            { fcstDate: baseDate, fcstTime: '0500', category: 'PTY', fcstValue: '5' }
        ]));
    };

    const response = await worker.fetch(request(`/api/weather/point-forecast?latitude=37.5665&longitude=126.978&baseDate=${baseDate}&baseTime=0200`),
        dataGoEnv(decodedKey), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, '기상청 단기예보');
    assert.equal(body.items.length, 49);
    assert.equal(body.items[1].forecastDateTime, `${baseDate}0300`);
    assert.equal(body.items[1].precipitationAmount, '1.0mm 미만');
    assert.equal(body.items[1].snowfallAmount, '적설없음');
    assert.equal(body.items[1].skyLabel, '구름많음');
    assert.equal(body.items[1].precipitationTypeLabel, '없음');
    assert.equal(body.items[1].waveHeight, 1.4);
    assert.equal(body.items[2].precipitationType, 4);
    assert.equal(body.items[2].precipitationTypeLabel, '소나기');
    assert.equal(body.items[2].waveHeight, null);
    assert.equal(body.items[3].precipitationType, null, '5~7은 단기예보 PTY 코드가 아니다');
    assert.equal(body.items[3].precipitationTypeLabel, null);
    assert.equal(body.items[0].temperature, null);

    assert.equal(upstreamUrls.length, 1);
    const upstream = upstreamUrls[0];
    assert.equal(new URL(upstream).searchParams.get('serviceKey'), decodedKey);
    assert.match(upstream, /serviceKey=test%2Bkey%2Fwith%3D%3D/);
    assert.doesNotMatch(upstream, /%25(?:2B|2F|3D)/i);
    assert.ok(cache.keys.length > 0);
    assert.ok(cache.keys.every((key) => !key.includes('serviceKey') && !key.includes(decodedKey)));
});

test('a Cache API write failure does not turn a valid forecast into 503', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const baseDate = yesterday();
    globalThis.caches = {
        default: {
            async match() { return undefined; },
            async put() { throw new Error('cache unavailable'); }
        }
    };
    globalThis.fetch = async () => jsonResponse(apiPayload([
        { fcstDate: baseDate, fcstTime: '0300', category: 'TMP', fcstValue: '19' }
    ]));
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(`/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${baseDate}&baseTime=0200`),
        dataGoEnv(), {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[1].temperature, 19);
});

test('data.go pagination is server-controlled and all declared forecast items are collected', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    const baseDate = yesterday();
    globalThis.caches = { default: cache };
    const pages = [];
    globalThis.fetch = async (url) => {
        const query = new URL(String(url)).searchParams;
        const pageNo = Number(query.get('pageNo'));
        pages.push({ pageNo, numOfRows: query.get('numOfRows') });
        return jsonResponse(apiPayload([{
            fcstDate: baseDate,
            fcstTime: '0300',
            category: pageNo === 1 ? 'TMP' : 'REH',
            fcstValue: pageNo === 1 ? '18' : '60'
        }], 2));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(`/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${baseDate}&baseTime=0200`),
        dataGoEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items[1].temperature, 18);
    assert.equal(body.items[1].humidity, 60);
    assert.deepEqual(pages, [
        { pageNo: 1, numOfRows: '1000' },
        { pageNo: 2, numOfRows: '1000' }
    ]);
});

test('data.go rejects a declared item count above the endpoint memory budget', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return jsonResponse(apiPayload([], 1001));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(
        `/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${yesterday()}&baseTime=0200`),
    dataGoEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(upstreamCalls, 1);
});

test('an unrecognized forecast payload is not cached and returns the generic 503 response', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    const baseDate = yesterday();
    globalThis.caches = { default: cache };
    globalThis.fetch = async () => jsonResponse(apiPayload([
        { fcstDate: baseDate, fcstTime: '0300', category: 'UNKNOWN', fcstValue: '1' }
    ]));
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(`/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${baseDate}&baseTime=0200`),
        dataGoEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'data temporarily unavailable');
    assert.equal(cache.keys.length, 0);
});

test('airQuality normalizes coordinates, grades and flags without putting the key in cache keys', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const upstreamUrls = [];
    globalThis.fetch = async (url) => {
        const parsed = new URL(String(url));
        upstreamUrls.push(parsed.toString());
        if (parsed.pathname.endsWith('/getMsrstnList')) {
            return jsonResponse(apiPayload([
                { stationName: '테스트측정소', addr: '서울 테스트로 1', mangName: '도시대기', dmX: '37.57', dmY: '126.98' },
                { stationName: '테스트측정소', addr: '부산 테스트로 2', mangName: '도시대기', dmX: '129.08', dmY: '35.18' }
            ]));
        }
        return jsonResponse(apiPayload([
            {
                stationName: '테스트측정소', sidoName: '서울', mangName: '도로변대기', dataTime: '2026-07-13 10:00',
                pm10Value: '32', pm25Value: '18', pm10Grade1h: '2', pm10Grade: '4', pm25Grade: '3',
                pm10Flag: '-', pm25Flag: '점검중'
            }
        ]));
    };

    const response = await worker.fetch(request('/api/environment/air-quality?minLat=33&maxLat=39&minLon=124&maxLon=130'),
        dataGoEnv('air+key=='), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'AirKorea');
    assert.equal(body.stale, false);
    assert.equal(body.dataTime, '2026-07-13 10:00');
    assert.equal(body.dataTimeFrom, '2026-07-13 10:00');
    assert.equal(body.stations.length, 1);
    assert.deepEqual(body.stations[0], {
        name: '테스트측정소',
        address: '서울 테스트로 1',
        network: '도로변대기',
        latitude: 37.57,
        longitude: 126.98,
        pm10: 32,
        pm25: null,
        pm10Grade: 2,
        pm25Grade: null,
        pm10Flag: null,
        pm25Flag: '점검중',
        dataTime: '2026-07-13 10:00'
    });
    assert.equal(upstreamUrls.length, 2);
    assert.ok(cache.keys.every((key) => !key.includes('serviceKey') && !key.includes('air+key')));
});

test('AirKorea fetches use timeout signals and reject a chunked response over 4 MiB', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    const signals = [];
    let cancelled = 0;
    globalThis.fetch = async (url, options) => {
        signals.push(options.signal);
        assert.equal(options.cache, 'no-store');
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/getMsrstnList')) {
            return jsonResponse(apiPayload([{
                stationName: '크기검증소', addr: '서울특별시 테스트', mangName: '도시대기',
                dmX: '127', dmY: '37.5'
            }]));
        }
        return new Response(byteStream(8 * 1024 * 1024, () => { cancelled++; }));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(
        request('/api/environment/air-quality?minLat=32&maxLat=44&minLon=122&maxLon=134'), dataGoEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(cancelled, 1);
    assert.equal(signals.length, 2);
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
});

test('airQuality resolves province aliases, drops ambiguity and preserves flagged missing stations', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    globalThis.fetch = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/getMsrstnList')) {
            return jsonResponse(apiPayload([
                { stationName: '중앙동', addr: '서울특별시 테스트', mangName: '도시대기', dmX: '127', dmY: '37.5' },
                { stationName: '중앙동', addr: '전라북도 테스트', mangName: '도시대기', dmX: '127.1', dmY: '35.8' },
                { stationName: '모호동', addr: '서울특별시 테스트', mangName: '도시대기', dmX: '127.2', dmY: '37.4' },
                { stationName: '모호동', addr: '부산광역시 테스트', mangName: '도시대기', dmX: '129', dmY: '35.2' },
                { stationName: '자료없음', addr: '서울특별시 점검소', mangName: '도시대기', dmX: '126.9', dmY: '37.6' }
            ]));
        }
        return jsonResponse(apiPayload([
            {
                stationName: '중앙동', sidoName: '전북특별자치도', dataTime: '2026-07-13 10:00',
                pm10Value: '20', pm25Value: '10', pm10Grade1h: '1', pm25Grade1h: '1'
            },
            {
                stationName: '모호동', dataTime: '2026-07-13 11:00',
                pm10Value: '21', pm25Value: '11', pm10Grade1h: '1', pm25Grade1h: '1'
            },
            {
                stationName: '자료없음', sidoName: '서울', dataTime: '2026-07-13 09:00',
                pm10Value: '80', pm25Value: '35', pm10Grade1h: '3', pm25Grade1h: '3',
                pm10Flag: '점검중', pm25Flag: '점검중'
            }
        ]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request('/api/environment/air-quality?minLat=32&maxLat=44&minLon=122&maxLon=134'),
        dataGoEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dataTime, '2026-07-13 10:00');
    assert.equal(body.dataTimeFrom, '2026-07-13 09:00');
    assert.equal(body.stations.length, 2);
    const center = body.stations.find((station) => station.name === '중앙동');
    assert.equal(center.address, '전라북도 테스트');
    assert.ok(!body.stations.some((station) => station.name === '모호동'));
    const missing = body.stations.find((station) => station.name === '자료없음');
    assert.equal(missing.pm10, null);
    assert.equal(missing.pm25, null);
    assert.equal(missing.pm10Flag, '점검중');
});

test('invalid bbox and unknown forecast query fields are rejected before any upstream call', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('must not be called');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const env = dataGoEnv();
    const invalidBbox = await worker.fetch(request('/api/environment/air-quality?minLat=39&maxLat=33&minLon=124&maxLon=130'), env, {});
    assert.equal(invalidBbox.status, 400);

    const invalidForecast = await worker.fetch(request(`/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${yesterday()}&baseTime=0200&serviceKey=attacker`), env, {});
    assert.equal(invalidForecast.status, 400);
    assert.equal(upstreamCalls, 0);
});

test('airQuality serves the six-hour fallback snapshot as stale when refresh fails', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    globalThis.fetch = async () => new Response('upstream unavailable', { status: 503 });
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    await cache.put('https://bora-cache.internal/data-go/air/latest-stale', jsonResponse({
        dataTime: '2026-07-13 09:00',
        source: 'AirKorea',
        stations: [{
            name: '캐시측정소', address: null, network: '도시대기', latitude: 37.5, longitude: 127,
            pm10: 20, pm25: 10, pm10Grade: 1, pm25Grade: 1,
            pm10Flag: null, pm25Flag: null, dataTime: '2026-07-13 09:00'
        }]
    }));

    const response = await worker.fetch(request('/api/environment/air-quality?minLat=33&maxLat=39&minLon=124&maxLon=130'),
        dataGoEnv(), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    assert.equal(body.stale, true);
    assert.equal(body.stations[0].name, '캐시측정소');
});

test('airQuality negative-caches an upstream refresh failure', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('not approved', { status: 403 });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const airRequest = request('/api/environment/air-quality?minLat=33&maxLat=39&minLon=124&maxLon=130');
    const env = dataGoEnv();
    assert.equal((await worker.fetch(airRequest.clone(), env, {})).status, 503);
    assert.equal(upstreamCalls, 1);
    assert.equal((await worker.fetch(airRequest.clone(), env, {})).status, 503);
    assert.equal(upstreamCalls, 1);
    assert.ok(cache.keys.includes('https://bora-cache.internal/data-go/air/refresh-failed'));
});

test('public and forecast refresh limits return the shared 429 contract without trusting X-Forwarded-For', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('must not be called');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const publicKeys = [];
    const blockedPublic = dataGoEnv('test==', {
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit({ key }) {
                publicKeys.push(key);
                return { success: false };
            }
        }
    });
    const path = `/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${yesterday()}&baseTime=0200`;
    const limitedRequest = new Request('https://bora.test' + path, {
        headers: {
            'CF-Connecting-IP': '203.0.113.9',
            'X-Forwarded-For': '198.51.100.77'
        }
    });
    const limited = await worker.fetch(limitedRequest, blockedPublic, {});
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
    assert.equal(limited.headers.get('Cache-Control'), 'no-store');
    assert.equal(await limited.text(), 'rate limit exceeded');
    assert.deepEqual(publicKeys, ['weather-point-forecast:ip:203.0.113.9']);

    const blockedRefresh = dataGoEnv('test==', {
        FORECAST_REFRESH_LIMITER: { async limit() { return { success: false }; } }
    });
    const refreshLimited = await worker.fetch(request(path), blockedRefresh, {});
    assert.equal(refreshLimited.status, 429);
    assert.equal(refreshLimited.headers.get('Retry-After'), '60');
    assert.equal(refreshLimited.headers.get('Cache-Control'), 'no-store');
    assert.equal(upstreamCalls, 0);
});

test('airQuality treats an all-null nationwide observation snapshot as unavailable', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    globalThis.fetch = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/getMsrstnList')) {
            return jsonResponse(apiPayload([{
                stationName: '점검소', addr: '충청북도 테스트', mangName: '도시대기', dmX: '127', dmY: '36'
            }]));
        }
        return jsonResponse(apiPayload([{
            stationName: '점검소', sidoName: '충북', dataTime: '2026-07-13 10:00',
            pm10Value: '-', pm25Value: '-', pm10Flag: '점검중', pm25Flag: '점검중'
        }]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(
        request('/api/environment/air-quality?minLat=32&maxLat=44&minLon=122&maxLon=134'), dataGoEnv(), {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('new endpoints fail closed with 503 when the dedicated secret is absent or pre-encoded', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    globalThis.fetch = async () => { upstreamCalls++; return jsonResponse(apiPayload([])); };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const path = `/api/weather/point-forecast?latitude=37.5&longitude=127&baseDate=${yesterday()}&baseTime=0200`;
    assert.equal((await worker.fetch(request(path), {}, {})).status, 503);
    assert.equal((await worker.fetch(request(path), { DATA_GO_KR_SERVICE_KEY: 'already%3D%3D' }, {})).status, 503);
    assert.equal(upstreamCalls, 0);
});

test('cctv requires a valid ITS secret and fails closed without cache or upstream access', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    let limiterCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('ITS upstream must not be called without a valid secret');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const env = cctvEnv('', {
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit() { limiterCalls++; return { success: false }; }
        }
    });
    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'), env, {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(upstreamCalls, 0);
    assert.equal(limiterCalls, 0);
    assert.equal(cache.matchCalls, 0);
    assert.equal(cache.putCalls, 0);
    assert.deepEqual(cache.keys, [], '인증키 누락은 PoP cache 상태를 만들지 않는다');
});

test('cctv returns a successful live ITS response and stores a short cache snapshot', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return jsonResponse(cctvPayload([{
            cctvname: '실시간 CCTV', coordy: '37.6', coordx: '126.9',
            cctvformat: 'HLS', cctvtype: 4,
            cctvurl: 'https://cctvsec.ktict.co.kr/live/current.m3u8',
            roadsectionid: 'ROAD-LIVE'
        }]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'),
        cctvEnv('its-test-key'), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.stale, false);
    assert.equal(body.cctvs[0].name, '실시간 CCTV');
    assert.equal(upstreamCalls, 1);
    assert.equal(cache.matchCalls, 2, '전역 circuit과 supertile 상태를 각각 한 번 읽는다');
    assert.equal(cache.putCalls, 1);
});

test('cctv fails closed after a live ITS failure when no short stale cache exists', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('upstream unavailable', { status: 503 });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const failureStartedAt = Date.now();
    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'),
        cctvEnv('its-test-key'), {});
    assert.equal(response.status, 503);
    assert.equal(upstreamCalls, 1);
    assert.equal(cache.putCalls, 1, '여러 타일과 무관하게 전역 circuit만 한 번 쓴다');
    assert.deepEqual(cache.keys, [CCTV_CIRCUIT_KEY]);
    const circuitEntry = cache.entries.get(CCTV_CIRCUIT_KEY);
    assert.equal(circuitEntry.headers.get('Cache-Control'), 'public, max-age=120');
    const circuit = await circuitEntry.clone().json();
    assert.ok(circuit.retryAfter > Date.now());
    assert.ok(circuit.retryAfter <= failureStartedAt + 121_000);

    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('열린 circuit에서는 ITS fetch를 호출하면 안 된다');
    };
    const circuitStartedAt = Date.now();
    const second = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'),
        cctvEnv('its-test-key'), {});
    const circuitElapsed = Date.now() - circuitStartedAt;
    assert.equal(second.status, 503);
    assert.equal(upstreamCalls, 1, '다음 요청은 ITS upstream fetch를 0회 수행한다');
    assert.ok(circuitElapsed < 1000, `열린 circuit 응답이 너무 느리다: ${circuitElapsed}ms`);
    assert.equal(cache.putCalls, 1, '열린 circuit을 요청마다 다시 쓰지 않는다');
    assert.equal(cache.matchCalls, 4);
    assert.ok(cache.matchCalls + cache.putCalls + upstreamCalls <= 50);
});

test('cctv fails closed when cache access and the live ITS request both fail', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new RejectingCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('upstream unavailable', { status: 503 });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'),
        cctvEnv('its-test-key'), {});
    assert.equal(response.status, 503);
    assert.equal(upstreamCalls, 1);
    assert.equal(cache.matchCalls, 2);
    assert.equal(cache.putCalls, 1);
});

test('cctv uses fixed ITS parameters, normalizes the contract and drops unsafe stream URLs', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const publicKeys = [];
    const refreshKeys = [];
    const upstreamCalls = [];
    globalThis.fetch = async (url, options) => {
        upstreamCalls.push({ url: String(url), options });
        const common = {
            cctvname: '서울 테스트 CCTV', coordy: '37.6', coordx: '126.9', cctvformat: 'HLS'
        };
        return jsonResponse(cctvPayload([
            {
                ...common,
                roadsectionid: 'ROAD-1',
                cctvtype: 4,
                cctvurl: 'https://cctvsec.ktict.co.kr/live/test.m3u8',
                cctvresolution: '1280x720',
                filecreatetime: '20260713120000'
            },
            { ...common, cctvname: 'HTTP', cctvurl: 'http://cctvsec.ktict.co.kr/live/test.m3u8' },
            { ...common, cctvname: '다른 호스트', cctvurl: 'https://evil.example/live/test.m3u8' },
            { ...common, cctvname: '인증정보', cctvurl: 'https://user:pass@cctvsec.ktict.co.kr/live/test.m3u8' },
            { ...common, cctvname: '프래그먼트', cctvurl: 'https://cctvsec.ktict.co.kr/live/test.m3u8#secret' },
            { ...common, cctvname: '쿼리', cctvurl: 'https://cctvsec.ktict.co.kr/live/test.m3u8?token=secret' },
            { ...common, cctvname: '포트', cctvurl: 'https://cctvsec.ktict.co.kr:9443/live/test.m3u8' },
            { ...common, cctvname: '타입', cctvtype: '2', cctvurl: 'https://cctvsec.ktict.co.kr/live/test.m3u8' },
            { ...common, cctvname: '포맷', cctvformat: 'MP4', cctvurl: 'https://cctvsec.ktict.co.kr/live/test.m3u8' }
        ]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'),
        cctvEnv('its+secret==', {
            PUBLIC_ENVIRONMENTAL_LIMITER: {
                async limit({ key }) { publicKeys.push(key); return { success: true }; }
            },
            CCTV_REFRESH_LIMITER: {
                async limit({ key }) { refreshKeys.push(key); return { success: true }; }
            }
        }), {}
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    assert.match(body.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(body.stale, false);
    assert.equal(body.truncated, true);
    assert.equal(body.source, '국가교통정보센터(ITS)');
    assert.deepEqual(body.cctvs, [{
        id: 'ROAD-1|서울 테스트 CCTV@37.6000000,126.9000000',
        name: '서울 테스트 CCTV',
        latitude: 37.6,
        longitude: 126.9,
        streamUrl: 'https://cctvsec.ktict.co.kr/live/test.m3u8',
        format: 'HLS',
        resolution: '1280x720',
        fileCreatedAt: '20260713120000',
        roadSectionId: 'ROAD-1'
    }]);

    assert.deepEqual(publicKeys, ['traffic-cameras:anonymous']);
    assert.deepEqual(refreshKeys, ['its:cctv-refresh']);
    assert.equal(upstreamCalls.length, 1);
    const upstream = new URL(upstreamCalls[0].url);
    assert.equal(upstream.origin, 'https://openapi.its.go.kr:9443');
    assert.equal(upstream.pathname, '/cctvInfo');
    assert.deepEqual([...upstream.searchParams.keys()].sort(),
        ['apiKey', 'cctvType', 'getType', 'maxX', 'maxY', 'minX', 'minY', 'type'].sort());
    assert.equal(upstream.searchParams.get('apiKey'), 'its+secret==');
    assert.equal(upstream.searchParams.get('type'), 'all');
    assert.equal(upstream.searchParams.get('cctvType'), '4');
    assert.equal(upstream.searchParams.get('getType'), 'json');
    assert.equal(upstream.searchParams.get('minX'), '126.5');
    assert.equal(upstream.searchParams.get('maxX'), '127');
    assert.equal(upstream.searchParams.get('minY'), '37.5');
    assert.equal(upstream.searchParams.get('maxY'), '38');
    assert.equal(upstreamCalls[0].options.cache, 'no-store');
    assert.ok(upstreamCalls[0].options.signal instanceof AbortSignal);
    assert.ok(cache.keys.length > 0);
    assert.ok(cache.keys.every((key) => !key.includes('apiKey') && !key.includes('its+secret')));
    assert.equal(cache.matchCalls, 2);
    assert.equal(cache.putCalls, 1);
    assert.doesNotMatch(JSON.stringify(body), /its\+secret/);
});

test('cctv rejects non-exact or oversized bbox queries before using a limiter or upstream', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    let limiterCalls = 0;
    globalThis.fetch = async () => { upstreamCalls++; throw new Error('must not be called'); };
    const env = cctvEnv('its-test', {
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit() { limiterCalls++; return { success: true }; }
        }
    });
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const paths = [
        '/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75',
        '/api/traffic/cameras?minLat=37.5&minLat=37.6&maxLat=37.7&minLon=126.75&maxLon=126.95',
        '/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95&apiKey=attacker',
        // 7 latitude tiles × 4 longitude tiles = 28, maximum is 24.
        '/api/traffic/cameras?minLat=37&maxLat=38.75&minLon=126&maxLon=127'
    ];
    for (const path of paths) assert.equal((await worker.fetch(request(path), env, {})).status, 400);
    assert.equal(limiterCalls, 0);
    assert.equal(upstreamCalls, 0);
});

test('24 base tiles collapse to 14 supertiles and stay within the shared Free subrequest quota', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return jsonResponse(cctvPayload([]));
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    // 0.25° base tile 2×12=24. 두 축 모두 홀수 index에서 시작해 0.5° supertile 최악값 2×7=14다.
    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.25&maxLat=37.75&minLon=126.25&maxLon=129.25'), cctvEnv(), {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cctvs.length, 0);
    assert.equal(cache.matchCalls, 15, '전역 circuit 1회 + supertile 14회');
    assert.equal(cache.putCalls, 14);
    assert.equal(upstreamCalls, 14);
    assert.equal(cache.matchCalls + cache.putCalls + upstreamCalls, 43);
    assert.ok(cache.matchCalls + cache.putCalls + upstreamCalls <= 50);
    assert.ok([...cache.entries.keys()].every((key) => key.includes('/its/cctv/v2/') && !key.includes('apiKey')));
    assert.ok([...cache.entries.values()].every((entry) => entry.headers.get('Cache-Control') === 'public, max-age=300'));
    const cachedBodies = await Promise.all([...cache.entries.values()].map((entry) => entry.clone().text()));
    assert.ok(cachedBodies.every((body) => !body.includes('its-test-key')));
});

test('14 failed live CCTV supertiles fail closed within the Free subrequest quota', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('upstream unavailable', { status: 503 });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(request(
        '/api/traffic/cameras?minLat=37.25&maxLat=37.75&minLon=126.25&maxLon=129.25'),
    cctvEnv('its-test-key'), {});
    assert.equal(response.status, 503);
    assert.equal(cache.matchCalls, 15, '전역 circuit 1회 + supertile 14회');
    assert.equal(cache.putCalls, 1, '실패한 14개 타일 대신 전역 circuit을 한 번만 쓴다');
    assert.equal(upstreamCalls, 14);
    assert.deepEqual(cache.keys, [CCTV_CIRCUIT_KEY]);
    assert.equal(cache.matchCalls + cache.putCalls + upstreamCalls, 30);
    assert.ok(cache.matchCalls + cache.putCalls + upstreamCalls <= 50);
});

test('cctv aborts stalled supertile requests at the six-second upstream timeout', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let started = 0;
    let aborted = 0;
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        started++;
        const onAbort = () => {
            aborted++;
            reject(new DOMException('aborted', 'AbortError'));
        };
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
    });
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const startedAt = Date.now();
    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.5&maxLon=127.5'), cctvEnv(), {});
    const elapsed = Date.now() - startedAt;
    assert.equal(response.status, 503);
    assert.ok(elapsed >= 5500, `upstream timeout fired too early: ${elapsed}ms`);
    assert.ok(elapsed < 9000, `upstream timeout fired too late: ${elapsed}ms`);
    assert.equal(started, 2);
    assert.equal(aborted, 2);
    assert.equal(cache.matchCalls, 3, '전역 circuit 1회 + supertile 2회');
    assert.equal(cache.putCalls, 1, 'timeout은 전역 circuit 한 건으로만 기록한다');
});

test('cctv serves a five-minute stale supertile and opens one two-minute global circuit', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('upstream unavailable', { status: 503 });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const stateKey = 'https://bora-cache.internal/its/cctv/v2/75_253/state';
    const fetchedAtMs = Date.now() - 2 * 60 * 1000;
    const fetchedAt = new Date(fetchedAtMs).toISOString();
    const cachedState = {
        snapshot: {
            fetchedAt,
            truncated: false,
            cctvs: [{
            id: 'ROAD-CACHED|캐시 CCTV@37.6000000,126.9000000',
            name: '캐시 CCTV', latitude: 37.6, longitude: 126.9,
            streamUrl: 'https://cctvsec.ktict.co.kr/live/cached.m3u8',
            format: 'HLS', resolution: null, fileCreatedAt: null, roadSectionId: 'ROAD-CACHED'
            }]
        },
        freshUntil: fetchedAtMs + 60 * 1000,
        staleUntil: fetchedAtMs + 5 * 60 * 1000,
        retryAfter: 0
    };
    await cache.put(stateKey, new Response(JSON.stringify(cachedState), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300'
        }
    }));

    const cctvRequest = request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95');
    const env = cctvEnv();
    const first = await worker.fetch(cctvRequest.clone(), env, {});
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('Cache-Control'), 'no-store');
    const firstBody = await first.json();
    assert.equal(firstBody.stale, true);
    assert.equal(firstBody.fetchedAt, fetchedAt);
    assert.equal(firstBody.cctvs[0].name, '캐시 CCTV');

    const second = await worker.fetch(cctvRequest.clone(), env, {});
    assert.equal(second.status, 200);
    assert.equal((await second.json()).stale, true);
    assert.equal(upstreamCalls, 1);
    const unchangedState = await cache.entries.get(stateKey).clone().json();
    assert.equal(unchangedState.retryAfter, 0, '실패 상태를 supertile별로 다시 쓰지 않는다');
    assert.equal(unchangedState.snapshot.fetchedAt, fetchedAt);
    assert.equal(cache.entries.get(stateKey).headers.get('Cache-Control'), 'public, max-age=300');
    const circuit = await cache.entries.get(CCTV_CIRCUIT_KEY).clone().json();
    assert.ok(circuit.retryAfter > Date.now());
    assert.equal(cache.entries.get(CCTV_CIRCUIT_KEY).headers.get('Cache-Control'), 'public, max-age=120');
    assert.equal(cache.putCalls, 2, 'fixture 상태 1회 + 전역 circuit 1회');
});

test('cctv enforces both public and global refresh rate limits without an upstream call', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => { upstreamCalls++; throw new Error('must not be called'); };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });
    const path = '/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95';

    const publicKeys = [];
    const blockedPublic = await worker.fetch(new Request('https://bora.test' + path, {
        headers: { 'CF-Connecting-IP': '203.0.113.10', 'X-Forwarded-For': '198.51.100.9' }
    }), cctvEnv('its-test', {
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit({ key }) { publicKeys.push(key); return { success: false }; }
        }
    }), {});
    assert.equal(blockedPublic.status, 429);
    assert.equal(blockedPublic.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(publicKeys, ['traffic-cameras:ip:203.0.113.10']);

    const refreshKeys = [];
    const blockedRefresh = await worker.fetch(request(path), cctvEnv('its-test', {
        CCTV_REFRESH_LIMITER: {
            async limit({ key }) { refreshKeys.push(key); return { success: false }; }
        }
    }), {});
    assert.equal(blockedRefresh.status, 429);
    assert.equal(blockedRefresh.headers.get('Retry-After'), '60');
    assert.equal(blockedRefresh.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(refreshKeys, ['its:cctv-refresh']);
    assert.equal(upstreamCalls, 0);
    assert.equal(cache.putCalls, 0, 'refresh limit 초과는 ITS 장애 circuit을 열지 않는다');
});

test('cctv caps normalized results at 1000 and marks the response truncated', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    const items = Array.from({ length: 1001 }, (_, index) => ({
        roadsectionid: `ROAD-${String(index).padStart(4, '0')}`,
        cctvname: `CCTV ${String(index).padStart(4, '0')}`,
        coordy: '37.6',
        coordx: '126.9',
        cctvurl: 'https://cctvsec.ktict.co.kr/live/test.m3u8',
        cctvformat: 'HLS'
    })).reverse();
    globalThis.fetch = async () => jsonResponse(cctvPayload(items));
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const response = await worker.fetch(
        request('/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95'), cctvEnv(), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.cctvs.length, 1000);
    assert.equal(body.truncated, true);
    assert.equal(body.cctvs[0].id, 'ROAD-0000|CCTV 0000@37.6000000,126.9000000');
    assert.equal(body.cctvs[999].id, 'ROAD-0999|CCTV 0999@37.6000000,126.9000000');
    const cachedState = await [...cache.entries.values()][0].clone().json();
    assert.equal(cachedState.snapshot.cctvs.length, 1001);
});

test('cctv fails closed for a missing secret, malformed schema or response over 2 MiB', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const failedCache = new MemoryCache();
    globalThis.caches = { default: failedCache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        return jsonResponse({ response: { data: [] } });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });
    const path = '/api/traffic/cameras?minLat=37.5&maxLat=37.7&minLon=126.75&maxLon=126.95';

    assert.equal((await worker.fetch(request(path), {}, {})).status, 503);
    assert.equal((await worker.fetch(request(path), cctvEnv('already%2Bencoded'), {})).status, 503);
    assert.equal((await worker.fetch(request(path), cctvEnv('plain%key'), {})).status, 503);
    assert.equal(upstreamCalls, 0);
    assert.equal((await worker.fetch(request(path), cctvEnv(), {})).status, 503);
    assert.equal(upstreamCalls, 1);
    const failureOnly = [...failedCache.entries.values()][0];
    assert.equal(failureOnly.headers.get('Cache-Control'), 'public, max-age=120');
    assert.ok((await failureOnly.clone().json()).retryAfter > Date.now());
    assert.deepEqual(failedCache.keys, [CCTV_CIRCUIT_KEY]);

    // 새 PoP처럼 cache를 비워 negative cache가 oversized 검증을 가리지 않게 한다.
    globalThis.caches = { default: new MemoryCache() };
    globalThis.fetch = async () => {
        upstreamCalls++;
        return new Response('{}', {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(2 * 1024 * 1024 + 1)
            }
        });
    };
    assert.equal((await worker.fetch(request(path), cctvEnv(), {})).status, 503);
    assert.equal(upstreamCalls, 2);

    globalThis.caches = { default: new MemoryCache() };
    let streamedCancelled = 0;
    globalThis.fetch = async (_url, options) => {
        upstreamCalls++;
        assert.ok(options.signal instanceof AbortSignal);
        return new Response(byteStream(4 * 1024 * 1024, () => { streamedCancelled++; }));
    };
    assert.equal((await worker.fetch(request(path), cctvEnv(), {})).status, 503);
    assert.equal(upstreamCalls, 3);
    assert.equal(streamedCancelled, 1);
});
