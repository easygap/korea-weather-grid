/**
 * 순수 탐색 상태를 지도·환경 레이어·접근 가능한 화면 문맥에 연결한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridExploreState;
    var Controls = window.WeatherGridControls;
    var Interface = window.WeatherGridInterface;
    var runtime = window.WeatherGridMapRuntime;
    var Layers = window.WeatherGridLayers;
    if (!State || !Controls || !Interface || !runtime || !Layers) {
        throw new Error('Explore state, controls, interface, map runtime and layers must load first');
    }

    var metrics = Controls.metrics;
    var playback = Controls.playback;
    var map = runtime.map;
    var state = State.initial();
    var applying = false;
    var hazardViewSnapshot = null;

    function metricMeta(metric) {
        return (window.WEATHER_GRID_WEATHER_ELEMENTS && window.WEATHER_GRID_WEATHER_ELEMENTS[metric]) || {};
    }

    function airMode() {
        return window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.getMode
            ? window.WEATHER_GRID_AIR_QUALITY.getMode() : 'off';
    }

    function cctvEnabled() {
        return Boolean(window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.isEnabled
            && window.WEATHER_GRID_CCTV.isEnabled());
    }

    function hazards() {
        return window.WEATHER_GRID_SEVERE_WEATHER && window.WEATHER_GRID_SEVERE_WEATHER.getState
            ? window.WEATHER_GRID_SEVERE_WEATHER.getState()
            : { typhoon: false, lightning: false, lightningMinutes: 30 };
    }

    function currentMetric() {
        var select = document.getElementById('element');
        return select ? select.value : 'wdws';
    }

    function currentSnapshot() {
        return {
            metric: currentMetric(),
            layers: Layers.snapshot(),
            air: airMode(),
            cctv: cctvEnabled(),
            hazards: hazards()
        };
    }

    /** 위험기상 화면에서 벗어날 때 원래 중심·축척을 현재 도법으로 복구한다. */
    function setHazardMapContext(active) {
        if (!map || !window.ol) return;
        var view = map.getView();
        if (!view) return;
        if (active) {
            if (!hazardViewSnapshot) {
                var projection = view.getProjection();
                var projectionCode = projection && projection.getCode
                    ? projection.getCode() : window.WEATHER_GRID_VIEW_PROJ;
                var center = view.getCenter();
                var geographicCenter = null;
                try {
                    geographicCenter = center
                        ? ol.proj.transform(center.slice(), projectionCode, 'EPSG:4326') : null;
                } catch (error) { geographicCenter = null; }
                hazardViewSnapshot = {
                    center: geographicCenter,
                    zoom: view.getZoom(),
                    minZoom: view.getMinZoom()
                };
            }
            view.setMinZoom(2.5);
            if (window.WEATHER_GRID_SEVERE_WEATHER && window.WEATHER_GRID_SEVERE_WEATHER.fitActiveTyphoons) {
                window.WEATHER_GRID_SEVERE_WEATHER.fitActiveTyphoons();
            }
            return;
        }
        if (!hazardViewSnapshot) return;
        var restore = hazardViewSnapshot;
        hazardViewSnapshot = null;
        view.setMinZoom(restore.minZoom);
        var targetZoom = Math.max(restore.minZoom,
            Number.isFinite(restore.zoom) ? restore.zoom : restore.minZoom);
        var targetCenter = null;
        try {
            var currentProjection = view.getProjection();
            var currentCode = currentProjection && currentProjection.getCode
                ? currentProjection.getCode() : window.WEATHER_GRID_VIEW_PROJ;
            targetCenter = restore.center
                ? ol.proj.transform(restore.center.slice(), 'EPSG:4326', currentCode) : null;
        } catch (error) { targetCenter = null; }
        var reducedMotion = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (targetCenter && !reducedMotion) {
            view.animate({ center: targetCenter, zoom: targetZoom, duration: 260 });
        } else {
            if (targetCenter) view.setCenter(targetCenter);
            view.setZoom(targetZoom);
        }
    }

    function setHazards(typhoon, lightning) {
        if (window.WEATHER_GRID_SEVERE_WEATHER && window.WEATHER_GRID_SEVERE_WEATHER.setLayers) {
            window.WEATHER_GRID_SEVERE_WEATHER.setLayers({ typhoon: typhoon, lightning: lightning });
        }
    }

    function setStations(visible) {
        var button = document.getElementById('weather_stations');
        if (button && button.classList.contains('clicked') !== visible) button.click();
    }

    function setBasemap(name) {
        var button = document.getElementById(name === 'streets' ? 'basemap_streets' : 'basemap_weather');
        if (button && !button.classList.contains('is-selected-basemap')) button.click();
    }

    function setEnvironment(nextAirMode, nextCctv) {
        if (window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.setEnabled
                && cctvEnabled() !== nextCctv) {
            window.WEATHER_GRID_CCTV.setEnabled(nextCctv);
        }
        if (window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.setMode
                && airMode() !== nextAirMode) {
            window.WEATHER_GRID_AIR_QUALITY.setMode(nextAirMode);
        }
    }

    function selectMetric(metric) {
        if (!metric) return false;
        var select = document.getElementById('element');
        if (!select) return false;
        if (select.value === metric) {
            metrics.sync(metric);
            return false;
        }
        select.value = metric;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('weather-grid:metric-selected', {
            detail: { metric: metric }
        }));
        return true;
    }

    function renderHazardSummary() {
        var severe = hazards();
        var infoBox = document.querySelector('.map_status_panel');
        if (!infoBox) return;
        var metric = infoBox.querySelector('.info_metric');
        var time = infoBox.querySelector('.info_time');
        var hint = infoBox.querySelector('.info_hint');
        if (metric) metric.textContent = '위험기상';
        if (time) time.textContent = '최근 관측·발표';
        if (hint) {
            var loading = severe.typhoonLoading || severe.lightningLoading;
            var failed = severe.typhoonError || severe.lightningError;
            var warningText = severe.warningStatus === 'unavailable' ? '특보 연결 대기'
                : severe.warningStatus === 'error' ? '특보 확인 불가'
                    : '특보 ' + (severe.warningCount || 0) + '건';
            hint.textContent = loading ? '태풍·낙뢰 자료 확인 중'
                : (failed ? '일부 자료 확인 불가 · ' : '')
                    + '태풍 ' + (severe.typhoonCount || 0) + '개 · 낙뢰 '
                    + (severe.lightningCount || 0) + '회 · ' + warningText;
        }
        infoBox.setAttribute('aria-label', '위험기상, 최근 관측과 발표 자료');
    }

    function renderContext() {
        var metric = currentMetric();
        var view = State.context(state.activeMode, metric, metricMeta(metric).group);
        var summary = document.getElementById('explore_mode_summary');
        if (summary) {
            summary.dataset.kind = view.kind;
            var title = summary.querySelector('strong');
            var body = summary.querySelector('span');
            if (title) title.textContent = view.title;
            if (body) body.textContent = view.body;
        }
        var timelineScope = document.getElementById('timeline_scope');
        if (timelineScope) timelineScope.textContent = view.timeline;
        var timelineRange = document.getElementById('timeline_range');
        if (timelineRange) timelineRange.textContent = view.timelineDetail;
        var dockContext = document.getElementById('dock_context');
        if (dockContext) dockContext.textContent = view.dockContext;
        if (state.activeMode === 'hazards') renderHazardSummary();

        document.querySelectorAll('button[data-explore-mode]').forEach(function (button) {
            var selected = button.dataset.exploreMode === state.activeMode;
            button.classList.toggle('on', selected);
            Interface.setPressed(button, selected);
        });
        document.querySelectorAll('button[data-data-domain]').forEach(function (button) {
            var selected = button.dataset.dataDomain === view.domain;
            button.classList.toggle('on', selected);
            Interface.setPressed(button, selected);
        });
        var app = document.querySelector('.app');
        if (app) {
            app.dataset.exploreMode = state.activeMode;
            app.dataset.dataDomain = view.domain;
        }
        var layerSettings = document.getElementById('layer_settings');
        if (layerSettings && view.domain !== 'weather') layerSettings.open = true;
        return view;
    }

    function sync() {
        if (applying) return state;
        var metric = currentMetric();
        var result = State.transition(state, {
            type: 'state/observe',
            snapshot: currentSnapshot(),
            metricGroup: metricMeta(metric).group
        });
        state = result.state;
        setHazardMapContext(state.activeMode === 'hazards');
        renderContext();
        return state;
    }

    function applyPlan(mode) {
        var lastWeather = metrics.lastWeather();
        var plan = State.plan(mode, {
            compact: Interface.dock.isCompact(),
            lastPrecipitation: metrics.lastPrecipitation(),
            lastWeather: lastWeather,
            layers: Layers.snapshot(),
            metricMeta: metricMeta(lastWeather)
        });
        if (!plan) return;
        var metricChanged = false;
        setHazardMapContext(plan.mode === 'hazards');
        if (plan.mode !== 'hazards') setHazards(false, false);
        if (plan.stopPlayback) playback.stop();
        setEnvironment(plan.environment.air, plan.environment.cctv);
        metricChanged = selectMetric(plan.metric);
        Layers.replace(plan.layers, { notify: false, updateHash: false });
        setStations(plan.stations);
        setBasemap(plan.basemap);
        if (plan.mode === 'hazards') setHazards(plan.hazards.typhoon, plan.hazards.lightning);
        renderContext();
        if (!metricChanged && ['wind', 'temperature', 'precipitation', 'solar'].indexOf(plan.mode) >= 0
                && typeof updateSelectionSummary === 'function') {
            updateSelectionSummary();
        }
        if (typeof window.WEATHER_GRID_UPDATE_HASH === 'function') window.WEATHER_GRID_UPDATE_HASH();
    }

    function send(event) {
        if (applying) return state;
        var result = State.transition(state, event);
        if (!result.effects.length) return state;
        state = result.state;
        applying = true;
        try { applyPlan(state.activeMode); }
        finally { applying = false; }
        return state;
    }

    function handleMetricSelected(metric) {
        var rememberWeather = !applying
            || ['wind', 'temperature', 'precipitation', 'solar', 'custom'].indexOf(state.activeMode) >= 0;
        metrics.remember(metric, rememberWeather);
        Layers.normalize(metric, { notify: false, updateHash: false });
        metrics.sync(metric);
        if (typeof refreshWeatherGrid === 'function') refreshWeatherGrid();
        if (applying) return;
        var modeByMetric = { wdws: 'wind', tmp: 'temperature', swdn: 'solar' };
        if (State.isPrecipitation(metric)) send({ type: 'mode/select', mode: 'precipitation' });
        else if (modeByMetric[metric]) send({ type: 'mode/select', mode: modeByMetric[metric] });
        else {
            setHazards(false, false);
            setEnvironment('off', false);
            sync();
        }
    }

    document.querySelectorAll('button[data-explore-mode]').forEach(function (button) {
        button.addEventListener('click', function () {
            send({ type: 'mode/select', mode: button.dataset.exploreMode });
        });
    });
    document.querySelectorAll('button[data-data-domain]').forEach(function (button) {
        button.addEventListener('click', function () {
            send({ type: 'domain/select', domain: button.dataset.dataDomain });
        });
    });
    ['seg_element', 'seg_precipitation', 'seg_additional_weather', 'seg_marine_weather',
        'seg_air_quality', 'cctv_toggle', 'weather_stations',
        'typhoon_toggle', 'lightning_toggle'].forEach(function (id) {
        var control = document.getElementById(id);
        if (control) control.addEventListener('click', function () { window.setTimeout(sync, 0); });
    });
    document.addEventListener('weather-grid:metric-selected', function (event) {
        if (event.detail && event.detail.metric) handleMetricSelected(event.detail.metric);
    });
    document.addEventListener('weather-grid:environment-changed', sync);
    document.addEventListener('weather-grid:layers-changed', sync);
    document.addEventListener('weather-grid:hazards-changed', sync);
    document.addEventListener('weather-grid:hazards-settled', renderContext);
    document.addEventListener('weather-grid:grid-settled', renderContext);

    sync();

    window.WeatherGridExplore = Object.freeze({
        select: function (mode) { return send({ type: 'mode/select', mode: mode }); },
        selectDomain: function (domain) { return send({ type: 'domain/select', domain: domain }); },
        sync: sync,
        active: function () { return state.activeMode; },
        lastWeather: function () { return state.lastWeatherMode; },
        isApplying: function () { return applying; },
        hazards: hazards,
        context: renderContext
    });
}(window, document));
