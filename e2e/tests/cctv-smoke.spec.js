const { test, expect } = require('@playwright/test');

const VALID_STREAM = 'https://cctvsec.ktict.co.kr/live/seoul/index.m3u8';

function cctvItem(overrides = {}) {
  return {
    id: 'cctv-101',
    name: '서울 도심 CCTV',
    latitude: 37.5665,
    longitude: 126.978,
    streamUrl: VALID_STREAM,
    format: 'HLS',
    resolution: '1280x720',
    fileCreatedAt: '2026-07-13 18:00:00',
    roadSectionId: '서울-도심-01',
    ...overrides,
  };
}

function cctvPayload(cctvs, overrides = {}) {
  return {
    fetchedAt: '2026-07-13T09:00:00Z',
    stale: false,
    truncated: false,
    source: '국가교통정보센터',
    cctvs,
    ...overrides,
  };
}

async function installMediaStub(page) {
  await page.addInitScript(() => {
    window.__hlsLoadedUrls = [];
    window.__hlsDestroyed = 0;
    Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', {
      configurable: true,
      value: () => '',
    });
    HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {};
    HTMLMediaElement.prototype.load = function load() {};
  });

  await page.route('**/static/vendor/hls.light.min.js?*', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `(() => {
        class FakeHls {
          static Events = { MEDIA_ATTACHED: 'mediaAttached', MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
          static isSupported() { return true; }
          constructor() { this.handlers = new Map(); }
          on(type, handler) { this.handlers.set(type, handler); }
          emit(type, data) { const handler = this.handlers.get(type); if (handler) handler(type, data); }
          attachMedia(media) { this.media = media; this.emit(FakeHls.Events.MEDIA_ATTACHED); }
          loadSource(url) { window.__hlsLoadedUrls.push(url); this.emit(FakeHls.Events.MANIFEST_PARSED); }
          destroy() { window.__hlsDestroyed++; this.handlers.clear(); }
        }
        window.Hls = FakeHls;
      })();`,
    });
  });
}

async function installStallingManifestStub(page) {
  await page.addInitScript(() => {
    window.__manifestReady = false;
    window.__hlsLoadedUrls = [];
    window.__hlsDestroyed = 0;
    Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', {
      configurable: true,
      value: () => '',
    });
    HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {};
    HTMLMediaElement.prototype.load = function load() {};

    class FakeHls {
      static Events = { MEDIA_ATTACHED: 'mediaAttached', MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
      static isSupported() { return true; }
      constructor() { this.handlers = new Map(); }
      on(type, handler) { this.handlers.set(type, handler); }
      emit(type, data) {
        const handler = this.handlers.get(type);
        if (handler) handler(type, data);
      }
      attachMedia(media) {
        this.media = media;
        this.emit(FakeHls.Events.MEDIA_ATTACHED);
      }
      loadSource(url) {
        window.__hlsLoadedUrls.push(url);
        if (window.__manifestReady) this.emit(FakeHls.Events.MANIFEST_PARSED);
      }
      destroy() {
        window.__hlsDestroyed++;
        this.handlers.clear();
      }
    }
    window.Hls = FakeHls;
  });
}

async function fitMap(page, center, halfLon = 0.18, halfLat = 0.13) {
  await page.evaluate(({ center, halfLon, halfLat }) => new Promise((resolve) => {
    const view = weatherMap.getView();
    const extent = ol.proj.transformExtent([
      center[0] - halfLon, center[1] - halfLat,
      center[0] + halfLon, center[1] + halfLat,
    ], 'EPSG:4326', view.getProjection(), 16);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    weatherMap.once('moveend', finish);
    view.fit(extent, { size: weatherMap.getSize(), padding: [40, 40, 40, 40], duration: 0 });
    setTimeout(finish, 250);
  }), { center, halfLon, halfLat });
}

function exploreModeButton(page, mode) {
  if (mode === 'wind') return page.locator('button[data-data-domain="weather"]:visible').first();
  if (mode === 'air') return page.locator('button[data-data-domain="air"]:visible').first();
  if (mode === 'road') return page.locator('button[data-data-domain="traffic"]:visible').first();
  return page.locator(`button[data-explore-mode="${mode}"]:visible`).first();
}

async function selectExploreMode(page, mode) {
  const button = exploreModeButton(page, mode);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function openLayerSettings(page) {
  const dock = page.locator('#dock');
  if (await dock.evaluate((element) => element.classList.contains('collapsed'))) {
    await page.locator('#dock_toggle').click();
  }
  const settings = page.locator('#layer_settings');
  if (!(await settings.evaluate((element) => element.open))) {
    await settings.locator('summary').click();
  }
  await expect(settings).toHaveAttribute('open', '');
}

test('CCTV는 확대 후 조회되고 선택·재생·정리·경합을 안전하게 처리한다', async ({ page }) => {
  let cctvRequests = 0;
  let hlsAssetRequests = 0;
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const requestUrls = [];

  await installMediaStub(page);
  await page.route('**/static/vendor/hls.light.min.js?*', async (route) => {
    hlsAssetRequests++;
    await route.fallback();
  });
  await page.route('**/api/environment/air-quality?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        dataTime: '2026-07-13 18:00', stale: false, source: 'AirKorea',
        stations: [{
          name: '서울시청', address: '서울특별시 중구', network: '도시대기',
          latitude: 37.5665, longitude: 126.978, pm10: 28, pm25: 12,
          pm10Grade: 1, pm25Grade: 1, dataTime: '2026-07-13 18:00',
        }],
      }),
    });
  });
  await page.route('**/api/traffic/cameras?**', async (route) => {
    cctvRequests++;
    requestUrls.push(route.request().url());
    const ordinal = cctvRequests;
    let payload;
    if (ordinal === 1) {
      payload = cctvPayload([
        cctvItem(),
        cctvItem({ id: 'cctv-102', name: '서울 도심 CCTV 2' }),
        cctvItem({ id: 'cctv-103', name: '남산 CCTV', latitude: 37.5512, longitude: 126.9882 }),
        cctvItem({ id: 'bad-host', streamUrl: 'https://example.com/live.m3u8' }),
        cctvItem({ id: 'bad-user', streamUrl: 'https://user:pass@cctvsec.ktict.co.kr/live.m3u8' }),
        cctvItem({ id: 'bad-query', streamUrl: 'https://cctvsec.ktict.co.kr/live.m3u8?camera=101' }),
        cctvItem({ id: 'bad-fragment', streamUrl: 'https://cctvsec.ktict.co.kr/live.m3u8#secret' }),
        cctvItem({ id: 'bad-http', streamUrl: 'http://cctvsec.ktict.co.kr/live.m3u8' }),
        cctvItem({ id: 'bad-port', streamUrl: 'https://cctvsec.ktict.co.kr:9443/live.m3u8' }),
        cctvItem({ id: 'bad-path', streamUrl: 'https://cctvsec.ktict.co.kr' }),
        cctvItem({ id: 'bad-format', format: 'MP4' }),
      ]);
    } else if (ordinal === 2) {
      await slowGate;
      payload = cctvPayload([cctvItem({ id: 'slow', name: '느린 이전 응답', latitude: 35.1796, longitude: 129.0756 })]);
    } else {
      payload = cctvPayload([cctvItem({ id: 'latest', name: '최신 응답 CCTV', latitude: 36.3504, longitude: 127.3845 })]);
    }
    try {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
    } catch (_) {
      // 두 번째 요청은 의도적으로 AbortController가 취소한다.
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_CCTV && window.WEATHER_GRID_AIR_QUALITY);

  const toggle = page.locator('#cctv_toggle');
  const roadMode = exploreModeButton(page, 'road');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await roadMode.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await selectExploreMode(page, 'road');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() =>
    new URLSearchParams(location.hash.slice(1)).get('cctv'))).toBe('1');
  await page.waitForTimeout(500);
  expect(cctvRequests).toBe(0);
  await expect(page.locator('#cctv_status')).toContainText('확대');

  await fitMap(page, [126.978, 37.5665]);
  await expect.poll(() => cctvRequests).toBe(1);
  const params = new URL(requestUrls[0]).searchParams;
  expect([...params.keys()].sort()).toEqual(['maxLat', 'maxLon', 'minLat', 'minLon']);
  expect([...params.keys()].every((key) => params.getAll(key).length === 1)).toBe(true);
  for (const value of params.values()) expect(Number(value) * 4).toBeCloseTo(Math.round(Number(value) * 4), 8);
  await expect.poll(() => page.evaluate(() =>
    window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures().length)).toBe(3);
  await expect(page.locator('#cctv_status')).toContainText('2026.07.13 18:00 KST');
  await expect.poll(() => page.evaluate(() =>
    window.WEATHER_GRID_CCTV.layer.getSource().getFeatures().some((feature) => feature.get('features').length > 1))).toBe(true);

  const duplicatePixel = await page.evaluate(() => {
    const cluster = window.WEATHER_GRID_CCTV.layer.getSource().getFeatures().find((feature) =>
      feature.get('features').some((member) => member.get('cctv').name === '서울 도심 CCTV'));
    const pixel = weatherMap.getPixelFromCoordinate(cluster.getGeometry().getCoordinates());
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
  });
  await page.mouse.click(duplicatePixel.x, duplicatePixel.y);
  await expect(page.locator('#cctv_cluster_picker')).toBeVisible();
  await expect(page.locator('#cctv_cluster_list button')).toHaveCount(2);
  await page.locator('#cctv_cluster_list button', { hasText: '서울 도심 CCTV 2' }).click();
  await expect(page.locator('#cctv_popup_title')).toHaveText('서울 도심 CCTV 2');
  await expect(page.locator('#cctv_video')).not.toHaveAttribute('src');
  await page.locator('#cctv_popup_close').click();

  const cctvPixel = await page.evaluate(() => {
    const cluster = window.WEATHER_GRID_CCTV.layer.getSource().getFeatures().find((feature) =>
      feature.get('features').some((member) => member.get('cctv').name === '남산 CCTV'));
    const pixel = weatherMap.getPixelFromCoordinate(cluster.getGeometry().getCoordinates());
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
  });
  await page.mouse.click(cctvPixel.x, cctvPixel.y);
  await expect(page.locator('#cctv_popup_title')).toHaveText('남산 CCTV');
  expect(await page.locator('#air_popup:not([hidden]), #cctv_popup:not([hidden])').count()).toBe(1);
  await page.locator('#cctv_popup_close').click();

  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  await expect(page.locator('#cctv_popup')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#cctv_cluster_picker')).toBeVisible();
  await page.locator('#cctv_cluster_list button').first().click();
  await expect(page.locator('#cctv_video')).not.toHaveAttribute('src');
  expect(hlsAssetRequests).toBe(0);
  await page.locator('#cctv_play').click();
  await expect.poll(() => hlsAssetRequests).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__hlsLoadedUrls.length)).toBe(1);
  expect(await page.evaluate(() => window.__hlsLoadedUrls[0])).toBe(VALID_STREAM);

  await page.locator('#cctv_popup').press('Escape');
  await expect(page.locator('#cctv_popup')).toHaveAttribute('hidden', '');
  await expect(page.locator('#map')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__hlsDestroyed)).toBe(1);

  await page.locator('#map').press('Enter');
  await page.locator('#cctv_cluster_list button').first().click();
  await page.locator('#cctv_play').click();
  await expect.poll(() => page.evaluate(() => window.__hlsDestroyed)).toBe(1);
  await page.evaluate(() => weatherMap.dispatchEvent('movestart'));
  await expect.poll(() => page.evaluate(() => window.__hlsDestroyed)).toBe(2);
  await expect(page.locator('#cctv_popup')).toHaveAttribute('hidden', '');
  await page.evaluate(() => weatherMap.dispatchEvent('moveend'));

  await selectExploreMode(page, 'air');
  await expect.poll(() => page.evaluate(() =>
    window.WEATHER_GRID_AIR_QUALITY.layer.getSource().getSource().getFeatures().length)).toBe(1);
  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  const visibleOverlayPopups = await page.locator('#air_popup:not([hidden]), #cctv_popup:not([hidden])').count();
  expect(visibleOverlayPopups).toBe(1);

  await selectExploreMode(page, 'road');
  await fitMap(page, [129.0756, 35.1796]);
  await expect.poll(() => cctvRequests).toBe(2);
  await fitMap(page, [127.3845, 36.3504]);
  await expect.poll(() => cctvRequests).toBe(3);
  await expect.poll(() => page.evaluate(() => {
    const feature = window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures()[0];
    return feature && feature.get('cctv').name;
  })).toBe('최신 응답 CCTV');
  releaseSlow();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => {
    const feature = window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures()[0];
    return feature && feature.get('cctv').name;
  })).toBe('최신 응답 CCTV');

  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  await page.locator('#cctv_play').click();
  const destroyedBeforeDisable = await page.evaluate(() => window.__hlsDestroyed);
  await selectExploreMode(page, 'wind');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() =>
    new URLSearchParams(location.hash.slice(1)).get('cctv'))).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__hlsDestroyed)).toBe(destroyedBeforeDisable + 1);
  await expect(page.locator('#cctv_popup')).toHaveAttribute('hidden', '');

  expect(page.url()).not.toContain('cctvsec.ktict.co.kr');
  expect(page.url()).not.toContain('token=test-token');
  expect(await page.evaluate(() => Object.values(localStorage).join('|'))).not.toContain('cctvsec.ktict.co.kr');
});

test('QHD 화면에서도 최대 확대 시 CCTV 조회 범위가 24타일 안으로 들어온다', async ({ page }) => {
  let requestedUrl = '';
  await page.route('**/api/traffic/cameras?**', async (route) => {
    requestedUrl = route.request().url();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(cctvPayload([cctvItem()])),
    });
  });

  await page.setViewportSize({ width: 2560, height: 1271 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_CCTV);
  await selectExploreMode(page, 'road');

  const zoomLimits = await page.evaluate(() => {
    const view = weatherMap.getView();
    view.setZoom(view.getMaxZoom());
    weatherMap.renderSync();
    return { min: view.getMinZoom(), max: view.getMaxZoom(), current: view.getZoom() };
  });

  await expect.poll(() => requestedUrl).not.toBe('');
  expect(zoomLimits.max).toBeCloseTo(12.5, 6);
  expect(zoomLimits.current).toBeCloseTo(zoomLimits.max, 6);

  const params = new URL(requestedUrl).searchParams;
  const latTiles = Math.round((Number(params.get('maxLat')) - Number(params.get('minLat'))) * 4);
  const lonTiles = Math.round((Number(params.get('maxLon')) - Number(params.get('minLon'))) * 4);
  expect(latTiles * lonTiles).toBeLessThanOrEqual(24);
  await expect(page.locator('#cctv_status')).toContainText('CCTV 1곳');
});

test('캐시 CCTV 위치는 보여주되 만료된 영상 주소는 재생하지 않는다', async ({ page }) => {
  await installMediaStub(page);
  await page.route('**/api/traffic/cameras?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(cctvPayload([cctvItem()], { stale: true })),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_CCTV);
  await selectExploreMode(page, 'road');
  await fitMap(page, [126.978, 37.5665]);
  await expect.poll(() => page.evaluate(() =>
    window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures().length)).toBe(1);
  await expect(page.locator('#cctv_status')).toContainText('캐시 자료');

  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  await expect(page.locator('#cctv_popup_eyebrow')).toHaveText('ITS · 캐시 위치 정보');
  await expect(page.locator('#cctv_play')).toBeDisabled();
  await expect(page.locator('#cctv_play')).toHaveText('실시간 연결 대기');
  await expect(page.locator('#cctv_media_status')).toContainText('실시간 갱신 후에만 재생');
  expect(await page.evaluate(() => window.__hlsLoadedUrls.length)).toBe(0);
  await expect(page.locator('#cctv_video')).not.toHaveAttribute('src');
});

test('모바일·reduced-motion에서도 CCTV 조작부와 팝업이 화면 안에 유지된다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/traffic/cameras?**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(cctvPayload([cctvItem()])) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_CCTV);
  const roadMode = exploreModeButton(page, 'road');
  await expect(roadMode).toBeVisible();
  expect(await roadMode.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(44);
  await selectExploreMode(page, 'road');
  await fitMap(page, [126.978, 37.5665], 0.08, 0.08);
  await expect.poll(() => page.evaluate(() =>
    window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures().length)).toBe(1);
  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  const box = await page.locator('#cctv_popup').boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.locator('#cctv_popup').press('Escape');
  await expect(page.locator('#map')).toBeFocused();
});

test('CCTV 목록·HLS 연결은 시간 초과 후 정리되고 재시도할 수 있다', async ({ page }) => {
  let cctvRequests = 0;
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });

  await installStallingManifestStub(page);
  await page.route('**/api/traffic/cameras?**', async (route) => {
    cctvRequests++;
    const ordinal = cctvRequests;
    if (ordinal === 1) await firstGate;
    if (ordinal === 2) await secondGate;
    const item = cctvItem({
      id: ordinal < 3 ? 'slow-cctv' : 'latest-cctv',
      name: ordinal < 3 ? '느린 이전 CCTV' : '최신 CCTV',
    });
    try {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(cctvPayload([item])),
      });
    } catch (_) {
      // 시간 초과 또는 레이어 전환으로 취소된 요청은 응답을 버린다.
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WEATHER_GRID_CCTV);
  await selectExploreMode(page, 'road');
  await fitMap(page, [126.978, 37.5665]);
  await expect.poll(() => cctvRequests).toBe(1);
  await expect(page.locator('#cctv_status')).toContainText('시간이 초과', { timeout: 15_000 });
  await openLayerSettings(page);
  await expect(page.locator('#cctv_retry')).toBeVisible();
  releaseFirst();

  await page.locator('#cctv_retry').click();
  await expect.poll(() => cctvRequests).toBe(2);
  await selectExploreMode(page, 'wind');
  await selectExploreMode(page, 'road');
  await expect.poll(() => cctvRequests).toBe(3);
  await expect.poll(() => page.evaluate(() => {
    const feature = window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures()[0];
    return feature && feature.get('cctv').name;
  })).toBe('최신 CCTV');
  releaseSecond();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => {
    const feature = window.WEATHER_GRID_CCTV.layer.getSource().getSource().getFeatures()[0];
    return feature && feature.get('cctv').name;
  })).toBe('최신 CCTV');

  await page.locator('#map').focus();
  await page.locator('#map').press('Enter');
  await expect(page.locator('#cctv_popup')).not.toHaveAttribute('hidden', '');
  await page.locator('#cctv_play').click();
  await expect(page.locator('#cctv_media_status')).toContainText('시간이 초과', { timeout: 15_000 });
  await expect(page.locator('#cctv_play')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__hlsDestroyed)).toBe(1);

  await page.evaluate(() => { window.__manifestReady = true; });
  await page.locator('#cctv_play').click();
  await expect(page.locator('#cctv_media')).toHaveAttribute('data-state', 'playing');
  await expect.poll(() => page.evaluate(() => window.__hlsLoadedUrls.length)).toBe(2);
  await page.locator('#cctv_popup_close').click();
  await expect.poll(() => page.evaluate(() => window.__hlsDestroyed)).toBe(2);
});
