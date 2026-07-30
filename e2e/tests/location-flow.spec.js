const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

test('지도 좌표 범위 조회는 검증된 위치만 팝업에 표시하고 범위 밖 결과를 구분한다', async ({ page }) => {
  let inside = true;
  let requests = 0;
  await page.route('**/api/weather/coverage?*', async (route) => {
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inside })
    });
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.lastGridResult && window.WeatherGridLocation));

  const location = await page.evaluate(() => {
    const coordinate = weatherMap.getView().getCenter();
    const projection = weatherMap.getView().getProjection();
    const lonLat = ol.proj.transform(coordinate, projection, 'EPSG:4326');
    const pixel = weatherMap.getPixelFromCoordinate(coordinate);
    window.WeatherGridLocation.inspectMapPoint(coordinate, pixel);
    return {
      latitude: Number(lonLat[1]).toFixed(4),
      longitude: Number(lonLat[0]).toFixed(4)
    };
  });

  await expect(page.locator('.coordinate_popup')).toBeVisible();
  await expect(page.locator('#latitude')).toHaveText(location.latitude);
  await expect(page.locator('#longitude')).toHaveText(location.longitude);

  inside = false;
  await page.evaluate(() => {
    const coordinate = weatherMap.getView().getCenter();
    window.WeatherGridLocation.inspectMapPoint(coordinate, weatherMap.getPixelFromCoordinate(coordinate));
  });
  await expect(page.locator('#map_notice')).toContainText('지원 범위 밖');
  await expect(page.locator('.coordinate_popup')).toBeHidden();
  expect(requests).toBe(2);
});

test('현재 위치는 지도를 이동하고 해당 좌표의 예보를 연다', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: new URL(BASE).origin });
  await context.setGeolocation({ latitude: 37.5665, longitude: 126.978 });
  await page.route('**/api/weather/point-forecast?**', (route) => route.fulfill({
    json: {
      baseDate: '20260730',
      baseTime: '0200',
      source: '기상청 단기예보',
      items: Array.from({ length: 49 }, (_, forecastHour) => ({
        forecastHour,
        forecastDateTime: `20260730${String((2 + forecastHour) % 24).padStart(2, '0')}00`,
        temperature: 25,
        humidity: 60,
        precipitationProbability: 10,
        windSpeed: 2,
        windDirection: 270
      }))
    }
  }));
  await page.route('**/api/weather/timeseries?**', (route) => route.fulfill({
    json: Array.from({ length: 49 }, () => [2, 270])
  }));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.WeatherGridSearch && window.WEATHER_GRID_STATION_CHARTS));
  await page.locator('#current_location').click();

  await expect(page.locator('.station_modal')).toBeVisible();
  await expect(page.locator('.station_modal_header h2')).toContainText('현재 위치');
  await expect(page.locator('#forecast_strip .forecast_card')).toHaveCount(48);
  await expect.poll(() => page.evaluate(() => {
    const view = weatherMap.getView();
    return ol.proj.transform(view.getCenter(), view.getProjection(), 'EPSG:4326')[1];
  })).toBeCloseTo(37.5665, 2);
  const center = await page.evaluate(() => {
    const view = weatherMap.getView();
    const result = ol.proj.transform(view.getCenter(), view.getProjection(), 'EPSG:4326');
    return { longitude: result[0], latitude: result[1], zoom: view.getZoom() };
  });
  expect(center.latitude).toBeCloseTo(37.5665, 2);
  expect(center.longitude).toBeCloseTo(126.978, 2);
  expect(center.zoom).toBeGreaterThanOrEqual(9.4);
});

test('공유 버튼은 현재 지도 중심과 확대 수준이 포함된 링크를 전달한다', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => { window.__lastSharePayload = payload; }
    });
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.WeatherGridSession));
  await page.evaluate(() => {
    const view = weatherMap.getView();
    view.setCenter(ol.proj.transform([126.978, 37.5665], 'EPSG:4326', view.getProjection()));
    view.setZoom(9.4);
  });
  await page.locator('#btn_share').click();

  await expect.poll(() => page.evaluate(() => window.__lastSharePayload?.url || '')).toContain('lat=37.567');
  const sharedUrl = await page.evaluate(() => window.__lastSharePayload.url);
  expect(sharedUrl).toContain('lon=126.978');
  expect(sharedUrl).toContain('z=9.40');
  await expect(page.locator('#share_status')).toHaveText('현재 지도를 공유했습니다.');
});
