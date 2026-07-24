/**
 * 예보 발표시각의 KST 변환, 3시간 이동, 60일 조회 경계를 순수 함수로 제공한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridRunState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var BASE_TIMES = Object.freeze(['02', '05', '08', '11', '14', '17', '20', '23']);
    var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    var RUN_STEP_MS = 3 * 60 * 60 * 1000;
    var HISTORY_MS = 60 * 24 * 60 * 60 * 1000;

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        var values = value.split('-').map(Number);
        var date = new Date(Date.UTC(values[0], values[1] - 1, values[2]));
        return date.getUTCFullYear() === values[0]
            && date.getUTCMonth() === values[1] - 1
            && date.getUTCDate() === values[2];
    }

    function parse(date, hour) {
        if (!validDate(date) || BASE_TIMES.indexOf(hour) < 0) return null;
        var values = date.split('-').map(Number);
        return Date.UTC(values[0], values[1] - 1, values[2], Number(hour)) - KST_OFFSET_MS;
    }

    function parts(epoch) {
        if (!Number.isFinite(epoch)) return null;
        var shifted = new Date(epoch + KST_OFFSET_MS);
        return Object.freeze({
            date: shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1)
                + '-' + pad(shifted.getUTCDate()),
            hour: pad(shifted.getUTCHours())
        });
    }

    function limits(latestEpoch) {
        if (!Number.isFinite(latestEpoch)) return null;
        return Object.freeze({
            earliest: latestEpoch - HISTORY_MS,
            latest: latestEpoch
        });
    }

    function availability(selectedEpoch, latestEpoch) {
        var boundary = limits(latestEpoch);
        if (!Number.isFinite(selectedEpoch) || !boundary) {
            return Object.freeze({ valid: false, previous: false, next: false, latest: false });
        }
        return Object.freeze({
            valid: selectedEpoch >= boundary.earliest && selectedEpoch <= boundary.latest,
            previous: selectedEpoch - RUN_STEP_MS >= boundary.earliest,
            next: selectedEpoch + RUN_STEP_MS <= boundary.latest,
            latest: selectedEpoch === boundary.latest
        });
    }

    function shift(selectedEpoch, latestEpoch, direction) {
        if (!Number.isFinite(selectedEpoch) || !Number.isFinite(latestEpoch)
                || (direction !== -1 && direction !== 1)) return null;
        var candidate = selectedEpoch + direction * RUN_STEP_MS;
        var boundary = limits(latestEpoch);
        return candidate >= boundary.earliest && candidate <= boundary.latest ? candidate : null;
    }

    function shiftDate(value, days) {
        if (!validDate(value)) return null;
        var values = value.split('-').map(Number);
        var shifted = new Date(Date.UTC(values[0], values[1] - 1, values[2] + days));
        return shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1)
            + '-' + pad(shifted.getUTCDate());
    }

    function clampDate(requested, latestDate) {
        if (!validDate(requested) || !validDate(latestDate)) return null;
        var earliestDate = shiftDate(latestDate, -60);
        if (requested < earliestDate) return earliestDate;
        if (requested > latestDate) return latestDate;
        return requested;
    }

    return Object.freeze({
        baseTimes: BASE_TIMES,
        parse: parse,
        parts: parts,
        limits: limits,
        availability: availability,
        shift: shift,
        clampDate: clampDate,
        validDate: validDate
    });
}));
