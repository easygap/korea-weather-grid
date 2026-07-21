/**
 * Small, same-origin geodata client.
 *
 * Large coordinate arrays stay out of the JavaScript bundle and are fetched only when needed.
 * Every payload is schema-checked before OpenLayers or Three.js can consume it.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        const app = root.document && root.document.querySelector('.app');
        const contextPath = app ? (app.dataset.contextPath || '').replace(/\/$/, '') : '';
        root.WeatherGridGeodata = api.createClient({ basePath: contextPath });
    }
}(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    const ASSETS = Object.freeze({
        eastAsiaLand: Object.freeze({
            path: '/static/data/geodata/east-asia-land.geojson',
            schema: 'weather-grid.geojson/v1',
            id: 'east-asia-land',
            kind: 'geojson'
        }),
        koreaAdmin1: Object.freeze({
            path: '/static/data/geodata/korea-admin1.geojson',
            schema: 'weather-grid.geojson/v1',
            id: 'korea-admin1',
            kind: 'geojson'
        })
    });

    function assert(condition, message) {
        if (!condition) throw new Error(`Invalid geodata: ${message}`);
    }

    function validatePosition(position) {
        assert(Array.isArray(position) && position.length >= 2, 'coordinate must contain longitude and latitude');
        const lon = position[0];
        const lat = position[1];
        assert(Number.isFinite(lon) && lon >= -180 && lon <= 180, 'longitude is out of range');
        assert(Number.isFinite(lat) && lat >= -90 && lat <= 90, 'latitude is out of range');
    }

    function validateRings(rings) {
        assert(Array.isArray(rings) && rings.length > 0, 'polygon has no rings');
        rings.forEach(function (ring) {
            assert(Array.isArray(ring) && ring.length >= 4, 'polygon ring is too short');
            ring.forEach(validatePosition);
        });
    }

    function validateGeometry(geometry) {
        assert(geometry && typeof geometry === 'object', 'feature geometry is missing');
        if (geometry.type === 'Polygon') {
            validateRings(geometry.coordinates);
            return;
        }
        assert(geometry.type === 'MultiPolygon', `unsupported geometry type: ${geometry.type}`);
        assert(Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0, 'multipolygon is empty');
        geometry.coordinates.forEach(validateRings);
    }

    function validateGeoJson(value, definition) {
        assert(value && value.type === 'FeatureCollection', 'expected a FeatureCollection');
        assert(value.schema === definition.schema, `unexpected schema for ${definition.id}`);
        assert(value.id === definition.id, `unexpected dataset id for ${definition.id}`);
        assert(Array.isArray(value.features) && value.features.length > 0, `${definition.id} has no features`);
        assert(value.features.length <= 10000, `${definition.id} has too many features`);

        const regionIds = new Set();
        value.features.forEach(function (feature) {
            assert(feature && feature.type === 'Feature', 'invalid feature');
            assert(feature.properties && typeof feature.properties === 'object', 'feature properties are missing');
            validateGeometry(feature.geometry);
            if (definition.id === 'korea-admin1') {
                const regionId = feature.properties.regionId;
                assert(typeof regionId === 'string' && /^KR-\d{2}$/.test(regionId), 'invalid province identifier');
                assert(!regionIds.has(regionId), `duplicate province identifier: ${regionId}`);
                assert(typeof feature.properties.nameKo === 'string' && feature.properties.nameKo.length > 0,
                    `missing Korean province name: ${regionId}`);
                regionIds.add(regionId);
            }
        });
        return value;
    }

    function validate(key, value) {
        const definition = ASSETS[key];
        assert(definition, `unknown asset key: ${key}`);
        return validateGeoJson(value, definition);
    }

    function createClient(options) {
        options = options || {};
        const basePath = (options.basePath || '').replace(/\/$/, '');
        const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        const resolved = new Map();
        const pending = new Map();

        async function request(key) {
            const definition = ASSETS[key];
            assert(definition, `unknown asset key: ${key}`);
            assert(fetchImpl, 'fetch is unavailable');

            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timeout = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
            try {
                const response = await fetchImpl(basePath + definition.path,
                    controller ? { signal: controller.signal, credentials: 'same-origin' } : { credentials: 'same-origin' });
                if (!response.ok) throw new Error(`Geodata request failed (${response.status}): ${definition.path}`);
                const value = validate(key, await response.json());
                resolved.set(key, value);
                return value;
            } finally {
                if (timeout) clearTimeout(timeout);
            }
        }

        function load(key) {
            if (resolved.has(key)) return Promise.resolve(resolved.get(key));
            if (pending.has(key)) return pending.get(key);
            const promise = request(key).finally(function () { pending.delete(key); });
            pending.set(key, promise);
            return promise;
        }

        return Object.freeze({
            load,
            loadInitial: function () { return Promise.all([load('eastAsiaLand'), load('koreaAdmin1')]); },
            peek: function (key) { return resolved.get(key) || null; },
            has: function (key) { return resolved.has(key); },
            clear: function (key) {
                if (key) resolved.delete(key);
                else resolved.clear();
            }
        });
    }

    return Object.freeze({ ASSETS, createClient, validate });
}));
