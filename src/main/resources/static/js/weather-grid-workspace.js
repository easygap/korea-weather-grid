/** Forecast workspace controls; the existing runtime owns all data and layer state. */
(function (window, document) {
    'use strict';

    var app = document.querySelector('.forecast-app');
    var runtime = window.WeatherGridMapRuntime;
    var ui = window.WeatherGridInterface;
    if (!app || !runtime || !ui) return;

    var map = runtime.map;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var mapOnlyButton = document.getElementById('workspace_map_only');
    var status = document.getElementById('workspace_status');
    var clockFrame = 0;
    var noticeFrame = 0;
    var dateFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', weekday: 'short' });
    var hourFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var stampFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var regions = {
        korea: { label: '전국', extent: window.WEATHER_GRID_INITIAL_GEO_EXTENT },
        capital: { label: '수도권', extent: [126.25, 36.8, 127.85, 38.15] },
        south: { label: '남해', extent: [126.1, 33.8, 129.65, 35.65] },
        jeju: { label: '제주', extent: [125.95, 32.85, 127.15, 33.85] }
    };

    function put(id, text) {
        var element = document.getElementById(id);
        if (element.textContent !== text) element.textContent = text;
    }
    function validDate(value) {
        if (!value) return null;
        var date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }
    function selectedBase() {
        var date = document.getElementById('forecast_date').value;
        var hour = Number(document.getElementById('baseTime').value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour)) return null;
        return validDate(date + 'T' + String(hour).padStart(2, '0') + ':00:00+09:00');
    }
    function updateContext() {
        clockFrame = 0;
        var base = selectedBase();
        var lead = window.WeatherGridTimeline.currentHour();
        if (!base || !Number.isFinite(lead)) return;
        var requested = new Date(base.getTime() + lead * 3600000);
        var metric = document.getElementById('element').value;
        var mode = app.dataset.exploreMode;
        var source = window.lastGridElement === metric && !window.WEATHER_GRID_GRID_LOADING ? window.lastGridResult : null;
        var actual = source && validDate(source.validTime || (source.windField && source.windField.validTime));
        var modelRun = source && validDate(source.modelRunTime);
        var reference = source && validDate(source.referenceTime || (source.windField && source.windField.referenceTime));
        var shown = actual || requested;
        var forecast = mode !== 'road' && mode !== 'air' && mode !== 'hazards';
        var sourceTimes = document.querySelector('.workspace_source dl');
        sourceTimes.hidden = !forecast;
        document.getElementById('workspace_run_settings').hidden = !forecast;

        put('workspace_date', dateFormatter.format(shown));
        put('workspace_hour', hourFormatter.format(shown));
        put('workspace_lead', mode === 'air' ? '바람 예보 +' + lead + '시간'
            : actual && actual.getTime() !== requested.getTime() ? '요청 +' + lead + '시간' : '+' + lead + '시간 예보');
        put('workspace_base_label', modelRun && metric === 'swdn' ? '모델 초기시각' : '발표시각');
        put('workspace_base', stampFormatter.format(modelRun || reference || base));
        put('workspace_valid', stampFormatter.format(shown));
        put('workspace_valid_label', actual && actual.getTime() !== requested.getTime() ? '실제 자료시각' : '예측시각');

        var sourceName = metric === 'swdn' ? '기상청 KIM · NE57 · 8 km' : '기상청 단기예보 · DFS · 5 km';
        var note = '';
        if (source && source.mock) { sourceName = '예제 자료'; note = '실제 기상 예보가 아닙니다.'; }
        else if (!source) { note = window.WEATHER_GRID_GRID_LOADING ? '자료 불러오는 중' : '자료 수신 대기'; }
        else if (actual && actual.getTime() !== requested.getTime()) {
            note = '요청 ' + stampFormatter.format(requested) + ' / 실제 자료 ' + stampFormatter.format(actual);
        } else if (source.fallbackUsed) { note = '직전 발표 자료를 사용 중입니다.'; }
        if (mode === 'air') {
            sourceName = '한국환경공단 AirKorea';
            note = '미세먼지는 최신 관측값입니다. 하단 시간축은 바람 예보에만 적용됩니다.';
        } else if (mode === 'road') {
            sourceName = '국가교통정보센터 ITS';
            note = '지도를 확대해 CCTV를 선택하세요. 영상 제공시각은 지점별로 다릅니다.';
        } else if (mode === 'hazards') {
            sourceName = '기상청 태풍·낙뢰·특보';
            note = '최근 발표·관측자료입니다. 각 자료의 기준시각을 상세정보에서 확인하세요.';
        }
        put('workspace_source_name', sourceName);
        put('workspace_source_note', note);
        var key = document.getElementById('map_color_key');
        var heat = document.querySelector('#layer_toggles [data-layer="heat"]');
        key.hidden = !forecast || heat.getAttribute('aria-pressed') !== 'true';
        updateDataNotice();
        syncLayers();
    }
    function scheduleContext() {
        if (!clockFrame) clockFrame = window.requestAnimationFrame(updateContext);
    }
    function syncLayers() {
        document.querySelectorAll('[data-workspace-layer]').forEach(function (button) {
            var original = document.querySelector('#layer_toggles [data-layer="' + button.dataset.workspaceLayer + '"]');
            button.setAttribute('aria-pressed', original.getAttribute('aria-pressed'));
            button.disabled = original.disabled;
        });
        var key = document.getElementById('map_color_key');
        key.hidden = app.dataset.dataDomain !== 'weather' || app.dataset.exploreMode === 'hazards'
            || document.querySelector('#layer_toggles [data-layer="heat"]').getAttribute('aria-pressed') !== 'true';
    }

    var dataNotice = document.getElementById('workspace_data_notice');
    var dataRetry = document.getElementById('workspace_data_retry');
    var retryTarget = null;
    function updateDataNotice() {
        var domain = app.dataset.dataDomain;
        var source = domain === 'air' ? document.getElementById('air_quality_status')
            : domain === 'traffic' ? document.getElementById('cctv_status') : null;
        var visible = source && !source.hidden && source.dataset.state !== 'loading';
        dataNotice.hidden = !visible;
        retryTarget = domain === 'air' ? document.getElementById('air_quality_retry')
            : domain === 'traffic' ? document.getElementById('cctv_retry') : null;
        if (!visible) return;
        var message = source.querySelector('[id$="_status_text"]');
        put('workspace_data_notice_text', (domain === 'air' ? '대기질 관측 · ' : '')
            + (message ? message.textContent : source.textContent));
        dataRetry.hidden = !retryTarget || retryTarget.hidden;
    }
    dataRetry.addEventListener('click', function () { if (retryTarget) retryTarget.click(); });
    var dataObserver = new MutationObserver(updateDataNotice);
    ['air_quality_status', 'cctv_status'].forEach(function (id) {
        var element = document.getElementById(id);
        if (element) dataObserver.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'data-state'] });
    });
    document.querySelectorAll('[data-workspace-action]').forEach(function (button) {
        button.addEventListener('click', function () {
            var target = document.getElementById(button.dataset.workspaceAction);
            if (button.dataset.workspaceAction !== 'theme_toggle') ui.dock.close(false);
            if (target) target.click();
        });
    });
    function syncThemeAction() {
        var button = document.querySelector('[data-workspace-action="theme_toggle"]');
        if (button) button.textContent = document.documentElement.dataset.theme === 'dark' ? '밝은 화면' : '어두운 화면';
    }
    document.addEventListener('weather-grid:theme-changed', syncThemeAction);
    syncThemeAction();
    document.getElementById('workspace_display').addEventListener('click', function (event) {
        var button = event.target.closest('[data-workspace-layer]');
        if (button) document.querySelector('#layer_toggles [data-layer="' + button.dataset.workspaceLayer + '"]').click();
    });
    var layerObserver = new MutationObserver(syncLayers);
    layerObserver.observe(document.getElementById('layer_toggles'), { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled'] });

    function openSettings(section) {
        if (!ui.dock.isOpen()) document.getElementById('dock_toggle').click();
        var details = document.getElementById(section);
        details.open = true;
        details.querySelector('summary').focus({ preventScroll: true });
        details.scrollIntoView({ block: 'nearest' });
    }
    document.getElementById('workspace_details').addEventListener('click', function () { openSettings('layer_settings'); });
    document.getElementById('workspace_run_settings').addEventListener('click', function () { openSettings('forecast_source_settings'); });

    function updateCenter() {
        var view = map.getView();
        var coordinates = window.ol.proj.toLonLat(view.getCenter(), view.getProjection());
        put('workspace_map_center', coordinates[1].toFixed(2) + '° N  ' + coordinates[0].toFixed(2) + '° E');
    }
    var dataError = document.getElementById('data_error');
    var warningBanner = document.getElementById('warning_banner');
    function scheduleNotices() {
        if (noticeFrame) return;
        noticeFrame = window.requestAnimationFrame(function () {
            noticeFrame = 0;
            if (dataError.hidden) return;
            var bottom = dataError.getBoundingClientRect().bottom;
            var warningHeight = warningBanner.hidden ? 0 : warningBanner.getBoundingClientRect().height + 8;
            app.style.setProperty('--workspace-warning-top', Math.ceil(bottom + 8) + 'px');
            app.style.setProperty('--workspace-notice-end', Math.ceil(bottom + 8 + warningHeight) + 'px');
        });
    }
    var noticeObserver = new ResizeObserver(scheduleNotices);
    noticeObserver.observe(dataError);
    noticeObserver.observe(warningBanner);

    document.getElementById('workspace_places').addEventListener('click', function (event) {
        var button = event.target.closest('[data-workspace-region]');
        var region = button && regions[button.dataset.workspaceRegion];
        if (!region || !region.extent) return;
        var view = map.getView();
        var extent = window.ol.proj.transformExtent(region.extent, 'EPSG:4326', view.getProjection(), 16);
        var padding = app.classList.contains('is-map-only') ? [110, 55, 140, 55] : window.initialViewPadding();
        if (padding[0] + padding[2] > map.getSize()[1] - 100) padding = [150, 80, 95, 30];
        view.cancelAnimations();
        view.fit(extent, { padding: padding, maxZoom: 10.6, duration: reducedMotion.matches ? 0 : 350 });
        status.textContent = region.label + ' 지도로 이동했습니다.';
    });

    function setMapOnly(enabled, restoreFocus) {
        if (enabled) ui.dock.close(false);
        app.classList.toggle('is-map-only', enabled);
        mapOnlyButton.setAttribute('aria-pressed', String(enabled));
        mapOnlyButton.setAttribute('aria-label', enabled ? '전체 도구 보기' : '지도만 보기');
        mapOnlyButton.title = enabled ? '전체 도구 보기 (Esc / F)' : '지도만 보기 (F)';
        status.textContent = enabled ? '지도만 보기. Escape 키로 도구를 다시 표시합니다.' : '전체 도구를 표시합니다.';
        if (restoreFocus) mapOnlyButton.focus({ preventScroll: true });
    }
    mapOnlyButton.addEventListener('click', function () { setMapOnly(!app.classList.contains('is-map-only'), false); });
    document.getElementById('dock_toggle').addEventListener('click', function () {
        if (app.classList.contains('is-map-only')) setMapOnly(false, false);
    });
    document.addEventListener('keydown', function (event) {
        if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        if (ui.modal.active() || ui.dock.isOpen()) return;
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (event.key === '/' && !event.shiftKey) {
            event.preventDefault();
            document.getElementById('station_query').focus();
        } else if (event.key.toLowerCase() === 'f') {
            event.preventDefault();
            setMapOnly(!app.classList.contains('is-map-only'), true);
        } else if (event.key === 'Escape' && app.classList.contains('is-map-only')) {
            event.preventDefault();
            setMapOnly(false, true);
        }
    });
    ['weather-grid:explore-changed', 'weather-grid:grid-settled', 'weather-grid:base-time-changed'].forEach(function (name) {
        document.addEventListener(name, scheduleContext);
    });
    var clockObserver = new MutationObserver(scheduleContext);
    clockObserver.observe(document.getElementById('forecast_scrubber'), { attributes: true, attributeFilter: ['aria-valuetext'] });
    map.on('moveend', updateCenter);
    document.getElementById('station_query').setAttribute('aria-keyshortcuts', '/');
    updateContext();
    updateCenter();
}(window, document));
