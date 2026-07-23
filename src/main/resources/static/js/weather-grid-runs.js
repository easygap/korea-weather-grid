/**
 * 발표시각 상태를 날짜 입력·이동 버튼·격자 조회에 연결한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridRunState;
    if (!State) throw new Error('WeatherGridRunState must load before weather-grid-runs');

    var formatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });

    function dateInput() { return document.getElementById('forecast_date'); }
    function timeInput() { return document.getElementById('baseTime'); }

    function selectedEpoch() {
        var date = dateInput();
        var time = timeInput();
        return State.parse(date ? date.value : '', time ? time.value : '');
    }

    function latestEpoch() {
        return State.parse(window.todayStr || '', window.time || '');
    }

    function setButtonAvailability(button, enabled, title) {
        if (!button) return;
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        button.title = title;
    }

    function render() {
        var selected = selectedEpoch();
        var latest = latestEpoch();
        var status = State.availability(selected, latest);
        var label = document.getElementById('base_run_label');
        if (label) label.textContent = selected === null
            ? '날짜를 확인해 주세요'
            : formatter.format(new Date(selected)).replace(/\.$/, '') + ' KST';

        setButtonAvailability(document.getElementById('base_run_prev'), status.previous,
            status.previous ? '3시간 전 발표로 이동' : '조회 가능한 가장 이른 발표입니다');
        setButtonAvailability(document.getElementById('base_run_next'), status.next,
            status.next ? '3시간 뒤 발표로 이동' : '가장 최근 발표입니다');

        var latestButton = document.querySelector('#forecast_source_settings .latest_run_button');
        if (latestButton) {
            latestButton.classList.toggle('is-current', status.latest);
            latestButton.setAttribute('aria-pressed', status.latest ? 'true' : 'false');
            latestButton.title = status.latest ? '현재 가장 최근 발표를 보고 있습니다' : '가장 최근 발표 선택';
        }
        return status;
    }

    function syncTimeButtons(hour) {
        document.querySelectorAll('.forecast_run_button').forEach(function (button) {
            var selected = button.textContent.trim() === hour;
            button.classList.toggle('on', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
            var item = button.closest('li');
            if (item) item.classList.toggle('on', selected);
        });
    }

    function restore(date, hour) {
        if (dateInput()) dateInput().value = date;
        if (timeInput()) timeInput().value = hour;
        syncTimeButtons(hour);
        if (typeof window.syncAvailableBaseTimes === 'function') window.syncAvailableBaseTimes();
        render();
        return selectedEpoch();
    }

    function requestGrid() {
        if (typeof window.refreshWeatherGrid === 'function') window.refreshWeatherGrid();
        else if (typeof window.WEATHER_GRID_REFRESH_GRID === 'function') window.WEATHER_GRID_REFRESH_GRID();
    }

    function selectEpoch(epoch) {
        var next = State.parts(epoch);
        if (!next) return false;
        restore(next.date, next.hour);
        document.dispatchEvent(new CustomEvent('weather-grid:base-time-changed', {
            detail: Object.freeze({ baseTime: next.hour, date: next.date })
        }));
        return true;
    }

    function move(direction) {
        var candidate = State.shift(selectedEpoch(), latestEpoch(), direction);
        return candidate === null ? false : selectEpoch(candidate);
    }

    var previous = document.getElementById('base_run_prev');
    var next = document.getElementById('base_run_next');
    if (previous) previous.addEventListener('click', function () { move(-1); });
    if (next) next.addEventListener('click', function () { move(1); });

    document.addEventListener('weather-grid:base-time-changed', function () {
        render();
        requestGrid();
        window.requestAnimationFrame(function () {
            if (window.WeatherGridInterface) window.WeatherGridInterface.syncToggleStates();
        });
    });

    var latestButton = document.querySelector('#forecast_source_settings .latest_run_button');
    if (latestButton) latestButton.addEventListener('click', function () {
        render();
        requestGrid();
    });

    if (dateInput()) dateInput().addEventListener('change', function () {
        var normalized = State.clampDate(dateInput().value, window.todayStr || '');
        if (normalized) dateInput().value = normalized;
        if (typeof window.syncAvailableBaseTimes === 'function') window.syncAvailableBaseTimes();
        render();
        requestGrid();
    });

    document.addEventListener('weather-grid:grid-settled', render);
    window.jQuery(render);

    window.WeatherGridRuns = Object.freeze({
        selected: selectedEpoch,
        latest: latestEpoch,
        move: move,
        restore: restore,
        sync: render
    });
}(window, document));
