import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import {
    parseDataGoWarningStatus,
    parseLightningText,
    parseTyphoonText,
    parseWarningText,
    readSevereWeatherSnapshot,
    refreshSevereWeather
} from '../src/severe-weather.js';

const wranglerConfig = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

class MemoryKV {
    constructor(entries = {}) {
        this.entries = new Map(Object.entries(entries));
        this.getCalls = 0;
        this.putCalls = 0;
    }

    async get(key, type) {
        this.getCalls++;
        const value = this.entries.get(key);
        if (value === undefined) return null;
        return type === 'json' && typeof value === 'string' ? JSON.parse(value) : value;
    }

    async put(key, value) {
        this.putCalls++;
        this.entries.set(key, value);
    }
}

class MemoryCache {
    constructor() {
        this.entries = new Map();
        this.matchCalls = 0;
        this.putCalls = 0;
    }

    async match(request) {
        this.matchCalls++;
        const key = typeof request === 'string' ? request : request.url;
        return this.entries.get(key)?.clone();
    }

    async put(request, response) {
        this.putCalls++;
        const key = typeof request === 'string' ? request : request.url;
        this.entries.set(key, response.clone());
    }
}

const allowLimiter = () => ({ async limit() { return { success: true }; } });
const request = (path, init) => new Request(`https://bora.test${path}`, init);

const TYPHOON_SOURCE = `#START7777
# YY,SEQ,NOW,EFF,TM_ST,TM_ED,TYP_NAME,TYP_EN,REM
2026,5,1,1,202607210000,,보라,BORA,북서진 중
# FT,YY,TYP,SEQ,TMD,TYP_TM,FT_TM,LAT,LON,DIR,SP,PS,WS,RAD15,RAD25,RAD,ED15,ER15,ED25,ER25R,LOC
0,2026,5,12,0,202607210000,202607210000,25.0,130.0,NW,15,970,35,300,100,0,NE,250,NE,80,일본 남쪽 해상
1,2026,5,12,24,202607210000,202607220000,28.0,128.0,NW,18,975,32,280,90,120,NE,220,NE,70,제주 남쪽 해상
#7777END`;

const CURRENT_TYPHOON_SOURCE = `#START7777
# FT   YY  TYP  SEQ  TMD TYP_TM(UTC)  FT_TM(UTC) LAT LON DIR SP PS WS RAD15 RAD25 RAD ED15 ER15 LOC------------------------------ED25 ER25
0,2026,13,36,0,202608050000,202608050000,25.5,138.2,W,23,950,43,450,140,0,SW,350,일본 오키나와 동쪽 약 1030 km 부근 해상,SW,110,=
1,2026,13,0,12,202608050000,202608051200,25.7,136.0,W,18,950,43,450,140,40,SW,350,일본 오키나와 동쪽 약 810 km 부근 해상,SW,110,=
#7777END`;

const WARNING_SOURCE = `#START7777
# REG_UP,REG_UP_KO,REG_ID,REG_KO,TM_FC,TM_EF,WRN,LVL,CMD
L1000000,서울·인천·경기,L1010100,서울,202607211000,202607211100,R,2,6
#7777END`;

const LIGHTNING_SOURCE = `#START7777
20260721104000 126.9780 37.5665 -12.4 G 0.0
20260721104500 127.1000 37.4000 8.2 C 4.5
20260721104500 140.0000 37.4000 7.0 G 0.0
#7777END`;

const DATA_GO_WARNING_STATUS = {
    response: {
        header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
        body: {
            totalCount: 1,
            items: { item: [{
                tmFc: '202608042200',
                tmEf: '202608051100',
                t6: 'o 폭염중대경보 : 서울, 경기 동부\r\no 폭염주의보 : 제주도 산지',
                t7: 'o 없음',
                other: 'o 없음'
            }] }
        }
    }
};

test('pure parsers normalize KMA typhoon, warning, and lgt_pnt rows', () => {
    const typhoon = parseTyphoonText(TYPHOON_SOURCE);
    assert.equal(typhoon.active.length, 1);
    assert.equal(typhoon.active[0].id, '2026-05');
    assert.equal(typhoon.active[0].nameKo, '보라');
    assert.equal(typhoon.active[0].analysisTime, '2026-07-21T00:00:00Z');
    assert.deepEqual(typhoon.active[0].track.map((point) => point.kind), ['analysis', 'forecast']);
    assert.equal(typhoon.active[0].track[1].probabilityRadiusKm, 120);

    const warnings = parseWarningText(WARNING_SOURCE);
    assert.equal(warnings.warnings.length, 1);
    assert.equal(warnings.warnings[0].phenomenon, '호우');
    assert.equal(warnings.warnings[0].level, '주의보');
    assert.equal(warnings.warnings[0].command, '변경');
    assert.equal(warnings.warnings[0].issuedAt, '2026-07-21T10:00:00+09:00');

    const lightning = parseLightningText(LIGHTNING_SOURCE);
    assert.equal(lightning.strikes.length, 2, 'the server-side Korea bbox removes distant points');
    assert.deepEqual(lightning.strikes.map((strike) => strike.type), ['ground', 'cloud']);
    assert.equal(lightning.strikes[0].quality, null);
    assert.equal(lightning.strikes[1].altitudeKm, 4.5);
});

test('current APIHub typhoon rows and data.go warning status normalize without losing fields', () => {
    const typhoon = parseTyphoonText(CURRENT_TYPHOON_SOURCE);
    assert.equal(typhoon.active.length, 1);
    assert.equal(typhoon.active[0].analysisTime, '2026-08-05T00:00:00Z');
    assert.equal(typhoon.active[0].track[0].location, '일본 오키나와 동쪽 약 1030 km 부근 해상');
    assert.equal(typhoon.active[0].track[1].stormException.radiusKm, 110);

    const status = parseDataGoWarningStatus(DATA_GO_WARNING_STATUS);
    assert.equal(status.warnings.length, 2);
    assert.equal(status.warnings[0].phenomenon, '폭염');
    assert.equal(status.warnings[0].level, '중대경보');
    assert.equal(status.warnings[0].regionName, '서울, 경기 동부');
    assert.equal(status.warnings[0].issuedAt, '2026-08-04T22:00:00+09:00');
    assert.equal(status.warnings[0].effectiveAt, '2026-08-05T11:00:00+09:00');
});

test('data.go warning status distinguishes an empty result from malformed payloads', () => {
    assert.deepEqual(parseDataGoWarningStatus({
        response: { header: { resultCode: '00' }, body: { totalCount: 0, items: null } }
    }), { warnings: [] });
    assert.equal(parseDataGoWarningStatus({
        response: { header: { resultCode: '03' }, body: { totalCount: 0 } }
    }), null);
    assert.equal(parseDataGoWarningStatus({
        response: { header: { resultCode: '00' }, body: {
            totalCount: 1, items: { item: { tmFc: '202608042200', t6: '형식이 바뀐 응답' } }
        } }
    }), null);
});

test('malformed non-comment lightning rows are not mistaken for a valid empty result', () => {
    assert.equal(parseLightningText('#START7777\nnot-a-lightning-row\n#7777END'), null);
    assert.deepEqual(parseLightningText('#START7777\n#7777END'), { strikes: [], truncated: false });
});

test('scheduled refresh uses bounded deterministic KMA queries and writes independent KV snapshots', async (t) => {
    const originalFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.url ?? input);
        urls.push(url);
        if (url.pathname.endsWith('/getPwnStatus')) {
            return new Response(JSON.stringify(DATA_GO_WARNING_STATUS), {
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }
        const body = url.pathname.endsWith('/typ_now.php') ? TYPHOON_SOURCE
            : url.pathname.endsWith('/lgt_pnt.php') ? LIGHTNING_SOURCE
                : url.pathname.endsWith('/wrn_now_data_new.php') ? WARNING_SOURCE : null;
        return body ? new Response(body) : new Response('not found', { status: 404 });
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const kv = new MemoryKV();
    const env = {
        KMA_API_AUTH_KEY: 'secret-key',
        DATA_GO_KR_SERVICE_KEY: 'data-go-key',
        HAZARD_SNAPSHOTS: kv
    };
    const promises = [];
    const returned = worker.scheduled({ scheduledTime: Date.parse('2026-07-21T02:00:00Z') }, env, {
        waitUntil(promise) { promises.push(promise); }
    });
    assert.equal(returned, undefined);
    assert.equal(promises.length, 1);
    await Promise.all(promises);

    assert.equal(urls.length, 3);
    const lightningUrl = urls.find((url) => url.pathname.endsWith('/lgt_pnt.php'));
    assert.equal(lightningUrl.searchParams.get('tm'), '202607211050');
    assert.equal(lightningUrl.searchParams.get('dtm'), '60');
    assert.equal(lightningUrl.searchParams.get('gc'), 'T');
    assert.equal(lightningUrl.searchParams.get('authKey'), 'secret-key');
    const typhoonUrl = urls.find((url) => url.pathname.endsWith('/typ_now.php'));
    assert.equal(typhoonUrl.searchParams.get('mode'), '1');
    const warningUrl = urls.find((url) => url.pathname.endsWith('/getPwnStatus'));
    assert.equal(warningUrl.searchParams.get('serviceKey'), 'data-go-key');
    assert.equal(warningUrl.searchParams.get('pageNo'), '1');
    assert.equal(urls.some((url) => url.pathname.endsWith('/wrn_now_data_new.php')), false);
    assert.equal(kv.putCalls, 3);
    for (const value of kv.entries.values()) assert.doesNotMatch(String(value), /secret-key|data-go-key/);
});

test('a source failure preserves its last-good KV snapshot while other sources update', async () => {
    const previousWarning = JSON.stringify({
        schema: 'bora.warnings/v1', source: '기상청 기상특보',
        fetchedAt: '2026-07-21T01:50:00.000Z', lastSuccessAt: '2026-07-21T01:50:00.000Z',
        revision: 'a'.repeat(64), warnings: []
    });
    const kv = new MemoryKV({ 'hazard:warnings:v1:latest': previousWarning });
    const result = await refreshSevereWeather({
        KMA_API_AUTH_KEY: 'secret-key', HAZARD_SNAPSHOTS: kv
    }, Date.parse('2026-07-21T02:00:00Z'), {
        kmaUrl(path) { return `https://kma.test${path}`; },
        async fetchText(url) {
            if (url.endsWith('/wrn_now_data_new.php')) return '# ERROR upstream';
            if (url.endsWith('/lgt_pnt.php')) return LIGHTNING_SOURCE;
            return TYPHOON_SOURCE;
        }
    });

    assert.equal(result.warnings, 'failed');
    assert.equal(result.lightning, 'updated');
    assert.equal(result.typhoon, 'updated');
    assert.equal(kv.entries.get('hazard:warnings:v1:latest'), previousWarning);
});

test('an empty deployment refreshes typhoon immediately and then respects the 15-minute interval', async () => {
    const kv = new MemoryKV();
    let typhoonCalls = 0;
    const dependency = {
        kmaUrl(path) { return path; },
        async fetchText(url) {
            if (url.endsWith('/typ_now.php')) {
                typhoonCalls++;
                return TYPHOON_SOURCE;
            }
            return url.endsWith('/lgt_pnt.php') ? LIGHTNING_SOURCE : WARNING_SOURCE;
        }
    };
    const env = { KMA_API_AUTH_KEY: 'secret-key', HAZARD_SNAPSHOTS: kv };
    const firstTime = Date.parse('2026-07-21T02:05:00Z');
    const first = await refreshSevereWeather(env, firstTime, dependency);
    assert.equal(first.typhoon, 'updated');
    assert.equal(typhoonCalls, 1);

    const second = await refreshSevereWeather(env, firstTime + 5 * 60 * 1000, dependency);
    assert.equal(second.typhoon, 'skipped');
    assert.equal(typhoonCalls, 1);
});

test('public hazard routes read KV only, cache canonical responses, and honor ETag', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cache = new MemoryCache();
    globalThis.caches = { default: cache };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('public severe-weather routes must not call upstream');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });

    const now = Date.now();
    const toWall = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+09:00';
    const observed = new Date(now - 5 * 60 * 1000 + 9 * 60 * 60 * 1000)
        .toISOString().slice(0, 19) + '+09:00';
    const snapshot = {
        schema: 'bora.lightning/v1', source: '기상청 낙뢰관측',
        fetchedAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString(),
        revision: 'b'.repeat(64), from: observed, to: toWall, truncated: false,
        strikes: [{ id: 'one', observedAt: observed, latitude: 37.5, longitude: 127,
            type: 'ground', intensityKa: 3, altitudeKm: 0, errorRangeKm: null,
            sensorCount: null, quality: null }]
    };
    const kv = new MemoryKV({ 'hazard:lightning:v1:latest': JSON.stringify(snapshot) });
    let limiterCalls = 0;
    const env = {
        HAZARD_SNAPSHOTS: kv,
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit() { limiterCalls++; return { success: true }; }
        }
    };

    const first = await worker.fetch(request('/api/hazards/lightning?minutes=15'), env, {});
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('ETag'), `"${'b'.repeat(64)}"`);
    assert.match(first.headers.get('Cache-Control'), /max-age=60/);
    assert.equal((await first.json()).strikes.length, 1);
    assert.equal(kv.getCalls, 1);
    assert.equal(limiterCalls, 1);

    const second = await worker.fetch(request('/api/hazards/lightning?minutes=15'), env, {});
    assert.equal(second.status, 200);
    assert.equal(kv.getCalls, 1, 'the canonical Cache API response avoids another KV read');
    assert.equal(limiterCalls, 1, 'cache hits do not consume the public limiter');

    const notModified = await worker.fetch(request('/api/hazards/lightning?minutes=15', {
        headers: { 'If-None-Match': `"${'b'.repeat(64)}"` }
    }), env, {});
    assert.equal(notModified.status, 304);
    assert.equal(upstreamCalls, 0);
});

test('public validation is strict and KV misses never fall through to an upstream', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: new MemoryCache() };
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
        upstreamCalls++;
        throw new Error('public severe-weather routes must not call upstream');
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    });
    let limiterCalls = 0;
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const kv = new MemoryKV({
        'hazard:typhoon:v1:latest': JSON.stringify({
            schema: 'bora.typhoon/v1', source: '기상청 태풍 분석·예보',
            fetchedAt: old, lastSuccessAt: old, revision: 'c'.repeat(64), active: []
        })
    });
    const env = {
        HAZARD_SNAPSHOTS: kv,
        PUBLIC_ENVIRONMENTAL_LIMITER: {
            async limit() { limiterCalls++; return { success: true }; }
        }
    };
    for (const path of [
        '/api/hazards/lightning',
        '/api/hazards/lightning?minutes=5',
        '/api/hazards/lightning?minutes=15.0',
        '/api/hazards/lightning?minutes=30&minutes=60',
        '/api/hazards/lightning?minutes=60&extra=1'
    ]) {
        const invalid = await worker.fetch(request(path), env, {});
        assert.equal(invalid.status, 400, path);
    }
    assert.equal(limiterCalls, 0);

    for (const minutes of [15, 30, 60]) {
        const miss = await worker.fetch(request(`/api/hazards/lightning?minutes=${minutes}`), env, {});
        assert.equal(miss.status, 200);
        const body = await miss.json();
        assert.equal(body.status, 'unavailable');
        assert.deepEqual(body.strikes, []);
        assert.equal(body.truncated, false);
        assert.match(miss.headers.get('Cache-Control'), /max-age=60/);
    }
    const warningMiss = await worker.fetch(request('/api/hazards/warnings'), env, {});
    assert.equal(warningMiss.status, 200);
    assert.equal((await warningMiss.json()).status, 'unavailable');
    assert.match(warningMiss.headers.get('Cache-Control'), /max-age=60/);
    const cachedWarningMiss = await worker.fetch(request('/api/hazards/warnings'), env, {});
    assert.equal(cachedWarningMiss.status, 200);
    assert.equal(limiterCalls, 4, 'the cached unavailable state must not consume another public limit');
    assert.equal(upstreamCalls, 0);

    const stale = await worker.fetch(request('/api/hazards/typhoons'), env, {});
    assert.equal(stale.status, 200);
    assert.deepEqual(await stale.json(), {
        schema: 'bora.typhoon/v1',
        source: '기상청 태풍 분석·예보',
        status: 'unavailable',
        active: []
    });
    assert.match(stale.headers.get('Cache-Control'), /max-age=60/);
    assert.equal(limiterCalls, 5);
    assert.equal(await readSevereWeatherSnapshot(env, 'typhoon'), null);
});

test('Cache API failures fall through to the KV snapshot', async (t) => {
    const originalCaches = globalThis.caches;
    globalThis.caches = { default: {
        async match() { throw new Error('cache read failed'); },
        async put() { throw new Error('cache write failed'); }
    } };
    t.after(() => { globalThis.caches = originalCaches; });
    const now = new Date().toISOString();
    const kv = new MemoryKV({
        'hazard:warnings:v1:latest': JSON.stringify({
            schema: 'bora.warnings/v1', source: '기상청 기상특보',
            fetchedAt: now, lastSuccessAt: now, revision: 'd'.repeat(64), warnings: []
        })
    });
    const response = await worker.fetch(request('/api/hazards/warnings'), {
        HAZARD_SNAPSHOTS: kv, PUBLIC_ENVIRONMENTAL_LIMITER: allowLimiter()
    }, {});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).warnings, []);
    assert.equal(kv.getCalls, 1);
});

test('warning parser keeps a valid empty result distinct from authorization failure', () => {
    const empty = '#START7777\n# REG_UP,REG_UP_KO,REG_ID,REG_KO,TM_FC,TM_EF,WRN,LVL,CMD\n#7777END';
    const changedRelease = empty.replace('#7777END',
        'L1000000,전국,L1030000,경기도,202607211050,202607211300,H,3,7\n#7777END');

    assert.deepEqual(parseWarningText(empty), { warnings: [] });
    assert.equal(parseWarningText(changedRelease).warnings[0].command, '변경해제');
    assert.equal(parseWarningText(JSON.stringify({
        result: { status: 403, message: '활용신청이 필요한 API 입니다.' }
    })), null);
});

test('lightning minute filtering retains the correct KST wall-clock range', async () => {
    const now = Date.parse('2026-07-21T02:15:00Z');
    const kv = new MemoryKV({
        'hazard:lightning:v1:latest': JSON.stringify({
            schema: 'bora.lightning/v1', source: '기상청 낙뢰관측',
            fetchedAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString(),
            revision: 'd'.repeat(64), from: '2026-07-21T10:05:00+09:00',
            to: '2026-07-21T11:05:00+09:00', truncated: false,
            strikes: [
                { id: 'old', observedAt: '2026-07-21T10:30:00+09:00' },
                { id: 'recent', observedAt: '2026-07-21T10:50:00+09:00' }
            ]
        })
    });

    const result = await readSevereWeatherSnapshot({ HAZARD_SNAPSHOTS: kv }, 'lightning', {
        minutes: 30,
        nowMs: now
    });
    assert.equal(result.from, '2026-07-21T10:35:00+09:00');
    assert.deepEqual(result.strikes.map((strike) => strike.id), ['recent']);
});

test('refresh logs redact a secret even when the thrown error contains its full URL', async (t) => {
    const messages = [];
    const originalWarn = console.warn;
    console.warn = (message) => messages.push(String(message));
    t.after(() => { console.warn = originalWarn; });
    const secret = 'kma-secret-that-must-not-leak';

    const result = await refreshSevereWeather({
        KMA_API_AUTH_KEY: secret,
        HAZARD_SNAPSHOTS: new MemoryKV()
    }, Date.parse('2026-07-21T02:00:00Z'), {
        kmaUrl(path, params) {
            const url = new URL(path, 'https://kma.test');
            for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
            return url.toString();
        },
        async fetchText(url) {
            throw new Error(`upstream rejected ${url}`);
        }
    });

    assert.deepEqual(result, { typhoon: 'failed', lightning: 'failed', warnings: 'failed' });
    assert.equal(messages.length, 3);
    assert.doesNotMatch(messages.join('\n'), new RegExp(secret));
    assert.doesNotMatch(messages.join('\n'), /authKey=/i);
});

test('production config binds the snapshot KV and five-minute Cron together', () => {
    assert.match(wranglerConfig, /"binding"\s*:\s*"HAZARD_SNAPSHOTS"/);
    assert.match(wranglerConfig, /"crons"\s*:\s*\[\s*"\*\/5 \* \* \* \*"\s*\]/);
    assert.doesNotMatch(wranglerConfig, /KMA_API_AUTH_KEY"\s*:\s*"[^\n"]+"/);
});
