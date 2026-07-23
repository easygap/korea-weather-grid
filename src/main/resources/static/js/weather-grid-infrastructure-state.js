/**
 * 주요 대교·공항·항만 레이어의 가용성, 표시 상태와 벡터 심벌 계약을 계산한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridInfrastructureState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var CATALOG = Object.freeze({
        bridge: Object.freeze({
            key: 'bridge', label: '주요 대교', hint: '강풍 민감',
            shape: 'diamond', points: 4, angle: 0, radius: 6.5,
            colorToken: '--infrastructure-bridge', zIndex: 94
        }),
        airport: Object.freeze({
            key: 'airport', label: '공항', hint: '이착륙',
            shape: 'triangle', points: 3, angle: 0, radius: 7,
            colorToken: '--infrastructure-airport', zIndex: 95
        }),
        port: Object.freeze({
            key: 'port', label: '무역항', hint: '해상풍',
            shape: 'square', points: 4, angle: Math.PI / 4, radius: 6.5,
            colorToken: '--infrastructure-port', zIndex: 96
        })
    });
    var KEYS = Object.freeze(Object.keys(CATALOG));
    var LABEL_THRESHOLD_METERS_PER_PIXEL = 800;

    function freezeFlags(source) {
        var flags = {};
        KEYS.forEach(function (key) { flags[key] = Boolean(source && source[key]); });
        return Object.freeze(flags);
    }

    function initial(options) {
        options = options || {};
        var available = freezeFlags(options.available);
        var visible = {};
        KEYS.forEach(function (key) {
            visible[key] = available[key] && Boolean(options.visible && options.visible[key]);
        });
        return Object.freeze({
            available: available,
            visible: Object.freeze(visible)
        });
    }

    function outcome(state, effects) {
        return Object.freeze({ state: state, effects: Object.freeze(effects.map(Object.freeze)) });
    }

    function transition(state, event) {
        state = state || initial();
        event = event || {};
        var key = event.key;
        if (KEYS.indexOf(key) < 0 || !state.available[key]) return outcome(state, []);
        var nextVisible;
        if (event.type === 'toggle') nextVisible = !state.visible[key];
        else if (event.type === 'set') nextVisible = Boolean(event.visible);
        else return outcome(state, []);
        if (nextVisible === state.visible[key]) return outcome(state, []);
        var visible = {};
        KEYS.forEach(function (candidate) {
            visible[candidate] = candidate === key ? nextVisible : state.visible[candidate];
        });
        var next = Object.freeze({ available: state.available, visible: Object.freeze(visible) });
        return outcome(next, [{ type: 'layer/visibility', key: key, visible: nextVisible }]);
    }

    function metersPerPixel(resolution, units) {
        if (!Number.isFinite(resolution) || resolution < 0) return Infinity;
        return resolution * (units === 'degrees' ? 111320 : 1);
    }

    function labelsVisible(resolution, units) {
        return metersPerPixel(resolution, units) < LABEL_THRESHOLD_METERS_PER_PIXEL;
    }

    function location(key, name, longitude, latitude) {
        var normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!CATALOG[key] || !normalizedName || normalizedName.length > 80
                || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
                || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            return null;
        }
        return Object.freeze({
            key: key,
            name: normalizedName,
            longitude: Number(longitude.toFixed(4)),
            latitude: Number(latitude.toFixed(4))
        });
    }

    return Object.freeze({
        catalog: CATALOG,
        keys: KEYS,
        initial: initial,
        transition: transition,
        metersPerPixel: metersPerPixel,
        labelsVisible: labelsVisible,
        location: location,
        labelThresholdMetersPerPixel: LABEL_THRESHOLD_METERS_PER_PIXEL
    });
}));
