/**
 * 지점 시계열과 지도 좌표 범위 조회의 입력·요청 순서를 네트워크와 DOM에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridLocationState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var ELEMENTS = Object.freeze(['wdws', 'tmp', 'pcp', 'pty', 'sno', 'reh', 'sky', 'wav', 'swdn']);
    var SHARED_FORECAST_ELEMENTS = Object.freeze(['pcp', 'pty', 'sno', 'reh', 'sky', 'wav']);
    var BASE_TIMES = Object.freeze(['02', '05', '08', '11', '14', '17', '20', '23']);

    function validCoordinate(latitude, longitude) {
        return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
            && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    }

    function normalizeLocation(name, latitude, longitude, requireName) {
        var normalizedName = typeof name === 'string' ? name.trim() : '';
        var lat = Number(latitude);
        var lon = Number(longitude);
        if ((requireName && !normalizedName) || normalizedName.length > 80 || !validCoordinate(lat, lon)) return null;
        return Object.freeze({
            name: normalizedName,
            latitude: lat,
            longitude: lon,
            latitudeText: lat.toFixed(4),
            longitudeText: lon.toFixed(4)
        });
    }

    function timelineRequest(input) {
        input = input || {};
        var location = normalizeLocation(input.name, input.latitude, input.longitude, false);
        var baseDate = String(input.baseDate || '');
        var baseTime = String(input.baseTime || '');
        if (!location || ELEMENTS.indexOf(input.element) < 0 || input.height !== '10m'
                || !/^\d{8}$/.test(baseDate) || BASE_TIMES.indexOf(baseTime) < 0) {
            return Object.freeze({ valid: false, request: null });
        }
        var sharedForecast = SHARED_FORECAST_ELEMENTS.indexOf(input.element) >= 0;
        var query = new URLSearchParams();
        query.set('latitude', location.latitudeText);
        query.set('longitude', location.longitudeText);
        query.set('baseDate', baseDate);
        query.set('baseTime', baseTime + '00');
        query.set('element', input.element);
        query.set('height', '10m');
        return Object.freeze({
            valid: true,
            request: Object.freeze({
                location: location,
                element: input.element,
                height: '10m',
                baseDate: baseDate,
                baseTime: baseTime + '00',
                chartDate: baseDate + baseTime,
                sharedForecast: sharedForecast,
                loadForecast: input.includeForecast !== false || sharedForecast,
                timeseriesPath: '/api/weather/timeseries?' + query.toString()
            })
        });
    }

    function coverageRequest(latitude, longitude) {
        var location = normalizeLocation('', latitude, longitude, false);
        if (!location) return null;
        var query = new URLSearchParams();
        query.set('latitude', location.latitudeText);
        query.set('longitude', location.longitudeText);
        return Object.freeze({
            location: location,
            path: '/api/weather/coverage?' + query.toString()
        });
    }

    function channelSnapshot(nextSequence, activeSequence, status) {
        return Object.freeze({
            nextSequence: nextSequence,
            activeSequence: activeSequence,
            status: status
        });
    }

    function initialChannel() {
        return channelSnapshot(1, null, 'idle');
    }

    function outcome(state, effects) {
        return Object.freeze({
            state: state,
            effects: Object.freeze((effects || []).map(function (effect) { return Object.freeze(effect); }))
        });
    }

    function transition(state, event) {
        state = state || initialChannel();
        event = event || {};
        if (event.type === 'request/start') {
            var sequence = state.nextSequence;
            var effects = [];
            if (state.activeSequence !== null) effects.push({ type: 'request/abort' });
            effects.push({ type: 'request/send', sequence: sequence });
            return outcome(channelSnapshot(sequence + 1, sequence, 'loading'), effects);
        }
        if (event.type === 'request/cancel') {
            var cancelEffects = state.activeSequence === null ? [] : [{ type: 'request/abort' }];
            return outcome(channelSnapshot(state.nextSequence, null, 'idle'), cancelEffects);
        }
        if (event.sequence !== state.activeSequence) return outcome(state);
        if (event.type === 'request/succeeded') {
            return outcome(channelSnapshot(state.nextSequence, state.activeSequence, 'ready'), [
                { type: 'request/present', result: event.result }
            ]);
        }
        if (event.type === 'request/failed') {
            if (event.reason === 'abort') return outcome(state);
            return outcome(channelSnapshot(state.nextSequence, state.activeSequence, 'failed'), [
                { type: 'request/error', reason: event.reason || 'network' }
            ]);
        }
        if (event.type === 'request/completed') {
            return outcome(channelSnapshot(state.nextSequence, null, 'idle'), [{ type: 'request/settled' }]);
        }
        return outcome(state);
    }

    function stationError(reason) {
        if (reason === 'timeout') {
            return '시계열 응답 시간이 초과되었습니다. 다시 시도해 주세요. 상세예보는 계속 확인할 수 있습니다.';
        }
        if (reason === 'module-timeout') {
            return '차트 모듈 응답 시간이 초과되었습니다. 다시 시도해 주세요. 상세예보는 계속 확인할 수 있습니다.';
        }
        return '시계열 차트를 불러오지 못했습니다. 상세예보는 계속 확인할 수 있습니다.';
    }

    function coverageMessage(reason) {
        if (reason === 'outside') return '선택한 지점은 시계열 지원 범위 밖입니다.';
        if (reason === 'timeout') return '지점 확인 시간이 초과되었습니다. 다시 시도해 주세요.';
        return '지점 정보를 확인하지 못했습니다. 다시 시도해 주세요.';
    }

    return Object.freeze({
        elements: ELEMENTS,
        sharedForecastElements: SHARED_FORECAST_ELEMENTS,
        normalizeLocation: normalizeLocation,
        timelineRequest: timelineRequest,
        coverageRequest: coverageRequest,
        initialChannel: initialChannel,
        transition: transition,
        stationError: stationError,
        coverageMessage: coverageMessage
    });
}));
