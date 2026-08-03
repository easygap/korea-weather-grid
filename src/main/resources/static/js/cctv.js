/**
 * 국가교통정보센터(ITS) 도로 CCTV 오버레이.
 *
 * 화면 bbox 메타데이터만 먼저 받고, 스트림은 사용자가 지점을 고른 뒤 재생을
 * 명시했을 때 연결한다. Chrome 계열은 self-hosted hls.js light를 그 시점에만
 * 불러오며 팝업·이동·레이어 종료 시 HLS와 video 리소스를 즉시 해제한다.
 */
(function () {
    'use strict';

    var toggle = document.getElementById('cctv_toggle');
    var status = document.getElementById('cctv_status');
    var statusText = document.getElementById('cctv_status_text');
    var retryButton = document.getElementById('cctv_retry');
    var popup = document.getElementById('cctv_popup');
    var popupClose = document.getElementById('cctv_popup_close');
    var clusterPicker = document.getElementById('cctv_cluster_picker');
    var clusterList = document.getElementById('cctv_cluster_list');
    var media = document.getElementById('cctv_media');
    var mediaPlaceholder = document.getElementById('cctv_media_placeholder');
    var mediaStatus = document.getElementById('cctv_media_status');
    var playButton = document.getElementById('cctv_play');
    var video = document.getElementById('cctv_video');
    var popupMeta = document.getElementById('cctv_popup_meta');
    var popupSource = document.getElementById('cctv_popup_source');
    if (!toggle || !status || !statusText || !retryButton || !popup || !popupClose
            || !clusterPicker || !clusterList || !media || !mediaPlaceholder || !mediaStatus
            || !playButton || !video || !popupMeta || !popupSource
            || typeof ol === 'undefined' || typeof weatherMap === 'undefined') return;

    var API_BOUNDS = { minLat: 32, maxLat: 44, minLon: 122, maxLon: 134 };
    var STREAM_HOST = 'cctvsec.ktict.co.kr';
    var MIN_ZOOM = 9;
    var TILE_SIZE = 0.25;
    var MAX_TILES = 24;
    var MAX_ITEMS = 1000;
    var MAX_CLUSTER_CHOICES = 100;
    var FRESH_MS = 45 * 1000;
    var HLS_ASSET = '/static/vendor/hls.light.min.js?v=1.6.16';
    var LIST_REQUEST_TIMEOUT_MS = 12000;
    var HLS_LIBRARY_TIMEOUT_MS = 8000;
    var PLAYBACK_TIMEOUT_MS = 12000;

    var enabled = false;
    var rawCctvs = [];
    var loadedCoverage = null;
    var lastFetchedAt = 0;
    var fetchedAt = '';
    var sourceName = '국가교통정보센터';
    var stale = false;
    var truncated = false;
    var activeRequest = null;
    var requestSequence = 0;
    var inFlightSignature = '';
    var moveTimer = null;
    var resolutionKey = null;
    var lastDetailedZoom = null;
    var styleCache = new Map();
    var activeCctv = null;
    var activeHls = null;
    var hlsLoaderPromise = null;
    var hlsLoaderCancel = null;
    var mediaGeneration = 0;
    var mediaTimeout = null;
    var lastMapNotice = '';

    var rawSource = new ol.source.Vector();
    var clusterSource = new ol.source.Cluster({
        distance: 46,
        minDistance: 18,
        source: rawSource
    });
    var layer = new ol.layer.Vector({
        title: 'cctv',
        source: clusterSource,
        visible: false,
        declutter: true,
        zIndex: 114,
        style: styleFeature
    });
    weatherMap.addLayer(layer);

    function boundedText(value, fallback, maxLength) {
        if (value === null || value === undefined) return fallback || '';
        var text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text) return fallback || '';
        return text.slice(0, maxLength || 120);
    }

    function safeStreamUrl(value) {
        if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value
                || /[\u0000-\u001f\u007f]/.test(value)) return '';
        try {
            var parsed = new URL(value);
            if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== STREAM_HOST
                    || (parsed.port && parsed.port !== '443') || parsed.username || parsed.password
                    || parsed.search || parsed.hash || parsed.pathname === '/') return '';
            return parsed.href;
        } catch (error) {
            return '';
        }
    }

    function normalizeCctv(item, index) {
        if (!item || typeof item !== 'object') return null;
        var latitude = Number(item.latitude);
        var longitude = Number(item.longitude);
        var streamUrl = safeStreamUrl(item.streamUrl);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
                || latitude < API_BOUNDS.minLat || latitude > API_BOUNDS.maxLat
                || longitude < API_BOUNDS.minLon || longitude > API_BOUNDS.maxLon
                || item.format !== 'HLS' || !streamUrl) return null;
        var roadSectionId = boundedText(item.roadSectionId, '', 100);
        return {
            id: boundedText(item.id, roadSectionId || ('cctv-' + index), 120),
            name: boundedText(item.name, '이름 없는 CCTV', 100),
            latitude: latitude,
            longitude: longitude,
            streamUrl: streamUrl,
            format: boundedText(item.format, 'HLS', 24),
            resolution: boundedText(item.resolution, '', 32),
            fileCreatedAt: boundedText(item.fileCreatedAt, '', 40),
            roadSectionId: roadSectionId
        };
    }

    function markerStyle(name) {
        var detailed = weatherMap.getView().getZoom() >= 10.8;
        var label = detailed ? boundedText(name, 'CCTV', 16) : '';
        var key = 'marker:' + label;
        if (styleCache.has(key)) return styleCache.get(key);
        var styles = [new ol.style.Style({
            image: new ol.style.Circle({
                radius: 15,
                fill: new ol.style.Fill({ color: 'rgba(7,16,29,.94)' }),
                stroke: new ol.style.Stroke({ color: '#7dd3fc', width: 2.5 })
            }),
            text: new ol.style.Text({
                text: 'CAM',
                font: '800 7px system-ui, sans-serif',
                fill: new ol.style.Fill({ color: '#bae6fd' })
            })
        })];
        if (label) {
            styles.push(new ol.style.Style({
                text: new ol.style.Text({
                    text: label,
                    font: '700 10px system-ui, sans-serif',
                    offsetY: 26,
                    padding: [3, 6, 3, 6],
                    fill: new ol.style.Fill({ color: '#e6edf6' }),
                    backgroundFill: new ol.style.Fill({ color: 'rgba(7,16,29,.9)' }),
                    backgroundStroke: new ol.style.Stroke({ color: 'rgba(125,211,252,.55)', width: 1 })
                })
            }));
        }
        styleCache.set(key, styles);
        return styles;
    }

    function clusterStyle(count) {
        var countText = count > 99 ? '99+' : String(count);
        var key = 'cluster:' + countText;
        if (styleCache.has(key)) return styleCache.get(key);
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: count > 99 ? 22 : count > 20 ? 20 : 18,
                fill: new ol.style.Fill({ color: '#0ea5e9' }),
                stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,.94)', width: 3 })
            }),
            text: new ol.style.Text({
                text: countText,
                font: '800 11px system-ui, sans-serif',
                fill: new ol.style.Fill({ color: '#062033' })
            })
        });
        styleCache.set(key, style);
        return style;
    }

    function featureMembers(feature) {
        var members = feature && feature.get('features');
        if (!Array.isArray(members)) return [];
        return members.filter(function (member) { return member.get('kind') === 'cctv'; });
    }

    function styleFeature(feature) {
        if (!enabled) return null;
        var members = featureMembers(feature);
        if (!members.length) return null;
        if (members.length > 1) return clusterStyle(members.length);
        return markerStyle(members[0].get('cctv').name);
    }

    function updateClusterDistance() {
        var detailed = weatherMap.getView().getZoom() >= 10.8;
        if (detailed === lastDetailedZoom) return;
        lastDetailedZoom = detailed;
        clusterSource.setDistance(detailed ? 10 : 46);
        clusterSource.setMinDistance(detailed ? 4 : 18);
        styleCache.clear();
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
        var features = rawCctvs.map(function (cctv) {
            return new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.transform(
                    [cctv.longitude, cctv.latitude], 'EPSG:4326', projection)),
                kind: 'cctv',
                cctv: cctv
            });
        });
        rawSource.clear(true);
        rawSource.addFeatures(features);
        styleCache.clear();
        layer.changed();
    }

    function clearCctvs() {
        rawCctvs = [];
        loadedCoverage = null;
        lastFetchedAt = 0;
        fetchedAt = '';
        rawSource.clear(true);
        styleCache.clear();
        layer.changed();
    }

    function setStatus(kind, message, canRetry) {
        if (!enabled) {
            status.hidden = true;
            return;
        }
        status.hidden = false;
        status.dataset.state = kind;
        statusText.textContent = message;
        retryButton.hidden = !canRetry;
        if ((kind === 'error' || kind === 'zoom') && message !== lastMapNotice && window.WEATHER_GRID_SHOW_NOTICE) {
            lastMapNotice = message;
            window.WEATHER_GRID_SHOW_NOTICE({
                message: message,
                actionLabel: kind === 'zoom' ? '지역 확대' : '다시 시도',
                duration: 7000,
                onAction: kind === 'zoom' ? function () {
                    var view = weatherMap.getView();
                    var targetZoom = Math.min(view.getMaxZoom(), Math.max(MIN_ZOOM + 0.3, view.getZoom()));
                    view.animate({ zoom: targetZoom, duration: 320 });
                } : retryFetch
            });
        } else if (kind === 'ready' || kind === 'stale') lastMapNotice = '';
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

    function alignedRequest(viewport) {
        var factor = 1 / TILE_SIZE;
        var box = {
            minLat: Math.floor(viewport.minLat * factor) / factor,
            maxLat: Math.ceil(viewport.maxLat * factor) / factor,
            minLon: Math.floor(viewport.minLon * factor) / factor,
            maxLon: Math.ceil(viewport.maxLon * factor) / factor
        };
        box.minLat = Math.max(API_BOUNDS.minLat, box.minLat);
        box.maxLat = Math.min(API_BOUNDS.maxLat, box.maxLat);
        box.minLon = Math.max(API_BOUNDS.minLon, box.minLon);
        box.maxLon = Math.min(API_BOUNDS.maxLon, box.maxLon);
        var latTiles = Math.round((box.maxLat - box.minLat) * factor);
        var lonTiles = Math.round((box.maxLon - box.minLon) * factor);
        return { box: box, tileCount: latTiles * lonTiles };
    }

    function contains(outer, inner) {
        return !!outer && outer.minLon <= inner.minLon && outer.minLat <= inner.minLat
            && outer.maxLon >= inner.maxLon && outer.maxLat >= inner.maxLat;
    }

    function bboxSignature(box) {
        return [box.minLat, box.maxLat, box.minLon, box.maxLon]
            .map(function (value) { return value.toFixed(2); }).join(':');
    }

    function cancelListRequest(invalidate) {
        if (invalidate) requestSequence++;
        if (activeRequest) {
            clearTimeout(activeRequest.timeoutId);
            activeRequest.controller.abort();
            activeRequest = null;
        }
        inFlightSignature = '';
    }

    function abortRequest() {
        clearTimeout(moveTimer);
        cancelListRequest(true);
    }

    function formatTime(value) {
        if (!value) return '시각 정보 없음';
        var text = boundedText(value, '', 40);
        if (/T/.test(text) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
            var instant = new Date(text);
            if (Number.isFinite(instant.getTime())) {
                try {
                    var parts = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
                    }).formatToParts(instant).reduce(function (result, part) {
                        if (part.type !== 'literal') result[part.type] = part.value;
                        return result;
                    }, {});
                    return parts.year + '.' + parts.month + '.' + parts.day + ' '
                        + parts.hour + ':' + parts.minute + ' KST';
                } catch (error) { /* Intl 미지원 환경은 아래 고정 오프셋 폴백 사용 */ }
                var kst = new Date(instant.getTime() + 9 * 3600 * 1000);
                var pad = function (number) { return String(number).padStart(2, '0'); };
                return kst.getUTCFullYear() + '.' + pad(kst.getUTCMonth() + 1) + '.'
                    + pad(kst.getUTCDate()) + ' ' + pad(kst.getUTCHours()) + ':'
                    + pad(kst.getUTCMinutes()) + ' KST';
            }
        }
        var match = text.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})\D*(\d{2}):?(\d{2})?/);
        return match ? match[1] + '.' + match[2] + '.' + match[3] + ' ' + match[4]
            + ':' + (match[5] || '00') + ' KST' : text;
    }

    function readyMessage() {
        if (!rawCctvs.length) return '현재 화면에 표시할 CCTV가 없습니다.';
        return (stale ? '캐시 자료 · ' : '') + 'CCTV ' + rawSource.getFeatures().length + '곳'
            + (truncated ? ' · 일부 결과' : '') + (fetchedAt ? ' · ' + formatTime(fetchedAt) : '');
    }

    async function fetchCctvs(force) {
        if (!enabled) return;
        var zoom = weatherMap.getView().getZoom();
        var viewport = currentBbox();
        if (!viewport) {
            abortRequest();
            clearCctvs();
            setStatus('zoom', '현재 화면은 CCTV 지원 범위 밖입니다.', false);
            return;
        }
        var request = alignedRequest(viewport);
        if (zoom < MIN_ZOOM || request.tileCount > MAX_TILES) {
            abortRequest();
            clearCctvs();
            setStatus('zoom', '도로 CCTV를 보려면 지도를 조금 더 확대해 주세요.', false);
            return;
        }
        if (!force && Date.now() - lastFetchedAt < FRESH_MS && contains(loadedCoverage, viewport)) {
            setStatus(stale ? 'stale' : 'ready', readyMessage(), false);
            return;
        }

        var signature = bboxSignature(request.box);
        if (!force && signature === inFlightSignature) return;
        cancelListRequest(false);
        var controller = new AbortController();
        inFlightSignature = signature;
        var sequence = ++requestSequence;
        var listRequest = {
            controller: controller,
            sequence: sequence,
            timeoutId: null,
            timedOut: false
        };
        activeRequest = listRequest;
        setStatus('loading', rawCctvs.length ? '새 CCTV 정보를 확인하는 중…' : '도로 CCTV를 불러오는 중…', false);

        var query = new URLSearchParams({
            minLat: request.box.minLat.toFixed(5),
            maxLat: request.box.maxLat.toFixed(5),
            minLon: request.box.minLon.toFixed(5),
            maxLon: request.box.maxLon.toFixed(5)
        });
        try {
            var timeoutPromise = new Promise(function (resolve, reject) {
                listRequest.timeoutId = setTimeout(function () {
                    listRequest.timedOut = true;
                    controller.abort();
                    var timeoutError = new Error('REQUEST_TIMEOUT');
                    timeoutError.name = 'TimeoutError';
                    reject(timeoutError);
                }, LIST_REQUEST_TIMEOUT_MS);
            });
            var response = await Promise.race([
                fetch(apiUrl('/api/traffic/cameras?' + query.toString()), {
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin',
                    cache: 'no-store',
                    signal: controller.signal
                }),
                timeoutPromise
            ]);
            if (!response.ok) {
                var error = new Error(response.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED');
                error.status = response.status;
                throw error;
            }
            var payload = await response.json();
            if (!payload || !Array.isArray(payload.cctvs)) throw new Error('INVALID_RESPONSE');
            if (sequence !== requestSequence || !enabled) return;
            var normalized = payload.cctvs.slice(0, MAX_ITEMS).map(normalizeCctv).filter(Boolean);
            rawCctvs = normalized;
            loadedCoverage = request.box;
            lastFetchedAt = Date.now();
            fetchedAt = boundedText(payload.fetchedAt, '', 40);
            stale = !!payload.stale;
            truncated = !!payload.truncated || payload.cctvs.length > MAX_ITEMS;
            sourceName = boundedText(payload.source, '국가교통정보센터', 80);
            rebuildFeatures();
            setStatus(stale ? 'stale' : 'ready', readyMessage(), false);
        } catch (error) {
            if (error && error.name === 'AbortError' && !listRequest.timedOut) return;
            if (sequence !== requestSequence || !enabled) return;
            var message = listRequest.timedOut
                ? (rawCctvs.length
                    ? '새 CCTV 정보 확인 시간이 초과돼 이전 위치를 유지합니다.'
                    : 'CCTV 요청 시간이 초과됐습니다. 다시 시도해 주세요.')
                : (rawCctvs.length
                    ? '새 자료 갱신에 실패해 이전 CCTV 위치를 유지합니다.'
                    : (error && error.status === 429
                        ? '요청이 많습니다. 잠시 뒤 다시 시도해 주세요.'
                        : (error && error.status === 503
                            ? 'ITS CCTV 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
                            : 'CCTV 정보를 불러오지 못했습니다. 기상 지도는 계속 사용할 수 있습니다.')));
            setStatus('error', message, true);
        } finally {
            clearTimeout(listRequest.timeoutId);
            if (sequence === requestSequence && activeRequest === listRequest) {
                activeRequest = null;
                inFlightSignature = '';
            }
        }
    }

    function scheduleFetch(force) {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(function () { fetchCctvs(!!force); }, force ? 0 : 280);
    }

    function retryFetch() {
        abortRequest();
        scheduleFetch(true);
    }

    function clearMediaTimeout() {
        clearTimeout(mediaTimeout);
        mediaTimeout = null;
    }

    function armMediaTimeout(generation) {
        clearMediaTimeout();
        mediaTimeout = setTimeout(function () {
            mediaTimeout = null;
            if (generation === mediaGeneration && !popup.hidden) {
                playbackError('영상 연결 시간이 초과됐습니다. 다시 시도해 주세요.');
            }
        }, PLAYBACK_TIMEOUT_MS);
    }

    function cancelHlsLibraryLoad() {
        if (hlsLoaderCancel) hlsLoaderCancel();
    }

    function stopPlayback() {
        mediaGeneration++;
        clearMediaTimeout();
        cancelHlsLibraryLoad();
        if (activeHls) {
            activeHls.destroy();
            activeHls = null;
        }
        try { video.pause(); } catch (error) { /* 이미 해제된 media는 무해 */ }
        video.removeAttribute('src');
        try { video.load(); } catch (error) { /* 이미 해제된 media는 무해 */ }
    }

    function resetMedia() {
        stopPlayback();
        media.dataset.state = 'idle';
        mediaPlaceholder.hidden = false;
        video.hidden = true;
        mediaStatus.hidden = true;
        mediaStatus.textContent = '';
        playButton.disabled = false;
        playButton.textContent = '실시간 영상 재생';
        playButton.removeAttribute('title');
    }

    function showStaleMediaNotice() {
        stopPlayback();
        media.dataset.state = 'unavailable';
        mediaPlaceholder.hidden = false;
        video.hidden = true;
        mediaStatus.textContent = '캐시 위치 자료입니다. 만료될 수 있는 영상 주소는 실시간 갱신 후에만 재생합니다.';
        mediaStatus.hidden = false;
        playButton.disabled = true;
        playButton.textContent = '실시간 연결 대기';
        playButton.title = 'ITS 실시간 자료가 갱신되면 재생할 수 있습니다.';
    }

    function playbackError(message) {
        stopPlayback();
        media.dataset.state = 'error';
        mediaPlaceholder.hidden = false;
        video.hidden = true;
        mediaStatus.textContent = message;
        mediaStatus.hidden = false;
        playButton.disabled = false;
    }

    function closePopup(restoreMapFocus) {
        var wasOpen = !popup.hidden;
        resetMedia();
        activeCctv = null;
        clusterList.replaceChildren();
        clusterPicker.hidden = true;
        popup.hidden = true;
        if (restoreMapFocus && wasOpen) {
            var mapElement = document.getElementById('map');
            if (mapElement) mapElement.focus({ preventScroll: true });
        }
    }

    function setPopupText(id, value, fallback) {
        var element = document.getElementById(id);
        if (element) element.textContent = boundedText(value, fallback || '—', 120);
    }

    function positionPopup(pixel) {
        var runtime = window.WeatherGridMapRuntime;
        if (!runtime || typeof runtime.positionOverlayPopup !== 'function') return;
        popup.hidden = false;
        popup.style.left = '8px';
        popup.style.top = '8px';
        popup.style.maxHeight = '';
        requestAnimationFrame(function () {
            if (popup.hidden) return;
            runtime.positionOverlayPopup(popup, pixel);
        });
    }

    function showDetailContent(show) {
        clusterPicker.hidden = show;
        media.hidden = !show;
        popupMeta.hidden = !show;
        popupSource.hidden = !show;
    }

    function openPopup(cctv, pixel, focusPopup) {
        resetMedia();
        activeCctv = cctv;
        clusterList.replaceChildren();
        showDetailContent(true);
        setPopupText('cctv_popup_eyebrow', stale ? 'ITS · 캐시 위치 정보' : 'ITS · 실시간 교통');
        setPopupText('cctv_popup_title', cctv.name, '이름 없는 CCTV');
        setPopupText('cctv_popup_road', cctv.roadSectionId, '구간 정보 없음');
        setPopupText('cctv_popup_format', [cctv.format, cctv.resolution].filter(Boolean).join(' · '), 'HLS');
        setPopupText('cctv_popup_time', formatTime(cctv.fileCreatedAt), '시각 정보 없음');
        setPopupText('cctv_popup_source', '출처 ' + sourceName, '출처 국가교통정보센터');
        video.setAttribute('aria-label', cctv.name + ' 실시간 CCTV 영상');
        if (stale) showStaleMediaNotice();
        positionPopup(pixel);
        if (focusPopup) popup.focus({ preventScroll: true });
    }

    function openClusterPicker(members, pixel, focusPicker) {
        var cctvs = members.map(function (member) { return member.get('cctv'); }).filter(Boolean)
            .sort(function (a, b) {
                return a.name < b.name ? -1 : a.name > b.name ? 1
                    : a.latitude - b.latitude || a.longitude - b.longitude;
            });
        if (!cctvs.length) return;

        resetMedia();
        activeCctv = null;
        showDetailContent(false);
        clusterList.replaceChildren();
        setPopupText('cctv_popup_eyebrow', 'ITS · 겹친 지점');
        setPopupText('cctv_popup_title', cctvs.length + '개 CCTV 선택');
        var shown = cctvs.slice(0, MAX_CLUSTER_CHOICES);
        var hint = document.getElementById('cctv_cluster_hint');
        if (hint) {
            hint.textContent = cctvs.length > shown.length
                ? cctvs.length + '개 중 앞 ' + shown.length + '개를 표시합니다.'
                : '같은 위치에 CCTV ' + cctvs.length + '개가 있습니다.';
        }
        shown.forEach(function (cctv) {
            var item = document.createElement('li');
            var button = document.createElement('button');
            button.type = 'button';
            var name = document.createElement('strong');
            name.textContent = cctv.name;
            var road = document.createElement('span');
            road.textContent = cctv.roadSectionId || '구간 정보 없음';
            button.append(name, road);
            button.addEventListener('click', function () {
                openPopup(cctv, pixel, false);
                playButton.focus({ preventScroll: true });
            });
            item.appendChild(button);
            clusterList.appendChild(item);
        });
        positionPopup(pixel);
        if (focusPicker) {
            requestAnimationFrame(function () {
                var first = clusterList.querySelector('button');
                if (first) first.focus({ preventScroll: true });
            });
        }
    }

    function openMapFeature(cctvFeature, pixel, focusPopup) {
        if (!enabled || !cctvFeature) return;
        var members = featureMembers(cctvFeature);
        if (!members.length) return;
        if (members.length > 1) {
            closePopup(false);
            var extent = ol.extent.createEmpty();
            members.forEach(function (member) { ol.extent.extend(extent, member.getGeometry().getExtent()); });
            var view = weatherMap.getView();
            var maxZoom = typeof view.getMaxZoom === 'function' ? view.getMaxZoom() : 12;
            if ((ol.extent.getWidth(extent) === 0 && ol.extent.getHeight(extent) === 0)
                    || view.getZoom() >= maxZoom - 0.01) {
                openClusterPicker(members, pixel, focusPopup);
                return;
            }
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            view.fit(extent, {
                padding: typeof initialViewPadding === 'function'
                    ? initialViewPadding()
                    : (window.innerWidth <= 640 ? [64, 16, 96, 16] : [84, 160, 92, 292]),
                maxZoom: Math.min(maxZoom, view.getZoom() + 2),
                duration: reduced ? 0 : 240
            });
            return;
        }
        openPopup(members[0].get('cctv'), pixel, focusPopup);
    }

    function nearestVisibleCctv() {
        if (!enabled) return null;
        var size = weatherMap.getSize();
        var center = weatherMap.getView().getCenter();
        if (!size || !center) return null;
        var extent = weatherMap.getView().calculateExtent(size);
        var nearest = null;
        var nearestCoordinate = null;
        var nearestDistance = Infinity;
        clusterSource.forEachFeatureInExtent(extent, function (feature) {
            var coordinate = feature.getGeometry().getCoordinates();
            var dx = coordinate[0] - center[0], dy = coordinate[1] - center[1];
            var distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearest = feature;
                nearestCoordinate = coordinate;
                nearestDistance = distance;
            }
        });
        if (!nearest) return null;
        return {
            distance: nearestDistance,
            activate: function (focusPopup) {
                openMapFeature(nearest, weatherMap.getPixelFromCoordinate(nearestCoordinate), focusPopup);
            }
        };
    }

    function ensureHlsLibrary() {
        if (window.Hls) return Promise.resolve(window.Hls);
        if (hlsLoaderPromise) return hlsLoaderPromise;
        var promise;
        promise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var timeoutId = null;
            var settled = false;
            script.src = apiUrl(HLS_ASSET);
            script.async = true;
            function finish(error) {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                script.onload = null;
                script.onerror = null;
                if (hlsLoaderPromise === promise) hlsLoaderPromise = null;
                if (hlsLoaderCancel === cancel) hlsLoaderCancel = null;
                if (error) {
                    script.remove();
                    reject(error);
                } else {
                    resolve(window.Hls);
                }
            }
            function cancel() {
                var error = new Error('HLS_LOAD_ABORTED');
                error.name = 'AbortError';
                finish(error);
            }
            hlsLoaderCancel = cancel;
            script.onload = function () {
                finish(window.Hls ? null : new Error('HLS_UNAVAILABLE'));
            };
            script.onerror = function () { finish(new Error('HLS_LOAD_FAILED')); };
            timeoutId = setTimeout(function () {
                var error = new Error('HLS_LOAD_TIMEOUT');
                error.name = 'TimeoutError';
                finish(error);
            }, HLS_LIBRARY_TIMEOUT_MS);
            document.head.appendChild(script);
        });
        hlsLoaderPromise = promise;
        return hlsLoaderPromise;
    }

    function requestVideoPlay(generation) {
        var result;
        try {
            result = video.play();
        } catch (error) {
            if (generation === mediaGeneration) {
                playbackError('영상을 재생하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
            }
            return;
        }
        if (result && typeof result.catch === 'function') {
            result.catch(function (error) {
                if (generation !== mediaGeneration) return;
                if (error && error.name === 'NotAllowedError') {
                    clearMediaTimeout();
                    media.dataset.state = 'idle';
                    mediaStatus.textContent = '영상의 재생 버튼을 눌러 주세요.';
                    mediaStatus.hidden = false;
                    playButton.disabled = false;
                    return;
                }
                playbackError('영상을 재생하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
            });
        }
    }

    function playActiveCctv() {
        if (!activeCctv) return;
        if (stale) {
            showStaleMediaNotice();
            return;
        }
        var streamUrl = safeStreamUrl(activeCctv.streamUrl);
        if (!streamUrl) {
            playbackError('안전하지 않은 영상 주소라 재생하지 않았습니다.');
            return;
        }
        stopPlayback();
        var generation = mediaGeneration;
        media.dataset.state = 'loading';
        mediaStatus.textContent = '실시간 영상에 연결하는 중…';
        mediaStatus.hidden = false;
        playButton.disabled = true;
        armMediaTimeout(generation);

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.hidden = false;
            mediaPlaceholder.hidden = true;
            requestVideoPlay(generation);
            return;
        }

        ensureHlsLibrary().then(function (Hls) {
            if (generation !== mediaGeneration || !activeCctv) return;
            if (!Hls.isSupported()) {
                playbackError('이 브라우저에서는 실시간 영상을 재생할 수 없습니다.');
                return;
            }
            activeHls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 20,
                maxBufferLength: 20
            });
            activeHls.on(Hls.Events.MEDIA_ATTACHED, function () {
                if (generation === mediaGeneration && activeHls) activeHls.loadSource(streamUrl);
            });
            activeHls.on(Hls.Events.MANIFEST_PARSED, function () {
                if (generation !== mediaGeneration) return;
                video.hidden = false;
                mediaPlaceholder.hidden = true;
                requestVideoPlay(generation);
            });
            activeHls.on(Hls.Events.ERROR, function (event, data) {
                if (generation === mediaGeneration && data && data.fatal) {
                    playbackError('영상 연결이 끊겼습니다. 다시 시도해 주세요.');
                }
            });
            activeHls.attachMedia(video);
        }).catch(function (error) {
            if (generation === mediaGeneration) {
                if (error && error.name === 'AbortError') return;
                playbackError(error && error.name === 'TimeoutError'
                    ? '영상 재생 모듈 연결 시간이 초과됐습니다. 다시 시도해 주세요.'
                    : '영상 재생 모듈을 불러오지 못했습니다.');
            }
        });
    }

    function setEnabled(nextEnabled) {
        enabled = !!nextEnabled;
        if (enabled && window.WEATHER_GRID_AIR_QUALITY && window.WEATHER_GRID_AIR_QUALITY.getMode
                && window.WEATHER_GRID_AIR_QUALITY.getMode() !== 'off') window.WEATHER_GRID_AIR_QUALITY.setMode('off');
        toggle.classList.toggle('clicked', enabled);
        toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        closePopup(false);
        if (typeof window.WEATHER_GRID_UPDATE_HASH === 'function') window.WEATHER_GRID_UPDATE_HASH();
        if (!enabled) {
            layer.setVisible(false);
            status.hidden = true;
            abortRequest();
            clearCctvs();
            document.dispatchEvent(new CustomEvent('weather-grid:environment-changed', { detail: { type: 'cctv', enabled: false } }));
            return;
        }
        layer.setVisible(true);
        setStatus('zoom', '지도 범위를 확인하는 중…', false);
        scheduleFetch(false);
        document.dispatchEvent(new CustomEvent('weather-grid:environment-changed', { detail: { type: 'cctv', enabled: true } }));
    }

    toggle.addEventListener('click', function () { setEnabled(!enabled); });
    retryButton.addEventListener('click', retryFetch);
    popupClose.addEventListener('click', function () { closePopup(true); });
    playButton.addEventListener('click', playActiveCctv);

    if (window.WEATHER_GRID_OVERLAY_ROUTER) {
        window.WEATHER_GRID_OVERLAY_ROUTER.register('cctv', {
            enabled: function () { return enabled; },
            openFeature: openMapFeature,
            nearest: nearestVisibleCctv,
            close: closePopup
        });
    }

    weatherMap.on('movestart', function () {
        closePopup(false);
        abortRequest();
    });
    weatherMap.on('moveend', function () {
        if (enabled) scheduleFetch(false);
    });
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
        if (enabled) scheduleFetch(false);
    });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) resetMedia();
    });
    window.addEventListener('pagehide', function () {
        closePopup(false);
        abortRequest();
    });
    video.addEventListener('playing', function () {
        clearMediaTimeout();
        media.dataset.state = 'playing';
        mediaStatus.hidden = true;
    });
    video.addEventListener('waiting', function () {
        if (!popup.hidden && !video.hidden) {
            media.dataset.state = 'loading';
            mediaStatus.textContent = '영상 데이터를 기다리는 중…';
            mediaStatus.hidden = false;
            armMediaTimeout(mediaGeneration);
        }
    });
    video.addEventListener('error', function () {
        if (!popup.hidden && !video.hidden && !activeHls) {
            playbackError('영상을 재생하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        }
    });

    bindResolutionListener();
    window.WEATHER_GRID_CCTV = {
        setEnabled: setEnabled,
        isEnabled: function () { return enabled; },
        retry: retryFetch,
        close: closePopup,
        layer: layer
    };
})();
