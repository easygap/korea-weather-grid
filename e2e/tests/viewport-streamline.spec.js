const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

async function waitForWeather(page) {
  await page.waitForFunction(
    () => window.lastGridResult && window.getWindDiagnostics
      && window.getWindDiagnostics().state === 'running'
      && window.getWindDiagnostics().frameCount > 1,
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(250);
}

async function viewportMetrics(page) {
  return page.evaluate(() => {
    const result = window.lastGridResult;
    const view = weatherMap.getView();
    const projection = view.getProjection();
    const corners = [
      [result.swLon, result.swLat],
      [result.swLon, result.neLat],
      [result.neLon, result.swLat],
      [result.neLon, result.neLat]
    ].map((coordinate) => weatherMap.getPixelFromCoordinate(
      ol.proj.transform(coordinate, 'EPSG:4326', projection)
    ));
    const canvas = document.getElementById('wind_field_canvas');
    const mapCanvasPixels = Array.from(
      document.querySelectorAll('#map .ol-viewport canvas:not(#wind_field_canvas)')
    ).map((item) => item.width * item.height);
    const probe = document.createElement('canvas');
    probe.width = 96;
    probe.height = 96;
    const context = probe.getContext('2d');
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let nonTransparentSamples = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) nonTransparentSamples += 1;
    }
    return {
      minX: Math.min(...corners.map((point) => point[0])),
      maxX: Math.max(...corners.map((point) => point[0])),
      minY: Math.min(...corners.map((point) => point[1])),
      maxY: Math.max(...corners.map((point) => point[1])),
      zoom: view.getZoom(),
      center: ol.proj.transform(view.getCenter(), projection, 'EPSG:4326'),
      cssSize: [canvas.clientWidth, canvas.clientHeight],
      backingSize: [canvas.width, canvas.height],
      scrollSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      nonTransparentSamples,
      diagnostics: window.getWindDiagnostics(),
      mapCanvasPixels,
      mapDiagnostics: window.getMapRenderDiagnostics()
    };
  });
}

test.describe('초기 뷰포트와 스트림라인 회귀', () => {
  test.setTimeout(120000);

  const cases = [
    { name: '모바일', width: 393, height: 659, safe: [64, 16, 96, 16] },
    { name: '노트북', width: 1280, height: 720, safe: [84, 160, 92, 292] },
    { name: '데스크톱', width: 1920, height: 1080, safe: [84, 160, 92, 292] },
    { name: 'QHD', width: 2560, height: 1440, safe: [84, 160, 92, 292] }
  ];

  for (const item of cases) {
    test(`${item.name} ${item.width}×${item.height} — 격자와 캔버스가 안전 영역 안에 표시`, async ({ page }) => {
      await page.setViewportSize({ width: item.width, height: item.height });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await waitForWeather(page);

      const metrics = await viewportMetrics(page);
      const [top, right, bottom, left] = item.safe;
      expect(metrics.minX).toBeGreaterThanOrEqual(left - 3);
      expect(metrics.maxX).toBeLessThanOrEqual(item.width - right + 3);
      expect(metrics.minY).toBeGreaterThanOrEqual(top - 3);
      expect(metrics.maxY).toBeLessThanOrEqual(item.height - bottom + 3);
      expect(metrics.cssSize).toEqual([item.width, item.height]);
      expect(metrics.backingSize[0] * metrics.backingSize[1]).toBeLessThanOrEqual(8000000);
      expect(metrics.mapCanvasPixels.length).toBeGreaterThan(0);
      expect(Math.max(...metrics.mapCanvasPixels)).toBeLessThanOrEqual(12000000);
      expect(metrics.mapDiagnostics.largestCanvasPixels).toBeLessThanOrEqual(12000000);
      expect(metrics.scrollSize).toEqual([item.width, item.height]);
      expect(metrics.nonTransparentSamples).toBeGreaterThan(0);
      expect(metrics.diagnostics.unit).toBe('m/s');
      expect(metrics.diagnostics.fieldSamples).toBeLessThanOrEqual(180000);
      expect(metrics.diagnostics.validSamples).toBeGreaterThan(0);
      expect(metrics.diagnostics.maxObservedDisplaySpeed).toBeLessThanOrEqual(55.001);
      expect(metrics.diagnostics.particleCount).toBeGreaterThan(0);
    });
  }

  test('DPR 3 모바일 — 선명도는 유지하고 입자 캔버스는 8MP 이하로 제한', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 393, height: 659 },
      deviceScaleFactor: 3
    });
    const page = await context.newPage();
    try {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await waitForWeather(page);
      const metrics = await viewportMetrics(page);
      expect(metrics.backingSize).toEqual([1179, 1977]);
      expect(metrics.backingSize[0] * metrics.backingSize[1]).toBeLessThanOrEqual(8000000);
    } finally {
      await context.close();
    }
  });

  test('4K DPR 2 — 지도 레이어는 12MP, 스트림라인은 8MP 예산을 넘지 않는다', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 3840, height: 2160 },
      screen: { width: 3840, height: 2160 },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    try {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await waitForWeather(page);
      const metrics = await viewportMetrics(page);
      expect(metrics.mapDiagnostics.configuredPixelRatio).toBeGreaterThan(0);
      expect(metrics.mapDiagnostics.configuredPixelRatio).toBeLessThan(2);
      expect(metrics.mapCanvasPixels.length).toBeGreaterThan(0);
      for (const pixels of metrics.mapCanvasPixels) {
        expect(pixels).toBeLessThanOrEqual(12000000);
      }
      expect(metrics.mapDiagnostics.largestCanvasPixels).toBeLessThanOrEqual(12000000);
      expect(metrics.backingSize[0] * metrics.backingSize[1]).toBeLessThanOrEqual(8000000);
    } finally {
      await context.close();
    }
  });

  test('8K DPR 2 — CSS 픽셀 수가 예산보다 커도 backing store 상한을 지킨다', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 7680, height: 4320 },
      screen: { width: 7680, height: 4320 },
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    try {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await waitForWeather(page);
      const metrics = await viewportMetrics(page);
      expect(metrics.mapDiagnostics.configuredPixelRatio).toBeGreaterThan(0);
      expect(metrics.mapDiagnostics.configuredPixelRatio).toBeLessThan(0.75);
      expect(metrics.mapCanvasPixels.length).toBeGreaterThan(0);
      for (const pixels of metrics.mapCanvasPixels) {
        expect(pixels).toBeLessThanOrEqual(12000000);
      }
      expect(metrics.mapDiagnostics.largestCanvasPixels).toBeLessThanOrEqual(12000000);
      expect(metrics.backingSize[0] * metrics.backingSize[1]).toBeLessThanOrEqual(8000000);
    } finally {
      await context.close();
    }
  });

  test('3D 지구본 패치 생성은 제한된 샘플 수와 진입 시간 안에서 끝난다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForWeather(page);
    await page.locator('#btn_3d').click();
    await page.locator('#view3d.open canvas').waitFor({ state: 'visible' });

    const result = await page.evaluate(async () => {
      const switchStartedAt = performance.now();
      document.querySelector('.view3d_modes button[data-mode="globe"]').click();
      const modeSwitchHandlerMs = performance.now() - switchStartedAt;
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const diagnostics = window.WEATHER_GRID_3D.getDiagnostics();
        if (diagnostics.mode === 'globe' && diagnostics.patchTextureSamples > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = document.querySelector('#view3d canvas');
      const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
      return {
        diagnostics: window.WEATHER_GRID_3D.getDiagnostics(),
        modeSwitchHandlerMs,
        contextLost: !gl || gl.isContextLost()
      };
    });

    expect(result.diagnostics.mode).toBe('globe');
    expect(result.diagnostics.patchTextureSize).toEqual([512, 448]);
    expect(result.diagnostics.patchTextureSamples).toBe(512 * 448);
    expect(result.diagnostics.patchTextureBuildMs).toBeLessThan(500);
    expect(result.diagnostics.buildMs).toBeLessThan(800);
    expect(result.modeSwitchHandlerMs).toBeLessThan(500);
    expect(result.diagnostics.drawingBufferSize[0]).toBeGreaterThan(0);
    expect(result.diagnostics.drawingBufferSize[1]).toBeGreaterThan(0);
    expect(result.contextLost).toBe(false);
  });

  test('3D 화면 resize 뒤에도 2D 스트림라인은 중단 상태를 유지한다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForWeather(page);

    await page.locator('#btn_3d').click();
    await page.locator('#view3d.open canvas').waitFor({ state: 'visible' });
    await expect.poll(() => page.evaluate(() => window.getWindDiagnostics().state))
      .not.toBe('running');

    await page.setViewportSize({ width: 1360, height: 820 });
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.getWindDiagnostics().state)).not.toBe('running');

    await page.locator('#view3d_close').click();
    await expect.poll(() => page.evaluate(() => window.getWindDiagnostics().state), { timeout: 5000 })
      .toBe('running');
  });

  test('4K 3D 화면은 CSS 해상도를 유지한다', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForWeather(page);
    await page.locator('#btn_3d').click();
    await page.locator('#view3d.open canvas').waitFor({ state: 'visible' });

    const result = await page.evaluate(() => {
      const canvas = document.querySelector('#view3d canvas');
      const rect = canvas.getBoundingClientRect();
      return {
        cssSize: [Math.round(rect.width), Math.round(rect.height)],
        diagnostics: window.WEATHER_GRID_3D.getDiagnostics()
      };
    });

    expect(result.cssSize).toEqual([3840, 2160]);
    expect(result.diagnostics.drawingBufferSize).toEqual([3840, 2160]);
    expect(result.diagnostics.maxRenderPixels).toBe(3840 * 2160);
  });

  test('줌 버튼 — 연속 애니메이션 후 스트림라인을 한 번만 다시 생성', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitForWeather(page);

    const result = await page.evaluate(async () => {
      const OriginalWindy = window.Windy;
      let instances = 0;
      let starts = 0;
      const originalPrototypeStart = OriginalWindy.prototype.start;
      OriginalWindy.prototype.start = function instrumentedPrototypeStart() {
        starts += 1;
        return originalPrototypeStart.apply(this, arguments);
      };
      window.Windy = function instrumentedWindy(params) {
        instances += 1;
        return new OriginalWindy(params);
      };

      const canvas = document.getElementById('wind_field_canvas');
      const initialZoom = weatherMap.getView().getZoom();
      const samples = [];
      const startedAt = performance.now();
      let collecting = true;
      const collect = () => {
        samples.push({
          time: performance.now() - startedAt,
          zoom: weatherMap.getView().getZoom(),
          moving: canvas.classList.contains('is-map-moving')
        });
        if (performance.now() - startedAt < 550) requestAnimationFrame(collect);
        else collecting = false;
      };
      requestAnimationFrame(collect);
      document.querySelector('.ol-zoom-in').click();
      while (collecting) await new Promise((resolve) => setTimeout(resolve, 20));
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const changed = samples.filter((sample, index) =>
        index > 0 && Math.abs(sample.zoom - samples[index - 1].zoom) > 0.0001
      );
      return {
        initialZoom,
        finalZoom: weatherMap.getView().getZoom(),
        changingFrames: changed.length,
        animationDuration: changed.length ? changed[changed.length - 1].time : 0,
        hiddenDuringMove: samples.some((sample) => sample.moving),
        instances,
        starts,
        finalOpacity: getComputedStyle(canvas).opacity,
        finalMoving: canvas.classList.contains('is-map-moving')
      };
    });

    expect(result.finalZoom - result.initialZoom).toBeCloseTo(1, 4);
    expect(result.changingFrames).toBeGreaterThanOrEqual(6);
    expect(result.animationDuration).toBeGreaterThanOrEqual(180);
    expect(result.animationDuration).toBeLessThanOrEqual(450);
    expect(result.hiddenDuringMove).toBe(true);
    expect(result.instances).toBe(0);
    expect(result.starts).toBe(1);
    expect(result.finalOpacity).toBe('1');
    expect(result.finalMoving).toBe(false);
  });
});
