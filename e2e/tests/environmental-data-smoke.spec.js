const { test, expect } = require('@playwright/test');

function forecastItems(baseDate) {
  return Array.from({ length: 49 }, (_, forecastHour) => ({
    forecastHour,
    forecastDateTime: `${baseDate}${String((2 + forecastHour) % 24).padStart(2, '0')}00`,
    temperature: 20 + forecastHour / 10,
    humidity: 55,
    precipitationProbability: forecastHour % 3 ? 10 : 40,
    precipitationAmount: forecastHour === 1 || forecastHour % 3 === 0 ? '1.0mm 미만' : '강수없음',
    snowfallAmount: forecastHour === 1 ? '0' : null,
    skyCode: forecastHour % 2 ? 1 : 3,
    skyLabel: forecastHour % 2 ? '맑음' : '구름많음',
    precipitationType: 0,
    precipitationTypeLabel: '없음',
    waveHeight: forecastHour === 1 ? 0 : null,
    windSpeed: forecastHour === 1 ? 0.4 : 2.5,
    windDirection: 270
  }));
}

test('상세예보 503은 한 번 자동 재시도해 복구한다', async ({ page }) => {
  const baseDate = '20260712';
  let forecastRequests = 0;
  await page.route('**/api/weather/point-forecast?**', async (route) => {
    forecastRequests += 1;
    if (forecastRequests === 1) {
      await route.fulfill({ status: 503, body: 'data temporarily unavailable' });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        baseDate,
        baseTime: '0200',
        latitude: 37.5665,
        longitude: 126.978,
        source: '기상청 단기예보',
        items: forecastItems(baseDate)
      })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_STATION_FORECAST);
  await page.evaluate(({ date }) => window.WEATHER_GRID_STATION_FORECAST.open({
    latitude: 37.5665, longitude: 126.978, baseDate: date, baseTime: '0200'
  }), { date: baseDate });

  await expect.poll(() => forecastRequests).toBe(2);
  await expect(page.locator('#forecast_strip .forecast_card')).toHaveCount(48);
  await expect(page.locator('#forecast_strip_retry')).toBeHidden();
});

test('상세예보와 대기질 레이어가 독립적으로 로드된다', async ({ page }) => {
  const baseDate = '20260712';
  let forecastRequests = 0;
  let airRequests = 0;

  await page.route('**/api/weather/point-forecast?**', async (route) => {
    forecastRequests++;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        baseDate,
        baseTime: '0200',
        latitude: 37.5665,
        longitude: 126.978,
        source: '기상청 단기예보',
        items: forecastItems(baseDate)
      })
    });
  });
  await page.route('**/api/environment/air-quality?**', async (route) => {
    airRequests++;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        dataTime: '2026-07-13 10:00',
        dataTimeFrom: '2026-07-13 09:00',
        stale: false,
        source: 'AirKorea',
        stations: [{
          name: '종로구',
          address: '서울특별시 종로구',
          network: '도시대기',
          latitude: 37.572,
          longitude: 127.005,
          pm10: 32,
          pm25: 14,
          pm10Grade: 2,
          pm25Grade: 1,
          pm10Flag: null,
          pm25Flag: null,
          dataTime: '2026-07-13 10:00'
        }]
      })
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_STATION_FORECAST && window.WEATHER_GRID_AIR_QUALITY);

  await page.evaluate(({ date }) => {
    window.WEATHER_GRID_STATION_FORECAST.open({
      latitude: 37.5665, longitude: 126.978, baseDate: date, baseTime: '0200'
    });
  }, { date: baseDate });
  await expect(page.locator('#forecast_strip .forecast_card')).toHaveCount(48);
  await expect(page.locator('#forecast_strip')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#forecast_strip .forecast_card').first()).toHaveAttribute('data-forecast-hour', '1');
  await expect(page.locator('#forecast_strip .forecast_card').first()).toContainText('맑음');
  await expect(page.locator('#forecast_strip .forecast_card').first()).toContainText('0.4m/s · 정온');
  await expect(page.locator('#forecast_strip .forecast_card').first()
    .locator('.forecast_metrics > div').filter({ hasText: '1시간 강수량' })).toContainText('1.0mm 미만');
  await expect(page.locator('#forecast_strip .forecast_card').first()
    .locator('.forecast_metrics > div').filter({ hasText: '1시간 신적설' })).toContainText('0cm');
  await expect(page.locator('#forecast_strip .forecast_card').first()
    .locator('.forecast_metrics > div').filter({ hasText: '파고' })).toContainText('0m');
  await expect(page.locator('#forecast_strip .forecast_card').first()
    .locator('.forecast_metrics > div').filter({ hasText: '상대습도' })).toContainText('55%');
  await expect(page.locator('#forecast_strip .forecast_card').first()).not.toContainText('서풍');
  await expect(page.locator('#forecast_strip .forecast_card').last()).toHaveAttribute('data-forecast-hour', '48');
  await expect(page.locator('#forecast_strip .forecast_card[data-forecast-hour="0"]')).toHaveCount(0);

  await page.locator('#data_domain_nav [data-data-domain="air"]').click();
  await page.locator('#dock_toggle').click();
  await expect(page.locator('#layer_settings')).toHaveAttribute('open', '');
  await page.locator('#seg_air_quality button[data-air="pm10"]').click();
  await expect.poll(() => page.evaluate(() =>
    window.WEATHER_GRID_AIR_QUALITY.layer.getSource().getSource().getFeatures().length
  )).toBe(1);
  await expect(page.locator('#air_legend')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#air_legend_rows .air_legend_row')).toHaveCount(5);
  await expect(page.locator('#air_legend_gauge .air_gauge_segment')).toHaveCount(4);
  await expect(page.locator('#air_legend_gauge')).toHaveAttribute('aria-label', /PM10 등급 구간/);
  await expect(page.locator('#air_legend_time'))
    .toHaveText('지점별 관측 · 2026.07.13 09:00 KST – 2026.07.13 10:00 KST');
  await expect(page.locator('#air_legend .air_legend_notice')).toContainText('실시간 측정값은 미확정 자료');
  await expect(page.locator('#air_quality_status')).toContainText('측정소 1곳');
  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  await expect(page.locator('#air_popup')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#air_popup_title')).toHaveText('종로구');
  await expect(page.locator('#air_popup_gauge_pm10')).toHaveAttribute('role', 'meter');
  await expect(page.locator('#air_popup_gauge_pm10')).toHaveAttribute('aria-valuetext', /PM10 32㎍\/㎥, 보통/);
  await expect(page.locator('#air_popup_gauge_pm25')).toHaveAttribute('aria-valuetext', /PM2.5 14㎍\/㎥, 좋음/);
  await expect(page.locator('#air_popup_gauges .air_gauge_marker')).toHaveCount(2);
  await expect(page.locator('#air_popup .air_popup_source')).toContainText('출처 AirKorea · 실시간 측정값은 미확정 자료');
  const distributionTotal = await page.locator('#air_legend_rows .air_legend_row').evaluateAll((rows) =>
    rows.reduce((sum, row) => sum + Number(row.getAttribute('aria-label').match(/측정소 (\d+)곳/)[1]), 0)
  );
  expect(distributionTotal).toBe(1);
  expect(forecastRequests).toBe(1);
  expect(airRequests).toBe(1);
});

test('신적설 지점 상세는 단기예보 한 요청을 카드와 차트가 공유한다', async ({ page }) => {
  const baseDate = '20260721';
  let forecastRequests = 0;
  let stationSeriesRequests = 0;

  await page.route('**/api/weather/point-forecast?**', async (route) => {
    forecastRequests++;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        baseDate,
        baseTime: '1400',
        latitude: 37.555123,
        longitude: 126.912345,
        source: '기상청 단기예보',
        items: forecastItems(baseDate)
      })
    });
  });
  await page.route('**/api/weather/timeseries?**', async (route) => {
    stationSeriesRequests++;
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_STATION_FORECAST && window.WEATHER_GRID_STATION_CHARTS);
  await page.evaluate(() => { document.getElementById('element').value = 'sno'; });

  await page.locator('.station_query').fill('서울');
  await page.getByRole('option', { name: '서울특별시', exact: true }).click();

  await expect(page.locator('#forecast_strip .forecast_card')).toHaveCount(48);
  await expect(page.locator('#station_chart_summary')).toContainText('1시간 신적설');
  await expect.poll(() => forecastRequests).toBe(1);
  expect(stationSeriesRequests).toBe(0);
});

test('대기질 요청은 시간 초과 후 복구되고 빠른 모드 전환의 이전 응답을 무시한다', async ({ page }) => {
  let airRequests = 0;
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });

  const payload = (name) => ({
    dataTime: '2026-07-15 09:00',
    stale: false,
    source: 'AirKorea',
    stations: [{
      name,
      address: '서울특별시',
      network: '도시대기',
      latitude: 37.5665,
      longitude: 126.978,
      pm10: 28,
      pm25: 12,
      pm10Grade: 1,
      pm25Grade: 1,
      dataTime: '2026-07-15 09:00',
    }],
  });

  await page.route('**/api/environment/air-quality?**', async (route) => {
    airRequests++;
    const ordinal = airRequests;
    if (ordinal === 1) await firstGate;
    if (ordinal === 2) await secondGate;
    const body = JSON.stringify(payload(ordinal < 3 ? '느린 이전 측정소' : '최신 측정소'));
    try {
      await route.fulfill({ contentType: 'application/json', body });
    } catch (_) {
      // 시간 초과 또는 모드 전환으로 취소된 요청은 응답을 버린다.
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_AIR_QUALITY);

  await page.locator('#data_domain_nav [data-data-domain="air"]').click();
  await page.locator('#dock_toggle').click();
  await expect(page.locator('#layer_settings')).toHaveAttribute('open', '');
  await page.locator('#seg_air_quality button[data-air="pm10"]').click();
  await expect.poll(() => airRequests).toBe(1);
  await expect(page.locator('#air_quality_status')).toContainText('시간이 초과', { timeout: 15_000 });
  await expect(page.locator('#air_quality_retry')).toBeVisible();
  releaseFirst();

  await page.locator('#air_quality_retry').click();
  await expect.poll(() => airRequests).toBe(2);
  // The public panel omits the redundant "off" action, but the internal state
  // remains available to verify cancellation of an in-flight station request.
  // Both transitions use DOM events because switching off intentionally hides
  // this domain's controls before the next test-only transition runs.
  await page.locator('#seg_air_quality button[data-air="off"]').evaluate((button) => button.click());
  await page.locator('#seg_air_quality button[data-air="pm25"]').evaluate((button) => button.click());
  await expect.poll(() => airRequests).toBe(3);
  await expect.poll(() => page.evaluate(() => {
    const feature = window.WEATHER_GRID_AIR_QUALITY.layer.getSource().getSource().getFeatures()[0];
    return feature && feature.get('station').name;
  })).toBe('최신 측정소');

  releaseSecond();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => {
    const feature = window.WEATHER_GRID_AIR_QUALITY.layer.getSource().getSource().getFeatures()[0];
    return feature && feature.get('station').name;
  })).toBe('최신 측정소');
  expect(await page.evaluate(() => window.WEATHER_GRID_AIR_QUALITY.getMode())).toBe('pm25');
});
