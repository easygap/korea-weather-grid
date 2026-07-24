/**
 * VWorld 공식 벡터 지도 API를 기존 OpenLayers 지도에 연결한다.
 * Base 래스터는 사용자 정의 투영으로 재투영하고, 보이는 traffic PBF만 현재 도법의
 * 일반 벡터 피처로 변환해 VectorTile의 사용자 정의 도법 제약을 피한다.
 */
(function () {
    'use strict';

    var State = window.WeatherGridVWorldState;
    if (!State) throw new Error('VWorld state must load first');

    var CONFIG_URL = '/api/runtime/map-config';
    var LOAD_TIMEOUT_MS = 6000;
    var ATTRIBUTION = '지도 © <a href="https://www.vworld.kr/" target="_blank" rel="noopener">VWorld</a>';
    var configPromise = null;
    var baseLayer = null;
    var vectorRoadLayer = null;
    var vectorRoadSource = null;
    var openLayersMap = null;
    var currentUrls = null;
    var vectorAbortController = null;
    var vectorLoadToken = 0;
    var requestToken = 0;
    var active = false;
    var status = 'idle';
    var unavailableDispatched = false;
    var VECTOR_TILE_LAYERS = Object.freeze([
        'vl_ex_hwrdcenl_l_0612',
        'vl_ex_cityhwrdcenl_l_0712',
        'vl_ex_nardcenl_l_0713',
        'vl_ex_localrdcenl_l_0713'
    ]);
    var WEB_MERCATOR_HALF = 20037508.342789244;
    var WEB_MERCATOR_WORLD = WEB_MERCATOR_HALF * 2;
    var MAX_VISIBLE_VECTOR_TILES = 24;
    var MIN_VECTOR_ZOOM = 9;

    var roadCasing = new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: 'rgba(7, 25, 46, .58)',
            width: 3.2,
            lineCap: 'round',
            lineJoin: 'round'
        }),
        zIndex: 1
    });
    var roadCenter = new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: 'rgba(255, 194, 92, .88)',
            width: 1.35,
            lineCap: 'round',
            lineJoin: 'round'
        }),
        zIndex: 2
    });
    var boundaryLine = new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: 'rgba(117, 217, 229, .55)',
            width: 1
        }),
        zIndex: 1
    });

    function updateStatus(next) {
        status = next;
        var output = document.getElementById('road_basemap_status');
        if (output) output.textContent = State.providerMessage(next);
    }

    function loadRuntimeConfig() {
        if (configPromise) return configPromise;
        configPromise = new Promise(function (resolve, reject) {
            var controller = new AbortController();
            var timeout = window.setTimeout(function () {
                controller.abort();
            }, LOAD_TIMEOUT_MS);
            fetch(CONFIG_URL, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
                signal: controller.signal
            }).then(function (response) {
                if (!response.ok) throw new Error('map runtime config unavailable');
                return response.json();
            }).then(function (payload) {
                resolve(State.runtimeConfig(payload));
            }).catch(reject).finally(function () {
                window.clearTimeout(timeout);
            });
        });
        return configPromise;
    }

    function probe(url) {
        var controller = new AbortController();
        var timeout = window.setTimeout(function () {
            controller.abort();
        }, LOAD_TIMEOUT_MS);
        return fetch(url, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            signal: controller.signal
        }).then(function (response) {
            var contentType = response.headers.get('Content-Type') || '';
            if (!response.ok || !/^image\/png\b/i.test(contentType)) {
                throw new Error('VWorld tile probe failed');
            }
        }).finally(function () {
            window.clearTimeout(timeout);
        });
    }

    function vectorRoadStyle(feature) {
        var geometry = feature && feature.getGeometry && feature.getGeometry();
        if (!geometry) return null;
        var type = geometry.getType();
        if (type !== 'LineString' && type !== 'MultiLineString') return null;
        var layerName = String(feature.get('layer') || '').toLowerCase();
        if (/bndry|boundary|ctln|coast|river|wtr/.test(layerName)) {
            return boundaryLine;
        }
        return [roadCasing, roadCenter];
    }

    function notifyUnavailable() {
        if (!active || unavailableDispatched) return;
        unavailableDispatched = true;
        active = false;
        setLayerVisibility(false);
        updateStatus('osm');
        window.dispatchEvent(new CustomEvent('weather-grid:vworld-unavailable'));
    }

    function setLayerVisibility(visible) {
        if (baseLayer) baseLayer.setVisible(visible);
        if (vectorRoadLayer) vectorRoadLayer.setVisible(visible);
    }

    function tileRange(mercatorExtent, zoom) {
        var count = Math.pow(2, zoom);
        var span = WEB_MERCATOR_WORLD / count;
        var minX = Math.max(0, Math.floor(
            (mercatorExtent[0] + WEB_MERCATOR_HALF) / span));
        var maxX = Math.min(count - 1, Math.floor(
            (mercatorExtent[2] + WEB_MERCATOR_HALF) / span));
        var minY = Math.max(0, Math.floor(
            (WEB_MERCATOR_HALF - mercatorExtent[3]) / span));
        var maxY = Math.min(count - 1, Math.floor(
            (WEB_MERCATOR_HALF - mercatorExtent[1]) / span));
        return {
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            span: span,
            count: Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1)
        };
    }

    function visibleVectorTiles(map, template) {
        var size = map.getSize();
        var view = map.getView();
        if (!size || !size[0] || !size[1] || !view) return null;
        var projection = view.getProjection();
        var mercatorExtent = ol.proj.transformExtent(
            view.calculateExtent(size), projection, 'EPSG:3857', 16);
        var resolution = Math.max(
            (mercatorExtent[2] - mercatorExtent[0]) / size[0],
            (mercatorExtent[3] - mercatorExtent[1]) / size[1]);
        var zoom = Math.max(MIN_VECTOR_ZOOM, Math.min(13, Math.round(
            Math.log(WEB_MERCATOR_WORLD / (256 * resolution)) / Math.LN2
        )));
        var range = tileRange(mercatorExtent, zoom);
        while (zoom > MIN_VECTOR_ZOOM && range.count > MAX_VISIBLE_VECTOR_TILES) {
            zoom--;
            range = tileRange(mercatorExtent, zoom);
        }
        if (range.count > MAX_VISIBLE_VECTOR_TILES) {
            return { projection: projection.getCode(), tiles: [] };
        }
        var tiles = [];
        for (var x = range.minX; x <= range.maxX; x++) {
            for (var y = range.minY; y <= range.maxY; y++) {
                tiles.push({
                    url: template.replace('{z}', zoom)
                        .replace('{x}', x).replace('{y}', y),
                    extent: [
                        -WEB_MERCATOR_HALF + x * range.span,
                        WEB_MERCATOR_HALF - (y + 1) * range.span,
                        -WEB_MERCATOR_HALF + (x + 1) * range.span,
                        WEB_MERCATOR_HALF - y * range.span
                    ]
                });
            }
        }
        return {
            projection: projection.getCode(),
            tiles: tiles
        };
    }

    function loadVectorRoads() {
        if (!active || !openLayersMap || !currentUrls || !vectorRoadSource) {
            return Promise.resolve(false);
        }
        var token = ++vectorLoadToken;
        if (vectorAbortController) {
            vectorAbortController.abort();
            vectorAbortController = null;
        }
        var plan = visibleVectorTiles(openLayersMap, currentUrls.traffic);
        if (!plan) return Promise.resolve(false);
        if (!plan.tiles.length) {
            vectorRoadSource.clear(true);
            return Promise.resolve(true);
        }
        vectorAbortController = new AbortController();
        var signal = vectorAbortController.signal;
        var format = new ol.format.MVT({
            featureClass: ol.Feature,
            layers: VECTOR_TILE_LAYERS
        });

        return Promise.allSettled(plan.tiles.map(function (tile) {
            return fetch(tile.url, {
                method: 'GET',
                mode: 'cors',
                cache: 'default',
                signal: signal
            }).then(function (response) {
                var contentType = response.headers.get('Content-Type') || '';
                if (!response.ok || !/application\/(?:x-protobuf|octet-stream)/i.test(contentType)) {
                    throw new Error('VWorld vector tile unavailable');
                }
                return response.arrayBuffer();
            }).then(function (buffer) {
                return format.readFeatures(buffer, {
                    extent: tile.extent,
                    featureProjection: plan.projection
                });
            });
        })).then(function (results) {
            if (token !== vectorLoadToken || !active) return false;
            var successes = 0;
            var features = [];
            results.forEach(function (result) {
                if (result.status !== 'fulfilled') return;
                successes++;
                Array.prototype.push.apply(features, result.value);
            });
            if (!successes) {
                notifyUnavailable();
                return false;
            }
            vectorRoadSource.clear(true);
            if (features.length) vectorRoadSource.addFeatures(features);
            return true;
        });
    }

    function ensureLayers(map, urls) {
        if (baseLayer && openLayersMap === map) return;
        openLayersMap = map;
        currentUrls = urls;

        var baseSource = new ol.source.XYZ({
            url: urls.base,
            projection: 'EPSG:3857',
            tileSize: 256,
            crossOrigin: 'anonymous',
            wrapX: false,
            attributions: ATTRIBUTION
        });
        baseLayer = new ol.layer.Tile({
            title: 'vworld-base',
            source: baseSource,
            visible: false,
            opacity: 0.94
        });
        baseLayer.setZIndex(10);
        map.addLayer(baseLayer);

        vectorRoadSource = new ol.source.Vector({
            wrapX: false,
            attributions: ATTRIBUTION
        });
        vectorRoadLayer = new ol.layer.Vector({
            title: 'vworld-vector-roads',
            source: vectorRoadSource,
            style: vectorRoadStyle,
            declutter: true,
            visible: false,
            opacity: 0.8
        });
        vectorRoadLayer.setZIndex(11);
        map.addLayer(vectorRoadLayer);
        map.on('moveend', function () {
            loadVectorRoads();
        });
    }

    function show(map) {
        var token = ++requestToken;
        updateStatus('loading');
        return loadRuntimeConfig().then(function (config) {
            if (!config.enabled) throw new Error('VWorld API key unavailable');
            var urls = State.tileUrls(config.key);
            if (!urls) throw new Error('VWorld tile URL unavailable');
            return probe(urls.probe).then(function () {
                if (token !== requestToken) return false;
                ensureLayers(map, urls);
                unavailableDispatched = false;
                active = true;
                setLayerVisibility(true);
                updateStatus('vworld');
                map.render();
                loadVectorRoads();
                return true;
            });
        }).catch(function () {
            if (token === requestToken) {
                active = false;
                setLayerVisibility(false);
                updateStatus('osm');
            }
            return false;
        });
    }

    function hide() {
        requestToken++;
        vectorLoadToken++;
        active = false;
        if (vectorAbortController) {
            vectorAbortController.abort();
            vectorAbortController = null;
        }
        setLayerVisibility(false);
        updateStatus('idle');
    }

    function diagnostics() {
        return Object.freeze({
            active: active,
            status: status,
            baseLayerReady: Boolean(baseLayer),
            vectorLayerReady: Boolean(vectorRoadLayer),
            renderedVectorFeatures: vectorRoadSource
                ? vectorRoadSource.getFeatures().length : 0
        });
    }

    window.WeatherGridVWorldBasemap = Object.freeze({
        show: show,
        hide: hide,
        diagnostics: diagnostics
    });
}());
