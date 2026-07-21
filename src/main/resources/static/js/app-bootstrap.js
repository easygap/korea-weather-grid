/**
 * Spring JSP와 Cloudflare 정적 셸의 공통 부트스트랩.
 * 인라인 스크립트/이벤트 핸들러를 제거해 strict script-src CSP를 사용할 수 있게 한다.
 */
(function () {
    'use strict';

    var app = document.querySelector('.app');
    if (!app) return;

    var contextPath = app.dataset.contextPath || '';
    try { sessionStorage.setItem('contextpath', contextPath); } catch (e) { /* 저장소 차단 시에도 앱은 동작 */ }

    // Cloudflare 셸은 JSP 반복문이 없으므로 실제 제공되는 +1~+48h 슬롯을 DOM API로 생성한다.
    var timeList = document.querySelector('#forecast_timeline ul');
    var forecastScrubber = document.getElementById('forecast_scrubber');
    var usesForecastScrubber = !!forecastScrubber;
    if (timeList && !timeList.children.length) {
        var timeFragment = document.createDocumentFragment();
        for (var hour = 1; hour <= 48; hour++) {
            var item = document.createElement('li');
            item.value = hour;
            if (hour === 1) item.className = 'on';
            var marker = document.createElement('button');
            marker.type = 'button';
            marker.tabIndex = usesForecastScrubber ? -1 : (hour === 1 ? 0 : -1);
            if (!usesForecastScrubber) marker.setAttribute('aria-label', '+' + hour + '시간 예보');
            item.appendChild(marker);
            item.appendChild(document.createElement('span'));
            timeFragment.appendChild(item);
        }
        timeList.appendChild(timeFragment);
    }

    function getForecastHour(item, fallback) {
        var rawHour = item ? parseInt(item.getAttribute('value'), 10) : NaN;
        return Number.isFinite(rawHour) ? rawHour : fallback;
    }

    function getForecastValueText(item, hour) {
        var label = '+' + hour + '시간 예보';
        var timestamp = item && item.querySelector('span')
            ? item.querySelector('span').textContent.trim()
            : '';
        if (!timestamp) return label;
        return label + ', ' + timestamp + (/\sKST$/i.test(timestamp) ? '' : ' KST');
    }

    /** range가 없는 구형 셸에서만 현재 슬롯 하나를 Tab으로 접근하게 한다. */
    function syncTimelineA11y() {
        if (!timeList) return;
        var items = Array.prototype.slice.call(timeList.querySelectorAll('li'));
        var activeItem = timeList.querySelector('li.on') || items[0];

        if (usesForecastScrubber) {
            timeList.setAttribute('aria-hidden', 'true');
            items.forEach(function (item) {
                var button = item.querySelector('button');
                if (!button) return;
                button.type = 'button';
                button.tabIndex = -1;
                button.removeAttribute('aria-current');
                button.removeAttribute('aria-label');
            });
            var activeIndex = Math.max(0, items.indexOf(activeItem));
            var activeHour = getForecastHour(activeItem, activeIndex);
            forecastScrubber.value = String(activeHour);
            forecastScrubber.setAttribute('aria-valuetext', getForecastValueText(activeItem, activeHour));
            return;
        }

        items.forEach(function (item, index) {
            var button = item.querySelector('button');
            if (!button) return;
            var forecastHour = getForecastHour(item, index);
            var isCurrent = item === activeItem;
            button.type = 'button';
            button.tabIndex = isCurrent ? 0 : -1;
            button.setAttribute('aria-label', '+' + forecastHour + '시간 예보');
            if (isCurrent) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
    }

    if (timeList) {
        syncTimelineA11y();
        if (!usesForecastScrubber) {
            timeList.addEventListener('keydown', function (event) {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                var buttons = Array.prototype.slice.call(timeList.querySelectorAll('li > button'));
                var current = event.target.closest('li > button');
                var index = buttons.indexOf(current);
                if (index < 0) return;

                event.preventDefault();
                event.stopPropagation();
                var nextIndex = event.key === 'Home' ? 0
                    : event.key === 'End' ? buttons.length - 1
                    : event.key === 'ArrowRight' ? Math.min(buttons.length - 1, index + 1)
                    : Math.max(0, index - 1);
                var next = buttons[nextIndex];
                next.focus();
                next.click();
            });
            timeList.addEventListener('click', function (event) {
                if (event.target.closest('li > button')) setTimeout(syncTimelineA11y, 0);
            });
        }
        new MutationObserver(syncTimelineA11y).observe(timeList, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }
    window.syncTimelineA11y = syncTimelineA11y;

    // 인라인 onclick 대체 — CSP script-src-attr 'none'과 키보드 접근성을 함께 만족한다.
    var inputClose = document.querySelector('.coordinate_panel_close');
    if (inputClose) {
        inputClose.addEventListener('click', function (event) {
            // 닫기 버튼이 좌표 검색 제출로 오인되지 않도록 닫기 동작을 여기서 종결한다.
            event.stopImmediatePropagation();
            var panel = inputClose.closest('.coordinate_panel');
            if (panel) panel.style.display = 'none';
            var coordinateToggle = document.getElementById('coordinate_search_toggle');
            if (coordinateToggle) {
                coordinateToggle.setAttribute('aria-expanded', 'false');
                coordinateToggle.focus({ preventScroll: true });
            }
        });
    }
    document.querySelectorAll('[data-forecast]').forEach(function (button) {
        button.addEventListener('click', function () {
            forecast(button.dataset.forecast);
            setTimeout(syncTimelineA11y, 0);
        });
    });

    var dataError = document.getElementById('data_error');
    var retryData = document.getElementById('retry_data');
    if (retryData) {
        retryData.addEventListener('click', function () {
            var geodataFailure = dataError && dataError.dataset.errorSource === 'geodata';
            if (dataError) dataError.hidden = true;
            if (geodataFailure && typeof window.WEATHER_GRID_RETRY_GEODATA === 'function') {
                retryData.disabled = true;
                retryData.setAttribute('aria-busy', 'true');
                window.WEATHER_GRID_RETRY_GEODATA().catch(function () { /* 배너는 로더가 다시 표시 */ })
                    .finally(function () {
                        retryData.disabled = false;
                        retryData.removeAttribute('aria-busy');
                    });
                return;
            }
            if (typeof window.WEATHER_GRID_REFRESH_GRID === 'function') {
                window.WEATHER_GRID_REFRESH_GRID();
            }
        });
    }

    function pad2(value) { return value < 10 ? '0' + value : String(value); }
    function latestKstBase() {
        var kst = new Date(Date.now() + 9 * 3600e3);
        var currentHour = kst.getUTCHours(), minute = kst.getUTCMinutes();
        // 이 폴백은 클라이언트 시계 기준 — 서버(HH:10 컷오프)보다 몇 분 빠른 시계면
        // 아직 발표 전인 시각을 골라 400을 받는다. 컷오프에 스큐 여유를 둔다.
        var CUTOFF_MIN = 13;
        var releaseHours = [23, 20, 17, 14, 11, 8, 5, 2], releaseHour = null;
        for (var index = 0; index < releaseHours.length; index++) {
            if (currentHour > releaseHours[index]
                    || (currentHour === releaseHours[index] && minute >= CUTOFF_MIN)) {
                releaseHour = releaseHours[index];
                break;
            }
        }
        if (releaseHour === null) {
            kst = new Date(kst.getTime() - 86400e3);
            releaseHour = 23;
        }
        return {
            date: '' + kst.getUTCFullYear() + pad2(kst.getUTCMonth() + 1) + pad2(kst.getUTCDate()),
            time: pad2(releaseHour) + '00'
        };
    }

    var fallback = latestKstBase();
    var suppliedDate = app.dataset.baseDate || '';
    var suppliedTime = app.dataset.baseTime || '';
    window.baseDate = /^\d{8}$/.test(suppliedDate) ? suppliedDate : fallback.date;
    window.baseTime = /^(02|05|08|11|14|17|20|23)00$/.test(suppliedTime) ? suppliedTime : fallback.time;
    window.largestFileName = app.dataset.fileName || (window.baseDate + window.baseTime.slice(0, 2) + '_000');

    window.year = window.baseDate.substring(0, 4);
    window.month = window.baseDate.substring(4, 6);
    window.day = window.baseDate.substring(6, 8);
    window.time = window.baseTime.substring(0, 2);
    // 단기예보의 첫 유효 슬롯은 발표 +1시간이다. +0h를 표시하면 실제 자료 시각과 어긋난다.
    window.leadHours = '001';
    window.todayStr = window.year + '-' + window.month + '-' + window.day;

    $('#baseTime').val(window.time);
    $('.forecast_run_button').removeClass('on').each(function () {
        if ($(this).text() === window.time) $(this).addClass('on');
    });
})();
