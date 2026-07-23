/**
 * 공식 Kakao Maps JavaScript SDK를 OpenLayers 오버레이 아래의 배경지도에 연결한다.
 * 문서화되지 않은 타일 URL은 사용하지 않으며, 키와 SDK가 없으면 호출자가 OSM으로 대체한다.
 */
(function () {
    'use strict';

    var State = window.WeatherGridKakaoState;
    if (!State) throw new Error('Kakao state must load first');

    var CONFIG_URL = '/api/runtime/map-config';
    var SDK_BASE_URL = 'https://dapi.kakao.com/v2/maps/sdk.js';
    var LOAD_TIMEOUT_MS = 6000;
    var configPromise = null;
    var sdkPromise = null;
    var kakaoMap = null;
    var openLayersMap = null;
    var viewKeys = [];
    var mapKeys = [];
    var resizeBound = false;
    var syncFrame = 0;
    var requestToken = 0;
    var active = false;
    var status = 'idle';

    function container() {
        return document.getElementById('kakao_basemap');
    }

    function updateStatus(next) {
        status = next;
        var output = document.getElementById('kakao_basemap_status');
        if (output) output.textContent = State.providerMessage(next);
    }

    function loadRuntimeConfig() {
        if (configPromise) return configPromise;
        configPromise = new Promise(function (resolve, reject) {
            var controller = new AbortController();
            var timeout = window.setTimeout(function () {
                controller.abort();
            }, LOAD_TIMEOUT_MS);
            fetch(CONFIG_URL, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
                signal: controller.signal
            }).then(function (response) {
                if (!response.ok) throw new Error('map runtime config unavailable');
                return response.json();
            }).then(function (payload) {
                resolve(State.runtimeConfig(payload));
            }).catch(reject).finally(function () {
                window.clearTimeout(timeout);
            });
        });
        return configPromise;
    }

    function resolveLoadedSdk(resolve, reject) {
        if (!window.kakao || !window.kakao.maps
                || typeof window.kakao.maps.load !== 'function') {
            reject(new Error('Kakao Maps SDK did not initialize'));
            return;
        }
        window.kakao.maps.load(function () {
            if (typeof window.kakao.maps.Map !== 'function') {
                reject(new Error('Kakao Maps API unavailable'));
                return;
            }
            resolve(window.kakao.maps);
        });
    }

    function loadSdk(key) {
        if (window.kakao && window.kakao.maps
                && typeof window.kakao.maps.Map === 'function') {
            return Promise.resolve(window.kakao.maps);
        }
        if (sdkPromise) return sdkPromise;
        sdkPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var timeout = window.setTimeout(function () {
                script.remove();
                reject(new Error('Kakao Maps SDK load timed out'));
            }, LOAD_TIMEOUT_MS);
            script.src = SDK_BASE_URL + '?appkey=' + encodeURIComponent(key) + '&autoload=false';
            script.async = true;
            script.referrerPolicy = 'strict-origin-when-cross-origin';
            script.dataset.weatherGridKakaoSdk = 'true';
            script.onload = function () {
                window.clearTimeout(timeout);
                resolveLoadedSdk(resolve, reject);
            };
            script.onerror = function () {
                window.clearTimeout(timeout);
                reject(new Error('Kakao Maps SDK request failed'));
            };
            document.head.appendChild(script);
        });
        return sdkPromise;
    }

    function unbindView() {
        if (viewKeys.length && window.ol && ol.Observable
                && typeof ol.Observable.unByKey === 'function') {
            ol.Observable.unByKey(viewKeys);
        }
        viewKeys = [];
    }

    function currentViewPlan() {
        if (!openLayersMap || !window.ol || !ol.proj) return null;
        var view = openLayersMap.getView();
        var center = view && view.getCenter();
        if (!view || !center) return null;
        var lonLat = ol.proj.transform(
            center, view.getProjection(), 'EPSG:4326');
        return State.viewPlan(lonLat, view.getZoom());
    }

    function syncNow() {
        syncFrame = 0;
        if (!active || !kakaoMap || !window.kakao || !window.kakao.maps) return;
        var plan = currentViewPlan();
        if (!plan) return;
        kakaoMap.setCenter(new window.kakao.maps.LatLng(
            plan.latitude, plan.longitude));
        kakaoMap.setLevel(plan.level, { animate: false });
    }

    function scheduleSync() {
        if (!active || syncFrame) return;
        syncFrame = window.requestAnimationFrame(syncNow);
    }

    function bindView() {
        unbindView();
        if (!openLayersMap) return;
        var view = openLayersMap.getView();
        if (!view || typeof view.on !== 'function') return;
        viewKeys = [
            view.on('change:center', scheduleSync),
            view.on('change:resolution', scheduleSync)
        ];
    }

    function bindMap() {
        if (!openLayersMap || mapKeys.length) return;
        mapKeys.push(openLayersMap.on('change:view', function () {
            bindView();
            scheduleSync();
        }));
        mapKeys.push(openLayersMap.on('change:size', relayout));
        bindView();
        if (!resizeBound) {
            window.addEventListener('resize', relayout, { passive: true });
            resizeBound = true;
        }
    }

    function ensureMap(maps) {
        if (kakaoMap) return kakaoMap;
        var target = container();
        if (!target) throw new Error('Kakao basemap container is missing');
        target.hidden = false;
        var plan = currentViewPlan() || {
            latitude: 37.5,
            longitude: 127.5,
            level: 9
        };
        kakaoMap = new maps.Map(target, {
            center: new maps.LatLng(plan.latitude, plan.longitude),
            level: plan.level,
            draggable: false,
            scrollwheel: false,
            disableDoubleClick: true,
            disableDoubleClickZoom: true,
            keyboardShortcuts: false,
            tileAnimation: false
        });
        bindMap();
        return kakaoMap;
    }

    function relayout() {
        if (!active || !kakaoMap) return;
        kakaoMap.relayout();
        scheduleSync();
    }

    function show(map) {
        var token = ++requestToken;
        openLayersMap = map;
        updateStatus('loading');
        return loadRuntimeConfig().then(function (config) {
            if (!config.enabled) {
                updateStatus('osm');
                return false;
            }
            return loadSdk(config.key).then(function (maps) {
                if (token !== requestToken) return false;
                ensureMap(maps);
                var target = container();
                if (target) target.hidden = false;
                active = true;
                updateStatus('kakao');
                kakaoMap.relayout();
                syncNow();
                return true;
            });
        }).catch(function () {
            if (token === requestToken) {
                active = false;
                var target = container();
                if (target) target.hidden = true;
                updateStatus('osm');
            }
            return false;
        });
    }

    function hide() {
        requestToken++;
        active = false;
        if (syncFrame) {
            window.cancelAnimationFrame(syncFrame);
            syncFrame = 0;
        }
        var target = container();
        if (target) target.hidden = true;
        updateStatus('idle');
    }

    function diagnostics() {
        return Object.freeze({
            active: active,
            status: status,
            sdkLoaded: Boolean(kakaoMap)
        });
    }

    window.WeatherGridKakaoBasemap = Object.freeze({
        show: show,
        hide: hide,
        relayout: relayout,
        diagnostics: diagnostics
    });
}());
