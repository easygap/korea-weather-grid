/**
 * 기상특보·태풍·낙뢰를 예보 격자와 독립적으로 관리한다.
 * 특보만 유휴 시간에 확인하고, 지도 레이어 자료는 사용자가 켠 뒤에 요청한다.
 */
(function () {
    'use strict';

    var typhoonToggle = document.getElementById('typhoon_toggle');
    var lightningToggle = document.getElementById('lightning_toggle');
    var lightningWindow = document.getElementById('lightning_window');
    var lightningWindowWrap = document.getElementById('lightning_window_wrap');
    var status = document.getElementById('severe_weather_status');
    var statusText = document.getElementById('severe_weather_status_text');
    var retryButton = document.getElementById('severe_weather_retry');
    var legend = document.getElementById('hazard_legend');
    var legendToggle = legend ? legend.querySelector('.hazard_legend_toggle') : null;
    var legendTime = document.getElementById('hazard_legend_time');
    var legendCount = document.getElementById('hazard_legend_count');
    var popup = document.getElementById('hazard_popup');
    var popupClose = document.getElementById('hazard_popup_close');
    var warningBanner = document.getElementById('warning_banner');
    var warningPanel = document.getElementById('warning_panel');
    var warningOpen = document.getElementById('warning_open');
    var warningPanelClose = document.getElementById('warning_panel_close');
    var warningList = document.getElementById('warning_list');
    var warningPanelStatus = document.getElementById('warning_panel_status');
    var warningPanelSource = document.getElementById('warning_panel_source');
    var warningLive = document.getElementById('warning_live');
    if (!typhoonToggle || !lightningToggle || !lightningWindow || !status || !statusText
            || !retryButton || !legend || !popup || !popupClose || !warningBanner
            || !legendToggle || !warningPanel || !warningOpen || !warningPanelClose || !warningList
            || !warningPanelStatus || !warningPanelSource || !warningLive || typeof ol === 'undefined'
            || typeof weatherMap === 'undefined') return;

    var REQUEST_TIMEOUT_MS = 12000;
    var WARNING_REFRESH_MS = 5 * 60 * 1000;
    var TYPHOON_REFRESH_MS = 15 * 60 * 1000;
    var LIGHTNING_REFRESH_MS = 5 * 60 * 1000;
    var MAX_LIGHTNING_FEATURES = 5000;
    var mobileLegendQuery = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
    var formatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });

    var state = {
        typhoon: false,
        lightning: false,
        lightningMinutes: 30,
        typhoons: [],
        strikes: [],
        warnings: [],
        warningStatus: 'loading',
        typhoonLoaded: false,
        lightningLoaded: false,
        warningsLoaded: false,
        typhoonLoading: false,
        lightningLoading: false,
        typhoonError: '',
        lightningError: '',
        warningError: '',
        typhoonMeta: {},
        lightningMeta: {},
        warningMeta: {},
        typhoonFetchedAt: 0,
        lightningFetchedAt: 0,
        warningFetchedAt: 0
    };
    var requests = {
        warnings: { sequence: 0, controller: null },
        typhoon: { sequence: 0, controller: null },
        lightning: { sequence: 0, controller: null }
    };
    var styleCache = new Map();
    var themeColorCache = null;
    var loadSequence = { warnings: 0, typhoon: 0, lightning: 0 };
    var lastWarningSignature = '';
    var warningPanelOpener = null;
    var legendInitialized = false;
    var typhoonAutoFitPending = false;

    var typhoonSource = new ol.source.Vector();
    var typhoonLayer = new ol.layer.Vector({
        title: 'severe-typhoon', source: typhoonSource, visible: false,
        declutter: true, zIndex: 86, style: styleTyphoonFeature
    });
    var lightningRawSource = new ol.source.Vector();
    var lightningClusterSource = new ol.source.Cluster({
        distance: 38, minDistance: 14, source: lightningRawSource
    });
    var lightningLayer = new ol.layer.Vector({
        title: 'severe-lightning', source: lightningClusterSource, visible: false,
        zIndex: 88, style: styleLightningFeature
    });
    weatherMap.addLayer(typhoonLayer);
    weatherMap.addLayer(lightningLayer);

    function endpoint(path) {
        if (typeof apiUrl === 'function') return apiUrl(path);
        var root = document.querySelector('.app');
        var contextPath = root && root.dataset.contextPath ? root.dataset.contextPath.replace(/\/$/, '') : '';
        return contextPath + path;
    }

    function finiteNumber(value, min, max) {
        if (value === null || value === undefined || value === '') return null;
        var number = Number(value);
        return Number.isFinite(number) && number >= min && number <= max ? number : null;
    }

    function firstValue(object, keys, fallback) {
        if (!object || typeof object !== 'object') return fallback;
        for (var i = 0; i < keys.length; i++) {
            var value = object[keys[i]];
            if (value !== null && value !== undefined && value !== '') return value;
        }
        return fallback;
    }

    function arrayValue(payload, keys) {
        if (Array.isArray(payload)) return payload;
        for (var i = 0; payload && i < keys.length; i++) {
            if (Array.isArray(payload[keys[i]])) return payload[keys[i]];
        }
        return [];
    }

    function parseInstant(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number') {
            var numeric = value < 100000000000 ? value * 1000 : value;
            return Number.isFinite(numeric) ? numeric : null;
        }
        var text = String(value).trim();
        var digits = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/);
        if (digits) {
            var compact = Date.parse(digits[1] + '-' + digits[2] + '-' + digits[3]
                + 'T' + digits[4] + ':' + digits[5] + ':' + (digits[6] || '00') + '+09:00');
            return Number.isFinite(compact) ? compact : null;
        }
        var parsed = Date.parse(text);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function formatTime(value) {
        var instant = parseInstant(value);
        return instant === null ? '—' : formatter.format(new Date(instant)).replace(/\.$/, '') + ' KST';
    }

    function dateTimeValue(value) {
        var instant = parseInstant(value);
        return instant === null ? '' : new Date(instant).toISOString();
    }

    function formatNumber(value, suffix, digits) {
        var number = Number(value);
        if (!Number.isFinite(number)) return '—';
        return number.toLocaleString('ko-KR', {
            minimumFractionDigits: digits || 0,
            maximumFractionDigits: digits || 0
        }) + (suffix || '');
    }

    function projectionCode() {
        var projection = weatherMap.getView().getProjection();
        return projection && projection.getCode ? projection.getCode() : (window.WEATHER_GRID_VIEW_PROJ || 'KMA_GRID_LCC');
    }

    function projectedCoordinate(longitude, latitude) {
        try {
            return ol.proj.transform([longitude, latitude], 'EPSG:4326', projectionCode());
        } catch (error) {
            return null;
        }
    }

    function cancelRequest(kind) {
        var request = requests[kind];
        if (!request) return;
        request.sequence++;
        if (request.controller) request.controller.abort();
        request.controller = null;
    }

    async function fetchJson(kind, path) {
        var request = requests[kind];
        cancelRequest(kind);
        var sequence = request.sequence;
        var controller = new AbortController();
        request.controller = controller;
        var timedOut = false;
        var timer = setTimeout(function () {
            timedOut = true;
            controller.abort();
        }, REQUEST_TIMEOUT_MS);
        try {
            var response = await fetch(endpoint(path), {
                headers: { Accept: 'application/json' }, signal: controller.signal
            });
            if (!response.ok) {
                var httpError = new Error('HTTP_' + response.status);
                httpError.status = response.status;
                throw httpError;
            }
            var payload = await response.json();
            return sequence === request.sequence ? payload : null;
        } catch (error) {
            if (sequence !== request.sequence) return null;
            if (timedOut) {
                var timeoutError = new Error('REQUEST_TIMEOUT');
                timeoutError.name = 'TimeoutError';
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timer);
            if (sequence === request.sequence && request.controller === controller) request.controller = null;
        }
    }

    function unavailableMessage(error) {
        return error && (error.status === 403 || error.status === 404 || error.status === 503)
            ? '연결 준비 중' : '조회 실패';
    }

    function normalizeTrackPoint(point) {
        var latitude = finiteNumber(firstValue(point, ['latitude', 'lat', 'LAT'], null), -90, 90);
        var longitude = finiteNumber(firstValue(point, ['longitude', 'lon', 'lng', 'LON'], null), -180, 180);
        if (latitude === null || longitude === null) return null;
        var rawKind = String(firstValue(point, ['kind', 'type', 'fcstType'], 'analysis')).toLowerCase();
        return {
            kind: /forecast|예측|예보|fcst/.test(rawKind) ? 'forecast' : 'analysis',
            time: firstValue(point, ['time', 'analysisTime', 'forecastTime', 'tm'], ''),
            latitude: latitude,
            longitude: longitude,
            centerPressureHpa: finiteNumber(firstValue(point, ['centerPressureHpa', 'pressure', 'pres'], null), 800, 1100),
            maxWindMs: finiteNumber(firstValue(point, ['maxWindMs', 'maxWind', 'windSpeed'], null), 0, 150),
            direction: String(firstValue(point, ['direction', 'moveDirection'], '')),
            speedKmh: finiteNumber(firstValue(point, ['speedKmh', 'moveSpeed'], null), 0, 300),
            galeRadiusKm: finiteNumber(firstValue(point, ['galeRadiusKm', 'radius'], null), 0, 3000),
            stormRadiusKm: finiteNumber(firstValue(point, ['stormRadiusKm'], null), 0, 1500),
            probabilityRadiusKm: finiteNumber(firstValue(point, ['probabilityRadiusKm'], null), 0, 3000),
            location: String(firstValue(point, ['location', 'position'], ''))
        };
    }

    function normalizeTyphoons(payload) {
        return arrayValue(payload, ['active', 'typhoons', 'items']).map(function (storm, index) {
            var track = arrayValue(storm, ['track', 'points', 'positions'])
                .map(normalizeTrackPoint).filter(Boolean)
                .sort(function (a, b) { return (parseInstant(a.time) || 0) - (parseInstant(b.time) || 0); });
            var nameKo = String(firstValue(storm, ['nameKo', 'name', 'typhoonName'], '')).trim();
            if (/^(?:이름\s*미정|미정|없음|-)$/.test(nameKo)) nameKo = '';
            return {
                id: String(firstValue(storm, ['id', 'typhoonId', 'number'], 'typhoon-' + index)),
                number: String(firstValue(storm, ['number', 'typhoonNumber'], '')),
                nameKo: nameKo,
                nameEn: String(firstValue(storm, ['nameEn'], '')),
                analysisTime: firstValue(storm, ['analysisTime', 'updatedAt'], ''),
                track: track
            };
        }).filter(function (storm) { return storm.track.length > 0; });
    }

    function normalizeStrike(strike, index) {
        var latitude = finiteNumber(firstValue(strike, ['latitude', 'lat', 'LAT'], null), -90, 90);
        var longitude = finiteNumber(firstValue(strike, ['longitude', 'lon', 'lng', 'LON'], null), -180, 180);
        if (latitude === null || longitude === null) return null;
        var rawType = String(firstValue(strike, ['type', 'strikeType'], 'ground')).toLowerCase();
        return {
            id: String(firstValue(strike, ['id'], 'strike-' + index)),
            observedAt: firstValue(strike, ['observedAt', 'time', 'tm'], ''),
            latitude: latitude,
            longitude: longitude,
            type: /cloud|구름|운간/.test(rawType) ? 'cloud' : 'ground',
            intensityKa: finiteNumber(firstValue(strike, ['intensityKa', 'intensity', 'currentKa'], null), -1000, 1000),
            altitudeKm: finiteNumber(firstValue(strike, ['altitudeKm', 'altitude'], null), 0, 100),
            errorRangeKm: finiteNumber(firstValue(strike, ['errorRangeKm', 'errorKm'], null), 0, 1000),
            sensorCount: finiteNumber(firstValue(strike, ['sensorCount', 'sensors'], null), 0, 1000),
            quality: String(firstValue(strike, ['quality', 'qualityCode'], ''))
        };
    }

    function normalizeStrikes(payload) {
        return arrayValue(payload, ['strikes', 'items', 'lightning'])
            .map(normalizeStrike).filter(Boolean)
            .sort(function (a, b) { return (parseInstant(b.observedAt) || 0) - (parseInstant(a.observedAt) || 0); })
            .slice(0, MAX_LIGHTNING_FEATURES);
    }

    function normalizeWarning(item, index) {
        var command = String(firstValue(item, ['command', 'CMD', 'commandName'], ''));
        if (/해제|취소/.test(command)) return null;
        return {
            id: String(firstValue(item, ['id'], 'warning-' + index)),
            regionId: String(firstValue(item, ['regionId', 'REG_ID'], '')),
            regionName: String(firstValue(item, ['regionName', 'REG_KO', 'region'], '지역 미상')),
            regionFullName: String(firstValue(item, ['regionFullName'], '')),
            parentRegionId: String(firstValue(item, ['parentRegionId', 'REG_UP'], '')),
            parentRegionName: String(firstValue(item, ['parentRegionName', 'regionGroupName', 'REG_UP_KO'], '')),
            regionType: String(firstValue(item, ['regionType'], '')),
            regionCharacteristicCode: String(firstValue(item, ['regionCharacteristicCode', 'REG_SP'], '')),
            forecastRegionId: String(firstValue(item, ['forecastRegionId', 'FCT_ID'], '')),
            responsibleOfficeId: String(firstValue(item, ['responsibleOfficeId'], '')),
            responsibleOfficeName: String(firstValue(item, ['responsibleOfficeName'], '')),
            phenomenonCode: String(firstValue(item, ['phenomenonCode', 'WRN'], '')),
            phenomenon: String(firstValue(item, ['phenomenon', 'type', 'WRN'], '기상특보')),
            levelCode: String(firstValue(item, ['levelCode', 'LVL'], '')),
            level: String(firstValue(item, ['level', 'LVL'], '')),
            commandCode: String(firstValue(item, ['commandCode', 'CMD'], '')),
            command: command,
            issuedAt: firstValue(item, ['issuedAt', 'TM_FC', 'updatedAt'], ''),
            effectiveAt: firstValue(item, ['effectiveAt', 'TM_EF'], '')
        };
    }

    function normalizeWarnings(payload) {
        return arrayValue(payload, ['warnings', 'items'])
            .map(normalizeWarning).filter(Boolean)
            .sort(function (a, b) {
                var severity = warningSeverity(b).rank - warningSeverity(a).rank;
                return severity || (parseInstant(b.effectiveAt || b.issuedAt) || 0)
                    - (parseInstant(a.effectiveAt || a.issuedAt) || 0);
            });
    }

    function warningSeverity(warning) {
        var level = String(warning && warning.level || '');
        if (/경보|심각|danger|warning/i.test(level)) return { key: 'critical', label: level || '경보', rank: 2 };
        return { key: 'watch', label: level || '주의보', rank: 1 };
    }

    function typhoonNumber(storm) {
        var raw = String(storm && storm.number || '').trim();
        var digits = raw.match(/\d+/);
        if (digits) return digits[0];
        return raw.replace(/^제\s*/, '').replace(/호.*$/, '').trim();
    }

    function typhoonDisplayName(storm) {
        var number = typhoonNumber(storm);
        var name = String(storm && (storm.nameKo || storm.nameEn) || '').trim();
        if (name) return (number ? number + '호 ' : '') + name;
        return number ? '제 ' + number + '호 태풍' : '태풍';
    }

    function themeColors() {
        if (themeColorCache) return themeColorCache;
        var styles = getComputedStyle(document.documentElement);
        themeColorCache = {
            surface: styles.getPropertyValue('--surface-solid').trim() || '#111a2c',
            text: styles.getPropertyValue('--text').trim() || '#e6edf6',
            typhoon: styles.getPropertyValue('--hazard-typhoon').trim() || '#ff7b72',
            lightning: styles.getPropertyValue('--hazard-lightning').trim() || '#f6c85f',
            cloud: styles.getPropertyValue('--hazard-cloud').trim() || '#a8a1ff',
            clusterText: styles.getPropertyValue('--hazard-cluster-text').trim() || '#352300',
            light: document.documentElement.dataset.theme === 'light'
        };
        return themeColorCache;
    }

    function styleTyphoonFeature(feature) {
        var role = feature.get('hazardRole');
        var colors = themeColors();
        if (role === 'analysis-line') {
            var analysisKey = 'typhoon:analysis-line:' + colors.typhoon;
            if (!styleCache.has(analysisKey)) styleCache.set(analysisKey, new ol.style.Style({
                stroke: new ol.style.Stroke({ color: colors.typhoon, width: 3, lineCap: 'round' })
            }));
            return styleCache.get(analysisKey);
        }
        if (role === 'forecast-line') {
            var forecastKey = 'typhoon:forecast-line:' + colors.typhoon;
            if (!styleCache.has(forecastKey)) styleCache.set(forecastKey, new ol.style.Style({
                stroke: new ol.style.Stroke({ color: colors.typhoon, width: 2.5, lineDash: [8, 7], lineCap: 'round' })
            }));
            return styleCache.get(forecastKey);
        }
        var point = feature.get('trackPoint') || {};
        var storm = feature.get('storm') || {};
        var current = !!feature.get('isCurrent');
        var forecast = point.kind === 'forecast';
        var label = typhoonDisplayName(storm);
        var key = ['typhoon', forecast ? 'forecast' : 'analysis', current ? 'current' : 'past', label, colors.surface, colors.text].join(':');
        if (styleCache.has(key)) return styleCache.get(key);
        var radius = current ? 10 : (forecast ? 6 : 5);
        var pointStyle = new ol.style.Style({
            image: new ol.style.Circle({
                radius: radius,
                fill: new ol.style.Fill({ color: forecast ? colors.surface : colors.typhoon }),
                stroke: new ol.style.Stroke({ color: colors.typhoon, width: current ? 3 : 2 })
            }),
            text: current ? new ol.style.Text({
                text: label, offsetY: 21, padding: [3, 6, 3, 6],
                font: '800 11px system-ui, sans-serif',
                fill: new ol.style.Fill({ color: colors.text }),
                backgroundFill: new ol.style.Fill({ color: colors.surface }),
                backgroundStroke: new ol.style.Stroke({ color: colors.typhoon, width: 1 })
            }) : undefined
        });
        if (!current) {
            styleCache.set(key, pointStyle);
            return pointStyle;
        }
        var currentStyles = [
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 15, fill: new ol.style.Fill({ color: 'rgba(0,0,0,0)' }),
                    stroke: new ol.style.Stroke({ color: colors.typhoon, width: 1.5 })
                })
            }),
            pointStyle
        ];
        styleCache.set(key, currentStyles);
        return currentStyles;
    }

    function lightningMembers(feature) {
        var members = feature && feature.get('features');
        if (!Array.isArray(members)) return [];
        return members.filter(function (member) { return member.get('kind') === 'lightning'; });
    }

    function lightningStyle(strike) {
        var colors = themeColors();
        var intensity = Math.abs(Number(strike.intensityKa));
        var sizeBucket = !Number.isFinite(intensity) ? 0 : intensity >= 100 ? 3 : intensity >= 50 ? 2 : intensity >= 20 ? 1 : 0;
        var observed = parseInstant(strike.observedAt);
        var ageMinutes = observed === null ? state.lightningMinutes : Math.max(0, (Date.now() - observed) / 60000);
        var ageBucket = ageMinutes <= 15 ? 0 : ageMinutes <= 30 ? 1 : 2;
        /* 밝은 지도에서도 오래된 관측 표식의 비텍스트 대비가 3:1 아래로 떨어지지 않게 한다. */
        var opacity = colors.light
            ? (ageBucket === 0 ? 1 : ageBucket === 1 ? .88 : .76)
            : (ageBucket === 0 ? 1 : ageBucket === 1 ? .78 : .56);
        var color = strike.type === 'cloud' ? colors.cloud : colors.lightning;
        var key = ['lightning', strike.type, sizeBucket, ageBucket, colors.surface].join(':');
        if (styleCache.has(key)) return styleCache.get(key);
        var radius = 6 + sizeBucket * 1.4;
        var image = strike.type === 'cloud'
            ? new ol.style.Circle({
                opacity: opacity,
                radius: radius, fill: new ol.style.Fill({ color: color }),
                stroke: new ol.style.Stroke({ color: colors.surface, width: 2 })
            })
            : new ol.style.RegularShape({
                opacity: opacity,
                points: 4, radius: radius + 1, radius2: Math.max(2.5, radius * .34), angle: 0,
                fill: new ol.style.Fill({ color: color }),
                stroke: new ol.style.Stroke({ color: colors.surface, width: 2 })
            });
        var style = new ol.style.Style({ image: image });
        if (typeof style.setZIndex === 'function') style.setZIndex(Math.round(opacity * 10));
        styleCache.set(key, style);
        return style;
    }

    function clusterLightningStyle(count) {
        var colors = themeColors();
        var bucket = count > 999 ? '999+' : String(count);
        var key = 'lightning:cluster:' + bucket + ':' + colors.surface + ':' + colors.lightning + ':' + colors.clusterText;
        if (styleCache.has(key)) return styleCache.get(key);
        var radius = count > 99 ? 21 : count > 20 ? 19 : 17;
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: radius, fill: new ol.style.Fill({ color: colors.lightning }),
                stroke: new ol.style.Stroke({ color: colors.surface, width: 3 })
            }),
            text: new ol.style.Text({
                text: bucket, font: '800 11px system-ui, sans-serif',
                fill: new ol.style.Fill({ color: colors.clusterText })
            })
        });
        styleCache.set(key, style);
        return style;
    }

    function styleLightningFeature(feature) {
        var members = lightningMembers(feature);
        if (!members.length) return null;
        return members.length > 1 ? clusterLightningStyle(members.length) : lightningStyle(members[0].get('strike'));
    }

    function rebuildTyphoonFeatures() {
        var features = [];
        state.typhoons.forEach(function (storm) {
            var projected = storm.track.map(function (point) {
                return { point: point, coordinate: projectedCoordinate(point.longitude, point.latitude) };
            }).filter(function (entry) { return !!entry.coordinate; });
            var analysis = projected.filter(function (entry) { return entry.point.kind === 'analysis'; });
            var forecast = projected.filter(function (entry) { return entry.point.kind === 'forecast'; });
            if (analysis.length > 1) features.push(new ol.Feature({
                geometry: new ol.geom.LineString(analysis.map(function (entry) { return entry.coordinate; })),
                kind: 'typhoon', hazardRole: 'analysis-line', storm: storm
            }));
            if (forecast.length) {
                var forecastCoordinates = (analysis.length ? [analysis[analysis.length - 1].coordinate] : [])
                    .concat(forecast.map(function (entry) { return entry.coordinate; }));
                if (forecastCoordinates.length > 1) features.push(new ol.Feature({
                    geometry: new ol.geom.LineString(forecastCoordinates),
                    kind: 'typhoon', hazardRole: 'forecast-line', storm: storm
                }));
            }
            var currentAnalysis = analysis.length ? analysis[analysis.length - 1].point : null;
            projected.forEach(function (entry) {
                features.push(new ol.Feature({
                    geometry: new ol.geom.Point(entry.coordinate), kind: 'typhoon',
                    hazardRole: 'track-point', storm: storm, trackPoint: entry.point,
                    isCurrent: entry.point === currentAnalysis
                }));
            });
        });
        typhoonSource.clear(true);
        if (features.length) typhoonSource.addFeatures(features);
        typhoonLayer.changed();
    }

    /**
     * 활성 태풍이 한반도 바깥에 있어도 경로가 화면 밖에 숨지 않게 한다.
     * 위험기상 빠른 보기에서만 호출하며, 한반도를 extent에 함께 넣어 현재 서비스의
     * 공간 맥락을 잃지 않는다.
     */
    function fitActiveTyphoons() {
        if (!state.typhoon || !state.typhoons.length || !weatherMap.getSize()) return false;
        var extent = typhoonSource.getExtent().slice();
        if (ol.extent.isEmpty(extent)) return false;
        var koreaAnchor = projectedCoordinate(127.8, 37.2);
        if (koreaAnchor) ol.extent.extendCoordinate(extent, koreaAnchor);
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        weatherMap.getView().fit(extent, {
            size: weatherMap.getSize(),
            padding: window.innerWidth <= 640 ? [154, 22, 110, 22] : [136, 210, 104, 320],
            maxZoom: 6.5,
            duration: reduced ? 0 : 320,
            nearest: false
        });
        typhoonAutoFitPending = false;
        return true;
    }

    function rebuildLightningFeatures() {
        var features = state.strikes.map(function (strike) {
            var coordinate = projectedCoordinate(strike.longitude, strike.latitude);
            return coordinate ? new ol.Feature({
                geometry: new ol.geom.Point(coordinate), kind: 'lightning', strike: strike
            }) : null;
        }).filter(Boolean);
        lightningRawSource.clear(true);
        if (features.length) lightningRawSource.addFeatures(features);
        lightningLayer.changed();
    }

    function setText(id, value, fallback) {
        var element = document.getElementById(id);
        if (element) element.textContent = value === null || value === undefined || value === '' ? (fallback || '—') : String(value);
    }

    function metaRows(rows) {
        var fragment = document.createDocumentFragment();
        rows.forEach(function (row) {
            if (!row.value || row.value === '—') return;
            var wrapper = document.createElement('div');
            var term = document.createElement('dt');
            var description = document.createElement('dd');
            term.textContent = row.label;
            description.textContent = row.value;
            wrapper.appendChild(term);
            wrapper.appendChild(description);
            fragment.appendChild(wrapper);
        });
        var container = document.getElementById('hazard_popup_meta');
        container.replaceChildren(fragment);
    }

    function positionPopup(pixel) {
        var runtime = window.WeatherGridMapRuntime;
        if (!runtime || typeof runtime.positionOverlayPopup !== 'function') return;
        popup.hidden = false;
        popup.style.visibility = 'hidden';
        popup.style.left = '0px';
        popup.style.top = '0px';
        popup.style.maxHeight = '';
        requestAnimationFrame(function () {
            if (popup.hidden) return;
            runtime.positionOverlayPopup(popup, pixel);
            popup.style.visibility = '';
        });
    }

    function closePopup(restoreMapFocus) {
        popup.hidden = true;
        popup.style.visibility = '';
        if (restoreMapFocus) document.getElementById('map').focus({ preventScroll: true });
    }

    function openTyphoonPoint(storm, point, pixel, focusPopup) {
        if (!storm || !point) return;
        popup.dataset.kind = 'typhoon';
        setText('hazard_popup_eyebrow', point.kind === 'forecast' ? '기상청 · 예측 경로' : '기상청 · 분석 경로');
        setText('hazard_popup_title', typhoonDisplayName(storm));
        var wind = point.maxWindMs === null ? '' : '최대풍속 ' + formatNumber(point.maxWindMs, ' m/s', 1);
        var pressure = point.centerPressureHpa === null ? '' : '중심기압 ' + formatNumber(point.centerPressureHpa, ' hPa');
        setText('hazard_popup_summary', [point.location, pressure, wind].filter(Boolean).join(' · '), '태풍 위치 정보를 확인하고 있습니다.');
        metaRows([
            { label: point.kind === 'forecast' ? '예측시각' : '분석시각', value: formatTime(point.time || storm.analysisTime) },
            { label: '구분', value: point.kind === 'forecast' ? '예측 위치' : '분석 위치' },
            { label: '위치', value: point.latitude.toFixed(2) + '°, ' + point.longitude.toFixed(2) + '°' },
            { label: '중심기압', value: point.centerPressureHpa === null ? '—' : formatNumber(point.centerPressureHpa, ' hPa') },
            { label: '최대풍속', value: point.maxWindMs === null ? '—' : formatNumber(point.maxWindMs, ' m/s', 1) },
            { label: '이동', value: [point.direction, point.speedKmh === null ? '' : formatNumber(point.speedKmh, ' km/h')].filter(Boolean).join(' ') },
            { label: '강풍반경', value: point.galeRadiusKm === null ? '—' : formatNumber(point.galeRadiusKm, ' km') }
        ]);
        setText('hazard_popup_source', '출처 ' + (state.typhoonMeta.source || '기상청') + (state.typhoonMeta.stale ? ' · 이전 정상 자료' : ''));
        positionPopup(pixel);
        if (focusPopup) requestAnimationFrame(function () { popup.focus({ preventScroll: true }); });
    }

    function latestAnalysis(storm) {
        var analysis = storm && storm.track.filter(function (point) { return point.kind === 'analysis'; });
        return analysis && analysis.length ? analysis[analysis.length - 1] : (storm && storm.track[0]);
    }

    function nearestTrackPoint(storm, pixel) {
        if (!storm || !Array.isArray(storm.track) || !storm.track.length || !pixel) return latestAnalysis(storm);
        var clickCoordinate = weatherMap.getCoordinateFromPixel(pixel);
        if (!clickCoordinate) return latestAnalysis(storm);
        var nearest = null;
        var nearestDistance = Infinity;
        storm.track.forEach(function (point) {
            var coordinate = projectedCoordinate(point.longitude, point.latitude);
            if (!coordinate) return;
            var dx = coordinate[0] - clickCoordinate[0], dy = coordinate[1] - clickCoordinate[1];
            var distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearest = point;
                nearestDistance = distance;
            }
        });
        return nearest || latestAnalysis(storm);
    }

    function openTyphoonFeature(feature, pixel, focusPopup) {
        if (!state.typhoon || !feature) return;
        var storm = feature.get('storm');
        openTyphoonPoint(storm, feature.get('trackPoint') || nearestTrackPoint(storm, pixel), pixel, focusPopup);
    }

    function openLightningFeature(feature, pixel, focusPopup) {
        if (!state.lightning || !feature) return;
        var members = lightningMembers(feature);
        if (!members.length) return;
        if (members.length > 1) {
            closePopup(false);
            var extent = ol.extent.createEmpty();
            members.forEach(function (member) { ol.extent.extend(extent, member.getGeometry().getExtent()); });
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            var width = ol.extent.getWidth(extent), height = ol.extent.getHeight(extent);
            if (width === 0 && height === 0) {
                weatherMap.getView().animate({ center: ol.extent.getCenter(extent), zoom: weatherMap.getView().getZoom() + 1, duration: reduced ? 0 : 220 });
            } else {
                weatherMap.getView().fit(extent, {
                    padding: window.innerWidth <= 640 ? [104, 20, 96, 20] : [118, 180, 92, 310],
                    maxZoom: weatherMap.getView().getZoom() + 2, duration: reduced ? 0 : 240
                });
            }
            return;
        }
        var strike = members[0].get('strike');
        popup.dataset.kind = 'lightning';
        setText('hazard_popup_eyebrow', '기상청 · 최근 낙뢰 관측');
        setText('hazard_popup_title', strike.type === 'cloud' ? '구름방전' : '대지방전');
        setText('hazard_popup_summary', strike.intensityKa === null
            ? '관측 위치와 시각을 확인하세요.'
            : '관측 강도 ' + formatNumber(Math.abs(strike.intensityKa), ' kA', 1));
        metaRows([
            { label: '관측시각', value: formatTime(strike.observedAt) },
            { label: '방전 유형', value: strike.type === 'cloud' ? '구름방전' : '대지방전' },
            { label: '위치', value: strike.latitude.toFixed(3) + '°, ' + strike.longitude.toFixed(3) + '°' },
            { label: '관측 강도', value: strike.intensityKa === null ? '—' : formatNumber(strike.intensityKa, ' kA', 1) },
            { label: '고도', value: strike.altitudeKm === null ? '—' : formatNumber(strike.altitudeKm, ' km', 1) },
            { label: '오차 범위', value: strike.errorRangeKm === null ? '—' : formatNumber(strike.errorRangeKm, ' km', 1) },
            { label: '감지 센서', value: strike.sensorCount === null ? '—' : formatNumber(strike.sensorCount, '개') },
            { label: '자료 품질', value: strike.quality }
        ]);
        setText('hazard_popup_source', '출처 ' + (state.lightningMeta.source || '기상청') + (state.lightningMeta.stale ? ' · 이전 정상 자료' : ''));
        positionPopup(pixel);
        if (focusPopup) requestAnimationFrame(function () { popup.focus({ preventScroll: true }); });
    }

    function nearestFeature(source, predicate, activate) {
        var size = weatherMap.getSize();
        var center = weatherMap.getView().getCenter();
        if (!size || !center) return null;
        var extent = weatherMap.getView().calculateExtent(size);
        var nearest = null;
        var nearestCoordinate = null;
        var nearestDistance = Infinity;
        source.forEachFeatureInExtent(extent, function (feature) {
            if (!predicate(feature)) return;
            var coordinate = feature.getGeometry().getCoordinates();
            var dx = coordinate[0] - center[0], dy = coordinate[1] - center[1];
            var distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearest = feature;
                nearestCoordinate = coordinate;
                nearestDistance = distance;
            }
        });
        return nearest ? {
            distance: nearestDistance,
            activate: function (focusPopup) {
                activate(nearest, weatherMap.getPixelFromCoordinate(nearestCoordinate), focusPopup);
            }
        } : null;
    }

    function nearestTyphoon() {
        return nearestFeature(typhoonSource, function (feature) {
            return feature.get('hazardRole') === 'track-point';
        }, openTyphoonFeature);
    }

    function nearestLightning() {
        return nearestFeature(lightningRawSource, function () { return true; }, function (feature, pixel, focusPopup) {
            var wrapper = new ol.Feature({ features: [feature] });
            openLightningFeature(wrapper, pixel, focusPopup);
        });
    }

    function setStatus(stateName, message, retry) {
        status.hidden = false;
        status.dataset.state = stateName;
        if (statusText.textContent !== message) statusText.textContent = message;
        retryButton.hidden = !retry;
    }

    function updateLayerStatus() {
        if (!state.typhoon && !state.lightning) {
            status.hidden = true;
            return;
        }
        if (state.typhoonLoading || state.lightningLoading) {
            var targets = [state.typhoonLoading ? '태풍' : '', state.lightningLoading ? '낙뢰' : ''].filter(Boolean).join('·');
            setStatus('loading', targets + ' 자료를 확인하는 중…', false);
            return;
        }
        var errors = [];
        if (state.typhoon && state.typhoonError) errors.push(state.typhoonError);
        if (state.lightning && state.lightningError) errors.push(state.lightningError);
        if (errors.length) {
            var onlyUnavailable = errors.every(function (message) { return message === '연결 준비 중'; });
            setStatus(onlyUnavailable ? 'stale' : 'error', onlyUnavailable
                ? '일부 위험기상 자료는 연결 준비 중입니다.'
                : '일부 자료를 갱신하지 못했습니다. 표시 중인 정상 자료만 유지합니다.', !onlyUnavailable);
            return;
        }
        var parts = [];
        if (state.typhoon) parts.push('활동 태풍 ' + state.typhoons.length + '개');
        if (state.lightning) parts.push('최근 ' + state.lightningMinutes + '분 낙뢰 ' + lightningCountText());
        var stale = (state.typhoon && state.typhoonMeta.stale) || (state.lightning && state.lightningMeta.stale);
        var app = document.querySelector('.app');
        var separateTimeline = app && app.dataset.exploreMode !== 'hazards' ? ' · 예보 시간축과 별도' : '';
        setStatus(stale ? 'stale' : 'ready', (stale ? '이전 정상 자료 · ' : '')
            + parts.join(' · ') + separateTimeline, false);
    }

    function lightningCountText(compact) {
        var count = state.strikes.length.toLocaleString('ko-KR');
        if (state.lightningMeta.truncated) return compact ? count + '+' : count + '회 이상';
        return count + (compact ? '' : '회');
    }

    function updateLegend() {
        var visible = state.typhoon || state.lightning;
        legend.hidden = !visible;
        if (!visible) return;
        if (!legendInitialized) {
            legendInitialized = true;
            setLegendCollapsed(!!(mobileLegendQuery && mobileLegendQuery.matches));
        }
        legend.querySelectorAll('[data-hazard-legend^="typhoon-"]').forEach(function (row) { row.hidden = !state.typhoon; });
        legend.querySelectorAll('[data-hazard-legend^="lightning-"]').forEach(function (row) { row.hidden = !state.lightning; });
        var times = [];
        if (state.typhoon) {
            var analysisTimes = state.typhoons.map(function (storm) {
                var current = latestAnalysis(storm);
                return current && (current.time || storm.analysisTime);
            }).filter(Boolean);
            times.push(analysisTimes.length ? '태풍 ' + formatTime(analysisTimes.sort().slice(-1)[0])
                : state.typhoonLoaded ? '현재 활동 태풍 없음' : '태풍 발표 확인 중…');
        }
        if (state.lightning) {
            var to = state.lightningMeta.to || (state.strikes[0] && state.strikes[0].observedAt);
            times.push('낙뢰 ' + state.lightningMinutes + '분 · ' + formatTime(to));
        }
        legendTime.textContent = times.join(' · ');
        legendCount.textContent = [
            state.typhoon ? '태풍 ' + state.typhoons.length + '개' : '',
            state.lightning ? '낙뢰 ' + lightningCountText(false) : ''
        ].filter(Boolean).join(' · ');
    }

    function setLegendCollapsed(collapsed) {
        legend.classList.toggle('legend-collapsed', collapsed);
        if (legendToggle) {
            legendToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            legendToggle.setAttribute('aria-label', '위험기상 범례 ' + (collapsed ? '펼치기' : '접기'));
        }
    }

    function updateControls() {
        [[typhoonToggle, state.typhoon], [lightningToggle, state.lightning]].forEach(function (entry) {
            entry[0].classList.toggle('clicked', entry[1]);
            entry[0].setAttribute('aria-pressed', entry[1] ? 'true' : 'false');
        });
        lightningWindowWrap.hidden = !state.lightning;
        lightningWindow.querySelectorAll('button[data-lightning-minutes]').forEach(function (button) {
            var selected = Number(button.dataset.lightningMinutes) === state.lightningMinutes;
            button.classList.toggle('on', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        setText('typhoon_toggle_meta', state.typhoon
            ? (state.typhoonError ? state.typhoonError
                : state.typhoonLoaded ? state.typhoons.length + '개' : '불러오는 중') : '꺼짐');
        setText('lightning_toggle_meta', state.lightning
            ? (state.lightningError ? state.lightningError
                : state.lightningLoaded ? state.lightningMinutes + '분 · ' + lightningCountText(true) : '불러오는 중') : '꺼짐');
        typhoonLayer.setVisible(state.typhoon);
        lightningLayer.setVisible(state.lightning);
        updateLayerStatus();
        updateLegend();
    }

    function dispatchChanged() {
        document.dispatchEvent(new CustomEvent('weather-grid:hazards-changed', { detail: getState() }));
        if (typeof window.WEATHER_GRID_UPDATE_HASH === 'function') window.WEATHER_GRID_UPDATE_HASH();
    }

    function dispatchSettled(kind, success) {
        document.dispatchEvent(new CustomEvent('weather-grid:hazards-settled', {
            detail: { kind: kind, success: success, state: getState() }
        }));
    }

    async function loadTyphoons(force) {
        if (!state.typhoon) return;
        if (!force && state.typhoonFetchedAt && Date.now() - state.typhoonFetchedAt < TYPHOON_REFRESH_MS) return;
        var loadId = ++loadSequence.typhoon;
        state.typhoonLoading = true;
        state.typhoonError = '';
        updateControls();
        try {
            var payload = await fetchJson('typhoon', '/api/hazards/typhoons');
            if (!payload || !state.typhoon) return;
            if (payload.status === 'unavailable') {
                var unavailableError = new Error('HTTP_503');
                unavailableError.status = 503;
                throw unavailableError;
            }
            state.typhoons = normalizeTyphoons(payload);
            state.typhoonLoaded = true;
            state.typhoonFetchedAt = Date.now();
            state.typhoonMeta = {
                source: String(payload.source || '기상청 태풍 분석·예보'),
                stale: !!payload.stale,
                fetchedAt: payload.fetchedAt || '',
                lastSuccessAt: payload.lastSuccessAt || ''
            };
            rebuildTyphoonFeatures();
            if (typhoonAutoFitPending) requestAnimationFrame(fitActiveTyphoons);
            dispatchSettled('typhoon', true);
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            if (loadId !== loadSequence.typhoon) return;
            state.typhoonError = unavailableMessage(error);
            state.typhoonFetchedAt = Date.now();
            if (state.typhoonLoaded) state.typhoonMeta.stale = true;
            dispatchSettled('typhoon', false);
        } finally {
            if (loadId === loadSequence.typhoon) {
                state.typhoonLoading = false;
                updateControls();
            }
        }
    }

    async function loadLightning(force) {
        if (!state.lightning) return;
        if (!force && state.lightningFetchedAt && Date.now() - state.lightningFetchedAt < LIGHTNING_REFRESH_MS) return;
        var loadId = ++loadSequence.lightning;
        state.lightningLoading = true;
        state.lightningError = '';
        updateControls();
        try {
            var payload = await fetchJson('lightning', '/api/hazards/lightning?minutes=' + encodeURIComponent(state.lightningMinutes));
            if (!payload || !state.lightning) return;
            if (payload.status === 'unavailable') {
                var unavailableError = new Error('HTTP_503');
                unavailableError.status = 503;
                throw unavailableError;
            }
            var receivedStrikes = arrayValue(payload, ['strikes', 'items', 'lightning']);
            state.strikes = normalizeStrikes(payload);
            state.lightningLoaded = true;
            state.lightningFetchedAt = Date.now();
            state.lightningMeta = {
                source: String(payload.source || '기상청 낙뢰 관측'),
                from: payload.from || '', to: payload.to || '',
                stale: !!payload.stale, truncated: !!payload.truncated || receivedStrikes.length > MAX_LIGHTNING_FEATURES,
                fetchedAt: payload.fetchedAt || '', lastSuccessAt: payload.lastSuccessAt || ''
            };
            rebuildLightningFeatures();
            dispatchSettled('lightning', true);
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            if (loadId !== loadSequence.lightning) return;
            state.lightningError = unavailableMessage(error);
            state.lightningFetchedAt = Date.now();
            if (state.lightningLoaded) state.lightningMeta.stale = true;
            dispatchSettled('lightning', false);
        } finally {
            if (loadId === loadSequence.lightning) {
                state.lightningLoading = false;
                updateControls();
            }
        }
    }

    function warningTitle(warning) {
        return String(warning.phenomenon || '').trim() || '기상특보';
    }

    function renderWarnings(announce) {
        var warnings = state.warnings;
        var lastVerified = formatTime(state.warningMeta.updatedAt || state.warningMeta.lastSuccessAt);
        var staleLabel = state.warningMeta.stale
            ? ' · 이전 정상 자료' + (lastVerified === '—' ? '' : ' (' + lastVerified + ')') : '';
        var fragment = document.createDocumentFragment();
        warnings.slice(0, 50).forEach(function (warning) {
            var severity = warningSeverity(warning);
            var item = document.createElement('li');
            item.className = 'warning_item';
            item.dataset.regionId = warning.regionId;
            item.dataset.parentRegionId = warning.parentRegionId;
            item.dataset.phenomenonCode = warning.phenomenonCode;
            var header = document.createElement('div');
            header.className = 'warning_item_header';
            var badge = document.createElement('span');
            badge.className = 'warning_level';
            badge.dataset.severity = severity.key;
            badge.textContent = severity.label;
            var title = document.createElement('strong');
            title.textContent = warningTitle(warning);
            var region = document.createElement('p');
            region.textContent = [warning.parentRegionName, warning.regionName].filter(Boolean).join(' · ');
            var time = document.createElement('time');
            var warningTime = warning.effectiveAt || warning.issuedAt;
            time.textContent = (warning.effectiveAt ? '발효 ' : '발표 ') + formatTime(warningTime);
            var dateTime = dateTimeValue(warningTime);
            if (dateTime) time.dateTime = dateTime;
            header.appendChild(badge);
            header.appendChild(title);
            item.appendChild(header);
            item.appendChild(region);
            item.appendChild(time);
            fragment.appendChild(item);
        });
        warningList.replaceChildren(fragment);
        warningPanelStatus.textContent = state.warningStatus === 'unavailable'
            ? '기상특보 API가 아직 연결되지 않았습니다. 다른 지도 기능은 계속 사용할 수 있습니다.'
            : warnings.length
                ? '현재 발효 중인 특보 ' + warnings.length + '건'
                    + (warnings.length > 50 ? ' · 상위 50건 표시' : '') + staleLabel
                : '현재 확인된 발효 특보가 없습니다.';
        if (warningPanelSource) {
            warningPanelSource.textContent = '출처 ' + (state.warningMeta.source || '기상청')
                + (state.warningMeta.stale && lastVerified !== '—' ? ' · 마지막 정상 확인 ' + lastVerified : '')
                + ' · 발표 내용은 현지 상황에 따라 변경될 수 있습니다.';
        }
        warningBanner.hidden = warnings.length === 0;
        setText('warning_count', state.warningStatus === 'unavailable' ? '연결 대기' : warnings.length + '건');
        if (warnings.length) {
            var highest = warningSeverity(warnings[0]);
            warningBanner.dataset.severity = highest.key;
            setText('warning_banner_title', '기상특보 ' + warnings.length + '건');
            setText('warning_banner_summary', (state.warningMeta.stale ? '이전 정상 자료 · ' : '')
                + warningTitle(warnings[0]) + ' · ' + warnings[0].regionName);
        }
        var signature = warnings.map(function (warning) {
            return [warning.id, warning.regionId, warning.phenomenonCode, warning.levelCode,
                warning.commandCode, warning.effectiveAt].join(':');
        }).join('|');
        if (announce && signature !== lastWarningSignature && warningLive
                && (lastWarningSignature || warnings.length)) {
            warningLive.textContent = warnings.length
                ? '기상특보가 갱신됐습니다. 현재 ' + warnings.length + '건이 발효 중입니다.'
                : '발효 중이던 기상특보가 모두 해제됐습니다.';
        }
        lastWarningSignature = signature;
    }

    async function loadWarnings(force) {
        if (!force && state.warningsLoaded && Date.now() - state.warningFetchedAt < WARNING_REFRESH_MS) return;
        var loadId = ++loadSequence.warnings;
        try {
            var payload = await fetchJson('warnings', '/api/hazards/warnings');
            if (!payload) return;
            var payloadStatus = String(payload.status || 'ready').toLowerCase();
            if (payloadStatus === 'unavailable') {
                state.warningError = '연결 준비 중';
                state.warningsLoaded = true;
                state.warningFetchedAt = Date.now();
                state.warningStatus = state.warnings.length ? 'stale' : 'unavailable';
                if (state.warnings.length) state.warningMeta.stale = true;
                renderWarnings(false);
                return;
            }
            state.warnings = normalizeWarnings(payload);
            state.warningStatus = payloadStatus === 'stale' || payload.stale ? 'stale' : 'ready';
            state.warningError = '';
            state.warningsLoaded = true;
            state.warningFetchedAt = Date.now();
            state.warningMeta = {
                source: String(payload.source || '기상청'),
                stale: state.warningStatus === 'stale',
                updatedAt: payload.updatedAt || payload.fetchedAt || '',
                lastSuccessAt: payload.lastSuccessAt || payload.updatedAt || payload.fetchedAt || '',
                revision: payload.revision || ''
            };
            renderWarnings(true);
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            if (loadId !== loadSequence.warnings) return;
            state.warningError = unavailableMessage(error);
            state.warningFetchedAt = Date.now();
            if (state.warnings.length) {
                state.warningStatus = 'stale';
                state.warningMeta.stale = true;
                state.warningsLoaded = true;
                renderWarnings(false);
            } else {
                state.warningStatus = state.warningError === '연결 준비 중' ? 'unavailable' : 'error';
                state.warningsLoaded = state.warningStatus === 'unavailable';
                warningBanner.hidden = true;
                setText('warning_count', state.warningStatus === 'unavailable' ? '연결 대기' : '확인 불가');
                warningPanelStatus.textContent = state.warningStatus === 'unavailable'
                    ? '기상특보 API가 아직 연결되지 않았습니다. 다른 지도 기능은 계속 사용할 수 있습니다.'
                    : '기상특보를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';
            }
        }
    }

    function openWarningPanel(focusPanel, opener) {
        warningPanelOpener = opener || document.activeElement;
        var mobileDock = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
        if (mobileDock && warningPanelOpener === warningOpen && typeof window.WEATHER_GRID_CLOSE_DOCK === 'function') {
            window.WEATHER_GRID_CLOSE_DOCK(false);
        }
        warningPanel.hidden = false;
        warningBanner.setAttribute('aria-expanded', 'true');
        warningOpen.setAttribute('aria-expanded', 'true');
        if (!state.warningsLoaded || state.warningStatus === 'error') loadWarnings(true);
        if (focusPanel) warningPanel.focus({ preventScroll: true });
    }

    function closeWarningPanel(restoreFocus) {
        warningPanel.hidden = true;
        warningBanner.setAttribute('aria-expanded', 'false');
        warningOpen.setAttribute('aria-expanded', 'false');
        if (restoreFocus) {
            var target = warningPanelOpener;
            if (!target || !document.contains(target) || target.closest('[inert]') || !target.getClientRects().length) {
                target = document.getElementById('dock_toggle');
            }
            if (target && !target.closest('[inert]') && target.getClientRects().length) {
                target.focus({ preventScroll: true });
            }
        }
        warningPanelOpener = null;
    }

    function setLayers(next) {
        var nextTyphoon = !!next.typhoon;
        var nextLightning = !!next.lightning;
        if (state.typhoon === nextTyphoon && state.lightning === nextLightning) return;
        var typhoonWasEnabled = state.typhoon;
        state.typhoon = nextTyphoon;
        state.lightning = nextLightning;
        if (!typhoonWasEnabled && state.typhoon) typhoonAutoFitPending = true;
        if (!state.typhoon) typhoonAutoFitPending = false;
        closePopup(false);
        if (!state.typhoon) cancelRequest('typhoon');
        if (!state.lightning) cancelRequest('lightning');
        updateControls();
        if (state.typhoon) loadTyphoons(false);
        if (state.typhoon && state.typhoonLoaded && typhoonAutoFitPending) requestAnimationFrame(fitActiveTyphoons);
        if (state.lightning) loadLightning(false);
        dispatchChanged();
    }

    function setLightningMinutes(minutes) {
        var normalized = [15, 30, 60].indexOf(Number(minutes)) >= 0 ? Number(minutes) : 30;
        if (state.lightningMinutes === normalized) return;
        state.lightningMinutes = normalized;
        state.lightningLoaded = false;
        state.lightningFetchedAt = 0;
        state.lightningError = '';
        state.strikes = [];
        state.lightningMeta = {};
        lightningRawSource.clear(true);
        closePopup(false);
        updateControls();
        if (state.lightning) loadLightning(true);
        dispatchChanged();
    }

    function getState() {
        return {
            typhoon: state.typhoon,
            lightning: state.lightning,
            lightningMinutes: state.lightningMinutes,
            typhoonCount: state.typhoons.length,
            lightningCount: state.strikes.length,
            warningCount: state.warnings.length,
            warningStatus: state.warningStatus,
            typhoonLoading: state.typhoonLoading,
            lightningLoading: state.lightningLoading,
            typhoonError: state.typhoonError,
            lightningError: state.lightningError,
            warningError: state.warningError
        };
    }

    typhoonToggle.addEventListener('click', function () {
        setLayers({ typhoon: !state.typhoon, lightning: state.lightning });
    });
    lightningToggle.addEventListener('click', function () {
        setLayers({ typhoon: state.typhoon, lightning: !state.lightning });
    });
    lightningWindow.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-lightning-minutes]');
        if (button) setLightningMinutes(button.dataset.lightningMinutes);
    });
    retryButton.addEventListener('click', function () {
        if (state.typhoon) loadTyphoons(true);
        if (state.lightning) loadLightning(true);
    });
    popupClose.addEventListener('click', function () { closePopup(true); });
    warningBanner.addEventListener('click', function () {
        warningPanel.hidden ? openWarningPanel(false, warningBanner) : closeWarningPanel(false);
    });
    warningOpen.addEventListener('click', function () {
        warningPanel.hidden ? openWarningPanel(true, warningOpen) : closeWarningPanel(true);
    });
    warningPanelClose.addEventListener('click', function () { closeWarningPanel(true); });
    legendToggle.addEventListener('click', function () {
        setLegendCollapsed(!legend.classList.contains('legend-collapsed'));
    });
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!popup.hidden) {
            event.preventDefault();
            closePopup(true);
        } else if (!warningPanel.hidden) {
            event.preventDefault();
            closeWarningPanel(true);
        }
    });
    document.addEventListener('weather-grid:projection-changed', function () {
        rebuildTyphoonFeatures();
        rebuildLightningFeatures();
        closePopup(false);
        var app = document.querySelector('.app');
        if (typhoonAutoFitPending || (state.typhoon && state.typhoons.length
                && app && app.dataset.exploreMode === 'hazards')) {
            requestAnimationFrame(fitActiveTyphoons);
        }
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - state.warningFetchedAt >= WARNING_REFRESH_MS) loadWarnings(false);
        if (state.typhoon && Date.now() - state.typhoonFetchedAt >= TYPHOON_REFRESH_MS) loadTyphoons(false);
        if (state.lightning && Date.now() - state.lightningFetchedAt >= LIGHTNING_REFRESH_MS) loadLightning(false);
    });
    new MutationObserver(function () {
        themeColorCache = null;
        styleCache.clear();
        typhoonLayer.changed();
        lightningLayer.changed();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    if (window.WEATHER_GRID_OVERLAY_ROUTER) {
        window.WEATHER_GRID_OVERLAY_ROUTER.register('typhoon', {
            enabled: function () { return state.typhoon; },
            openFeature: openTyphoonFeature,
            nearest: nearestTyphoon,
            close: closePopup
        });
        window.WEATHER_GRID_OVERLAY_ROUTER.register('lightning', {
            enabled: function () { return state.lightning; },
            openFeature: openLightningFeature,
            nearest: nearestLightning,
            close: closePopup
        });
    }

    var refreshTimer = setInterval(function () {
        if (document.visibilityState === 'hidden') return;
        loadWarnings(false);
        if (state.typhoon) loadTyphoons(false);
        if (state.lightning) loadLightning(false);
    }, 60 * 1000);
    window.addEventListener('pagehide', function () {
        clearInterval(refreshTimer);
        cancelRequest('warnings');
        cancelRequest('typhoon');
        cancelRequest('lightning');
    }, { once: true });

    window.WEATHER_GRID_SEVERE_WEATHER = {
        getState: getState,
        getWarnings: function () {
            return state.warnings.map(function (warning) { return Object.assign({}, warning); });
        },
        setLayers: setLayers,
        setTyphoonEnabled: function (enabled) { setLayers({ typhoon: enabled, lightning: state.lightning }); },
        setLightningEnabled: function (enabled) { setLayers({ typhoon: state.typhoon, lightning: enabled }); },
        setLightningWindow: setLightningMinutes,
        fitActiveTyphoons: fitActiveTyphoons,
        refresh: function () {
            loadWarnings(true);
            if (state.typhoon) loadTyphoons(true);
            if (state.lightning) loadLightning(true);
        },
        isInteractiveFeature: function (feature) {
            if (!feature || typeof feature.get !== 'function') return false;
            var kind = feature.get('kind');
            if (kind === 'typhoon' || kind === 'lightning') return true;
            var members = feature.get('features');
            return Array.isArray(members) && members.some(function (member) {
                var memberKind = member && member.get && member.get('kind');
                return memberKind === 'typhoon' || memberKind === 'lightning';
            });
        }
    };

    updateControls();
    // 특보는 첫 화면의 안전 정보이므로 유휴 콜백까지 미루지 않는다. fetch 자체는 비동기로 진행된다.
    loadWarnings(false);
})();
