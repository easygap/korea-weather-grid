const { test, expect } = require('@playwright/test');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function discardAfter(route, gate) {
  await gate.promise;
  try {
    await route.abort('failed');
  } catch (_) {
    // 클라이언트 시간 초과로 이미 취소된 요청은 버린다.
  }
}

async function continueAfter(route, gate) {
  await gate.promise;
  try {
    await route.continue();
  } catch (_) {
    // 페이지가 먼저 닫힌 경우에만 요청을 버린다.
  }
}

function windSeries() {
  return Array.from({ length: 49 }, (_, index) => [
    Number((2.2 + Math.sin(index / 5) * 1.4).toFixed(1)),
    (270 + index * 7) % 360
  ]);
}

function forecastPayload() {
  const baseDate = '20260715';
  return {
    baseDate,
    baseTime: '0200',
    latitude: 37.5665,
    longitude: 126.978,
    source: '기상청 단기예보',
    items: Array.from({ length: 49 }, (_, forecastHour) => ({
      forecastHour,
      forecastDateTime: `${baseDate}${String((2 + forecastHour) % 24).padStart(2, '0')}00`,
      temperature: 20 + forecastHour / 10,
      humidity: 55,
      precipitationProbability: forecastHour % 3 ? 10 : 40,
      precipitationAmount: forecastHour % 3 ? '강수없음' : '1.0mm 미만',
      snowfallAmount: null,
      skyCode: forecastHour % 2 ? 1 : 3,
      skyLabel: forecastHour % 2 ? '맑음' : '구름많음',
      precipitationType: 0,
      precipitationTypeLabel: '없음',
      windSpeed: 2.5,
      windDirection: 270
    }))
  };
}

async function waitForMainGrid(page) {
  await page.waitForFunction(() => !!window.lastGridResult && window.WEATHER_GRID_GRID_LOADING === false, null, {
    timeout: 60_000
  });
}

async function openSeoulStation(page) {
  await page.locator('#coordinate_search_toggle').click();
  await page.locator('#coordinate_latitude').fill('37.5665');
  await page.locator('#coordinate_longitude').fill('126.9780');
  await page.locator('.coordinate_lookup').click();
  await expect(page.locator('.station_modal')).toBeVisible();
}

test.describe('프런트 무응답 복구', () => {
  test('격자 조회는 시간 초과 후 로딩을 정리하고 재시도하며 현재 발표시각 재클릭은 조회하지 않는다', async ({ page }) => {
    await page.clock.install();
    const firstRequest = deferred();
    let gridRequests = 0;

    await page.route('**/api/weather/grid?**', async (route) => {
      gridRequests += 1;
      if (gridRequests === 1) return discardAfter(route, firstRequest);
      await route.continue();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => gridRequests).toBe(1);
    await expect(page.locator('#map')).toHaveAttribute('aria-busy', 'true');

    await page.clock.fastForward(35_001);
    await expect(page.locator('#data_error')).toContainText('응답 시간이 초과');
    await expect(page.locator('#retry_data')).toBeVisible();
    await expect(page.locator('#loading-overlay')).toBeHidden();
    await expect(page.locator('#map')).not.toHaveAttribute('aria-busy', 'true');
    expect(await page.evaluate(() => window.WEATHER_GRID_GRID_LOADING)).toBe(false);

    firstRequest.resolve();
    await page.locator('#retry_data').click();
    await expect.poll(() => gridRequests).toBe(2);
    await waitForMainGrid(page);
    await expect(page.locator('#data_error')).toBeHidden();

    await page.locator('#dock_toggle').click();
    await page.locator('#forecast_source_settings > summary').click();
    const selectedTime = page.locator('.forecast_run_button.on').first();
    const requestCount = gridRequests;
    await selectedTime.click();
    await page.waitForTimeout(150);
    expect(gridRequests).toBe(requestCount);
    await expect(selectedTime).toHaveClass(/\bon\b/);
    await expect(selectedTime).toHaveAttribute('aria-pressed', 'true');
  });

  test('지점 시계열과 상세예보는 각각 시간 초과 상태와 재시도 경로를 제공한다', async ({ page }) => {
    await page.clock.install();
    const stationGate = deferred();
    const forecastGate = deferred();
    let stationRequests = 0;
    let forecastRequests = 0;

    await page.route('**/api/weather/timeseries?**', async (route) => {
      stationRequests += 1;
      if (stationRequests === 1) return discardAfter(route, stationGate);
      await route.fulfill({ json: windSeries() });
    });
    await page.route('**/api/weather/point-forecast?**', async (route) => {
      forecastRequests += 1;
      if (forecastRequests === 1) return discardAfter(route, forecastGate);
      await route.fulfill({ json: forecastPayload() });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMainGrid(page);
    await openSeoulStation(page);
    await expect.poll(() => stationRequests).toBe(1);
    await expect.poll(() => forecastRequests).toBe(1);
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);

    await page.clock.fastForward(20_001);
    await expect(page.locator('#chart .station_chart_error')).toContainText('시계열 응답 시간이 초과');
    await expect(page.locator('.station_chart_retry')).toBeVisible();
    await expect(page.locator('.station_chart_panel')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#forecast_strip_state')).toContainText('상세예보 응답 시간이 초과');
    await expect(page.locator('#forecast_strip_retry')).toBeVisible();
    await expect(page.locator('#forecast_strip_section')).toHaveAttribute('aria-busy', 'false');

    stationGate.resolve();
    forecastGate.resolve();
    await page.locator('#forecast_strip_retry').click();
    await expect.poll(() => forecastRequests).toBe(2);
    await expect(page.locator('#forecast_strip .forecast_card')).toHaveCount(48);

    await page.locator('.station_chart_retry').click();
    await expect.poll(() => stationRequests).toBe(2);
    expect(forecastRequests).toBe(2);
    await expect(page.locator('#chart .station-chart-root')).toHaveCount(1);
    await expect(page.locator('#forecast_strip .forecast_card')).toHaveCount(48);
    await expect(page.locator('.station_chart_panel')).toHaveAttribute('aria-busy', 'false');
  });

  test('내장 SVG 차트는 즉시 렌더링한다', async ({ page }) => {
    await page.route('**/api/weather/timeseries?**', (route) => route.fulfill({ json: windSeries() }));
    await page.route('**/api/weather/point-forecast?**', (route) => route.fulfill({ json: forecastPayload() }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMainGrid(page);
    await openSeoulStation(page);
    await expect(page.locator('#chart .station-chart-root')).toHaveCount(1);
    await expect(page.locator('.station_chart_panel')).toHaveAttribute('aria-busy', 'false');
  });

  test('3D 모듈 로드가 늦어져도 단일 요청을 유지하고 다시 연다', async ({ page }) => {
    await page.clock.install();
    const firstModule = deferred();
    let moduleRequests = 0;

    await page.route('**/static/js/map3d.js*', async (route) => {
      moduleRequests += 1;
      if (moduleRequests === 1) return continueAfter(route, firstModule);
      await route.continue();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMainGrid(page);
    const button = page.locator('#btn_3d');
    await button.click();
    await expect.poll(() => moduleRequests).toBe(1);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-busy', 'true');

    await page.clock.fastForward(10_001);
    await expect(page.locator('.app-alert')).toContainText('3D 지도 모듈 응답 시간이 초과');
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute('aria-busy', 'true');

    firstModule.resolve();
    await expect.poll(() => page.evaluate(() => !!window.WEATHER_GRID_3D)).toBe(true);
    await page.locator('.app-alert-confirm').click();
    await button.click();
    expect(moduleRequests).toBe(1);
    await expect(page.locator('#view3d')).toHaveClass(/\bopen\b/);
    await page.locator('#view3d_close').click();
  });
});
