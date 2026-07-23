const { test, expect } = require('@playwright/test');

test.describe('주요 지점 인프라 레이어', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WeatherGridInfrastructure
      && window.WeatherGridProjection && window.lastGridResult);
    await page.locator('#dock_toggle').click();
    await page.locator('#map_display_settings > summary').click();
  });

  test('대교·공항·항만 토글이 독립 벡터 도형과 ARIA 상태를 사용한다', async ({ page }) => {
    for (const key of ['bridge', 'airport', 'port']) {
      await page.locator(`#infra_${key}`).click();
      await expect(page.locator(`#infra_${key}`)).toHaveAttribute('aria-pressed', 'true');
    }

    const layers = await page.evaluate(() => Object.fromEntries(
      ['bridge', 'airport', 'port'].map((key) => {
        const layer = WeatherGridInfrastructure.layer(key);
        const feature = layer.getSource().getFeatures()[0];
        const marker = layer.getStyle()(feature, 100).at(-1).getImage();
        return [key, {
          visible: layer.getVisible(),
          count: layer.getSource().getFeatures().length,
          regularShape: marker instanceof ol.style.RegularShape,
          points: marker.getPoints(),
          angle: Number(marker.getAngle().toFixed(4)),
          kind: feature.get('kind')
        }];
      })
    ));

    expect(layers).toEqual({
      bridge: { visible: true, count: 12, regularShape: true, points: 4, angle: 0, kind: 'infrastructure' },
      airport: { visible: true, count: 15, regularShape: true, points: 3, angle: 0, kind: 'infrastructure' },
      port: { visible: true, count: 11, regularShape: true, points: 4, angle: 0.7854, kind: 'infrastructure' }
    });
    await expect(page.locator('#infra_bridge')).toHaveCSS('min-height', '44px');
  });

  test('도법·테마 전환을 보존하고 지도 Enter로 가장 가까운 지점 예보를 연다', async ({ page }) => {
    await page.locator('#infra_bridge').click();
    await page.evaluate(() => {
      window.__oldBridgeFeature = WeatherGridInfrastructure.layer('bridge').getSource().getFeatures()[0];
      window.__infrastructureForecastRequest = null;
      document.addEventListener('weather-grid:location-forecast-requested', (event) => {
        window.__infrastructureForecastRequest = event.detail;
      }, { once: true });
    });

    await page.locator('.advanced_disclosure > summary').click();
    await page.locator('[data-proj="EPSG:3857"]').click();
    await expect(page.locator('[data-proj="EPSG:3857"]')).toHaveAttribute('aria-pressed', 'true');

    expect(await page.evaluate(() => {
      const layer = WeatherGridInfrastructure.layer('bridge');
      return {
        projection: WeatherGridProjection.current(),
        visible: layer.getVisible(),
        count: layer.getSource().getFeatures().length,
        reprojected: layer.getSource().getFeatures()[0] !== window.__oldBridgeFeature
      };
    })).toEqual({ projection: 'EPSG:3857', visible: true, count: 12, reprojected: true });

    const darkColor = await page.evaluate(() => {
      const layer = WeatherGridInfrastructure.layer('bridge');
      return layer.getStyle()(layer.getSource().getFeatures()[0], 100).at(-1).getImage().getFill().getColor();
    });
    await page.locator('#theme_toggle').click();
    const lightTheme = await page.evaluate(() => {
      const layer = WeatherGridInfrastructure.layer('bridge');
      return {
        theme: document.documentElement.dataset.theme,
        color: layer.getStyle()(layer.getSource().getFeatures()[0], 100).at(-1).getImage().getFill().getColor()
      };
    });
    expect(lightTheme.theme).toBe('light');
    expect(lightTheme.color).not.toBe(darkColor);

    await page.locator('#dock_collapse').click();
    await page.locator('#map').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__infrastructureForecastRequest);
    const request = await page.evaluate(() => window.__infrastructureForecastRequest);
    expect(request.key).toBe('bridge');
    expect(request.name).toMatch(/대교$/);
    expect(Number.isFinite(request.latitude)).toBe(true);
    expect(Number.isFinite(request.longitude)).toBe(true);
    await expect(page.locator('.station_modal')).toBeVisible();
    await expect(page.locator('#station_chart_title')).toContainText(request.name);
  });

  test('지도 벡터 표식을 클릭하면 해당 지점의 예보 선택 사건을 한 번 보낸다', async ({ page }) => {
    await page.locator('#infra_bridge').click();
    await page.locator('#dock_collapse').click();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__infrastructureClickRequests = [];
      document.addEventListener('weather-grid:location-forecast-requested', (event) => {
        window.__infrastructureClickRequests.push(event.detail);
      });
    });

    const target = await page.evaluate(() => {
      const layer = WeatherGridInfrastructure.layer('bridge');
      const feature = layer.getSource().getFeatures().find((item) => item.get('stn_name') === '이순신대교');
      const coordinate = feature.getGeometry().getCoordinateAt(0.5);
      return { name: feature.get('stn_name'), pixel: WeatherGridMapRuntime.map.getPixelFromCoordinate(coordinate) };
    });
    const mapBox = await page.locator('#map').boundingBox();
    expect(target.pixel[0]).toBeGreaterThanOrEqual(0);
    expect(target.pixel[1]).toBeGreaterThanOrEqual(0);
    expect(target.pixel[0]).toBeLessThanOrEqual(mapBox.width);
    expect(target.pixel[1]).toBeLessThanOrEqual(mapBox.height);

    await page.mouse.click(mapBox.x + target.pixel[0], mapBox.y + target.pixel[1]);
    await page.waitForFunction(() => window.__infrastructureClickRequests.length === 1);
    const requests = await page.evaluate(() => window.__infrastructureClickRequests);
    expect(requests).toHaveLength(1);
    expect(requests[0].name).toBe(target.name);
    expect(requests[0].key).toBe('bridge');
    await expect(page.locator('#station_chart_title')).toContainText(target.name);
  });
});
