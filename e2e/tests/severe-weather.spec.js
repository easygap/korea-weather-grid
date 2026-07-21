const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

const typhoonPayload = {
  source: '기상청 태풍 분석·예보',
  fetchedAt: '2026-07-21T02:00:00.000Z',
  active: [{
    id: '202605', number: '5', nameKo: '보라', analysisTime: '20260721110000',
    track: [
      { kind: 'analysis', time: '20260721090000', latitude: 26, longitude: 132, centerPressureHpa: 990, maxWindMs: 25 },
      { kind: 'analysis', time: '20260721110000', latitude: 23, longitude: 140, centerPressureHpa: 980, maxWindMs: 32 },
      { kind: 'forecast', time: '20260722110000', latitude: 18, longitude: 152, centerPressureHpa: 970, maxWindMs: 38 }
    ]
  }]
};

const lightningPayload = (minutes) => ({
  source: '기상청 낙뢰 관측',
  from: `2026-07-21T${minutes === 15 ? '10:45' : '10:00'}:00+09:00`,
  to: '2026-07-21T11:00:00+09:00',
  fetchedAt: '2026-07-21T02:00:00.000Z',
  strikes: [{
    id: `strike-${minutes}`, observedAt: '20260721105500',
    latitude: 37.51, longitude: 127.02, type: 'ground', intensityKa: 42.3, altitudeKm: 0
  }]
});

const warningPayload = {
  source: '기상청 기상특보',
  fetchedAt: '2026-07-21T02:00:00.000Z',
  warnings: [{
    id: 'warning-1', regionId: 'L1010100', parentRegionId: 'L1010000',
    regionName: '서울특별시', parentRegionName: '수도권',
    phenomenonCode: 'R', phenomenon: '폭염', levelCode: '2', level: '경보',
    commandCode: '1', command: '발표',
    issuedAt: '20260721100000', effectiveAt: '20260721110000'
  }]
};

async function mockGrid(page) {
  await page.route('**/api/weather/grid?**', (route) => route.fulfill({
    json: {
      data: [1], nx: 1, ny: 1, nxMin: 60, nyMin: 127, step: 1,
      stats: { min: 1, avg: 1, max: 1 }
    }
  }));
}

test.describe('위험기상 시각화', () => {
  test('빠른 보기에서만 태풍·낙뢰를 요청하고 서태평양 경로와 도법 전환을 유지한다', async ({ page }) => {
    const requests = { warnings: 0, typhoon: 0, lightning: 0 };
    await mockGrid(page);
    await page.route('**/api/hazards/warnings', (route) => {
      requests.warnings += 1;
      return route.fulfill({ json: warningPayload });
    });
    await page.route('**/api/hazards/typhoons', (route) => {
      requests.typhoon += 1;
      return route.fulfill({ json: typhoonPayload });
    });
    await page.route('**/api/hazards/lightning?**', (route) => {
      requests.lightning += 1;
      const minutes = Number(new URL(route.request().url()).searchParams.get('minutes'));
      return route.fulfill({ json: lightningPayload(minutes) });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.WEATHER_GRID_SEVERE_WEATHER));
    await expect.poll(() => requests.warnings).toBeGreaterThan(0);
    expect(requests.typhoon).toBe(0);
    expect(requests.lightning).toBe(0);

    await page.locator('[data-explore-mode="hazards"]').click();
    await expect(page.locator('.app')).toHaveAttribute('data-explore-mode', 'hazards');
    await expect(page.locator('.timeline')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.getState())).toMatchObject({
      typhoon: true, lightning: true, typhoonCount: 1, lightningCount: 1
    });
    expect(requests.typhoon).toBe(1);
    expect(requests.lightning).toBe(1);
    await expect(page.locator('#hazard_legend')).toBeVisible();
    await expect(page.locator('#warning_banner')).toBeVisible();

    await expect.poll(() => page.evaluate(() => {
      const view = weatherMap.getView();
      const coordinate = ol.proj.transform([152, 18], 'EPSG:4326', view.getProjection());
      return {
        minZoom: view.getMinZoom(),
        forecastVisible: ol.extent.containsCoordinate(view.calculateExtent(weatherMap.getSize()), coordinate)
      };
    })).toMatchObject({ minZoom: 2.5, forecastVisible: true });

    await page.locator('#dock_toggle').click();
    await page.locator('#map_display_settings > summary').click();
    await page.locator('#map_display_settings .advanced_disclosure > summary').click();
    await page.locator('#seg_proj [data-proj="EPSG:3857"]').click();
    await page.waitForFunction(() => window.WEATHER_GRID_VIEW_PROJ === 'EPSG:3857');
    await expect.poll(() => page.evaluate(() => {
      const layer = weatherMap.getLayers().getArray().find((item) => item.get('title') === 'severe-typhoon');
      const point = layer.getSource().getFeatures().find((item) => {
        const track = item.get('trackPoint');
        return track && track.kind === 'forecast' && track.longitude === 152;
      });
      if (!point) return Infinity;
      const actual = point.getGeometry().getCoordinates();
      const expected = ol.proj.transform([152, 18], 'EPSG:4326', 'EPSG:3857');
      return Math.hypot(actual[0] - expected[0], actual[1] - expected[1]);
    })).toBeLessThan(0.01);
  });

  test('낙뢰 시간창 변경이 실패하면 이전 기간의 점을 남기지 않는다', async ({ page }) => {
    await mockGrid(page);
    await page.route('**/api/hazards/warnings', (route) => route.fulfill({ json: { warnings: [] } }));
    await page.route('**/api/hazards/typhoons', (route) => route.fulfill({ json: { active: [] } }));
    await page.route('**/api/hazards/lightning?**', (route) => {
      const minutes = Number(new URL(route.request().url()).searchParams.get('minutes'));
      if (minutes === 15) return route.fulfill({ status: 500, body: 'failed' });
      return route.fulfill({ json: lightningPayload(minutes) });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.WEATHER_GRID_SEVERE_WEATHER));
    await page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.setLayers({ typhoon: false, lightning: true }));
    await page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.setLightningWindow(60));
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.getState().lightningCount)).toBe(1);

    await page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.setLightningWindow(15));
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.getState())).toMatchObject({
      lightningMinutes: 15, lightningCount: 0, lightningError: '조회 실패'
    });
    await expect(page.locator('#lightning_toggle_meta')).toHaveText('조회 실패');
    await expect(page.locator('#severe_weather_status')).toHaveAttribute('data-state', 'error');
  });

  test('모바일 설정에서 특보를 열면 설정 시트를 닫고 포커스를 안전하게 복귀시킨다', async ({ page }) => {
    await mockGrid(page);
    await page.route('**/api/hazards/warnings', (route) => route.fulfill({ json: warningPayload }));
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#warning_banner')).toBeVisible();

    await page.locator('#dock_toggle').click();
    await expect(page.locator('#dock')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#warning_open').click();
    await expect(page.locator('#dock')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#warning_panel')).toBeVisible();
    await expect(page.locator('#warning_panel')).toBeFocused();
    await expect(page.locator('.warning_item strong')).toHaveText('폭염');
    await expect(page.locator('.warning_item .warning_level')).toHaveText('경보');
    await expect(page.locator('.warning_item time')).toHaveText(/^발효 /);
    await expect(page.locator('.warning_item time')).toHaveAttribute('datetime', /^2026-07-21T02:00:00/);
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER.getWarnings()[0])).toMatchObject({
      regionId: 'L1010100', parentRegionId: 'L1010000',
      phenomenonCode: 'R', levelCode: '2', commandCode: '1'
    });
    expect(await page.locator('main').evaluate((element) => element.inert)).toBe(false);
    const panelBox = await page.locator('#warning_panel').boundingBox();
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(393);

    await page.locator('#warning_panel_close').click();
    await expect(page.locator('#warning_panel')).toBeHidden();
    await expect(page.locator('#dock_toggle')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('특보 권한 대기 상태를 발효 0건으로 오인하지 않는다', async ({ page }) => {
    await mockGrid(page);
    await page.route('**/api/hazards/warnings', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' })
    }));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_SEVERE_WEATHER?.getState().warningStatus)).toBe('unavailable');
    await expect(page.locator('#warning_count')).toHaveText('연결 대기');
    await expect(page.locator('#warning_banner')).toBeHidden();
    await page.locator('#dock_toggle').click();
    await page.locator('#warning_open').click();
    await expect(page.locator('#warning_panel_status')).toContainText('API가 아직 연결되지 않았습니다');
    await expect(page.locator('#warning_panel_status')).not.toContainText('발효 특보가 없습니다');
  });
});
