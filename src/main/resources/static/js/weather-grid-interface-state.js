/**
 * 브라우저 UI의 겹침 상태를 DOM과 분리해 계산한다.
 * 같은 전이 함수를 정적 셸과 Spring 셸이 공유하며, DOM 어댑터는 계산 결과만 반영한다.
 */
(function (root, factory) {
    'use strict';

    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WeatherGridInterfaceState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var DARK = 'dark';
    var LIGHT = 'light';

    function themeValue(value) {
        return value === LIGHT ? LIGHT : DARK;
    }

    function snapshot(value) {
        return Object.freeze({
            theme: themeValue(value.theme),
            compact: !!value.compact,
            dockOpen: !!value.dockOpen,
            activeModal: value.activeModal || null
        });
    }

    function initial(options) {
        var source = options || {};
        return snapshot({
            theme: source.theme,
            compact: source.compact,
            dockOpen: false,
            activeModal: null
        });
    }

    function transition(current, event) {
        if (!current || !event || typeof event.type !== 'string') return current;

        var next = {
            theme: current.theme,
            compact: current.compact,
            dockOpen: current.dockOpen,
            activeModal: current.activeModal
        };

        switch (event.type) {
        case 'theme/set':
            next.theme = themeValue(event.theme);
            break;
        case 'theme/toggle':
            next.theme = current.theme === DARK ? LIGHT : DARK;
            break;
        case 'viewport/change':
            next.compact = !!event.compact;
            if (next.compact) next.dockOpen = false;
            break;
        case 'dock/open':
            if (!current.activeModal) next.dockOpen = true;
            break;
        case 'dock/close':
            next.dockOpen = false;
            break;
        case 'modal/open':
            if (!event.modalId) return current;
            next.activeModal = String(event.modalId);
            if (current.compact) next.dockOpen = false;
            break;
        case 'modal/close':
            if (event.modalId && event.modalId !== current.activeModal) return current;
            next.activeModal = null;
            break;
        default:
            return current;
        }

        return snapshot(next);
    }

    return Object.freeze({
        DARK: DARK,
        LIGHT: LIGHT,
        initial: initial,
        transition: transition
    });
}));
