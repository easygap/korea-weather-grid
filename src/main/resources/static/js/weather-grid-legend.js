/**
 * 순수 범례 모델을 날씨 지도 셸의 DOM에 표시한다.
 */
(function () {
    'use strict';

    var model = window.WeatherGridLegendModel;
    if (!model) throw new Error('WeatherGridLegendModel must load before weather-grid-legend');

    var legend = document.getElementById('weather_legend');
    var toggle = legend ? legend.querySelector('.legend_toggle') : null;
    var compactQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
    var collapsed = model.initialCollapsed(Boolean(compactQuery && compactQuery.matches));

    function selectedElement() {
        var select = document.getElementById('element');
        return select ? select.value : 'wdws';
    }

    function selectedMonth() {
        var date = document.getElementById('forecast_date');
        var match = date && /^(?:\d{4})-(\d{2})-\d{2}$/.exec(date.value);
        return match ? Number(match[1]) : 7;
    }

    function scaleConfiguration() {
        return window.WEATHER_GRID_SOLAR_SCALE || { thresholds: [], palette: [] };
    }

    function getScaleBox() {
        if (!legend) return null;
        var box = document.getElementById('legend_scale');
        if (box) return box;
        box = document.createElement('div');
        box.id = 'legend_scale';
        var content = document.getElementById('weather_legend_content') || legend;
        content.insertBefore(box, content.querySelector('.grid_stats'));
        return box;
    }

    function colorFor(element, value, month) {
        return window.WEATHER_GRID_WEATHER_COLOR
            ? window.WEATHER_GRID_WEATHER_COLOR(element, value, String(month).padStart(2, '0'))
            : 'rgba(119, 139, 160, .5)';
    }

    function appendUnit(box, text) {
        if (!text) return;
        var unit = document.createElement('div');
        unit.className = 'lg_unit';
        unit.textContent = text;
        box.appendChild(unit);
    }

    function renderRow(fragment, rowModel) {
        var row = document.createElement('div');
        row.className = 'lg_row';
        row.setAttribute('role', 'listitem');
        row.setAttribute('aria-label', rowModel.ariaLabel);

        var swatch = document.createElement('i');
        swatch.style.background = rowModel.color;
        swatch.setAttribute('aria-hidden', 'true');
        var label = document.createElement('span');
        label.className = 'lg_label';
        label.textContent = rowModel.label;
        var track = document.createElement('span');
        track.className = 'lg_distribution';
        track.setAttribute('aria-hidden', 'true');
        var fill = document.createElement('span');
        fill.style.width = rowModel.share.toFixed(2) + '%';
        fill.style.background = rowModel.color;
        track.appendChild(fill);
        var output = document.createElement('output');
        output.className = 'lg_share';
        output.textContent = rowModel.shareText;
        row.appendChild(swatch);
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(output);
        fragment.appendChild(row);
    }

    function renderRows(box, legendModel) {
        box.setAttribute('role', 'list');
        var fragment = document.createDocumentFragment();
        legendModel.rows.forEach(function (row) { renderRow(fragment, row); });
        box.appendChild(fragment);
    }

    function renderSolar(box, legendModel) {
        var solar = legendModel.solar;
        var wrap = document.createElement('div');
        wrap.className = 'lg_gradwrap';
        var gradient = document.createElement('div');
        gradient.className = 'lg_grad';
        gradient.style.background = 'linear-gradient(to bottom,' + solar.gradientColors.join(',') + ')';
        gradient.setAttribute('aria-hidden', 'true');
        var histogram = document.createElement('div');
        histogram.className = 'lg_sun_histogram';
        histogram.setAttribute('role', 'list');
        solar.bins.forEach(function (bin) {
            var row = document.createElement('span');
            row.className = 'lg_sun_bin';
            row.setAttribute('role', 'listitem');
            row.setAttribute('aria-label', bin.lower + '–' + bin.upper + ' W/㎡, 유효 격자 '
                + bin.count + '개, ' + bin.share.toFixed(1) + '%');
            var bar = document.createElement('i');
            bar.style.width = bin.barPercent.toFixed(2) + '%';
            bar.style.background = bin.color;
            row.appendChild(bar);
            histogram.appendChild(row);
        });
        var ticks = document.createElement('div');
        ticks.className = 'lg_ticks';
        solar.ticks.forEach(function (tick) {
            var label = document.createElement('span');
            label.textContent = tick;
            ticks.appendChild(label);
        });
        wrap.appendChild(gradient);
        wrap.appendChild(histogram);
        wrap.appendChild(ticks);
        box.appendChild(wrap);
    }

    function syncHeading(legendModel) {
        var heading = document.getElementById('weather_legend_title');
        if (heading) heading.textContent = legendModel.title;
        if (!toggle) return;
        toggle.textContent = legendModel.title;
        toggle.setAttribute('aria-label', legendModel.title + (collapsed ? ' 펼치기' : ' 접기'));
    }

    function render(result, requestedElement) {
        var box = getScaleBox();
        if (!box) return null;
        var element = requestedElement || selectedElement();
        var canReuseLast = !requestedElement && window.lastGridElement === element;
        var solar = scaleConfiguration();
        var legendModel = model.build({
            element: element,
            data: result || (canReuseLast ? window.lastGridResult : null),
            month: selectedMonth(),
            metadata: window.WEATHER_GRID_WEATHER_ELEMENTS || {},
            isValid: window.WEATHER_GRID_WEATHER_VALUE_VALID,
            colorFor: colorFor,
            solarThresholds: solar.thresholds,
            solarPalette: solar.palette
        });

        syncHeading(legendModel);
        var stats = legend.querySelector('.grid_stats');
        if (stats) stats.hidden = legendModel.categorical;
        box.replaceChildren();
        box.toggleAttribute('data-empty', legendModel.validCount === 0);
        box.setAttribute('aria-label', legendModel.validCount
            ? legendModel.title + ', 유효 격자 ' + legendModel.validCount + '개'
            : legendModel.title + ', 표시할 유효 격자 자료 없음');
        if (legendModel.kind === 'solar') renderSolar(box, legendModel);
        else renderRows(box, legendModel);
        appendUnit(box, legendModel.unitText);
        return legendModel;
    }

    function applyCollapsed(next) {
        collapsed = Boolean(next);
        if (!legend || !toggle) return;
        legend.classList.toggle('legend-collapsed', collapsed);
        legend.classList.add('legend-ready');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        syncHeading({ title: (window.WEATHER_GRID_WEATHER_ELEMENTS[selectedElement()] || {}).legend || '기상 분포' });
    }

    if (toggle) {
        toggle.addEventListener('click', function () {
            applyCollapsed(model.reduceCollapsed(collapsed, { type: 'toggle' }));
        });
        applyCollapsed(collapsed);
    }
    if (compactQuery) {
        compactQuery.addEventListener('change', function (event) {
            applyCollapsed(model.reduceCollapsed(collapsed, { type: 'viewport', compact: event.matches }));
        });
    }

    var api = Object.freeze({
        render: render,
        isCollapsed: function () { return collapsed; },
        setCollapsed: applyCollapsed
    });
    window.WeatherGridLegend = api;
    window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION = render;
    render();
}());
