/**
 * 2D 지도 직선거리 측정 도구.
 *
 * 서버 요청 없이 OpenLayers 구면 거리로 계산한다. 현재 화면 도법을 명시해
 * LCC·Web Mercator·위경도 보기에서 같은 지표면 거리가 나오도록 한다.
 */
(function () {
    'use strict';

    if (typeof weatherMap === 'undefined' || !window.ol || !ol.interaction || !ol.sphere) return;

    var toggle = document.getElementById('distance_measure_toggle');
    var panel = document.getElementById('distance_measure_panel');
    var totalElement = document.getElementById('distance_measure_total');
    var segmentsElement = document.getElementById('distance_measure_segments');
    var hintElement = document.getElementById('distance_measure_hint');
    var statusElement = document.getElementById('distance_measure_status');
    var finishButton = document.getElementById('distance_measure_finish');
    var undoButton = document.getElementById('distance_measure_undo');
    var clearButton = document.getElementById('distance_measure_clear');
    var closeButton = document.getElementById('distance_measure_close');
    var mapElement = document.getElementById('map');
    var mapArea = document.querySelector('.map_workspace');
    if (!toggle || !panel || !totalElement || !segmentsElement || !hintElement
            || !statusElement || !finishButton || !undoButton || !clearButton
            || !closeButton || !mapElement || !mapArea) return;

    var integerFormatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
    var oneDecimalFormatter = new Intl.NumberFormat('ko-KR', {
        minimumFractionDigits: 1, maximumFractionDigits: 1
    });
    var twoDecimalFormatter = new Intl.NumberFormat('ko-KR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });

    /** 1km 미만은 m, 이상은 읽기 좋은 자릿수의 km로 자동 전환한다. */
    function formatDistance(meters) {
        var safeMeters = Number.isFinite(meters) && meters > 0 ? meters : 0;
        if (safeMeters < 1000) return integerFormatter.format(Math.round(safeMeters)) + ' m';
        var kilometers = safeMeters / 1000;
        if (kilometers < 10) return twoDecimalFormatter.format(kilometers) + ' km';
        if (kilometers < 100) return oneDecimalFormatter.format(kilometers) + ' km';
        return integerFormatter.format(Math.round(kilometers)) + ' km';
    }

    function distanceOf(geometry) {
        if (!geometry || geometry.getType() !== 'LineString') return 0;
        var meters = ol.sphere.getLength(geometry, {
            projection: weatherMap.getView().getProjection()
        });
        return Number.isFinite(meters) && meters > 0 ? meters : 0;
    }

    var casingStyle = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'rgba(7, 25, 46, .88)', width: 6 })
    });
    var lineStyle = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: '#67e8f9', width: 3 })
    });
    var vertexGeometry = new ol.geom.MultiPoint([]);
    var vertexStyle = new ol.style.Style({
        geometry: vertexGeometry,
        image: new ol.style.Circle({
            radius: 4.5,
            fill: new ol.style.Fill({ color: '#f8fafc' }),
            stroke: new ol.style.Stroke({ color: '#0e7490', width: 2 })
        })
    });
    var labelGeometry = new ol.geom.Point([0, 0]);
    var labelText = new ol.style.Text({
        text: '', offsetY: -19, padding: [5, 8, 5, 8],
        font: "750 12px system-ui, sans-serif",
        fill: new ol.style.Fill({ color: '#f8fafc' }),
        backgroundFill: new ol.style.Fill({ color: 'rgba(7, 25, 46, .94)' }),
        backgroundStroke: new ol.style.Stroke({ color: 'rgba(103, 232, 249, .72)', width: 1 })
    });
    var labelStyle = new ol.style.Style({ geometry: labelGeometry, text: labelText });
    var sketchPointStyle = new ol.style.Style({
        image: new ol.style.Circle({
            radius: 5,
            fill: new ol.style.Fill({ color: '#67e8f9' }),
            stroke: new ol.style.Stroke({ color: '#07192e', width: 2 })
        })
    });

    function measureStyles(feature) {
        var geometry = feature && feature.getGeometry();
        if (!geometry) return [];
        if (geometry.getType() === 'Point') return [sketchPointStyle];
        if (geometry.getType() !== 'LineString') return [];
        var coordinates = geometry.getCoordinates();
        vertexGeometry.setCoordinates(coordinates);
        if (!coordinates.length) return [casingStyle, lineStyle];
        labelGeometry.setCoordinates(coordinates[coordinates.length - 1]);
        labelText.setText(formatDistance(distanceOf(geometry)));
        return [casingStyle, lineStyle, vertexStyle, labelStyle];
    }

    var source = new ol.source.Vector({ wrapX: false });
    var layer = new ol.layer.Vector({
        source: source,
        style: measureStyles,
        updateWhileInteracting: true,
        title: 'distance-measure'
    });
    layer.setZIndex(160);
    weatherMap.addLayer(layer);

    var draw = new ol.interaction.Draw({
        source: source,
        type: 'LineString',
        style: measureStyles,
        stopClick: true,
        freehand: false,
        clickTolerance: 8,
        minPoints: 2
    });
    draw.setActive(false);
    weatherMap.addInteraction(draw);

    var doubleClickZoom = null;
    weatherMap.getInteractions().forEach(function (interaction) {
        if (!doubleClickZoom && ol.interaction.DoubleClickZoom
                && interaction instanceof ol.interaction.DoubleClickZoom) {
            doubleClickZoom = interaction;
        }
    });

    var active = false;
    var drawing = false;
    var sketchFeature = null;
    var sketchChangeKey = null;
    var confirmedVertexCount = 0;
    var totalMeters = 0;
    var doubleClickRestoreNeeded = false;
    var doubleClickRestoreTimer = 0;
    var pointerStates = new Map();

    function announce(message) {
        statusElement.textContent = '';
        window.setTimeout(function () { statusElement.textContent = message; }, 0);
    }

    function currentCompletedFeature() {
        var features = source.getFeatures();
        return features.length ? features[features.length - 1] : null;
    }

    function vertexCount() {
        var completed = currentCompletedFeature();
        if (completed && completed.getGeometry()) return completed.getGeometry().getCoordinates().length;
        return confirmedVertexCount;
    }

    function setPanelVisible(visible) {
        panel.hidden = !visible;
        toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }

    function syncButtons() {
        var count = vertexCount();
        undoButton.disabled = !(active && drawing && count > 0);
        finishButton.disabled = !(active && drawing && count >= 2);
        clearButton.disabled = !(active || drawing || source.getFeatures().length);
    }

    function updateReadout(meters, count, phase) {
        totalMeters = Number.isFinite(meters) && meters > 0 ? meters : 0;
        totalElement.textContent = formatDistance(totalMeters);
        var segmentCount = Math.max(0, count - 1);
        segmentsElement.textContent = phase === 'complete'
            ? segmentCount + '개 구간 · 측정 완료'
            : phase === 'drawing'
                ? segmentCount + '개 구간 · 측정 중'
                : '시작 전';
        syncButtons();
    }

    function unbindSketch() {
        if (sketchChangeKey) ol.Observable.unByKey(sketchChangeKey);
        sketchChangeKey = null;
        sketchFeature = null;
    }

    function suspendDoubleClickZoom() {
        if (doubleClickRestoreTimer) {
            window.clearTimeout(doubleClickRestoreTimer);
            doubleClickRestoreTimer = 0;
        }
        if (doubleClickZoom && doubleClickZoom.getActive()) {
            doubleClickZoom.setActive(false);
            doubleClickRestoreNeeded = true;
        }
    }

    /** 더블클릭 완료 직후의 마지막 dblclick까지 소비한 뒤 기본 줌을 되돌린다. */
    function restoreDoubleClickZoom(delay) {
        if (!doubleClickZoom || !doubleClickRestoreNeeded) return;
        if (doubleClickRestoreTimer) window.clearTimeout(doubleClickRestoreTimer);
        doubleClickRestoreTimer = window.setTimeout(function () {
            doubleClickRestoreTimer = 0;
            if (active) return;
            doubleClickZoom.setActive(true);
            doubleClickRestoreNeeded = false;
        }, delay || 0);
    }

    function setActiveUi(next) {
        active = !!next;
        draw.setActive(active);
        toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
        toggle.setAttribute('aria-label', active ? '거리 측정 취소' : '거리 측정 시작');
        toggle.title = active ? '거리 측정 취소 (Esc)' : '거리 측정';
        mapArea.classList.toggle('measure-active', active);
        syncButtons();
    }

    function closeExistingMapContent() {
        if (window.WEATHER_GRID_CANCEL_POINT_LOOKUP) window.WEATHER_GRID_CANCEL_POINT_LOOKUP();
        if (window.WEATHER_GRID_OVERLAY_ROUTER) window.WEATHER_GRID_OVERLAY_ROUTER.closeAll(false);
        var stationPopup = document.querySelector('.coordinate_popup');
        if (stationPopup) stationPopup.style.display = 'none';
    }

    function startMeasurement(focusMap) {
        if (active) return;
        closeExistingMapContent();
        source.clear(true);
        unbindSketch();
        drawing = false;
        confirmedVertexCount = 0;
        totalMeters = 0;
        pointerStates.clear();
        suspendDoubleClickZoom();
        setPanelVisible(true);
        hintElement.textContent = '지점을 차례로 선택하세요. 지도상 직선거리의 구간 합계입니다.';
        updateReadout(0, 0, 'ready');
        setActiveUi(true);
        announce('거리 측정을 시작했습니다. 지도에서 시작점을 선택하세요.');
        if (focusMap !== false) requestAnimationFrame(function () { mapElement.focus({ preventScroll: true }); });
    }

    function abortSketch() {
        if (drawing) draw.abortDrawing();
        unbindSketch();
        drawing = false;
        confirmedVertexCount = 0;
    }

    function closeMeasurement(options) {
        var settings = options || {};
        abortSketch();
        setActiveUi(false);
        restoreDoubleClickZoom(0);
        pointerStates.clear();
        if (settings.clear !== false) {
            source.clear(true);
            totalMeters = 0;
            updateReadout(0, 0, 'ready');
        }
        if (settings.hide !== false) setPanelVisible(false);
        if (settings.announce) announce(settings.announce);
        if (settings.focusToggle) requestAnimationFrame(function () { toggle.focus({ preventScroll: true }); });
    }

    function resetActiveMeasurement() {
        abortSketch();
        source.clear(true);
        totalMeters = 0;
        hintElement.textContent = '지점을 차례로 선택하세요. 지도상 직선거리의 구간 합계입니다.';
        updateReadout(0, 0, 'ready');
        if (!active) {
            setPanelVisible(false);
            return;
        }
        draw.setActive(true);
        announce('측정 내용을 초기화했습니다. 새 시작점을 선택하세요.');
        mapElement.focus({ preventScroll: true });
    }

    function finishMeasurement() {
        if (!active || !drawing || confirmedVertexCount < 2) {
            announce('끝점을 하나 더 선택한 뒤 완료해 주세요.');
            return false;
        }
        return !!draw.finishDrawing();
    }

    function removeLastPoint() {
        if (!active || !drawing || confirmedVertexCount < 1) return;
        if (confirmedVertexCount === 1) {
            draw.abortDrawing();
            drawing = false;
            confirmedVertexCount = 0;
            unbindSketch();
            updateReadout(0, 0, 'ready');
            announce('시작점을 취소했습니다. 새 시작점을 선택하세요.');
            return;
        }
        draw.removeLastPoint();
        confirmedVertexCount--;
        var geometry = sketchFeature && sketchFeature.getGeometry();
        updateReadout(distanceOf(geometry), confirmedVertexCount, 'drawing');
        announce('이전 지점을 취소했습니다.');
    }

    function appendMapCenter() {
        if (!active) return;
        var center = weatherMap.getView().getCenter();
        if (!center) return;
        var before = confirmedVertexCount;
        draw.appendCoordinates([center.slice()]);
        confirmedVertexCount = before + 1;
        var geometry = sketchFeature && sketchFeature.getGeometry();
        updateReadout(distanceOf(geometry), confirmedVertexCount, 'drawing');
        announce(confirmedVertexCount + '번째 지점을 화면 중심에 추가했습니다.');
    }

    draw.on('drawstart', function (event) {
        unbindSketch();
        drawing = true;
        sketchFeature = event.feature;
        confirmedVertexCount = Math.max(1, confirmedVertexCount);
        sketchChangeKey = sketchFeature.getGeometry().on('change', function (geometryEvent) {
            updateReadout(distanceOf(geometryEvent.target), confirmedVertexCount, 'drawing');
        });
        hintElement.textContent = '점을 더 추가하거나 완료를 누르세요. 두 번 클릭해도 완료됩니다.';
        updateReadout(0, confirmedVertexCount, 'drawing');
        announce('시작점을 선택했습니다. 다음 지점을 선택해 주세요.');
    });

    draw.on('drawend', function (event) {
        var geometry = event.feature.getGeometry();
        var coordinates = geometry.getCoordinates();
        unbindSketch();
        drawing = false;
        confirmedVertexCount = coordinates.length;
        totalMeters = distanceOf(geometry);
        event.feature.set('measureMeters', totalMeters, true);
        setActiveUi(false);
        // drawend 뒤 이어지는 브라우저 dblclick이 기본 줌으로 전달되지 않게 잠시 늦춘다.
        restoreDoubleClickZoom(260);
        hintElement.textContent = '지도상 직선거리입니다. 거리 버튼을 누르면 새로 측정합니다.';
        updateReadout(totalMeters, confirmedVertexCount, 'complete');
        // Draw가 drawend 이벤트 뒤에 피처를 source에 추가하므로
        // 초기화 버튼 상태는 한 프레임 뒤 다시 맞춘다.
        requestAnimationFrame(syncButtons);
        announce('거리 측정을 완료했습니다. 총 거리 ' + formatDistance(totalMeters) + '입니다.');
    });

    draw.on('drawabort', function () {
        unbindSketch();
        drawing = false;
        confirmedVertexCount = 0;
    });

    toggle.addEventListener('click', function () {
        if (active) {
            closeMeasurement({ clear: true, hide: true, announce: '거리 측정을 취소했습니다.' });
            return;
        }
        startMeasurement(true);
    });
    finishButton.addEventListener('click', finishMeasurement);
    undoButton.addEventListener('click', removeLastPoint);
    clearButton.addEventListener('click', function () {
        if (active) resetActiveMeasurement();
        else closeMeasurement({ clear: true, hide: true, announce: '거리 측정 결과를 지웠습니다.', focusToggle: true });
    });
    closeButton.addEventListener('click', function () {
        closeMeasurement({ clear: true, hide: true, announce: '거리 측정을 종료했습니다.', focusToggle: true });
    });

    /** 포인터 탭만 확정 지점으로 센다. 드래그·핀치는 지도 이동/확대로 남겨 둔다. */
    weatherMap.getViewport().addEventListener('pointerdown', function (event) {
        if (!active || event.button !== 0) return;
        pointerStates.set(event.pointerId, {
            x: event.clientX, y: event.clientY, moved: false,
            multi: false, wasDrawing: drawing
        });
        if (pointerStates.size > 1) {
            pointerStates.forEach(function (state) { state.multi = true; });
        }
    }, true);
    weatherMap.getViewport().addEventListener('pointermove', function (event) {
        var state = pointerStates.get(event.pointerId);
        if (!state) return;
        if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 8) state.moved = true;
    }, true);
    weatherMap.getViewport().addEventListener('pointerup', function (event) {
        var state = pointerStates.get(event.pointerId);
        if (!state) return;
        var isTap = active && !state.moved && !state.multi && pointerStates.size === 1;
        pointerStates.delete(event.pointerId);
        if (!isTap) return;
        window.setTimeout(function () {
            if (!active || !drawing) return;
            confirmedVertexCount = state.wasDrawing ? confirmedVertexCount + 1 : Math.max(1, confirmedVertexCount);
            var geometry = sketchFeature && sketchFeature.getGeometry();
            updateReadout(distanceOf(geometry), confirmedVertexCount, 'drawing');
        }, 0);
    }, true);
    weatherMap.getViewport().addEventListener('pointercancel', function (event) {
        pointerStates.delete(event.pointerId);
    }, true);

    // 캡처 단계에서 처리해 공용 오버레이의 Enter 단축키보다 측정 키보드 조작을 우선한다.
    mapElement.addEventListener('keydown', function (event) {
        if (!active) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeMeasurement({ clear: true, hide: true, announce: '거리 측정을 취소했습니다.', focusToggle: true });
        } else if (event.key === 'Backspace') {
            event.preventDefault();
            event.stopImmediatePropagation();
            removeLastPoint();
        } else if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            event.stopImmediatePropagation();
            finishMeasurement();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopImmediatePropagation();
            appendMapCenter();
        }
    }, true);

    document.addEventListener('weather-grid:projection-changed', function () {
        if (!active && !source.getFeatures().length) return;
        closeMeasurement({
            clear: true,
            hide: true,
            announce: '지도 도법이 변경되어 거리 측정을 초기화했습니다.',
            focusToggle: false
        });
        if (typeof showMapNotice === 'function') showMapNotice('지도 도법이 변경되어 거리 측정을 초기화했습니다.');
    });

    ['btn_3d', 'btn_3d_dock'].forEach(function (id) {
        var button = document.getElementById(id);
        if (!button) return;
        button.addEventListener('click', function () {
            if (active || source.getFeatures().length) {
                closeMeasurement({ clear: true, hide: true, focusToggle: false });
            }
        }, true);
    });

    window.addEventListener('pagehide', function () {
        abortSketch();
        weatherMap.removeInteraction(draw);
        weatherMap.removeLayer(layer);
    }, { once: true });

    window.WEATHER_GRID_MEASURE = Object.freeze({
        start: function () { startMeasurement(true); },
        finish: finishMeasurement,
        clear: function () { closeMeasurement({ clear: true, hide: true }); },
        isActive: function () { return active; },
        formatDistance: formatDistance,
        getDiagnostics: function () {
            return {
                active: active,
                drawing: drawing,
                vertexCount: vertexCount(),
                completedCount: source.getFeatures().length,
                totalMeters: totalMeters,
                projection: weatherMap.getView().getProjection().getCode(),
                layerCount: weatherMap.getLayers().getArray().filter(function (item) {
                    return item.get('title') === 'distance-measure';
                }).length,
                interactionCount: weatherMap.getInteractions().getArray().filter(function (item) {
                    return item === draw;
                }).length
            };
        }
    });
})();
