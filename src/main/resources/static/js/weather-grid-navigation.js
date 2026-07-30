/**
 * 공유 URL과 도법 선택 UI를 순수 탐색 상태 모델에 연결한다.
 */
(function () {
    'use strict';

    var stateModel = window.WeatherGridNavigationState;
    if (!stateModel) throw new Error('WeatherGridNavigationState must load before weather-grid-navigation');
    var initialHash = location.hash || '';
    var hasInitialHash = initialHash.length > 1;
    var shareButton = document.getElementById('btn_share');
    var shareStatus = document.getElementById('share_status');

    function syncProjection(code) {
        var segment = document.getElementById('seg_proj');
        if (!segment || stateModel.projections.indexOf(code) < 0) return false;
        segment.querySelectorAll('button[data-proj]').forEach(function (button) {
            var selected = button.dataset.proj === code;
            button.classList.toggle('on', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        return true;
    }

    function requestProjection(code, source) {
        if (!syncProjection(code)) return false;
        document.dispatchEvent(new CustomEvent('weather-grid:projection-requested', {
            detail: Object.freeze({ code: code, source: source || 'api' })
        }));
        return true;
    }

    var projectionSegment = document.getElementById('seg_proj');
    if (projectionSegment) {
        projectionSegment.addEventListener('click', function (event) {
            var button = event.target.closest('button[data-proj]');
            if (!button || !projectionSegment.contains(button)) return;
            requestProjection(button.dataset.proj, 'control');
        });
    }

    function announceShare(message) {
        if (shareStatus) shareStatus.textContent = message;
        if (typeof window.WEATHER_GRID_SHOW_NOTICE === 'function') {
            window.WEATHER_GRID_SHOW_NOTICE(message);
        }
    }

    async function shareCurrentMap() {
        if (typeof window.WEATHER_GRID_UPDATE_HASH === 'function') window.WEATHER_GRID_UPDATE_HASH();
        var url = location.href;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'BORA 한국 기상 격자지도',
                    text: '현재 지도 위치와 예보 조건을 공유합니다.',
                    url: url
                });
                announceShare('현재 지도를 공유했습니다.');
                return;
            }
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                throw new Error('CLIPBOARD_UNAVAILABLE');
            }
            await navigator.clipboard.writeText(url);
            announceShare('현재 지도 링크를 복사했습니다.');
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            announceShare('공유 링크를 만들지 못했습니다. 주소창의 링크를 복사해 주세요.');
        }
    }

    if (shareButton) shareButton.addEventListener('click', shareCurrentMap);

    var api = Object.freeze({
        hasInitialHash: hasInitialHash,
        readInitial: function (context) {
            return hasInitialHash ? stateModel.decode(initialHash, context) : null;
        },
        replace: function (state) {
            var encoded = stateModel.encode(state);
            history.replaceState(null, '', '#' + encoded);
            return encoded;
        },
        projection: Object.freeze({
            sync: syncProjection,
            request: requestProjection
        })
    });

    window.WeatherGridNavigation = api;
}());
