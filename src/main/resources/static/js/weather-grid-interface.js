/**
 * 키보드, 모달, 테마, 모바일 설정 시트의 브라우저 접근성 경계.
 * 지도 데이터와 시각화 구현에는 접근하지 않고 명시적인 UI 상태만 DOM에 반영한다.
 */
(function (window, document) {
    'use strict';

    var State = window.WeatherGridInterfaceState;
    if (!State) throw new Error('WeatherGridInterfaceState must load before WeatherGridInterface');

    var app = document.querySelector('.app');
    var dock = document.getElementById('dock');
    var dockToggle = document.getElementById('dock_toggle');
    var dockClose = document.getElementById('dock_collapse');
    var dockScrim = document.getElementById('dock_scrim');
    var compactControls = document.getElementById('mobile_primary_controls');
    var compactQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
    var coarsePointerQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    var modalElement = null;
    var modalReturnTarget = null;
    var modalClosers = Object.create(null);
    var modalInertLedger = [];
    var dockInertLedger = [];
    var storedTheme = State.DARK;

    try { storedTheme = localStorage.getItem('weather-grid-theme') || State.DARK; }
    catch (error) { /* 저장소가 차단된 환경은 기본 테마를 사용한다. */ }

    var state = State.initial({
        theme: storedTheme,
        compact: !!(compactQuery && compactQuery.matches)
    });

    function toElement(target) {
        return target instanceof Element ? target : null;
    }

    function isInteractive(target) {
        var element = toElement(target);
        return !!(element && element.closest(
            'button, a, input, select, textarea, [contenteditable="true"], [role="button"], [role="option"]'
        ));
    }

    function setPressed(button, pressed) {
        if (button) button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }

    function syncToggleStates() {
        [
            ['#seg_element button, #seg_precipitation button, #seg_additional_weather button, #seg_marine_weather button, #seg_proj button', 'on'],
            ['#layer_toggles .chip', 'on'],
            ['.forecast_run_button', 'on'],
            ['.lswitch', 'clicked'],
            ['#basemap_choices button', 'is-selected-basemap'],
            ['.view3d_modes button', 'on']
        ].forEach(function (rule) {
            document.querySelectorAll(rule[0]).forEach(function (button) {
                setPressed(button, button.classList.contains(rule[1]));
            });
        });
    }

    function isRendered(element) {
        if (!element || element.hidden || element.getClientRects().length === 0) return false;
        var style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function focus(element) {
        if (!element || typeof element.focus !== 'function') return;
        try { element.focus({ preventScroll: true }); }
        catch (error) { element.focus(); }
    }

    function focusableElements(container) {
        if (!container) return [];
        return Array.prototype.slice.call(container.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), '
            + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (element) {
            return !element.hidden && element.getAttribute('aria-hidden') !== 'true'
                && !element.closest('[inert]') && isRendered(element);
        });
    }

    function releaseInert(ledger) {
        ledger.forEach(function (entry) { entry.element.inert = entry.wasInert; });
        ledger.length = 0;
    }

    function isolateAppChild(excluded, ledger, companion) {
        releaseInert(ledger);
        if (!app) return;
        Array.prototype.forEach.call(app.children, function (child) {
            if (child === excluded || child === companion || child.classList.contains('loading-overlay')
                    || child.classList.contains('loading')) return;
            ledger.push({ element: child, wasInert: !!child.inert });
            child.inert = true;
        });
    }

    function modalId(element) {
        if (!element) return null;
        return element.id || (element.classList.contains('station_modal') ? 'station-forecast' : null);
    }

    function renderDock(moveFocus) {
        if (!dock || !dockToggle || !dockClose) return;
        var open = state.dockOpen;
        var modalDock = state.compact && open;

        dock.classList.toggle('collapsed', !open);
        dock.classList.add('dock-ready');
        if (app) app.classList.toggle('dock-open', open);
        dock.inert = !open;
        dock.setAttribute('aria-hidden', open ? 'false' : 'true');

        if (modalDock) {
            dock.setAttribute('role', 'dialog');
            dock.setAttribute('aria-modal', 'true');
            isolateAppChild(dock, dockInertLedger, dockScrim);
        } else {
            dock.removeAttribute('role');
            dock.removeAttribute('aria-modal');
            releaseInert(dockInertLedger);
        }

        dockToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        dockToggle.setAttribute('aria-label', open ? '표시 설정 닫기' : '표시 설정 열기');
        dockToggle.title = open ? '표시 설정 닫기' : '표시 설정';
        // 데스크톱에서는 상단 바에 자리를 가진 상시 토글이므로 열려 있어도 남긴다.
        // 모바일에서만 바텀시트가 덮는 영역과 겹치지 않게 감춘다.
        dockToggle.style.display = (state.compact && open) ? 'none' : '';

        if (compactControls) {
            compactControls.classList.toggle('is-hidden', open);
            compactControls.inert = open;
        }
        if (dockScrim) {
            dockScrim.hidden = !modalDock;
            dockScrim.setAttribute('aria-hidden', 'true');
        }
        if (moveFocus) focus(open ? dockClose : dockToggle);
    }

    function setDockOpen(open, moveFocus) {
        state = State.transition(state, { type: open ? 'dock/open' : 'dock/close' });
        renderDock(!!moveFocus);
    }

    function themeColor(theme) {
        return theme === State.LIGHT ? '#e7e9ec' : '#05070a';
    }

    function renderTheme() {
        document.documentElement.setAttribute('data-theme', state.theme);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', themeColor(state.theme));
        try { localStorage.setItem('weather-grid-theme', state.theme); }
        catch (error) { /* 저장소가 차단돼도 현재 문서 테마는 유지한다. */ }

        var toggle = document.getElementById('theme_toggle');
        if (toggle) {
            var moon = toggle.querySelector('.ic-moon');
            var sun = toggle.querySelector('.ic-sun');
            if (moon) moon.style.display = state.theme === State.DARK ? '' : 'none';
            if (sun) sun.style.display = state.theme === State.DARK ? 'none' : '';
            setPressed(toggle, state.theme === State.LIGHT);
            toggle.setAttribute('aria-label', state.theme === State.DARK
                ? '라이트 테마로 전환' : '다크 테마로 전환');
        }

        window.WEATHER_GRID_PARTICLE_COLOR = state.theme === State.DARK
            ? 'rgb(255,255,255)' : 'rgb(51,65,85)';
        var view3d = document.getElementById('view3d');
        if (!(view3d && view3d.classList.contains('open'))) {
            if (window.WeatherGridWind && typeof window.WeatherGridWind.repaint === 'function') {
                window.WeatherGridWind.repaint();
            } else if (typeof window.refreshStreamlines === 'function') {
                window.refreshStreamlines();
            }
        }
        if (typeof window.applyMapThemeStyles === 'function') window.applyMapThemeStyles();
        if (window.WEATHER_GRID_STATION_CHARTS) window.WEATHER_GRID_STATION_CHARTS.refreshTheme();
        document.dispatchEvent(new CustomEvent('weather-grid:theme-changed', {
            detail: { theme: state.theme }
        }));
    }

    function setTheme(theme) {
        state = State.transition(state, { type: 'theme/set', theme: theme });
        renderTheme();
    }

    function toggleTheme() {
        state = State.transition(state, { type: 'theme/toggle' });
        renderTheme();
    }

    function releaseModalBackground() {
        releaseInert(modalInertLedger);
        var skipLink = document.querySelector('.skip-link');
        if (skipLink && skipLink.dataset.interfaceInert === 'true') {
            skipLink.inert = skipLink.dataset.interfaceWasInert === 'true';
            delete skipLink.dataset.interfaceInert;
            delete skipLink.dataset.interfaceWasInert;
        }
    }

    function isolateModal(element) {
        isolateAppChild(element, modalInertLedger);
        var skipLink = document.querySelector('.skip-link');
        if (skipLink) {
            skipLink.dataset.interfaceInert = 'true';
            skipLink.dataset.interfaceWasInert = skipLink.inert ? 'true' : 'false';
            skipLink.inert = true;
        }
    }

    function openModal(element, opener) {
        var id = modalId(element);
        if (!element || !id || modalElement === element) return;
        if (modalElement) closeModal(modalElement, false);
        if (state.compact && state.dockOpen) setDockOpen(false, false);

        modalElement = element;
        modalReturnTarget = opener || document.activeElement;
        state = State.transition(state, { type: 'modal/open', modalId: id });
        element.setAttribute('aria-hidden', 'false');
        if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
        isolateModal(element);
        requestAnimationFrame(function () {
            var items = focusableElements(element);
            focus(items[0] || element);
        });
    }

    function fallbackFocus(id) {
        if (id === 'view3d') {
            var desktopTrigger = document.getElementById('btn_3d');
            if (desktopTrigger && !desktopTrigger.inert && isRendered(desktopTrigger)) return desktopTrigger;
            return document.getElementById('dock_toggle');
        }
        return document.getElementById('station_query') || document.getElementById('map');
    }

    function closeModal(element, restoreFocus) {
        if (!element || modalElement !== element) return;
        var id = modalId(element);
        var returnTarget = modalReturnTarget;
        element.setAttribute('aria-hidden', 'true');
        releaseModalBackground();
        modalElement = null;
        modalReturnTarget = null;
        state = State.transition(state, { type: 'modal/close', modalId: id });
        if (restoreFocus === false) return;

        requestAnimationFrame(function () {
            var target = returnTarget;
            if (!target || !target.isConnected || target.inert || target.closest('[inert]') || !isRendered(target)) {
                target = fallbackFocus(id);
            }
            focus(target);
        });
    }

    function closeStationModal() {
        var station = document.querySelector('.station_modal');
        if (!station) return;
        if (window.WEATHER_GRID_STATION_FORECAST) window.WEATHER_GRID_STATION_FORECAST.cancel();
        document.dispatchEvent(new CustomEvent('weather-grid:station-modal-closed'));
        station.style.display = 'none';
        closeModal(station, true);
    }

    function registerModalCloser(element, closer) {
        var id = modalId(element);
        if (id && typeof closer === 'function') modalClosers[id] = closer;
    }

    function updatePointerHelp() {
        var help = document.querySelector('.view3d_legendtip');
        if (!help) return;
        help.textContent = coarsePointerQuery && coarsePointerQuery.matches
            ? '한 손가락 회전 · 두 손가락 줌 · 표면을 터치하면 좌표·값 표시'
            : '드래그 회전 · 휠 줌 · 우클릭 이동 · 표면에 마우스를 올리면 좌표·값 표시';
    }

    function observeMedia(query, listener) {
        if (!query) return;
        if (typeof query.addEventListener === 'function') query.addEventListener('change', listener);
        else if (typeof query.addListener === 'function') query.addListener(listener);
    }

    var skipLink = document.querySelector('.skip-link');
    if (skipLink) skipLink.addEventListener('click', function (event) {
        event.preventDefault();
        focus(document.getElementById('map'));
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        var target = toElement(event.target);
        if (target && target.closest('#forecast_timeline')) return;
        if (modalElement || isInteractive(target)) event.stopImmediatePropagation();
    }, true);

    document.addEventListener('keydown', function (event) {
        if (!modalElement) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            var closer = modalClosers[modalId(modalElement)];
            if (closer) closer();
            else closeModal(modalElement, true);
            return;
        }
        if (event.key !== 'Tab') return;
        var items = focusableElements(modalElement);
        if (!items.length) {
            event.preventDefault();
            focus(modalElement);
            return;
        }
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !modalElement.contains(document.activeElement))) {
            event.preventDefault();
            focus(last);
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            focus(first);
        }
    }, true);

    document.addEventListener('keydown', function (event) {
        if (modalElement || !state.compact || !state.dockOpen || !dock) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setDockOpen(false, true);
            return;
        }
        if (event.key !== 'Tab') return;
        var items = focusableElements(dock);
        if (!items.length) {
            event.preventDefault();
            focus(dock);
            return;
        }
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dock.contains(document.activeElement))) {
            event.preventDefault();
            focus(last);
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            focus(first);
        }
    });

    var stationModal = document.querySelector('.station_modal');
    if (stationModal) {
        registerModalCloser(stationModal, closeStationModal);
        stationModal.setAttribute('aria-hidden', isRendered(stationModal) ? 'false' : 'true');
        stationModal.addEventListener('mousedown', function (event) {
            if (event.target === stationModal) closeStationModal();
        });
        new MutationObserver(function () {
            if (isRendered(stationModal)) openModal(stationModal);
            else closeModal(stationModal, true);
        }).observe(stationModal, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }

    document.addEventListener('click', function (event) {
        var target = toElement(event.target);
        var button = target && target.closest('button');
        if (!button || !button.matches(
            '.seg button, .chip, .forecast_run_button, .lswitch, #basemap_choices button, .view3d_modes button'
        )) return;
        requestAnimationFrame(syncToggleStates);
    });

    var themeToggle = document.getElementById('theme_toggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (dockClose) dockClose.addEventListener('click', function () { setDockOpen(false, true); });
    if (dockToggle) dockToggle.addEventListener('click', function () { setDockOpen(true, true); });
    if (dockScrim) dockScrim.addEventListener('click', function () { setDockOpen(false, true); });

    observeMedia(compactQuery, function (event) {
        var focusWouldBeHidden = !!(event.matches && dock && dock.contains(document.activeElement));
        state = State.transition(state, { type: 'viewport/change', compact: event.matches });
        renderDock(focusWouldBeHidden);
        updatePointerHelp();
    });
    observeMedia(coarsePointerQuery, updatePointerHelp);

    renderTheme();
    renderDock(false);
    updatePointerHelp();
    syncToggleStates();

    window.WEATHER_GRID_CLOSE_DOCK = function (moveFocus) { setDockOpen(false, !!moveFocus); };
    window.WeatherGridInterface = Object.freeze({
        setPressed: setPressed,
        syncToggleStates: syncToggleStates,
        isInteractive: isInteractive,
        theme: Object.freeze({
            current: function () { return state.theme; },
            set: setTheme,
            toggle: toggleTheme
        }),
        dock: Object.freeze({
            element: dock,
            compactQuery: compactQuery,
            isCompact: function () { return state.compact; },
            isOpen: function () { return state.dockOpen; },
            open: function (moveFocus) { setDockOpen(true, !!moveFocus); },
            close: function (moveFocus) { setDockOpen(false, !!moveFocus); }
        }),
        modal: Object.freeze({
            active: function () { return modalElement; },
            open: openModal,
            close: closeModal,
            closeStation: closeStationModal,
            registerCloser: registerModalCloser
        })
    });
}(window, document));
