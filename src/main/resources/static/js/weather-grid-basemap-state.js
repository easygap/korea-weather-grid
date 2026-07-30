/**
 * 지도 생성 예산과 배경지도 UI 전이를 OpenLayers/DOM 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridBasemapState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MODES = Object.freeze(['weather', 'boundaries', 'streets']);
    var GEO_LIMIT = Object.freeze([116, 29, 140, 46]);
    var INITIAL_GEO = Object.freeze([123.9, 31.7, 132.4, 39.2]);
    var COMPACT_INITIAL_GEO = Object.freeze([123.8, 31.6, 132.5, 39.2]);
    var MAX_RENDER_PIXELS = 12000000;

    function frozenState(input) {
        return Object.freeze({
            mode: input.mode,
            regionLabels: Boolean(input.regionLabels),
            provinceBoundaries: Boolean(input.provinceBoundaries),
            stationsVisible: Boolean(input.stationsVisible)
        });
    }

    function initialState(compact) {
        return frozenState({
            mode: 'weather',
            regionLabels: true,
            provinceBoundaries: false,
            stationsVisible: !compact
        });
    }

    function selectMode(state, mode) {
        if (MODES.indexOf(mode) < 0) return state;
        return frozenState({
            mode: mode,
            regionLabels: mode === 'boundaries' ? true : state.regionLabels,
            provinceBoundaries: mode === 'boundaries' ? false : state.provinceBoundaries,
            stationsVisible: state.stationsVisible
        });
    }

    function toggleBoundary(state, kind) {
        if (kind !== 'labels' && kind !== 'provinces') return state;
        return frozenState({
            mode: state.mode,
            regionLabels: kind === 'labels' ? !state.regionLabels : state.regionLabels,
            provinceBoundaries: kind === 'provinces'
                ? !state.provinceBoundaries : state.provinceBoundaries,
            stationsVisible: state.stationsVisible
        });
    }

    function setStationsVisible(state, visible) {
        return frozenState({
            mode: state.mode,
            regionLabels: state.regionLabels,
            provinceBoundaries: state.provinceBoundaries,
            stationsVisible: Boolean(visible)
        });
    }

    function layerVisibility(mode) {
        var plan = {
            weather: { weather: true, boundaries: false, streets: false },
            boundaries: { weather: false, boundaries: true, streets: false },
            streets: { weather: false, boundaries: false, streets: true }
        }[mode];
        return plan ? Object.freeze(plan) : null;
    }

    function themePalette(theme) {
        return Object.freeze(theme === 'light' ? {
            land: '#ffffff',
            vectorLand: '#fbfaf2',
            coast: 'rgba(30, 100, 180, 0.55)',
            boundary: 'rgba(71, 85, 105, 0.45)',
            label: '#334155',
            halo: 'rgba(255, 255, 255, 0.92)'
        } : {
            // 배경지도는 데이터가 아니므로 무채색으로 둔다. 예전 시안 해안선은
            // 풍속 3~4 m/s(전체 격자의 약 40%) 색과 겹쳐 데이터와 배경이 섞였다.
            land: '#171B21',
            vectorLand: '#1C2128',
            coast: 'rgba(196, 206, 218, 0.34)',
            boundary: 'rgba(178, 188, 202, 0.26)',
            label: '#C3CAD3',
            halo: 'rgba(5, 7, 10, 0.90)'
        });
    }

    function stylePlan(state, theme) {
        var palette = themePalette(theme);
        return Object.freeze({
            mode: state.mode,
            palette: palette,
            weather: Object.freeze({ fill: palette.land, stroke: palette.coast }),
            vector: Object.freeze({ fill: palette.vectorLand, stroke: palette.boundary }),
            provinces: Object.freeze({
                stroke: state.provinceBoundaries ? palette.boundary : null,
                labelField: state.regionLabels ? 'nameKo' : null
            })
        });
    }

    function positiveNumber(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    function pixelRatio(input) {
        var viewportWidth = positiveNumber(input && input.viewportWidth, 1);
        var viewportHeight = positiveNumber(input && input.viewportHeight, 1);
        var screenWidth = positiveNumber(input && input.screenWidth, viewportWidth);
        var screenHeight = positiveNumber(input && input.screenHeight, viewportHeight);
        var deviceRatio = positiveNumber(input && input.devicePixelRatio, 1);
        var maxPixels = positiveNumber(input && input.maxPixels, MAX_RENDER_PIXELS);
        var viewportPixels = Math.max(1, viewportWidth * viewportHeight);
        var screenPixels = Math.max(1, screenWidth * screenHeight);
        var cssPixels = Math.max(viewportPixels, screenPixels);
        var budgetRatio = Math.sqrt(maxPixels / cssPixels) * 0.995;
        return Math.min(deviceRatio, budgetRatio);
    }

    function initialGeoExtent(compact) {
        return (compact ? COMPACT_INITIAL_GEO : INITIAL_GEO).slice();
    }

    function initialPadding(viewportWidth) {
        var width = positiveNumber(viewportWidth, 1);
        if (width <= 360) return [108, 12, 104, 12];
        if (width <= 640) return [64, 16, 96, 16];
        if (width <= 900) return [116, 20, 100, 20];
        return [84, 160, 92, 292];
    }

    return Object.freeze({
        modes: MODES,
        geographicLimit: GEO_LIMIT,
        maxRenderPixels: MAX_RENDER_PIXELS,
        initialState: initialState,
        selectMode: selectMode,
        toggleBoundary: toggleBoundary,
        setStationsVisible: setStationsVisible,
        layerVisibility: layerVisibility,
        themePalette: themePalette,
        stylePlan: stylePlan,
        pixelRatio: pixelRatio,
        initialGeoExtent: initialGeoExtent,
        initialPadding: initialPadding
    });
}));
