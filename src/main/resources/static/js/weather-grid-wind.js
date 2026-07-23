/**
 * 순수 풍장 상태를 OpenLayers 뷰와 자체 Windy Canvas 렌더러에 연결한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridWindState;
    var MapRuntime = window.WeatherGridMapRuntime;
    var WindGrid = window.WeatherGridWindGrid;
    if (!State || !MapRuntime || !WindGrid || !window.Windy) {
        throw new Error('Wind state, map runtime, wind grid and Windy must load before weather-grid-wind');
    }

    var map = MapRuntime.map;
    var lifecycle = State.initial();
    var field = null;
    var query = null;
    var renderer = null;
    var refreshTimer = 0;
    var preparedPlan = null;

    function ensureCanvas() {
        var existing = document.getElementById('wind_field_canvas');
        if (existing) return existing;
        var created = document.createElement('canvas');
        created.id = 'wind_field_canvas';
        created.setAttribute('aria-hidden', 'true');
        map.getViewport().appendChild(created);
        return created;
    }

    var canvas = ensureCanvas();

    function selectedMetric() {
        var element = document.getElementById('element');
        return element ? element.value : '';
    }

    function streamEnabled() {
        return !window.WeatherGridLayers || window.WeatherGridLayers.snapshot().stream;
    }

    function view3dOpen() {
        var view3d = document.getElementById('view3d');
        return Boolean(view3d && view3d.classList.contains('open'));
    }

    function renderConditions() {
        return Object.freeze({
            metric: selectedMetric(),
            streamEnabled: streamEnabled(),
            view3dOpen: view3dOpen(),
            size: map.getSize(),
            devicePixelRatio: window.devicePixelRatio || 1
        });
    }

    function stopRenderer() {
        if (renderer) renderer.stop();
    }

    function destroyRenderer() {
        if (renderer) renderer.destroy();
        renderer = null;
    }

    function replaceRenderer() {
        destroyRenderer();
        if (!field) return;
        try {
            renderer = new window.Windy({
                canvas: canvas,
                data: field,
                visualTimeScale: 1800,
                maxDisplaySpeed: 55,
                particleDensity: 1 / 900,
                lineWidth: 1.15
            });
        } catch (error) {
            renderer = null;
            if (window.console && console.warn) console.warn('2D 바람 벡터장을 초기화하지 못했습니다.', error);
        }
    }

    function clearCanvas() {
        canvas.style.display = 'none';
        canvas.classList.remove('is-map-moving');
        var context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function prepareCanvas(plan) {
        preparedPlan = plan;
        canvas.style.display = 'block';
        canvas.style.width = plan.cssWidth + 'px';
        canvas.style.height = plan.cssHeight + 'px';
        canvas.width = plan.backingWidth;
        canvas.height = plan.backingHeight;
    }

    function startRenderer() {
        if (!renderer || !preparedPlan) return;
        var view = map.getView();
        renderer.start({
            width: preparedPlan.cssWidth,
            height: preparedPlan.cssHeight,
            viewProjectionExtent: view.calculateExtent([
                preparedPlan.cssWidth, preparedPlan.cssHeight
            ]),
            projectionCode: view.getProjection().getCode()
        });
    }

    function scheduleRefresh(delay) {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(function () {
            refreshTimer = 0;
            refresh();
        }, delay);
    }

    function cancelRefresh() {
        window.clearTimeout(refreshTimer);
        refreshTimer = 0;
    }

    function execute(effects) {
        effects.forEach(function (effect) {
            if (effect.type === 'renderer/replace') replaceRenderer();
            else if (effect.type === 'renderer/stop') stopRenderer();
            else if (effect.type === 'renderer/destroy') destroyRenderer();
            else if (effect.type === 'render/request') refresh();
            else if (effect.type === 'render/schedule') scheduleRefresh(effect.delay);
            else if (effect.type === 'render/cancel') cancelRefresh();
            else if (effect.type === 'map/resize') map.updateSize();
            else if (effect.type === 'canvas/moving') canvas.classList.add('is-map-moving');
            else if (effect.type === 'canvas/settle') canvas.classList.remove('is-map-moving');
            else if (effect.type === 'canvas/hide') canvas.style.display = 'none';
            else if (effect.type === 'canvas/clear') clearCanvas();
            else if (effect.type === 'canvas/prepare') prepareCanvas(effect.plan);
            else if (effect.type === 'renderer/start') startRenderer();
        });
    }

    function send(event) {
        var result = State.transition(lifecycle, event);
        lifecycle = result.state;
        execute(result.effects);
        return lifecycle;
    }

    function refresh() {
        map.updateSize();
        return send({ type: 'render/request', conditions: renderConditions() });
    }

    function suspend() {
        cancelRefresh();
        return send({ type: 'render/suspend' });
    }

    function present(windField, request) {
        try {
            WindGrid.create(windField);
        } catch (error) {
            if (window.console && console.warn) console.warn('지원하지 않는 2D 바람 벡터장입니다.', error);
            clear();
            return false;
        }
        field = windField;
        query = request || null;
        window.lastWindField = field;
        return send({ type: 'field/set' });
    }

    function clear() {
        cancelRefresh();
        field = null;
        query = null;
        preparedPlan = null;
        window.lastWindField = null;
        return send({ type: 'field/clear' });
    }

    function diagnostics() {
        var details = renderer ? renderer.getDiagnostics() : { state: 'empty' };
        return Object.assign({ query: query }, details);
    }

    map.on('movestart', function () { send({ type: 'view/start' }); });
    map.on('moveend', function () { send({ type: 'view/end' }); });
    window.addEventListener('resize', function () { send({ type: 'viewport/resize' }); });
    window.addEventListener('pagehide', function () {
        cancelRefresh();
        send({ type: 'page/hide' });
        field = null;
        query = null;
        window.lastWindField = null;
    }, { once: true });

    window.refreshStreamlines = refresh;
    window.suspendStreamlines = suspend;
    window.clearStreamlines = clear;
    window.getWindDiagnostics = diagnostics;
    window.WeatherGridWind = Object.freeze({
        present: present,
        clear: clear,
        refresh: refresh,
        suspend: suspend,
        diagnostics: diagnostics,
        snapshot: function () { return lifecycle; }
    });
}(window, document));
