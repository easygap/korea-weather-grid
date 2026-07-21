/**
 * 두 배포 셸의 UI 상태와 접근성 상태를 함께 조정한다.
 * 지도 데이터와 렌더링 소유권은 weather-grid.js에 두고 공개 훅만 호출한다.
 */
(function () {
    'use strict';

    /* ==================== 유틸 ==================== */

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function asElement(target) {
        return target instanceof Element ? target : null;
    }

    function isInteractiveTarget(target) {
        var element = asElement(target);
        return !!(element && element.closest(
            'button, a, input, select, textarea, [contenteditable="true"], [role="button"], [role="option"]'
        ));
    }

    function setPressed(button, pressed) {
        if (button) button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }

    /** 기존 클래스 기반 상태를 보조기기 상태와 동기화한다. */
    function syncToggleAria() {
        [
            ['#seg_element button, #seg_precipitation button, #seg_additional_weather button, #seg_marine_weather button, #seg_proj button', 'on'],
            ['#layer_toggles .chip', 'on'],
            ['.forecast_run_button', 'on'],
            ['.lswitch', 'clicked'],
            ['#basemap_choices button', 'is-selected-basemap'],
            ['.view3d_modes button', 'on']
        ].forEach(function (entry) {
            document.querySelectorAll(entry[0]).forEach(function (button) {
                setPressed(button, button.classList.contains(entry[1]));
            });
        });
    }

    // skip-link는 해시 히스토리를 남기지 않고 포커스만 옮긴다 — #map 항목이 히스토리에
    // 쌓이면 뒤로가기가 URL만 낡은 상태 해시로 되돌려, 이후 새로고침 시 그 상태가 복원된다
    var skipLink = document.querySelector('.skip-link');
    if (skipLink) skipLink.addEventListener('click', function (e) {
        e.preventDefault();
        var mapEl = document.getElementById('map');
        if (mapEl) mapEl.focus();
    });

    var activeModal = null;
    var modalReturnFocus = null;
    var inertStates = [];

    function isRendered(element) {
        return !!(element && getComputedStyle(element).display !== 'none'
            && getComputedStyle(element).visibility !== 'hidden'
            && element.getClientRects().length > 0);
    }

    function modalFocusableElements(modal) {
        return Array.prototype.slice.call(modal.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), '
            + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (element) {
            return !element.hidden && element.getAttribute('aria-hidden') !== 'true'
                && !element.closest('[inert]') && element.getClientRects().length > 0
                && getComputedStyle(element).display !== 'none'
                && getComputedStyle(element).visibility !== 'hidden';
        });
    }

    function setModalBackgroundInert(modal) {
        inertStates = [];
        var appRoot = document.querySelector('.app');
        if (appRoot) {
            Array.prototype.forEach.call(appRoot.children, function (child) {
                if (child === modal || child.classList.contains('loading-overlay') || child.classList.contains('loading')) return;
                inertStates.push({ element: child, inert: !!child.inert });
                child.inert = true;
            });
        }
        var skipLink = document.querySelector('.skip-link');
        if (skipLink) {
            inertStates.push({ element: skipLink, inert: !!skipLink.inert });
            skipLink.inert = true;
        }
    }

    function restoreModalBackground() {
        inertStates.forEach(function (state) { state.element.inert = state.inert; });
        inertStates = [];
    }

    function focusElement(element) {
        if (!element || typeof element.focus !== 'function') return;
        try { element.focus({ preventScroll: true }); }
        catch (error) { element.focus(); }
    }

    function activateModal(modal, opener) {
        if (!modal || activeModal === modal) return;
        if (activeModal) deactivateModal(activeModal, false);
        activeModal = modal;
        modalReturnFocus = opener || document.activeElement;
        modal.setAttribute('aria-hidden', 'false');
        if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
        setModalBackgroundInert(modal);
        requestAnimationFrame(function () {
            var focusables = modalFocusableElements(modal);
            focusElement(focusables[0] || modal);
        });
    }

    function deactivateModal(modal, restoreFocus) {
        if (!modal || activeModal !== modal) return;
        var was3d = modal.id === 'view3d';
        var returnTarget = modalReturnFocus;
        modal.setAttribute('aria-hidden', 'true');
        restoreModalBackground();
        activeModal = null;
        modalReturnFocus = null;
        if (restoreFocus === false) return;
        requestAnimationFrame(function () {
            var target = returnTarget;
            if (!target || !target.isConnected || target.inert || target.closest('[inert]') || !isRendered(target)) {
                if (was3d) {
                    var desktop3dButton = document.getElementById('btn_3d');
                    target = desktop3dButton && !desktop3dButton.inert && isRendered(desktop3dButton)
                        ? desktop3dButton : document.getElementById('dock_toggle');
                } else {
                    target = document.getElementById('station_query') || document.getElementById('map');
                }
            }
            focusElement(target);
        });
    }

    function closeStationModal() {
        var modal = document.querySelector('.station_modal');
        if (!modal) return;
        if (window.WEATHER_GRID_STATION_FORECAST) window.WEATHER_GRID_STATION_FORECAST.cancel();
        document.dispatchEvent(new CustomEvent('weather-grid:station-modal-closed'));
        modal.style.display = 'none';
        deactivateModal(modal, true);
    }

    /** 입력·버튼·모달에서 좌우키를 눌렀을 때 weather-grid.js 전역 예보 이동이 가로채지 않게 한다. */
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        var target = asElement(event.target);
        if (target && target.closest('#forecast_timeline')) return;
        if (activeModal || isInteractiveTarget(target)) event.stopImmediatePropagation();
    }, true);

    /** 열린 모달 안에서 Tab을 순환하고 Escape는 가장 위 모달만 닫는다. */
    document.addEventListener('keydown', function (event) {
        if (!activeModal) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (activeModal.id === 'view3d') closeView3d();
            else closeStationModal();
            return;
        }
        if (event.key !== 'Tab') return;
        var focusables = modalFocusableElements(activeModal);
        if (!focusables.length) {
            event.preventDefault();
            focusElement(activeModal);
            return;
        }
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
            event.preventDefault();
            focusElement(last);
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            focusElement(first);
        }
    }, true);

    var stationModal = document.querySelector('.station_modal');
    if (stationModal) {
        stationModal.setAttribute('aria-hidden', isRendered(stationModal) ? 'false' : 'true');
        new MutationObserver(function () {
            if (isRendered(stationModal)) activateModal(stationModal);
            else deactivateModal(stationModal, true);
        }).observe(stationModal, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }

    document.addEventListener('click', function (event) {
        var button = asElement(event.target) && event.target.closest('button');
        if (!button || !button.matches(
            '.seg button, .chip, .forecast_run_button, .lswitch, #basemap_choices button, .view3d_modes button'
        )) return;
        requestAnimationFrame(syncToggleAria);
    });
    $(function () {
        syncToggleAria();
        setPlayIcon(false);
    });

    /* ==================== 1. 테마 ==================== */

    /** 테마 적용의 단일 진입점: html[data-theme] + localStorage 저장 + 지도 팔레트·차트 테마 연동 */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) themeMeta.setAttribute('content', theme === 'light' ? '#eef3f9' : '#0b1220');
        try { localStorage.setItem('weather-grid-theme', theme); } catch (e) { /* private mode */ }
        var btn = document.getElementById('theme_toggle');
        if (btn) {
            btn.querySelector('.ic-moon').style.display = theme === 'dark' ? '' : 'none';
            btn.querySelector('.ic-sun').style.display = theme === 'dark' ? 'none' : '';
            setPressed(btn, theme === 'light');
            btn.setAttribute('aria-label', theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환');
        }
        // 스트림라인 입자색 — 라이트 지도에서는 흰 입자가 보이지 않으므로 짙은 색으로
        window.WEATHER_GRID_PARTICLE_COLOR = (theme === 'dark') ? 'rgb(255,255,255)' : 'rgb(51,65,85)';
        var view3d = document.getElementById('view3d');
        if (!(view3d && view3d.classList.contains('open'))
                && typeof window.refreshStreamlines === 'function') {
            window.refreshStreamlines();    // 새 색으로 파티클 재시작
        }
        // 배경지도(랜드마스·경계·라벨)도 테마 팔레트로 재적용
        if (typeof window.applyMapThemeStyles === 'function') window.applyMapThemeStyles();
        if (window.WEATHER_GRID_STATION_CHARTS) window.WEATHER_GRID_STATION_CHARTS.refreshTheme();
    }

    var savedTheme = 'dark';
    try { savedTheme = localStorage.getItem('weather-grid-theme') || 'dark'; } catch (e) { }
    applyTheme(savedTheme);

    document.getElementById('theme_toggle').addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme');
        applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    /* ==================== 2. 세그먼트 ↔ 네이티브 select 동기화 ==================== */

    /** 세그먼트 버튼 클릭 → 숨은 select 값 변경 + native change 디스패치
     *  (weather-grid.js의 addEventListener('change') 리스너까지 동작하도록) */
    function bindSegment(segId, selectId, onChange) {
        var seg = document.getElementById(segId);
        var sel = document.getElementById(selectId);
        if (!seg || !sel) return;
        seg.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-val]');
            if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
            seg.querySelectorAll('button').forEach(function (b) {
                var selected = b === btn;
                b.classList.toggle('on', selected);
                setPressed(b, selected);
            });
            if (sel.value !== btn.dataset.val) {
                sel.value = btn.dataset.val;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (onChange) onChange(btn.dataset.val);
        });
    }

    /** 저장 상태나 외부 링크의 높이 값을 지원값으로 정규화한다. */
    function normalizeAvailableHeight() {
        var select = document.getElementById('height');
        if (!select || select.value === '10m') return false;
        select.value = '10m';
        return true;
    }
    normalizeAvailableHeight();

    var PRECIPITATION_ELEMENTS = ['pcp', 'pty', 'sno'];
    var WEATHER_ELEMENT_SEGMENTS = ['seg_element', 'seg_precipitation', 'seg_additional_weather', 'seg_marine_weather'];
    var lastPrecipitationMetric = 'pcp';
    var lastSelectedWeatherMetric = 'wdws';

    function weatherMeta(value) {
        return (window.WEATHER_GRID_WEATHER_ELEMENTS && window.WEATHER_GRID_WEATHER_ELEMENTS[value]) || {};
    }

    function setWeatherSegmentState(segId, value, aggregatePrecipitation) {
        var segment = document.getElementById(segId);
        if (!segment) return;
        segment.querySelectorAll('button[data-val]').forEach(function (button) {
            var selected = aggregatePrecipitation
                ? button.dataset.val === 'pcp' && PRECIPITATION_ELEMENTS.indexOf(value) >= 0
                : button.dataset.val === value;
            button.classList.toggle('on', selected);
            setPressed(button, selected);
        });
    }

    /** 상단 5개 빠른 보기는 유지하고, 세부 기상 요소는 관련 그룹 안에서만 드러낸다. */
    function syncWeatherElementControls(value) {
        var meta = weatherMeta(value);
        setWeatherSegmentState('seg_element', value, true);
        setWeatherSegmentState('seg_precipitation', value, false);
        setWeatherSegmentState('seg_additional_weather', value, false);
        setWeatherSegmentState('seg_marine_weather', value, false);

        var precipitation = document.getElementById('precipitation_elements');
        if (precipitation) precipitation.hidden = meta.group !== 'precipitation';
        var additional = document.getElementById('additional_weather_elements');
        if (additional && meta.group === 'additional') additional.open = true;
        var marine = document.getElementById('marine_weather_elements');
        if (marine && meta.group === 'marine') marine.open = true;

        document.querySelectorAll('#btn_3d, #btn_3d_dock').forEach(function (button) {
            var available = meta.view3d !== false;
            button.disabled = !available;
            button.setAttribute('aria-disabled', available ? 'false' : 'true');
            button.title = available ? '3D 지형 뷰' : meta.label + ' 항목은 3D 표현을 제공하지 않습니다';
        });
    }

    function normalizeWeatherLayers(value) {
        var meta = weatherMeta(value);
        var layers = window.WEATHER_GRID_LAYERS || { heat: true, stream: false, iso: false };
        layers.heat = true;
        if (value !== 'wdws') layers.stream = false;
        if (meta.isoline === false) layers.iso = false;
        window.WEATHER_GRID_LAYERS = layers;
    }

    function handleWeatherElementChange(value) {
        if (PRECIPITATION_ELEMENTS.indexOf(value) >= 0) lastPrecipitationMetric = value;
        if (!applyingExploreMode || ['wind', 'temperature', 'precipitation', 'solar', 'custom'].indexOf(activeExploreMode) >= 0) {
            lastSelectedWeatherMetric = value;
        }
        normalizeWeatherLayers(value);
        syncWeatherElementControls(value);
        refreshWeatherGrid();
        if (applyingExploreMode) return;
        var modeByMetric = { wdws: 'wind', tmp: 'temperature', swdn: 'solar' };
        if (PRECIPITATION_ELEMENTS.indexOf(value) >= 0) applyExploreMode('precipitation');
        else if (modeByMetric[value]) applyExploreMode(modeByMetric[value]);
        else {
            setHazards(false, false);
            setEnvironment('off', false);
            syncExploreMode();
        }
    }

    WEATHER_ELEMENT_SEGMENTS.forEach(function (segmentId) {
        bindSegment(segmentId, 'element', handleWeatherElementChange);
    });
    syncWeatherElementControls(document.getElementById('element').value);
    document.getElementById('element').addEventListener('change', function () {
        syncWeatherElementControls(this.value);
        requestAnimationFrame(syncToggleAria);
    });
    /* ==================== 2-1. 표시 레이어 토글 (히트맵 · 스트림라인 · 등치선) ==================== */

    // 각 레이어를 독립적으로 켜고 끈다. 기본은 히트맵+스트림라인.
    window.WEATHER_GRID_LAYERS = { heat: true, stream: true, iso: false };

    /** 현재 토글 상태를 영속 히트맵 레이어와 보조 오버레이에 함께 반영한다. */
    window.applyRenderMode = function () {
        var L = window.WEATHER_GRID_LAYERS;
        var currentElement = $('#element').val();
        var meta = weatherMeta(currentElement);
        if (currentElement !== 'wdws') L.stream = false;
        if (meta.isoline === false) L.iso = false;
        weatherMap.getLayers().forEach(function (l) {
            if (l.get && l.get('title') === 'img') l.setVisible(L.heat);
        });
        var lg = document.getElementById('weather_legend');
        if (lg) lg.style.display = L.heat ? '' : 'none';    // 범례는 히트맵 색을 설명하는 것
        if (window.WEATHER_GRID_ISO) { L.iso ? window.WEATHER_GRID_ISO.show() : window.WEATHER_GRID_ISO.hide(); }

        // 스트림라인 — 재시작 함수가 토글을 존중하므로 켜기는 재호출만 한다.
        // 끌 때는 인스턴스를 보존하는 일시 숨김(재켜기 시 재조회 불필요)
        var isWind = currentElement === 'wdws';
        if (isWind) {
            if (L.stream) { if (window.refreshStreamlines) window.refreshStreamlines(); }
            else if (window.suspendStreamlines) window.suspendStreamlines();
        }

        // 칩 상태 동기화 + 비바람 요소에서 스트림 칩 비활성
        var row = document.getElementById('layer_toggles');
        if (row) {
            row.querySelectorAll('.chip').forEach(function (c) {
                var enabled = !!L[c.dataset.layer];
                c.classList.toggle('on', enabled);
                setPressed(c, enabled);
            });
            var sc = row.querySelector('[data-layer="stream"]');
            if (sc) {
                sc.disabled = !isWind;
                sc.setAttribute('aria-disabled', isWind ? 'false' : 'true');
            }
            var iso = row.querySelector('[data-layer="iso"]');
            if (iso) {
                var isoAvailable = meta.isoline !== false;
                iso.disabled = !isoAvailable;
                iso.setAttribute('aria-disabled', isoAvailable ? 'false' : 'true');
                iso.title = isoAvailable ? '같은 값을 선으로 연결' : meta.label + ' 항목은 등치선으로 표현하지 않습니다';
            }
        }
        syncWeatherElementControls(currentElement);
    };

    var layerRow = document.getElementById('layer_toggles');
    if (layerRow) {
        layerRow.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-layer]');
            if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
            var k = btn.dataset.layer;
            window.WEATHER_GRID_LAYERS[k] = !window.WEATHER_GRID_LAYERS[k];
            setPressed(btn, window.WEATHER_GRID_LAYERS[k]);
            window.applyRenderMode();
            updateHash();
        });
    }

    /* ==================== 3. 자동 조회 (발표시각/NOW) ==================== */

    // weather-grid.js가 선택 상태와 hidden 값을 확정한 경우에만 조회한다.
    // 현재 발표시각 재클릭은 이벤트가 오지 않아 선택 상태와 기존 지도를 그대로 유지한다.
    document.addEventListener('weather-grid:base-time-changed', function () {
        refreshWeatherGrid();
        requestAnimationFrame(syncToggleAria);
    });
    $('.latest_run_button').on('click', function () {
        refreshWeatherGrid();
        requestAnimationFrame(syncToggleAria);
    });

    // 발표 기준은 달력 날짜 점프가 아니라 실제 3시간 발표 주기 단위로 이동한다.
    function clampDateToToday() {
        var v = $('#forecast_date').val();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        // 02:10 이전에는 최신 발표가 전날 23시이므로 달력의 오늘이 아니라
        // weather-grid.js가 갱신한 최신 발표일을 상한으로 삼는다.
        var latestDate = window.todayStr;
        if (!latestDate) return;
        if (v > latestDate) {
            $('#forecast_date').val(latestDate);
            return;
        }
        var parts = latestDate.split('-').map(Number);
        var earliest = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 60));
        var earliestDate = earliest.getUTCFullYear() + '-'
            + ('0' + (earliest.getUTCMonth() + 1)).slice(-2) + '-'
            + ('0' + earliest.getUTCDate()).slice(-2);
        if (v < earliestDate) $('#forecast_date').val(earliestDate);
    }

    var baseRunFormatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });

    function selectedBaseInstant() {
        var date = $('#forecast_date').val();
        var hour = $('#baseTime').val();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}$/.test(hour)) return null;
        var instant = new Date(date + 'T' + hour + ':00:00+09:00');
        return Number.isNaN(instant.getTime()) ? null : instant;
    }

    function latestBaseInstant() {
        var date = window.todayStr;
        var hour = window.time;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}$/.test(hour || '')) return null;
        var instant = new Date(date + 'T' + hour + ':00:00+09:00');
        return Number.isNaN(instant.getTime()) ? null : instant;
    }

    function kstParts(instant) {
        var parts = {};
        baseRunFormatter.formatToParts(instant).forEach(function (part) {
            if (part.type !== 'literal') parts[part.type] = part.value;
        });
        return parts;
    }

    function updateBaseRunControls() {
        var selected = selectedBaseInstant();
        var latest = latestBaseInstant();
        var label = document.getElementById('base_run_label');
        var previous = document.getElementById('base_run_prev');
        var next = document.getElementById('base_run_next');
        var latestButton = document.querySelector('#forecast_source_settings .latest_run_button');
        if (label) label.textContent = selected
            ? baseRunFormatter.format(selected).replace(/\.$/, '') + ' KST' : '날짜를 확인해 주세요';
        if (!selected || !latest) {
            if (previous) previous.disabled = true;
            if (next) next.disabled = true;
            return;
        }
        var earliest = latest.getTime() - 60 * 24 * 60 * 60 * 1000;
        if (previous) previous.disabled = selected.getTime() - 3 * 60 * 60 * 1000 < earliest;
        if (next) next.disabled = selected.getTime() + 3 * 60 * 60 * 1000 > latest.getTime();
        if (latestButton) latestButton.classList.toggle('is-current', selected.getTime() === latest.getTime());
    }

    function applyBaseInstant(instant) {
        var parts = kstParts(instant);
        var date = parts.year + '-' + parts.month + '-' + parts.day;
        var hour = parts.hour;
        $('#forecast_date').val(date);
        $('#baseTime').val(hour);
        $('.forecast_run_button').removeClass('on').attr('aria-pressed', 'false').each(function () {
            if ($(this).text().trim() === hour) $(this).addClass('on').attr('aria-pressed', 'true');
        });
        if (typeof syncAvailableBaseTimes === 'function') syncAvailableBaseTimes();
        updateBaseRunControls();
        document.dispatchEvent(new CustomEvent('weather-grid:base-time-changed', { detail: { baseTime: hour } }));
    }

    function shiftBaseRun(direction) {
        var selected = selectedBaseInstant();
        var latest = latestBaseInstant();
        if (!selected || !latest) return;
        var candidate = new Date(selected.getTime() + direction * 3 * 60 * 60 * 1000);
        var earliest = latest.getTime() - 60 * 24 * 60 * 60 * 1000;
        if (candidate.getTime() < earliest || candidate.getTime() > latest.getTime()) return;
        applyBaseInstant(candidate);
    }

    var previousBaseRun = document.getElementById('base_run_prev');
    var nextBaseRun = document.getElementById('base_run_next');
    if (previousBaseRun) previousBaseRun.addEventListener('click', function () { shiftBaseRun(-1); });
    if (nextBaseRun) nextBaseRun.addEventListener('click', function () { shiftBaseRun(1); });

    // 달력에서 날짜를 직접 고른 경우도 즉시 반영한다.
    $('#forecast_date').on('change', function () {
        clampDateToToday();
        if (typeof syncAvailableBaseTimes === 'function') syncAvailableBaseTimes();
        updateBaseRunControls();
        refreshWeatherGrid();
    });
    document.addEventListener('weather-grid:base-time-changed', updateBaseRunControls);
    document.addEventListener('weather-grid:grid-settled', updateBaseRunControls);
    $('.latest_run_button').on('click', function () { setTimeout(updateBaseRunControls, 0); });
    // weather-grid.js의 ready 콜백이 날짜 입력값을 채운 뒤 초기 상태를 계산한다.
    $(function () { updateBaseRunControls(); });

    /* ==================== 4. 타임라인 재생 ==================== */

    // 자동 재생은 3시간 키프레임만 조회하고 완료 후 6.2초를 대기해
    // 직전 수동 조회가 남아 있어도 60초 요청 제한에 여유를 둔다.
    var PLAY_FRAME_DELAY = 6200;
    var playTimer = null;
    var isPlaying = false;
    /** +48h에서 재생을 시작하면 첫 유효 슬롯인 +1h부터 다시 시작한다. */
    var wrapOnNextAdvance = false;
    var btnPlay = document.getElementById('btn_play');

    /** 재생 버튼 아이콘(▶/⏸)과 상태 클래스 토글 */
    function setPlayIcon(playing) {
        btnPlay.querySelector('.ic-play').style.display = playing ? 'none' : '';
        btnPlay.querySelector('.ic-pause').style.display = playing ? '' : 'none';
        btnPlay.classList.toggle('playing', playing);
        setPressed(btnPlay, playing);
        btnPlay.setAttribute('aria-label', playing ? '예보 3시간 간격 자동 재생 일시정지' : '예보 3시간 간격 자동 재생');
        btnPlay.title = playing ? '3시간 간격 자동 재생 일시정지 (Space)' : '3시간 간격 자동 재생 (Space)';
    }

    /** 자동 재생 중지 — 수동 시간 조작·모달 열림 등에서 호출 */
    function stopPlay() {
        isPlaying = false;
        wrapOnNextAdvance = false;
        if (playTimer !== null) {
            clearTimeout(playTimer);
            playTimer = null;
        }
        setPlayIcon(false);
    }
    window.WEATHER_GRID_STOP_PLAYBACK = stopPlay;

    /** 서버 응답이 끝난 뒤에만 한 프레임을 진행한다. */
    function advancePlayFrame() {
        if (!isPlaying || window.WEATHER_GRID_GRID_LOADING) return;
        if (wrapOnNextAdvance) {
            wrapOnNextAdvance = false;
            leadHourCursor = -2;    // 바로 아래 +3h 이동이 첫 유효 슬롯인 +1h로 만든다.
        } else if (leadHourCursor >= 48) {
            stopPlay();
            return;
        }
        moveForecastCursor('add', 3);
        if (window.syncTimelineA11y) setTimeout(window.syncTimelineA11y, 0);
    }

    /** 완료된 프레임을 잠시 보여 준 다음 다음 요청을 예약한다. */
    function queueNextPlayFrame(event) {
        // 빈 응답이나 네트워크 오류를 자동으로 다음 48회까지 반복하지 않는다.
        if (event && event.detail && event.detail.success === false) {
            stopPlay();
            return;
        }
        if (!isPlaying || window.WEATHER_GRID_GRID_LOADING || playTimer !== null) return;
        if (leadHourCursor >= 48 && !wrapOnNextAdvance) { stopPlay(); return; }
        playTimer = setTimeout(function () {
            playTimer = null;
            // 예약 중 다른 조회가 시작됐다면 해당 조회의 settled 이벤트를 기다린다.
            if (!isPlaying || window.WEATHER_GRID_GRID_LOADING) return;
            advancePlayFrame();
        }, PLAY_FRAME_DELAY);
    }

    /** 타임라인 자동 재생 시작 — 마지막 슬롯에 도달하면 +1h부터 순환 */
    function startPlay() {
        if (isPlaying) return;
        wrapOnNextAdvance = leadHourCursor >= 48;
        isPlaying = true;
        setPlayIcon(true);

        // 이미 진행 중인 조회가 있으면 이를 취소하지 않고 완료 신호부터 기다린다.
        if (window.WEATHER_GRID_GRID_LOADING) return;
        advancePlayFrame();
    }

    document.addEventListener('weather-grid:grid-settled', queueNextPlayFrame);

    btnPlay.addEventListener('click', function () { isPlaying ? stopPlay() : startPlay(); });

    // Space = 재생/일시정지 (폼·버튼·모달에서는 네이티브 동작을 보존)
    document.addEventListener('keydown', function (e) {
        if (e.code !== 'Space' || e.defaultPrevented || e.repeat) return;
        if (activeModal || isInteractiveTarget(e.target)) return;
        e.preventDefault();
        isPlaying ? stopPlay() : startPlay();
    });

    // 사용자가 직접 시간을 조작하면 재생 중지. 화살표·처음/끝·range 입력을 모두 포함한다.
    document.querySelectorAll('[data-forecast]').forEach(function (control) {
        control.addEventListener('click', stopPlay, true);
    });
    var forecastScrubber = document.getElementById('forecast_scrubber');
    if (forecastScrubber) {
        forecastScrubber.addEventListener('input', stopPlay, true);
        forecastScrubber.addEventListener('change', stopPlay, true);
    }

    /* ==================== 5. 독 접기/펴기 ==================== */

    var dock = document.getElementById('dock');
    var dockToggle = document.getElementById('dock_toggle');
    var dockScrim = document.getElementById('dock_scrim');
    var mobilePrimaryControls = document.getElementById('mobile_primary_controls');
    var mobileDockQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
    var dockInertStates = [];

    function setDockBackgroundInert(inert) {
        if (inert) {
            dockInertStates = [];
            var root = document.querySelector('.app');
            if (!root) return;
            Array.prototype.forEach.call(root.children, function (child) {
                if (child === dock || child === dockScrim
                        || child.classList.contains('loading-overlay') || child.classList.contains('loading')) return;
                dockInertStates.push({ element: child, inert: !!child.inert });
                child.inert = true;
            });
            return;
        }
        dockInertStates.forEach(function (state) { state.element.inert = state.inert; });
        dockInertStates = [];
    }

    function setDockCollapsed(collapsed, moveFocus) {
        var mobile = !!(mobileDockQuery && mobileDockQuery.matches);
        dock.classList.toggle('collapsed', collapsed);
        dock.classList.add('dock-ready');
        document.querySelector('.app').classList.toggle('dock-open', !collapsed);
        dock.inert = collapsed;
        dock.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
        if (mobile && !collapsed) {
            dock.setAttribute('role', 'dialog');
            dock.setAttribute('aria-modal', 'true');
            setDockBackgroundInert(true);
        } else {
            dock.removeAttribute('role');
            dock.removeAttribute('aria-modal');
            setDockBackgroundInert(false);
        }
        dockToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        dockToggle.setAttribute('aria-label', collapsed ? '표시 설정 열기' : '표시 설정 닫기');
        dockToggle.title = collapsed ? '표시 설정' : '표시 설정 닫기';
        dockToggle.style.display = collapsed ? 'flex' : 'none';
        if (mobilePrimaryControls) {
            mobilePrimaryControls.classList.toggle('is-hidden', !collapsed);
            mobilePrimaryControls.inert = !collapsed;
        }
        if (dockScrim) {
            var showScrim = !collapsed && mobile;
            dockScrim.hidden = !showScrim;
            dockScrim.setAttribute('aria-hidden', 'true');
        }
        if (moveFocus) focusElement(collapsed ? dockToggle : collapseBtn);
    }
    window.WEATHER_GRID_CLOSE_DOCK = function (moveFocus) {
        setDockCollapsed(true, !!moveFocus);
    };

    var collapseBtn = document.getElementById('dock_collapse');
    collapseBtn.addEventListener('click', function () {
        setDockCollapsed(true, true);
    });

    dockToggle.addEventListener('click', function () {
        setDockCollapsed(false, true);
    });

    if (dockScrim) {
        dockScrim.addEventListener('click', function () { setDockCollapsed(true, true); });
    }

    // 지도 면적을 우선하고 상세 설정은 사용자가 필요할 때 연다.
    setDockCollapsed(true, false);
    if (mobileDockQuery) {
        mobileDockQuery.addEventListener('change', function (event) {
            var focusWouldBeHidden = event.matches && dock.contains(document.activeElement);
            var shouldCollapse = event.matches || dock.classList.contains('collapsed');
            setDockCollapsed(shouldCollapse, focusWouldBeHidden);
            updateCompact3dTip();
        });
    }

    /* ==================== 2-2. 데이터 영역과 표시 상태 동기화 ==================== */

    var EXPLORE_COPY = {
        wind: {
            title: '바람 흐름', kind: '예보',
            body: '풍속 색상과 흐름선을 함께 표시합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간'
        },
        temperature: {
            title: '기온 분포', kind: '예보',
            body: '전국의 기온 차이를 색상으로 비교합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간'
        },
        precipitation: {
            title: '1시간 강수량', kind: '예보',
            body: '해당 시각까지 1시간 동안의 예상 강수량을 표시합니다.', timeline: '강수 예보', timelineDetail: '향후 48시간'
        },
        solar: {
            title: '일사 강도', kind: '예보',
            body: '지면에 도달하는 하향단파복사 강도를 비교합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간'
        },
        hazards: {
            title: '위험기상', kind: '최근 관측·발표',
            body: '태풍 분석·예측 경로와 최근 낙뢰, 발효 특보를 확인합니다.', timeline: '위험기상', timelineDetail: '최근 관측·발표'
        },
        air: {
            title: '초미세먼지', kind: '최신 관측',
            body: 'PM2.5 관측과 선택 시각의 바람 흐름을 함께 봅니다.', timeline: '바람 예보 시간', timelineDetail: '미세먼지 최신 관측'
        },
        road: {
            title: '도로 CCTV', kind: '실시간',
            body: '지역을 확대해 CCTV 위치와 실시간 영상을 확인합니다.', timeline: '도로 CCTV', timelineDetail: '실시간'
        },
        custom: {
            title: '직접 조정한 보기', kind: '설정',
            body: '선택한 레이어 조합을 표시하고 있습니다.', timeline: '기상 예보', timelineDetail: '향후 48시간'
        }
    };
    var WEATHER_ELEMENT_COPY = {
        pcp: { title: '1시간 강수량', kind: '예보', body: '해당 시각 직전 1시간의 예상 강수량입니다.', timeline: '강수·적설 예보', timelineDetail: '향후 48시간' },
        pty: { title: '강수형태', kind: '예보', body: '비·비/눈·눈·소나기 예상 구역을 범주별로 표시합니다.', timeline: '강수·적설 예보', timelineDetail: '향후 48시간' },
        sno: { title: '1시간 신적설', kind: '예보', body: '해당 시각 직전 1시간에 새로 쌓일 눈의 깊이입니다.', timeline: '강수·적설 예보', timelineDetail: '향후 48시간' },
        reh: { title: '상대습도', kind: '예보', body: '공기가 현재 온도에서 포함한 수증기 비율을 표시합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' },
        sky: { title: '하늘상태', kind: '예보', body: '맑음·구름많음·흐림 예상 구역을 범주별로 표시합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' },
        wav: { title: '파고', kind: '해상 예보', body: '해상의 예상 파고를 표시하며 육지는 값이 없습니다.', timeline: '해상 예보', timelineDetail: '향후 48시간' }
    };
    var activeExploreMode = 'wind';
    var lastWeatherExploreMode = 'wind';
    var applyingExploreMode = false;
    var hazardMapState = null;

    /** 위험기상 빠른 보기에서만 서태평양 태풍 경로까지 볼 수 있도록 축척을 연다. */
    function setHazardMapContext(active) {
        if (typeof weatherMap === 'undefined' || typeof ol === 'undefined') return;
        var view = weatherMap.getView();
        if (!view) return;
        if (active) {
            if (!hazardMapState) {
                var projection = view.getProjection();
                var projectionCode = projection && projection.getCode ? projection.getCode() : window.WEATHER_GRID_VIEW_PROJ;
                var center = view.getCenter();
                var geographicCenter = null;
                try {
                    geographicCenter = center ? ol.proj.transform(center.slice(), projectionCode, 'EPSG:4326') : null;
                } catch (error) { geographicCenter = null; }
                hazardMapState = {
                    center: geographicCenter,
                    zoom: view.getZoom(),
                    minZoom: view.getMinZoom()
                };
            }
            view.setMinZoom(2.5);
            if (window.WEATHER_GRID_SEVERE_WEATHER && window.WEATHER_GRID_SEVERE_WEATHER.fitActiveTyphoons) {
                window.WEATHER_GRID_SEVERE_WEATHER.fitActiveTyphoons();
            }
            return;
        }
        if (!hazardMapState) return;
        var restore = hazardMapState;
        hazardMapState = null;
        view.setMinZoom(restore.minZoom);
        var targetZoom = Math.max(restore.minZoom, Number.isFinite(restore.zoom) ? restore.zoom : restore.minZoom);
        var targetCenter = null;
        try {
            var currentProjection = view.getProjection();
            var currentCode = currentProjection && currentProjection.getCode
                ? currentProjection.getCode() : window.WEATHER_GRID_VIEW_PROJ;
            targetCenter = restore.center ? ol.proj.transform(restore.center.slice(), 'EPSG:4326', currentCode) : null;
        } catch (error) { targetCenter = null; }
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (targetCenter && !reduced) view.animate({ center: targetCenter, zoom: targetZoom, duration: 260 });
        else {
            if (targetCenter) view.setCenter(targetCenter);
            view.setZoom(targetZoom);
        }
    }

    function dataDomainForExploreMode(mode) {
        if (mode === 'air') return 'air';
        if (mode === 'road') return 'traffic';
        if (mode === 'custom') return 'weather';
        return 'weather';
    }

    function airMode() {
        return window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.getMode
            ? window.WEATHER_GRID_AIR_QUALITY.getMode() : 'off';
    }

    function cctvEnabled() {
        return !!(window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.isEnabled && window.WEATHER_GRID_CCTV.isEnabled());
    }

    function hazardState() {
        return window.WEATHER_GRID_SEVERE_WEATHER && window.WEATHER_GRID_SEVERE_WEATHER.getState
            ? window.WEATHER_GRID_SEVERE_WEATHER.getState()
            : { typhoon: false, lightning: false, lightningMinutes: 30 };
    }

    function setHazards(typhoon, lightning) {
        if (window.WEATHER_GRID_SEVERE_WEATHER && window.WEATHER_GRID_SEVERE_WEATHER.setLayers) {
            window.WEATHER_GRID_SEVERE_WEATHER.setLayers({ typhoon: typhoon, lightning: lightning });
        }
    }

    function setWeatherStations(visible) {
        var button = document.getElementById('weather_stations');
        if (!button || button.classList.contains('clicked') === visible) return;
        button.click();
    }

    function selectMapBackground(id) {
        var button = document.getElementById(id);
        if (button && !button.classList.contains('is-selected-basemap')) button.click();
    }

    function setWeatherMetric(value) {
        var select = document.getElementById('element');
        if (!select) return false;
        if (select.value === value) {
            syncWeatherElementControls(value);
            return false;
        }
        var target = document.querySelector('.metric_field button[data-val="' + value + '"]');
        if (target) target.click();
        return !!target;
    }

    function setEnvironment(nextAirMode, nextCctv) {
        if (window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.setEnabled && cctvEnabled() !== nextCctv) {
            window.WEATHER_GRID_CCTV.setEnabled(nextCctv);
        }
        if (window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.setMode && airMode() !== nextAirMode) {
            window.WEATHER_GRID_AIR_QUALITY.setMode(nextAirMode);
        }
    }

    function refreshExploreContext(mode) {
        var selectedElement = document.getElementById('element');
        var chosenElementValue = selectedElement ? selectedElement.value : 'wdws';
        var selectedMeta = weatherMeta(chosenElementValue);
        var copy = ((mode === 'precipitation' || mode === 'custom') && WEATHER_ELEMENT_COPY[chosenElementValue])
            ? WEATHER_ELEMENT_COPY[chosenElementValue] : (EXPLORE_COPY[mode] || EXPLORE_COPY.wind);
        var app = document.querySelector('.app');
        var dataDomain = dataDomainForExploreMode(mode);
        var summary = document.getElementById('explore_mode_summary');
        if (summary) {
            summary.dataset.kind = copy.kind;
            var title = summary.querySelector('strong');
            var body = summary.querySelector('span');
            if (title) title.textContent = copy.title;
            if (body) body.textContent = copy.body;
        }
        var timelineScope = document.getElementById('timeline_scope');
        if (timelineScope) timelineScope.textContent = copy.timeline;
        var timelineRange = document.getElementById('timeline_range');
        if (timelineRange) timelineRange.textContent = copy.timelineDetail;
        var dockContext = document.getElementById('dock_context');
        if (dockContext) {
            dockContext.textContent = mode === 'wind' ? '기상 · 바람'
                : mode === 'temperature' ? '기상 · 기온'
                : mode === 'precipitation' ? '기상 · 강수·눈'
                : mode === 'solar' ? '기상 · 일사'
                : mode === 'hazards' ? '기상 · 위험기상'
                : dataDomain === 'air' ? '대기질 · 미세먼지'
                : dataDomain === 'traffic' ? '교통 · CCTV'
                    : selectedMeta.group === 'marine' ? '기상 · 해상'
                        : chosenElementValue === 'reh' ? '기상 · 상대습도'
                            : chosenElementValue === 'sky' ? '기상 · 하늘상태' : '기상 · 사용자 설정';
        }

        if (mode === 'hazards') {
            var severe = hazardState();
            var infoBox = document.querySelector('.map_status_panel');
            if (infoBox) {
                var metric = infoBox.querySelector('.info_metric');
                var time = infoBox.querySelector('.info_time');
                var hint = infoBox.querySelector('.info_hint');
                if (metric) metric.textContent = '위험기상';
                if (time) time.textContent = '최근 관측·발표';
                if (hint) {
                    var loading = severe.typhoonLoading || severe.lightningLoading;
                    var failed = severe.typhoonError || severe.lightningError;
                    var warningText = severe.warningStatus === 'unavailable' ? '특보 연결 대기'
                        : severe.warningStatus === 'error' ? '특보 확인 불가'
                            : '특보 ' + severe.warningCount + '건';
                    hint.textContent = loading ? '태풍·낙뢰 자료 확인 중'
                        : (failed ? '일부 자료 확인 불가 · ' : '')
                            + '태풍 ' + severe.typhoonCount + '개 · 낙뢰 ' + severe.lightningCount + '회 · ' + warningText;
                }
                infoBox.setAttribute('aria-label', '위험기상, 최근 관측과 발표 자료');
            }
        }

        document.querySelectorAll('button[data-explore-mode]').forEach(function (button) {
            var selected = button.dataset.exploreMode === mode;
            button.classList.toggle('on', selected);
            setPressed(button, selected);
        });
        document.querySelectorAll('button[data-data-domain]').forEach(function (button) {
            var selected = button.dataset.dataDomain === dataDomain;
            button.classList.toggle('on', selected);
            setPressed(button, selected);
        });
        if (app) {
            app.dataset.exploreMode = mode;
            app.dataset.dataDomain = dataDomain;
        }
        var layerSettings = document.getElementById('layer_settings');
        if (layerSettings && dataDomain !== 'weather') layerSettings.open = true;
    }

    function applyExploreMode(mode) {
        if (!EXPLORE_COPY[mode] || applyingExploreMode) return;
        applyingExploreMode = true;
        activeExploreMode = mode;
        if (mode === 'wind' || mode === 'temperature' || mode === 'precipitation'
                || mode === 'solar' || mode === 'hazards') {
            lastWeatherExploreMode = mode;
        }
        var compact = !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
        var metricChanged = false;
        try {
            setHazardMapContext(mode === 'hazards');
            if (mode !== 'hazards') setHazards(false, false);
            if (mode === 'wind') {
                setEnvironment('off', false);
                metricChanged = setWeatherMetric('wdws');
                window.WEATHER_GRID_LAYERS = { heat: true, stream: true, iso: false };
                setWeatherStations(!compact);
                selectMapBackground('basemap_weather');
            } else if (mode === 'temperature') {
                setEnvironment('off', false);
                metricChanged = setWeatherMetric('tmp');
                window.WEATHER_GRID_LAYERS = { heat: true, stream: false, iso: false };
                setWeatherStations(!compact);
                selectMapBackground('basemap_weather');
            } else if (mode === 'precipitation') {
                setEnvironment('off', false);
                metricChanged = setWeatherMetric(lastPrecipitationMetric);
                window.WEATHER_GRID_LAYERS = { heat: true, stream: false, iso: false };
                setWeatherStations(!compact);
                selectMapBackground('basemap_weather');
            } else if (mode === 'solar') {
                setEnvironment('off', false);
                metricChanged = setWeatherMetric('swdn');
                window.WEATHER_GRID_LAYERS = { heat: true, stream: false, iso: false };
                setWeatherStations(!compact);
                selectMapBackground('basemap_weather');
            } else if (mode === 'hazards') {
                stopPlay();
                setEnvironment('off', false);
                window.WEATHER_GRID_LAYERS = { heat: false, stream: false, iso: false };
                setWeatherStations(false);
                selectMapBackground('basemap_weather');
                setHazards(true, true);
            } else if (mode === 'air') {
                metricChanged = setWeatherMetric('wdws');
                window.WEATHER_GRID_LAYERS = { heat: false, stream: true, iso: false };
                setWeatherStations(false);
                selectMapBackground('basemap_weather');
                setEnvironment('pm25', false);
            } else if (mode === 'road') {
                setEnvironment('off', true);
                window.WEATHER_GRID_LAYERS = { heat: false, stream: false, iso: false };
                setWeatherStations(false);
                selectMapBackground('basemap_streets');
            } else if (mode === 'custom') {
                setEnvironment('off', false);
                metricChanged = setWeatherMetric(lastSelectedWeatherMetric);
                normalizeWeatherLayers(lastSelectedWeatherMetric);
                setWeatherStations(!compact);
                selectMapBackground('basemap_weather');
            }
            window.applyRenderMode();
            refreshExploreContext(mode);
            if (!metricChanged && (mode === 'wind' || mode === 'temperature'
                    || mode === 'precipitation' || mode === 'solar')) {
                if (typeof updateSelectionSummary === 'function') updateSelectionSummary();
            }
            updateHash();
        } finally {
            applyingExploreMode = false;
        }
    }

    function inferExploreMode() {
        if (airMode() === 'pm10' || airMode() === 'pm25') return 'air';
        if (cctvEnabled()) return 'road';
        var metric = document.getElementById('element');
        var layers = window.WEATHER_GRID_LAYERS || {};
        var severe = hazardState();
        if ((severe.typhoon || severe.lightning) && !layers.heat && !layers.stream && !layers.iso) return 'hazards';
        if (metric && metric.value === 'tmp' && layers.heat && !layers.stream && !layers.iso) return 'temperature';
        if (metric && PRECIPITATION_ELEMENTS.indexOf(metric.value) >= 0
                && layers.heat && !layers.stream && !layers.iso) return 'precipitation';
        if (metric && metric.value === 'swdn' && layers.heat && !layers.stream && !layers.iso) return 'solar';
        if (metric && metric.value === 'wdws' && layers.heat && layers.stream && !layers.iso) return 'wind';
        return 'custom';
    }

    function syncExploreMode() {
        if (applyingExploreMode) return;
        activeExploreMode = inferExploreMode();
        if (activeExploreMode === 'wind' || activeExploreMode === 'temperature'
                || activeExploreMode === 'precipitation' || activeExploreMode === 'solar'
                || activeExploreMode === 'hazards') {
            lastWeatherExploreMode = activeExploreMode;
        }
        if (activeExploreMode === 'custom') {
            var selected = document.getElementById('element');
            var selectedMeta = weatherMeta(selected && selected.value);
            if (selectedMeta.group === 'additional' || selectedMeta.group === 'marine') {
                lastWeatherExploreMode = 'custom';
            }
        }
        setHazardMapContext(activeExploreMode === 'hazards');
        refreshExploreContext(activeExploreMode);
    }

    document.querySelectorAll('button[data-explore-mode]').forEach(function (button) {
        button.addEventListener('click', function () { applyExploreMode(button.dataset.exploreMode); });
    });
    document.querySelectorAll('button[data-data-domain]').forEach(function (button) {
        button.addEventListener('click', function () {
            var dataDomain = button.dataset.dataDomain;
            if (dataDomain === 'air') applyExploreMode('air');
            else if (dataDomain === 'traffic') applyExploreMode('road');
            else applyExploreMode(lastWeatherExploreMode);
        });
    });
    ['seg_element', 'seg_precipitation', 'seg_additional_weather', 'seg_marine_weather',
        'layer_toggles', 'seg_air_quality', 'cctv_toggle', 'weather_stations',
        'typhoon_toggle', 'lightning_toggle'].forEach(function (id) {
        var control = document.getElementById(id);
        if (control) control.addEventListener('click', function () { setTimeout(syncExploreMode, 0); });
    });
    document.addEventListener('weather-grid:environment-changed', syncExploreMode);
    document.addEventListener('weather-grid:hazards-changed', syncExploreMode);
    document.addEventListener('weather-grid:hazards-settled', function () { refreshExploreContext(activeExploreMode); });
    document.addEventListener('weather-grid:grid-settled', function () { refreshExploreContext(activeExploreMode); });
    syncExploreMode();

    var coarsePointerQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    function updateCompact3dTip() {
        var tip3d = document.querySelector('.view3d_legendtip');
        if (!tip3d) return;
        tip3d.textContent = coarsePointerQuery && coarsePointerQuery.matches
            ? '한 손가락 회전 · 두 손가락 줌 · 표면을 터치하면 좌표·값 표시'
            : '드래그 회전 · 휠 줌 · 우클릭 이동 · 표면에 마우스를 올리면 좌표·값 표시';
    }
    updateCompact3dTip();
    if (coarsePointerQuery) coarsePointerQuery.addEventListener('change', updateCompact3dTip);

    document.addEventListener('keydown', function (event) {
        if (activeModal || dock.classList.contains('collapsed')
                || !(mobileDockQuery && mobileDockQuery.matches)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            setDockCollapsed(true, true);
            return;
        }
        if (event.key !== 'Tab') return;
        var focusables = modalFocusableElements(dock);
        if (!focusables.length) {
            event.preventDefault();
            focusElement(dock);
            return;
        }
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dock.contains(document.activeElement))) {
            event.preventDefault();
            focusElement(last);
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            focusElement(first);
        }
    });

    /* ==================== 6. 도법 전환 ==================== */

    // 모든 도법이 동일한 동아시아 이동 제한을 공유한다.
    var GEO_EXTENT = (window.WEATHER_GRID_GEO_LIMIT_EXTENT || [116, 29, 140, 46]).slice();

    /** 도법 전환 시 GeoJSON 벡터 소스들을 새 투영으로 다시 읽는다 (피처 좌표는 불변, featureProjection만 교체) */
    function rebuildVectorSources(code) {
        function rebuild(layer, dataObj) {
            if (!layer || !dataObj) return;
            var source = new ol.source.Vector({
                features: new ol.format.GeoJSON().readFeatures(dataObj, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: code
                })
            });
            layer.setSource(source);
        }
        var land = window.WeatherGridGeodata.peek('eastAsiaLand');
        var admin1 = window.WeatherGridGeodata.peek('koreaAdmin1');
        rebuild(weatherBasemapLayer, land);
        // 숨겨진 벡터/시·도 레이어는 경계 데이터가 실제로 로드된 뒤에만 다시 읽는다.
        // 초기 도법 전환이 같은 육지 GeoJSON을 두 번 파싱하는 비용을 만들지 않게 한다.
        if (admin1) {
            rebuild(vectorLayer, land);
            rebuild(provinceBoundaryLayer, admin1);
        }

        // 대표 기상 지점 마커
        if (stationVectorLayer && typeof stationSearchAnchors !== 'undefined') {
            var feats = stationSearchAnchors.map(function (item) {
                return new ol.Feature({
                    geometry: new ol.geom.Point(ol.proj.transform([item.lon, item.lat], 'EPSG:4326', code)),
                    stn_name: item.name, latitude: item.lat, longitude: item.lon
                });
            });
            var stationSource = stationVectorLayer.getSource();
            stationSource.clear(true);
            stationSource.addFeatures(feats);
        }

        // 인프라 레이어
        Object.keys(infraLayers).forEach(function (k) {
            infraLayers[k].layer.setSource(buildInfraSource(infraLayers[k].data, code));
        });
    }

    /** 뷰 도법 교체: WEATHER_GRID_VIEW_PROJ 갱신 → 뷰·벡터 소스 재구성 → 재조회(히트맵·스트림·등치선 재렌더) */
    function switchProjection(code) {
        if (code === window.WEATHER_GRID_VIEW_PROJ) return;

        var oldView = weatherMap.getView();
        var vis4326 = ol.proj.transformExtent(
            oldView.calculateExtent(weatherMap.getSize()), oldView.getProjection(), 'EPSG:4326');

        window.WEATHER_GRID_VIEW_PROJ = code;

        var newView = new ol.View({
            projection: code,
            extent: ol.proj.transformExtent(GEO_EXTENT, 'EPSG:4326', code, 16),
            constrainOnlyCenter: true,
            showFullExtent: true,
            smoothResolutionConstraint: true,
            constrainResolution: false,
            enableRotation: false
        });
        weatherMap.setView(newView);
        newView.fit(ol.proj.transformExtent(vis4326, 'EPSG:4326', code), { size: weatherMap.getSize() });

        // 현재 화면 스케일 기준으로 줌 한계 설정 (기존 LCC 7~12와 동일한 5단계 폭)
        var z = newView.getZoom();
        newView.setMinZoom(hazardMapState ? 2.5 : Math.floor(z));
        newView.setMaxZoom(Math.floor(z) + 5);
        rebuildVectorSources(code);
        document.dispatchEvent(new CustomEvent('weather-grid:projection-changed', { detail: { code: code } }));
        refreshWeatherGrid();    // 히트맵(ImageCanvas)·스트림라인을 새 도법으로 재생성
    }

    document.getElementById('seg_proj').addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-proj]');
        if (!btn) return;
        this.querySelectorAll('button').forEach(function (b) {
            var selected = b === btn;
            b.classList.toggle('on', selected);
            setPressed(b, selected);
        });
        switchProjection(btn.dataset.proj);
    });

    /* ==================== 7. 인프라 레이어 (교량·공항·항만) ==================== */

    /** 인프라 마커 라벨 스타일 (글리프+이름, 헤일로 포함) */
    function infraLabel(glyph, name, fill, halo) {
        return new ol.style.Text({
            text: glyph + ' ' + name,
            font: "700 12px system-ui, sans-serif",
            fill: fill,
            stroke: halo,
            offsetY: -13,
            overflow: true
        });
    }

    /** 라벨은 한 단계 줌인(약 800m/px 미만)부터 표시.
     *  전국 뷰에서는 글리프만 — 라벨 텍스트도 히트 영역이 되므로
     *  밀집 지역(부산권 등)에서 이웃 지물 클릭을 가로채는 것을 방지한다.
     *  도법에 따라 해상도 단위(m/px vs 도/px)가 다르므로 미터로 환산해 비교한다. */
    var INFRA_LABEL_MPP = 800;

    /** 현재 도법의 resolution을 m/px로 환산 — 위경도 도법(도 단위)은 111,320m/도로 변환 */
    var infraProjection = null;
    var infraMetersPerUnit = 1;
    function metersPerPixel(resolution) {
        var projection = weatherMap.getView().getProjection();
        if (projection !== infraProjection) {
            infraProjection = projection;
            infraMetersPerUnit = projection.getUnits() === 'degrees' ? 111320 : 1;
        }
        return resolution * infraMetersPerUnit;
    }

    /** 인프라 점 피처 스타일 팩토리 — 피처 교체 시 자동 해제되는 WeakMap으로 렌더 객체를 재사용한다. */
    function infraStyleFn(glyph, color) {
        var featureCache = new WeakMap();
        var fill = new ol.style.Fill({ color: color });
        var markerStroke = new ol.style.Stroke({ color: 'rgba(5,10,20,0.85)', width: 1.5 });
        var labelHalo = new ol.style.Stroke({ color: 'rgba(5,10,20,0.85)', width: 3 });
        var pointImage = new ol.style.Circle({ radius: 4.5, fill: fill, stroke: markerStroke });
        var lineImage = new ol.style.Circle({ radius: 4, fill: fill, stroke: markerStroke });
        var pointWithoutLabel = [new ol.style.Style({ image: pointImage })];
        var lineStrokeStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({ color: color, width: 4, lineCap: 'round' })
        });

        return function (feature, resolution) {
            var g = feature.getGeometry();
            var withLabel = metersPerPixel(resolution) < INFRA_LABEL_MPP;
            var name = feature.get('name');

            if (g.getType() === 'LineString') {
                var revision = typeof g.getRevision === 'function' ? g.getRevision() : 0;
                var lineEntry = featureCache.get(feature);
                if (!lineEntry || lineEntry.geometry !== g || lineEntry.revision !== revision) {
                    var midpoint = new ol.geom.Point(g.getCoordinateAt(0.5));
                    lineEntry = {
                        geometry: g,
                        revision: revision,
                        name: name,
                        plain: [lineStrokeStyle, new ol.style.Style({ geometry: midpoint, image: lineImage })],
                        labeled: [lineStrokeStyle, new ol.style.Style({
                            geometry: midpoint,
                            image: lineImage,
                            text: infraLabel(glyph, name, fill, labelHalo)
                        })]
                    };
                    featureCache.set(feature, lineEntry);
                } else if (lineEntry.name !== name) {
                    lineEntry.name = name;
                    lineEntry.labeled[1].setText(infraLabel(glyph, name, fill, labelHalo));
                }
                return withLabel ? lineEntry.labeled : lineEntry.plain;
            }

            if (!withLabel) return pointWithoutLabel;
            var pointEntry = featureCache.get(feature);
            if (!pointEntry || pointEntry.geometry !== g || pointEntry.name !== name) {
                pointEntry = {
                    geometry: g,
                    name: name,
                    labeled: [new ol.style.Style({
                        image: pointImage,
                        text: infraLabel(glyph, name, fill, labelHalo)
                    })]
                };
                featureCache.set(feature, pointEntry);
            }
            return pointEntry.labeled;
        };
    }

    /** GeoJSON → 소스. 각 피처에 stn_name/latitude/longitude를 부여해
     *  지도 클릭 처리(openStationForecast)와 같은 선택 흐름을 사용한다. */
    function buildInfraSource(data, code) {
        var feats = new ol.format.GeoJSON().readFeatures(data, {
            dataProjection: 'EPSG:4326', featureProjection: code
        });
        feats.forEach(function (f) {
            var g = f.getGeometry();
            var rep = (g.getType() === 'Point') ? g.getCoordinates() : g.getCoordinateAt(0.5);
            var ll = ol.proj.transform(rep, code, 'EPSG:4326');
            f.set('stn_name', f.get('name'));
            f.set('latitude', +ll[1].toFixed(4));
            f.set('longitude', +ll[0].toFixed(4));
        });
        return new ol.source.Vector({ features: feats });
    }

    var infraLayers = {};

    /** 인프라 GeoJSON을 벡터 레이어로 추가하고 토글 체크박스와 연결 */
    function addInfraLayer(key, data, glyph, color, zIndex, styleFn) {
        var layer = new ol.layer.Vector({
            title: 'infra_' + key,
            source: buildInfraSource(data, window.WEATHER_GRID_VIEW_PROJ),
            style: styleFn || infraStyleFn(glyph, color),
            declutter: true,    // 밀집 지역 라벨 겹침 방지
            visible: false
        });
        weatherMap.addLayer(layer);
        layer.setZIndex(zIndex);
        infraLayers[key] = { layer: layer, data: data };

        var btn = document.getElementById('infra_' + key);
        if (btn) {
            btn.style.display = '';
            setPressed(btn, false);
            btn.addEventListener('click', function () {
                var vis = !layer.getVisible();
                layer.setVisible(vis);
                btn.classList.toggle('clicked', vis);
                setPressed(btn, vis);
            });
        }
    }

    if (typeof infraBridgeData !== 'undefined') addInfraLayer('bridge', infraBridgeData, '🌉', '#f59e0b', 94);
    if (typeof infraAirportData !== 'undefined') addInfraLayer('airport', infraAirportData, '✈', '#38bdf8', 95);
    if (typeof infraPortData !== 'undefined') addInfraLayer('port', infraPortData, '⚓', '#34d399', 96);

    /* ==================== 8. 동적 범례·격자 분포 ==================== */

    function validLegendValues(result, element) {
        if (!result || !Array.isArray(result.data)) return [];
        return result.data.filter(function (value) {
            return window.WEATHER_GRID_WEATHER_VALUE_VALID
                ? window.WEATHER_GRID_WEATHER_VALUE_VALID(element, value)
                : Number.isFinite(value) && value > -900 && value < 9000;
        });
    }

    function countLegendBins(values, bins) {
        var counts = bins.map(function () { return 0; });
        values.forEach(function (value) {
            var index = bins.findIndex(function (bin) { return bin.contains(value); });
            if (index >= 0) counts[index]++;
        });
        return counts;
    }

    function appendLegendRow(fragment, bin, count, total) {
        var share = total ? count / total * 100 : 0;
        var row = document.createElement('div');
        row.className = 'lg_row';
        row.setAttribute('role', 'listitem');
        row.setAttribute('aria-label', bin.label + ', 유효 격자 ' + count + '개, ' + share.toFixed(1) + '%');

        var swatch = document.createElement('i');
        swatch.style.background = bin.color;
        swatch.setAttribute('aria-hidden', 'true');
        var label = document.createElement('span');
        label.className = 'lg_label';
        label.textContent = bin.label;
        var track = document.createElement('span');
        track.className = 'lg_distribution';
        track.setAttribute('aria-hidden', 'true');
        var fill = document.createElement('span');
        fill.style.width = share.toFixed(2) + '%';
        fill.style.background = bin.color;
        track.appendChild(fill);
        var output = document.createElement('output');
        output.className = 'lg_share';
        output.textContent = total ? Math.round(share) + '%' : '—';
        row.appendChild(swatch);
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(output);
        fragment.appendChild(row);
    }

    function intervalBins(thresholds, colorFor, bottomLabel, topLabel) {
        var bins = [{
            label: topLabel,
            color: colorFor(thresholds[thresholds.length - 1] + 1),
            contains: function (value) { return value > thresholds[thresholds.length - 1]; }
        }];
        for (var i = thresholds.length - 1; i >= 1; i--) {
            (function (lower, upper) {
                bins.push({
                    label: lower + '~' + upper,
                    color: colorFor((lower + upper) / 2),
                    contains: function (value) { return value > lower && value <= upper; }
                });
            })(thresholds[i - 1], thresholds[i]);
        }
        bins.push({
            label: bottomLabel,
            color: colorFor(thresholds[0] - 1),
            contains: function (value) { return value <= thresholds[0]; }
        });
        return bins;
    }

    function appendSunDistribution(box, values, ranges) {
        var top = ranges[ranges.length - 1];
        var bucketCount = 10;
        var counts = Array.from({ length: bucketCount }, function () { return 0; });
        values.forEach(function (value) {
            var index = Math.min(bucketCount - 1, Math.max(0, Math.floor(value / top * bucketCount)));
            counts[index]++;
        });
        var maxCount = Math.max.apply(null, counts.concat([1]));
        var wrap = document.createElement('div');
        wrap.className = 'lg_gradwrap';
        var gradient = document.createElement('div');
        gradient.className = 'lg_grad';
        gradient.style.background = 'linear-gradient(to bottom,' + solarPalette.slice().reverse().join(',') + ')';
        gradient.setAttribute('aria-hidden', 'true');
        var histogram = document.createElement('div');
        histogram.className = 'lg_sun_histogram';
        histogram.setAttribute('role', 'list');
        counts.slice().reverse().forEach(function (count, reverseIndex) {
            var sourceIndex = counts.length - 1 - reverseIndex;
            var share = values.length ? count / values.length * 100 : 0;
            var lower = Math.round(top * sourceIndex / bucketCount);
            var upper = Math.round(top * (sourceIndex + 1) / bucketCount);
            var colorIndex = Math.round(sourceIndex / (bucketCount - 1) * (solarPalette.length - 1));
            var row = document.createElement('span');
            row.className = 'lg_sun_bin';
            row.setAttribute('role', 'listitem');
            row.setAttribute('aria-label', lower + '–' + upper + ' W/㎡, 유효 격자 '
                + count + '개, ' + share.toFixed(1) + '%');
            var bar = document.createElement('i');
            bar.style.width = (count ? Math.max(5, count / maxCount * 100) : 0).toFixed(2) + '%';
            bar.style.background = solarPalette[colorIndex];
            row.appendChild(bar);
            histogram.appendChild(row);
        });
        var ticks = document.createElement('div');
        ticks.className = 'lg_ticks';
        [ranges[ranges.length - 1], Math.round(ranges[ranges.length - 1] * 0.5), 0].forEach(function (tick) {
            var label = document.createElement('span');
            label.textContent = tick;
            ticks.appendChild(label);
        });
        wrap.appendChild(gradient);
        wrap.appendChild(histogram);
        wrap.appendChild(ticks);
        box.appendChild(wrap);
    }

    function appendLegendUnit(box, text) {
        var unit = document.createElement('div');
        unit.className = 'lg_unit';
        unit.textContent = text;
        box.appendChild(unit);
    }

    function weatherLegendName(element) {
        var meta = weatherMeta(element);
        return meta.legend || '기상 분포';
    }

    function legendColor(element, value) {
        return window.WEATHER_GRID_WEATHER_COLOR
            ? window.WEATHER_GRID_WEATHER_COLOR(element, value,
                ($('#forecast_date').val() || '').split('-')[1] || '07')
            : 'rgba(119, 139, 160, .5)';
    }

    function appendBinnedLegend(box, values, bins, unitText) {
        var counts = countLegendBins(values, bins);
        var fragment = document.createDocumentFragment();
        bins.forEach(function (bin, index) {
            appendLegendRow(fragment, bin, counts[index], values.length);
        });
        box.appendChild(fragment);
        appendLegendUnit(box, unitText);
    }

    function updateWeatherLegendHeading(element) {
        var title = weatherLegendName(element);
        var heading = document.getElementById('weather_legend_title');
        var toggle = document.querySelector('#weather_legend .legend_toggle');
        if (heading) heading.textContent = title;
        if (toggle) {
            toggle.textContent = title;
            var collapsed = document.getElementById('weather_legend').classList.contains('legend-collapsed');
            toggle.setAttribute('aria-label', title + (collapsed ? ' 펼치기' : ' 접기'));
        }
    }

    /** 실제 색상 함수와 마지막 격자 응답에서 범례·구간별 분포를 함께 만든다. */
    function buildLegendScale(result, requestedElement) {
        var legend = document.getElementById('weather_legend');
        if (!legend) return;
        var box = document.getElementById('legend_scale');
        if (!box) {
            box = document.createElement('div');
            box.id = 'legend_scale';
            var content = legend.querySelector('.weather_legend_content') || legend;
            content.insertBefore(box, content.querySelector('.grid_stats'));
        }
        var element = requestedElement || $('#element').val();
        updateWeatherLegendHeading(element);
        var canReuseLastResult = !requestedElement && window.lastGridElement === element;
        var values = validLegendValues(result || (canReuseLastResult ? window.lastGridResult : null), element);
        var stats = legend.querySelector('.grid_stats');
        if (stats) stats.hidden = !!weatherMeta(element).categorical;
        box.replaceChildren();
        box.setAttribute('role', 'list');
        if (element === 'wdws') {
            var th = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
            var bins = intervalBins(th, windPaletteColor, '1 이하', '12 초과');
            var counts = countLegendBins(values, bins);
            var fragment = document.createDocumentFragment();
            bins.forEach(function (bin, index) { appendLegendRow(fragment, bin, counts[index], values.length); });
            box.appendChild(fragment);
            appendLegendUnit(box, '격자 분포 · 단위 m/s');
        } else if (element === 'tmp') {
            var tt = [-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35];
            var tempBins = intervalBins(tt, findTmpColor, '-15 이하', '35 초과');
            var tempCounts = countLegendBins(values, tempBins);
            var tempFragment = document.createDocumentFragment();
            tempBins.forEach(function (bin, index) { appendLegendRow(tempFragment, bin, tempCounts[index], values.length); });
            box.appendChild(tempFragment);
            appendLegendUnit(box, '격자 분포 · 단위 ℃');
        } else if (element === 'pcp') {
            // 기상청 강수 강도 구간을 그대로 사용한다. 경계값은 더 높은 구간에 포함한다.
            var rainBins = [
                { label: '50 이상', color: findRainColor(50), contains: function (v) { return v >= 50; } },
                { label: '30–50', color: findRainColor(30), contains: function (v) { return v >= 30 && v < 50; } },
                { label: '15–30', color: findRainColor(15), contains: function (v) { return v >= 15 && v < 30; } },
                { label: '3–15', color: findRainColor(3), contains: function (v) { return v >= 3 && v < 15; } },
                { label: '1–3', color: findRainColor(1), contains: function (v) { return v >= 1 && v < 3; } },
                { label: '1 미만', color: findRainColor(0.5), contains: function (v) { return v > 0 && v < 1; } },
                // 지도에서는 0mm를 투명하게 두되 분포 막대는 중성색으로 읽히게 한다.
                { label: '강수 없음', color: 'rgba(119, 139, 160, 0.32)', contains: function (v) { return v === 0; } }
            ];
            var rainCounts = countLegendBins(values, rainBins);
            var rainFragment = document.createDocumentFragment();
            rainBins.forEach(function (bin, index) {
                appendLegendRow(rainFragment, bin, rainCounts[index], values.length);
            });
            box.appendChild(rainFragment);
            appendLegendUnit(box, '유효 격자 분포 · 1시간 강수량 mm');
        } else if (element === 'sno') {
            appendBinnedLegend(box, values, [
                { label: '20 이상', color: legendColor('sno', 20), contains: function (v) { return v >= 20; } },
                { label: '10–20', color: legendColor('sno', 10), contains: function (v) { return v >= 10 && v < 20; } },
                { label: '5–10', color: legendColor('sno', 5), contains: function (v) { return v >= 5 && v < 10; } },
                { label: '3–5', color: legendColor('sno', 3), contains: function (v) { return v >= 3 && v < 5; } },
                { label: '1–3', color: legendColor('sno', 1), contains: function (v) { return v >= 1 && v < 3; } },
                { label: '1 미만', color: legendColor('sno', .5), contains: function (v) { return v > 0 && v < 1; } },
                { label: '신적설 없음', color: 'rgba(119, 139, 160, 0.32)', contains: function (v) { return v === 0; } }
            ], '유효 격자 분포 · 1시간 신적설 cm');
        } else if (element === 'reh') {
            appendBinnedLegend(box, values, [
                { label: '90–100', color: legendColor('reh', 95), contains: function (v) { return v > 90 && v <= 100; } },
                { label: '80–90', color: legendColor('reh', 85), contains: function (v) { return v > 80 && v <= 90; } },
                { label: '60–80', color: legendColor('reh', 70), contains: function (v) { return v > 60 && v <= 80; } },
                { label: '40–60', color: legendColor('reh', 50), contains: function (v) { return v > 40 && v <= 60; } },
                { label: '20–40', color: legendColor('reh', 30), contains: function (v) { return v > 20 && v <= 40; } },
                { label: '0–20', color: legendColor('reh', 10), contains: function (v) { return v >= 0 && v <= 20; } }
            ], '유효 격자 분포 · 상대습도 %');
        } else if (element === 'pty') {
            appendBinnedLegend(box, values, [
                { label: '눈', color: legendColor('pty', 3), contains: function (v) { return v === 3; } },
                { label: '비/눈', color: legendColor('pty', 2), contains: function (v) { return v === 2; } },
                { label: '비', color: legendColor('pty', 1), contains: function (v) { return v === 1; } },
                { label: '소나기', color: legendColor('pty', 4), contains: function (v) { return v === 4; } },
                { label: '강수 없음', color: 'rgba(119, 139, 160, 0.32)', contains: function (v) { return v === 0; } }
            ], '유효 격자 분포 · 기상청 강수형태 코드');
        } else if (element === 'sky') {
            appendBinnedLegend(box, values, [
                { label: '흐림', color: legendColor('sky', 4), contains: function (v) { return v === 4; } },
                { label: '구름많음', color: legendColor('sky', 3), contains: function (v) { return v === 3; } },
                { label: '맑음', color: legendColor('sky', 1), contains: function (v) { return v === 1; } }
            ], '유효 격자 분포 · 기상청 하늘상태 코드');
        } else if (element === 'wav') {
            appendBinnedLegend(box, values, [
                { label: '4 이상', color: legendColor('wav', 4), contains: function (v) { return v >= 4; } },
                { label: '3–4', color: legendColor('wav', 3), contains: function (v) { return v >= 3 && v < 4; } },
                { label: '2–3', color: legendColor('wav', 2), contains: function (v) { return v >= 2 && v < 3; } },
                { label: '1–2', color: legendColor('wav', 1), contains: function (v) { return v >= 1 && v < 2; } },
                { label: '0.5–1', color: legendColor('wav', .5), contains: function (v) { return v >= .5 && v < 1; } },
                { label: '0.5 미만', color: legendColor('wav', .25), contains: function (v) { return v >= 0 && v < .5; } }
            ], '해상 유효 격자 분포 · 파고 m · 육지는 자료 없음');
        } else if (element === 'swdn') {
            var m = $('#forecast_date').val() ? $('#forecast_date').val().split('-')[1]
                : (typeof month !== 'undefined' ? month : '07');
            var ranges = monthlySolarThresholds[m] || monthlySolarThresholds['07'];
            appendSunDistribution(box, values, ranges);
            appendLegendUnit(box, '격자 분포 · W/㎡ · ' + parseInt(m, 10) + '월');
        }
    }

    // 범례 갱신 훅 — 기본 범례 갱신 뒤 동적 스케일도 함께 갱신
    var _origTotalLegend = window.updateWeatherLegend;
    window.updateWeatherLegend = function () {
        if (typeof _origTotalLegend === 'function') _origTotalLegend();
        buildLegendScale();
    };
    var _origSunLegend = window.syncSolarLegend;
    window.syncSolarLegend = function (m) {
        if (typeof _origSunLegend === 'function') _origSunLegend(m);
        buildLegendScale();
    };
    window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION = function (result, element) {
        buildLegendScale(result, element);
    };
    buildLegendScale();

    var legend = document.getElementById('weather_legend');
    var legendToggle = legend ? legend.querySelector('.legend_toggle') : null;
    var mobileLegendQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;

    function setLegendCollapsed(collapsed) {
        if (!legend || !legendToggle) return;
        legend.classList.toggle('legend-collapsed', collapsed);
        legend.classList.add('legend-ready');
        legendToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        var title = weatherLegendName($('#element').val());
        legendToggle.textContent = title;
        legendToggle.setAttribute('aria-label', title + (collapsed ? ' 펼치기' : ' 접기'));
    }

    if (legendToggle) {
        legendToggle.addEventListener('click', function () {
            setLegendCollapsed(!legend.classList.contains('legend-collapsed'));
        });
        setLegendCollapsed(!!(mobileLegendQuery && mobileLegendQuery.matches));
    }
    if (mobileLegendQuery) {
        mobileLegendQuery.addEventListener('change', function (event) {
            setLegendCollapsed(event.matches);
        });
    }

    /* ==================== 9. 커서 좌표·격자값 리드아웃 ==================== */

    var readout = document.createElement('div');
    readout.id = 'cursor_readout';
    document.querySelector('.map_workspace').appendChild(readout);

    var lastMove = 0;
    weatherMap.on('pointermove', function (e) {
        var now = Date.now();
        if (now - lastMove < 60) return;    // 60ms 스로틀
        lastMove = now;
        var r = window.lastGridResult;
        if (!r || e.dragging) { readout.style.display = 'none'; return; }
        var ll = ol.proj.transform(e.coordinate, weatherMap.getView().getProjection(), 'EPSG:4326');
        var g = kmaLatLonToGridFrac(ll[1], ll[0]);
        var col = Math.round((g[0] - r.nxMin) / (r.step || 1));
        var rowS = Math.round((g[1] - r.nyMin) / (r.step || 1));
        if (col < 0 || col >= r.nx || rowS < 0 || rowS >= r.ny) {
            readout.style.display = 'none';
            return;
        }
        var v = r.data[(r.ny - 1 - rowS) * r.nx + col];
        var element = window.lastGridElement;
        var valTxt = window.WEATHER_GRID_WEATHER_VALUE_TEXT
            ? window.WEATHER_GRID_WEATHER_VALUE_TEXT(element, v)
            : (!Number.isFinite(v) || v <= -900 || v >= 9000 ? '—' : Math.round(v * 10) / 10);
        readout.innerHTML = ll[1].toFixed(3) + '°N ' + ll[0].toFixed(3) + '°E'
            + ' <b>' + valTxt + '</b>';
        readout.style.display = 'block';
    });

    /* ==================== 9-1. 시계열 모달 닫기 보강 ==================== */
    // X 버튼만으로는 갇힌 느낌을 주므로 배경 클릭도 닫기로 동작
    $(document).on('mousedown', '.station_modal', function (e) {
        if (e.target === this) closeStationModal();
    });

    /* ==================== 10. 딥링크 (URL 해시로 화면 상태 공유) ==================== */

    /** 현재 화면 상태(요소·고도·날짜·시각·발효·도법·표시 레이어)를 URL 해시로 직렬화 — 딥링크 공유용 */
    function updateHash() {
        try {
            normalizeAvailableHeight();
            var p = new URLSearchParams();
            p.set('e', $('#element').val());
            p.set('h', $('#height').val());
            p.set('d', $('#forecast_date').val());
            p.set('t', $('#baseTime').val());
            p.set('f', String(typeof leadHourCursor !== 'undefined' ? leadHourCursor : 0));
            p.set('proj', window.WEATHER_GRID_VIEW_PROJ);
            var L = window.WEATHER_GRID_LAYERS || { heat: true, stream: true };
            p.set('v', ['heat', 'stream', 'iso'].filter(function (k) { return L[k]; }).join(',') || 'none');
            var airMode = window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.getMode
                ? window.WEATHER_GRID_AIR_QUALITY.getMode() : 'off';
            if (airMode === 'pm10' || airMode === 'pm25') p.set('air', airMode);
            if (window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.isEnabled && window.WEATHER_GRID_CCTV.isEnabled()) {
                p.set('cctv', '1');
            }
            var severe = hazardState();
            var hazardLayers = [];
            if (severe.typhoon) hazardLayers.push('typhoon');
            if (severe.lightning) hazardLayers.push('lightning');
            if (hazardLayers.length) p.set('haz', hazardLayers.join(','));
            if (severe.lightning && [15, 30, 60].indexOf(Number(severe.lightningMinutes)) >= 0) {
                p.set('lwin', String(severe.lightningMinutes));
            }
            history.replaceState(null, '', '#' + p.toString());
        } catch (e) { /* 무해 */ }
    }
    window.WEATHER_GRID_UPDATE_HASH = updateHash;

    // refreshWeatherGrid를 감싸 조회 때마다 URL 갱신 — weather-grid.js 내부 호출도 전역 바인딩을 거치므로 함께 적용
    // 해시(딥링크)가 있으면 weather-grid.js의 초기 기본 조회 1회를 건너뛴다:
    // 기본 조회와 복원 조회가 경합하면 늦게 도착한 응답이 화면을 덮어쓰기 때문.
    var hashActive = !!(location.hash && location.hash.length > 1);
    var skipInitialFetch = hashActive;
    var _origGetDatas = window.refreshWeatherGrid;
    window.refreshWeatherGrid = function () {
        if (skipInitialFetch) { skipInitialFetch = false; return; }
        normalizeAvailableHeight();
        readout.style.display = 'none';    // 요소 전환 직후 이전 단위가 남아 보이는 것 방지
        _origGetDatas();
        updateHash();
    };

    /** 세그먼트 버튼 그룹의 시각 상태를 값에 맞춰 동기 (해시 복원 등 프로그램적 변경용) */
    function segSet(segId, val, attr) {
        var seg = document.getElementById(segId);
        if (!seg) return;
        seg.querySelectorAll('button').forEach(function (b) {
            var selected = b.getAttribute(attr) === val;
            b.classList.toggle('on', selected);
            setPressed(b, selected);
        });
    }

    function isValidCalendarDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        var parts = value.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return date.getUTCFullYear() === parts[0]
            && date.getUTCMonth() === parts[1] - 1
            && date.getUTCDate() === parts[2];
    }

    function earliestForecastDate(latestDate) {
        var parts = latestDate.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 60));
        return date.getUTCFullYear() + '-'
            + ('0' + (date.getUTCMonth() + 1)).slice(-2) + '-'
            + ('0' + date.getUTCDate()).slice(-2);
    }

    // 해시 복원 — weather-grid.js의 ready(기본값 세팅) 이후 실행된다 (초기 조회는 위에서 스킵됨)
    $(function () {
        if (!hashActive) return;
        var p;
        try { p = new URLSearchParams(location.hash.slice(1)); } catch (e) { refreshWeatherGrid(); return; }
        var e = p.get('e');
        if (e && ['wdws', 'swdn', 'tmp', 'pcp', 'pty', 'sno', 'reh', 'sky', 'wav'].indexOf(e) >= 0
                && e !== $('#element').val()) {
            $('#element').val(e);
            document.getElementById('element').dispatchEvent(new Event('change', { bubbles: true }));
            syncWeatherElementControls(e);
            lastSelectedWeatherMetric = e;
            if (PRECIPITATION_ELEMENTS.indexOf(e) >= 0) lastPrecipitationMetric = e;
        }
        var h = p.get('h');
        if (h === '10m' && h !== $('#height').val()) {
            $('#height').val(h);
        } else if (h !== null) {
            normalizeAvailableHeight();
        }
        var d = p.get('d');
        if (d && isValidCalendarDate(d) && d >= earliestForecastDate(todayStr)
                && d <= todayStr && d !== $('#forecast_date').val()) {
            $('#forecast_date').val(d);
        }
        var t = p.get('t');
        if (t && ['02', '05', '08', '11', '14', '17', '20', '23'].indexOf(t) >= 0
                && (d !== todayStr || Number(t) <= Number(time)) && t !== $('#baseTime').val()) {
            $('#baseTime').val(t);
            $('.forecast_run_button').removeClass('on').each(function () {
                if ($(this).text() === t) $(this).addClass('on');
            });
        }
        var f = parseInt(p.get('f'), 10);
        if (!isNaN(f) && f >= 1 && f <= 48 && f !== leadHourCursor) {
            leadHourCursor = f;
            renderForecastTimeline(leadHourCursor);
        }
        var v = p.get('v');
        if (v !== null) {
            window.WEATHER_GRID_LAYERS = {
                heat: v.indexOf('heat') >= 0,
                stream: v.indexOf('stream') >= 0,
                iso: v.indexOf('iso') >= 0
            };
        } else if (p.get('r') === 'iso') {
            // 구버전 딥링크(r=iso) 호환 — 당시 의미: 히트맵 대신 등치선
            window.WEATHER_GRID_LAYERS = { heat: false, stream: true, iso: true };
        }
        var restoredElement = $('#element').val();
        var restoredMeta = weatherMeta(restoredElement);
        if (restoredElement !== 'wdws') window.WEATHER_GRID_LAYERS.stream = false;
        if (restoredMeta.isoline === false) {
            window.WEATHER_GRID_LAYERS.iso = false;
            window.WEATHER_GRID_LAYERS.heat = true;
        }
        var air = p.get('air');
        if ((air === 'pm10' || air === 'pm25') && window.WEATHER_GRID_AIR_QUALITY) {
            window.WEATHER_GRID_AIR_QUALITY.setMode(air);
        }
        if (p.get('cctv') === '1' && window.WEATHER_GRID_CCTV) {
            window.WEATHER_GRID_CCTV.setEnabled(true);
        }
        var hazardParam = p.get('haz') || '';
        if (window.WEATHER_GRID_SEVERE_WEATHER && hazardParam) {
            var lightningMinutes = parseInt(p.get('lwin'), 10);
            if ([15, 30, 60].indexOf(lightningMinutes) >= 0) {
                window.WEATHER_GRID_SEVERE_WEATHER.setLightningWindow(lightningMinutes);
            }
            window.WEATHER_GRID_SEVERE_WEATHER.setLayers({
                typhoon: hazardParam.split(',').indexOf('typhoon') >= 0,
                lightning: hazardParam.split(',').indexOf('lightning') >= 0
            });
        }
        // 해시가 select·레이어 값을 직접 복원하므로 빠른 보기와 문맥도 한 번 명시적으로 맞춘다.
        syncExploreMode();
        // 실제 반영·칩 동기화는 조회 완료 시 weather-grid.js의 applyRenderMode 훅이 수행
        var proj = p.get('proj');
        if (proj && ['KMA_GRID_LCC', 'EPSG:3857', 'EPSG:4326'].indexOf(proj) >= 0
                && proj !== window.WEATHER_GRID_VIEW_PROJ) {
            segSet('seg_proj', proj, 'data-proj');
            switchProjection(proj);    // 내부에서 refreshWeatherGrid 호출
        } else {
            refreshWeatherGrid();    // 초기 조회를 스킵했으므로 복원 상태로 1회 조회
        }
        // 유효하지 않거나 오래된 파라미터를 현재 실제 상태로 즉시 정규화한다.
        // 그렇지 않으면 새로고침마다 같은 잘못된 딥링크를 다시 복원하려 든다.
        updateHash();
    });

    /* ==================== 12. 3D 뷰 연결 ==================== */

    var btn3d = document.getElementById('btn_3d');
    var btn3dDock = document.getElementById('btn_3d_dock');
    var btn3dTriggers = [btn3d, btn3dDock].filter(Boolean);
    var pending3dOpener = null;
    var view3dElement = document.getElementById('view3d');
    var map3dImportPromise = null;
    var map3dLoadAttempt = 0;
    var MAP3D_MODULE_TIMEOUT_MS = 10000;
    var resume2dStreamAfter3d = false;

    function suspend2dStreamFor3d() {
        var canvas = document.getElementById('wind_field_canvas');
        resume2dStreamAfter3d = !!(window.WEATHER_GRID_LAYERS && window.WEATHER_GRID_LAYERS.stream
            && $('#element').val() === 'wdws' && canvas && getComputedStyle(canvas).display !== 'none');
        if (window.suspendStreamlines) window.suspendStreamlines();
    }

    function resume2dStreamFrom3d() {
        var shouldResume = resume2dStreamAfter3d && window.WEATHER_GRID_LAYERS && window.WEATHER_GRID_LAYERS.stream
            && $('#element').val() === 'wdws';
        resume2dStreamAfter3d = false;
        if (shouldResume && window.refreshStreamlines) {
            requestAnimationFrame(function () { window.refreshStreamlines(); });
        }
    }

    function ensureMap3dModule() {
        if (window.WEATHER_GRID_3D) return Promise.resolve(window.WEATHER_GRID_3D);
        if (!map3dImportPromise) {
            var appRoot = document.querySelector('.app');
            var contextPath = appRoot ? (appRoot.dataset.contextPath || '') : '';
            var attempt = map3dLoadAttempt++;
            var moduleUrl = contextPath + '/static/js/map3d.js?v=20260721.12'
                + (attempt ? '&retry=' + attempt : '');
            var request = import(moduleUrl).then(function (module) {
                var api = module && module.default;
                if (!api || typeof api.open !== 'function' || typeof api.close !== 'function') {
                    throw new Error('3D 지도 모듈 API가 올바르지 않습니다.');
                }
                window.WEATHER_GRID_3D = api;
                return api;
            });
            map3dImportPromise = request;
            request.catch(function () {
                if (map3dImportPromise === request) map3dImportPromise = null;
            });
        }

        // import()는 취소할 수 없다. UI 대기만 제한하고 실제 요청은 하나를 유지해,
        // 늦게 성공한 첫 모듈과 query-string 재시도 모듈이 서로 전역을 덮지 않게 한다.
        var moduleRequest = map3dImportPromise;
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timeout = window.setTimeout(function () {
                if (settled) return;
                settled = true;
                var error = new Error('3D 지도 모듈 로드 시간 초과');
                error.code = 'MAP3D_LOAD_TIMEOUT';
                reject(error);
            }, MAP3D_MODULE_TIMEOUT_MS);
            moduleRequest.then(function (api) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                resolve(api);
            }, function (error) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                reject(error);
            });
        });
    }

    btn3d.addEventListener('click', async function () {
        var opener = pending3dOpener || btn3d;
        pending3dOpener = null;
        var currentMeta = weatherMeta(window.lastGridElement || $('#element').val());
        if (currentMeta.view3d === false) return;
        if (!window.lastGridResult) {
            if (typeof notifyUser === 'function') notifyUser('먼저 데이터를 조회해 주세요.');
            return;
        }
        btn3dTriggers.forEach(function (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        });
        try {
            await Promise.all([
                ensureMap3dModule(),
                window.WeatherGridGeodata.load('eastAsiaLand'),
                window.WeatherGridGeodata.load('koreaAdmin1')
            ]);
        } catch (error) {
            if (typeof notifyUser === 'function') {
                notifyUser(error && error.code === 'MAP3D_LOAD_TIMEOUT'
                    ? '3D 지도 모듈 응답 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
                    : '3D 지도 데이터를 불러오지 못했습니다. 네트워크 상태를 확인해 주세요.');
            }
            return;
        } finally {
            btn3dTriggers.forEach(function (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            });
            syncWeatherElementControls($('#element').val());
        }
        stopPlay();
        btn3dTriggers.forEach(function (button) { button.classList.add('active'); });
        suspend2dStreamFor3d();
        try {
            window.WEATHER_GRID_3D.open(window.lastGridResult, window.lastGridElement || 'wdws',
                (typeof month !== 'undefined' ? month : '07'));
            btn3dTriggers.forEach(function (button) { button.setAttribute('aria-expanded', 'true'); });
            activateModal(view3dElement, opener);
            syncToggleAria();
        } catch (error) {
            btn3dTriggers.forEach(function (button) {
                button.classList.remove('active');
                button.setAttribute('aria-expanded', 'false');
            });
            resume2dStreamFrom3d();
            if (typeof notifyUser === 'function') notifyUser('3D 지도를 여는 중 오류가 발생했습니다. 다시 시도해 주세요.');
        }
    });
    if (btn3dDock) {
        btn3dDock.addEventListener('click', function () {
            pending3dOpener = btn3dDock;
            // 모바일 설정 시트가 남긴 background inert가 3D 캔버스에 전파되지 않게 먼저 닫는다.
            if (mobileDockQuery && mobileDockQuery.matches && !dock.classList.contains('collapsed')) {
                setDockCollapsed(true, false);
            }
            btn3d.click();
        });
    }

    document.getElementById('view3d_close').addEventListener('click', closeView3d);

    /** 3D 오버레이 닫기 — WEATHER_GRID_3D.close()가 RAF 중단과 씬 리소스 해제까지 수행 */
    function closeView3d() {
        if (window.WEATHER_GRID_3D) window.WEATHER_GRID_3D.close();
        btn3dTriggers.forEach(function (button) {
            button.classList.remove('active');
            button.setAttribute('aria-expanded', 'false');
        });
        deactivateModal(view3dElement, true);
        resume2dStreamFrom3d();
    }

    if (view3dElement) {
        new MutationObserver(function () {
            if (view3dElement.classList.contains('open')) {
                btn3dTriggers.forEach(function (button) { button.setAttribute('aria-expanded', 'true'); });
                activateModal(view3dElement, btn3d);
            }
            else {
                btn3dTriggers.forEach(function (button) { button.setAttribute('aria-expanded', 'false'); });
                deactivateModal(view3dElement, true);
                resume2dStreamFrom3d();
            }
        }).observe(view3dElement, { attributes: true, attributeFilter: ['class'] });
    }

})();
