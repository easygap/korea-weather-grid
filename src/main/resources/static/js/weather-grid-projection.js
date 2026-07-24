/**
 * 도법 선택 사건을 OpenLayers 뷰 교체와 레이어 재투영 효과로 연결한다.
 */
(function () {
    'use strict';

    var stateModel = window.WeatherGridMapState;
    var runtime = window.WeatherGridMapRuntime;
    var navigation = window.WeatherGridNavigation;
    if (!stateModel || !runtime || !navigation) {
        throw new Error('Map state, runtime and navigation must load before weather-grid-projection');
    }

    var map = runtime.map;
    var geographicLimit = (window.WEATHER_GRID_GEO_LIMIT_EXTENT || [116, 29, 140, 46]).slice();
    var reprojectors = [];

    function vectorSource(data, code) {
        return new ol.source.Vector({
            features: new ol.format.GeoJSON().readFeatures(data, {
                dataProjection: 'EPSG:4326',
                featureProjection: code
            })
        });
    }

    function rebuildCoreLayers(code) {
        var layers = runtime.coreLayers();
        var land = window.WeatherGridGeodata.peek('eastAsiaLand');
        var admin1 = window.WeatherGridGeodata.peek('koreaAdmin1');
        if (land && layers.weatherBasemap) layers.weatherBasemap.setSource(vectorSource(land, code));
        if (land && admin1 && layers.boundaries) layers.boundaries.setSource(vectorSource(land, code));
        if (admin1 && layers.provinces) layers.provinces.setSource(vectorSource(admin1, code));

        var stationLayer = runtime.stationLayer();
        if (!stationLayer) return;
        var stationFeatures = runtime.stationAnchors().map(function (station) {
            return new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.transform(
                    [station.lon, station.lat], 'EPSG:4326', code)),
                stn_name: station.name,
                latitude: station.lat,
                longitude: station.lon
            });
        });
        var stationSource = stationLayer.getSource();
        if (!stationSource) return;
        stationSource.clear(true);
        stationSource.addFeatures(stationFeatures);
    }

    reprojectors.push(rebuildCoreLayers);

    function projectionControlsBusy(busy) {
        var segment = document.getElementById('seg_proj');
        if (!segment) return;
        segment.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function hazardViewActive() {
        var app = document.querySelector('.app');
        return Boolean(app && app.dataset.exploreMode === 'hazards');
    }

    function runReprojectors(code) {
        var failures = [];
        reprojectors.slice().forEach(function (reproject, index) {
            try { reproject(code); } catch (error) { failures.push(index); }
        });
        return Object.freeze(failures);
    }

    function request(code, source) {
        var transition = stateModel.projectionTransition(window.WEATHER_GRID_VIEW_PROJ, code);
        if (!transition.accepted) return false;
        navigation.projection.sync(transition.code);
        if (!transition.changed) return false;

        var oldView = map.getView();
        projectionControlsBusy(true);
        document.dispatchEvent(new CustomEvent('weather-grid:projection-changing', {
            detail: Object.freeze({
                previousCode: transition.previousCode,
                code: transition.code,
                source: source || 'api'
            })
        }));

        try {
            var visibleGeographicExtent = ol.proj.transformExtent(
                oldView.calculateExtent(map.getSize()), oldView.getProjection(), 'EPSG:4326');
            var newView = new ol.View({
                projection: transition.code,
                extent: ol.proj.transformExtent(geographicLimit, 'EPSG:4326', transition.code, 16),
                constrainOnlyCenter: true,
                showFullExtent: true,
                smoothResolutionConstraint: true,
                constrainResolution: false,
                enableRotation: false
            });
            map.setView(newView);
            newView.fit(ol.proj.transformExtent(
                visibleGeographicExtent, 'EPSG:4326', transition.code), { size: map.getSize() });
            var limits = stateModel.viewLimits(newView.getZoom(), hazardViewActive());
            newView.setMinZoom(limits.minZoom);
            newView.setMaxZoom(limits.maxZoom);
            window.WEATHER_GRID_VIEW_PROJ = transition.code;

            var failedReprojectors = runReprojectors(transition.code);
            var detail = Object.freeze({
                previousCode: transition.previousCode,
                code: transition.code,
                source: source || 'api',
                failedReprojectors: failedReprojectors
            });
            document.dispatchEvent(new CustomEvent('weather-grid:projection-changed', { detail: detail }));
            if (typeof window.refreshWeatherGrid === 'function') window.refreshWeatherGrid();
            return true;
        } catch (error) {
            map.setView(oldView);
            window.WEATHER_GRID_VIEW_PROJ = transition.previousCode;
            navigation.projection.sync(transition.previousCode);
            document.dispatchEvent(new CustomEvent('weather-grid:projection-failed', {
                detail: Object.freeze({
                    previousCode: transition.previousCode,
                    requestedCode: transition.code,
                    source: source || 'api'
                })
            }));
            return false;
        } finally {
            projectionControlsBusy(false);
        }
    }

    function registerReprojector(reproject) {
        if (typeof reproject !== 'function' || reprojectors.indexOf(reproject) >= 0) return function () {};
        reprojectors.push(reproject);
        return function () {
            var index = reprojectors.indexOf(reproject);
            if (index >= 0) reprojectors.splice(index, 1);
        };
    }

    document.addEventListener('weather-grid:projection-requested', function (event) {
        request(event.detail.code, event.detail.source);
    });

    window.WeatherGridProjection = Object.freeze({
        request: request,
        registerReprojector: registerReprojector,
        current: function () { return window.WEATHER_GRID_VIEW_PROJ; }
    });
}());
