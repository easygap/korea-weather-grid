/**
 * 레이어 상태를 영속 래스터·등치선·바람 흐름과 접근 가능한 토글에 연결한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridLayerState;
    var Interface = window.WeatherGridInterface;
    var Controls = window.WeatherGridControls;
    var runtime = window.WeatherGridMapRuntime;
    if (!State || !Interface || !Controls || !runtime || !runtime.weatherLayer) {
        throw new Error('Layer state, interface, controls and map runtime must load first');
    }

    var metricControls = Controls.metrics;
    var state = State.initial({ metric: currentMetric(), metadata: metricMeta(currentMetric()) });

    function currentMetric() {
        var select = document.getElementById('element');
        return select ? select.value : 'wdws';
    }

    function metricMeta(metric) {
        var catalog = window.WEATHER_GRID_WEATHER_ELEMENTS || {};
        return catalog[metric] || {};
    }

    function renderControls(metric, metadata) {
        var row = document.getElementById('layer_toggles');
        if (!row) return;
        var available = State.availability(metric, metadata);
        row.querySelectorAll('button[data-layer]').forEach(function (button) {
            var key = button.dataset.layer;
            var selected = Boolean(state[key]);
            var capability = available[key];
            button.classList.toggle('on', selected);
            Interface.setPressed(button, selected);
            button.disabled = !capability.enabled;
            button.setAttribute('aria-disabled', capability.enabled ? 'false' : 'true');
        });

        var label = metadata.label || metric;
        var heat = row.querySelector('[data-layer="heat"]');
        if (heat) heat.title = available.heat.enabled
            ? '값을 색상으로 표시' : label + ' 항목은 색상 표현을 사용합니다';
        var stream = row.querySelector('[data-layer="stream"]');
        if (stream) stream.title = available.stream.enabled
            ? '바람 흐름을 선으로 표시' : '바람 요소에서만 흐름선을 표시할 수 있습니다';
        var iso = row.querySelector('[data-layer="iso"]');
        if (iso) iso.title = available.iso.enabled
            ? '같은 값을 선으로 연결' : label + ' 항목은 등치선으로 표현하지 않습니다';
    }

    function applyEffects() {
        var metric = currentMetric();
        var metadata = metricMeta(metric);
        state = State.normalize(state, metric, metadata);

        var weatherLayer = runtime.weatherLayer();
        if (weatherLayer) weatherLayer.setVisible(state.heat);
        var legend = document.getElementById('weather_legend');
        if (legend) legend.style.display = state.heat ? '' : 'none';
        if (window.WEATHER_GRID_ISO) {
            if (state.iso) window.WEATHER_GRID_ISO.show();
            else window.WEATHER_GRID_ISO.hide();
        }
        if (metric === 'wdws' && state.stream) {
            if (window.refreshStreamlines) window.refreshStreamlines();
        } else if (window.suspendStreamlines) {
            window.suspendStreamlines();
        }

        renderControls(metric, metadata);
        metricControls.sync(metric);
        return state;
    }

    function notify(options) {
        options = options || {};
        if (options.notify !== false) {
            document.dispatchEvent(new CustomEvent('weather-grid:layers-changed', {
                detail: Object.freeze({ layers: state })
            }));
        }
        if (options.updateHash !== false && typeof window.WEATHER_GRID_UPDATE_HASH === 'function') {
            window.WEATHER_GRID_UPDATE_HASH();
        }
    }

    function replace(nextLayers, options) {
        options = options || {};
        var metric = options.metric || currentMetric();
        var metadata = options.metadata || metricMeta(metric);
        var outcome = State.transition(state, {
            type: 'layers/replace', layers: nextLayers
        }, { metric: metric, metadata: metadata });
        state = outcome.state;
        if (options.apply !== false) applyEffects();
        else renderControls(metric, metadata);
        if (outcome.changed) notify(options);
        return state;
    }

    function toggle(layer) {
        var metric = currentMetric();
        var outcome = State.transition(state, {
            type: 'layer/toggle', layer: layer
        }, { metric: metric, metadata: metricMeta(metric) });
        if (!outcome.changed) return state;
        state = outcome.state;
        applyEffects();
        notify({});
        return state;
    }

    function normalizeForMetric(metric, options) {
        options = options || {};
        var outcome = State.transition(state, { type: 'metric/change' }, {
            metric: metric, metadata: metricMeta(metric)
        });
        state = outcome.state;
        if (options.apply === true) applyEffects();
        else renderControls(metric, metricMeta(metric));
        if (outcome.changed) notify(options);
        return state;
    }

    var row = document.getElementById('layer_toggles');
    if (row) {
        row.addEventListener('click', function (event) {
            var button = event.target.closest('button[data-layer]');
            if (!button || !row.contains(button) || button.disabled
                    || button.getAttribute('aria-disabled') === 'true') return;
            toggle(button.dataset.layer);
        });
    }

    renderControls(currentMetric(), metricMeta(currentMetric()));

    var api = Object.freeze({
        snapshot: function () { return state; },
        replace: replace,
        toggle: toggle,
        normalize: normalizeForMetric,
        apply: applyEffects
    });
    window.WeatherGridLayers = api;
    window.applyRenderMode = applyEffects;
}(window, document));
