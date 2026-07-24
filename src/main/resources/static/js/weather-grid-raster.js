/**
 * 순수 래스터 상태를 OpenLayers ImageCanvas와 연결한다.
 * 화면 좌표 LUT만 재사용하고 현재 기상값과 색상은 렌더링마다 다시 읽는다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridRasterState;
    var MapRuntime = window.WeatherGridMapRuntime;
    var WindGrid = window.WeatherGridWindGrid;
    if (!State || !MapRuntime || !WindGrid || !window.ol) {
        throw new Error('Raster state, map runtime, wind grid and OpenLayers must load before weather-grid-raster');
    }

    var lookupCache = null;
    var lookupHits = 0;
    var lookupMisses = 0;

    function currentTheme() {
        var explicitTheme = document.documentElement.getAttribute('data-theme');
        if (explicitTheme) return explicitTheme;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'system-light' : 'system-dark';
    }

    function lookupKey(extent, resolution, pixelRatio, size, projection,
            viewProjectionCode, nxMin, nyMin, step, nx, ny, sampleWidth, sampleHeight) {
        var projectionCode = projection && typeof projection.getCode === 'function'
            ? projection.getCode() : viewProjectionCode;
        return State.lookupKey({
            projectionCode: projectionCode,
            viewProjectionCode: viewProjectionCode,
            extent: extent,
            resolution: resolution,
            pixelRatio: pixelRatio,
            devicePixelRatio: window.devicePixelRatio || 1,
            size: size,
            sampleWidth: sampleWidth,
            sampleHeight: sampleHeight,
            nxMin: nxMin,
            nyMin: nyMin,
            step: step,
            nx: nx,
            ny: ny,
            theme: currentTheme()
        });
    }

    function diagnostics() {
        return Object.freeze({
            hits: lookupHits,
            misses: lookupMisses,
            sampleCount: lookupCache ? lookupCache.dataIndices.length : 0
        });
    }

    function categoricalElement(element) {
        var metadata = window.WEATHER_GRID_WEATHER_ELEMENTS
            && window.WEATHER_GRID_WEATHER_ELEMENTS[element];
        return Boolean(metadata && metadata.categorical);
    }

    function writeSummary(element, data) {
        var validValue = window.WEATHER_GRID_WEATHER_VALUE_VALID;
        if (typeof validValue !== 'function') return;
        var summary = State.summarize(data, function (value) {
            return validValue(element, value);
        }, categoricalElement(element));
        var targets = [
            ['grid_stat_min', '최소', summary.min],
            ['grid_stat_avg', '평균', summary.avg],
            ['grid_stat_max', '최대', summary.max]
        ];
        targets.forEach(function (target) {
            var node = document.getElementById(target[0]);
            if (!node) return;
            if (summary.kind === 'categorical') {
                node.textContent = '—';
                return;
            }
            node.textContent = '· ' + target[1] + ' : '
                + target[2].toFixed(target[2] === 0 ? 0 : 1);
        });
    }

    function colorReader(element, selectedMonth) {
        var colorFor = window.WEATHER_GRID_WEATHER_COLOR;
        var validValue = window.WEATHER_GRID_WEATHER_VALUE_VALID;
        var colors = Object.create(null);
        return function (value) {
            if (typeof validValue !== 'function' || !validValue(element, value)
                    || typeof colorFor !== 'function') return State.parseCssColor('transparent');
            var cssColor = colorFor(element, value, selectedMonth);
            if (!colors[cssColor]) colors[cssColor] = State.parseCssColor(cssColor);
            return colors[cssColor];
        };
    }

    function createLookup(key, extent, plan, grid, toLonLat) {
        var dataIndices = new Int32Array(plan.sampleCount);
        var edgeAlpha = new Uint8Array(plan.sampleCount);
        dataIndices.fill(-1);
        var spanX = extent[2] - extent[0];
        var spanY = extent[3] - extent[1];

        for (var y = 0; y < plan.sampleHeight; y += 1) {
            var mapY = extent[3] - ((y + 0.5) / plan.sampleHeight) * spanY;
            for (var x = 0; x < plan.sampleWidth; x += 1) {
                var sampleIndex = y * plan.sampleWidth + x;
                var mapX = extent[0] + ((x + 0.5) / plan.sampleWidth) * spanX;
                var lonLat = toLonLat([mapX, mapY]);
                var fractional = MapRuntime.gridCoordinate(lonLat[1], lonLat[0]);
                var gridX = (fractional[0] - grid.nxMin) / grid.step;
                var gridSouthY = (fractional[1] - grid.nyMin) / grid.step;
                var dataIndex = State.cellIndex(gridX, gridSouthY, grid.nx, grid.ny);
                if (dataIndex < 0) continue;
                dataIndices[sampleIndex] = dataIndex;
                edgeAlpha[sampleIndex] = Math.round(
                    WindGrid.edgeOpacityAt(gridX, gridSouthY, grid.nx, grid.ny) * 255
                );
            }
        }
        return { key: key, dataIndices: dataIndices, edgeAlpha: edgeAlpha };
    }

    function render(result, request) {
        result = result || {};
        request = request || {};
        var data = result.data;
        if (!Array.isArray(data) || !Number.isInteger(result.nx) || !Number.isInteger(result.ny)) {
            return false;
        }
        var element = request.element;
        var selectedMonth = /^\d{8}$/.test(request.baseDate || '')
            ? request.baseDate.substring(4, 6) : '01';
        var step = Number.isFinite(result.step) && result.step > 0 ? result.step : 1;
        var grid = Object.freeze({
            nxMin: result.nxMin,
            nyMin: result.nyMin,
            step: step,
            nx: result.nx,
            ny: result.ny
        });
        var viewProjectionCode = window.WEATHER_GRID_VIEW_PROJ
            || MapRuntime.map.getView().getProjection().getCode();
        var readColor = colorReader(element, selectedMonth);
        var layer = MapRuntime.weatherLayer();
        writeSummary(element, data);

        function canvasFunction(extent, resolution, pixelRatio, size, projection) {
            var plan = State.samplePlan(size[0], size[1]);
            if (!plan) return document.createElement('canvas');
            var canvas = document.createElement('canvas');
            canvas.width = plan.width;
            canvas.height = plan.height;
            var context = canvas.getContext('2d');
            var sampleCanvas = document.createElement('canvas');
            sampleCanvas.width = plan.sampleWidth;
            sampleCanvas.height = plan.sampleHeight;
            var sampleContext = sampleCanvas.getContext('2d');
            var pixels = sampleContext.createImageData(plan.sampleWidth, plan.sampleHeight);
            var key = lookupKey(extent, resolution, pixelRatio, size, projection,
                viewProjectionCode, grid.nxMin, grid.nyMin, grid.step, grid.nx, grid.ny,
                plan.sampleWidth, plan.sampleHeight);
            var lookup = lookupCache;
            if (!lookup || lookup.key !== key) {
                lookup = createLookup(key, extent, plan, grid, function (coordinate) {
                    return MapRuntime.toGeographic(coordinate, viewProjectionCode);
                });
                lookupCache = lookup;
                lookupMisses += 1;
            } else {
                lookupHits += 1;
            }

            for (var index = 0; index < lookup.dataIndices.length; index += 1) {
                var dataIndex = lookup.dataIndices[index];
                if (dataIndex < 0) continue;
                var color = readColor(data[dataIndex]);
                var offset = index * 4;
                pixels.data[offset] = color[0];
                pixels.data[offset + 1] = color[1];
                pixels.data[offset + 2] = color[2];
                pixels.data[offset + 3] = Math.round(color[3] * lookup.edgeAlpha[index] / 255);
            }
            sampleContext.putImageData(pixels, 0, 0);
            context.imageSmoothingEnabled = false;
            context.drawImage(sampleCanvas, 0, 0, plan.width, plan.height);
            return canvas;
        }

        layer.setSource(new window.ol.source.ImageCanvas({
            canvasFunction: canvasFunction,
            projection: viewProjectionCode,
            ratio: 1
        }));
        return true;
    }

    function clear() {
        MapRuntime.weatherLayer().setSource(null);
    }

    window.getGridRenderLookupCacheStats = diagnostics;
    window.gridRenderLookupKey = lookupKey;
    window.WeatherGridRaster = Object.freeze({
        render: render,
        clear: clear,
        diagnostics: diagnostics,
        lookupKey: lookupKey
    });
}(window, document));
