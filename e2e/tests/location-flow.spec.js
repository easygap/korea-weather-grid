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
