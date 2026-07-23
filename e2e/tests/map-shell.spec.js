const { test, expect } = require('@playwright/test');

test.describe('독립 지도 셸과 대표 지역 검색', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await expect(page.locator('#kakao_basemap_status')).toContainText('OpenStreetMap');
    expect(await page.evaluate(() => ({
      mode: WeatherGridMapBootstrap.snapshot().mode,
      weather: weatherBasemapLayer.getVisible(),
      boundaries: vectorLayer.getVisible(),
      streets: streetTileLayer.getVisible(),
      kakao: WeatherGridKakaoBasemap.diagnostics()
    }))).toEqual({
      mode: 'streets',
      weather: false,
      boundaries: false,
      streets: true,
      kakao: { active: false, status: 'osm', sdkLoaded: false }
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

test.describe('Kakao 공식 SDK 어댑터', () => {
  test('Kakao 배경과 OpenLayers 뷰를 동기화하고 OSM 대체 레이어를 숨긴다', async ({ page }) => {
    await page.route('**/api/runtime/map-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          kakaoEnabled: true,
          kakaoJavascriptKey: 'a'.repeat(32)
        })
      });
    });
    await page.route('https://dapi.kakao.com/v2/maps/sdk.js**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.kakao = { maps: {
            load: function (ready) { ready(); },
            LatLng: function (lat, lon) { this.lat = lat; this.lon = lon; },
            Map: function (element, options) {
              this.center = options.center;
              this.level = options.level;
              this.relayoutCount = 0;
              this.setCenter = function (center) { this.center = center; };
              this.setLevel = function (level) { this.level = level; };
              this.relayout = function () { this.relayoutCount += 1; };
              element.dataset.testKakaoMap = 'ready';
              window.__testKakaoMap = this;
            }
          } };
        `
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WeatherGridMapBootstrap);
    await page.evaluate(() => WeatherGridMapBootstrap.selectMode('streets'));
    await expect(page.locator('#basemap_streets')).toHaveAttribute('data-provider', 'kakao');
    await expect(page.locator('#kakao_basemap')).toHaveAttribute('data-test-kakao-map', 'ready');

    expect(await page.evaluate(() => ({
      diagnostics: WeatherGridKakaoBasemap.diagnostics(),
      kakaoHidden: document.getElementById('kakao_basemap').hidden,
      mapClass: document.getElementById('map').className,
      osmVisible: streetTileLayer.getVisible()
    }))).toEqual({
      diagnostics: { active: true, status: 'kakao', sdkLoaded: true },
      kakaoHidden: false,
      mapClass: 'map map-kakao',
      osmVisible: false
    });

    await page.evaluate(() => weatherMap.getView().setZoom(8));
    await page.waitForFunction(() => window.__testKakaoMap?.level === 8);

    await page.evaluate(() => WeatherGridMapBootstrap.selectMode('weather'));
    await expect(page.locator('#kakao_basemap')).toBeHidden();
    expect(await page.evaluate(() => WeatherGridKakaoBasemap.diagnostics().status)).toBe('idle');
  });
});
