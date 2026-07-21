// 좌표 정합 검증 — 도법(LCC/메르카토르/위경도)별로
// "지리 좌표 → 화면 픽셀"의 렌더 색이 "API 격자값 → 기대 색"과 일치하는지 확인한다.
//
// 원리:
//   1) 알려진 지점(서울/부산/제주)의 위경도를 OL API로 현재 도법의 화면 픽셀로 변환
//   2) /api/weather/grid 응답(lastGridResult)에서 같은 지점의 격자 값을 공식 격자변환으로 조회
//      → windPaletteColor(값) = 기대 색 (셀 경계 오차 대비 4-이웃 셀 색도 허용)
//   3) 히트맵 레이어 캔버스의 실제 픽셀 색과 비교 (채널당 ±4 허용)
// 어떤 도법에서든 이 3단계가 일치해야 "올바른 좌표에 올바른 값"이 보장된다.
const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';
const POINTS = [
    { name: '서울', lat: 37.5665, lon: 126.9780 },
    { name: '부산', lat: 35.1796, lon: 129.0756 },
    { name: '제주', lat: 33.4996, lon: 126.5312 },
    { name: '백령도', lat: 37.9660, lon: 124.6300 },    // 서쪽 경계 부근
    { name: '울릉도', lat: 37.4840, lon: 130.9050 },    // 동쪽 원해
    { name: '목포', lat: 34.8120, lon: 126.3920 },      // 남서 해안
];
const PROJECTIONS = [
    { code: 'KMA_GRID_LCC', label: 'LCC(기상청)' },
    { code: 'EPSG:3857', label: '메르카토르' },
    { code: 'EPSG:4326', label: '위경도' },
];

/** 페이지 컨텍스트에서 지점별 [기대 색 후보들, 실제 렌더 색] 추출 */
async function samplePoints(page, points) {
    return page.evaluate((pts) => {
        const r = window.lastGridResult;
        if (!r) return { error: 'lastGridResult 없음' };

        // 히트맵(weatherRasterLayer)만 남기고 겹칠 수 있는 레이어를 잠시 숨긴다
        const hidden = [];
        weatherMap.getLayers().forEach((ly) => {
            if (ly.get('title') !== 'img' && ly.getVisible()) { hidden.push(ly); ly.setVisible(false); }
        });
        if (typeof window.suspendStreamlines === 'function') window.suspendStreamlines();
        weatherMap.renderSync();

        const results = pts.map((p) => {
            // 기대값: 공식 격자변환으로 셀 값 조회 (renderWeatherRaster와 동일 규칙)
            const g = kmaLatLonToGridFrac(p.lat, p.lon);
            const col = Math.round((g[0] - r.nxMin) / r.step);
            const rowS = Math.round((g[1] - r.nyMin) / r.step);
            const valAt = (c, rs) => {
                if (c < 0 || c >= r.nx || rs < 0 || rs >= r.ny) return null;
                return r.data[(r.ny - 1 - rs) * r.nx + c];
            };
            // 셀 경계 픽셀 대비: 해당 셀 + 4-이웃 셀 색을 모두 허용 후보로
            const candidates = [];
            [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr]) => {
                const v = valAt(col + dc, rowS + dr);
                if (v === null) return;
                const cstr = (window.lastGridElement === 'wdws') ? windPaletteColor(v)
                    : (window.lastGridElement === 'tmp') ? findTmpColor(v)
                    : solarPaletteColor(v, (typeof month !== 'undefined' ? month : '07'));
                const m = cstr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
                if (m) candidates.push([+m[1], +m[2], +m[3]]);
            });

            // 실제 렌더: 위경도 → 현재 도법 좌표 → 화면 픽셀 → 레이어 캔버스 픽셀
            const proj = weatherMap.getView().getProjection();
            const coord = ol.proj.transform([p.lon, p.lat], 'EPSG:4326', proj);
            const px = weatherMap.getPixelFromCoordinate(coord);
            if (!px) return { name: p.name, error: '화면 밖' };

            let rendered = null;
            const canvases = document.querySelectorAll('#map .ol-viewport canvas:not(#wind_field_canvas)');
            for (const cv of canvases) {
                const scaleX = cv.width / cv.clientWidth, scaleY = cv.height / cv.clientHeight;
                const x = Math.round(px[0] * scaleX), y = Math.round(px[1] * scaleY);
                if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
                try {
                    const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
                    if (d[3] > 0) rendered = [d[0], d[1], d[2], d[3]];
                } catch (e) { /* 컨텍스트 없는 캔버스 스킵 */ }
            }

            return { name: p.name, grid: [col, rowS], value: valAt(col, rowS), candidates, rendered };
        });

        hidden.forEach((ly) => ly.setVisible(true));
        weatherMap.renderSync();
        return { proj: weatherMap.getView().getProjection().getCode(), results };
    }, points);
}

function colorClose(a, b, tol) {
    return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

test.describe('도법별 좌표 정합 (렌더 픽셀 = API 격자값 색)', () => {
    test.setTimeout(180000);

    test('동일 뷰의 격자 LUT를 재사용하고 데이터·렌더 조건 변경은 반영한다', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.waitForFunction(() => getGridRenderLookupCacheStats().misses > 0);

        const initial = await page.evaluate(() => getGridRenderLookupCacheStats());
        expect(initial.sampleCount).toBeGreaterThan(0);

        const invalidationKeys = await page.evaluate(() => {
            const r = window.lastGridResult;
            const view = weatherMap.getView();
            const extent = view.calculateExtent(weatherMap.getSize());
            const resolution = view.getResolution();
            const projection = view.getProjection();
            const args = [window.WEATHER_GRID_VIEW_PROJ, r.nxMin, r.nyMin, r.step, r.nx, r.ny, 320, 240];
            return {
                base: gridRenderLookupKey(extent, resolution, 1, [640, 480], projection, ...args),
                extent: gridRenderLookupKey([extent[0] + 1, extent[1], extent[2], extent[3]],
                    resolution, 1, [640, 480], projection, ...args),
                size: gridRenderLookupKey(extent, resolution, 1, [800, 480], projection, ...args),
                pixelRatio: gridRenderLookupKey(extent, resolution, 2, [640, 480], projection, ...args),
                projection: gridRenderLookupKey(extent, resolution, 1, [640, 480],
                    { getCode: () => projection.getCode() + '-changed' }, ...args)
            };
        });
        ['extent', 'size', 'pixelRatio', 'projection'].forEach((name) => {
            expect(invalidationKeys[name]).not.toBe(invalidationKeys.base);
        });

        const cachedRenderMs = await page.evaluate(() => {
            const startedAt = performance.now();
            weatherRasterLayer.getSource().changed();
            weatherMap.renderSync();
            return performance.now() - startedAt;
        });
        await page.waitForFunction((hits) => getGridRenderLookupCacheStats().hits > hits, initial.hits);
        const reused = await page.evaluate(() => getGridRenderLookupCacheStats());
        expect(reused.misses).toBe(initial.misses);

        // 좌표 LUT가 적중해도 현재 데이터 배열은 매 렌더링마다 다시 읽어야 한다.
        const originalValues = await page.evaluate((point) => {
            const r = window.lastGridResult;
            const g = kmaLatLonToGridFrac(point.lat, point.lon);
            const col = Math.round((g[0] - r.nxMin) / r.step);
            const rowS = Math.round((g[1] - r.nyMin) / r.step);
            const saved = [];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const index = (r.ny - 1 - (rowS + dy)) * r.nx + col + dx;
                    saved.push([index, r.data[index]]);
                    r.data[index] = 50;
                }
            }
            weatherRasterLayer.getSource().changed();
            weatherMap.renderSync();
            return saved;
        }, POINTS[0]);
        const recolored = await samplePoints(page, [POINTS[0]]);
        const seoul = recolored.results[0];
        expect(seoul.rendered).toBeTruthy();
        expect(seoul.candidates.some((c) => colorClose(c, seoul.rendered, 4))).toBe(true);
        const afterDataChange = await page.evaluate(() => getGridRenderLookupCacheStats());
        expect(afterDataChange.hits).toBeGreaterThan(reused.hits);
        expect(afterDataChange.misses).toBe(reused.misses);

        await page.evaluate((saved) => {
            saved.forEach(([index, value]) => { window.lastGridResult.data[index] = value; });
            weatherRasterLayer.getSource().changed();
            weatherMap.renderSync();
        }, originalValues);

        const beforeTheme = await page.evaluate(() => getGridRenderLookupCacheStats());
        const invalidatedRenderMs = await page.evaluate(() => {
            const root = document.documentElement;
            root.setAttribute('data-theme', root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
            const startedAt = performance.now();
            weatherRasterLayer.getSource().changed();
            weatherMap.renderSync();
            return performance.now() - startedAt;
        });
        await page.waitForFunction((misses) => getGridRenderLookupCacheStats().misses > misses, beforeTheme.misses);
        console.log(`  [격자 LUT] ${initial.sampleCount.toLocaleString()} 샘플 · 재사용 ${cachedRenderMs.toFixed(1)}ms / 무효화 후 재생성 ${invalidatedRenderMs.toFixed(1)}ms`);
    });

    for (const proj of PROJECTIONS) {
        test(`${proj.label} — 서울·부산·제주 픽셀 색 일치`, async ({ page }) => {
            await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
            await page.waitForTimeout(1500);

            if (proj.code !== 'KMA_GRID_LCC') {
                await page.locator('#dock_toggle').click();
                await page.locator('#map_display_settings > summary').click();
                await page.locator('.advanced_disclosure > summary').click();
                await page.click(`#seg_proj button[data-proj="${proj.code}"]`);
                await page.waitForFunction((code) => window.WEATHER_GRID_VIEW_PROJ === code
                    && window.WEATHER_GRID_GRID_LOADING === false
                    && Boolean(window.lastGridResult)
                    && window.lastGridElement === 'wdws', proj.code, { timeout: 60000 });
                await page.waitForTimeout(800);    // ImageCanvas를 새 도법의 프레임에 합성
            }

            const out = await samplePoints(page, POINTS);
            expect(out.error, out.error).toBeFalsy();
            expect(out.proj).toBe(proj.code);

            for (const r of out.results) {
                expect(r.error, `${r.name}: ${r.error}`).toBeFalsy();
                expect(r.rendered, `${r.name}(격자 ${r.grid}, 값 ${r.value}) 렌더 픽셀 없음`).toBeTruthy();
                const matched = r.candidates.some((c) => colorClose(c, r.rendered, 4));
                expect(matched,
                    `${r.name} 색 불일치 — 값 ${r.value}, 기대 ${JSON.stringify(r.candidates)}, 실제 ${JSON.stringify(r.rendered)}`
                ).toBe(true);
                console.log(`  [${proj.label}] ${r.name}: 격자(${r.grid}) 값=${r.value} → 렌더 rgb(${r.rendered.slice(0, 3)}) ✓`);
            }
        });
    }

    test('줌인(레벨 10) 서울 — 셀 단위 정합 유지', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.evaluate(() => {
            const c = ol.proj.transform([126.978, 37.5665], 'EPSG:4326', weatherMap.getView().getProjection());
            weatherMap.getView().setCenter(c);
            weatherMap.getView().setZoom(10);
        });
        await page.waitForTimeout(2500);
        const out = await samplePoints(page, [POINTS[0]]);
        const r = out.results[0];
        expect(r.rendered, '렌더 픽셀 없음').toBeTruthy();
        const matched = r.candidates.some((c) => colorClose(c, r.rendered, 4));
        expect(matched, `줌인 색 불일치 — 값 ${r.value}, 실제 ${JSON.stringify(r.rendered)}`).toBe(true);
        console.log(`  [줌10] 서울: 값=${r.value} → 렌더 rgb(${r.rendered.slice(0, 3)}) ✓`);
    });

    test('기온(tmp)도 좌표 정합 (기본 LCC)', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.locator('button[data-explore-mode="temperature"]:visible').click();
        await page.waitForFunction(() => window.lastGridElement === 'tmp', null, { timeout: 60000 });
        await page.waitForTimeout(2500);

        const out = await samplePoints(page, POINTS);
        for (const r of out.results) {
            if (r.value !== null && r.value <= -900) {    // 비관측영역(투명) — 색 비교 대상 아님
                console.log(`  [tmp] ${r.name}: 결측(비관측) — 스킵`);
                continue;
            }
            expect(r.rendered, `${r.name} 렌더 픽셀 없음`).toBeTruthy();
            const matched = r.candidates.some((c) => colorClose(c, r.rendered, 4));
            expect(matched,
                `${r.name} 색 불일치 — 값 ${r.value}, 기대 ${JSON.stringify(r.candidates)}, 실제 ${JSON.stringify(r.rendered)}`
            ).toBe(true);
            console.log(`  [tmp] ${r.name}: 값=${r.value} ℃ → 렌더 rgb(${r.rendered.slice(0, 3)}) ✓`);
        }
    });

    test('일사강도(swdn)도 좌표 정합 (기본 LCC)', async ({ page }) => {
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.lastGridResult, null, { timeout: 60000 });
        await page.locator('button[data-explore-mode="solar"]:visible').click();
        await page.waitForFunction(() => window.lastGridElement === 'swdn', null, { timeout: 60000 });
        await page.waitForTimeout(2500);

        const out = await samplePoints(page, POINTS);
        for (const r of out.results) {
            expect(r.rendered, `${r.name} 렌더 픽셀 없음`).toBeTruthy();
            const matched = r.candidates.some((c) => colorClose(c, r.rendered, 4));
            expect(matched,
                `${r.name} 색 불일치 — 값 ${r.value}, 기대 ${JSON.stringify(r.candidates)}, 실제 ${JSON.stringify(r.rendered)}`
            ).toBe(true);
            console.log(`  [swdn] ${r.name}: 값=${r.value} W/㎡ → 렌더 rgb(${r.rendered.slice(0, 3)}) ✓`);
        }
    });
});
