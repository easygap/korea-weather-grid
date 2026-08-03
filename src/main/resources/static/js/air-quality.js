/**
 * AirKorea PM10/PM2.5 측정소 오버레이.
 *
 * 기상 요소(element)와 타임라인 상태를 건드리지 않고 현재 지도 영역의 측정소만
 * 별도 Vector/Cluster 레이어로 관리한다. PM10 ↔ PM2.5 전환은 재요청 없이
 * 기존 피처의 스타일만 바꾼다.
 */
(function () {
    'use strict';

    var controls = document.getElementById('seg_air_quality');
    var status = document.getElementById('air_quality_status');
    var statusText = document.getElementById('air_quality_status_text');
    var retryButton = document.getElementById('air_quality_retry');
    var legend = document.getElementById('air_legend');
    var legendTitle = document.getElementById('air_legend_title');
    var legendRows = document.getElementById('air_legend_rows');
    var legendTime = document.getElementById('air_legend_time');
    var legendGauge = document.getElementById('air_legend_gauge');
    var legendToggle = legend ? legend.querySelector('.air_legend_toggle') : null;
    var popup = document.getElementById('air_popup');
    var popupClose = document.getElementById('air_popup_close');
    var popupGaugePm10 = document.getElementById('air_popup_gauge_pm10');
    var popupGaugePm25 = document.getElementById('air_popup_gauge_pm25');
    if (!controls || !status || !statusText || !retryButton || !legend || !legendRows
            || !legendTime || !popup || !popupClose || typeof ol === 'undefined'
            || typeof weatherMap === 'undefined') return;

    var COLORS = {
        good: '#38bdf8',
        moderate: '#34d399',
        bad: '#fbbf24',
        veryBad: '#f87171',
        missing: '#64748b'
    };
    var GRADE_INFO = {
        good: { label: '좋음', rank: 1 },
        moderate: { label: '보통', rank: 2 },
        bad: { label: '나쁨', rank: 3 },
        veryBad: { label: '매우 나쁨', rank: 4 },
        missing: { label: '자료 없음', rank: 0 }
    };
    var POLLUTANTS = {
        pm10: {
            label: 'PM10', valueKey: 'pm10', gradeKey: 'pm10Grade', flagKey: 'pm10Flag',
            gaugeMax: 250,
            bands: [
                { key: 'good', cutoff: 30, text: '0–30' },
                { key: 'moderate', cutoff: 80, text: '31–80' },
                { key: 'bad', cutoff: 150, text: '81–150' },
                { key: 'veryBad', cutoff: null, text: '151 이상' }
            ]
        },
        pm25: {
            label: 'PM2.5', valueKey: 'pm25', gradeKey: 'pm25Grade', flagKey: 'pm25Flag',
            gaugeMax: 150,
            bands: [
                { key: 'good', cutoff: 15, text: '0–15' },
                { key: 'moderate', cutoff: 35, text: '16–35' },
                { key: 'bad', cutoff: 75, text: '36–75' },
                { key: 'veryBad', cutoff: null, text: '76 이상' }
            ]
        }
    };
    var API_BOUNDS = { minLat: 32, maxLat: 44, minLon: 122, maxLon: 134 };
    var REQUEST_TIMEOUT_MS = 12000;

    var mode = 'off';
    var rawStations = [];
    var loadedCoverage = null;
    var lastFetchedAt = 0;
    var observationTime = '';
    var observationTimeFrom = '';
    var stale = false;
    var activeRequest = null;
    var requestSequence = 0;
    var inFlightSignature = '';
    var moveTimer = null;
    var resolutionKey = null;
    var lastDetailedZoom = null;
    var styleCache = new Map();
    var themeColorCache = null;
    var mobileLegendQuery = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;

    var rawSource = new ol.source.Vector();
    var clusterSource = new ol.source.Cluster({
        distance: 44,
        minDistance: 18,
        source: rawSource
    });
    var layer = new ol.layer.Vector({
        title: 'air-quality',
        source: clusterSource,
        visible: false,
        declutter: true,
        zIndex: 112,
        style: styleFeature
    });
    weatherMap.addLayer(layer);

    function asFiniteNumber(value) {
        if (value === null || value === undefined || value === '' || value === '-') return null;
        var number = Number(value);
        return Number.isFinite(number) && number >= 0 && number < 10000 ? number : null;
    }

    function normalizeOfficialGrade(value) {
        if (value === null || value === undefined) return null;
        var normalized = String(value).replace(/\s+/g, '').toLowerCase();
        var map = {
            '1': 'good', '좋음': 'good', 'good': 'good',
            '2': 'moderate', '보통': 'moderate', 'moderate': 'moderate',
            '3': 'bad', '나쁨': 'bad', 'bad': 'bad',
            '4': 'veryBad', '매우나쁨': 'veryBad', 'verybad': 'veryBad'
        };
        return map[normalized] || null;
    }

    function observationTimestamp(value) {
        if (!value) return null;
        var text = String(value).trim();
        var match = text.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})\D*(\d{2}):(\d{2})/);
        if (!match) return null;
        var timestamp = Date.parse(match[1] + '-' + match[2] + '-' + match[3]
            + 'T' + match[4] + ':' + match[5] + ':00+09:00');
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    /** AirKorea는 시간별 자료이므로 최신 지점보다 2시간 넘게 늦으면 현재 등급에서 제외한다. */
    function delayedObservation(station) {
        var latest = observationTimestamp(observationTime);
        var stationTime = observationTimestamp(station && station.dataTime);
        return latest !== null && stationTime !== null && latest - stationTime > 2 * 60 * 60 * 1000;
    }

    function fallbackGrade(pollutant, value) {
        if (value === null) return 'missing';
        var band = POLLUTANTS[pollutant].bands.find(function (candidate) {
            return candidate.cutoff === null || value <= candidate.cutoff;
        });
        return band ? band.key : 'veryBad';
    }

    function measurement(station, pollutant) {
        var config = POLLUTANTS[pollutant];
        var flagValue = station && station[config.flagKey];
        var flag = flagValue === null || flagValue === undefined ? '' : String(flagValue).trim();
        if (!flag && delayedObservation(station)) flag = '관측시각 지연';
        // 점검·교정·자료이상·통신장애 플래그가 있으면 수치가 함께 와도 등급 계산에 쓰지 않는다.
        var value = flag ? null : asFiniteNumber(station && station[config.valueKey]);
        var grade = value === null ? 'missing'
            : (normalizeOfficialGrade(station[config.gradeKey]) || fallbackGrade(pollutant, value));
        return {
            value: value,
            valueText: value === null ? '—' : String(Math.round(value)),
            grade: grade,
            gradeLabel: GRADE_INFO[grade].label,
            flag: flag
        };
    }

    function themeColors() {
        if (themeColorCache) return themeColorCache;
        var styles = getComputedStyle(document.documentElement);
        themeColorCache = {
            surface: styles.getPropertyValue('--surface-solid').trim() || '#111a2c',
            text: styles.getPropertyValue('--text').trim() || '#e6edf6',
            textMuted: styles.getPropertyValue('--text-2').trim() || '#9fb0c3'
        };
        return themeColorCache;
    }

    function compactStyle(grade) {
        var key = 'compact:' + grade;
        if (styleCache.has(key)) return styleCache.get(key);
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 7,
                fill: new ol.style.Fill({ color: COLORS[grade] }),
                stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.9)', width: 2 })
            })
        });
        styleCache.set(key, style);
        return style;
    }

    function detailStyle(valueText, grade) {
        var key = 'detail:' + grade + ':' + valueText;
        if (styleCache.has(key)) return styleCache.get(key);
        var theme = themeColors();
        var styles = [
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 18,
                    fill: new ol.style.Fill({ color: COLORS[grade] }),
                    stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.92)', width: 2.5 })
                }),
                text: new ol.style.Text({
                    text: valueText,
                    font: '800 11px system-ui, sans-serif',
                    fill: new ol.style.Fill({ color: grade === 'missing' ? '#f8fafc' : '#062033' })
                })
            }),
            new ol.style.Style({
                text: new ol.style.Text({
                    text: GRADE_INFO[grade].label,
                    font: '700 10px system-ui, sans-serif',
                    offsetY: 29,
                    padding: [2, 5, 2, 5],
                    fill: new ol.style.Fill({ color: theme.text }),
                    backgroundFill: new ol.style.Fill({ color: theme.surface }),
                    backgroundStroke: new ol.style.Stroke({ color: COLORS[grade], width: 1 })
                })
            })
        ];
        styleCache.set(key, styles);
        return styles;
    }

    function clusterStyle(count, grade) {
        // 농도값 마커와 한눈에 구분되도록 군집 수에는 항상 + 접두사를 붙인다.
        var countBucket = count > 99 ? '+99' : '+' + String(count);
        var key = 'cluster:' + grade + ':' + countBucket;
        if (styleCache.has(key)) return styleCache.get(key);
        var radius = count > 99 ? 22 : count > 20 ? 20 : 18;
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: radius,
                fill: new ol.style.Fill({ color: COLORS[grade] }),
                stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.94)', width: 3 })
            }),
            text: new ol.style.Text({
                text: countBucket,
                font: '800 11px system-ui, sans-serif',
                fill: new ol.style.Fill({ color: grade === 'missing' ? '#f8fafc' : '#062033' })
            })
        });
        styleCache.set(key, style);
        return style;
    }

    function featureMembers(feature) {
        var members = feature && feature.get('features');
        if (!Array.isArray(members)) return [];
        return members.filter(function (member) { return member.get('kind') === 'air-quality'; });
    }

    function styleFeature(feature) {
        if (mode === 'off') return null;
        var members = featureMembers(feature);
        if (!members.length) return null;
        var detailed = weatherMap.getView().getZoom() >= 8.7;
        if (members.length > 1) {
            var worst = 'missing';
            members.forEach(function (member) {
                var current = measurement(member.get('station'), mode).grade;
                if (GRADE_INFO[current].rank > GRADE_INFO[worst].rank) worst = current;
            });
            return clusterStyle(members.length, worst);
        }
        var result = measurement(members[0].get('station'), mode);
        return detailed ? detailStyle(result.valueText, result.grade) : compactStyle(result.grade);
    }

    function updateClusterDistance() {
        var detailed = weatherMap.getView().getZoom() >= 8.7;
        if (detailed === lastDetailedZoom) return;
        lastDetailedZoom = detailed;
        clusterSource.setDistance(detailed ? 1 : 44);
        clusterSource.setMinDistance(detailed ? 0 : 18);
        layer.changed();
    }

    function bindResolutionListener() {
        if (resolutionKey && ol.Observable && typeof ol.Observable.unByKey === 'function') {
            ol.Observable.unByKey(resolutionKey);
        }
        lastDetailedZoom = null;
        resolutionKey = weatherMap.getView().on('change:resolution', updateClusterDistance);
        updateClusterDistance();
    }

    function rebuildFeatures() {
        var projection = window.WEATHER_GRID_VIEW_PROJ || weatherMap.getView().getProjection().getCode();
        var features = [];
        rawStations.forEach(function (station) {
            var latitude = Number(station.latitude), longitude = Number(station.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
                    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.transform([longitude, latitude], 'EPSG:4326', projection)),
                kind: 'air-quality',
                station: station
            });
            features.push(feature);
        });
        rawSource.clear(true);
        rawSource.addFeatures(features);
        styleCache.clear();
        layer.changed();
    }

    function setPressedMode(nextMode) {
        controls.querySelectorAll('button[data-air]').forEach(function (button) {
            var selected = button.dataset.air === nextMode;
            button.classList.toggle('on', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function setStatus(kind, message, canRetry) {
        if (mode === 'off') {
            status.hidden = true;
            return;
        }
        status.hidden = false;
        status.dataset.state = kind;
        statusText.textContent = message;
        retryButton.hidden = !canRetry;
    }

    function formatObservationTime(value) {
        if (!value) return '관측시각 정보 없음';
        var text = String(value).trim();
        var match = text.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})\D*(\d{2}):(\d{2})/);
        if (!match) {
            var digits = text.replace(/\D/g, '');
            if (digits.length >= 12) {
                match = [digits, digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10), digits.slice(10, 12)];
            }
        }
        return match
            ? match[1] + '.' + match[2] + '.' + match[3] + ' ' + match[4] + ':' + match[5] + ' KST'
            : text + ' KST';
    }

    function gradeDistribution(pollutant) {
        var counts = { good: 0, moderate: 0, bad: 0, veryBad: 0, missing: 0 };
        var viewport = currentBbox();
        var visibleStations = viewport ? rawStations.filter(function (station) {
            var latitude = Number(station.latitude), longitude = Number(station.longitude);
            return Number.isFinite(latitude) && Number.isFinite(longitude)
                && latitude >= viewport.minLat && latitude <= viewport.maxLat
                && longitude >= viewport.minLon && longitude <= viewport.maxLon;
        }) : rawStations;
        visibleStations.forEach(function (station) {
            counts[measurement(station, pollutant).grade]++;
        });
        return { counts: counts, total: visibleStations.length };
    }

    /**
     * 공식 등급은 값의 폭이 서로 달라 선형 축으로 그리면 낮은 등급이 지나치게 좁아진다.
     * 네 등급을 같은 폭으로 두고, 선택 값은 해당 등급 안에서만 비례 배치한다.
     */
    function gaugePosition(pollutant, result) {
        if (!result || result.value === null || result.grade === 'missing') return null;
        var config = POLLUTANTS[pollutant];
        var ranges = config.bands;
        var index = ranges.findIndex(function (range) { return range.key === result.grade; });
        if (index < 0) return null;
        var min = index === 0 ? 0 : ranges[index - 1].cutoff;
        var max = ranges[index].cutoff === null ? config.gaugeMax : ranges[index].cutoff;
        var value = Math.min(Math.max(result.value, min), max);
        var local = max === min ? 0.5 : (value - min) / (max - min);
        // 마커가 트랙 가장자리에서 잘리지 않도록 각 구간 안쪽에 최소 여백을 둔다.
        local = Math.min(0.94, Math.max(0.06, local));
        return ((index + local) / ranges.length) * 100;
    }

    function renderGauge(host, pollutant, result) {
        if (!host) return;
        var config = POLLUTANTS[pollutant];
        var track = document.createElement('div');
        track.className = 'air_gauge_track';
        config.bands.forEach(function (range) {
            var segment = document.createElement('span');
            segment.className = 'air_gauge_segment';
            segment.dataset.grade = range.key;
            segment.style.backgroundColor = COLORS[range.key];
            segment.setAttribute('aria-hidden', 'true');
            track.appendChild(segment);
        });

        var position = gaugePosition(pollutant, result);
        if (position !== null) {
            var marker = document.createElement('span');
            marker.className = 'air_gauge_marker';
            marker.style.left = position.toFixed(2) + '%';
            marker.style.setProperty('--marker-color', COLORS[result.grade]);
            marker.setAttribute('aria-hidden', 'true');
            var value = document.createElement('span');
            value.className = 'air_gauge_value';
            value.textContent = result.valueText;
            marker.appendChild(value);
            track.appendChild(marker);
        }

        var labels = document.createElement('div');
        labels.className = 'air_gauge_labels';
        config.bands.forEach(function (range) {
            var label = document.createElement('span');
            label.textContent = GRADE_INFO[range.key].label;
            labels.appendChild(label);
        });

        var rangeText = config.bands.map(function (range) {
            return GRADE_INFO[range.key].label + ' ' + range.text;
        }).join(', ');
        if (result && result.value !== null) {
            var ariaValue = Math.min(config.gaugeMax, Math.max(0, result.value));
            host.setAttribute('role', 'meter');
            host.setAttribute('aria-valuemin', '0');
            host.setAttribute('aria-valuemax', String(config.gaugeMax));
            host.setAttribute('aria-valuenow', String(ariaValue));
            host.setAttribute('aria-valuetext', config.label + ' ' + result.valueText + '㎍/㎥, ' + result.gradeLabel);
        } else {
            host.setAttribute('role', 'img');
            host.removeAttribute('aria-valuemin');
            host.removeAttribute('aria-valuemax');
            host.removeAttribute('aria-valuenow');
            host.removeAttribute('aria-valuetext');
        }
        host.setAttribute('aria-label', config.label + ' 등급 구간. ' + rangeText);
        host.replaceChildren(track, labels);
    }

    function renderLegend() {
        if (mode === 'off') return;
        var pollutant = POLLUTANTS[mode];
        legendTitle.textContent = pollutant.label + ' 등급';
        legend.setAttribute('aria-label', pollutant.label + ' 미세먼지 등급 범례');
        if (legendToggle) {
            legendToggle.textContent = pollutant.label + ' 범례';
            legendToggle.setAttribute('aria-label', pollutant.label + ' 범례 접기');
        }
        renderGauge(legendGauge, mode, null);
        var distribution = gradeDistribution(mode);
        var fragment = document.createDocumentFragment();
        var legendRanges = pollutant.bands.slice().reverse().concat([{ key: 'missing', text: '결측' }]);
        legendRanges.forEach(function (range) {
            var row = document.createElement('div');
            row.className = 'air_legend_row';
            row.setAttribute('role', 'listitem');
            var count = distribution.counts[range.key] || 0;
            var share = distribution.total ? count / distribution.total * 100 : 0;
            row.setAttribute('aria-label', GRADE_INFO[range.key].label + ' ' + range.text
                + ', 현재 화면 측정소 ' + count + '곳, ' + Math.round(share) + '%');
            var head = document.createElement('div');
            head.className = 'air_legend_row_head';
            var swatch = document.createElement('i');
            swatch.style.backgroundColor = COLORS[range.key];
            swatch.setAttribute('aria-hidden', 'true');
            var label = document.createElement('strong');
            label.textContent = GRADE_INFO[range.key].label;
            var threshold = document.createElement('span');
            threshold.textContent = range.text;
            var countLabel = document.createElement('output');
            countLabel.className = 'air_legend_count';
            countLabel.textContent = distribution.total ? Math.round(share) + '%' : '—';
            var bar = document.createElement('span');
            bar.className = 'air_legend_distribution';
            bar.setAttribute('aria-hidden', 'true');
            var fill = document.createElement('span');
            fill.style.width = share.toFixed(2) + '%';
            fill.style.backgroundColor = COLORS[range.key];
            bar.appendChild(fill);
            head.appendChild(swatch);
            head.appendChild(label);
            head.appendChild(threshold);
            head.appendChild(countLabel);
            row.appendChild(head);
            row.appendChild(bar);
            fragment.appendChild(row);
        });
        legendRows.replaceChildren(fragment);
        var timeLabel = observationTimeFrom && observationTimeFrom !== observationTime
            ? formatObservationTime(observationTimeFrom) + ' – ' + formatObservationTime(observationTime)
            : formatObservationTime(observationTime);
        legendTime.textContent = (stale ? '캐시 자료 · 지점별 ' : '지점별 관측 · ') + timeLabel;
    }

    function setLegendCollapsed(collapsed) {
        legend.classList.toggle('legend-collapsed', collapsed);
        if (!legendToggle || mode === 'off') return;
        legendToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        legendToggle.setAttribute('aria-label', POLLUTANTS[mode].label
            + (collapsed ? ' 범례 펼치기' : ' 범례 접기'));
    }

    function currentBbox() {
        var view = weatherMap.getView();
        var extent = view.calculateExtent(weatherMap.getSize());
        var transformed = ol.proj.transformExtent(extent, view.getProjection(), 'EPSG:4326', 16);
        var box = {
            minLon: Math.max(API_BOUNDS.minLon, transformed[0]),
            minLat: Math.max(API_BOUNDS.minLat, transformed[1]),
            maxLon: Math.min(API_BOUNDS.maxLon, transformed[2]),
            maxLat: Math.min(API_BOUNDS.maxLat, transformed[3])
        };
        return box.minLon < box.maxLon && box.minLat < box.maxLat ? box : null;
    }

    function expandedBbox(box) {
        var lonPadding = Math.max((box.maxLon - box.minLon) * 0.18, 0.12);
        var latPadding = Math.max((box.maxLat - box.minLat) * 0.18, 0.12);
        return {
            minLon: Math.max(API_BOUNDS.minLon, box.minLon - lonPadding),
            minLat: Math.max(API_BOUNDS.minLat, box.minLat - latPadding),
            maxLon: Math.min(API_BOUNDS.maxLon, box.maxLon + lonPadding),
            maxLat: Math.min(API_BOUNDS.maxLat, box.maxLat + latPadding)
        };
    }

    function contains(outer, inner) {
        return !!outer && outer.minLon <= inner.minLon && outer.minLat <= inner.minLat
            && outer.maxLon >= inner.maxLon && outer.maxLat >= inner.maxLat;
    }

    function bboxSignature(box) {
        return [box.minLat, box.maxLat, box.minLon, box.maxLon]
            .map(function (value) { return value.toFixed(2); }).join(':');
    }

    function cancelActiveRequest(invalidate) {
        if (invalidate) requestSequence++;
        if (activeRequest) {
            clearTimeout(activeRequest.timeoutId);
            activeRequest.controller.abort();
            activeRequest = null;
        }
        inFlightSignature = '';
    }

    async function fetchStations(force) {
        if (mode === 'off') return;
        var viewport = currentBbox();
        if (!viewport) {
            clearTimeout(moveTimer);
            cancelActiveRequest(true);
            rawStations = [];
            loadedCoverage = null;
            rebuildFeatures();
            setStatus('ready', '현재 화면은 대기질 측정소 지원 범위 밖입니다.', false);
            return;
        }
        var freshEnough = Date.now() - lastFetchedAt < 5 * 60 * 1000;
        if (!force && freshEnough && contains(loadedCoverage, viewport)) {
            renderLegend();
            setStatus(stale ? 'stale' : 'ready', rawStations.length
                ? (stale ? '캐시 자료 · ' : '') + '측정소 ' + rawSource.getFeatures().length + '곳 · '
                    + formatObservationTime(observationTime)
                : '현재 화면에 표시할 대기질 측정소가 없습니다.', false);
            return;
        }

        var requested = expandedBbox(viewport);
        var signature = bboxSignature(requested);
        if (!force && signature === inFlightSignature) return;
        cancelActiveRequest(false);

        var controller = new AbortController();
        inFlightSignature = signature;
        var sequence = ++requestSequence;
        var request = {
            controller: controller,
            sequence: sequence,
            timeoutId: null,
            timedOut: false
        };
        activeRequest = request;
        setStatus('loading', rawStations.length ? '새 관측자료를 확인하는 중…' : '대기질 측정소를 불러오는 중…', false);

        var query = new URLSearchParams({
            minLat: requested.minLat.toFixed(5),
            maxLat: requested.maxLat.toFixed(5),
            minLon: requested.minLon.toFixed(5),
            maxLon: requested.maxLon.toFixed(5)
        });

        try {
            var timeoutPromise = new Promise(function (resolve, reject) {
                request.timeoutId = setTimeout(function () {
                    request.timedOut = true;
                    controller.abort();
                    var timeoutError = new Error('REQUEST_TIMEOUT');
                    timeoutError.name = 'TimeoutError';
                    reject(timeoutError);
                }, REQUEST_TIMEOUT_MS);
            });
            var response = await Promise.race([
                fetch(apiUrl('/api/environment/air-quality?' + query.toString()), {
                    headers: { Accept: 'application/json' }, signal: controller.signal
                }),
                timeoutPromise
            ]);
            if (!response.ok) throw new Error(response.status === 503 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_FAILED');
            var payload = await response.json();
            var stations = Array.isArray(payload) ? payload
                : payload && Array.isArray(payload.stations) ? payload.stations
                    : payload && Array.isArray(payload.items) ? payload.items : [];
            if (sequence !== requestSequence) return;

            rawStations = stations;
            loadedCoverage = requested;
            lastFetchedAt = Date.now();
            observationTime = payload && payload.dataTime ? String(payload.dataTime)
                : String(stations.reduce(function (latest, station) {
                    var candidate = station && station.dataTime ? String(station.dataTime) : '';
                    return candidate > latest ? candidate : latest;
                }, ''));
            observationTimeFrom = payload && payload.dataTimeFrom ? String(payload.dataTimeFrom)
                : String(stations.reduce(function (earliest, station) {
                    var candidate = station && station.dataTime ? String(station.dataTime) : '';
                    return !candidate ? earliest : (!earliest || candidate < earliest ? candidate : earliest);
                }, ''));
            stale = !!(payload && payload.stale);
            rebuildFeatures();
            renderLegend();
            setStatus(stale ? 'stale' : 'ready', stations.length
                ? (stale ? '캐시 자료 · ' : '') + '측정소 ' + rawSource.getFeatures().length + '곳 · '
                    + formatObservationTime(observationTime)
                : '현재 화면에 표시할 대기질 측정소가 없습니다.', false);
        } catch (error) {
            if (error && error.name === 'AbortError' && !request.timedOut) return;
            if (sequence !== requestSequence) return;
            var message = request.timedOut
                ? (rawStations.length
                    ? '새 자료 확인 시간이 초과돼 이전 관측을 유지합니다.'
                    : '대기질 요청 시간이 초과됐습니다. 다시 시도해 주세요.')
                : (rawStations.length
                    ? '새 자료 갱신에 실패해 이전 관측을 유지합니다.'
                    : '대기질 자료를 불러오지 못했습니다. 기상 지도는 계속 사용할 수 있습니다.');
            setStatus('error', message, true);
            if (window.WEATHER_GRID_SHOW_NOTICE) window.WEATHER_GRID_SHOW_NOTICE(message);
        } finally {
            clearTimeout(request.timeoutId);
            if (sequence === requestSequence && activeRequest === request) {
                activeRequest = null;
                inFlightSignature = '';
            }
        }
    }

    function scheduleFetch(force) {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(function () { fetchStations(!!force); }, force ? 0 : 240);
    }

    function retryFetch() {
        clearTimeout(moveTimer);
        cancelActiveRequest(true);
        scheduleFetch(true);
    }

    function closePopup(restoreMapFocus) {
        if (popup.hidden) return;
        popup.hidden = true;
        if (restoreMapFocus) {
            var mapElement = document.getElementById('map');
            if (mapElement) mapElement.focus({ preventScroll: true });
        }
    }

    function setPopupText(id, value, fallback) {
        var element = document.getElementById(id);
        if (element) element.textContent = value === null || value === undefined || value === ''
            ? (fallback || '—') : String(value);
    }

    function positionPopup(pixel) {
        var runtime = window.WeatherGridMapRuntime;
        if (!runtime || typeof runtime.positionOverlayPopup !== 'function') return;
        popup.hidden = false;
        popup.style.left = '8px';
        popup.style.top = '8px';
        popup.style.maxHeight = '';
        requestAnimationFrame(function () {
            if (!popup.hidden) runtime.positionOverlayPopup(popup, pixel);
        });
    }

    function openPopup(station, pixel) {
        var result = measurement(station, mode);
        var pollutant = POLLUTANTS[mode];
        setPopupText('air_popup_eyebrow', stale ? 'AIRKOREA · 캐시 관측' : 'AIRKOREA · 최신 관측');
        setPopupText('air_popup_title', station.name, '이름 없는 측정소');
        setPopupText('air_popup_pollutant', pollutant.label);
        setPopupText('air_popup_value', result.valueText);
        setPopupText('air_popup_grade', result.gradeLabel);
        setPopupText('air_popup_time', formatObservationTime(station.dataTime || observationTime));
        setPopupText('air_popup_address', station.address);
        setPopupText('air_popup_network', station.network);
        setPopupText('air_popup_flag', result.flag);
        var flagRow = document.getElementById('air_popup_flag_row');
        if (flagRow) flagRow.hidden = !result.flag;
        var gradeBadge = document.getElementById('air_popup_grade');
        if (gradeBadge) {
            gradeBadge.dataset.grade = result.grade;
            gradeBadge.style.setProperty('--grade-color', COLORS[result.grade]);
        }
        renderGauge(popupGaugePm10, 'pm10', measurement(station, 'pm10'));
        renderGauge(popupGaugePm25, 'pm25', measurement(station, 'pm25'));
        popup.querySelectorAll('.air_popup_gauge_row').forEach(function (row) {
            row.classList.toggle('is-current', row.dataset.pollutant === mode);
        });
        positionPopup(pixel);
    }

    function openMapFeature(airFeature, pixel, focusPopup) {
        if (mode === 'off' || !airFeature) return;
        var members = featureMembers(airFeature);
        if (!members.length) return;
        if (members.length > 1) {
            closePopup(false);
            var extent = ol.extent.createEmpty();
            members.forEach(function (member) { ol.extent.extend(extent, member.getGeometry().getExtent()); });
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (ol.extent.getWidth(extent) === 0 && ol.extent.getHeight(extent) === 0) {
                weatherMap.getView().animate({ center: ol.extent.getCenter(extent), zoom: weatherMap.getView().getZoom() + 1, duration: reduced ? 0 : 220 });
            } else {
                weatherMap.getView().fit(extent, {
                    padding: typeof initialViewPadding === 'function'
                        ? initialViewPadding()
                        : (window.innerWidth <= 640 ? [64, 16, 96, 16] : [84, 160, 92, 292]),
                    maxZoom: weatherMap.getView().getZoom() + 2,
                    duration: reduced ? 0 : 240
                });
            }
            return;
        }
        openPopup(members[0].get('station'), pixel);
        if (focusPopup) popup.focus({ preventScroll: true });
    }

    /** 캔버스 마커를 직접 탭할 수 없는 키보드 사용자를 위한 중심점 기반 선택 경로. */
    function nearestVisibleStation() {
        var size = weatherMap.getSize();
        var center = weatherMap.getView().getCenter();
        if (!size || !center) return null;
        var extent = weatherMap.getView().calculateExtent(size);
        var nearest = null;
        var nearestCoordinate = null;
        var nearestDistance = Infinity;
        rawSource.forEachFeatureInExtent(extent, function (feature) {
            var coordinate = feature.getGeometry().getCoordinates();
            var dx = coordinate[0] - center[0], dy = coordinate[1] - center[1];
            var distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearest = feature;
                nearestCoordinate = coordinate;
                nearestDistance = distance;
            }
        });
        if (!nearest) {
            setStatus('ready', '현재 화면에 선택할 대기질 측정소가 없습니다.', false);
            return null;
        }
        return {
            distance: nearestDistance,
            activate: function (focusPopup) {
                openPopup(nearest.get('station'), weatherMap.getPixelFromCoordinate(nearestCoordinate));
                if (focusPopup) popup.focus({ preventScroll: true });
            }
        };
    }

    function openNearestVisibleStation() {
        var candidate = nearestVisibleStation();
        if (candidate) candidate.activate(true);
    }

    function setMode(nextMode) {
        if (!POLLUTANTS[nextMode] && nextMode !== 'off') return;
        // 최신 관측 마커와 CCTV 군집을 동시에 띄우면 지도 해석이 어려워진다.
        if (nextMode !== 'off' && window.WEATHER_GRID_CCTV && window.WEATHER_GRID_CCTV.isEnabled
                && window.WEATHER_GRID_CCTV.isEnabled()) window.WEATHER_GRID_CCTV.setEnabled(false);
        mode = nextMode;
        setPressedMode(mode);
        closePopup(false);
        styleCache.clear();
        if (typeof window.WEATHER_GRID_UPDATE_HASH === 'function') window.WEATHER_GRID_UPDATE_HASH();
        if (mode === 'off') {
            layer.setVisible(false);
            legend.hidden = true;
            status.hidden = true;
            clearTimeout(moveTimer);
            cancelActiveRequest(true);
            document.dispatchEvent(new CustomEvent('weather-grid:environment-changed', { detail: { type: 'air', mode: mode } }));
            return;
        }

        layer.setVisible(true);
        legend.hidden = false;
        renderLegend();
        setLegendCollapsed(!!(mobileLegendQuery && mobileLegendQuery.matches));
        layer.changed();
        if (rawStations.length) {
            setStatus(stale ? 'stale' : 'ready', (stale ? '캐시 자료 · ' : '')
                + '측정소 ' + rawSource.getFeatures().length + '곳 · ' + formatObservationTime(observationTime), false);
        }
        scheduleFetch(false);
        document.dispatchEvent(new CustomEvent('weather-grid:environment-changed', { detail: { type: 'air', mode: mode } }));
    }

    controls.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-air]');
        if (!button || button.dataset.air === mode) return;
        setMode(button.dataset.air);
    });
    retryButton.addEventListener('click', retryFetch);
    popupClose.addEventListener('click', function () { closePopup(true); });
    if (window.WEATHER_GRID_OVERLAY_ROUTER) {
        window.WEATHER_GRID_OVERLAY_ROUTER.register('air-quality', {
            enabled: function () { return mode !== 'off'; },
            openFeature: openMapFeature,
            nearest: nearestVisibleStation,
            close: closePopup
        });
    } else {
        weatherMap.on('singleclick', function (event) {
            if (mode === 'off') return;
            var airFeature = weatherMap.forEachFeatureAtPixel(event.pixel, function (feature) {
                return featureMembers(feature).length ? feature : null;
            }, { hitTolerance: 6 });
            if (airFeature) openMapFeature(airFeature, event.pixel, false);
            else closePopup(false);
        });
        var mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.addEventListener('keydown', function (event) {
                if (mode !== 'off' && event.key === 'Enter') {
                    event.preventDefault();
                    openNearestVisibleStation();
                }
            });
        }
    }
    weatherMap.on('moveend', function () {
        closePopup(false);
        if (mode !== 'off') scheduleFetch(false);
    });

    if (legendToggle) {
        legendToggle.addEventListener('click', function () {
            setLegendCollapsed(!legend.classList.contains('legend-collapsed'));
        });
    }
    if (mobileLegendQuery) {
        mobileLegendQuery.addEventListener('change', function (event) {
            if (mode !== 'off') setLegendCollapsed(event.matches);
        });
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !popup.hidden) {
            event.preventDefault();
            closePopup(true);
        }
    });
    document.addEventListener('weather-grid:projection-changed', function () {
        closePopup(false);
        rebuildFeatures();
        bindResolutionListener();
        if (mode !== 'off') scheduleFetch(false);
    });
    new MutationObserver(function () {
        themeColorCache = null;
        styleCache.clear();
        layer.changed();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    bindResolutionListener();
    window.WEATHER_GRID_AIR_QUALITY = {
        setMode: setMode,
        retry: retryFetch,
        getMode: function () { return mode; },
        layer: layer
    };
})();
