/**
 * 캔버스 기반 지도 오버레이의 공용 선택 경로.
 *
 * OpenLayers 피처는 DOM 포커스를 받을 수 없으므로 지도 singleclick과 Enter를
 * 한 곳에서 중재한다. 대기질과 CCTV가 동시에 켜져도 한 번의 입력에는 가장
 * 앞에 보이는 피처 또는 화면 중심에서 가장 가까운 피처 하나만 활성화한다.
 */
(function () {
    'use strict';

    if (typeof weatherMap === 'undefined') return;

    var handlers = new Map();

    function featureKind(feature) {
        if (!feature || typeof feature.get !== 'function') return '';
        var direct = feature.get('kind');
        if (direct && handlers.has(direct)) return direct;
        var members = feature.get('features');
        if (!Array.isArray(members)) return '';
        for (var i = 0; i < members.length; i++) {
            var memberKind = members[i] && members[i].get('kind');
            if (memberKind && handlers.has(memberKind)) return memberKind;
        }
        return '';
    }

    function isEnabled(handler) {
        return !handler.enabled || handler.enabled();
    }

    function closeExcept(kind, restoreMapFocus) {
        handlers.forEach(function (handler, registeredKind) {
            if (registeredKind !== kind && typeof handler.close === 'function') {
                handler.close(!!restoreMapFocus);
            }
        });
    }

    function closeAll(restoreMapFocus) {
        handlers.forEach(function (handler) {
            if (typeof handler.close === 'function') handler.close(!!restoreMapFocus);
        });
    }

    /** 오버레이 선택 전에 진행 중인 좌표 조회와 기존 좌표 팝업을 함께 정리한다. */
    function closePointSelection() {
        if (typeof window.WEATHER_GRID_CANCEL_POINT_LOOKUP === 'function') {
            window.WEATHER_GRID_CANCEL_POINT_LOOKUP();
        }
        var popup = document.querySelector('.coordinate_popup');
        if (popup) popup.style.display = 'none';
    }

    weatherMap.on('singleclick', function (event) {
        if (window.WEATHER_GRID_MEASURE && window.WEATHER_GRID_MEASURE.isActive()) return;
        var selectedFeature = null;
        var selectedKind = '';
        weatherMap.forEachFeatureAtPixel(event.pixel, function (feature) {
            var kind = featureKind(feature);
            var handler = kind ? handlers.get(kind) : null;
            if (!handler || !isEnabled(handler)) return undefined;
            selectedFeature = feature;
            selectedKind = kind;
            return feature;
        }, { hitTolerance: 8 });

        if (!selectedFeature) {
            closeAll(false);
            return;
        }
        closePointSelection();
        closeExcept(selectedKind, false);
        var handler = handlers.get(selectedKind);
        if (handler && typeof handler.openFeature === 'function') {
            handler.openFeature(selectedFeature, event.pixel, false);
        }
    });

    var mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.addEventListener('keydown', function (event) {
            if (window.WEATHER_GRID_MEASURE && window.WEATHER_GRID_MEASURE.isActive()) return;
            if (event.key !== 'Enter') return;
            var candidates = [];
            handlers.forEach(function (handler, kind) {
                if (!isEnabled(handler) || typeof handler.nearest !== 'function') return;
                var candidate = handler.nearest();
                if (candidate && Number.isFinite(candidate.distance)
                        && typeof candidate.activate === 'function') {
                    candidates.push({ kind: kind, distance: candidate.distance, activate: candidate.activate });
                }
            });
            if (!candidates.length) return;
            candidates.sort(function (a, b) { return a.distance - b.distance; });
            event.preventDefault();
            closePointSelection();
            closeExcept(candidates[0].kind, false);
            candidates[0].activate(true);
        });
    }

    window.WEATHER_GRID_OVERLAY_ROUTER = {
        register: function (kind, handler) {
            if (!kind || !handler || typeof handler !== 'object') return function () {};
            handlers.set(kind, handler);
            return function () { handlers.delete(kind); };
        },
        handlesFeature: function (feature) {
            return !!featureKind(feature);
        },
        closeAll: closeAll
    };
})();
