/**
 * 격자 조회 선택 검증과 요청 생명주기를 네트워크·DOM 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridDataState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var ELEMENTS = Object.freeze(['wdws', 'tmp', 'pcp', 'pty', 'sno', 'reh', 'sky', 'wav', 'swdn']);
    var BASE_TIMES = Object.freeze(['02', '05', '08', '11', '14', '17', '20', '23']);
    var DAY_MS = 24 * 60 * 60 * 1000;

    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        var parts = value.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return date.getUTCFullYear() === parts[0]
            && date.getUTCMonth() === parts[1] - 1
            && date.getUTCDate() === parts[2];
    }

    function dateEpoch(value) {
        var parts = value.split('-').map(Number);
        return Date.UTC(parts[0], parts[1] - 1, parts[2]);
    }

    function selectionError(input, latest) {
        input = input || {};
        latest = latest || {};
        if (ELEMENTS.indexOf(input.element) < 0) return 'element';
        if (input.height !== '10m') return 'height';
        if (!validDate(input.date) || !validDate(latest.date)) return 'date';
        if (BASE_TIMES.indexOf(input.baseTime) < 0 || BASE_TIMES.indexOf(latest.time) < 0) return 'baseTime';
        var selectedDay = dateEpoch(input.date);
        var latestDay = dateEpoch(latest.date);
        if (selectedDay < latestDay - 60 * DAY_MS || selectedDay > latestDay) return 'dateRange';
        if (selectedDay === latestDay && Number(input.baseTime) > Number(latest.time)) return 'futureRun';
        var leadHour = Number(input.leadHour);
        if (!Number.isInteger(leadHour) || leadHour < 1 || leadHour > 48) return 'leadHour';
        return null;
    }

    function buildRequest(input, latest) {
        var error = selectionError(input, latest);
        if (error) return Object.freeze({ valid: false, error: error, request: null });
        var request = Object.freeze({
            element: input.element,
            baseDate: input.date.replaceAll('-', ''),
            baseTime: input.baseTime,
            leadHours: String(Number(input.leadHour)).padStart(3, '0'),
            height: '10m'
        });
        return Object.freeze({ valid: true, error: null, request: request });
    }

    function query(request) {
        if (!request) return '';
        var params = new URLSearchParams();
        params.set('baseDate', request.baseDate);
        params.set('baseTime', request.baseTime + '00');
        params.set('element', request.element);
        params.set('height', request.height);
        params.set('leadHours', String(Number(request.leadHours)));
        return '/api/weather/grid?' + params.toString();
    }

    function snapshot(nextSequence, activeSequence, status, successful) {
        return Object.freeze({
            nextSequence: nextSequence,
            activeSequence: activeSequence,
            status: status,
            successful: Boolean(successful)
        });
    }

    function initial() {
        return snapshot(1, null, 'idle', false);
    }

    function outcome(state, effects) {
        return Object.freeze({
            state: state,
            effects: Object.freeze((effects || []).map(function (effect) {
                return Object.freeze(effect);
            }))
        });
    }

    function responseKind(result) {
        if (!result || !Array.isArray(result.data) || result.data.length === 0) return 'empty';
        if (!Number.isInteger(result.nx) || result.nx <= 0
                || !Number.isInteger(result.ny) || result.ny <= 0
                || result.data.length !== result.nx * result.ny
                || !Number.isFinite(result.nxMin) || !Number.isFinite(result.nyMin)
                || !Number.isFinite(result.step) || result.step <= 0) return 'invalid';
        return 'ready';
    }

    function transition(state, event) {
        state = state || initial();
        event = event || {};
        if (event.type === 'request/start') {
            var sequence = state.nextSequence;
            var effects = [];
            if (state.activeSequence !== null) effects.push({ type: 'request/abort' });
            if (!event.selection || !event.selection.valid) {
                effects.push({ type: 'selection/rejected', error: event.selection && event.selection.error });
                return outcome(snapshot(sequence + 1, null, 'idle', false), effects);
            }
            effects.push({ type: 'grid/reset', request: event.selection.request });
            effects.push({ type: 'request/fetch', sequence: sequence, request: event.selection.request });
            return outcome(snapshot(sequence + 1, sequence, 'loading', false), effects);
        }
        if (event.sequence !== state.activeSequence) return outcome(state);
        if (event.type === 'request/succeeded') {
            var kind = responseKind(event.result);
            if (kind === 'ready') {
                return outcome(snapshot(state.nextSequence, state.activeSequence, 'ready', true), [{
                    type: 'grid/present', result: event.result, request: event.request
                }]);
            }
            return outcome(snapshot(state.nextSequence, state.activeSequence, kind, false), [{
                type: kind === 'empty' ? 'grid/empty' : 'grid/error',
                reason: kind === 'empty' ? 'empty' : 'invalid-response',
                request: event.request
            }]);
        }
        if (event.type === 'request/failed') {
            if (event.reason === 'abort') return outcome(state);
            return outcome(snapshot(state.nextSequence, state.activeSequence, 'failed', false), [{
                type: 'grid/error', reason: event.reason || 'network', status: event.status || 0
            }]);
        }
        if (event.type === 'request/completed') {
            return outcome(snapshot(state.nextSequence, null, 'idle', false), [{
                type: 'grid/settled', success: state.successful
            }]);
        }
        return outcome(state);
    }

    function errorMessage(reason, status) {
        if (reason === 'timeout') return '기상 데이터 응답 시간이 초과되었습니다. 다시 시도해 주세요.';
        if (Number(status) === 429) return '요청이 많아 잠시 후 다시 시도해 주세요.';
        if (reason === 'invalid-response') return '기상 데이터 응답 형식을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.';
        return '기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }

    return Object.freeze({
        elements: ELEMENTS,
        baseTimes: BASE_TIMES,
        initial: initial,
        transition: transition,
        buildRequest: buildRequest,
        query: query,
        responseKind: responseKind,
        errorMessage: errorMessage
    });
}));
