/**
 * 대표 지역 검색의 정규화·필터·키보드 선택 규칙을 DOM에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridSearchState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function normalizeQuery(value) {
        return String(value || '').normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase('ko-KR');
    }

    function normalizedStation(station) {
        if (!station || typeof station.name !== 'string') return null;
        var name = station.name.normalize('NFKC').trim();
        var latitude = Number(station.lat);
        var longitude = Number(station.lon);
        if (!name || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
                || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
        return Object.freeze({
            name: name,
            lat: latitude,
            lon: longitude,
            query: normalizeQuery(name)
        });
    }

    function validStations(stations) {
        if (!Array.isArray(stations)) return [];
        return stations.map(normalizedStation).filter(Boolean);
    }

    function suggestions(stations, value, limit) {
        var query = normalizeQuery(value);
        if (!query) return Object.freeze([]);
        var maximum = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
        return Object.freeze(validStations(stations).filter(function (station) {
            return station.query.indexOf(query) >= 0;
        }).slice(0, maximum));
    }

    function exactMatch(stations, value) {
        var query = normalizeQuery(value);
        if (!query) return null;
        return validStations(stations).find(function (station) {
            return station.query === query;
        }) || null;
    }

    function moveIndex(currentIndex, itemCount, direction) {
        var count = Number.isInteger(itemCount) ? itemCount : 0;
        if (count <= 0) return -1;
        var current = Number.isInteger(currentIndex) ? currentIndex : -1;
        if (direction === 'previous') return current <= 0 ? count - 1 : current - 1;
        if (direction === 'next') return (current + 1) % count;
        return Math.max(-1, Math.min(count - 1, current));
    }

    function status(value, count) {
        var display = String(value || '').trim();
        if (!normalizeQuery(display)) return '';
        return count > 0
            ? '검색 제안 ' + count + '개가 있습니다.'
            : '“' + display + '”와 일치하는 대표 지역이 없습니다.';
    }

    function selectionStatus(value) {
        var display = String(value || '').trim();
        return normalizeQuery(display) ? '“' + display + '” 예보를 열었습니다.' : '';
    }

    return Object.freeze({
        normalizeQuery: normalizeQuery,
        suggestions: suggestions,
        exactMatch: exactMatch,
        moveIndex: moveIndex,
        status: status,
        selectionStatus: selectionStatus
    });
}));
