const { test, expect } = require('@playwright/test');

test.describe('독립 지도 셸과 대표 지역 검색', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/runtime/map-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ vworldEnabled: false, vworldApiKey: '' })
      });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WeatherGridMapBootstrap
      && window.WeatherGridSearch
      && window.WeatherGridMapRuntime.stationAnchors().length === 17
      && window.lastGridResult);
  });

  test('배경지도 상태가 레이어·ARIA·테마 스타일을 한 번에 갱신한다', async ({ page }) => {
    const initial = await page.evaluate(() => ({
      state: WeatherGridMapBootstrap.snapshot(),
      diagnostics: getMapRenderDiagnostics(),
      weather: weatherBasemapLayer.getVisible(),
      boundaries: vectorLayer.getVisible(),
      streets: streetTileLayer.getVisible()
    }));
    expect(initial.state).toMatchObject({
      mode: 'weather',
      regionLabels: true,
      provinceBoundaries: false,
      stationsVisible: true
    });
    expect(initial).toMatchObject({ weather: true, boundaries: false, streets: false });
    expect(initial.diagnostics.configuredPixelRatio).toBeGreaterThan(0);
    expect(initial.diagnostics.maxMapBackingPixels).toBe(12_000_000);

    await page.evaluate(() => WeatherGridMapBootstrap.selectMode('streets'));
    await expect(page.locator('#basemap_streets')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#basemap_streets')).toHaveAttribute('data-provider', 'osm');
    await expect(page.locator('#road_basemap_status')).toContainText('OpenStreetMap');
    expect(await page.evaluate(() => ({
      mode: WeatherGridMapBootstrap.snapshot().mode,
      weather: weatherBasemapLayer.getVisible(),
      boundaries: vectorLayer.getVisible(),
      streets: streetTileLayer.getVisible(),
      vworld: WeatherGridVWorldBasemap.diagnostics()
    }))).toEqual({
      mode: 'streets',
      weather: false,
      boundaries: false,
      streets: true,
      vworld: {
        active: false,
        status: 'osm',
        baseLayerReady: false,
        vectorLayerReady: false,
        renderedVectorFeatures: 0
      }
    });

    await page.evaluate(async () => {
      await ensureVectorMapData();
      WeatherGridMapBootstrap.selectMode('boundaries');
    });
    await expect(page.locator('#basemap_boundaries')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#region_label_controls')).toBeVisible();
    expect(await page.evaluate(() => ({
      state: WeatherGridMapBootstrap.snapshot(),
      boundaries: vectorLayer.getVisible(),
      provinces: provinceBoundaryLayer.getVisible()
    }))).toMatchObject({
      state: { mode: 'boundaries', regionLabels: true, provinceBoundaries: false },
      boundaries: true,
      provinces: true
    });

    const darkFill = await page.evaluate(() => {
      const style = vectorLayer.getStyle();
      return style.getFill().getColor();
    });
    await page.locator('#theme_toggle').click();
    const lightFill = await page.evaluate(() => {
      const style = vectorLayer.getStyle();
      return style.getFill().getColor();
    });
    expect(lightFill).not.toBe(darkFill);
  });

  test('대표 지역 combobox와 좌표 팝오버가 키보드·포커스 계약을 지킨다', async ({ page }) => {
    const input = page.locator('#station_query');
    await input.fill('서울');
    await expect(page.locator('#suggestions')).toBeVisible();
    await expect(page.locator('#suggestions [role="option"]')).toHaveCount(1);
    await expect(page.locator('#station_search_status')).toContainText('검색 제안 1개');

    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'station-option-0');
    await expect(page.locator('#station-option-0')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(page.locator('.station_modal')).toBeVisible();
    await expect(page.locator('#station_chart_title')).toContainText('서울');

    await page.locator('.station_modal_close').click();
    const toggle = page.locator('#coordinate_search_toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#coordinate_search_dialog')).toBeVisible();
    await expect(page.locator('#coordinate_latitude')).toBeFocused();

    await page.locator('.coordinate_panel_close').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#coordinate_search_dialog')).toBeHidden();
    await expect(toggle).toBeFocused();
  });
});

test.describe('VWorld 공식 벡터 지도 API 어댑터', () => {
  test('VWorld 배경·벡터 도로를 같은 지도에 올리고 OSM 대체 레이어를 숨긴다', async ({ page }) => {
    const key = '12345678-1234-1234-1234-123456789abc';
    await page.route('**/api/runtime/map-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          vworldEnabled: true,
          vworldApiKey: key
        })
      });
    });
    await page.route('https://api.vworld.kr/req/wmts/vector/**', async (route) => {
      if (route.request().url().endsWith('.pbf')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/x-protobuf',
          body: Buffer.alloc(0)
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
          + 'AAAADUlEQVR42mNk+M/wHwAF/gL+Xn0bAAAAAElFTkSuQmCC',
          'base64')
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WeatherGridMapBootstrap);
    await page.evaluate(() => WeatherGridMapBootstrap.selectMode('streets'));
    await expect(page.locator('#basemap_streets')).toHaveAttribute('data-provider', 'vworld');
    await expect(page.locator('#road_basemap_status')).toContainText('VWorld');

    expect(await page.evaluate(() => ({
      diagnostics: WeatherGridVWorldBasemap.diagnostics(),
      vworldLayers: weatherMap.getLayers().getArray()
        .filter((layer) => /^vworld-/.test(layer.get('title') || '')).length,
      osmVisible: streetTileLayer.getVisible()
    }))).toEqual({
      diagnostics: {
        active: true,
        status: 'vworld',
        baseLayerReady: true,
        vectorLayerReady: true,
        renderedVectorFeatures: 0
      },
      vworldLayers: 2,
      osmVisible: false
    });

    await page.evaluate(() => WeatherGridMapBootstrap.selectMode('weather'));
    expect(await page.evaluate(() => WeatherGridVWorldBasemap.diagnostics().status)).toBe('idle');
  });
});
