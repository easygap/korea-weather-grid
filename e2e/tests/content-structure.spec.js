const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

test.describe('콘텐츠 구조와 모바일 설정', () => {
  test('데이터 영역과 기상 요소가 분리되고 +1~+48시간 탐색이 유지된다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('BORA 한국 기상 격자지도');
    await expect(page.getByRole('main')).toHaveAttribute('aria-labelledby', 'map_workspace_title');
    await expect(page.getByRole('search', { name: '대표 지역 검색' })).toHaveCount(1);
    await expect(page.getByRole('region', { name: '예보 시간 탐색' })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: '지도 범례' })).toHaveCount(1);
    await expect(page.locator('#data_domain_nav [data-data-domain]')).toHaveCount(3);
    await expect(page.locator('#data_domain_nav')).toHaveAttribute('aria-label', '데이터 영역');
    await expect(page.locator('#explore_modes [data-explore-mode]')).toHaveCount(5);
    await expect(page.locator('#explore_modes')).toHaveAttribute('aria-label', '기상 요소');
    await expect(page.locator('#timeline_scope')).toHaveText('기상 예보');
    await expect(page.locator('.timeline_caption')).toContainText('향후 48시간');
    await expect(page.locator('#forecast_scrubber')).toHaveAttribute('min', '1');
    await expect(page.locator('#forecast_scrubber')).toHaveAttribute('max', '48');
    await expect(page.locator('#forecast_scrubber')).toHaveValue('1');
    await expect(page.locator('#forecast_scrubber')).toHaveAttribute('aria-valuetext', /^\+1시간 예보, .+ KST$/);
    await expect(page.locator('[data-forecast="ini"]')).toHaveAttribute('title', '처음 (+1h)');
    await expect(page.locator('[data-forecast="fnl"]')).toHaveAttribute('title', '마지막 (+48h)');
    await expect(page.locator('#forecast_source_settings')).not.toHaveAttribute('open', '');
    await expect(page.locator('#map_display_settings')).not.toHaveAttribute('open', '');
    await expect(page.locator('#layer_settings')).toHaveAttribute('open', '');
    await expect(page.locator('#dock')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#btn_search')).toHaveCount(0);

    expect(await page.evaluate(() => {
      const header = document.querySelector('header');
      const main = document.querySelector('main');
      return !!(header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
  });

  test('기상·대기질·교통 영역이 예보와 최신 관측의 시간 맥락을 구분한다', async ({ page }) => {
    await page.route('**/api/environment/air-quality?**', (route) => route.fulfill({
      json: { dataTime: '2026-07-16 09:00', stale: false, source: 'AirKorea', stations: [] }
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    const modes = page.locator('#explore_modes [data-explore-mode]');
    await expect(modes).toHaveCount(5);
    expect(await modes.allTextContents()).toEqual(['바람', '기온', '강수·눈', '일사', '위험기상']);
    expect(await page.locator('#data_domain_nav [data-data-domain]').allTextContents()).toEqual(['기상', '대기질', '교통']);

    const summary = page.locator('#explore_mode_summary');
    await expect(summary).toHaveAttribute('data-kind', '예보');
    await expect(summary.locator('strong')).toHaveText('바람 흐름');
    await expect(page.locator('#timeline_scope')).toHaveText('기상 예보');
    await expect(page.locator('#timeline_range')).toHaveText('향후 48시간');

    await page.locator('#data_domain_nav [data-data-domain="air"]').click();
    await expect(summary).toHaveAttribute('data-kind', '최신 관측');
    await expect(summary.locator('strong')).toHaveText('초미세먼지');
    await expect(summary).toContainText('PM2.5 관측');
    await expect(page.locator('#timeline_scope')).toHaveText('바람 예보 시간');
    await expect(page.locator('#timeline_range')).toHaveText('미세먼지 최신 관측');

    await page.locator('#data_domain_nav [data-data-domain="traffic"]').click();
    await expect(page.locator('.timeline')).toBeHidden();
  });

  test('강수 딥링크가 데이터뿐 아니라 빠른 보기와 문맥까지 복원한다', async ({ page }) => {
    await page.route('**/api/weather/grid?**', (route) => route.fulfill({
      json: {
        data: [0, 3], nx: 2, ny: 1, nxMin: 60, nyMin: 127, step: 1,
        stats: { min: 0, avg: 1.5, max: 3 }, unit: 'mm', accumulationHours: 1,
        windField: null
      }
    }));
    await page.goto(BASE + '/#e=pcp&h=10m&d=2026-07-21&t=11&f=1&proj=KMA_GRID_LCC&v=heat', {
      waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#element')).toHaveValue('pcp');
    await expect(page.locator('button[data-explore-mode="precipitation"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#explore_mode_summary strong')).toHaveText('1시간 강수량');
    await expect(page.locator('#dock_context')).toHaveText('기상 · 강수·눈');
    await expect(page.locator('#timeline_scope')).toHaveText('강수·적설 예보');
  });

  test('세부 기상 요소는 상단 버튼을 늘리지 않고 한 표면씩 지연 조회한다', async ({ page }) => {
    const requested = [];
    const values = {
      wdws: [2, 2, 2, 2], pcp: [0, 1, 3, 15], pty: [0, 1, 2, 3],
      reh: [20, 40, 80, 100], wav: [-999, 0.5, 2, 4]
    };
    await page.route('**/api/weather/grid?**', (route) => {
      const element = new URL(route.request().url()).searchParams.get('element');
      requested.push(element);
      return route.fulfill({
        json: {
          data: values[element] || [0, 1, 3, 5], nx: 2, ny: 2, nxMin: 60, nyMin: 127, step: 1,
          stats: element === 'pty' ? { min: null, avg: null, max: null, count: 4 }
            : { min: 0, avg: 1, max: 4 }, unit: element === 'wav' ? 'm' : '%', windField: null
        }
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#explore_modes [data-explore-mode]')).toHaveCount(5);
    await page.locator('#dock_toggle').click();
    await page.locator('[data-explore-mode="precipitation"]').click();
    await expect(page.locator('#precipitation_elements')).toBeVisible();
    await page.locator('#seg_precipitation [data-val="pty"]').click();
    await page.waitForFunction(() => window.lastGridElement === 'pty');
    await expect(page.locator('#seg_element [data-val="pcp"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#seg_precipitation [data-val="pty"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#layer_toggles [data-layer="iso"]')).toBeDisabled();
    await expect(page.locator('#btn_3d')).toBeDisabled();
    await expect(page.locator('#weather_legend .grid_stats')).toBeHidden();
    await expect(page.locator('#legend_scale .lg_label')).toHaveText(['눈', '비/눈', '비', '소나기', '강수 없음']);

    await page.locator('#additional_weather_elements > summary').click();
    await page.locator('#seg_additional_weather [data-val="reh"]').click();
    await page.waitForFunction(() => window.lastGridElement === 'reh');
    await expect(page.locator('#layer_toggles [data-layer="iso"]')).toBeEnabled();
    await expect(page.locator('#btn_3d')).toBeEnabled();
    await expect(page.locator('#explore_mode_summary strong')).toHaveText('상대습도');

    await page.locator('#marine_weather_elements > summary').click();
    await page.locator('#seg_marine_weather [data-val="wav"]').click();
    await page.waitForFunction(() => window.lastGridElement === 'wav');
    await expect(page.locator('#weather_legend_title')).toHaveText('파고 분포');
    await expect(page.locator('#seg_marine_weather + .metric_context_note')).toContainText('육지는 값이 없는 영역');
    await expect(page.locator('#legend_scale .lg_unit')).toContainText('육지는 자료 없음');

    expect(requested.filter((element) => element === 'pty')).toHaveLength(1);
    expect(requested.filter((element) => element === 'reh')).toHaveLength(1);
    expect(requested.filter((element) => element === 'wav')).toHaveLength(1);
  });

  test('자동 재생은 3시간씩 이동하고 응답 후 6.2초 요청 간격을 지킨다', async ({ page }) => {
    test.setTimeout(30_000);
    const requests = [];
    await page.route('**/api/weather/grid?**', (route) => {
      const url = new URL(route.request().url());
      requests.push({ leadHours: Number(url.searchParams.get('leadHours')), at: Date.now() });
      return route.fulfill({
        json: {
          data: [2], nx: 1, ny: 1, nxMin: 60, nyMin: 127, step: 1,
          stats: { min: 2, avg: 2, max: 2 }, windField: null
        }
      });
    });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.lastGridResult));

    await page.locator('#btn_play').click();
    await expect(page.locator('#btn_play')).toHaveAttribute('aria-label', '예보 3시간 간격 자동 재생 일시정지');
    await expect.poll(() => requests.filter((item) => item.leadHours === 4).length).toBe(1);
    await expect.poll(() => requests.filter((item) => item.leadHours === 7).length, { timeout: 9_000 }).toBe(1);

    const first = requests.find((item) => item.leadHours === 4);
    const second = requests.find((item) => item.leadHours === 7);
    expect(second.at - first.at).toBeGreaterThanOrEqual(6_100);
    await page.locator('#btn_play').click();
  });

  test('과거 예보판은 날짜 증감 대신 이전·최신·다음 발표 단위로 이동한다', async ({ page }) => {
    await page.route('**/api/weather/grid?**', (route) => route.fulfill({
      json: {
        data: [1], nx: 1, ny: 1, nxMin: 60, nyMin: 127, step: 1,
        stats: { min: 1, avg: 1, max: 1 }
      }
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    await page.locator('#dock_toggle').click();
    const settings = page.locator('#forecast_source_settings');
    await settings.locator('summary').click();
    const previous = page.locator('#base_run_prev');
    const latest = settings.locator('.latest_run_button');
    const next = page.locator('#base_run_next');
    await expect(previous).toHaveText('이전 발표');
    await expect(latest).toHaveText('최신');
    await expect(next).toHaveText('다음 발표');
    await expect(page.locator('.btn_cal_day, .time_day')).toHaveCount(0);
    await expect(previous).toBeEnabled();
    await expect(next).toBeDisabled();

    const selectedInstant = () => page.evaluate(() => {
      const date = document.getElementById('forecast_date').value;
      const hour = document.getElementById('baseTime').value;
      return new Date(`${date}T${hour}:00:00+09:00`).getTime();
    });
    const initial = await selectedInstant();
    await previous.click();
    await expect.poll(selectedInstant).toBe(initial - 3 * 60 * 60 * 1000);
    await expect(next).toBeEnabled();

    await latest.click();
    await expect.poll(selectedInstant).toBe(initial);
    await expect(next).toBeDisabled();
    await expect(latest).toHaveClass(/\bis-current\b/);
  });

  test('모바일 빠른 선택과 설정 시트가 상태·포커스를 안전하게 관리한다', async ({ page }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    const quickControls = page.locator('#mobile_primary_controls');
    const air = quickControls.getByRole('button', { name: '대기질' });
    await expect(quickControls).toBeVisible();
    expect(await quickControls.getByRole('button').allTextContents()).toEqual(['기상', '대기질', '교통']);
    await expect(page.locator('#dock_toggle')).toHaveText(/설정/);

    for (const button of await quickControls.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await air.click();
    await expect(air).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.app')).toHaveAttribute('data-data-domain', 'air');
    await expect(page.locator('#timeline_scope')).toHaveText('바람 예보 시간');

    await quickControls.getByRole('button', { name: '기상' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-data-domain', 'weather');

    await page.locator('#dock_toggle').click();
    const dock = page.locator('#dock');
    await expect(dock).toHaveAttribute('role', 'dialog');
    await expect(dock).toHaveAttribute('aria-modal', 'true');
    await expect(dock.getByRole('group', { name: '날씨 정보' })).toHaveCount(1);
    await expect(dock.getByRole('group', { name: '지도 표현' })).toHaveCount(1);
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(true);
    await expect(page.locator('#dock_collapse')).toBeFocused();
    await page.waitForFunction(() => {
      const box = document.querySelector('#dock').getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom <= window.innerHeight + 1;
    });
    const dockBox = await dock.boundingBox();
    expect(dockBox.width).toBeGreaterThanOrEqual(390);
    expect(dockBox.y).toBeGreaterThan(150);
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(page.viewportSize().height + 1);

    await page.locator('#seg_element button[data-val="tmp"]').click();
    await expect(page.locator('#element')).toHaveValue('tmp');
    await expect(page.locator('#weather_legend_title')).toHaveText('기온 분포');
    await expect(page.locator('#layer_toggles [data-layer="stream"]')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => new URL(page.url()).hash).toContain('e=tmp');

    await page.locator('#seg_element button[data-val="pcp"]').click();
    await expect(page.locator('#element')).toHaveValue('pcp');
    await expect(page.locator('#weather_legend_title')).toHaveText('1시간 강수량 분포');
    await expect(page.locator('#layer_toggles [data-layer="stream"]')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => new URL(page.url()).hash).toContain('e=pcp');

    // 로컬 데모는 바람·기온·일사만 합성하므로, 3D 진입은 제공되는 기온 격자로 검증한다.
    await page.locator('#seg_element button[data-val="tmp"]').click();
    await page.waitForFunction(() => window.lastGridElement === 'tmp' && Boolean(window.lastGridResult));

    await page.keyboard.press('Escape');
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#dock_toggle')).toBeFocused();
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(false);

    await page.locator('#dock_toggle').click();
    await page.locator('#map_display_settings > summary').click();
    await page.locator('#btn_3d_dock').click();

    const view3d = page.locator('#view3d');
    await expect(view3d).toHaveClass(/\bopen\b/, { timeout: 15_000 });
    expect(await view3d.evaluate((element) => element.inert)).toBe(false);
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
    await expect(view3d.locator('canvas')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(view3d).not.toHaveClass(/\bopen\b/);
    await expect(page.locator('#dock_toggle')).toBeFocused();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('휴대폰 가로 화면에서도 핵심 조작부가 화면 밖으로 밀리지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#dock_toggle')).toBeVisible();
    await expect(page.locator('.timeline')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
