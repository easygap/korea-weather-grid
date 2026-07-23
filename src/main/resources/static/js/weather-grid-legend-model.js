/**
 * 범례 데이터의 구간, 분포, 접근성 문구를 DOM과 분리해 계산한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridLegendModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var UNIT_TEXT = Object.freeze({
        wdws: '격자 분포 · 단위 m/s',
        tmp: '격자 분포 · 단위 ℃',
        pcp: '유효 격자 분포 · 1시간 강수량 mm',
        sno: '유효 격자 분포 · 1시간 신적설 cm',
        reh: '유효 격자 분포 · 상대습도 %',
        pty: '유효 격자 분포 · 기상청 강수형태 코드',
        sky: '유효 격자 분포 · 기상청 하늘상태 코드',
        wav: '해상 유효 격자 분포 · 파고 m · 육지는 자료 없음'
    });

    function freezeList(values) {
        return Object.freeze(values.map(function (value) { return Object.freeze(value); }));
    }

    function intervalBins(thresholds) {
        var bins = [{
            label: thresholds[thresholds.length - 1] + ' 초과',
            lower: thresholds[thresholds.length - 1],
            lowerInclusive: false,
            sample: thresholds[thresholds.length - 1] + 0.01
        }];
        for (var index = thresholds.length - 1; index > 0; index -= 1) {
            bins.push({
                label: thresholds[index - 1] + '~' + thresholds[index],
                lower: thresholds[index - 1],
                lowerInclusive: false,
                upper: thresholds[index],
                upperInclusive: true,
                sample: (thresholds[index - 1] + thresholds[index]) / 2
            });
        }
        bins.push({
            label: thresholds[0] + ' 이하',
            upper: thresholds[0],
            upperInclusive: true,
            sample: thresholds[0]
        });
        return bins;
    }

    var BIN_DEFINITIONS = Object.freeze({
        wdws: freezeList(intervalBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12])),
        tmp: freezeList(intervalBins([-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35])),
        pcp: freezeList([
            { label: '50 이상', lower: 50, lowerInclusive: true, sample: 50 },
            { label: '30–50', lower: 30, lowerInclusive: true, upper: 50, upperInclusive: false, sample: 40 },
            { label: '15–30', lower: 15, lowerInclusive: true, upper: 30, upperInclusive: false, sample: 20 },
            { label: '3–15', lower: 3, lowerInclusive: true, upper: 15, upperInclusive: false, sample: 8 },
            { label: '1–3', lower: 1, lowerInclusive: true, upper: 3, upperInclusive: false, sample: 2 },
            { label: '1 미만', lower: 0, lowerInclusive: false, upper: 1, upperInclusive: false, sample: 0.5 },
            { label: '강수 없음', exact: 0, sample: 0, neutral: true }
        ]),
        sno: freezeList([
            { label: '20 이상', lower: 20, lowerInclusive: true, sample: 20 },
            { label: '10–20', lower: 10, lowerInclusive: true, upper: 20, upperInclusive: false, sample: 15 },
            { label: '5–10', lower: 5, lowerInclusive: true, upper: 10, upperInclusive: false, sample: 7 },
            { label: '3–5', lower: 3, lowerInclusive: true, upper: 5, upperInclusive: false, sample: 4 },
            { label: '1–3', lower: 1, lowerInclusive: true, upper: 3, upperInclusive: false, sample: 2 },
            { label: '1 미만', lower: 0, lowerInclusive: false, upper: 1, upperInclusive: false, sample: 0.5 },
            { label: '신적설 없음', exact: 0, sample: 0, neutral: true }
        ]),
        reh: freezeList([
            { label: '90–100', lower: 90, lowerInclusive: false, upper: 100, upperInclusive: true, sample: 95 },
            { label: '80–90', lower: 80, lowerInclusive: false, upper: 90, upperInclusive: true, sample: 85 },
            { label: '60–80', lower: 60, lowerInclusive: false, upper: 80, upperInclusive: true, sample: 70 },
            { label: '40–60', lower: 40, lowerInclusive: false, upper: 60, upperInclusive: true, sample: 50 },
            { label: '20–40', lower: 20, lowerInclusive: false, upper: 40, upperInclusive: true, sample: 30 },
            { label: '0–20', lower: 0, lowerInclusive: true, upper: 20, upperInclusive: false, sample: 10 }
        ]),
        pty: freezeList([
            { label: '눈', exact: 3, sample: 3 },
            { label: '비/눈', exact: 2, sample: 2 },
            { label: '비', exact: 1, sample: 1 },
            { label: '소나기', exact: 4, sample: 4 },
            { label: '강수 없음', exact: 0, sample: 0, neutral: true }
        ]),
        sky: freezeList([
            { label: '흐림', exact: 4, sample: 4 },
            { label: '구름많음', exact: 3, sample: 3 },
            { label: '맑음', exact: 1, sample: 1 }
        ]),
        wav: freezeList([
            { label: '4 이상', lower: 4, lowerInclusive: true, sample: 4 },
            { label: '3–4', lower: 3, lowerInclusive: true, upper: 4, upperInclusive: false, sample: 3.5 },
            { label: '2–3', lower: 2, lowerInclusive: true, upper: 3, upperInclusive: false, sample: 2.5 },
            { label: '1–2', lower: 1, lowerInclusive: true, upper: 2, upperInclusive: false, sample: 1.5 },
            { label: '0.5–1', lower: 0.5, lowerInclusive: true, upper: 1, upperInclusive: false, sample: 0.75 },
            { label: '0.5 미만', lower: 0, lowerInclusive: true, upper: 0.5, upperInclusive: false, sample: 0.25 }
        ])
    });

    function matches(value, bin) {
        if (bin.exact !== undefined) return value === bin.exact;
        if (bin.lower !== undefined) {
            if (bin.lowerInclusive ? value < bin.lower : value <= bin.lower) return false;
        }
        if (bin.upper !== undefined) {
            if (bin.upperInclusive ? value > bin.upper : value >= bin.upper) return false;
        }
        return true;
    }

    function defaultValid(element, value) {
        return Number.isFinite(value) && value > -900 && value < 9000;
    }

    function validValues(options) {
        var result = options.data;
        var values = result && Array.isArray(result.data) ? result.data : [];
        var isValid = options.isValid || defaultValid;
        return values.filter(function (value) {
            return typeof value === 'number' && isValid(options.element, value);
        });
    }

    function percentage(count, total) {
        return total ? count * 100 / total : 0;
    }

    function buildRows(options, metadata, values) {
        var element = options.element;
        var definitions = BIN_DEFINITIONS[element] || [];
        var colorFor = options.colorFor || function () { return '#64748b'; };
        var total = values.length;
        var rows = definitions.map(function (definition) {
            var count = values.reduce(function (sum, value) {
                return sum + (matches(value, definition) ? 1 : 0);
            }, 0);
            var share = percentage(count, total);
            var color = definition.neutral
                ? 'rgba(119,139,160,.32)'
                : colorFor(element, definition.sample, options.month);
            return Object.freeze({
                label: definition.label,
                color: color,
                count: count,
                share: share,
                shareText: total ? Math.round(share) + '%' : '—',
                ariaLabel: definition.label + ', 유효 격자 ' + count + '개, ' + share.toFixed(1) + '%'
            });
        });
        return Object.freeze({
            element: element,
            title: metadata.legend || metadata.label || element,
            categorical: Boolean(metadata.categorical),
            kind: 'rows',
            unitText: UNIT_TEXT[element] || '',
            validCount: total,
            rows: Object.freeze(rows)
        });
    }

    function buildSolar(options, metadata, values) {
        var month = Math.max(1, Math.min(12, Number(options.month) || 1));
        var thresholdsByMonth = options.solarThresholds || {};
        var monthKey = String(month).padStart(2, '0');
        var thresholds = thresholdsByMonth[monthKey] || thresholdsByMonth[month - 1] || [];
        var palette = options.solarPalette || [];
        var bucketCount = 10;
        var counts = new Array(bucketCount).fill(0);
        var top = thresholds.length ? thresholds[thresholds.length - 1] : 0;
        values.forEach(function (value) {
            var index = top > 0 ? Math.floor(value / top * bucketCount) : 0;
            index = Math.min(bucketCount - 1, Math.max(0, index));
            counts[index] += 1;
        });
        var maxCount = Math.max.apply(null, counts.concat([1]));
        var bins = counts.map(function (count, index) {
            var share = percentage(count, values.length);
            var colorIndex = Math.round(index / (bucketCount - 1) * Math.max(0, palette.length - 1));
            return Object.freeze({
                index: index,
                lower: Math.round(top * index / bucketCount),
                upper: Math.round(top * (index + 1) / bucketCount),
                color: palette[colorIndex] || '#64748b',
                count: count,
                share: share,
                shareText: values.length ? Math.round(share) + '%' : '—',
                barPercent: count ? Math.max(5, count / maxCount * 100) : 0
            });
        }).reverse();
        return Object.freeze({
            element: 'swdn',
            title: metadata.legend || metadata.label || '일사량',
            categorical: false,
            kind: 'solar',
            unitText: '격자 분포 · W/㎡ · ' + month + '월',
            validCount: values.length,
            rows: Object.freeze([]),
            solar: Object.freeze({
                gradientColors: Object.freeze(palette.slice().reverse()),
                bins: Object.freeze(bins),
                ticks: Object.freeze([String(top), String(Math.round(top / 2)), '0'])
            })
        });
    }

    function build(options) {
        options = options || {};
        var metadata = options.metadata && options.metadata[options.element]
            ? options.metadata[options.element]
            : {};
        var values = validValues(options);
        return options.element === 'swdn'
            ? buildSolar(options, metadata, values)
            : buildRows(options, metadata, values);
    }

    function initialCollapsed(compactViewport) {
        return Boolean(compactViewport);
    }

    function reduceCollapsed(current, action) {
        if (action && action.type === 'viewport') return Boolean(action.compact);
        if (action && action.type === 'toggle') return !current;
        return Boolean(current);
    }

    return Object.freeze({
        build: build,
        initialCollapsed: initialCollapsed,
        reduceCollapsed: reduceCollapsed,
        definitions: BIN_DEFINITIONS
    });
}));
