const { test, expect } = require('@playwright/test');

async function openWorkspace(page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lastGridResult && window.WeatherGridWind && !window.WEATHER_GRID_GRID_LOADING);
}

test('요소 선택은 실제 격자와 요소명·시각 판독을 함께 바꾼다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.info_metric')).toContainText('풍향·풍속');
    await page.locator('#explore_modes [data-explore-mode="temperature"]').click();
    await expect(page.locator('.info_metric')).toHaveText('기온');
    await page.waitForFunction(() => window.lastGridElement === 'tmp' && !window.WEATHER_GRID_GRID_LOADING);
    await page.locator('#forecast_scrubber').fill('24');
    await expect(page.locator('#workspace_lead')).toHaveText('+24시간 예보');
    const expected = await page.evaluate(() => {
        const date = document.getElementById('forecast_date').value;
        const base = String(document.getElementById('baseTime').value).padStart(2, '0');
        const at = new Date(new Date(date + 'T' + base + ':00:00+09:00').getTime() + 24 * 3600000);
        return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    });
    await expect(page.locator('#workspace_hour')).toHaveText(expected);
});

test('제주 바로가기는 현재 예보를 보존하고 지도의 보이는 영역으로 이동한다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWorkspace(page);
    await page.locator('#forecast_scrubber').fill('7');
    await page.locator('[data-workspace-region="jeju"]').click();
    await expect(page.locator('#workspace_status')).toHaveText('제주 지도로 이동했습니다.');
    await expect(page.locator('#forecast_scrubber')).toHaveValue('7');
    const pixel = await page.evaluate(() => {
        const map = window.WeatherGridMapRuntime.map;
        return map.getPixelFromCoordinate(ol.proj.transform([126.55, 33.35], 'EPSG:4326', map.getView().getProjection()));
    });
    expect(pixel[0]).toBeGreaterThan(320);
    expect(pixel[0]).toBeLessThan(1230);
    expect(pixel[1]).toBeGreaterThan(125);
    expect(pixel[1]).toBeLessThan(748);
});

test('지도만 보기와 검색 단축키는 입력·포커스와 지도 선택을 보존한다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page);
    await page.keyboard.press('f');
    await expect(page.locator('#workspace_map_only')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#explore_modes')).toBeHidden();
    await expect(page.locator('.workspace_places')).toBeHidden();
    await expect(page.locator('#forecast_scrubber')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#workspace_map_only')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#workspace_map_only')).toBeFocused();
    await expect(page.locator('#explore_modes')).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.locator('#station_query')).toBeFocused();
    await page.keyboard.type('f');
    await expect(page.locator('#station_query')).toHaveValue('f');
    await expect(page.locator('#workspace_map_only')).toHaveAttribute('aria-pressed', 'false');
});

test('빠른 표시 설정은 기존 레이어와 동기화하고 발표시각 설정으로 바로 이동한다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page);
    const quick = page.locator('[data-workspace-layer="heat"]');
    const original = page.locator('#layer_toggles [data-layer="heat"]');
    await expect(quick).toHaveAttribute('aria-pressed', 'true');
    await quick.click();
    await expect(original).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => window.WeatherGridLayers.snapshot().heat)).toBe(false);
    await page.locator('#workspace_details').click();
    await original.click();
    await expect(quick).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#dock_collapse').click();
    await page.locator('#workspace_run_settings').click();
    await expect(page.locator('#forecast_source_settings')).toHaveAttribute('open', '');
    await expect(page.locator('#forecast_source_settings > summary')).toBeFocused();
});

test('모델 초기시각과 실제 자료시각을 요청 시각과 구분한다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/weather/grid?**', route => route.fulfill({ json: {
        data: [100, 200], nx: 2, ny: 1, nxMin: 60, nyMin: 127, step: 1,
        stats: { min: 100, avg: 150, max: 200 }, unit: 'W/㎡', windField: null,
        validTime: '2026-09-22T15:00:00+09:00', modelRunTime: '2026-09-22T00:00:00Z',
        timeAdjusted: true, temporalResolutionHours: 3
    }}));
    await page.goto('/#e=swdn&h=10m&d=2026-09-22&t=14&f=2&proj=KMA_GRID_LCC&v=heat');
    await page.waitForFunction(() => window.lastGridElement === 'swdn' && !window.WEATHER_GRID_GRID_LOADING);
    await expect(page.locator('#workspace_base_label')).toHaveText('모델 초기시각');
    await expect(page.locator('#workspace_base')).toContainText('09:00');
    await expect(page.locator('#workspace_valid_label')).toHaveText('실제 자료시각');
    await expect(page.locator('#workspace_hour')).toHaveText('15:00');
    await expect(page.locator('#workspace_source_note')).toContainText('16:00');
    await expect(page.locator('#workspace_source_note')).toContainText('15:00');
});

test('예제 자료와 대기질 관측을 실제 단기예보로 표시하지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/weather/grid?**', route => route.fulfill({ json: {
        data: [2], nx: 1, ny: 1, nxMin: 60, nyMin: 127, step: 1,
        stats: { min: 2, avg: 2, max: 2 }, windField: null, mock: true
    }}));
    await page.route('**/api/environment/air-quality?**', route => route.fulfill({ json: {
        dataTime: '2026-09-22 15:00', source: 'AirKorea', stations: []
    }}));
    await openWorkspace(page);
    await expect(page.locator('#workspace_source_name')).toHaveText('예제 자료');
    await expect(page.locator('#workspace_source_note')).toContainText('실제 기상 예보가 아닙니다');
    await page.locator('#data_domain_nav [data-data-domain="air"]').click();
    await expect(page.locator('#workspace_source_name')).toHaveText('한국환경공단 AirKorea');
    await expect(page.locator('.workspace_source dl')).toBeHidden();
    await expect(page.locator('#workspace_lead')).toContainText('바람 예보');
});

test('백그라운드 예보 재생과 풍장 계산을 중단하고 모션 감소 변경을 즉시 반영한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWorkspace(page);
    await page.waitForFunction(() => window.getWindDiagnostics().state === 'running');
    await page.locator('#btn_play').click();
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => window.WeatherGridPlayback.isPlaying())).toBe(false);
    await expect.poll(() => page.evaluate(() => window.getWindDiagnostics().state)).toBe('stopped');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => window.getWindDiagnostics().state)).toBe('reduced-motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => page.evaluate(() => window.getWindDiagnostics().state)).toBe('running');
    await expect.poll(() => page.evaluate(() => window.WeatherGridPlayback.isPlaying())).toBe(false);
});

test('축약 범례는 상세 범례와 같은 색을 쓰고 요소 변경 뒤에도 맞게 열린다', async ({ page }) => {
    await openWorkspace(page);
    for (const [mode, label] of [['wind', '풍속'], ['temperature', '기온']]) {
        await page.locator(`#explore_modes [data-explore-mode="${mode}"]`).click();
        await expect(page.locator('#map_color_key_title')).toContainText(label);
        const colors = await page.evaluate(() => ({
            compact: [...document.querySelectorAll('#map_color_strip i')].map(el => el.style.backgroundColor),
            detail: [...document.querySelectorAll('#legend_scale .lg_row > i')].map(el => el.style.backgroundColor).reverse()
        }));
        expect(colors.compact.length).toBeGreaterThan(2);
        expect(colors.compact).toEqual(colors.detail);
        await page.locator('#map_color_key').click();
        await expect(page.locator('#weather_legend')).toBeVisible();
        await expect(page.locator('#map_color_key')).toHaveAttribute('aria-expanded', 'true');
        await page.locator('#map_color_key').click();
        await expect(page.locator('#weather_legend')).toBeHidden();
    }
});

test('대기질 조회 실패는 지도에서 알리고 재시도로 복구한다', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/environment/air-quality?**', route => {
        requests++;
        return requests === 1
            ? route.fulfill({ status: 503, json: { message: '측정소 자료를 불러오지 못했습니다.' } })
            : route.fulfill({ json: { dataTime: '2026-09-22 15:00', source: 'AirKorea', stations: [] } });
    });
    await openWorkspace(page);
    await page.locator('#data_domain_nav [data-data-domain="air"]').click();
    await expect(page.locator('#workspace_data_notice')).toBeVisible();
    await expect(page.locator('#workspace_data_retry')).toBeVisible();
    await page.locator('#workspace_data_retry').click();
    await expect(page.locator('#workspace_data_notice')).toContainText('현재 화면에 표시할 대기질 측정소가 없습니다.');
    await expect(page.locator('#workspace_data_retry')).toBeHidden();
    expect(requests).toBeGreaterThanOrEqual(2);
});

test('모바일 설정에서 화면 테마를 바꾸고 지도에 바로 돌아온다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);
    await page.locator('#dock_toggle').click();
    const theme = page.locator('[data-workspace-action="theme_toggle"]');
    await expect(theme).toHaveText('어두운 화면');
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(theme).toHaveText('밝은 화면');
    await page.keyboard.press('Escape');
    await expect(page.locator('#dock_toggle')).toBeFocused();
    await expect(page.locator('#forecast_scrubber')).toBeVisible();
    await page.locator('#dock_toggle').click();
    await page.locator('[data-workspace-action="btn_3d"]').click();
    await expect(page.locator('#view3d')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#view3d canvas')).toBeFocused();
    await expect(page.locator('#dock')).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#dock_toggle')).toBeFocused();
});

for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1024, 768], [1280, 720], [1440, 900]]) {
    test(`기상지도 ${width}×${height}: 탐색·검색·시간축이 겹치거나 잘리지 않는다`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await openWorkspace(page);
        await expect(page.locator('#explore_modes')).toBeVisible();
        await expect(page.locator('#current_location')).toBeVisible();
        await expect(page.locator(width <= 900 ? '#dock_toggle' : '#btn_share')).toBeVisible();
        const bounds = await page.evaluate(() => {
            const rect = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
            return { status: rect('.map_status_panel'), modes: rect('#explore_modes'), places: rect('.workspace_places'), nav: rect('#mobile_primary_controls'), timeline: rect('.timeline'), input: rect('#station_query'), scroll: document.documentElement.scrollWidth, width: innerWidth };
        });
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
        expect(bounds.input.width).toBeGreaterThan(80);
        if (width <= 900) {
            expect(bounds.timeline.bottom).toBeLessThanOrEqual(bounds.modes.top + 1);
            expect(bounds.modes.bottom).toBeLessThanOrEqual(bounds.nav.top + 1);
            expect(bounds.nav.bottom).toBeLessThanOrEqual(height + 1);
            await page.locator('#dock_toggle').click();
            for (const action of ['btn_share', 'btn_3d', 'theme_toggle']) {
                const button = page.locator(`[data-workspace-action="${action}"]`);
                await expect(button).toBeVisible();
                expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
            }
            await page.keyboard.press('Escape');
        }
        if (width > 900) {
            expect(bounds.modes.x).toBeLessThan(bounds.status.x);
            expect(bounds.modes.bottom).toBeLessThan(bounds.places.top);
        }
        await page.locator('#explore_modes [data-explore-mode="temperature"]').click();
        await expect(page.locator('.info_metric')).toHaveText('기온');
    });
}
