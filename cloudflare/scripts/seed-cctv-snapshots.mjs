import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    normalizeCctvPayload,
    validateCachedCctvSnapshot
} from '../src/worker.js';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_ITEMS = 5000;
const SNAPSHOT_TTL_SECONDS = 2 * 24 * 3600;
const KEY_PREFIX = 'bora:cctv:location:v1:';

function parseArguments(argv) {
    let keyFile = '';
    let apply = false;
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--key-file' && index + 1 < argv.length) {
            keyFile = argv[++index];
        } else if (argument === '--apply') {
            apply = true;
        } else {
            throw new Error('사용법: --key-file <ITS 키 파일> [--apply]');
        }
    }
    if (!keyFile) throw new Error('ITS 키 파일 경로가 필요합니다.');
    return { keyFile: resolve(keyFile), apply };
}

function readApiKey(path) {
    const candidates = readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/[:：]\s*(.+)$/)?.[1]?.trim() ?? '')
        .filter((value) => /^[A-Za-z0-9_-]{16,128}$/.test(value));
    if (candidates.length !== 1) {
        throw new Error('ITS 인증키를 키 파일에서 하나만 확인할 수 있어야 합니다.');
    }
    return candidates[0];
}

async function fetchItsPayload(apiKey) {
    const endpoint = new URL('https://openapi.its.go.kr:9443/cctvInfo');
    endpoint.search = new URLSearchParams({
        apiKey,
        type: 'all',
        cctvType: '4',
        minX: '122',
        maxX: '134',
        minY: '32',
        maxY: '44',
        getType: 'json'
    });

    let response;
    try {
        response = await fetch(endpoint, {
            headers: { Accept: 'application/json', 'User-Agent': 'bora-weather/1.0' },
            signal: AbortSignal.timeout(45_000),
            cache: 'no-store'
        });
    } catch {
        throw new Error('ITS CCTV 원문 요청에 실패했습니다.');
    }
    if (!response.ok) throw new Error('ITS CCTV 원문을 정상 상태로 받지 못했습니다.');
    const declaredBytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES) {
        throw new Error('ITS CCTV 원문 크기가 허용 범위를 벗어났습니다.');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 2 || bytes.length > MAX_SOURCE_BYTES) {
        throw new Error('ITS CCTV 원문 크기가 허용 범위를 벗어났습니다.');
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error('ITS CCTV 원문 JSON을 해석하지 못했습니다.');
    }
}

function groupRawItems(payload) {
    const root = payload?.response;
    const items = root?.data;
    const declaredCount = Number(root?.datacount);
    if (!Array.isArray(items) || !Number.isInteger(declaredCount)
        || declaredCount !== items.length || items.length < 1
        || items.length > MAX_SOURCE_ITEMS) {
        throw new Error('ITS CCTV 선언 건수와 실제 자료가 일치하지 않습니다.');
    }

    const groups = new Map();
    let invalidCoordinates = 0;
    for (const item of items) {
        const latitude = Number(item?.coordy);
        const longitude = Number(item?.coordx);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || latitude < 32 || latitude > 44 || longitude < 122 || longitude > 134) {
            invalidCoordinates++;
            continue;
        }
        // 공개 bbox의 닫힌 상단 경계(44N·134E)는 마지막 0.5° 타일에 포함한다.
        const latIndex = Math.min(Math.floor(latitude * 2), 87);
        const lonIndex = Math.min(Math.floor(longitude * 2), 267);
        const key = `${latIndex}_${lonIndex}`;
        if (!groups.has(key)) groups.set(key, { latIndex, lonIndex, items: [] });
        groups.get(key).items.push(item);
    }
    return { sourceItems: items.length, invalidCoordinates, groups };
}

function buildEntries(payload) {
    const grouped = groupRawItems(payload);
    const fetchedAt = new Date().toISOString();
    const entries = [];
    let validItems = 0;
    for (const [key, group] of [...grouped.groups].sort(([left], [right]) => left.localeCompare(right))) {
        const tile = {
            latIndex: group.latIndex,
            lonIndex: group.lonIndex,
            minLat: group.latIndex / 2,
            maxLat: (group.latIndex + 1) / 2,
            minLon: group.lonIndex / 2,
            maxLon: (group.lonIndex + 1) / 2
        };
        const normalized = normalizeCctvPayload({
            response: { datacount: group.items.length, data: group.items }
        }, tile);
        if (!normalized?.cctvs?.length) continue;
        const snapshot = validateCachedCctvSnapshot({ fetchedAt, ...normalized }, tile);
        if (!snapshot) throw new Error(`CCTV 타일 검증 실패: ${key}`);
        validItems += snapshot.cctvs.length;
        entries.push({ key: KEY_PREFIX + key, value: JSON.stringify(snapshot) });
    }
    if (!entries.length) throw new Error('검증을 통과한 CCTV 타일이 없습니다.');
    return {
        sourceItems: grouped.sourceItems,
        validItems,
        dropped: grouped.sourceItems - validItems,
        invalidCoordinates: grouped.invalidCoordinates,
        entries
    };
}

function writeRemoteSnapshots(entries, apiKey) {
    const payload = JSON.stringify(entries);
    if (payload.includes(apiKey)) throw new Error('KV 업로드 자료에 인증키가 포함됐습니다.');

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'bora-cctv-'));
    const temporaryFile = join(temporaryDirectory, 'snapshots.json');
    try {
        writeFileSync(temporaryFile, payload, 'utf8');
        const cloudflareDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
        const wranglerCli = resolve(
            cloudflareDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
        const result = spawnSync(process.execPath, [
            wranglerCli, 'kv', 'bulk', 'put', temporaryFile,
            '--binding', 'HAZARD_SNAPSHOTS', '--remote', '--ttl', String(SNAPSHOT_TTL_SECONDS)
        ], {
            cwd: cloudflareDirectory,
            encoding: 'utf8',
            shell: false,
            windowsHide: true
        });
        if (result.status !== 0) throw new Error('CCTV KV 일괄 업로드에 실패했습니다.');
    } finally {
        try { unlinkSync(temporaryFile); } catch { /* 생성 전 실패는 정리할 파일이 없다. */ }
        try { rmdirSync(temporaryDirectory); } catch { /* 빈 임시 폴더만 제거한다. */ }
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const apiKey = readApiKey(options.keyFile);
    const converted = buildEntries(await fetchItsPayload(apiKey));
    if (options.apply) writeRemoteSnapshots(converted.entries, apiKey);
    console.log(JSON.stringify({
        sourceItems: converted.sourceItems,
        validItems: converted.validItems,
        dropped: converted.dropped,
        invalidCoordinates: converted.invalidCoordinates,
        tiles: converted.entries.length,
        applied: options.apply,
        ttlSeconds: SNAPSHOT_TTL_SECONDS,
        credentialIncluded: false
    }));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'CCTV 초기화에 실패했습니다.');
    process.exitCode = 1;
});
