/**
 * 3D 지도 모듈의 지연 로딩, 모달 생명주기와 2D 바람장 복구를 담당한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridView3dState;
    var Interface = window.WeatherGridInterface;
    var Controls = window.WeatherGridControls;
    var Geodata = window.WeatherGridGeodata;
    var Layers = window.WeatherGridLayers;
    if (!State || !Interface || !Controls || !Geodata || !Layers) {
        throw new Error('3D state, interface, controls, geodata and layers must load first');
    }

    var mainButton = document.getElementById('btn_3d');
    var dockButton = document.getElementById('btn_3d_dock');
    var triggers = [mainButton, dockButton].filter(Boolean);
    var modal = document.getElementById('view3d');
    var closeButton = document.getElementById('view3d_close');
    var metrics = Controls.metrics;
    var state = State.initial();
    var opener = null;
    var modulePromise = null;
    var loadAttempt = 0;
    var resumeStream = false;
    var MODULE_TIMEOUT_MS = 10000;
    var mainLabel = mainButton && mainButton.querySelector('.lbl');
    var dockLabel = dockButton && dockButton.querySelector('.sub');

    function selectedMetric() {
        var select = document.getElementById('element');
        return select ? select.value : 'wdws';
    }

    function gridMetric() {
        return window.lastGridElement || selectedMetric();
    }

    function metricMeta(metric) {
        return (window.WEATHER_GRID_WEATHER_ELEMENTS && window.WEATHER_GRID_WEATHER_ELEMENTS[metric]) || {};
    }

    function render() {
        var view = State.render(state);
        triggers.forEach(function (button) {
            button.classList.toggle('active', view.active);
            button.setAttribute('aria-expanded', view.expanded ? 'true' : 'false');
            if (view.busy) {
                button.disabled = true;
                button.setAttribute('aria-disabled', 'true');
                button.setAttribute('aria-busy', 'true');
            } else {
                button.removeAttribute('aria-busy');
            }
        });
        if (mainButton) {
            mainButton.setAttribute('aria-label', view.busy ? '3D 지도 불러오는 중' : '3D 지형 뷰 열기');
        }
        if (mainLabel) mainLabel.textContent = view.busy ? '로딩' : '3D';
        if (dockLabel) dockLabel.textContent = view.busy ? '불러오는 중' : '모바일';
        if (!view.busy) metrics.sync(selectedMetric());
        return view;
    }

    function withTimeout(promise) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timeout = window.setTimeout(function () {
                if (settled) return;
                settled = true;
                var error = new Error('3D 지도 모듈 로드 시간 초과');
                error.code = 'MAP3D_LOAD_TIMEOUT';
                reject(error);
            }, MODULE_TIMEOUT_MS);
            promise.then(function (value) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                resolve(value);
            }, function (error) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                reject(error);
            });
        });
    }

    function ensureModule() {
        if (window.WEATHER_GRID_3D) return Promise.resolve(window.WEATHER_GRID_3D);
        if (!modulePromise) {
            var app = document.querySelector('.app');
            var contextPath = app ? (app.dataset.contextPath || '') : '';
            var attempt = loadAttempt++;
            var moduleUrl = contextPath + '/static/js/map3d.js?v=20260723.2'
                + (attempt ? '&retry=' + attempt : '');
            var request = import(moduleUrl).then(function (module) {
                var api = module && module.default;
                if (!api || typeof api.open !== 'function' || typeof api.close !== 'function') {
                    throw new Error('3D 지도 모듈 API가 올바르지 않습니다.');
                }
                window.WEATHER_GRID_3D = api;
                return api;
            });
            modulePromise = request;
            request.catch(function () {
                if (modulePromise === request) modulePromise = null;
            });
        }
        return withTimeout(modulePromise);
    }

    function suspendStreamlines() {
        var canvas = document.getElementById('wind_field_canvas');
        resumeStream = State.streamWasVisible({
            metric: selectedMetric(),
            layers: Layers.snapshot(),
            canvasVisible: Boolean(canvas && window.getComputedStyle(canvas).display !== 'none')
        });
        if (window.suspendStreamlines) window.suspendStreamlines();
    }

    function restoreStreamlines() {
        var shouldResume = State.shouldResumeStream(resumeStream, {
            metric: selectedMetric(),
            layers: Layers.snapshot()
        });
        resumeStream = false;
        if (shouldResume && window.refreshStreamlines) {
            window.requestAnimationFrame(function () { window.refreshStreamlines(); });
        }
    }

    function notify(code) {
        if (typeof notifyUser === 'function') notifyUser(State.errorMessage(code));
    }

    async function open(trigger) {
        if (state.status === 'loading' || state.status === 'open') return false;
        var metric = gridMetric();
        if (metricMeta(metric).view3d === false) return false;
        if (!window.lastGridResult) {
            if (typeof notifyUser === 'function') notifyUser('먼저 데이터를 조회해 주세요.');
            return false;
        }
        opener = trigger || mainButton;
        if (opener === dockButton && Interface.dock.isCompact() && Interface.dock.isOpen()) {
            Interface.dock.close(false);
        }
        state = State.transition(state, { type: 'open/request' }).state;
        render();
        var api;
        try {
            var loaded = await Promise.all([
                ensureModule(),
                Geodata.load('eastAsiaLand'),
                Geodata.load('koreaAdmin1')
            ]);
            api = loaded[0];
        } catch (error) {
            var code = error && error.code === 'MAP3D_LOAD_TIMEOUT' ? 'timeout' : 'load';
            state = State.transition(state, { type: 'open/failed', code: code }).state;
            render();
            notify(code);
            return false;
        }

        Controls.playback.stop();
        suspendStreamlines();
        try {
            api.open(window.lastGridResult, metric, (typeof month !== 'undefined' ? month : '07'));
            state = State.transition(state, { type: 'open/succeeded' }).state;
            render();
            Interface.modal.open(modal, opener);
            Interface.syncToggleStates();
            return true;
        } catch (error) {
            state = State.transition(state, { type: 'open/failed', code: 'open' }).state;
            render();
            restoreStreamlines();
            notify('open');
            return false;
        }
    }

    function close() {
        if (window.WEATHER_GRID_3D) window.WEATHER_GRID_3D.close();
        state = State.transition(state, { type: 'close' }).state;
        render();
        Interface.modal.close(modal, true);
        restoreStreamlines();
    }

    if (mainButton) mainButton.addEventListener('click', function () { open(mainButton); });
    if (dockButton) dockButton.addEventListener('click', function () { open(dockButton); });
    if (closeButton) closeButton.addEventListener('click', close);
    if (modal) Interface.modal.registerCloser(modal, close);
    render();

    window.WeatherGridView3d = Object.freeze({
        open: open,
        close: close,
        state: function () { return state; }
    });
}(window, document));
