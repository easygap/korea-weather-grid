const { test, expect } = require('@playwright/test');

const BASE = process.env.WEATHER_GRID_BASE || 'http://localhost:8090';

test.describe('출시 안전 장치', () => {
  test('고도 UI는 지원값만 노출하고 알 수 없는 딥링크를 정규화한다', async ({ page }) => {
    const requestedHeights = [];
    await page.route('**/api/weather/grid?**', async (route) => {
      requestedHeights.push(new URL(route.request().url()).searchParams.get('height'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [1], nx: 1, ny: 1, nxMin: 60, nyMin: 127, step: 1,
          stats: { min: 1, avg: 1, max: 1 }
        })
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/#e=wdws&h=unsupported', { waitUntil: 'domcontentloaded' });
    await page.locator('#dock_toggle').click();
    await page.locator('#map_display_settings > summary').click();

    await expect(page.locator('#height')).toHaveValue('10m');
    await expect(page.locator('#height option')).toHaveCount(1);

    await expect.poll(() => requestedHeights.length).toBeGreaterThan(0);
    expect(requestedHeights.every((height) => height === '10m')).toBe(true);
    await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get('h')).toBe('10m');
  });
});
