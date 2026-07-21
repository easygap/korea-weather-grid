// 범례-데이터-색상 일치 검증
//
// 동적 범례(#legend_scale)는 분포도와 같은 색상 함수에서 생성되지만,
// 그 일치를 코드 리뷰가 아닌 테스트로 보증한다:
//   1) 범례 각 행의 스와치 색 == 해당 구간 대표값을 색상 함수에 넣은 색
//   2) 모든 행의 색이 서로 달라야 함 (중복 색 = 구간 구분 불가 — 과거 바람 5.0~5.5/5.5~6.0 중복 버그 회귀 방지)
//   3) 범례 카드의 최소/평균/최대 == 실제 표출 데이터(lastGridResult)에서 계산한 값
//   4) 일사: 그라디언트 스톱 25색 == solarPalette, 상단 눈금 == 해당 월 스케일 최대값
const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

/** '12 초과' | '4~5' | '-15 이하' → 구간 대표값 */
function midOf(label) {
    label = label.trim();
    let m;
    if ((m = label.match(/^(-?[\d.]+)\s*이상$/))) return parseFloat(m[1]) + 1;
    if ((m = label.match(/^(-?[\d.]+)\s*초과$/))) return parseFloat(m[1]) + 1;
    if ((m = label.match(/^(-?[\d.]+)\s*이하$/))) return parseFloat(m[1]) - 1;
    if ((m = label.match(/^(-?[\d.]+)\s*~\s*(-?[\d.]+)$/))) return (parseFloat(m[1]) + parseFloat(m[2])) / 2;
    return null;
}

function rgbOf(str) {
    const m = String(str).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    return m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : null;
}

async function legendRows(page) {
    return page.evaluate(() =>
        [...document.querySelectorAll('#legend_scale .lg_row')].map((r) => ({
            label: r.querySelector('.lg_label').textContent.trim(),
            bg: getComputedStyle(r.querySelector(':scope > i')).backgroundColor,
            aria: r.getAttribute('aria-label')
        }))
    );
}

async function distributionCheck(page, element) {
    const result = await page.evaluate((el) => {
        const validCount = window.lastGridResult.data.filter((value) =>
            Number.isFinite(value) && value !== 9999 && value > -900
        ).length;
        const rows = [...document.querySelectorAll('#legend_scale .lg_row')].map((row) => {
            const match = row.getAttribute('aria-label').match(/유효 격자 (\d+)개, ([\d.]+)%/);
            return { count: Number(match[1]), share: Number(match[2]) };
        });
        return {
            validCount,
            countSum: rows.reduce((sum, row) => sum + row.count, 0),
            shareSum: rows.reduce((sum, row) => sum + row.share, 0)
        };
    }, element);
    expect(result.countSum).toBe(result.validCount);
    if (result.validCount) expect(Math.abs(result.shareSum - 100)).toBeLessThan(0.7);
}

async function statsCheck(page, element) {
    // 정온(0m/s)과 야간 일사(0W/㎡)도 실제 값이다. -999/9999 결측만 제외한다.
    const s = await page.evaluate((el) => {
        const r = window.lastGridResult;
        let min = Infinity, max = -Infinity, sum = 0, cnt = 0;
        for (const v of r.data) {
            const valid = Number.isFinite(v) && v !== 9999 && v > -900;
            if (!valid) continue;
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v; cnt++;
        }
        const num = (id) => parseFloat(document.getElementById(id).textContent.replace(/[^\d.-]/g, ''));
        // 유효값이 하나도 없으면(야간 일사 등) 서버는 0/0/0으로 응답한다
        if (cnt === 0) { min = 0; max = 0; }
        return {
            min,
            max,
            avg: cnt ? sum / cnt : 0,
            dMin: num('grid_stat_min'),
            dMax: num('grid_stat_max'),
            dAvg: num('grid_stat_avg')
        };
    }, element);
    expect(Math.abs(s.dMin - s.min), `최소 표시 ${s.dMin} vs 실제 ${s.min}`).toBeLessThan(0.06);
    expect(Math.abs(s.dMax - s.max), `최대 표시 ${s.dMax} vs 실제 ${s.max}`).toBeLessThan(0.06);
    expect(Math.abs(s.dAvg - s.avg), `평균 표시 ${s.dAvg} vs 실제 ${s.avg}`).toBeLessThan(0.06);
    return s;
}

test.describe('범례-데이터-색상 일치', () => {
    test.setTimeout(180000);

    test('바람 — 행별 색상함수 일치 · 전 행 고유색 · 통계=데이터', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.waitForTimeout(1200);

        const rows = await legendRows(page);
        expect(rows.length).toBe(12);    // 1m/s 간격 12구간 (1 이하 ~ 12 이상)

        const seen = new Set();
        for (const row of rows) {
            const mid = midOf(row.label);
            expect(mid, `라벨 파싱 실패: ${row.label}`).not.toBeNull();
            const expected = rgbOf(await page.evaluate((v) => windPaletteColor(v), mid));
            const actual = rgbOf(row.bg);
            expect(actual, `${row.label}: 스와치 ${row.bg} vs 함수 ${expected}`).toEqual(expected);
            const key = actual.join(',');
            expect(seen.has(key), `중복 색 발견: ${row.label} (${key})`).toBe(false);
            seen.add(key);
            console.log(`  [바람] ${row.label} → rgb(${key}) ✓`);
        }
        const s = await statsCheck(page, "wdws");
        await distributionCheck(page, 'wdws');
        console.log(`  [바람] 통계 일치: min ${s.dMin} / avg ${s.dAvg} / max ${s.dMax} ✓`);
    });

    test('기온 — 행별 색상함수 일치 · 전 행 고유색 · 통계=데이터', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.locator('button[data-explore-mode="temperature"]:visible').click();
        await page.waitForFunction(() => window.lastGridElement === 'tmp', null, { timeout: 60000 });
        await page.waitForTimeout(1200);

        const rows = await legendRows(page);
        expect(rows.length).toBe(12);

        const seen = new Set();
        for (const row of rows) {
            const mid = midOf(row.label);
            const expected = rgbOf(await page.evaluate((v) => findTmpColor(v), mid));
            const actual = rgbOf(row.bg);
            expect(actual, `${row.label}: 스와치 ${row.bg} vs 함수 ${expected}`).toEqual(expected);
            const key = actual.join(',');
            expect(seen.has(key), `중복 색: ${row.label}`).toBe(false);
            seen.add(key);
        }
        console.log(`  [기온] 12행 색상함수 일치 + 고유색 ✓`);
        await distributionCheck(page, 'tmp');
        await statsCheck(page, "tmp");
    });

    test('강수 — 1시간 강수량 구간·색상·무강수 분포가 같은 기준을 쓴다', async ({ page }) => {
        const rainData = [0, 0.5, 1, 3, 15, 30, 50, -999];
        await page.route('**/api/weather/grid?**', (route) => {
            const element = new URL(route.request().url()).searchParams.get('element');
            const data = element === 'pcp' ? rainData : rainData.map(() => 2);
            return route.fulfill({
                json: {
                    data, nx: 2, ny: 4, nxMin: 60, nyMin: 127, step: 1,
                    stats: element === 'pcp'
                        ? { min: 0, avg: 14.2, max: 50 }
                        : { min: 2, avg: 2, max: 2 },
                    unit: element === 'pcp' ? 'mm' : 'm/s',
                    accumulationHours: element === 'pcp' ? 1 : undefined,
                    windField: null
                }
            });
        });
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.locator('button[data-explore-mode="precipitation"]:visible').click();
        await page.waitForFunction(() => window.lastGridElement === 'pcp');

        const rows = await legendRows(page);
        expect(rows.map((row) => row.label)).toEqual([
            '50 이상', '30–50', '15–30', '3–15', '1–3', '1 미만', '강수 없음'
        ]);
        const representative = [50, 30, 15, 3, 1, 0.5, 0];
        for (let index = 0; index < rows.length; index++) {
            const expected = index === rows.length - 1
                ? [119, 139, 160]
                : rgbOf(await page.evaluate((value) => findRainColor(value), representative[index]));
            expect(rgbOf(rows[index].bg), rows[index].label).toEqual(expected);
        }
        await expect(page.locator('#legend_scale .lg_unit')).toContainText('1시간 강수량 mm');
        await expect(page.locator('#legend_scale .lg_row').last()).toHaveAttribute('aria-label', /강수 없음.*14\.3%/);
        await distributionCheck(page, 'pcp');
        await statsCheck(page, 'pcp');
    });

    test('일사 — 그라디언트=solarPalette · 눈금=월 스케일 · 통계=데이터', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.locator('button[data-explore-mode="solar"]:visible').click();
        await page.waitForFunction(() => window.lastGridElement === 'swdn', null, { timeout: 60000 });
        await page.waitForTimeout(1200);

        const g = await page.evaluate(() => {
            const grad = document.querySelector('#legend_scale .lg_grad');
            const ticks = [...document.querySelectorAll('#legend_scale .lg_ticks span')].map((s) => s.textContent);
            const month = document.getElementById('forecast_date').value.split('-')[1];
            const bins = [...document.querySelectorAll('#legend_scale .lg_sun_bin')].map((row) => row.getAttribute('aria-label'));
            return {
                bgImage: getComputedStyle(grad).backgroundImage,
                ticks, month, bins,
                topOfScale: monthlySolarThresholds[month][monthlySolarThresholds[month].length - 1],
                first: solarPalette[solarPalette.length - 1],    // 그라디언트 상단(최댓값 색)
                last: solarPalette[0]
            };
        });
        const stops = g.bgImage.match(/rgba?\([^)]+\)/g) || [];
        expect(stops.length, '그라디언트 스톱 수').toBe(25);
        expect(rgbOf(stops[0])).toEqual(rgbOf(g.first));
        expect(rgbOf(stops[stops.length - 1])).toEqual(rgbOf(g.last));
        expect(parseInt(g.ticks[0], 10), '상단 눈금 = 월 스케일 최대').toBe(g.topOfScale);
        expect(g.bins).toHaveLength(10);
        const histogramCount = g.bins.reduce((sum, label) => sum + Number(label.match(/유효 격자 (\d+)개/)[1]), 0);
        const validCount = await page.evaluate(() => window.lastGridResult.data.filter((value) =>
            Number.isFinite(value) && value !== 9999 && value > -900
        ).length);
        expect(histogramCount).toBe(validCount);
        console.log(`  [일사] 25스톱 = solarPalette, 상단 눈금 ${g.ticks[0]} = ${g.month}월 스케일 최대 ✓`);
        await statsCheck(page, "swdn");
    });
});
