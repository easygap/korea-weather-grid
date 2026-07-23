/**
 * 기상 표현 레이어의 선택 가능 여부와 상태 전이를 브라우저 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridLayerState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var KEYS = Object.freeze(['heat', 'stream', 'iso']);

    function frozenLayers(source) {
        source = source || {};
        return Object.freeze({
            heat: Boolean(source.heat),
            stream: Boolean(source.stream),
            iso: Boolean(source.iso)
        });
    }

    function availability(metric, metadata) {
        var meta = metadata || {};
        var categorical = meta.categorical === true || meta.isoline === false;
        return Object.freeze({
            heat: Object.freeze({
                enabled: !categorical,
                required: categorical
            }),
            stream: Object.freeze({
                enabled: metric === 'wdws',
                required: false
            }),
            iso: Object.freeze({
                enabled: meta.isoline !== false,
                required: false
            })
        });
    }

    function normalize(source, metric, metadata) {
        var next = frozenLayers(source);
        var available = availability(metric, metadata);
        return Object.freeze({
            heat: available.heat.required ? true : next.heat,
            stream: available.stream.enabled && next.stream,
            iso: available.iso.enabled && next.iso
        });
    }

    function initial(options) {
        options = options || {};
        var source = options.layers || { heat: true, stream: true, iso: false };
        return normalize(source, options.metric || 'wdws', options.metadata || {});
    }

    function changed(previous, next) {
        return KEYS.some(function (key) { return previous[key] !== next[key]; });
    }

    function transition(current, event, context) {
        event = event || {};
        context = context || {};
        var metric = context.metric || 'wdws';
        var metadata = context.metadata || {};
        var previous = normalize(current, metric, metadata);
        var candidate = previous;

        if (event.type === 'layer/toggle' && KEYS.indexOf(event.layer) >= 0) {
            var allowed = availability(metric, metadata)[event.layer];
            if (allowed.enabled) {
                candidate = {
                    heat: previous.heat,
                    stream: previous.stream,
                    iso: previous.iso
                };
                candidate[event.layer] = !candidate[event.layer];
            }
        } else if (event.type === 'layers/replace') {
            candidate = event.layers || {};
        } else if (event.type !== 'metric/change') {
            return Object.freeze({ state: previous, changed: false });
        }

        var next = normalize(candidate, metric, metadata);
        return Object.freeze({ state: next, changed: changed(previous, next) });
    }

    return Object.freeze({
        keys: KEYS,
        initial: initial,
        normalize: normalize,
        availability: availability,
        transition: transition
    });
}));
