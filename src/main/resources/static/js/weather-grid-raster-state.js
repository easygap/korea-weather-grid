/**
 * 기상 격자 래스터의 표본 수·셀 선택·통계·색상 해석을 Canvas와 OpenLayers에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridRasterState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var DEFAULT_TARGET_SAMPLES = 120000;
    var DEFAULT_MINIMUM_STRIDE = 2;
    var TRANSPARENT = Object.freeze([0, 0, 0, 0]);

    function positiveInteger(value) {
        return Number.isInteger(value) && value > 0;
    }

    function samplePlan(width, height, targetSamples, minimumStride) {
        var outputWidth = Math.round(Number(width));
        var outputHeight = Math.round(Number(height));
        if (!positiveInteger(outputWidth) || !positiveInteger(outputHeight)) return null;

        var target = positiveInteger(targetSamples) ? targetSamples : DEFAULT_TARGET_SAMPLES;
        var minimum = positiveInteger(minimumStride) ? minimumStride : DEFAULT_MINIMUM_STRIDE;
        var stride = Math.max(minimum, Math.round(Math.sqrt(outputWidth * outputHeight / target)));
        var sampleWidth = Math.max(1, Math.ceil(outputWidth / stride));
        var sampleHeight = Math.max(1, Math.ceil(outputHeight / stride));
        return Object.freeze({
            width: outputWidth,
            height: outputHeight,
            stride: stride,
            sampleWidth: sampleWidth,
            sampleHeight: sampleHeight,
            sampleCount: sampleWidth * sampleHeight
        });
    }

    function lookupKey(input) {
        input = input || {};
        var extent = Array.isArray(input.extent) ? input.extent : [];
        var size = Array.isArray(input.size) ? input.size : [];
        return [
            input.projectionCode,
            input.viewProjectionCode,
            extent[0], extent[1], extent[2], extent[3], input.resolution,
            input.pixelRatio, input.devicePixelRatio, size[0], size[1],
            input.sampleWidth, input.sampleHeight,
            input.nxMin, input.nyMin, input.step, input.nx, input.ny, input.theme
        ].join('|');
    }

    /** 남쪽 기준 격자 좌표를 북쪽부터 저장된 응답 배열의 인덱스로 바꾼다. */
    function cellIndex(gridX, gridSouthY, nx, ny) {
        if (!Number.isFinite(gridX) || !Number.isFinite(gridSouthY)
                || !positiveInteger(nx) || !positiveInteger(ny)) return -1;
        var column = Math.round(gridX);
        var rowFromSouth = Math.round(gridSouthY);
        if (column < 0 || column >= nx || rowFromSouth < 0 || rowFromSouth >= ny) return -1;
        return (ny - 1 - rowFromSouth) * nx + column;
    }

    function numericSummary(data, isValid) {
        var minimum = Number.POSITIVE_INFINITY;
        var maximum = Number.NEGATIVE_INFINITY;
        var sum = 0;
        var count = 0;
        var supported = Array.isArray(data)
            || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data));
        if (supported && typeof isValid === 'function') {
            for (var index = 0; index < data.length; index += 1) {
                var value = data[index];
                if (!isValid(value)) continue;
                minimum = Math.min(minimum, value);
                maximum = Math.max(maximum, value);
                sum += value;
                count += 1;
            }
        }
        return Object.freeze({
            kind: 'numeric',
            count: count,
            min: count ? minimum : 0,
            avg: count ? sum / count : 0,
            max: count ? maximum : 0
        });
    }

    function summarize(data, isValid, categorical) {
        if (categorical) {
            return Object.freeze({ kind: 'categorical', count: 0, min: null, avg: null, max: null });
        }
        return numericSummary(data, isValid);
    }

    function clampByte(value) {
        return Math.max(0, Math.min(255, Math.round(Number(value))));
    }

    function parseCssColor(value) {
        if (typeof value !== 'string') return TRANSPARENT;
        var match = value.match(/^rgba?\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*(?:,\s*([+-]?[\d.]+)\s*)?\)$/i);
        if (!match) return TRANSPARENT;
        var channels = [Number(match[1]), Number(match[2]), Number(match[3])];
        var alpha = match[4] === undefined ? 1 : Number(match[4]);
        if (!channels.every(Number.isFinite) || !Number.isFinite(alpha)) return TRANSPARENT;
        return Object.freeze([
            clampByte(channels[0]),
            clampByte(channels[1]),
            clampByte(channels[2]),
            clampByte(Math.max(0, Math.min(1, alpha)) * 255)
        ]);
    }

    return Object.freeze({
        targetSamples: DEFAULT_TARGET_SAMPLES,
        minimumStride: DEFAULT_MINIMUM_STRIDE,
        samplePlan: samplePlan,
        lookupKey: lookupKey,
        cellIndex: cellIndex,
        summarize: summarize,
        parseCssColor: parseCssColor
    });
}));
