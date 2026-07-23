/**
 * Kakao SDK 설정 검증과 OpenLayers 뷰 변환을 DOM 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridKakaoState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var KEY_PATTERN = /^[0-9a-fA-F]{32}$/;

    function runtimeConfig(payload) {
        var key = payload && typeof payload.kakaoJavascriptKey === 'string'
            ? payload.kakaoJavascriptKey.trim() : '';
        var enabled = Boolean(payload && payload.kakaoEnabled) && KEY_PATTERN.test(key);
        return Object.freeze({
            enabled: enabled,
            key: enabled ? key : ''
        });
    }

    function levelForZoom(zoom) {
        var value = Number(zoom);
        if (!Number.isFinite(value)) value = 6.5;
        return Math.max(1, Math.min(14, Math.round(16 - value)));
    }

    function viewPlan(lonLat, zoom) {
        if (!Array.isArray(lonLat) || lonLat.length < 2) return null;
        var longitude = Number(lonLat[0]);
        var latitude = Number(lonLat[1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
        return Object.freeze({
            longitude: Math.max(-180, Math.min(180, longitude)),
            latitude: Math.max(-85, Math.min(85, latitude)),
            level: levelForZoom(zoom)
        });
    }

    function providerMessage(provider) {
        return {
            loading: 'Kakao 도로 배경지도를 불러오는 중입니다.',
            kakao: 'Kakao 도로 배경지도를 사용 중입니다.',
            osm: 'Kakao 지도를 사용할 수 없어 OpenStreetMap 도로지도를 사용 중입니다.',
            idle: '도로 배경지도를 선택할 수 있습니다.'
        }[provider] || '';
    }

    return Object.freeze({
        runtimeConfig: runtimeConfig,
        levelForZoom: levelForZoom,
        viewPlan: viewPlan,
        providerMessage: providerMessage
    });
}));
