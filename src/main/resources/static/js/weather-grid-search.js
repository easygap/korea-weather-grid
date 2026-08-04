/**
 * 대표 지역 combobox와 좌표 검색 팝오버를 위치 조회 API에 연결한다.
 */
(function () {
    'use strict';

    var State = window.WeatherGridSearchState;
    var MapRuntime = window.WeatherGridMapRuntime;
    var Location = window.WeatherGridLocation;
    if (!State || !MapRuntime || !Location) {
        throw new Error('Search state, map runtime and location adapter must load first');
    }

    var input = document.getElementById('station_query');
    var stationForm = document.getElementById('station_search_form');
    var searchButton = document.getElementById('station_search_button');
    var suggestionList = document.getElementById('suggestions');
    var status = document.getElementById('station_search_status');
    var coordinateToggle = document.getElementById('coordinate_search_toggle');
    var coordinatePanel = document.getElementById('coordinate_search_dialog');
    var coordinateForm = document.getElementById('coordinate_search_form');
    var coordinatePopup = document.querySelector('.coordinate_popup');
    var coordinatePopupClose = document.querySelector('.coordinate_popup_close');
    var coordinatePanelClose = document.querySelector('.coordinate_panel_close');
    var timelineButton = document.querySelector('.station_timeline_button');
    var currentLocationButton = document.getElementById('current_location');
    var activeIndex = -1;
    var currentSuggestions = [];

    if (!input || !stationForm || !searchButton || !suggestionList || !coordinateToggle
            || !coordinatePanel || !coordinateForm || !currentLocationButton) {
        throw new Error('Search controls are incomplete');
    }

    function notify(message) {
        if (typeof window.fireAlert === 'function') {
            window.fireAlert({
                title: '안내',
                text: message,
                confirmButtonText: '닫기'
            });
        }
    }

    function finishLocationRequest() {
        currentLocationButton.disabled = false;
        currentLocationButton.removeAttribute('aria-busy');
    }

    function openCurrentLocation() {
        if (!window.isSecureContext || !navigator.geolocation) {
            notify('현재 위치는 HTTPS와 위치 서비스를 지원하는 브라우저에서 사용할 수 있습니다.');
            return;
        }
        currentLocationButton.disabled = true;
        currentLocationButton.setAttribute('aria-busy', 'true');
        navigator.geolocation.getCurrentPosition(function (position) {
            finishLocationRequest();
            var latitude = Number(position && position.coords && position.coords.latitude);
            var longitude = Number(position && position.coords && position.coords.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
                    || latitude < 32 || latitude > 44 || longitude < 122 || longitude > 134) {
                notify('현재 위치가 기상 예보 지원 범위를 벗어났습니다.');
                return;
            }
            var view = MapRuntime.map.getView();
            var projection = view.getProjection().getCode();
            var center = MapRuntime.fromGeographic([longitude, latitude], projection);
            var targetZoom = Math.min(view.getMaxZoom(), Math.max(9.4, view.getZoom()));
            view.cancelAnimations();
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                view.setCenter(center);
                view.setZoom(targetZoom);
            } else {
                view.animate({ center: center, zoom: targetZoom, duration: 420 });
            }
            input.value = '현재 위치';
            closeSuggestions(State.selectionStatus('현재 위치'));
            Location.openTimeline({
                name: '현재 위치',
                latitude: latitude,
                longitude: longitude,
                includeForecast: true
            });
        }, function (error) {
            finishLocationRequest();
            var message = error && error.code === 1
                ? '위치 권한이 허용되지 않았습니다. 브라우저의 사이트 권한을 확인해 주세요.'
                : error && error.code === 3
                    ? '현재 위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.'
                    : '현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
            notify(message);
        }, {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 5 * 60 * 1000
        });
    }

    function optionNodes() {
        return Array.from(
            suggestionList.querySelectorAll('[role="option"]:not([aria-disabled="true"])'));
    }

    function closeSuggestions(nextStatus) {
        var wasOpen = input.getAttribute('aria-expanded') === 'true'
            || suggestionList.style.display !== 'none';
        suggestionList.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        activeIndex = -1;
        if (status && typeof nextStatus === 'string') status.textContent = nextStatus;
        else if (status && wasOpen) status.textContent = '';
    }

    function openSuggestions() {
        if (!suggestionList.children.length) return;
        suggestionList.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
        if (status) status.textContent = State.status(input.value, currentSuggestions.length);
    }

    function setActive(index) {
        var nodes = optionNodes();
        if (!nodes.length) return;
        activeIndex = Math.max(0, Math.min(nodes.length - 1, index));
        nodes.forEach(function (node, nodeIndex) {
            node.setAttribute('aria-selected', String(nodeIndex === activeIndex));
        });
        input.setAttribute('aria-activedescendant', nodes[activeIndex].id);
        nodes[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function choose(station) {
        input.value = station.name;
        closeSuggestions(State.selectionStatus(station.name));
        Location.openStation(station.name, station.lat, station.lon);
    }

    function suggestionButton(station, index) {
        var button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.id = 'station-option-' + index;
        button.className = 'station_suggestion_option';
        button.textContent = station.name;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        button.addEventListener('pointermove', function () { setActive(index); });
        button.addEventListener('click', function () { choose(station); });
        return button;
    }

    function renderSuggestions() {
        currentSuggestions = State.suggestions(
            MapRuntime.stationAnchors(), input.value, 20);
        suggestionList.replaceChildren();
        activeIndex = -1;
        if (status) status.textContent = State.status(input.value, currentSuggestions.length);

        if (!State.normalizeQuery(input.value)) {
            closeSuggestions();
            return;
        }
        if (currentSuggestions.length) {
            currentSuggestions.forEach(function (station, index) {
                suggestionList.appendChild(suggestionButton(station, index));
            });
        } else {
            var empty = document.createElement('div');
            empty.className = 'suggestion-empty';
            empty.textContent = '일치하는 대표 지역이 없습니다.';
            empty.setAttribute('role', 'option');
            empty.setAttribute('aria-disabled', 'true');
            suggestionList.appendChild(empty);
        }
        suggestionList.style.maxHeight = '150px';
        suggestionList.style.overflowY = currentSuggestions.length > 5 ? 'auto' : 'hidden';
        openSuggestions();
    }

    function exactSearch() {
        var station = State.exactMatch(MapRuntime.stationAnchors(), input.value);
        if (!station) {
            notify('일치하는 지역을 찾지 못했습니다.');
            return false;
        }
        choose(station);
        return true;
    }

    function setCoordinatePanel(open, restoreFocus) {
        coordinatePanel.style.display = open ? 'block' : 'none';
        coordinateToggle.setAttribute('aria-expanded', String(open));
        if (open) {
            closeSuggestions();
            requestAnimationFrame(function () {
                var latitude = document.getElementById('coordinate_latitude');
                if (latitude) latitude.focus();
            });
        } else if (restoreFocus) {
            coordinateToggle.focus({ preventScroll: true });
        }
    }

    input.addEventListener('input', renderSuggestions);
    input.addEventListener('keydown', function (event) {
        var nodes = optionNodes();
        if (event.key === 'ArrowDown' && nodes.length) {
            event.preventDefault();
            openSuggestions();
            setActive(State.moveIndex(activeIndex, nodes.length, 'next'));
        } else if (event.key === 'ArrowUp' && nodes.length) {
            event.preventDefault();
            openSuggestions();
            setActive(State.moveIndex(activeIndex, nodes.length, 'previous'));
        } else if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            if (activeIndex >= 0 && nodes[activeIndex]) nodes[activeIndex].click();
            else exactSearch();
        } else if (event.key === 'Escape') {
            closeSuggestions();
        }
    });
    input.addEventListener('click', function () {
        if (input.value.trim() && optionNodes().length) openSuggestions();
    });
    input.addEventListener('blur', function () {
        setTimeout(function () {
            if (!suggestionList.contains(document.activeElement)) closeSuggestions();
        }, 0);
    });
    stationForm.addEventListener('submit', function (event) {
        event.preventDefault();
        exactSearch();
    });

    coordinateToggle.addEventListener('click', function () {
        setCoordinatePanel(coordinatePanel.style.display === 'none', false);
    });
    currentLocationButton.addEventListener('click', openCurrentLocation);
    if (coordinatePanelClose) {
        coordinatePanelClose.addEventListener('click', function () {
            setCoordinatePanel(false, true);
        });
    }
    coordinateForm.addEventListener('submit', function (event) {
        event.preventDefault();
        Location.submitCoordinate();
    });
    if (coordinatePopupClose) {
        coordinatePopupClose.addEventListener('click', function () {
            if (coordinatePopup) coordinatePopup.style.display = 'none';
        });
    }
    if (timelineButton) {
        timelineButton.addEventListener('click', function () {
            Location.openCurrentCoordinate();
        });
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && coordinatePanel.style.display !== 'none') {
            setCoordinatePanel(false, true);
        }
    });
    document.addEventListener('click', function (event) {
        var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        function contains(element) {
            return element && (path.indexOf(element) >= 0 || element.contains(event.target));
        }
        if (!contains(coordinateToggle) && !contains(coordinatePanel)) {
            setCoordinatePanel(false, false);
        }
        if (coordinatePopup && !contains(coordinatePopup)) {
            coordinatePopup.style.display = 'none';
        }
        if (!contains(input) && !contains(suggestionList)) closeSuggestions();
    });
    document.addEventListener('weather-grid:stations-changed', function () {
        if (State.normalizeQuery(input.value)) renderSuggestions();
    });

    window.WeatherGridSearch = Object.freeze({
        search: exactSearch,
        refresh: renderSuggestions,
        close: function () {
            closeSuggestions();
            setCoordinatePanel(false, false);
        },
        snapshot: function () {
            return Object.freeze({
                query: State.normalizeQuery(input.value),
                suggestionCount: currentSuggestions.length,
                activeIndex: activeIndex,
                coordinateOpen: coordinatePanel.style.display !== 'none'
            });
        }
    });
}());
