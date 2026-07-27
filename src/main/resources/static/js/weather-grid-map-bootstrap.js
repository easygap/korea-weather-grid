/**
 * 공개 지도 상수와 배경지도 상태를 OpenLayers 인스턴스에 연결한다.
 */
(function () {
    'use strict';

    var State = window.WeatherGridBasemapState;
    var VWorldBasemap = window.WeatherGridVWorldBasemap;
    var DfsProjection = window.WeatherGridDfsProjection;
    if (!State || !DfsProjection || !window.ol || !window.proj4
            || !window.WeatherGridGeodata) {
        throw new Error('Basemap state, DFS projection, OpenLayers, proj4 and geodata must load first');
    }

    var PROJECTION_CODE = DfsProjection.code;
    proj4.defs(PROJECTION_CODE, DfsProjection.proj4Definition);
    ol.proj.proj4.register(proj4);

    // 지리 범위는 도법에 등록하되 표시 범위는 각 View에서 제한한다.
    // 도법 extent를 지역 범위로 축소하면 OpenLayers의 줌 0 축척도 함께 바뀐다.
    var lccProjection = ol.proj.get(PROJECTION_CODE);
    var lccExtent = ol.proj.transformExtent(
        State.geographicLimit, 'EPSG:4326', PROJECTION_CODE, 16);
    lccProjection.setWorldExtent(State.geographicLimit.slice());

    var compactQuery = window.matchMedia('(max-width: 900px)');
    var finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    var basemapState = State.initialState(compactQuery.matches);
    var stationAnchors = [];
    var vectorDataPromise = null;
    var selectedStationName = '';
    var hoveredStationFeature = null;
    var lastHoverCheck = 0;
    var roadProviderToken = 0;

    window.WEATHER_GRID_VIEW_PROJ = PROJECTION_CODE;
    window.WEATHER_GRID_GEO_LIMIT_EXTENT = State.geographicLimit.slice();
    window.WEATHER_GRID_INITIAL_GEO_EXTENT = State.initialGeoExtent(false);
    window.WEATHER_GRID_COMPACT_INITIAL_GEO_EXTENT = State.initialGeoExtent(true);
    window.initialViewPadding = function () {
        return State.initialPadding(window.innerWidth);
    };

    var mapPixelRatio = State.pixelRatio({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        screenWidth: window.screen && window.screen.width,
        screenHeight: window.screen && window.screen.height,
        devicePixelRatio: window.devicePixelRatio,
        maxPixels: State.maxRenderPixels
    });

    var initialView = new ol.View({
        projection: PROJECTION_CODE,
        extent: lccExtent.slice(),
        constrainOnlyCenter: true,
        showFullExtent: true,
        center: ol.proj.transform([127.8, 38], 'EPSG:4326', PROJECTION_CODE),
        zoom: 6.5,
        minZoom: 5.5,
        maxZoom: 12.5,
        smoothResolutionConstraint: true,
        constrainResolution: false,
        enableRotation: false
    });

    var map = new ol.Map({
        pixelRatio: mapPixelRatio,
        view: initialView,
        target: 'map',
        layers: []
    });

    var streetLayer = new ol.layer.Tile({
        title: 'api',
        source: new ol.source.OSM({ crossOrigin: 'anonymous' })
    });
    var landLayer = new ol.layer.Vector({
        title: 'base-land',
        source: new ol.source.Vector()
    });
    var rasterLayer = new ol.layer.Image({
        title: 'img',
        opacity: 0.7
    });
    var countryLayer = createVectorLayer('vector', 25);
    var provinceLayer = createVectorLayer('province', 30);
    var stationSource = new ol.source.Vector();

    [
        { layer: streetLayer, zIndex: 10, visible: false },
        { layer: landLayer, zIndex: 20, visible: true },
        { layer: rasterLayer, zIndex: 70, visible: true }
    ].forEach(function (entry) {
        map.addLayer(entry.layer);
        entry.layer.setZIndex(entry.zIndex);
        entry.layer.setVisible(entry.visible);
    });

    function createVectorLayer(title, zIndex) {
        var layer = new ol.layer.Vector({ title: title, source: new ol.source.Vector() });
        layer.setZIndex(zIndex);
        layer.setVisible(false);
        map.addLayer(layer);
        return layer;
    }

    function nodeStyles(radius, coreColor, zIndex, haloColor) {
        var styles = [];
        if (haloColor) {
            styles.push(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius + 4.5,
                    fill: new ol.style.Fill({ color: haloColor })
                }),
                zIndex: zIndex
            }));
        }
        styles.push(
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius,
                    fill: new ol.style.Fill({ color: '#f7fafc' }),
                    stroke: new ol.style.Stroke({ color: '#07192e', width: 1.5 })
                }),
                zIndex: zIndex + 1
            }),
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: Math.max(1.8, radius * 0.45),
                    fill: new ol.style.Fill({ color: coreColor })
                }),
                zIndex: zIndex + 2
            })
        );
        return styles;
    }

    function stationRadius(zoom, compact) {
        var bucket = Math.round(Math.max(6, Math.min(10, zoom)) * 4) / 4;
        var progress = (bucket - 6) / 4;
        return (compact ? 3.9 : 3.6) + progress * (compact ? 2.4 : 2.7);
    }

    var dotStyles = new Map();
    var hoverStyles = new Map();
    var labelStyles = new Map();
    var selectedStyles = nodeStyles(8, '#a99af7', 100, 'rgba(169, 154, 247, .2)');

    function cachedNodeStyles(cache, prefix, zoom, compact, hovered) {
        var bucket = Math.round(Math.max(6, Math.min(10, zoom)) * 4) / 4;
        var key = prefix + ':' + (compact ? 'compact:' : 'desktop:') + bucket;
        if (cache.has(key)) return cache.get(key);
        var radius = stationRadius(bucket, compact) + (hovered ? 1.2 : 0);
        var styles = nodeStyles(
            hovered ? Math.min(7.2, radius) : radius,
            '#75d9e5',
            hovered ? 20 : 2,
            hovered ? 'rgba(117, 217, 229, .16)' : ''
        );
        cache.set(key, styles);
        return styles;
    }

    function labelStyle(name, selected) {
        var key = (selected ? 'selected:' : 'hovered:') + name;
        if (labelStyles.has(key)) return labelStyles.get(key);
        var style = new ol.style.Style({
            text: new ol.style.Text({
                text: name,
                font: '700 11px system-ui, sans-serif',
                offsetY: selected ? -28 : -24,
                padding: [5, 8, 5, 8],
                fill: new ol.style.Fill({ color: '#f7fafc' }),
                backgroundFill: new ol.style.Fill({ color: 'rgba(7, 25, 46, .94)' }),
                backgroundStroke: new ol.style.Stroke({
                    color: 'rgba(247, 250, 252, .2)',
                    width: 1
                })
            }),
            zIndex: selected ? 103 : 23
        });
        labelStyles.set(key, style);
        return style;
    }

    var stationLayer = new ol.layer.Vector({
        source: stationSource,
        title: 'forecast-stations',
        declutter: true,
        style: function (feature) {
            var name = feature.get('stn_name') || '';
            if (name && name === selectedStationName) {
                return selectedStyles.concat(labelStyle(name, true));
            }
            var zoom = map.getView().getZoom() || 6;
            if (feature === hoveredStationFeature) {
                return cachedNodeStyles(
                    hoverStyles, 'hover', zoom, compactQuery.matches, true)
                    .concat(labelStyle(name, false));
            }
            return cachedNodeStyles(dotStyles, 'dot', zoom, compactQuery.matches, false);
        }
    });
    map.addLayer(stationLayer);
    stationLayer.setZIndex(100);
    stationLayer.setVisible(basemapState.stationsVisible);

    function updateStationToggle() {
        var button = document.getElementById('weather_stations');
        if (!button) return;
        button.classList.toggle('clicked', basemapState.stationsVisible);
        button.setAttribute('aria-pressed', String(basemapState.stationsVisible));
    }
    updateStationToggle();

    function setSelectedStationName(name) {
        var next = typeof name === 'string' ? name : '';
        if (selectedStationName === next) return;
        selectedStationName = next;
        stationLayer.changed();
    }

    compactQuery.addEventListener('change', function () {
        stationLayer.changed();
    });

    if (finePointerQuery.matches) {
        map.on('pointermove', function (event) {
            var now = performance.now();
            if (!event.dragging && now - lastHoverCheck < 80) return;
            lastHoverCheck = now;
            var measuring = window.WEATHER_GRID_MEASURE
                && window.WEATHER_GRID_MEASURE.isActive();
            var next = measuring || event.dragging || !stationLayer.getVisible() ? null
                : map.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
                    return layer === stationLayer ? feature : undefined;
                }, { hitTolerance: 7 });
            if (next === hoveredStationFeature) return;
            hoveredStationFeature = next || null;
            stationLayer.changed();
            map.getTargetElement().style.cursor = hoveredStationFeature ? 'pointer' : '';
        });
    }

    function vectorSource(data, projection) {
        return new ol.source.Vector({
            features: new ol.format.GeoJSON().readFeatures(data, {
                dataProjection: 'EPSG:4326',
                featureProjection: projection
            })
        });
    }

    function anchorsFromAdminData(data, projection) {
        return vectorSource(data, projection).getFeatures().map(function (feature) {
            var geometry = feature.getGeometry();
            var interior = null;
            if (geometry.getType() === 'Polygon') {
                interior = geometry.getInteriorPoint().getCoordinates();
            } else if (geometry.getType() === 'MultiPolygon') {
                interior = geometry.getInteriorPoints().getCoordinates().reduce(function (best, item) {
                    return !best || (item[2] || 0) > (best[2] || 0) ? item : best;
                }, null);
            }
            if (!interior) return null;
            var lonLat = ol.proj.transform(
                interior.slice(0, 2), projection, 'EPSG:4326');
            return {
                name: feature.get('nameKo'),
                lon: lonLat[0],
                lat: lonLat[1]
            };
        }).filter(function (item) {
            return item && typeof item.name === 'string'
                && Number.isFinite(item.lon) && Number.isFinite(item.lat);
        }).sort(function (left, right) {
            return left.name.localeCompare(right.name, 'ko');
        });
    }

    function stationFeatures(items, projection) {
        return items.map(function (item) {
            return new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.transform(
                    [item.lon, item.lat], 'EPSG:4326', projection)),
                stn_name: item.name,
                latitude: item.lat,
                longitude: item.lon
            });
        });
    }

    function setLayerStyle(layer, fillColor, strokeColor, textField, palette) {
        var fill = fillColor ? new ol.style.Fill({ color: fillColor }) : undefined;
        var stroke = strokeColor
            ? new ol.style.Stroke({ color: strokeColor, width: 1 }) : undefined;
        if (!textField) {
            layer.setStyle(new ol.style.Style({ fill: fill, stroke: stroke }));
            return;
        }

        var labelFill = new ol.style.Fill({ color: palette.label });
        var labelHalo = new ol.style.Stroke({ color: palette.halo, width: 3 });
        var stylesByFeature = new WeakMap();
        layer.setStyle(function (feature) {
            var text = feature.get(textField);
            var cached = stylesByFeature.get(feature);
            if (cached && cached.text === text) return cached.style;
            var style = new ol.style.Style({
                fill: fill,
                stroke: stroke,
                text: new ol.style.Text({
                    font: '600 12px system-ui, sans-serif',
                    fill: labelFill,
                    stroke: labelHalo,
                    text: text
                })
            });
            stylesByFeature.set(feature, { text: text, style: style });
            return style;
        });
    }

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light'
            ? 'light' : 'dark';
    }

    function applyThemeStyles() {
        var plan = State.stylePlan(basemapState, currentTheme());
        if (basemapState.mode === 'boundaries') {
            setLayerStyle(
                countryLayer, plan.vector.fill, plan.vector.stroke, null, plan.palette);
            setLayerStyle(
                provinceLayer,
                null,
                plan.provinces.stroke,
                plan.provinces.labelField,
                plan.palette
            );
        } else {
            setLayerStyle(
                landLayer, plan.weather.fill, plan.weather.stroke, null, plan.palette);
        }
    }
    window.applyMapThemeStyles = applyThemeStyles;

    function markSelectedMode() {
        document.querySelectorAll('#basemap_choices [id^="basemap_"]').forEach(function (button) {
            var selected = button.id === 'basemap_' + basemapState.mode;
            button.classList.toggle('is-selected-basemap', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
    }

    function updateBoundaryToggle(id, active) {
        var button = document.getElementById(id);
        if (!button) return;
        button.classList.toggle('clicked', active);
        button.setAttribute('aria-pressed', String(active));
    }

    function updateRoadProvider(provider) {
        var button = document.getElementById('basemap_streets');
        if (button) {
            button.dataset.provider = provider;
            button.setAttribute('aria-label', {
                loading: 'VWorld 도로 배경지도 불러오는 중',
                vworld: 'VWorld 벡터 도로 배경지도',
                osm: 'OpenStreetMap 도로 배경지도'
            }[provider] || '도로 배경지도');
        }
    }

    function applyRoadProvider(visible) {
        var token = ++roadProviderToken;
        if (!visible) {
            streetLayer.setVisible(false);
            if (VWorldBasemap) VWorldBasemap.hide();
            updateRoadProvider('idle');
            return;
        }

        streetLayer.setVisible(true);
        updateRoadProvider('loading');
        if (!VWorldBasemap) {
            updateRoadProvider('osm');
            return;
        }
        VWorldBasemap.show(map).then(function (vworldActive) {
            if (token !== roadProviderToken || basemapState.mode !== 'streets') return;
            streetLayer.setVisible(!vworldActive);
            updateRoadProvider(vworldActive ? 'vworld' : 'osm');
            map.render();
        });
    }

    window.addEventListener('weather-grid:vworld-unavailable', function () {
        if (basemapState.mode !== 'streets') return;
        streetLayer.setVisible(true);
        updateRoadProvider('osm');
        map.render();
    });

    function applyBasemapState() {
        var visibility = State.layerVisibility(basemapState.mode);
        if (!visibility) return false;
        landLayer.setVisible(visibility.weather);
        countryLayer.setVisible(visibility.boundaries);
        provinceLayer.setVisible(visibility.boundaries);
        applyRoadProvider(visibility.streets);
        stationLayer.setVisible(basemapState.stationsVisible);

        var labelControls = document.getElementById('region_label_controls');
        var boundaryControls = document.getElementById('province_boundary_controls');
        if (labelControls) {
            labelControls.style.display = visibility.boundaries ? 'block' : 'none';
        }
        if (boundaryControls) {
            boundaryControls.style.display = visibility.boundaries ? 'block' : 'none';
        }

        var mapElement = document.getElementById('map');
        mapElement.classList.toggle('map-weather', visibility.weather);
        mapElement.classList.toggle('map-boundaries', visibility.boundaries);
        markSelectedMode();
        updateBoundaryToggle('region_label_toggle', basemapState.regionLabels);
        updateBoundaryToggle(
            'province_boundary_toggle', basemapState.provinceBoundaries);
        updateStationToggle();
        applyThemeStyles();
        return true;
    }

    function selectMode(mode) {
        var next = State.selectMode(basemapState, mode);
        if (next === basemapState) return false;
        basemapState = next;
        return applyBasemapState();
    }

    function reportDataError(message) {
        if (typeof window.setDataError === 'function') {
            window.setDataError(message, 'geodata');
            return;
        }
        var banner = document.getElementById('data_error');
        if (!banner) return;
        var text = banner.querySelector('[data-error-message], span');
        if (text) text.textContent = message;
        banner.dataset.errorSource = 'geodata';
        banner.hidden = false;
    }

    function clearGeodataError() {
        if (typeof window.clearDataError === 'function') {
            window.clearDataError('geodata');
            return;
        }
        var banner = document.getElementById('data_error');
        if (!banner || banner.dataset.errorSource !== 'geodata') return;
        banner.hidden = true;
        delete banner.dataset.errorSource;
    }

    function ensureVectorMapData() {
        if (vectorDataPromise) return vectorDataPromise;
        vectorDataPromise = Promise.all([
            window.WeatherGridGeodata.load('eastAsiaLand'),
            window.WeatherGridGeodata.load('koreaAdmin1')
        ]).then(function (datasets) {
            var projection = window.WEATHER_GRID_VIEW_PROJ || PROJECTION_CODE;
            countryLayer.setSource(vectorSource(datasets[0], projection));
            provinceLayer.setSource(vectorSource(datasets[1], projection));
            applyThemeStyles();
            return datasets;
        }).catch(function (error) {
            vectorDataPromise = null;
            throw error;
        });
        return vectorDataPromise;
    }
    window.ensureVectorMapData = ensureVectorMapData;

    function loadInitialGeodata() {
        window.WEATHER_GRID_GEODATA_READY = window.WeatherGridGeodata.loadInitial()
            .then(function (datasets) {
                var projection = window.WEATHER_GRID_VIEW_PROJ || PROJECTION_CODE;
                landLayer.setSource(vectorSource(datasets[0], projection));
                stationAnchors = anchorsFromAdminData(datasets[1], projection);
                stationSource.clear(true);
                stationSource.addFeatures(stationFeatures(stationAnchors, projection));
                applyThemeStyles();
                clearGeodataError();
                document.dispatchEvent(new CustomEvent('weather-grid:stations-changed', {
                    detail: Object.freeze({ count: stationAnchors.length })
                }));
                return datasets;
            }).catch(function (error) {
                reportDataError('기본 지도와 대표 지역 정보를 불러오지 못했습니다.');
                console.error('초기 지도 데이터를 불러오지 못했습니다.', error);
                throw error;
            });
        return window.WEATHER_GRID_GEODATA_READY;
    }
    window.WEATHER_GRID_RETRY_GEODATA = loadInitialGeodata;

    function routedOverlayFeature(feature) {
        if (window.WEATHER_GRID_OVERLAY_ROUTER
                && typeof window.WEATHER_GRID_OVERLAY_ROUTER.handlesFeature === 'function') {
            return window.WEATHER_GRID_OVERLAY_ROUTER.handlesFeature(feature);
        }
        var properties = feature && feature.getProperties ? feature.getProperties() : {};
        var clustered = properties.features;
        return properties.kind === 'air-quality' || properties.kind === 'cctv'
            || (Array.isArray(clustered) && clustered.some(function (item) {
                var kind = item.get('kind');
                return kind === 'air-quality' || kind === 'cctv';
            }));
    }

    map.on('singleclick', function (event) {
        if (window.WEATHER_GRID_MEASURE && window.WEATHER_GRID_MEASURE.isActive()) return;
        var selected = map.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
            return layer === stationLayer || routedOverlayFeature(feature)
                ? feature : undefined;
        }, { hitTolerance: 12 });
        var location = window.WeatherGridLocation;
        if (!selected) {
            if (location) location.inspectMapPoint(event.coordinate, event.pixel);
            return;
        }
        if (location) location.cancelCoverage();
        if (routedOverlayFeature(selected)) return;
        var properties = selected.getProperties();
        var latitude = Number(properties.latitude);
        var longitude = Number(properties.longitude);
        if (properties.stn_name && Number.isFinite(latitude) && Number.isFinite(longitude)) {
            if (location) location.openStation(properties.stn_name, latitude, longitude);
            return;
        }
        if (location) location.inspectMapPoint(event.coordinate, event.pixel);
    });

    var stationToggle = document.getElementById('weather_stations');
    if (stationToggle) {
        stationToggle.addEventListener('click', function () {
            basemapState = State.setStationsVisible(
                basemapState, !basemapState.stationsVisible);
            applyBasemapState();
        });
    }

    var weatherButton = document.getElementById('basemap_weather');
    if (weatherButton) {
        weatherButton.addEventListener('click', function () { selectMode('weather'); });
    }
    var streetButton = document.getElementById('basemap_streets');
    if (streetButton) {
        streetButton.addEventListener('click', function () { selectMode('streets'); });
    }
    var boundaryButton = document.getElementById('basemap_boundaries');
    if (boundaryButton) {
        boundaryButton.addEventListener('click', function () {
            boundaryButton.disabled = true;
            boundaryButton.setAttribute('aria-busy', 'true');
            ensureVectorMapData().then(function () {
                selectMode('boundaries');
            }).catch(function () {
                if (typeof window.fireAlert === 'function') {
                    window.fireAlert({
                        title: '안내',
                        text: '벡터지도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
                        confirmButtonText: '닫기'
                    });
                }
            }).finally(function () {
                boundaryButton.disabled = false;
                boundaryButton.removeAttribute('aria-busy');
            });
        });
    }

    function bindBoundaryToggle(id, kind) {
        var button = document.getElementById(id);
        if (!button) return;
        button.addEventListener('click', function () {
            basemapState = State.toggleBoundary(basemapState, kind);
            applyBasemapState();
        });
    }
    bindBoundaryToggle('region_label_toggle', 'labels');
    bindBoundaryToggle('province_boundary_toggle', 'provinces');

    map.addControl(new ol.control.ScaleLine({
        target: document.getElementById('map_scale'),
        units: 'metric',
        minWidth: 32,
        maxWidth: 120
    }));
    map.getViewport().style.touchAction = 'none';
    initialView.fit(ol.proj.transformExtent(
        State.initialGeoExtent(compactQuery.matches),
        'EPSG:4326',
        PROJECTION_CODE,
        16
    ), {
        size: map.getSize(),
        padding: State.initialPadding(window.innerWidth),
        duration: 0,
        nearest: false
    });

    window.weatherMap = map;
    window.weatherRasterLayer = rasterLayer;
    window.weatherBasemapLayer = landLayer;
    window.vectorLayer = countryLayer;
    window.provinceBoundaryLayer = provinceLayer;
    window.streetTileLayer = streetLayer;
    window.stationVectorLayer = stationLayer;

    window.WeatherGridMapRuntime = Object.freeze({
        map: map,
        gridCoordinate: DfsProjection.latLonToGridFraction,
        toGeographic: function (coordinate, projectionCode) {
            var code = projectionCode || window.WEATHER_GRID_VIEW_PROJ || PROJECTION_CODE;
            return ol.proj.getTransform(code, 'EPSG:4326')(coordinate);
        },
        coreLayers: function () {
            return Object.freeze({
                weatherBasemap: landLayer,
                boundaries: countryLayer,
                provinces: provinceLayer
            });
        },
        weatherLayer: function () { return rasterLayer; },
        stationLayer: function () { return stationLayer; },
        selectStationName: setSelectedStationName,
        stationAnchors: function () {
            return Object.freeze(stationAnchors.map(function (station) {
                return Object.freeze({
                    name: station.name,
                    lon: station.lon,
                    lat: station.lat
                });
            }));
        }
    });

    window.getMapRenderDiagnostics = function () {
        var canvases = Array.from(
            map.getViewport().querySelectorAll('canvas:not(#wind_field_canvas)'));
        var pixels = canvases.map(function (canvas) {
            return canvas.width * canvas.height;
        });
        return {
            configuredPixelRatio: mapPixelRatio,
            maxMapBackingPixels: State.maxRenderPixels,
            canvasPixels: pixels,
            largestCanvasPixels: pixels.length ? Math.max.apply(null, pixels) : 0
        };
    };

    window.WeatherGridMapBootstrap = Object.freeze({
        projectionCode: PROJECTION_CODE,
        selectMode: selectMode,
        applyTheme: applyThemeStyles,
        reloadGeodata: loadInitialGeodata,
        snapshot: function () { return basemapState; }
    });

    applyBasemapState();
    loadInitialGeodata();
}());
