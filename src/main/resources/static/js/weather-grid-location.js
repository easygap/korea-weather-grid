/**
 * 지점·좌표 순수 상태를 상세예보, 시계열 fetch, 차트와 지도 팝업에 연결한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridLocationState;
    var MapRuntime = window.WeatherGridMapRuntime;
    var Render = window.WeatherGridRenderRuntime;
    if (!State || !MapRuntime || !Render) {
        throw new Error('Location state, map runtime and render runtime must load before weather-grid-location');
    }

    var STATION_TIMEOUT_MS = 20000;
    var COVERAGE_TIMEOUT_MS = 12000;
    var stationChannel = State.initialChannel();
    var coverageChannel = State.initialChannel();
    var stationTransport = null;
    var coverageTransport = null;

    function controlValue(id, fallback) {
        var control = document.getElementById(id);
        return control ? control.value : fallback;
    }

    function contextPath() {
        var app = document.querySelector('.app');
        return ((app && app.dataset.contextPath) || '').replace(/\/$/, '');
    }

    function apiPath(path) {
        return contextPath() + path;
    }

    function notify(message) {
        Render.setLoading(false);
        if (typeof window.fireAlert === 'function') {
            window.fireAlert({ title: '안내', text: message, confirmButtonText: '닫기' });
        }
    }

    function mapNotice(message) {
        if (typeof window.WEATHER_GRID_SHOW_NOTICE === 'function') {
            window.WEATHER_GRID_SHOW_NOTICE(message);
        }
    }

    function setChartBusy(busy) {
        var panel = document.querySelector('.station_chart_panel');
        if (panel) panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function showChartLoading() {
        var chart = document.getElementById('chart');
        if (!chart) return;
        var loading = document.createElement('div');
        loading.className = 'station_chart_loading';
        loading.setAttribute('role', 'status');
        loading.textContent = '시계열 예보를 불러오는 중…';
        chart.replaceChildren(loading);
        setChartBusy(true);
    }

    function showChartError(message, retryAction) {
        var chart = document.getElementById('chart');
        if (!chart) return;
        var error = document.createElement('div');
        error.className = 'station_chart_error';
        error.setAttribute('role', 'status');
        var text = document.createElement('p');
        text.textContent = message || State.stationError('network');
        error.appendChild(text);
        if (typeof retryAction === 'function') {
            var retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'station_chart_retry';
            retry.textContent = '다시 시도';
            retry.addEventListener('click', retryAction, { once: true });
            error.appendChild(retry);
        }
        chart.replaceChildren(error);
        setChartBusy(false);
    }

    function resetChartSurface() {
        var chart = document.getElementById('chart');
        if (window.WEATHER_GRID_STATION_CHARTS) window.WEATHER_GRID_STATION_CHARTS.destroy();
        else if (chart) chart.replaceChildren();
        ['station_chart_summary', 'station_data_table'].forEach(function (id) {
            var element = document.getElementById(id);
            if (element) element.replaceChildren();
        });
        var details = document.getElementById('station_data_details');
        if (details) details.open = false;
    }

    function abortStationTransport() {
        if (!stationTransport) return;
        window.clearTimeout(stationTransport.timer);
        stationTransport.controller.abort();
        stationTransport = null;
    }

    function beginStationRequest() {
        var started = State.transition(stationChannel, { type: 'request/start' });
        stationChannel = started.state;
        if (started.effects.some(function (effect) { return effect.type === 'request/abort'; })) {
            abortStationTransport();
        }
        return stationChannel.activeSequence;
    }

    function updateStation(event) {
        var result = State.transition(stationChannel, event);
        stationChannel = result.state;
        return result.effects;
    }

    function cancelStation() {
        var result = State.transition(stationChannel, { type: 'request/cancel' });
        stationChannel = result.state;
        abortStationTransport();
        setChartBusy(false);
    }

    function forecastRequest(request) {
        if (!request.loadForecast || !window.WEATHER_GRID_STATION_FORECAST) return null;
        return window.WEATHER_GRID_STATION_FORECAST.open({
            latitude: request.location.latitude,
            longitude: request.location.longitude,
            baseDate: request.baseDate,
            baseTime: request.baseTime
        });
    }

    function stationDataPromise(request, controller, sharedForecastRequest) {
        if (request.sharedForecast) {
            return Promise.resolve(sharedForecastRequest).then(function (forecast) {
                if (!forecast || !Array.isArray(forecast.items)) {
                    throw new Error('STATION_FORECAST_ELEMENT_UNAVAILABLE');
                }
                return forecast;
            });
        }
        return window.fetch(apiPath(request.timeseriesPath), {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            signal: controller.signal
        }).then(function (response) {
            if (!response.ok) throw new Error('STATION_DATA_UNAVAILABLE');
            return response.json();
        });
    }

    function openTimeline(options) {
        options = options || {};
        var built = State.timelineRequest({
            name: options.name,
            latitude: options.latitude,
            longitude: options.longitude,
            includeForecast: options.includeForecast,
            baseDate: controlValue('forecast_date', '').replaceAll('-', ''),
            baseTime: controlValue('baseTime', ''),
            element: controlValue('element', 'wdws'),
            height: controlValue('height', '10m')
        });
        if (!built.valid) {
            notify('올바른 위도와 경도를 입력해 주세요.');
            return false;
        }

        var request = built.request;
        document.querySelectorAll('.coordinate_popup').forEach(function (popup) { popup.style.display = 'none'; });
        var title = document.querySelector('.station_modal_header h2');
        if (title) {
            title.textContent = (request.location.name ? request.location.name + ' · ' : '')
                + '위도 ' + request.location.latitudeText + ' · 경도 ' + request.location.longitudeText;
        }
        resetChartSurface();
        if (window.WEATHER_GRID_STOP_PLAYBACK) window.WEATHER_GRID_STOP_PLAYBACK();

        var sequence = beginStationRequest();
        var controller = new AbortController();
        var transport = { sequence: sequence, controller: controller, timer: 0, timedOut: false };
        stationTransport = transport;
        transport.timer = window.setTimeout(function () {
            transport.timedOut = true;
            controller.abort();
        }, STATION_TIMEOUT_MS);

        showChartLoading();
        var dialog = document.querySelector('.station_modal');
        if (dialog) dialog.style.display = 'block';
        var sharedForecastRequest = forecastRequest(request);
        var chartReady = window.WEATHER_GRID_STATION_CHARTS
            ? window.WEATHER_GRID_STATION_CHARTS.ensureReady(request.element)
            : Promise.reject(new Error('STATION_CHART_MODULE_UNAVAILABLE'));

        Promise.all([
            stationDataPromise(request, controller, sharedForecastRequest),
            chartReady
        ]).then(function (results) {
            var effects = updateStation({
                type: 'request/succeeded', sequence: sequence, result: results[0]
            });
            if (!effects.some(function (effect) { return effect.type === 'request/present'; })) return;
            if (!window.WEATHER_GRID_STATION_CHARTS
                    || !window.WEATHER_GRID_STATION_CHARTS.render(request.element, results[0], request.chartDate)) {
                throw new Error('STATION_CHART_UNAVAILABLE');
            }
            setChartBusy(false);
        }).catch(function (error) {
            var stale = stationChannel.activeSequence !== sequence;
            if (stale) return;
            if (!controller.signal.aborted) controller.abort();
            var reason = transport.timedOut ? 'timeout'
                : (error && error.name === 'AbortError' ? 'abort'
                    : (error && error.code === 'SCRIPT_LOAD_TIMEOUT' ? 'module-timeout' : 'network'));
            var effects = updateStation({ type: 'request/failed', sequence: sequence, reason: reason });
            if (effects.some(function (effect) { return effect.type === 'request/error'; })) {
                showChartError(State.stationError(reason), function () {
                    openTimeline({
                        name: request.location.name,
                        latitude: request.location.latitude,
                        longitude: request.location.longitude,
                        includeForecast: false
                    });
                });
            }
        }).finally(function () {
            window.clearTimeout(transport.timer);
            if (stationTransport === transport) stationTransport = null;
            var effects = updateStation({ type: 'request/completed', sequence: sequence });
            if (effects.some(function (effect) { return effect.type === 'request/settled'; })) {
                setChartBusy(false);
            }
        });
        return true;
    }

    function openStation(name, latitude, longitude) {
        var location = State.normalizeLocation(name, latitude, longitude, true);
        if (!location) return false;
        if (typeof MapRuntime.selectStationName === 'function') MapRuntime.selectStationName(location.name);
        return openTimeline({
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
            includeForecast: true
        });
    }

    function openCurrentCoordinate() {
        var latitude = document.getElementById('latitude');
        var longitude = document.getElementById('longitude');
        return openTimeline({
            name: '',
            latitude: latitude && latitude.textContent,
            longitude: longitude && longitude.textContent,
            includeForecast: true
        });
    }

    function submitCoordinate() {
        var latitude = controlValue('coordinate_latitude', '');
        var longitude = controlValue('coordinate_longitude', '');
        if (!latitude || !longitude) {
            notify('위도와 경도를 빠짐없이 입력해 주세요.');
            return false;
        }
        var panel = document.querySelector('.coordinate_panel');
        var toggle = document.getElementById('coordinate_search_toggle');
        if (panel) panel.style.display = 'none';
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        return openTimeline({ name: '', latitude: latitude, longitude: longitude, includeForecast: true });
    }

    function abortCoverageTransport() {
        if (!coverageTransport) return;
        window.clearTimeout(coverageTransport.timer);
        coverageTransport.controller.abort();
        coverageTransport = null;
    }

    function cancelCoverage() {
        var result = State.transition(coverageChannel, { type: 'request/cancel' });
        coverageChannel = result.state;
        abortCoverageTransport();
    }

    function updateCoverage(event) {
        var result = State.transition(coverageChannel, event);
        coverageChannel = result.state;
        return result.effects;
    }

    function positionPopup(pixel) {
        var popup = document.querySelector('.coordinate_popup');
        if (!popup || !Array.isArray(pixel)
                || typeof MapRuntime.positionOverlayPopup !== 'function') return;
        popup.style.left = '8px';
        popup.style.top = '8px';
        popup.style.maxHeight = '';
        popup.style.display = 'block';
        window.requestAnimationFrame(function () {
            if (popup.style.display !== 'none') MapRuntime.positionOverlayPopup(popup, pixel);
        });
    }

    function inspectMapPoint(coordinate, pixel) {
        var previousPopup = document.querySelector('.coordinate_popup');
        if (previousPopup) previousPopup.style.display = 'none';
        var projectionCode = mapProjectionCode();
        var lonLat = MapRuntime.toGeographic(coordinate, projectionCode);
        var request = State.coverageRequest(lonLat && lonLat[1], lonLat && lonLat[0]);
        if (!request) {
            mapNotice(State.coverageMessage('network'));
            return false;
        }

        var started = State.transition(coverageChannel, { type: 'request/start' });
        coverageChannel = started.state;
        if (started.effects.some(function (effect) { return effect.type === 'request/abort'; })) {
            abortCoverageTransport();
        }
        var sequence = coverageChannel.activeSequence;
        var controller = new AbortController();
        var transport = { sequence: sequence, controller: controller, timer: 0, timedOut: false };
        coverageTransport = transport;
        transport.timer = window.setTimeout(function () {
            transport.timedOut = true;
            controller.abort();
        }, COVERAGE_TIMEOUT_MS);

        window.fetch(apiPath(request.path), {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            signal: controller.signal
        }).then(function (response) {
            if (!response.ok) throw new Error('COVERAGE_UNAVAILABLE');
            return response.json();
        }).then(function (result) {
            var effects = updateCoverage({
                type: 'request/succeeded', sequence: sequence, result: result
            });
            if (!effects.some(function (effect) { return effect.type === 'request/present'; })) return;
            if (result && result.inside === true) {
                document.getElementById('latitude').textContent = request.location.latitudeText;
                document.getElementById('longitude').textContent = request.location.longitudeText;
                positionPopup(pixel);
            } else {
                mapNotice(State.coverageMessage('outside'));
            }
        }).catch(function (error) {
            if (coverageChannel.activeSequence !== sequence) return;
            var reason = error && error.name === 'AbortError'
                ? (transport.timedOut ? 'timeout' : 'abort') : 'network';
            var effects = updateCoverage({ type: 'request/failed', sequence: sequence, reason: reason });
            if (effects.some(function (effect) { return effect.type === 'request/error'; })) {
                mapNotice(State.coverageMessage(reason));
            }
        }).finally(function () {
            window.clearTimeout(transport.timer);
            if (coverageTransport === transport) coverageTransport = null;
            updateCoverage({ type: 'request/completed', sequence: sequence });
        });
        return true;
    }

    function mapProjectionCode() {
        return MapRuntime.map.getView().getProjection().getCode();
    }

    document.addEventListener('weather-grid:station-modal-closed', function () {
        cancelStation();
        if (typeof MapRuntime.selectStationName === 'function') MapRuntime.selectStationName('');
    });
    document.addEventListener('weather-grid:location-forecast-requested', function (event) {
        var detail = event.detail || {};
        openStation(detail.name, detail.latitude, detail.longitude);
    });

    window.WEATHER_GRID_CANCEL_POINT_LOOKUP = cancelCoverage;
    window.WeatherGridLocation = Object.freeze({
        openTimeline: openTimeline,
        openStation: openStation,
        openCurrentCoordinate: openCurrentCoordinate,
        submitCoordinate: submitCoordinate,
        inspectMapPoint: inspectMapPoint,
        cancelCoverage: cancelCoverage,
        cancelStation: cancelStation,
        snapshot: function () {
            return Object.freeze({ station: stationChannel, coverage: coverageChannel });
        }
    });
}(window, document));
