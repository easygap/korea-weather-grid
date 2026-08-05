/**
 * KMA severe-weather ingestion.
 *
 * Upstream APIs are called only by the scheduled handler. Public requests read
 * the last validated snapshot from KV, which keeps API quota independent from
 * traffic and preserves the last good result during an upstream outage.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const LIGHTNING_PUBLIC_WINDOW_MS = 60 * 60 * 1000;
const SNAPSHOT_EXPIRATION_SECONDS = 2 * 24 * 60 * 60;

const KMA_PATH = Object.freeze({
    typhoon: '/api/typ01/url/typ_now.php',
    lightning: '/api/typ01/url/lgt_pnt.php',
    warnings: '/api/typ01/url/wrn_now_data_new.php'
});

const SOURCE = Object.freeze({
    typhoon: '기상청 태풍 분석·예보',
    lightning: '기상청 낙뢰관측',
    warnings: '기상청 기상특보'
});

const SCHEMA = Object.freeze({
    typhoon: 'bora.typhoon/v1',
    lightning: 'bora.lightning/v1',
    warnings: 'bora.warnings/v1'
});

const SNAPSHOT_KEY = Object.freeze({
    typhoon: 'hazard:typhoon:v1:latest',
    lightning: 'hazard:lightning:v1:latest',
    warnings: 'hazard:warnings:v1:latest'
});

const FRESH_MS = Object.freeze({
    typhoon: 30 * 60 * 1000,
    lightning: 12 * 60 * 1000,
    warnings: 12 * 60 * 1000
});

const MAX_STALE_MS = Object.freeze({
    typhoon: 12 * 60 * 60 * 1000,
    lightning: 60 * 60 * 1000,
    warnings: 2 * 60 * 60 * 1000
});

const MAX_BYTES = Object.freeze({
    typhoon: 2 * 1024 * 1024,
    lightning: 8 * 1024 * 1024,
    warnings: 2 * 1024 * 1024
});

const MAX_LIGHTNING_STRIKES = 8000;
const MAX_TEXT_LENGTH = 12 * 1024 * 1024;
const VALID_KINDS = new Set(Object.keys(SCHEMA));

const WARNING_PHENOMENON = Object.freeze({
    W: '강풍',
    R: '호우',
    C: '한파',
    D: '건조',
    O: '해일',
    N: '지진해일',
    V: '풍랑',
    T: '태풍',
    S: '대설',
    Y: '황사',
    H: '폭염',
    F: '안개'
});

const WARNING_LEVEL = Object.freeze({
    1: '예비특보',
    2: '주의보',
    3: '경보'
});

const WARNING_COMMAND = Object.freeze({
    1: '발표',
    2: '대치',
    3: '해제',
    4: '대치해제',
    5: '연장',
    6: '변경',
    7: '변경해제'
});

const COLUMN_HINTS = new Set([
    'YY', 'SEQ', 'TYP', 'NOW', 'EFF', 'TMST', 'TMED', 'TYPNAME', 'TYPEN', 'REM',
    'FT', 'TMD', 'TYPTM', 'FTTM', 'LAT', 'LON', 'DIR', 'SP', 'PS', 'WS', 'RAD15',
    'RAD25', 'RAD', 'ED15', 'ER15', 'ED25', 'ER25', 'ER25R', 'LOC',
    'STROKESID', 'YYMMDD', 'TIME', 'TM', 'NSFRAC', 'WKTINFO', 'WGS84LON', 'WGS84LAT',
    'ALTITUDE', 'INTENSITY', 'ERRORRANGE', 'TYPE', 'SENSER', 'SENSOR', 'QUALITY',
    'FLASHID', 'ST', 'T', 'HT', 'REGUP', 'REGUPKO', 'REGID', 'REGKO', 'REGNAME', 'TMFC', 'TMEF',
    'WRN', 'LVL', 'CMD'
]);

function compactUtc(ms) {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
        + `${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}`
        + `${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function compactKstWall(ms) {
    return compactUtc(ms + KST_OFFSET_MS);
}

function compactToIso(value, zone) {
    if (value === undefined || value === null) return null;
    const digits = String(value).replace(/\D/g, '');
    if (![10, 12, 14].includes(digits.length)) return null;
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    const hour = Number(digits.slice(8, 10));
    const minute = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0;
    const second = digits.length >= 14 ? Number(digits.slice(12, 14)) : 0;
    const utc = Date.UTC(year, month - 1, day, hour, minute, second);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month
        || check.getUTCDate() !== day || check.getUTCHours() !== hour
        || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return null;
    const base = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
        + `T${digits.slice(8, 10)}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    return zone === 'KST' ? `${base}+09:00` : `${base}Z`;
}

function lightningTimeToIso(dateValue, timeValue) {
    const rawDate = String(dateValue ?? '').replace(/\D/g, '');
    let ymd;
    if (rawDate.length === 6) ymd = `20${rawDate}`;
    else if (rawDate.length === 8) ymd = rawDate;
    else return null;
    const hms = String(timeValue ?? '').replace(/\D/g, '').slice(0, 6).padEnd(6, '0');
    return compactToIso(`${ymd}${hms}`, 'KST');
}

function kstIsoFromWallMs(wallMs) {
    const compact = compactUtc(wallMs);
    return compactToIso(compact, 'KST');
}

function columnKey(value) {
    return String(value ?? '').normalize('NFKC').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(value, maxLength = 120) {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned === '-' || cleaned === 'null') return null;
    return cleaned.slice(0, maxLength);
}

function finiteInRange(value, min, max) {
    const text = cleanText(value, 48);
    if (text === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function integerInRange(value, min, max) {
    const number = finiteInRange(value, min, max);
    return Number.isInteger(number) ? number : null;
}

function splitCsv(line) {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                value += '"';
                index++;
            } else quoted = !quoted;
        } else if (char === ',' && !quoted) {
            values.push(value.trim());
            value = '';
        } else value += char;
    }
    values.push(value.trim());
    return values;
}

function splitFields(line) {
    if (line.includes(',')) {
        const values = splitCsv(line);
        // 최신 APIHub CSV는 각 자료 행의 끝에 레코드 구분자 `=`를 붙인다.
        if (values.at(-1) === '=') values.pop();
        return values;
    }
    return line.trim().split(/\s+/);
}

function normalizeHeaderSource(line) {
    return line.replace(/\((?:UTC|KST)\)/ig, '')
        .replace(/-{3,}/g, ' ')
        .replace(/strokes\s+id/ig, 'STROKES_ID')
        .replace(/flash\s+id/ig, 'FLASH_ID');
}

function parseKmaTables(source) {
    if (typeof source !== 'string' || source.length === 0 || source.length > MAX_TEXT_LENGTH) return null;
    if (/<(?:html|!doctype)/i.test(source) || /(?:#\s*ERROR|"status"\s*:\s*403|활용신청)/i.test(source)) {
        return null;
    }

    const tables = [];
    let current = null;
    let envelope = false;
    let rawDataRows = 0;
    for (const originalLine of source.split(/\r?\n/)) {
        const trimmed = originalLine.trim();
        if (!trimmed) continue;
        if (/START7777|7777END/i.test(trimmed)) {
            envelope = true;
            continue;
        }

        const comment = trimmed.startsWith('#');
        const candidate = normalizeHeaderSource(trimmed.replace(/^#+\s*/, ''));
        const fields = splitFields(candidate);
        const keys = fields.map(columnKey);
        const hintCount = keys.filter((key) => COLUMN_HINTS.has(key)).length;
        if (hintCount >= 2 && fields.length >= 2) {
            current = { columns: keys, rows: [] };
            tables.push(current);
            continue;
        }
        if (comment || !current) continue;

        const values = splitFields(trimmed);
        if (values.length < Math.min(2, current.columns.length)) continue;
        const row = {};
        for (let index = 0; index < current.columns.length; index++) {
            if (index === current.columns.length - 1 && values.length > current.columns.length) {
                row[current.columns[index]] = values.slice(index).join(' ');
            } else row[current.columns[index]] = values[index] ?? '';
        }
        current.rows.push(row);
        rawDataRows++;
    }
    return { tables, envelope, rawDataRows };
}

function field(row, ...names) {
    for (const name of names) {
        const value = row?.[columnKey(name)];
        if (value !== undefined) return value;
    }
    return undefined;
}

function allRows(parsed) {
    return parsed.tables.flatMap((table) => table.rows);
}

function hasColumns(table, ...columns) {
    return columns.every((column) => table.columns.includes(columnKey(column)));
}

function nullableRadius(value) {
    return finiteInRange(value, 0, 3000);
}

/** Parse and normalize a KMA APIHub `typ_now.php` text response. */
export function parseTyphoonText(source) {
    const parsed = parseKmaTables(source);
    if (!parsed) return null;
    const metadata = new Map();
    let recognized = false;

    for (const table of parsed.tables) {
        if (!table.columns.includes('TYPNAME') && !table.columns.includes('TYPEN')
            && !(table.columns.includes('NOW') && table.columns.includes('TMST'))) continue;
        recognized = true;
        for (const row of table.rows) {
            const year = integerInRange(field(row, 'YY'), 1900, 2200);
            const number = integerInRange(field(row, 'TYP', 'SEQ'), 1, 99);
            if (year === null || number === null) continue;
            metadata.set(`${year}-${number}`, {
                year,
                number,
                nameKo: cleanText(field(row, 'TYP_NAME'), 40),
                nameEn: cleanText(field(row, 'TYP_EN'), 40),
                now: cleanText(field(row, 'NOW'), 12),
                startedAt: compactToIso(field(row, 'TM_ST'), 'UTC'),
                endedAt: compactToIso(field(row, 'TM_ED'), 'UTC'),
                note: cleanText(field(row, 'REM'), 160)
            });
        }
    }

    const systems = new Map();
    let trackRows = 0;
    let structurallyValidRows = 0;
    for (const table of parsed.tables) {
        if (!hasColumns(table, 'FT', 'LAT', 'LON') || !table.columns.includes('TYP')) continue;
        recognized = true;
        for (const row of table.rows) {
            trackRows++;
            const year = integerInRange(field(row, 'YY'), 1900, 2200);
            const number = integerInRange(field(row, 'TYP'), 1, 99);
            const kindCode = integerInRange(field(row, 'FT'), 0, 1);
            const latitude = finiteInRange(field(row, 'LAT'), -90, 90);
            const longitude = finiteInRange(field(row, 'LON'), -180, 180);
            const time = compactToIso(kindCode === 1
                ? field(row, 'FT_TM', 'TYP_TM') : field(row, 'TYP_TM', 'FT_TM'), 'UTC');
            if (year === null || number === null || kindCode === null
                || latitude === null || longitude === null || !time) continue;
            structurallyValidRows++;

            const key = `${year}-${number}`;
            const meta = metadata.get(key);
            const system = systems.get(key) ?? {
                id: `${year}-${String(number).padStart(2, '0')}`,
                number,
                nameKo: meta?.nameKo ?? null,
                nameEn: meta?.nameEn ?? null,
                bulletinSequence: null,
                analysisTime: null,
                startedAt: meta?.startedAt ?? null,
                note: meta?.note ?? null,
                track: []
            };
            const bulletinSequence = integerInRange(field(row, 'SEQ'), 0, 9999);
            if (bulletinSequence !== null) {
                system.bulletinSequence = Math.max(system.bulletinSequence ?? 0, bulletinSequence);
            }
            if (kindCode === 0 && (!system.analysisTime || time > system.analysisTime)) {
                system.analysisTime = time;
            }
            system.track.push({
                kind: kindCode === 0 ? 'analysis' : 'forecast',
                time,
                latitude,
                longitude,
                centerPressureHpa: finiteInRange(field(row, 'PS'), 800, 1100),
                maxWindMs: finiteInRange(field(row, 'WS'), 0, 150),
                direction: cleanText(field(row, 'DIR'), 12),
                speedKmh: finiteInRange(field(row, 'SP'), 0, 300),
                galeRadiusKm: nullableRadius(field(row, 'RAD15')),
                stormRadiusKm: nullableRadius(field(row, 'RAD25')),
                probabilityRadiusKm: nullableRadius(field(row, 'RAD')),
                galeException: nullableRadius(field(row, 'ER15')) === null ? null : {
                    direction: cleanText(field(row, 'ED15'), 12),
                    radiusKm: nullableRadius(field(row, 'ER15'))
                },
                stormException: nullableRadius(field(row, 'ER25', 'ER25R')) === null ? null : {
                    direction: cleanText(field(row, 'ED25'), 12),
                    radiusKm: nullableRadius(field(row, 'ER25', 'ER25R'))
                },
                location: cleanText(field(row, 'LOC'), 80)
            });
            systems.set(key, system);
        }
    }

    if (!recognized && !parsed.envelope) return null;
    if (trackRows > 0 && structurallyValidRows === 0) return null;

    const active = [...systems.entries()].filter(([key]) => {
        const meta = metadata.get(key);
        return !meta?.endedAt;
    }).map(([, system]) => {
        const unique = new Map();
        for (const point of system.track) unique.set(`${point.kind}:${point.time}`, point);
        system.track = [...unique.values()].sort((left, right) =>
            left.time.localeCompare(right.time) || left.kind.localeCompare(right.kind));
        return system;
    }).sort((left, right) => left.number - right.number);

    return { active };
}

function parseLightningFallback(line) {
    const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?';
    const expression = new RegExp(`^(\\S+)\\s+(\\d{6,8})\\s+(\\S+)\\s+(\\d+)\\s+`
        + `(?:SRID=\\d+;)?POINT\\s*\\([^)]*\\)\\s+(${number})\\s+(${number})\\s+`
        + `(${number})\\s+(${number})\\s+(${number})\\s+(\\d+)\\s+(\\d+)\\s+(.+)$`, 'i');
    const match = line.trim().match(expression);
    if (!match) return null;
    const tail = match[12].trim().split(/\s+/);
    if (tail.length < 2) return null;
    return {
        STROKESID: match[1],
        YYMMDD: match[2],
        TIME: match[3],
        WGS84LON: match[5],
        WGS84LAT: match[6],
        ALTITUDE: match[7],
        INTENSITY: match[8],
        ERRORRANGE: match[9],
        TYPE: match[10],
        SENSER: match[11],
        QUALITY: tail.at(-2),
        FLASHID: tail.at(-1)
    };
}

function parseLightningPointRow(line) {
    const values = line.trim().split(/\s+/);
    if (values.length < 6 || !/^\d{14}$/.test(values[0])) return null;
    return { TM: values[0], LON: values[1], LAT: values[2], ST: values[3], T: values[4], HT: values[5] };
}

function rawLightningRows(source, parsed) {
    const rows = allRows(parsed);
    if (rows.length) return rows;
    const fallback = [];
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const row = parseLightningPointRow(line) || parseLightningFallback(line);
        if (row) fallback.push(row);
    }
    return fallback;
}

function normalizeLightningRow(row) {
    const observedAt = compactToIso(field(row, 'TM'), 'KST')
        || lightningTimeToIso(field(row, 'YYMMDD', 'DATE'), field(row, 'TIME'));
    const latitude = finiteInRange(field(row, 'WGS84LAT', 'LAT'), -90, 90);
    const longitude = finiteInRange(field(row, 'WGS84LON', 'LON'), -180, 180);
    const qualityValue = field(row, 'QUALITY');
    const quality = qualityValue === undefined ? null : integerInRange(qualityValue, 0, 99);
    const typeValue = cleanText(field(row, 'TYPE', 'T'), 12)?.toUpperCase();
    const type = typeValue === '1' || typeValue === 'G' ? 'ground'
        : typeValue === '2' || typeValue === 'C' ? 'cloud' : null;
    if (!observedAt || latitude === null || longitude === null
        || (qualityValue !== undefined && quality === null) || !type) {
        return { structurallyValid: false, strike: null };
    }
    if ((quality !== null && quality !== 0)
        || latitude < 32 || latitude > 44 || longitude < 122 || longitude > 134) {
        return { structurallyValid: true, strike: null };
    }

    const strokeId = cleanText(field(row, 'STROKES_ID', 'STROKE_ID', 'STROKESID'), 96);
    const flashId = cleanText(field(row, 'FLASH_ID', 'FLASHID'), 96);
    const intensityKa = finiteInRange(field(row, 'INTENSITY', 'ST'), -2000, 2000);
    const altitudeKm = finiteInRange(field(row, 'ALTITUDE', 'HT'), -5, 100);
    const id = strokeId || `${observedAt}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`
        + `:${type}:${intensityKa ?? ''}:${altitudeKm ?? ''}`;
    return {
        structurallyValid: true,
        strike: {
            id,
            flashId,
            observedAt,
            latitude,
            longitude,
            type,
            intensityKa,
            altitudeKm,
            errorRangeKm: finiteInRange(field(row, 'ERROR_RANGE', 'ERRORRANGE'), 0, 1000),
            sensorCount: integerInRange(field(row, 'SENSER', 'SENSOR', 'SENSORCOUNT'), 0, 100),
            quality
        }
    };
}

/** Parse and normalize a KMA APIHub `lgt_pnt.php` text response. */
export function parseLightningText(source) {
    const parsed = parseKmaTables(source);
    if (!parsed) return null;
    const recognized = parsed.tables.some((table) =>
        (table.columns.includes('WGS84LAT') && table.columns.includes('WGS84LON'))
        || hasColumns(table, 'TM', 'LAT', 'LON'));
    const rows = rawLightningRows(source, parsed);
    let structurallyValidRows = 0;
    const deduplicated = new Map();
    for (const row of rows) {
        const normalized = normalizeLightningRow(row);
        if (normalized.structurallyValid) structurallyValidRows++;
        if (normalized.strike) deduplicated.set(normalized.strike.id, normalized.strike);
    }
    const rawNonCommentRows = source.split(/\r?\n/).filter((line) => {
        const value = line.trim();
        return value && !value.startsWith('#') && !/START7777|7777END/i.test(value);
    }).length;
    if (!recognized && rows.length === 0 && (!parsed.envelope || rawNonCommentRows > 0)) return null;
    if (rows.length > 0 && structurallyValidRows === 0) return null;
    const strikes = [...deduplicated.values()].sort((left, right) =>
        left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
    const truncated = strikes.length > MAX_LIGHTNING_STRIKES;
    return { strikes: truncated ? strikes.slice(-MAX_LIGHTNING_STRIKES) : strikes, truncated };
}

/** Parse and normalize a KMA APIHub `wrn_now_data_new.php` text response. */
export function parseWarningText(source) {
    const parsed = parseKmaTables(source);
    if (!parsed) return null;
    const recognized = parsed.tables.some((table) =>
        hasColumns(table, 'REG_ID', 'WRN', 'LVL', 'CMD'));
    const matchingRows = parsed.tables
        .filter((table) => hasColumns(table, 'REG_ID', 'WRN', 'LVL', 'CMD'))
        .flatMap((table) => table.rows);
    let structurallyValidRows = 0;
    const deduplicated = new Map();
    for (const row of matchingRows) {
        const regionId = cleanText(field(row, 'REG_ID'), 24);
        const phenomenonCode = cleanText(field(row, 'WRN'), 4)?.toUpperCase();
        const levelCode = cleanText(field(row, 'LVL'), 4);
        const commandCode = cleanText(field(row, 'CMD'), 4);
        const issuedAt = compactToIso(field(row, 'TM_FC'), 'KST');
        const effectiveAt = compactToIso(field(row, 'TM_EF'), 'KST');
        if (!regionId || !/^[A-Z0-9_-]+$/i.test(regionId) || !phenomenonCode
            || !WARNING_PHENOMENON[phenomenonCode] || !WARNING_LEVEL[levelCode]
            || !WARNING_COMMAND[commandCode] || !issuedAt) continue;
        structurallyValidRows++;
        const warning = {
            id: `${regionId}:${phenomenonCode}:${levelCode}:${issuedAt}`,
            regionId,
            regionName: cleanText(field(row, 'REG_KO', 'REG_NAME'), 80),
            parentRegionId: cleanText(field(row, 'REG_UP'), 24),
            parentRegionName: cleanText(field(row, 'REG_UP_KO'), 80),
            phenomenonCode,
            phenomenon: WARNING_PHENOMENON[phenomenonCode],
            levelCode,
            level: WARNING_LEVEL[levelCode],
            commandCode,
            command: WARNING_COMMAND[commandCode],
            issuedAt,
            effectiveAt
        };
        deduplicated.set(warning.id, warning);
    }
    if (!recognized && !parsed.envelope) return null;
    if (matchingRows.length > 0 && structurallyValidRows === 0) return null;
    const warnings = [...deduplicated.values()].sort((left, right) =>
        left.regionId.localeCompare(right.regionId)
        || left.phenomenonCode.localeCompare(right.phenomenonCode)
        || left.levelCode.localeCompare(right.levelCode));
    return { warnings };
}

const DATA_GO_WARNING_LEVELS = Object.freeze([
    Object.freeze({ suffix: '중대경보', code: '4' }),
    Object.freeze({ suffix: '경보', code: '3' }),
    Object.freeze({ suffix: '주의보', code: '2' }),
    Object.freeze({ suffix: '예비특보', code: '1' })
]);

function dataGoWarningItems(payload) {
    const response = payload?.response;
    if (String(response?.header?.resultCode ?? '') !== '00') return null;
    const body = response?.body;
    const totalCount = Number(body?.totalCount);
    if (!Number.isInteger(totalCount) || totalCount < 0 || totalCount > 100) return null;
    const raw = body?.items?.item ?? body?.items;
    if (totalCount === 0) {
        const empty = raw === undefined || raw === null || raw === ''
            || (Array.isArray(raw) && raw.length === 0)
            || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0);
        return empty ? [] : null;
    }
    const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : null;
    return items && items.length > 0 && items.length <= Math.min(10, totalCount) ? items : null;
}

function dataGoWarningLines(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64 * 1024) return null;
    const lines = value.normalize('NFKC').split(/\r?\n/).map((line) => line
        .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean).map((line) => line.replace(/^(?:o|○)\s*/i, '').trim());
    if (!lines.length || lines.every((line) => /^없음\.?$/.test(line))) return [];

    const entries = [];
    for (const line of lines) {
        if (/^없음\.?$/.test(line)) continue;
        const match = line.match(/^(.{1,60}?)\s*:\s*(.+)$/);
        if (match) entries.push({ label: match[1].trim(), regions: match[2].trim() });
        else if (entries.length) entries.at(-1).regions += ` ${line}`;
        else return null;
    }
    return entries;
}

/** 공공데이터포털 `getPwnStatus`의 최신 발효 현황을 화면 공통 계약으로 정규화한다. */
export function parseDataGoWarningStatus(payload) {
    const items = dataGoWarningItems(payload);
    if (!items) return null;
    if (!items.length) return { warnings: [] };
    const latest = [...items].sort((left, right) =>
        String(right?.tmFc ?? '').localeCompare(String(left?.tmFc ?? '')))[0];
    const issuedAt = compactToIso(latest?.tmFc, 'KST');
    const effectiveAt = compactToIso(latest?.tmEf, 'KST');
    const entries = dataGoWarningLines(latest?.t6);
    if (!issuedAt || entries === null) return null;

    const warnings = [];
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const level = DATA_GO_WARNING_LEVELS.find(({ suffix }) => entry.label.endsWith(suffix));
        const phenomenon = cleanText(level
            ? entry.label.slice(0, -level.suffix.length) : entry.label, 40);
        const regionName = cleanText(entry.regions, 4000);
        if (!phenomenon || !regionName) return null;
        const phenomenonCode = Object.entries(WARNING_PHENOMENON)
            .find(([, label]) => label === phenomenon)?.[0] ?? `STATUS-${index + 1}`;
        warnings.push({
            id: `status:${String(latest.tmFc)}:${index + 1}`,
            regionId: `STATUS-${index + 1}`,
            regionName,
            parentRegionId: null,
            parentRegionName: null,
            phenomenonCode,
            phenomenon,
            levelCode: level?.code ?? '0',
            level: level?.suffix ?? entry.label,
            commandCode: '0',
            command: '현황',
            issuedAt,
            effectiveAt
        });
    }
    return { warnings };
}

function kvBinding(env) {
    const binding = env?.HAZARD_SNAPSHOTS;
    return binding && typeof binding.get === 'function' && typeof binding.put === 'function'
        ? binding : null;
}

async function kvRead(env, kind) {
    const kv = kvBinding(env);
    if (!kv || !VALID_KINDS.has(kind)) return null;
    try {
        const value = await kv.get(SNAPSHOT_KEY[kind], 'json');
        if (typeof value === 'string') return JSON.parse(value);
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

async function kvWrite(env, kind, value) {
    const kv = kvBinding(env);
    if (!kv || !VALID_KINDS.has(kind)) return false;
    try {
        await kv.put(SNAPSHOT_KEY[kind], JSON.stringify(value), {
            expirationTtl: SNAPSHOT_EXPIRATION_SECONDS
        });
        return true;
    } catch {
        return false;
    }
}

function safeSnapshot(kind, value) {
    if (!value || typeof value !== 'object' || value.schema !== SCHEMA[kind]
        || value.source !== SOURCE[kind] || typeof value.revision !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.revision)) return null;
    if (kind === 'typhoon' && !Array.isArray(value.active)) return null;
    if (kind === 'lightning' && !Array.isArray(value.strikes)) return null;
    if (kind === 'warnings' && !Array.isArray(value.warnings)) return null;
    return value;
}

async function revisionOf(value) {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function makeSnapshot(kind, payload, scheduledTime) {
    const fetchedAt = new Date(scheduledTime).toISOString();
    const revisionPayload = kind === 'typhoon' ? payload.active
        : kind === 'lightning' ? { from: payload.from, to: payload.to, strikes: payload.strikes }
            : payload.warnings;
    return {
        schema: SCHEMA[kind],
        source: SOURCE[kind],
        fetchedAt,
        lastSuccessAt: fetchedAt,
        revision: await revisionOf(revisionPayload),
        ...payload
    };
}

function lightningWindow(scheduledTime) {
    const kstWallNow = scheduledTime + KST_OFFSET_MS;
    const completedEnd = Math.floor(kstWallNow / FIVE_MINUTES_MS) * FIVE_MINUTES_MS - 10 * 60 * 1000;
    return { start: completedEnd - LIGHTNING_PUBLIC_WINDOW_MS, end: completedEnd };
}

async function refreshTyphoon(env, scheduledTime, dependency) {
    const url = dependency.kmaUrl(KMA_PATH.typhoon, {
        tm: compactUtc(scheduledTime), mode: 1, disp: 1, help: 0,
        authKey: env.KMA_API_AUTH_KEY
    });
    const source = await dependency.fetchText(url, MAX_BYTES.typhoon);
    const parsed = parseTyphoonText(source);
    if (!parsed) throw new Error('invalid_typhoon_payload');
    const snapshot = await makeSnapshot('typhoon', parsed, scheduledTime);
    if (!(await kvWrite(env, 'typhoon', snapshot))) throw new Error('typhoon_kv_write_failed');
    return snapshot.revision;
}

async function refreshLightning(env, scheduledTime, dependency) {
    const window = lightningWindow(scheduledTime);
    const url = dependency.kmaUrl(KMA_PATH.lightning, {
        tm: compactUtc(window.end), dtm: 60, lon: 127.5, lat: 36.5, range: 700, gc: 'T',
        authKey: env.KMA_API_AUTH_KEY
    });
    const source = await dependency.fetchText(url, MAX_BYTES.lightning);
    const parsed = parseLightningText(source);
    if (!parsed) throw new Error('invalid_lightning_payload');

    const previous = safeSnapshot('lightning', await kvRead(env, 'lightning'));
    const cutoff = window.end - LIGHTNING_PUBLIC_WINDOW_MS;
    const merged = new Map();
    for (const strike of [...(previous?.strikes ?? []), ...parsed.strikes]) {
        const observed = Date.parse(strike?.observedAt);
        if (Number.isFinite(observed) && observed >= cutoff - KST_OFFSET_MS
            && observed <= window.end - KST_OFFSET_MS) merged.set(strike.id, strike);
    }
    let strikes = [...merged.values()].sort((left, right) =>
        left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
    const truncated = parsed.truncated || strikes.length > MAX_LIGHTNING_STRIKES;
    if (strikes.length > MAX_LIGHTNING_STRIKES) strikes = strikes.slice(-MAX_LIGHTNING_STRIKES);
    const snapshot = await makeSnapshot('lightning', {
        from: kstIsoFromWallMs(cutoff),
        to: kstIsoFromWallMs(window.end),
        truncated,
        strikes
    }, scheduledTime);
    if (!(await kvWrite(env, 'lightning', snapshot))) throw new Error('lightning_kv_write_failed');
    return snapshot.revision;
}

async function refreshWarnings(env, scheduledTime, dependency) {
    let parsed;
    if (typeof dependency.fetchWarningStatus === 'function') {
        parsed = parseDataGoWarningStatus(await dependency.fetchWarningStatus());
    } else {
        const url = dependency.kmaUrl(KMA_PATH.warnings, {
            fe: 'f', tm: compactKstWall(scheduledTime), disp: 1, help: 0,
            authKey: env.KMA_API_AUTH_KEY
        });
        const source = await dependency.fetchText(url, MAX_BYTES.warnings);
        parsed = parseWarningText(source);
    }
    if (!parsed) throw new Error('invalid_warning_payload');
    const snapshot = await makeSnapshot('warnings', parsed, scheduledTime);
    if (!(await kvWrite(env, 'warnings', snapshot))) throw new Error('warning_kv_write_failed');
    return snapshot.revision;
}

function logRefreshFailure(kind, error) {
    console.warn(JSON.stringify({
        event: 'severe_weather_refresh_failed',
        dataset: kind,
        reason: 'refresh_failed',
        errorType: error instanceof Error ? error.name : 'UnknownError'
    }));
}

/**
 * Refresh independently so one malformed upstream product cannot block the
 * other two. Typhoon data is checked every 15 minutes; warnings and lightning
 * follow the five-minute Cron cadence.
 */
export async function refreshSevereWeather(env, scheduledTime, dependency) {
    if (!Number.isFinite(scheduledTime) || !dependency
        || typeof dependency.kmaUrl !== 'function' || typeof dependency.fetchText !== 'function'
        || !kvBinding(env) || typeof env?.KMA_API_AUTH_KEY !== 'string'
        || env.KMA_API_AUTH_KEY.trim().length === 0) {
        return { typhoon: 'unavailable', lightning: 'unavailable', warnings: 'unavailable' };
    }

    const entries = [
        ['lightning', refreshLightning(env, scheduledTime, dependency)],
        ['warnings', refreshWarnings(env, scheduledTime, dependency)]
    ];
    const previousTyphoon = safeSnapshot('typhoon', await kvRead(env, 'typhoon'));
    const previousTyphoonAt = Date.parse(previousTyphoon?.lastSuccessAt || previousTyphoon?.fetchedAt || '');
    if (!Number.isFinite(previousTyphoonAt) || scheduledTime - previousTyphoonAt >= 15 * 60 * 1000) {
        entries.push(['typhoon', refreshTyphoon(env, scheduledTime, dependency)]);
    }

    const settled = await Promise.allSettled(entries.map(([, promise]) => promise));
    const result = { typhoon: 'skipped', lightning: 'failed', warnings: 'failed' };
    settled.forEach((outcome, index) => {
        const kind = entries[index][0];
        if (outcome.status === 'fulfilled') result[kind] = 'updated';
        else {
            result[kind] = 'failed';
            logRefreshFailure(kind, outcome.reason);
        }
    });
    return result;
}

function filterLightningWindow(snapshot, minutes) {
    const end = Date.parse(snapshot.to);
    if (!Number.isFinite(end)) return null;
    const cutoff = end - minutes * 60 * 1000;
    return {
        ...snapshot,
        from: kstIsoFromWallMs(cutoff + KST_OFFSET_MS),
        strikes: snapshot.strikes.filter((strike) => {
            const observed = Date.parse(strike?.observedAt);
            return Number.isFinite(observed) && observed >= cutoff && observed <= end;
        })
    };
}

/** Read a validated, age-bounded snapshot. This function never calls fetch. */
export async function readSevereWeatherSnapshot(env, kind, options = {}) {
    if (!VALID_KINDS.has(kind)) return null;
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const stored = safeSnapshot(kind, await kvRead(env, kind));
    if (!stored) return null;
    const successMs = Date.parse(stored.lastSuccessAt || stored.fetchedAt);
    if (!Number.isFinite(successMs) || successMs > nowMs + FIVE_MINUTES_MS) return null;
    const ageMs = Math.max(0, nowMs - successMs);
    if (ageMs > MAX_STALE_MS[kind]) return null;

    let snapshot = stored;
    if (kind === 'lightning') {
        const minutes = Number(options.minutes);
        if (![15, 30, 60].includes(minutes)) return null;
        snapshot = filterLightningWindow(stored, minutes);
        if (!snapshot) return null;
    }
    return {
        ...snapshot,
        stale: ageMs > FRESH_MS[kind],
        ageSeconds: Math.floor(ageMs / 1000)
    };
}

export function severeWeatherCacheControl(kind, stale, ageSeconds = 0) {
    const desiredMaxAge = stale ? (kind === 'typhoon' ? 60 : 30) : (kind === 'typhoon' ? 300 : 60);
    const remaining = Math.max(0, Math.floor(MAX_STALE_MS[kind] / 1000) - Math.max(0, ageSeconds));
    const maxAge = Math.min(desiredMaxAge, remaining);
    if (stale) return `public, max-age=${maxAge}, must-revalidate`;
    return kind === 'typhoon'
        ? `public, max-age=${maxAge}, stale-while-revalidate=900`
        : `public, max-age=${maxAge}, stale-while-revalidate=240`;
}
