/**
 * 공유 URL과 도법 선택 UI를 순수 탐색 상태 모델에 연결한다.
 */
(function () {
    'use strict';

    var stateModel = window.WeatherGridNavigationState;
    if (!stateModel) throw new Error('WeatherGridNavigationState must load before weather-grid-navigation');
    var initialHash = location.hash || '';
    var hasInitialHash = initialHash.length > 1;

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
