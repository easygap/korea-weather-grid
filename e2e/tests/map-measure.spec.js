const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';
const SEOUL = [126.9780, 37.5665];
const BUSAN = [129.0756, 35.1796];

async function openMap(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof weatherMap !== 'undefined' && Boolean(window.WEATHER_GRID_MEASURE));
}

async function addCenterPoint(page, lonLat) {
  await page.evaluate(([lon, lat]) => {
    const projection = weatherMap.getView().getProjection();
    weatherMap.getView().setCenter(ol.proj.transform([lon, lat], 'EPSG:4326', projection));
  }, lonLat);
  await page.locator('#map').press('Enter');
}

test.describe('지도 직선거리 측정', () => {
  test('단위를 m·km로 자동 전환하고 축척과 함께 노출한다', async ({ page }) => {
    await openMap(page);

    await expect(page.locator('#distance_measure_toggle')).toBeVisible();
    await expect(page.locator('#map_scale')).toBeVisible();
    await expect(page.locator('#distance_measure_toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#distance_measure_panel')).toBeHidden();

    const labels = await page.evaluate(() => [0, 950, 1050, 12400, 325100]
      .map((meters) => window.WEATHER_GRID_MEASURE.formatDistance(meters)));
    expect(labels).toEqual(['0 m', '950 m', '1.05 km', '12.4 km', '325 km']);
  });

  test('키보드로 서울–부산 다중 구간을 측정하고 지도 조회를 발생시키지 않는다', async ({ page }) => {
    let pointLookupCount = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/weather/coverage')) pointLookupCount += 1;
    });
    await openMap(page);

    const toggle = page.locator('#distance_measure_toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#distance_measure_panel')).toBeVisible();
    await expect(page.locator('#map')).toBeFocused();

    await addCenterPoint(page, SEOUL);
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().vertexCount)).toBe(1);

    await addCenterPoint(page, BUSAN);
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().vertexCount)).toBe(2);
    await expect(page.locator('#distance_measure_finish')).toBeEnabled();

    const drawingDistance = await page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().totalMeters);
    expect(drawingDistance).toBeGreaterThan(310_000);
    expect(drawingDistance).toBeLessThan(340_000);

    await page.locator('#map').press('Shift+Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#distance_measure_segments')).toContainText('1개 구간');
    await expect(page.locator('#distance_measure_segments')).toContainText('측정 완료');
    await expect(page.locator('#distance_measure_total')).toContainText('km');
    await expect(page.locator('#distance_measure_clear')).toBeEnabled();

    const completed = await page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics());
    expect(completed.active).toBe(false);
    expect(completed.drawing).toBe(false);
    expect(completed.completedCount).toBe(1);
    expect(completed.totalMeters).toBeGreaterThan(310_000);
    expect(completed.totalMeters).toBeLessThan(340_000);
    expect(pointLookupCount).toBe(0);
    await expect(page.locator('.coordinate_popup')).toBeHidden();

    await page.locator('#distance_measure_clear').click();
    await expect(page.locator('#distance_measure_panel')).toBeHidden();
    await expect(toggle).toBeFocused();
    expect((await page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics())).completedCount).toBe(0);
  });

  test('포인터 두 번 클릭과 더블클릭 완료가 기본 줌을 유발하지 않는다', async ({ page }) => {
    await openMap(page);
    await page.locator('#distance_measure_toggle').click();
    const mapBox = await page.locator('#map').boundingBox();
    const start = { x: mapBox.x + mapBox.width * 0.43, y: mapBox.y + mapBox.height * 0.45 };
    const end = { x: mapBox.x + mapBox.width * 0.62, y: mapBox.y + mapBox.height * 0.57 };
    const zoomBefore = await page.evaluate(() => weatherMap.getView().getZoom());

    await page.mouse.click(start.x, start.y);
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().vertexCount)).toBe(1);
    await page.mouse.dblclick(end.x, end.y, { delay: 70 });

    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().active)).toBe(false);
    const completed = await page.evaluate(() => ({
      measure: window.WEATHER_GRID_MEASURE.getDiagnostics(),
      zoom: weatherMap.getView().getZoom()
    }));
    expect(completed.measure.completedCount).toBe(1);
    expect(completed.measure.totalMeters).toBeGreaterThan(0);
    expect(Math.abs(completed.zoom - zoomBefore)).toBeLessThan(0.01);
  });

  test('LCC·메르카토르·위경도 도법에서 같은 지표면 거리를 계산한다', async ({ page }) => {
    await openMap(page);
    const distances = [];

    for (const code of ['KMA_GRID_LCC', 'EPSG:3857', 'EPSG:4326']) {
      await page.evaluate(({ projectionCode, center }) => {
        weatherMap.setView(new ol.View({
          projection: projectionCode,
          center: ol.proj.transform(center, 'EPSG:4326', projectionCode),
          zoom: projectionCode === 'EPSG:4326' ? 7 : 6
        }));
      }, { projectionCode: code, center: SEOUL });
      await page.locator('#distance_measure_toggle').click();
      await addCenterPoint(page, SEOUL);
      await addCenterPoint(page, BUSAN);
      await page.locator('#map').press('Shift+Enter');
      distances.push(await page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().totalMeters));
      await page.locator('#distance_measure_clear').click();
    }

    expect(Math.min(...distances)).toBeGreaterThan(310_000);
    expect(Math.max(...distances)).toBeLessThan(340_000);
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(10);
  });

  test('이전 점·취소·도법 전환에서 상태와 리스너가 누적되지 않는다', async ({ page }) => {
    await openMap(page);
    const toggle = page.locator('#distance_measure_toggle');

    await toggle.click();
    await addCenterPoint(page, SEOUL);
    await page.locator('#map').press('Backspace');
    await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().vertexCount)).toBe(0);
    expect((await page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics())).active).toBe(true);

    await page.locator('#map').press('Escape');
    await expect(page.locator('#distance_measure_panel')).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await addCenterPoint(page, SEOUL);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('weather-grid:projection-changed')));
    await expect(page.locator('#distance_measure_panel')).toBeHidden();

    for (let index = 0; index < 3; index += 1) {
      await toggle.click();
      await page.locator('#map').press('Escape');
    }
    const diagnostics = await page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics());
    expect(diagnostics.active).toBe(false);
    expect(diagnostics.completedCount).toBe(0);
    expect(diagnostics.layerCount).toBe(1);
    expect(diagnostics.interactionCount).toBe(1);
  });
});
