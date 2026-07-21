const { test, expect } = require('@playwright/test');

test('map data loads from the declared GeoJSON assets', async ({ page }) => {
    const requestedPaths = [];
    page.on('request', (request) => requestedPaths.push(new URL(request.url()).pathname));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WeatherGridGeodata
        && window.WeatherGridGeodata.has('eastAsiaLand')
        && window.WeatherGridGeodata.has('koreaAdmin1'));

    const initial = await page.evaluate(() => ({
        land: weatherBasemapLayer.getSource().getFeatures().length,
        stations: stationVectorLayer.getSource().getFeatures().length,
        adminLoaded: window.WeatherGridGeodata.has('koreaAdmin1')
    }));
    expect(initial).toEqual({ land: 9, stations: 17, adminLoaded: true });
    await expect(page.locator('#weather_stations')).toHaveText('대표 지역 표시');
    expect(requestedPaths.some((pathname) => pathname.endsWith('/east-asia-land.geojson'))).toBe(true);
    expect(requestedPaths.some((pathname) => pathname.endsWith('/korea-admin1.geojson'))).toBe(true);

    await page.locator('#dock_toggle').click();
    await page.locator('#map_display_settings > summary').click();
    await page.locator('#basemap_boundaries').click();
    await page.waitForFunction(() => window.WeatherGridGeodata.has('koreaAdmin1')
        && provinceBoundaryLayer.getSource().getFeatures().length === 17);

    const admin = await page.evaluate(() => ({
        features: provinceBoundaryLayer.getSource().getFeatures().length,
        names: provinceBoundaryLayer.getSource().getFeatures().map((feature) => feature.get('nameKo')).sort(),
        visible: provinceBoundaryLayer.getVisible()
    }));
    expect(admin.features).toBe(17);
    expect(admin.names).toContain('세종특별자치시');
    expect(admin.names).toContain('강원특별자치도');
    expect(admin.names).toContain('전북특별자치도');
    expect(admin.visible).toBe(true);
    expect(requestedPaths.filter((pathname) => pathname.endsWith('/korea-admin1.geojson'))).toHaveLength(1);
});

test('3D view loads the cartographic boundary before building terrain and globe scenes', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lastGridResult && window.WeatherGridGeodata.has('eastAsiaLand'));
    expect(await page.evaluate(() => window.WeatherGridGeodata.has('koreaAdmin1'))).toBe(true);

    await page.locator('#btn_3d').click();
    await expect(page.locator('#view3d')).toHaveClass(/open/);
    await page.waitForFunction(() => window.WeatherGridGeodata.has('koreaAdmin1'));
    await expect(page.locator('#view3d canvas')).toBeVisible();

    await page.locator('.view3d_modes button[data-mode="globe"]').click();
    await expect(page.locator('#view3d_title')).toContainText('지구본');
    expect(await page.evaluate(() => window.WeatherGridGeodata.peek('koreaAdmin1').features.length)).toBe(17);

    await page.locator('#view3d_close').click();
    await expect(page.locator('#view3d')).not.toHaveClass(/open/);
});
