/**
 * 기상 요소 메타데이터와 색상 결정을 렌더러에서 분리한 순수 모델.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridPaletteState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var TRANSPARENT = 'rgba(0,0,0,0)';
    var SOLAR_COLOR_STEPS = 25;

    function freezeRecord(record) {
        Object.keys(record).forEach(function (key) {
            if (record[key] && typeof record[key] === 'object') Object.freeze(record[key]);
        });
        return Object.freeze(record);
    }

    var ELEMENTS = freezeRecord({
        wdws: { label: '바람', metric: '바람', legend: '풍속 분포', unit: 'm/s', group: 'core', isoline: true, view3d: true },
        tmp: { label: '기온', metric: '기온', legend: '기온 분포', unit: '℃', group: 'core', isoline: true, view3d: true },
        pcp: { label: '1시간 강수량', metric: '1시간 예상 강수량', legend: '1시간 강수량 분포', unit: 'mm', group: 'precipitation', isoline: true, view3d: true },
        pty: { label: '강수형태', metric: '예상 강수형태', legend: '강수형태 분포', unit: '', group: 'precipitation', categorical: true, isoline: false, view3d: false },
        sno: { label: '1시간 신적설', metric: '1시간 예상 신적설', legend: '1시간 신적설 분포', unit: 'cm', group: 'precipitation', isoline: true, view3d: true },
        reh: { label: '상대습도', metric: '상대습도', legend: '상대습도 분포', unit: '%', group: 'additional', isoline: true, view3d: true },
        sky: { label: '하늘상태', metric: '예상 하늘상태', legend: '하늘상태 분포', unit: '', group: 'additional', categorical: true, isoline: false, view3d: false },
        wav: { label: '파고', metric: '예상 파고', legend: '파고 분포', unit: 'm', group: 'marine', isoline: true, view3d: true },
        swdn: { label: '일사강도', metric: '일사강도', legend: '일사강도 분포', unit: 'W/㎡', group: 'core', isoline: true, view3d: true }
    });

    function solarScaleForMonth(month) {
        var monthNumber = Math.max(1, Math.min(12, Number(month) || 1));
        var seasonalPosition = Math.cos((monthNumber - 6) * Math.PI / 6);
        var upperBound = Math.round(820 + 280 * seasonalPosition);
        return Object.freeze(Array.from({ length: SOLAR_COLOR_STEPS }, function (_, index) {
            return Math.round(upperBound * index / (SOLAR_COLOR_STEPS - 1));
        }));
    }

    var SOLAR_THRESHOLDS = Object.freeze(Array.from({ length: 12 }, function (_, index) {
        var month = String(index + 1).padStart(2, '0');
        return [month, solarScaleForMonth(month)];
    }).reduce(function (ranges, entry) {
        ranges[entry[0]] = entry[1];
        return ranges;
    }, {}));

    var SOLAR_PALETTE = Object.freeze(Array.from({ length: SOLAR_COLOR_STEPS }, function (_, index) {
        var progress = index / (SOLAR_COLOR_STEPS - 1);
        var red = Math.round(20 + 225 * progress);
        var green = Math.round(115 + 95 * Math.sin(Math.PI * progress) - 40 * progress);
        var blue = Math.round(170 - 120 * progress);
        return 'rgba(' + red + ', ' + green + ', ' + blue + ', 0.72)';
    }));

    function elementMeta(element) {
        return ELEMENTS[element] || ELEMENTS.wdws;
    }

    function categoryLabel(element, value) {
        var code = Number(value);
        if (element === 'pty') {
            return ({ 0: '강수 없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기' })[code] || '자료 없음';
        }
        if (element === 'sky') {
            return ({ 1: '맑음', 3: '구름많음', 4: '흐림' })[code] || '자료 없음';
        }
        return '';
    }

    function isValidValue(element, value) {
        if (!Number.isFinite(value) || value <= -900 || value >= 9000) return false;
        if (element === 'pty') return [0, 1, 2, 3, 4].indexOf(value) >= 0;
        if (element === 'sky') return [1, 3, 4].indexOf(value) >= 0;
        var ranges = {
            wdws: [0, 150], tmp: [-100, 80], pcp: [0, 1000], sno: [0, 100],
            reh: [0, 100], wav: [0, 50], swdn: [0, 2000]
        };
        var range = ranges[element];
        return Boolean(range && value >= range[0] && value <= range[1]);
    }

    function valueText(element, value) {
        if (!isValidValue(element, value)) return '—';
        var meta = elementMeta(element);
        if (meta.categorical) return categoryLabel(element, value);
        return (Math.round(value * 10) / 10) + (meta.unit ? ' ' + meta.unit : '');
    }

    function thresholdColor(value, thresholds, colors) {
        var index = thresholds.findIndex(function (limit) { return value <= limit; });
        return colors[index < 0 ? colors.length - 1 : index];
    }

    function windColor(value) {
        return thresholdColor(value, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12], [
            'rgba(44, 46, 126, 0.82)',
            'rgba(39, 83, 155, 0.82)',
            'rgba(31, 119, 173, 0.82)',
            'rgba(21, 149, 173, 0.82)',
            'rgba(30, 170, 150, 0.82)',
            'rgba(88, 184, 108, 0.82)',
            'rgba(145, 198, 93, 0.82)',
            'rgba(196, 207, 98, 0.82)',
            'rgba(236, 211, 106, 0.82)',
            'rgba(245, 173, 91, 0.82)',
            'rgba(239, 116, 78, 0.82)',
            'rgba(216, 68, 112, 0.82)'
        ]);
    }

    function temperatureColor(value) {
        if (value <= -900) return TRANSPARENT;
        return thresholdColor(value, [-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35], [
            'rgba(55, 48, 163, 0.7)',
            'rgba(29, 78, 216, 0.7)',
            'rgba(2, 132, 199, 0.7)',
            'rgba(6, 182, 212, 0.7)',
            'rgba(20, 184, 166, 0.7)',
            'rgba(34, 197, 94, 0.7)',
            'rgba(163, 230, 53, 0.7)',
            'rgba(250, 204, 21, 0.7)',
            'rgba(251, 146, 60, 0.7)',
            'rgba(248, 113, 113, 0.7)',
            'rgba(239, 68, 68, 0.7)',
            'rgba(190, 18, 60, 0.7)'
        ]);
    }

    function rainColor(value) {
        if (!Number.isFinite(value) || value < 0 || value <= -900) return TRANSPARENT;
        if (value === 0) return 'rgba(119, 139, 160, 0)';
        if (value < 1) return 'rgba(143, 224, 238, 0.62)';
        if (value < 3) return 'rgba(68, 187, 221, 0.70)';
        if (value < 15) return 'rgba(48, 126, 211, 0.76)';
        if (value < 30) return 'rgba(91, 91, 195, 0.80)';
        if (value < 50) return 'rgba(153, 72, 179, 0.84)';
        return 'rgba(210, 61, 123, 0.88)';
    }

    function snowColor(value) {
        if (!Number.isFinite(value) || value < 0 || value <= -900) return TRANSPARENT;
        if (value === 0) return 'rgba(133, 148, 173, 0)';
        if (value < 1) return 'rgba(191, 226, 248, 0.58)';
        if (value < 3) return 'rgba(139, 199, 235, 0.68)';
        if (value < 5) return 'rgba(135, 148, 224, 0.75)';
        if (value < 10) return 'rgba(139, 104, 205, 0.81)';
        if (value < 20) return 'rgba(161, 72, 178, 0.85)';
        return 'rgba(190, 55, 132, 0.9)';
    }

    function humidityColor(value) {
        if (!Number.isFinite(value) || value < 0 || value > 100 || value <= -900) return TRANSPARENT;
        if (value <= 20) return 'rgba(225, 174, 91, 0.72)';
        if (value <= 40) return 'rgba(190, 190, 112, 0.72)';
        if (value <= 60) return 'rgba(114, 190, 151, 0.75)';
        if (value <= 80) return 'rgba(55, 170, 177, 0.78)';
        if (value <= 90) return 'rgba(53, 132, 190, 0.81)';
        return 'rgba(77, 92, 177, 0.84)';
    }

    function precipitationTypeColor(value) {
        return ({
            0: 'rgba(119, 139, 160, 0)',
            1: 'rgba(55, 142, 211, 0.82)',
            2: 'rgba(130, 118, 214, 0.84)',
            3: 'rgba(181, 151, 226, 0.86)',
            4: 'rgba(37, 174, 183, 0.84)'
        })[Number(value)] || TRANSPARENT;
    }

    function skyColor(value) {
        return ({
            1: 'rgba(245, 190, 83, 0.78)',
            3: 'rgba(111, 151, 188, 0.78)',
            4: 'rgba(91, 97, 132, 0.84)'
        })[Number(value)] || TRANSPARENT;
    }

    function waveColor(value) {
        if (!Number.isFinite(value) || value < 0 || value <= -900) return TRANSPARENT;
        if (value < 0.5) return 'rgba(156, 225, 226, 0.58)';
        if (value < 1) return 'rgba(80, 190, 207, 0.68)';
        if (value < 2) return 'rgba(42, 139, 196, 0.76)';
        if (value < 3) return 'rgba(78, 92, 181, 0.81)';
        if (value < 4) return 'rgba(142, 76, 169, 0.85)';
        return 'rgba(205, 71, 111, 0.89)';
    }

    function solarColor(value, month) {
        var ranges = SOLAR_THRESHOLDS[month] || SOLAR_THRESHOLDS['01'];
        var bucket = ranges.findIndex(function (upperBound) { return value <= upperBound; });
        return SOLAR_PALETTE[bucket < 0 ? SOLAR_PALETTE.length - 1 : bucket];
    }

    function colorFor(element, value, month) {
        if (!isValidValue(element, value)) return TRANSPARENT;
        return ({
            wdws: windColor,
            tmp: temperatureColor,
            pcp: rainColor,
            sno: snowColor,
            reh: humidityColor,
            pty: precipitationTypeColor,
            sky: skyColor,
            wav: waveColor,
            swdn: function (input) { return solarColor(input, month); }
        }[element] || function () { return TRANSPARENT; })(value);
    }

    return Object.freeze({
        transparent: TRANSPARENT,
        elements: ELEMENTS,
        solarThresholds: SOLAR_THRESHOLDS,
        solarPalette: SOLAR_PALETTE,
        solarScaleForMonth: solarScaleForMonth,
        elementMeta: elementMeta,
        categoryLabel: categoryLabel,
        isValidValue: isValidValue,
        valueText: valueText,
        thresholdColor: thresholdColor,
        windColor: windColor,
        temperatureColor: temperatureColor,
        rainColor: rainColor,
        snowColor: snowColor,
        humidityColor: humidityColor,
        precipitationTypeColor: precipitationTypeColor,
        skyColor: skyColor,
        waveColor: waveColor,
        solarColor: solarColor,
        colorFor: colorFor
    });
}));
