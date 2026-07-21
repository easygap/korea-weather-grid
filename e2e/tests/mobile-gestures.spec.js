const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

async function dispatchTouch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point, index) => ({
      x: point.x,
      y: point.y,
      id: index,
      radiusX: 2,
      radiusY: 2,
      force: 0.5
    }))
  });
}

async function pinch(client, center, startGap, endGap, steps = 8) {
  const pointsAt = (gap) => [
    { x: center.x - gap / 2, y: center.y },
    { x: center.x + gap / 2, y: center.y }
  ];
  await dispatchTouch(client, 'touchStart', pointsAt(startGap));
  for (let index = 1; index <= steps; index += 1) {
    const gap = startGap + (endGap - startGap) * index / steps;
    await dispatchTouch(client, 'touchMove', pointsAt(gap));
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
  await dispatchTouch(client, 'touchEnd', []);
}

async function twist(client, center, radius, endAngle, steps = 10) {
  const pointsAt = (angle) => [
    {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    },
    {
      x: center.x - Math.cos(angle) * radius,
      y: center.y - Math.sin(angle) * radius
    }
  ];
  await dispatchTouch(client, 'touchStart', pointsAt(0));
  for (let index = 1; index <= steps; index += 1) {
    await dispatchTouch(client, 'touchMove', pointsAt(endAngle * index / steps));
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
  await dispatchTouch(client, 'touchEnd', []);
}

async function dragTouch(client, from, to, steps = 6) {
  await dispatchTouch(client, 'touchStart', [from]);
  for (let index = 1; index <= steps; index += 1) {
    await dispatchTouch(client, 'touchMove', [{
      x: from.x + (to.x - from.x) * index / steps,
      y: from.y + (to.y - from.y) * index / steps
    }]);
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
  await dispatchTouch(client, 'touchEnd', []);
}

async function openMobilePage(browser) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 659 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.lastGridResult && typeof weatherMap !== 'undefined');
  return { context, page };
}

function longitudeDistance(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

test.describe('모바일 지도 제스처', () => {
  test.setTimeout(120000);

  test('2D 지도 핀치 줌은 페이지 확대 없이 지도를 부드럽게 확대한다', async ({ browser }) => {
    const { context, page } = await openMobilePage(browser);
    const client = await context.newCDPSession(page);
    try {
      const before = await page.evaluate(() => ({
        zoom: weatherMap.getView().getZoom(),
        pageScale: window.visualViewport ? window.visualViewport.scale : 1,
        touchAction: getComputedStyle(weatherMap.getViewport()).touchAction
      }));

      await pinch(client, { x: 196, y: 310 }, 44, 164);
      await page.waitForTimeout(500);

      const after = await page.evaluate(() => ({
        zoom: weatherMap.getView().getZoom(),
        pageScale: window.visualViewport ? window.visualViewport.scale : 1,
        touchAction: getComputedStyle(weatherMap.getViewport()).touchAction
      }));

      expect(after.touchAction).toBe('none');
      expect(after.zoom - before.zoom).toBeGreaterThan(0.7);
      expect(after.zoom - before.zoom).toBeLessThan(3.5);
      expect(after.pageScale).toBeCloseTo(before.pageScale, 3);
    } finally {
      await context.close();
    }
  });

  test('2D 지도 두 손가락 비틀기는 히트맵과 바람장을 회전시키지 않는다', async ({ browser }) => {
    const { context, page } = await openMobilePage(browser);
    const client = await context.newCDPSession(page);
    try {
      const before = await page.evaluate(() => weatherMap.getView().getRotation());
      await twist(client, { x: 196, y: 310 }, 58, Math.PI * 0.75);
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => weatherMap.getView().getRotation());

      expect(Math.abs(before)).toBeLessThan(0.0001);
      expect(Math.abs(after)).toBeLessThan(0.0001);
    } finally {
      await context.close();
    }
  });

  test('거리 측정 중에도 핀치 줌이 점을 추가하지 않고 조작부가 겹치지 않는다', async ({ browser }) => {
    const { context, page } = await openMobilePage(browser);
    const client = await context.newCDPSession(page);
    try {
      const toggle = page.locator('#distance_measure_toggle');
      await toggle.click();
      await expect(page.locator('#distance_measure_panel')).toBeVisible();

      for (const control of await page.locator(
        '#distance_measure_toggle, #distance_measure_close, .distance_measure_actions button'
      ).all()) {
        const box = await control.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }

      const layout = await page.evaluate(() => {
        const stack = document.getElementById('map_utility_stack').getBoundingClientRect();
        const timeline = document.querySelector('.timeline').getBoundingClientRect();
        const zoom = document.querySelector('.ol-zoom').getBoundingClientRect();
        return {
          stackBottom: stack.bottom,
          timelineTop: timeline.top,
          stackRight: stack.right,
          zoomLeft: zoom.left
        };
      });
      expect(layout.stackBottom).toBeLessThanOrEqual(layout.timelineTop);
      expect(layout.stackRight).toBeLessThanOrEqual(layout.zoomLeft);

      const before = await page.evaluate(() => ({
        zoom: weatherMap.getView().getZoom(),
        measure: window.WEATHER_GRID_MEASURE.getDiagnostics()
      }));
      await pinch(client, { x: 196, y: 205 }, 44, 144);
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({
        zoom: weatherMap.getView().getZoom(),
        measure: window.WEATHER_GRID_MEASURE.getDiagnostics()
      }));

      expect(after.zoom - before.zoom).toBeGreaterThan(0.5);
      expect(after.measure.vertexCount).toBe(0);
      expect(after.measure.drawing).toBe(false);

      await dispatchTouch(client, 'touchStart', [{ x: 120, y: 205 }]);
      await dispatchTouch(client, 'touchEnd', []);
      await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().vertexCount)).toBe(1);
      await dispatchTouch(client, 'touchStart', [{ x: 255, y: 205 }]);
      await dispatchTouch(client, 'touchEnd', []);
      await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().vertexCount)).toBe(2);
      await expect(page.locator('#distance_measure_finish')).toBeEnabled();
      await page.locator('#distance_measure_finish').click();
      await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_MEASURE.getDiagnostics().active)).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('3D 지구본의 짧은 한 손가락 드래그는 과도하게 회전하지 않는다', async ({ browser }) => {
    const { context, page } = await openMobilePage(browser);
    const client = await context.newCDPSession(page);
    try {
      await page.locator('#dock_toggle').click();
      await page.locator('#map_display_settings > summary').click();
      await page.locator('#btn_3d_dock').click();

      const view3d = page.locator('#view3d');
      const canvas = view3d.locator('canvas');
      await expect(view3d).toHaveClass(/\bopen\b/, { timeout: 15_000 });
      await expect(canvas).toBeVisible();
      await expect(canvas).toBeFocused();
      await expect.poll(() => page.evaluate(() => {
        if (!window.WEATHER_GRID_3D) return false;
        const size = window.WEATHER_GRID_3D.getDiagnostics().drawingBufferSize;
        return size[0] > 1 && size[1] > 1;
      })).toBe(true);

      await page.locator('.view3d_modes button[data-mode="globe"]').click();
      await expect(page.locator('#view3d_title')).toContainText('지구본');
      await expect.poll(() => page.evaluate(() => window.WEATHER_GRID_3D.getDiagnostics().mode)).toBe('globe');

      const bounds = await canvas.boundingBox();
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

      const readCenter = async () => {
        await page.mouse.move(center.x, center.y);
        await page.waitForFunction(() => /위도\s+-?\d/.test(document.getElementById('view3d_tip').textContent));
        return page.locator('#view3d_tip').evaluate((tip) => {
          const match = tip.textContent.match(/위도\s+(-?[\d.]+)°\s+·\s+경도\s+(-?[\d.]+)°/);
          return { lat: Number(match[1]), lon: Number(match[2]) };
        });
      };

      const before = await readCenter();
      await dragTouch(client, center, { x: center.x + 24, y: center.y });
      await page.waitForTimeout(350);
      const after = await readCenter();
      const rotation = longitudeDistance(after.lon, before.lon);

      expect(rotation).toBeGreaterThan(0.15);
      expect(rotation).toBeLessThan(2.5);
      expect(Math.abs(after.lat - before.lat)).toBeLessThan(2);
    } finally {
      await context.close();
    }
  });
});
