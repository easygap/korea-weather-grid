/**
 * 포인터 위치의 위경도와 현재 격자값을 안전한 텍스트 노드로 표시한다.
 */
(function () {
    'use strict';

    var stateModel = window.WeatherGridMapState;
    var runtime = window.WeatherGridMapRuntime;
    if (!stateModel || !runtime) throw new Error('Map state and runtime must load before weather-grid-readout');

    var workspace = document.querySelector('.map_workspace');
    if (!workspace) return;
    var map = runtime.map;
    var node = document.createElement('div');
    node.id = 'cursor_readout';
    node.style.display = 'none';
    workspace.appendChild(node);
    var lastMoveAt = 0;
    var currentSample = null;

    function hide() {
        currentSample = null;
        node.style.display = 'none';
        node.removeAttribute('aria-label');
    }

    function formatValue(element, value) {
        if (window.WEATHER_GRID_WEATHER_VALUE_TEXT) {
            return window.WEATHER_GRID_WEATHER_VALUE_TEXT(element, value);
        }
        return !Number.isFinite(value) || value <= -900 || value >= 9000
            ? '—' : Math.round(value * 10) / 10;
    }

    function show(latitude, longitude, sample, element) {
        var label = stateModel.readoutText(
            latitude, longitude, formatValue(element, sample.value));
        if (!label) { hide(); return; }
        var value = document.createElement('b');
        value.textContent = label.valueText;
        node.replaceChildren(document.createTextNode(label.coordinateText), value);
        node.setAttribute('aria-label', label.accessibleText);
        node.style.display = 'block';
        currentSample = Object.freeze({
            latitude: latitude,
            longitude: longitude,
            element: element,
            grid: sample,
            label: label
        });
    }

    map.on('pointermove', function (event) {
        var now = Date.now();
        if (now - lastMoveAt < 60) return;
        lastMoveAt = now;
        var grid = window.lastGridResult;
        if (!grid || event.dragging) { hide(); return; }
        try {
            var longitudeLatitude = ol.proj.transform(
                event.coordinate, map.getView().getProjection(), 'EPSG:4326');
            var fractional = runtime.gridCoordinate(longitudeLatitude[1], longitudeLatitude[0]);
            var sample = stateModel.sampleGrid(grid, { x: fractional[0], y: fractional[1] });
            if (!sample.inside) { hide(); return; }
            show(longitudeLatitude[1], longitudeLatitude[0], sample, window.lastGridElement);
        } catch (error) {
            hide();
        }
    });

    document.addEventListener('weather-grid:projection-changing', hide);
    document.addEventListener('weather-grid:metric-selected', hide);

    window.WeatherGridReadout = Object.freeze({
        hide: hide,
        current: function () { return currentSample; }
    });
}());
