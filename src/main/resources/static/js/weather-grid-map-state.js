/**
 * 지도 도법 전환과 포인터 격자 표본의 결정 규칙을 브라우저 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridMapState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var PROJECTIONS = Object.freeze(['KMA_GRID_LCC', 'EPSG:3857', 'EPSG:4326']);

    function projectionTransition(currentCode, requestedCode) {
        var accepted = PROJECTIONS.indexOf(requestedCode) >= 0;
        var code = accepted ? requestedCode : currentCode;
        return Object.freeze({
            accepted: accepted,
            changed: accepted && code !== currentCode,
            previousCode: currentCode,
            code: code
        });
    }

    function viewLimits(fittedZoom, hazardActive) {
        var baseZoom = Number.isFinite(fittedZoom) ? Math.floor(fittedZoom) : 0;
        return Object.freeze({
            minZoom: hazardActive ? 2.5 : baseZoom,
            maxZoom: baseZoom + 5
        });
    }

    function outsideSample() {
        return Object.freeze({ inside: false, column: -1, rowFromSouth: -1, index: -1, value: null });
    }

    function sampleGrid(grid, fractionalGrid) {
        var gridData = grid && grid.data;
        var supportedData = Array.isArray(gridData)
            || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(gridData));
        if (!grid || !fractionalGrid || !supportedData
                || !Number.isInteger(grid.nx) || grid.nx <= 0
                || !Number.isInteger(grid.ny) || grid.ny <= 0
                || gridData.length !== grid.nx * grid.ny
                || !Number.isFinite(grid.nxMin) || !Number.isFinite(grid.nyMin)) {
            return outsideSample();
        }
        var step = Number(grid.step) || 1;
        if (step <= 0 || !Number.isFinite(fractionalGrid.x) || !Number.isFinite(fractionalGrid.y)) {
            return outsideSample();
        }
        var column = Math.round((fractionalGrid.x - grid.nxMin) / step);
        var rowFromSouth = Math.round((fractionalGrid.y - grid.nyMin) / step);
        if (column < 0 || column >= grid.nx || rowFromSouth < 0 || rowFromSouth >= grid.ny) {
            return outsideSample();
        }
        var index = (grid.ny - 1 - rowFromSouth) * grid.nx + column;
        if (index < 0 || index >= grid.data.length) return outsideSample();
        return Object.freeze({
            inside: true,
            column: column,
            rowFromSouth: rowFromSouth,
            index: index,
            value: grid.data[index]
        });
    }

    function readoutText(latitude, longitude, valueText) {
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        var coordinateText = latitude.toFixed(3) + '°N ' + longitude.toFixed(3) + '°E';
        var value = String(valueText == null ? '—' : valueText);
        return Object.freeze({
            coordinateText: coordinateText,
            valueText: value,
            accessibleText: coordinateText + ', 격자값 ' + value
        });
    }

    return Object.freeze({
        projections: PROJECTIONS,
        projectionTransition: projectionTransition,
        viewLimits: viewLimits,
        sampleGrid: sampleGrid,
        readoutText: readoutText
    });
}));
