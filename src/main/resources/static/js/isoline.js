/**
 * 마지막 기상 격자 응답을 등치선 피처로 바꾸는 OpenLayers 어댑터.
 * 선 추출·스무딩은 WeatherGridIsolineState, 좌표 계산은 WeatherGridDfsProjection이 맡는다.
 */
(function () {
    'use strict';

    var contourState = window.WeatherGridIsolineState;
    var dfsProjection = window.WeatherGridDfsProjection;
    if (!contourState || !dfsProjection || !window.ol) {
        throw new Error('Isoline state, DFS projection and OpenLayers must load before isoline');
    }

    var renderedResult = null;
    var renderedProjection = null;
    var renderedElement = null;
    var renderedMonth = null;
    var isoLayer = null;
    var isoStyleMode = 'dark';
    var isoStyleCache = new Map();
    var ISO_STYLE_CACHE_LIMIT = 32;

    var isoStylePrimitives = {
        light: {
            stroke: new ol.style.Stroke({ color: 'rgba(30,41,59,0.82)', width: 1.3 }),
            fill: new ol.style.Fill({ color: 'rgba(30,41,59,0.82)' }),
            halo: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 3 })
        },
        dark: {
            stroke: new ol.style.Stroke({ color: 'rgba(165,205,255,0.92)', width: 1.3 }),
            fill: new ol.style.Fill({ color: 'rgba(165,205,255,0.92)' }),
            halo: new ol.style.Stroke({ color: 'rgba(5,10,20,0.85)', width: 3 })
        }
    };

    /** 거리지도는 테마와 관계없이 밝은 바탕이므로 어두운 선을 쓴다. */
    function resolveIsoStyleMode() {
        return document.documentElement.getAttribute('data-theme') === 'light'
            || !!document.querySelector('#basemap_streets.is-selected-basemap') ? 'light' : 'dark';
    }

    function refreshIsoStyleMode() {
        isoStyleMode = resolveIsoStyleMode();
        if (isoLayer) isoLayer.changed();
    }

    function styleFor(feature) {
        var level = feature.get('level');
        var label = String(Math.round(level * 10) / 10);
        var coordinates = feature.getGeometry().getCoordinates();
        var showLabel = coordinates.length >= 3;
        var key = isoStyleMode + ':' + label + ':' + (showLabel ? 'label' : 'line');
        var cached = isoStyleCache.get(key);
        if (cached) return cached;

        if (isoStyleCache.size >= ISO_STYLE_CACHE_LIMIT) isoStyleCache.clear();
        var primitives = isoStylePrimitives[isoStyleMode];
        var options = { stroke: primitives.stroke };
        // 한 셀짜리 열린 선은 유지하되 숫자가 선보다 길어지는 경우에는 라벨만 생략한다.
        if (showLabel) {
            options.text = new ol.style.Text({
                text: label,
                font: '700 11px system-ui, sans-serif',
                placement: 'line',
                repeat: 320,
                fill: primitives.fill,
                stroke: primitives.halo,
                overflow: false
            });
        }
        cached = new ol.style.Style(options);
        isoStyleCache.set(key, cached);
        return cached;
    }

    function ensureLayer() {
        if (isoLayer) return isoLayer;
        isoLayer = new ol.layer.Vector({
            title: 'isoline',
            source: new ol.source.Vector(),
            declutter: true,
            zIndex: 85,
            visible: false,
            style: styleFor
        });
        weatherMap.addLayer(isoLayer);
        isoStyleMode = resolveIsoStyleMode();

        new MutationObserver(refreshIsoStyleMode)
            .observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme']
            });
        var choices = document.getElementById('basemap_choices');
        if (choices) {
            new MutationObserver(refreshIsoStyleMode)
                .observe(choices, {
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['class']
                });
        }
        return isoLayer;
    }

    function solarThresholdsFor(selectedMonth) {
        if (typeof monthlySolarThresholds === 'undefined' || !monthlySolarThresholds) return [];
        return monthlySolarThresholds[selectedMonth]
            || monthlySolarThresholds['07']
            || [];
    }

    function rawSampler(result, element) {
        return function (column, southRow) {
            var value = result.data[(result.ny - 1 - southRow) * result.nx + column];
            if (window.WEATHER_GRID_WEATHER_VALUE_VALID) {
                return window.WEATHER_GRID_WEATHER_VALUE_VALID(element, value) ? value : NaN;
            }
            return Number.isFinite(value) && value > -900 && value < 9000 ? value : NaN;
        };
    }

    function transformGridLine(line, result, viewProjection) {
        var step = Number(result.step) || 1;
        return contourState.smoothLine(line).map(function (point) {
            var gridX = result.nxMin + point[0] * step;
            var gridY = result.nyMin + point[1] * step;
            var coordinate = dfsProjection.gridToProjected(gridX, gridY);
            return viewProjection === dfsProjection.code
                ? coordinate
                : ol.proj.transform(coordinate, dfsProjection.code, viewProjection);
        });
    }

    /** 자료·요소·도법이 달라졌을 때만 피처를 다시 만든다. */
    function rebuild() {
        var result = window.lastGridResult;
        var layer = ensureLayer();
        var source = layer.getSource();
        var element = window.lastGridElement || 'wdws';
        var viewProjection = window.WEATHER_GRID_VIEW_PROJ || dfsProjection.code;
        var selectedMonth = element === 'swdn' && typeof month !== 'undefined' ? month : null;
        if (renderedResult === result
                && renderedProjection === viewProjection
                && renderedElement === element
                && renderedMonth === selectedMonth) return;

        source.clear(true);
        renderedResult = result;
        renderedProjection = viewProjection;
        renderedElement = element;
        renderedMonth = selectedMonth;
        if (!contourState.validGridResult(result)) return;

        var sampler = contourState.smoothField(
            rawSampler(result, element),
            result.nx,
            result.ny,
            contourState.smoothingPasses(element)
        );
        var levels = contourState.levelsFor(
            element,
            element === 'swdn' ? solarThresholdsFor(selectedMonth || '07') : []
        );
        var features = [];
        levels.forEach(function (level) {
            contourState.isolinesForLevel(sampler, result.nx, result.ny, level)
                .forEach(function (line) {
                    var coordinates = transformGridLine(line, result, viewProjection);
                    if (coordinates.length < 2) return;
                    var feature = new ol.Feature(new ol.geom.LineString(coordinates));
                    feature.set('level', level);
                    features.push(feature);
                });
        });
        source.addFeatures(features);
    }

    window.WEATHER_GRID_ISO = Object.freeze({
        show: function () {
            var element = window.lastGridElement
                || (document.getElementById('element') || {}).value
                || 'wdws';
            var meta = window.WEATHER_GRID_WEATHER_ELEMENTS
                && window.WEATHER_GRID_WEATHER_ELEMENTS[element];
            if (meta && meta.isoline === false) {
                if (isoLayer) isoLayer.setVisible(false);
                return;
            }
            rebuild();
            ensureLayer().setVisible(true);
        },
        hide: function () {
            if (isoLayer) isoLayer.setVisible(false);
        },
        refresh: function () {
            if (isoLayer && isoLayer.getVisible()) rebuild();
        }
    });
}());
