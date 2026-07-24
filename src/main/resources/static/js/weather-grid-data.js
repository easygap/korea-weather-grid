/**
 * 격자 조회 상태 모델을 브라우저 네트워크와 지도 렌더러에 연결한다.
 * 전송 취소·타임아웃·응답 순서 방어는 이 어댑터 한 곳에서만 관리한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridDataState;
    var RunState = window.WeatherGridRunState;
    var Runs = window.WeatherGridRuns;
    var Timeline = window.WeatherGridTimeline;
    var Controls = window.WeatherGridControls;
    var Render = window.WeatherGridRenderRuntime;
    if (!State || !RunState || !Runs || !Timeline || !Controls || !Render) {
        throw new Error('Data state, runs, timeline, controls and render runtime must load before weather-grid-data');
    }

    var REQUEST_TIMEOUT_MS = 35000;
    var lifecycle = State.initial();
    var activeTransport = null;

    function elementValue(id, fallback) {
        var element = document.getElementById(id);
        return element ? element.value : fallback;
    }

    function latestParts() {
        return RunState.parts(Runs.latest()) || Object.freeze({
            date: window.todayStr || '',
            hour: window.time || ''
        });
    }

    function currentSelection() {
        var latest = latestParts();
        return State.buildRequest({
            element: elementValue('element', 'wdws'),
            height: elementValue('height', '10m'),
            date: elementValue('forecast_date', ''),
            baseTime: elementValue('baseTime', ''),
            leadHour: Timeline.currentHour()
        }, { date: latest.date, time: latest.hour });
    }

    function apiPath(request) {
        var contextPath = (document.querySelector('.app')?.dataset.contextPath || '').replace(/\/$/, '');
        return contextPath + State.query(request);
    }

    function stopPlayback() {
        Controls.playback.stop();
    }

    function dispatchSettled(success) {
        document.dispatchEvent(new CustomEvent('weather-grid:grid-settled', {
            detail: Object.freeze({ success: Boolean(success) })
        }));
    }

    function showSelectionError() {
        var message = '최근 60일 이내의 유효한 날짜와 발표시각을 선택해 주세요.';
        if (typeof window.notifyUser === 'function') window.notifyUser(message);
        else if (typeof window.fireAlert === 'function') {
            window.fireAlert({ title: '안내', text: message, confirmButtonText: '닫기' });
        }
    }

    function restoreLatestRun() {
        var latest = latestParts();
        if (!latest.date || !latest.hour) return false;
        Runs.restore(latest.date, latest.hour);
        Timeline.restore(1);
        if (typeof window.refreshWeatherGrid === 'function') window.refreshWeatherGrid();
        else refresh();
        return true;
    }

    function showEmptyDecision() {
        var latest = latestParts();
        var options = {
            title: '자료 없음',
            text: '선택한 발표 시각에는 자료가 없습니다.\n'
                + latest.date + ' ' + latest.hour + '시 발표 자료로 이동할까요?',
            showCancelButton: true,
            confirmButtonText: '이동',
            cancelButtonText: '현재 선택 유지'
        };
        if (typeof window.fireAlert !== 'function') return Promise.resolve(false);
        return window.fireAlert(options).then(function (decision) {
            if (decision && decision.isConfirmed) return restoreLatestRun();
            return false;
        });
    }

    function abortActiveTransport() {
        if (!activeTransport) return;
        activeTransport.controller.abort();
    }

    function startFetch(effect) {
        var controller = new AbortController();
        var transport = {
            controller: controller,
            sequence: effect.sequence,
            timedOut: false,
            timer: 0
        };
        activeTransport = transport;
        transport.timer = window.setTimeout(function () {
            transport.timedOut = true;
            controller.abort();
        }, REQUEST_TIMEOUT_MS);

        window.fetch(apiPath(effect.request), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            signal: controller.signal
        }).then(function (response) {
            if (!response.ok) {
                var error = new Error('weather grid response ' + response.status);
                error.status = response.status;
                throw error;
            }
            return response.json();
        }).then(function (result) {
            send({
                type: 'request/succeeded',
                sequence: effect.sequence,
                request: effect.request,
                result: result
            });
        }).catch(function (error) {
            var aborted = error && error.name === 'AbortError';
            send({
                type: 'request/failed',
                sequence: effect.sequence,
                reason: transport.timedOut ? 'timeout' : (aborted ? 'abort' : 'network'),
                status: error && Number(error.status) || 0
            });
            if (!aborted && window.console && console.warn) {
                console.warn('weather grid request failed', error);
            }
        }).finally(function () {
            window.clearTimeout(transport.timer);
            if (activeTransport === transport) activeTransport = null;
            send({ type: 'request/completed', sequence: effect.sequence });
        });
    }

    function executeEffects(effects) {
        effects.forEach(function (effect) {
            if (effect.type === 'request/abort') {
                abortActiveTransport();
                return;
            }
            if (effect.type === 'selection/rejected') {
                Render.setLoading(false);
                window.WEATHER_GRID_GRID_LOADING = false;
                stopPlayback();
                showSelectionError();
                dispatchSettled(false);
                return;
            }
            if (effect.type === 'grid/reset') {
                Render.reset(effect.request);
                Render.setLoading(true);
                if (typeof window.clearDataError === 'function') window.clearDataError('grid');
                window.WEATHER_GRID_GRID_LOADING = true;
                return;
            }
            if (effect.type === 'request/fetch') {
                startFetch(effect);
                return;
            }
            if (effect.type === 'grid/present') {
                Render.present(effect.result, effect.request);
                if (typeof window.clearDataError === 'function') window.clearDataError('grid');
                return;
            }
            if (effect.type === 'grid/empty') {
                Render.clearWind();
                if (typeof window.setDataError === 'function') {
                    window.setDataError('선택한 발표시각에는 제공되는 데이터가 없습니다.', 'grid');
                }
                stopPlayback();
                showEmptyDecision();
                return;
            }
            if (effect.type === 'grid/error') {
                if (typeof window.setDataError === 'function') {
                    window.setDataError(State.errorMessage(effect.reason, effect.status), 'grid');
                }
                stopPlayback();
                return;
            }
            if (effect.type === 'grid/settled') {
                Render.setLoading(false);
                window.WEATHER_GRID_GRID_LOADING = false;
                dispatchSettled(effect.success);
            }
        });
    }

    function send(event) {
        var outcome = State.transition(lifecycle, event);
        lifecycle = outcome.state;
        executeEffects(outcome.effects);
        return lifecycle;
    }

    function refresh() {
        if (typeof window.syncAvailableBaseTimes === 'function') window.syncAvailableBaseTimes();
        send({ type: 'request/start', selection: currentSelection() });
        return lifecycle.activeSequence !== null;
    }

    window.WeatherGridData = Object.freeze({
        refresh: refresh,
        abort: abortActiveTransport,
        snapshot: function () { return lifecycle; }
    });
}(window, document));
