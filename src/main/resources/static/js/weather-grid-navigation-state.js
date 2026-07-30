/**
 * 공유 URL과 지도 탐색 상태 사이의 정규화 계약을 제공한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridNavigationState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var ELEMENTS = Object.freeze(['wdws', 'swdn', 'tmp', 'pcp', 'pty', 'sno', 'reh', 'sky', 'wav']);
    var BASE_TIMES = Object.freeze(['02', '05', '08', '11', '14', '17', '20', '23']);
    var PROJECTIONS = Object.freeze(['KMA_GRID_LCC', 'EPSG:3857', 'EPSG:4326']);
    var VIEW_LAYERS = Object.freeze(['heat', 'stream', 'iso']);
    var HAZARD_LAYERS = Object.freeze(['typhoon', 'lightning']);
    var LIGHTNING_WINDOWS = Object.freeze([15, 30, 60]);

    function includes(list, value) {
        return list.indexOf(value) >= 0;
    }

    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        var parts = value.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return date.getUTCFullYear() === parts[0]
            && date.getUTCMonth() === parts[1] - 1
            && date.getUTCDate() === parts[2];
    }

    function shiftDate(value, days) {
        if (!validDate(value)) return '';
        var parts = value.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
        return date.getUTCFullYear() + '-'
            + String(date.getUTCMonth() + 1).padStart(2, '0') + '-'
            + String(date.getUTCDate()).padStart(2, '0');
    }

    function parseList(value, allowed) {
        if (!value || value === 'none') return [];
        return value.split(',').filter(function (item, index, all) {
            return includes(allowed, item) && all.indexOf(item) === index;
        });
    }

    function normalizedLayers(params, context, element) {
        var raw = params.get('v');
        var source;
        if (raw !== null) {
            source = parseList(raw, VIEW_LAYERS);
        } else if (params.get('r') === 'iso') {
            source = ['stream', 'iso'];
        } else {
            var current = context.layers || { heat: true, stream: element === 'wdws', iso: false };
            source = VIEW_LAYERS.filter(function (layer) { return Boolean(current[layer]); });
        }
        var layers = {
            heat: includes(source, 'heat'),
            stream: includes(source, 'stream'),
            iso: includes(source, 'iso')
        };
        if (element !== 'wdws') layers.stream = false;
        var metadata = context.metadata && context.metadata[element] ? context.metadata[element] : {};
        if (metadata.isoline === false) {
            layers.iso = false;
            layers.heat = true;
        }
        return Object.freeze(layers);
    }

    function integerInRange(value, minimum, maximum, fallback) {
        var parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
    }

    function decimalInRange(value, minimum, maximum) {
        if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,5})?$/.test(value)) return null;
        var parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
    }

    function decodedView(params) {
        var latitude = decimalInRange(params.get('lat'), 29, 46);
        var longitude = decimalInRange(params.get('lon'), 116, 140);
        var zoom = decimalInRange(params.get('z'), 5.5, 12.5);
        if (latitude === null || longitude === null || zoom === null) return null;
        return Object.freeze({ latitude: latitude, longitude: longitude, zoom: zoom });
    }

    function fixedDecimal(value, digits) {
        var factor = Math.pow(10, digits);
        return (Math.round(Number(value) * factor + 1e-8) / factor).toFixed(digits);
    }

    function decode(hash, context) {
        context = context || {};
        if (!hash || hash === '#') return null;
        var params;
        try {
            params = new URLSearchParams(hash.charAt(0) === '#' ? hash.slice(1) : hash);
        } catch (error) {
            return null;
        }

        var fallbackElement = includes(ELEMENTS, context.element) ? context.element : 'wdws';
        var element = includes(ELEMENTS, params.get('e')) ? params.get('e') : fallbackElement;
        var latestDate = validDate(context.latestDate) ? context.latestDate : context.date;
        var fallbackDate = validDate(context.date) ? context.date : latestDate;
        var earliestDate = validDate(latestDate) ? shiftDate(latestDate, -60) : fallbackDate;
        var requestedDate = params.get('d');
        var date = validDate(requestedDate) && requestedDate >= earliestDate && requestedDate <= latestDate
            ? requestedDate : fallbackDate;

        var fallbackTime = includes(BASE_TIMES, context.baseTime) ? context.baseTime : '02';
        var requestedTime = params.get('t');
        var latestTime = includes(BASE_TIMES, context.latestTime) ? context.latestTime : fallbackTime;
        var baseTime = includes(BASE_TIMES, requestedTime)
            && (date !== latestDate || Number(requestedTime) <= Number(latestTime))
            ? requestedTime : fallbackTime;
        var fallbackHour = integerInRange(context.forecastHour, 1, 48, 1);
        var projection = includes(PROJECTIONS, params.get('proj'))
            ? params.get('proj')
            : (includes(PROJECTIONS, context.projection) ? context.projection : PROJECTIONS[0]);
        var hazards = parseList(params.get('haz'), HAZARD_LAYERS);
        var lightningWindow = integerInRange(params.get('lwin'), 15, 60, 60);
        if (!includes(LIGHTNING_WINDOWS, lightningWindow)) lightningWindow = 60;
        var air = includes(['pm10', 'pm25'], params.get('air')) ? params.get('air') : 'off';

        var restored = {
            element: element,
            height: '10m',
            date: date,
            baseTime: baseTime,
            forecastHour: integerInRange(params.get('f'), 1, 48, fallbackHour),
            projection: projection,
            layers: normalizedLayers(params, context, element),
            air: air,
            cctv: params.get('cctv') === '1',
            hazards: Object.freeze({
                typhoon: includes(hazards, 'typhoon'),
                lightning: includes(hazards, 'lightning'),
                lightningMinutes: lightningWindow
            })
        };
        var view = decodedView(params);
        if (view) restored.view = view;
        return Object.freeze(restored);
    }

    function encode(state) {
        state = state || {};
        var params = new URLSearchParams();
        params.set('e', includes(ELEMENTS, state.element) ? state.element : 'wdws');
        params.set('h', '10m');
        params.set('d', validDate(state.date) ? state.date : '');
        params.set('t', includes(BASE_TIMES, state.baseTime) ? state.baseTime : '02');
        params.set('f', String(integerInRange(state.forecastHour, 1, 48, 1)));
        params.set('proj', includes(PROJECTIONS, state.projection) ? state.projection : PROJECTIONS[0]);
        var view = state.view || {};
        if (Number.isFinite(view.latitude) && view.latitude >= 29 && view.latitude <= 46
                && Number.isFinite(view.longitude) && view.longitude >= 116 && view.longitude <= 140
                && Number.isFinite(view.zoom) && view.zoom >= 5.5 && view.zoom <= 12.5) {
            // 지도 공유에 충분한 약 100 m 정밀도로 제한해 불필요한 위치 노출을 줄인다.
            params.set('lat', fixedDecimal(view.latitude, 3));
            params.set('lon', fixedDecimal(view.longitude, 3));
            params.set('z', fixedDecimal(view.zoom, 2));
        }
        var layers = state.layers || {};
        var visible = VIEW_LAYERS.filter(function (layer) { return Boolean(layers[layer]); });
        params.set('v', visible.length ? visible.join(',') : 'none');
        if (includes(['pm10', 'pm25'], state.air)) params.set('air', state.air);
        if (state.cctv) params.set('cctv', '1');
        var hazards = state.hazards || {};
        var activeHazards = HAZARD_LAYERS.filter(function (layer) { return Boolean(hazards[layer]); });
        if (activeHazards.length) params.set('haz', activeHazards.join(','));
        if (hazards.lightning && includes(LIGHTNING_WINDOWS, Number(hazards.lightningMinutes))) {
            params.set('lwin', String(hazards.lightningMinutes));
        }
        return params.toString();
    }

    return Object.freeze({
        decode: decode,
        encode: encode,
        validDate: validDate,
        earliestDate: function (latestDate) { return shiftDate(latestDate, -60); },
        elements: ELEMENTS,
        baseTimes: BASE_TIMES,
        projections: PROJECTIONS
    });
}));
