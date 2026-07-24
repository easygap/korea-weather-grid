/**
 * VWorld 런타임 설정과 공식 벡터 지도 API URL 생성을 DOM 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridVWorldState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var KEY_PATTERN = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
    var API_ROOT = 'https://api.vworld.kr/req/wmts/vector/';

    function runtimeConfig(payload) {
        var key = payload && typeof payload.vworldApiKey === 'string'
            ? payload.vworldApiKey.trim() : '';
        var enabled = Boolean(payload && payload.vworldEnabled) && KEY_PATTERN.test(key);
        return Object.freeze({
            enabled: enabled,
            key: enabled ? key : ''
        });
    }

    function tileUrls(key) {
        if (!KEY_PATTERN.test(key || '')) return null;
        var encoded = encodeURIComponent(key);
        return Object.freeze({
            base: API_ROOT + encoded + '/Base/{z}/{x}/{y}.png',
            traffic: API_ROOT + 'getTile/' + encoded + '/traffic/{z}/{x}/{y}.pbf',
            probe: API_ROOT + encoded + '/Base/11/1746/793.png'
        });
    }

    function providerMessage(provider) {
        return {
            loading: 'VWorld 도로 배경지도를 불러오는 중입니다.',
            vworld: 'VWorld 배경지도와 벡터 도로를 사용 중입니다.',
            osm: 'VWorld 지도를 사용할 수 없어 OpenStreetMap 도로지도를 사용 중입니다.',
            idle: '도로 배경지도를 선택할 수 있습니다.'
        }[provider] || '';
    }

    return Object.freeze({
        runtimeConfig: runtimeConfig,
        tileUrls: tileUrls,
        providerMessage: providerMessage
    });
}));
