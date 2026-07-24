/**
 * 기상 요소 세그먼트와 예보 재생을 명시적인 공개 API에 연결한다.
 * 상태 계산은 WeatherGridControlState, 실제 지도 조회는 WeatherGridTimeline이 소유한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridControlState;
    var Interface = window.WeatherGridInterface;
    var Timeline = window.WeatherGridTimeline;
    if (!State) throw new Error('WeatherGridControlState must load before WeatherGridControls');
    if (!Interface) throw new Error('WeatherGridInterface must load before WeatherGridControls');
    if (!Timeline) throw new Error('WeatherGridTimeline must load before WeatherGridControls');

    var metricSelect = document.getElementById('element');
    var metricSegments = ['seg_element', 'seg_precipitation', 'seg_additional_weather', 'seg_marine_weather'];
    var playButton = document.getElementById('btn_play');
    var timerId = null;
    var controlState = State.initial({
        selectedMetric: metricSelect ? metricSelect.value : 'wdws'
    });

    function weatherMeta(metric) {
        var registry = window.WEATHER_GRID_WEATHER_ELEMENTS || {};
        return registry[metric] || {};
    }

    function setSegmentSelection(segmentId, metric, aggregatePrecipitation) {
        var segment = document.getElementById(segmentId);
        if (!segment) return;
        segment.querySelectorAll('button[data-val]').forEach(function (button) {
            var selected = aggregatePrecipitation
                ? button.dataset.val === 'pcp' && State.isPrecipitation(metric)
                : button.dataset.val === metric;
            button.classList.toggle('on', selected);
            Interface.setPressed(button, selected);
        });
    }

    /** 빠른 선택과 세부 그룹, 3D 지원 여부를 현재 요소 메타데이터에 맞춘다. */
    function syncMetricControls(metric) {
        var selected = metric || (metricSelect && metricSelect.value) || controlState.selectedMetric;
        var meta = weatherMeta(selected);
        setSegmentSelection('seg_element', selected, true);
        setSegmentSelection('seg_precipitation', selected, false);
        setSegmentSelection('seg_additional_weather', selected, false);
        setSegmentSelection('seg_marine_weather', selected, false);

        var precipitation = document.getElementById('precipitation_elements');
        if (precipitation) precipitation.hidden = meta.group !== 'precipitation';
        var additional = document.getElementById('additional_weather_elements');
        if (additional && meta.group === 'additional') additional.open = true;
        var marine = document.getElementById('marine_weather_elements');
        if (marine && meta.group === 'marine') marine.open = true;

        document.querySelectorAll('#btn_3d, #btn_3d_dock').forEach(function (button) {
            var available = meta.view3d !== false;
            button.disabled = !available;
            button.setAttribute('aria-disabled', available ? 'false' : 'true');
            button.title = available ? '3D 지형 뷰' : (meta.label || selected) + ' 항목은 3D 표현을 제공하지 않습니다';
        });
    }

    function rememberMetric(metric, rememberWeather) {
        var outcome = State.transition(controlState, {
            type: 'metric/select',
            metric: metric,
            rememberWeather: rememberWeather
        });
        controlState = outcome.state;
        return controlState.selectedMetric;
    }

    function bindMetricSegment(segmentId) {
        var segment = document.getElementById(segmentId);
        if (!segment || !metricSelect) return;
        segment.addEventListener('click', function (event) {
            var button = event.target.closest('button[data-val]');
            if (!button || !segment.contains(button) || button.disabled
                || button.getAttribute('aria-disabled') === 'true') return;

            var metric = button.dataset.val;
            syncMetricControls(metric);
            if (metricSelect.value !== metric) {
                metricSelect.value = metric;
                metricSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            document.dispatchEvent(new CustomEvent('weather-grid:metric-selected', {
                detail: { metric: metric }
            }));
        });
    }

    function renderPlayback() {
        if (!playButton) return;
        var playing = controlState.playing;
        var playIcon = playButton.querySelector('.ic-play');
        var pauseIcon = playButton.querySelector('.ic-pause');
        if (playIcon) playIcon.style.display = playing ? 'none' : '';
        if (pauseIcon) pauseIcon.style.display = playing ? '' : 'none';
        playButton.classList.toggle('playing', playing);
        Interface.setPressed(playButton, playing);
        playButton.setAttribute('aria-label', playing
            ? '예보 3시간 간격 자동 재생 일시정지'
            : '예보 3시간 간격 자동 재생');
        playButton.title = playing
            ? '3시간 간격 자동 재생 일시정지 (Space)'
            : '3시간 간격 자동 재생 (Space)';
    }

    function cancelTimer() {
        if (timerId === null) return;
        window.clearTimeout(timerId);
        timerId = null;
    }

    function executeEffects(effects) {
        effects.forEach(function (item) {
            if (item.type === 'timer/cancel') {
                cancelTimer();
                return;
            }
            if (item.type === 'timer/schedule') {
                cancelTimer();
                timerId = window.setTimeout(function () {
                    timerId = null;
                    send({
                        type: 'timer/fired',
                        currentHour: Timeline.currentHour(),
                        loading: !!window.WEATHER_GRID_GRID_LOADING
                    });
                }, item.delay);
                return;
            }
            if (item.type === 'timeline/select') {
                Timeline.select(item.hour);
                if (window.syncTimelineA11y) window.setTimeout(window.syncTimelineA11y, 0);
            }
        });
    }

    function send(event) {
        var outcome = State.transition(controlState, event);
        controlState = outcome.state;
        renderPlayback();
        executeEffects(outcome.effects);
        return controlState;
    }

    function startPlayback() {
        return send({
            type: 'play/start',
            currentHour: Timeline.currentHour(),
            loading: !!window.WEATHER_GRID_GRID_LOADING
        });
    }

    function stopPlayback() {
        return send({ type: 'play/stop' });
    }

    function togglePlayback() {
        return controlState.playing ? stopPlayback() : startPlayback();
    }

    metricSegments.forEach(bindMetricSegment);
    syncMetricControls(controlState.selectedMetric);
    if (metricSelect) {
        metricSelect.addEventListener('change', function () {
            syncMetricControls(metricSelect.value);
            window.requestAnimationFrame(Interface.syncToggleStates);
        });
    }

    if (playButton) playButton.addEventListener('click', togglePlayback);

    document.addEventListener('weather-grid:grid-settled', function (event) {
        send({
            type: 'grid/settled',
            success: !(event.detail && event.detail.success === false),
            currentHour: Timeline.currentHour()
        });
    });

    document.addEventListener('weather-grid:forecast-control', function (event) {
        var action = event.detail && event.detail.action;
        if (['ini', 'sub', 'add', 'fnl'].indexOf(action) < 0) return;
        stopPlayback();
        Timeline.move(action, 1);
    });

    document.addEventListener('keydown', function (event) {
        if (event.code !== 'Space' || event.defaultPrevented || event.repeat) return;
        if (Interface.modal.active() || Interface.isInteractive(event.target)) return;
        event.preventDefault();
        togglePlayback();
    });

    document.querySelectorAll('[data-forecast]').forEach(function (control) {
        control.addEventListener('click', stopPlayback, true);
    });
    var forecastScrubber = document.getElementById('forecast_scrubber');
    if (forecastScrubber) {
        forecastScrubber.addEventListener('input', stopPlayback, true);
        forecastScrubber.addEventListener('change', stopPlayback, true);
    }

    renderPlayback();

    var metricApi = Object.freeze({
        sync: syncMetricControls,
        remember: rememberMetric,
        selected: function () { return controlState.selectedMetric; },
        lastPrecipitation: function () { return controlState.lastPrecipitationMetric; },
        lastWeather: function () { return controlState.lastWeatherMetric; },
        isPrecipitation: State.isPrecipitation
    });
    var playbackApi = Object.freeze({
        start: startPlayback,
        stop: stopPlayback,
        toggle: togglePlayback,
        isPlaying: function () { return controlState.playing; }
    });

    window.WeatherGridControls = Object.freeze({ metrics: metricApi, playback: playbackApi });
    window.WeatherGridPlayback = playbackApi;
    window.WEATHER_GRID_STOP_PLAYBACK = stopPlayback;
}(window, document));
