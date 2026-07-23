/**
 * 3D 지도 로딩·표시 상태와 2D 바람장 복구 조건을 DOM 없이 계산한다.
 */
(function (root, factory) {
    'use strict';

    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridView3dState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function snapshot(status, errorCode) {
        return Object.freeze({ status: status, errorCode: errorCode || null });
    }

    function initial() {
        return snapshot('idle');
    }

    function outcome(state, effects) {
        return Object.freeze({ state: state, effects: Object.freeze((effects || []).map(Object.freeze)) });
    }

    function transition(state, event) {
        state = state || initial();
        event = event || {};
        if (event.type === 'open/request') {
            if (state.status === 'loading' || state.status === 'open') return outcome(state);
            return outcome(snapshot('loading'), [{ type: 'module/load' }]);
        }
        if (event.type === 'open/succeeded' && state.status === 'loading') {
            return outcome(snapshot('open'), [{ type: 'modal/open' }]);
        }
        if (event.type === 'open/failed' && state.status === 'loading') {
            return outcome(snapshot('idle', event.code || 'load'));
        }
        if (event.type === 'close' && state.status !== 'idle') {
            return outcome(initial(), [{ type: 'modal/close' }]);
        }
        return outcome(state);
    }

    function render(state) {
        var status = state && state.status ? state.status : 'idle';
        return Object.freeze({
            busy: status === 'loading',
            active: status === 'open',
            expanded: status === 'open'
        });
    }

    function errorMessage(code) {
        if (code === 'timeout') {
            return '3D 지도 모듈 응답 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
        }
        if (code === 'open') return '3D 지도를 여는 중 오류가 발생했습니다. 다시 시도해 주세요.';
        return '3D 지도 데이터를 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.';
    }

    function streamWasVisible(options) {
        options = options || {};
        return options.metric === 'wdws' && Boolean(options.layers && options.layers.stream)
            && Boolean(options.canvasVisible);
    }

    function shouldResumeStream(wasVisible, options) {
        options = options || {};
        return Boolean(wasVisible) && options.metric === 'wdws'
            && Boolean(options.layers && options.layers.stream);
    }

    return Object.freeze({
        initial: initial,
        transition: transition,
        render: render,
        errorMessage: errorMessage,
        streamWasVisible: streamWasVisible,
        shouldResumeStream: shouldResumeStream
    });
}));
