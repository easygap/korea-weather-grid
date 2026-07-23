/**
 * 주요 대교·공항·항만 데이터를 지도 벡터 레이어와 접근 가능한 선택 동작에 연결한다.
 */
(function () {
    'use strict';

    var stateModel = window.WeatherGridInfrastructureState;
    var runtime = window.WeatherGridMapRuntime;
    var projectionController = window.WeatherGridProjection;
    var dataCatalog = window.WeatherGridInfrastructureData || {};
    var overlayRouter = window.WEATHER_GRID_OVERLAY_ROUTER;
    if (!stateModel || !runtime || !projectionController || !overlayRouter) {
        throw new Error('Infrastructure state, map runtime, projection and overlay router must load first');
    }

    var map = runtime.map;
    var entries = {};
    var available = {};
    stateModel.keys.forEach(function (key) {
        var data = dataCatalog[key];
        available[key] = Boolean(data && data.type === 'FeatureCollection'
            && Array.isArray(data.features) && data.features.length);
    });
    var currentState = stateModel.initial({ available: available });

    function cssColor(token, fallback) {
        var value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        return value || fallback;
    }

    function markerColors(meta) {
        var fallbacks = { bridge: '#f6c453', airport: '#5fd3ff', port: '#5ee6b8' };
        return Object.freeze({
            marker: cssColor(meta.colorToken, fallbacks[meta.key]),
            stroke: cssColor('--infrastructure-marker-stroke', '#07111f'),
            label: cssColor('--text', '#e6edf6'),
            halo: cssColor('--infrastructure-label-halo', 'rgba(5,10,20,.92)')
        });
    }

    function representativeCoordinate(feature) {
        var geometry = feature && feature.getGeometry ? feature.getGeometry() : null;
        if (!geometry) return null;
        if (geometry.getType() === 'Point') return geometry.getCoordinates();
        if (geometry.getType() === 'LineString') return geometry.getCoordinateAt(0.5);
        return null;
    }

    function labelStyle(name, colors) {
        return new ol.style.Text({
            text: name,
            font: '700 12px system-ui, sans-serif',
            fill: new ol.style.Fill({ color: colors.label }),
            stroke: new ol.style.Stroke({ color: colors.halo, width: 3 }),
            offsetY: -14,
            overflow: true
        });
    }

    function layerStyle(meta) {
        var colors = markerColors(meta);
        var marker = new ol.style.RegularShape({
            points: meta.points,
            radius: meta.radius,
            angle: meta.angle,
            fill: new ol.style.Fill({ color: colors.marker }),
            stroke: new ol.style.Stroke({ color: colors.stroke, width: 1.5 })
        });
        var line = new ol.style.Style({
            stroke: new ol.style.Stroke({ color: colors.marker, width: 4, lineCap: 'round' })
        });
        var pointPlain = Object.freeze([new ol.style.Style({ image: marker })]);
        var cache = new WeakMap();

        return function (feature, resolution) {
            var geometry = feature.getGeometry();
            var name = String(feature.get('name') || '');
            var projection = map.getView().getProjection();
            var withLabel = stateModel.labelsVisible(resolution, projection.getUnits());
            var cached = cache.get(feature);
            if (!cached || cached.geometry !== geometry || cached.name !== name) {
                var markerStyle = new ol.style.Style({
                    geometry: geometry.getType() === 'LineString'
                        ? new ol.geom.Point(geometry.getCoordinateAt(0.5)) : geometry,
                    image: marker
                });
                var markerWithLabel = new ol.style.Style({
                    geometry: markerStyle.getGeometry(),
                    image: marker,
                    text: labelStyle(name, colors)
                });
                cached = {
                    geometry: geometry,
                    name: name,
                    plain: geometry.getType() === 'LineString' ? [line, markerStyle] : pointPlain,
                    labeled: geometry.getType() === 'LineString' ? [line, markerWithLabel] : [markerWithLabel]
                };
                cache.set(feature, cached);
            }
            return withLabel ? cached.labeled : cached.plain;
        };
    }

    function vectorSource(key, data, projectionCode) {
        var features = new ol.format.GeoJSON().readFeatures(data, {
            dataProjection: 'EPSG:4326',
            featureProjection: projectionCode
        }).filter(function (feature) {
            var projected = representativeCoordinate(feature);
            if (!projected) return false;
            var geographic = ol.proj.transform(projected, projectionCode, 'EPSG:4326');
            var location = stateModel.location(key, feature.get('name'), geographic[0], geographic[1]);
            if (!location) return false;
            feature.setProperties({
                kind: 'infrastructure',
                infrastructureKind: key,
                stn_name: location.name,
                latitude: location.latitude,
                longitude: location.longitude
            }, true);
            return true;
        });
        return new ol.source.Vector({ features: features });
    }

    function syncButton(key) {
        var button = document.getElementById('infra_' + key);
        if (!button) return;
        var exists = currentState.available[key];
        var visible = exists && currentState.visible[key];
        button.hidden = !exists;
        button.disabled = !exists;
        button.classList.toggle('clicked', visible);
        button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    }

    function visibleKeys() {
        return Object.freeze(stateModel.keys.filter(function (key) { return currentState.visible[key]; }));
    }

    function dispatchChange(key, visible, source) {
        document.dispatchEvent(new CustomEvent('weather-grid:infrastructure-changed', {
            detail: Object.freeze({
                key: key,
                visible: visible,
                visibleKeys: visibleKeys(),
                source: source || 'api'
            })
        }));
    }

    function update(event, source) {
        var result = stateModel.transition(currentState, event);
        if (!result.effects.length) return false;
        currentState = result.state;
        result.effects.forEach(function (effect) {
            var entry = entries[effect.key];
            if (entry) entry.layer.setVisible(effect.visible);
            syncButton(effect.key);
            dispatchChange(effect.key, effect.visible, source);
        });
        return true;
    }

    stateModel.keys.forEach(function (key) {
        var meta = stateModel.catalog[key];
        var data = dataCatalog[key];
        if (available[key]) {
            var layer = new ol.layer.Vector({
                title: 'infrastructure_' + key,
                source: vectorSource(key, data, projectionController.current()),
                style: layerStyle(meta),
                declutter: true,
                visible: false
            });
            layer.setZIndex(meta.zIndex);
            map.addLayer(layer);
            entries[key] = Object.freeze({ data: data, layer: layer, meta: meta });
        }
        var button = document.getElementById('infra_' + key);
        if (button) {
            button.addEventListener('click', function () {
                update({ type: 'toggle', key: key }, 'control');
            });
        }
        syncButton(key);
    });

    function featureLocation(feature) {
        if (!feature || feature.get('kind') !== 'infrastructure') return null;
        return stateModel.location(
            feature.get('infrastructureKind'), feature.get('stn_name'),
            Number(feature.get('longitude')), Number(feature.get('latitude')));
    }

    function requestForecast(feature) {
        var location = featureLocation(feature);
        if (!location) return false;
        document.dispatchEvent(new CustomEvent('weather-grid:location-forecast-requested', {
            detail: location
        }));
        return true;
    }

    function nearestVisibleFeature() {
        var size = map.getSize();
        if (!size || size[0] <= 0 || size[1] <= 0) return null;
        var center = [size[0] / 2, size[1] / 2];
        var nearest = null;
        stateModel.keys.forEach(function (key) {
            var entry = entries[key];
            if (!entry || !currentState.visible[key]) return;
            entry.layer.getSource().getFeatures().forEach(function (feature) {
                var coordinate = representativeCoordinate(feature);
                var pixel = coordinate && map.getPixelFromCoordinate(coordinate);
                if (!pixel || pixel[0] < 0 || pixel[1] < 0 || pixel[0] > size[0] || pixel[1] > size[1]) return;
                var distance = Math.hypot(pixel[0] - center[0], pixel[1] - center[1]);
                if (!nearest || distance < nearest.distance) nearest = { feature: feature, distance: distance };
            });
        });
        if (!nearest) return null;
        return Object.freeze({
            distance: nearest.distance,
            activate: function () { requestForecast(nearest.feature); }
        });
    }

    overlayRouter.register('infrastructure', {
        enabled: function () { return visibleKeys().length > 0; },
        openFeature: requestForecast,
        nearest: nearestVisibleFeature,
        close: function () {}
    });

    projectionController.registerReprojector(function (projectionCode) {
        stateModel.keys.forEach(function (key) {
            var entry = entries[key];
            if (entry) entry.layer.setSource(vectorSource(key, entry.data, projectionCode));
        });
    });

    document.addEventListener('weather-grid:theme-changed', function () {
        stateModel.keys.forEach(function (key) {
            var entry = entries[key];
            if (!entry) return;
            entry.layer.setStyle(layerStyle(entry.meta));
            entry.layer.changed();
        });
    });

    window.WeatherGridInfrastructure = Object.freeze({
        state: function () { return currentState; },
        isVisible: function (key) { return Boolean(currentState.visible[key]); },
        setVisible: function (key, visible) {
            return update({ type: 'set', key: key, visible: visible }, 'api');
        },
        toggle: function (key) { return update({ type: 'toggle', key: key }, 'api'); },
        layer: function (key) { return entries[key] ? entries[key].layer : null; }
    });
}());
