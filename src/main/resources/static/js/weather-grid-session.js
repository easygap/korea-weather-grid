/**
 * 검증된 공유 URL을 화면 세션에 복원하고 이후 상태를 같은 주소 계약으로 기록한다.
 */
(function (window, document) {
    'use strict';

    var Navigation = window.WeatherGridNavigation;
    var Controls = window.WeatherGridControls;
    var Readout = window.WeatherGridReadout;
    var Explore = window.WeatherGridExplore;
    var Layers = window.WeatherGridLayers;
    var Runs = window.WeatherGridRuns;
    var Timeline = window.WeatherGridTimeline;
    var MapRuntime = window.WeatherGridMapRuntime;
    if (!Navigation || !Controls || !Readout || !Explore || !Layers || !Runs || !Timeline || !MapRuntime) {
        throw new Error('Navigation, controls, readout, explore, layers, runs and timeline must load first');
    }

    var metricControls = Controls.metrics;
    var restoring = false;
    var skipInitialFetch = Navigation.hasInitialHash;

    function elementValue(id, fallback) {
        var element = document.getElementById(id);
        return element ? element.value : fallback;
    }

    function normalizeHeight() {
        var select = document.getElementById('height');
        if (!select || select.value === '10m') return false;
        select.value = '10m';
        return true;
    }

    function airMode() {
        return window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.getMode
            ? window.WEATHER_GRID_AIR_QUALITY.getMode() : 'off';
    }

    function cctvEnabled() {
        return Boolean(window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.isEnabled
            && window.WEATHER_GRID_CCTV.isEnabled());
    }

    function viewSnapshot() {
        var view = MapRuntime.map.getView();
        var center = view.getCenter();
        var geographic = center && MapRuntime.toGeographic(center, view.getProjection().getCode());
        var zoom = view.getZoom();
        if (!Array.isArray(geographic) || !geographic.every(Number.isFinite) || !Number.isFinite(zoom)) return null;
        return Object.freeze({
            latitude: geographic[1],
            longitude: geographic[0],
            zoom: zoom
        });
    }

    function snapshot() {
        normalizeHeight();
        var hazards = Explore.hazards();
        return Object.freeze({
            element: elementValue('element', 'wdws'),
            height: '10m',
            date: elementValue('forecast_date', ''),
            baseTime: elementValue('baseTime', '02'),
            forecastHour: Timeline.currentHour(),
            projection: window.WEATHER_GRID_VIEW_PROJ,
            view: viewSnapshot(),
            layers: Layers.snapshot(),
            air: airMode(),
            cctv: cctvEnabled(),
            hazards: Object.freeze({
                typhoon: Boolean(hazards.typhoon),
                lightning: Boolean(hazards.lightning),
                lightningMinutes: hazards.lightningMinutes
            })
        });
    }

    function updateHash() {
        if (restoring) return null;
        try { return Navigation.replace(snapshot()); }
        catch (error) { return null; }
    }
    window.WEATHER_GRID_UPDATE_HASH = updateHash;

    var originalRefresh = window.refreshWeatherGrid || window.WEATHER_GRID_REFRESH_GRID;
    if (typeof originalRefresh !== 'function') {
        throw new Error('Weather grid refresh entry point must load before weather-grid-session');
    }

    function refresh() {
        if (skipInitialFetch) {
            skipInitialFetch = false;
            return false;
        }
        if (restoring) return false;
        normalizeHeight();
        Readout.hide();
        originalRefresh();
        updateHash();
        return true;
    }
    window.refreshWeatherGrid = refresh;
    window.WEATHER_GRID_REFRESH_GRID = refresh;
    normalizeHeight();

    function restoreEnvironment(restored) {
        if (restored.air !== 'off' && window.WEATHER_GRID_AIR_QUALITY) {
            window.WEATHER_GRID_AIR_QUALITY.setMode(restored.air);
        }
        if (restored.cctv && window.WEATHER_GRID_CCTV) {
            window.WEATHER_GRID_CCTV.setEnabled(true);
        }
        if (!window.WEATHER_GRID_SEVERE_WEATHER) return;
        if (restored.hazards.lightning) {
            window.WEATHER_GRID_SEVERE_WEATHER.setLightningWindow(restored.hazards.lightningMinutes);
        }
        window.WEATHER_GRID_SEVERE_WEATHER.setLayers({
            typhoon: restored.hazards.typhoon,
            lightning: restored.hazards.lightning
        });
    }

    function restoreView(viewState) {
        if (!viewState) return false;
        var view = MapRuntime.map.getView();
        var center = MapRuntime.fromGeographic(
            [viewState.longitude, viewState.latitude], view.getProjection().getCode());
        if (!Array.isArray(center) || !center.every(Number.isFinite)) return false;
        view.setCenter(center);
        view.setZoom(Math.max(view.getMinZoom(), Math.min(view.getMaxZoom(), viewState.zoom)));
        return true;
    }

    function restoreInitialState() {
        if (!Navigation.hasInitialHash) return;
        var restored = Navigation.readInitial({
            element: elementValue('element', 'wdws'),
            date: elementValue('forecast_date', window.todayStr || ''),
            latestDate: window.todayStr,
            baseTime: elementValue('baseTime', window.time || '02'),
            latestTime: window.time,
            forecastHour: Timeline.currentHour(),
            projection: window.WEATHER_GRID_VIEW_PROJ,
            layers: Layers.snapshot(),
            metadata: window.WEATHER_GRID_WEATHER_ELEMENTS
        });
        if (!restored) {
            refresh();
            return;
        }

        restoring = true;
        try {
            var metricSelect = document.getElementById('element');
            if (metricSelect && restored.element !== metricSelect.value) {
                metricSelect.value = restored.element;
                metricSelect.dispatchEvent(new Event('change', { bubbles: true }));
                metricControls.sync(restored.element);
                metricControls.remember(restored.element, true);
            }
            Runs.restore(restored.date, restored.baseTime);
            if (restored.forecastHour !== Timeline.currentHour()) {
                Timeline.restore(restored.forecastHour);
            }
            Layers.replace(restored.layers, {
                metric: restored.element,
                apply: false,
                notify: false,
                updateHash: false
            });
            restoreEnvironment(restored);
            Explore.sync();
        } finally {
            restoring = false;
        }

        var projectionChanged = restored.projection !== window.WEATHER_GRID_VIEW_PROJ;
        if (projectionChanged) {
            Navigation.projection.request(restored.projection, 'deep-link');
        } else {
            Navigation.projection.sync(restored.projection);
        }
        restoreView(restored.view);
        if (!projectionChanged) refresh();
        updateHash();
    }

    if (document.readyState === 'complete') restoreInitialState();
    else document.addEventListener('DOMContentLoaded', restoreInitialState, { once: true });

    var viewUpdateTimer = 0;
    MapRuntime.map.on('moveend', function () {
        window.clearTimeout(viewUpdateTimer);
        viewUpdateTimer = window.setTimeout(updateHash, 120);
    });

    window.WeatherGridSession = Object.freeze({
        snapshot: snapshot,
        updateHash: updateHash,
        refresh: refresh,
        restoring: function () { return restoring; }
    });
}(window, document));
