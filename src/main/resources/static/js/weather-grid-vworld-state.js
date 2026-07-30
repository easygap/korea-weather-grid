/**
 * VWorld 런타임 설정과 동일 출처 타일 프록시 URL 생성을 DOM 효과에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridVWorldState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var TILE_ROOT = '/api/map/vworld';

    function runtimeConfig(payload) {
        var tileBase = payload && payload.vworldTileBase === TILE_ROOT ? TILE_ROOT : '';
        var enabled = Boolean(payload && payload.vworldEnabled) && Boolean(tileBase);
        return Object.freeze({
            enabled: enabled,
            tileBase: enabled ? tileBase : ''
        });
    }

    function tileUrls(tileBase) {
        if (tileBase !== TILE_ROOT) return null;
        return Object.freeze({
            base: TILE_ROOT + '/base/{z}/{x}/{y}.png',
            traffic: TILE_ROOT + '/traffic/{z}/{x}/{y}.pbf',
            probe: TILE_ROOT + '/base/11/1746/793.png'
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
