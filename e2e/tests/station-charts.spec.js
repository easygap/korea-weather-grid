const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

function windSeries() {
  return Array.from({ length: 49 }, (_, index) => [
    Number((2.2 + Math.sin(index / 5) * 1.4).toFixed(1)),
    (270 + index * 7) % 360
  ]);
}

function calmWindSeries(speed = 0.4) {
  return Array.from({ length: 49 }, () => [speed, 270]);
}

function scalarSeries(mapper) {
  return Array.from({ length: 49 }, (_, index) => [mapper(index)]);
}

function precipitationSeries(amountForHour = () => '강수없음') {
  return Array.from({ length: 49 }, (_, forecastHour) => ({
    forecastHour,
    precipitationAmount: amountForHour(forecastHour),
    precipitationProbability: forecastHour === 3 ? 80 : (forecastHour === 2 ? 60 : 10)
  }));
}

function forecastElementSeries(mapper) {
  return {
    baseDate: '20260714',
    baseTime: '0200',
    items: Array.from({ length: 49 }, (_, forecastHour) => ({ forecastHour, ...mapper(forecastHour) }))
  };
}

test.describe('지점 시계열 시각화', () => {
  test('풍향·풍속 요약과 차트, 접근 가능한 수치표를 함께 렌더링한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady());

    const rendered = await page.evaluate((data) => {
      document.querySelector('.station_modal').style.display = 'block';
      return window.WEATHER_GRID_STATION_CHARTS.render('wdws', data, '2026071402');
    }, windSeries());
    expect(rendered).toBe(true);
    await expect(page.locator('#station_chart_summary .station_metric_card')).toHaveCount(3);
    await expect(page.locator('.station_compass_arrow')).toHaveCount(1);
    await expect(page.locator('.station_compass_copy')).toContainText('서풍');
    await expect(page.locator('#chart .station-chart-root')).toHaveCount(1);

    const state = await page.evaluate(() => ({
      types: window.WEATHER_GRID_STATION_CHARTS.getChart().series.map((series) => series.type),
      pointCounts: window.WEATHER_GRID_STATION_CHARTS.getChart().series.map((series) => series.data.length),
      liveCharts: document.querySelectorAll('#chart .station-chart-root').length,
      description: document.getElementById('station_chart_description').textContent
    }));
    expect(state.types).toEqual(['area-line', 'wind-vector']);
    expect(state.pointCounts).toEqual([48, 48]);
    expect(state.liveCharts).toBe(1);
    expect(state.description).toContain('평균');
    await expect(page.locator('#station_chart_summary')).toContainText('+1시간 예보');

    await page.locator('#station_data_details summary').click();
    await expect(page.locator('#station_data_table tbody tr')).toHaveCount(48);
    await expect(page.locator('#station_data_table thead')).toContainText('풍향');
    await expect(page.locator('#station_data_table caption')).toContainText('향후 48시간');
  });

  test('모바일 차트 시간축은 겹치지 않도록 라벨 수를 줄인다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady());
    await page.evaluate((data) => {
      document.querySelector('.station_modal').style.display = 'block';
      window.WEATHER_GRID_STATION_CHARTS.render('wdws', data, '2026071402');
    }, windSeries());

    const labels = await page.locator('#chart .station-chart-grid text').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent).filter((text) => /^\d{2}:00 \d{2}\.\d{2}$/.test(text))
    );
    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels[0]).toBe('03:00 07.14');
    expect(labels.at(-1)).toBe('02:00 07.16');
  });

  test('열린 차트는 화면 회전과 창 크기 변경 후 현재 컨테이너 비율로 다시 그린다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady());
    await page.evaluate((data) => {
      document.querySelector('.station_modal').style.display = 'block';
      window.WEATHER_GRID_STATION_CHARTS.render('wdws', data, '2026071402');
    }, windSeries());

    const initialWidth = await page.locator('#chart .station-chart-root').evaluate((svg) =>
      Number(svg.getAttribute('viewBox').split(/\s+/)[2])
    );
    expect(initialWidth).toBeGreaterThan(900);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => page.locator('#chart .station-chart-root').evaluate((svg) =>
      Number(svg.getAttribute('viewBox').split(/\s+/)[2])
    )).toBeLessThan(500);

    const resized = await page.locator('#chart .station-chart-root').evaluate((svg) => {
      const viewBox = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      const host = document.getElementById('chart').getBoundingClientRect();
      return {
        width: viewBox[2],
        aspectGap: Math.abs(viewBox[2] / viewBox[3] - host.width / host.height),
        labels: Array.from(svg.querySelectorAll('.station-chart-grid text'))
          .filter((node) => /^\d{2}:00 \d{2}\.\d{2}$/.test(node.textContent)).length
      };
    });
    expect(resized.width).toBeLessThan(500);
    expect(resized.aspectGap).toBeLessThan(0.02);
    expect(resized.labels).toBeLessThanOrEqual(4);
    await expect(page.locator('#chart .station-chart-root')).toHaveCount(1);
  });

  test('0.4m/s 이하 정온은 풍향·나침반 화살·윈드바브를 표시하지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady());

    const rendered = await page.evaluate((data) => {
      document.querySelector('.station_modal').style.display = 'block';
      return window.WEATHER_GRID_STATION_CHARTS.render('wdws', data, '2026071402');
    }, calmWindSeries());
    expect(rendered).toBe(true);

    const compass = page.locator('.station_compass_card');
    await expect(compass).toHaveAttribute('aria-label', /정온.*풍향을 표시하지 않음/);
    await expect(page.locator('.station_compass_arrow')).toHaveCount(0);
    await expect(page.locator('.station_compass_copy strong')).toHaveText('정온');
    await expect(page.locator('.station_compass_copy')).toContainText('0.4 m/s · 풍향 없음');
    await expect(page.locator('#station_chart_description')).toContainText('정온(0.4미터 매 초 이하)');

    const windVectorData = await page.evaluate(() =>
      window.WEATHER_GRID_STATION_CHARTS.getChart().series[1].userOptions.data
    );
    expect(windVectorData).toHaveLength(48);
    expect(windVectorData.every(([speed, direction]) => speed === null && direction === null)).toBe(true);

    await page.locator('#station_data_details summary').click();
    await expect(page.locator('#station_data_table tbody tr')).toHaveCount(48);
    await expect(page.locator('#station_data_table tbody tr td:last-child').first())
      .toHaveText('정온 (풍향 없음)');
    await expect(page.locator('#station_data_table')).not.toContainText('서풍');
  });

  test('강수량 공식 구간과 강수확률을 왜곡 없이 48시간 차트·표에 표시한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady('pcp'));

    const data = precipitationSeries((hour) => {
      if (hour === 2) return '1.0mm 미만';
      if (hour === 3) return '1.0~3.0mm';
      if (hour === 4) return '50.0mm 이상';
      return '강수없음';
    });
    const rendered = await page.evaluate((forecast) => {
      document.querySelector('.station_modal').style.display = 'block';
      return window.WEATHER_GRID_STATION_CHARTS.render('pcp', forecast, '2026071402');
    }, data);
    expect(rendered).toBe(true);

    await expect(page.locator('#station_chart_heading')).toHaveText('1시간 예상 강수량');
    await expect(page.locator('#station_chart_summary .station_metric_card')).toHaveCount(3);
    await expect(page.locator('#station_chart_summary')).toContainText('첫 강수');
    await expect(page.locator('#station_chart_summary')).toContainText('mm 이상');
    await expect(page.locator('#station_chart_description')).toContainText('최고 강수확률은 80퍼센트');
    const chartState = await page.evaluate(() => ({
      types: window.WEATHER_GRID_STATION_CHARTS.getChart().series.map((series) => series.type),
      pointCounts: window.WEATHER_GRID_STATION_CHARTS.getChart().series.map((series) => series.data.length)
    }));
    expect(chartState.types).toEqual(['column', 'column', 'scatter', 'spline']);
    expect(chartState.pointCounts).toEqual([48, 48, 48, 48]);

    await page.locator('#station_data_details summary').click();
    await expect(page.locator('#station_data_table tbody tr')).toHaveCount(48);
    await expect(page.locator('#station_data_table')).toContainText('1.0mm 미만');
    await expect(page.locator('#station_data_table')).toContainText('1.0~3.0mm');
    await expect(page.locator('#station_data_table')).toContainText('50.0mm 이상');

    const dryRendered = await page.evaluate((forecast) =>
      window.WEATHER_GRID_STATION_CHARTS.render('pcp', forecast, '2026071402'),
      precipitationSeries()
    );
    expect(dryRendered).toBe(true);
    await expect(page.locator('#station_chart_summary')).toContainText('예상 없음');
    await expect(page.locator('#station_chart_summary')).toContainText(/0\s*mm/);
  });

  test('신적설·상대습도·파고는 같은 단기예보 응답으로 연속 시계열을 그린다', async ({ page }) => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady('sno'));
    const snow = forecastElementSeries((hour) => ({
      snowfallAmount: hour === 1 ? '0' : hour === 2 ? '1.0cm 미만' : '적설없음'
    }));
    expect(await page.evaluate((payload) => {
      document.querySelector('.station_modal').style.display = 'block';
      return window.WEATHER_GRID_STATION_CHARTS.render('sno', payload, '2026071402');
    }, snow)).toBe(true);
    await expect(page.locator('#station_chart_heading')).toHaveText('1시간 신적설 시계열');
    await expect(page.locator('#station_data_table thead')).toContainText('1시간 신적설(cm)');
    await expect(page.locator('#station_data_table tbody tr').first()).toContainText('0cm');
    expect(await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.getChart().series[0].type)).toBe('area-line');

    const humidity = forecastElementSeries((hour) => ({ humidity: hour === 1 ? 0 : 45 + (hour % 20) }));
    expect(await page.evaluate((payload) =>
      window.WEATHER_GRID_STATION_CHARTS.render('reh', payload, '2026071402'), humidity)).toBe(true);
    await expect(page.locator('#station_chart_heading')).toHaveText('상대습도 시계열');
    await expect(page.locator('#station_data_table tbody tr').first()).toContainText('0%');

    const wave = forecastElementSeries((hour) => ({ waveHeight: hour % 4 === 0 ? null : hour === 1 ? 0 : 1.4 }));
    expect(await page.evaluate((payload) =>
      window.WEATHER_GRID_STATION_CHARTS.render('wav', payload, '2026071402'), wave)).toBe(true);
    await expect(page.locator('#station_chart_heading')).toHaveText('파고 시계열');
    await expect(page.locator('#station_chart_source')).toContainText('해상 제공');
    await expect(page.locator('#station_data_table thead')).toContainText('파고(m)');
    await expect(page.locator('#station_data_table tbody tr').nth(3)).toContainText('—');
    await expect(page.locator('#station_chart_heading')).not.toContainText('유의파고');

    const inland = forecastElementSeries(() => ({ waveHeight: null }));
    expect(await page.evaluate((payload) =>
      window.WEATHER_GRID_STATION_CHARTS.render('wav', payload, '2026071402'), inland)).toBe(false);
    await expect(page.locator('#station_chart_summary')).toBeEmpty();
    expect(await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.getChart())).toBeNull();
  });

  test('강수형태와 하늘상태는 수치 높이 대신 시간별 상태 밴드와 표로 표시한다', async ({ page }) => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady('pty'));

    const precipitationType = forecastElementSeries((hour) => {
      const code = hour % 5;
      return {
        precipitationType: code,
        precipitationTypeLabel: ['없음', '비', '비/눈', '눈', '소나기'][code]
      };
    });
    expect(await page.evaluate((payload) => {
      document.querySelector('.station_modal').style.display = 'block';
      return window.WEATHER_GRID_STATION_CHARTS.render('pty', payload, '2026071402');
    }, precipitationType)).toBe(true);
    await expect(page.locator('#station_chart_heading')).toHaveText('강수형태 변화');
    await expect(page.locator('#station_data_table')).toContainText('비/눈');
    expect(await page.evaluate(() => ({
      type: window.WEATHER_GRID_STATION_CHARTS.getChart().series[0].type,
      points: window.WEATHER_GRID_STATION_CHARTS.getChart().series[0].data.length
    }))).toEqual({ type: 'column', points: 48 });

    const sky = forecastElementSeries((hour) => {
      const code = [1, 3, 4][hour % 3];
      return { skyCode: code, skyLabel: { 1: '맑음', 3: '구름많음', 4: '흐림' }[code] };
    });
    expect(await page.evaluate((payload) =>
      window.WEATHER_GRID_STATION_CHARTS.render('sky', payload, '2026071402'), sky)).toBe(true);
    await expect(page.locator('#station_chart_heading')).toHaveText('하늘상태 변화');
    await expect(page.locator('#station_data_table')).toContainText('구름많음');
    expect(await page.evaluate(() => document.querySelectorAll('#chart .station-chart-root').length)).toBe(1);
  });

  test('기온 선과 일사강도 막대를 반복 렌더링해도 차트가 누적되지 않고 모바일에서 넘치지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WEATHER_GRID_STATION_CHARTS);
    await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.ensureReady());

    await page.evaluate((data) => {
      document.querySelector('.station_modal').style.display = 'block';
      return window.WEATHER_GRID_STATION_CHARTS.render('wdws', data, '2026071402');
    }, windSeries());
    expect(await page.evaluate(() => window.WEATHER_GRID_STATION_CHARTS.getChart().series.map((series) => series.type)))
      .toEqual(['area-line', 'wind-vector']);

    await page.evaluate((data) => {
      return window.WEATHER_GRID_STATION_CHARTS.render('tmp', data, '2026071402');
    }, scalarSeries((index) => Number((24 + Math.sin(index / 6) * 4).toFixed(1))));
    let state = await page.evaluate(() => ({
      type: window.WEATHER_GRID_STATION_CHARTS.getChart().series[0].type,
      connectNulls: window.WEATHER_GRID_STATION_CHARTS.getChart().series[0].options.connectNulls,
      liveCharts: document.querySelectorAll('#chart .station-chart-root').length
    }));
    expect(state.type).toBe('area-line');
    expect(state.connectNulls).toBe(false);
    expect(state.liveCharts).toBe(1);

    await page.evaluate((data) =>
      window.WEATHER_GRID_STATION_CHARTS.render('swdn', data, '2026071402'),
      scalarSeries((index) => index === 0 ? -0.001
        : Math.max(0, Math.round(760 * Math.sin((index % 24) / 24 * Math.PI))))
    );
    state = await page.evaluate(() => {
      const panel = document.querySelector('.station_chart_panel').getBoundingClientRect();
      const chart = document.getElementById('chart').getBoundingClientRect();
      return {
        type: window.WEATHER_GRID_STATION_CHARTS.getChart().series[0].type,
        liveCharts: document.querySelectorAll('#chart .station-chart-root').length,
        chartFits: chart.left >= panel.left && chart.right <= panel.right + 1,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth
      };
    });
    expect(state.type).toBe('column');
    expect(state.liveCharts).toBe(1);
    expect(state.chartFits).toBe(true);
    expect(state.pageOverflow).toBe(false);
    await expect(page.locator('#station_chart_heading')).toContainText('일사강도 시계열');
    await expect(page.locator('#station_chart_source')).toHaveText('KIM NE57 · 원자료 8 km');
    await expect(page.locator('#station_chart_heading')).not.toContainText('일사량');
    await expect(page.locator('#station_chart_description')).not.toContainText('-0W/㎡');

    await page.locator('#station_data_details summary').click();
    await expect(page.locator('#station_data_table caption')).toContainText('일사강도 향후 48시간');
    await expect(page.locator('#station_data_table thead')).toContainText('일사강도(W/㎡)');

    const missing = await page.evaluate(() =>
      window.WEATHER_GRID_STATION_CHARTS.render('tmp', Array.from({ length: 49 }, () => [9999]), '2026071402')
    );
    expect(missing).toBe(false);
    await expect(page.locator('#station_chart_summary')).toBeEmpty();
    expect(await page.evaluate(() => document.querySelectorAll('#chart .station-chart-root').length)).toBe(0);
  });
});
