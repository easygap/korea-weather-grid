/**
 * 기상 요소 선택과 예보 재생 상태를 DOM·네트워크 구현에서 분리해 계산한다.
 * 브라우저 어댑터는 이 모듈이 반환한 효과만 실행한다.
 */
(function (root, factory) {
    'use strict';

    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WeatherGridControlState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var FIRST_HOUR = 1;
    var LAST_HOUR = 48;
    var FRAME_STEP = 3;
    var FRAME_DELAY = 6200;
    var PRECIPITATION_METRICS = Object.freeze(['pcp', 'pty', 'sno']);

    function isPrecipitation(metric) {
        return PRECIPITATION_METRICS.indexOf(metric) >= 0;
    }

    function hourValue(value) {
        var hour = Number.parseInt(value, 10);
        if (!Number.isFinite(hour)) return FIRST_HOUR;
        return Math.max(FIRST_HOUR, Math.min(LAST_HOUR, hour));
    }

    function metricValue(value, fallback) {
        return typeof value === 'string' && value ? value : fallback;
    }

    function snapshot(value) {
        return Object.freeze({
            playing: !!value.playing,
            awaitingGrid: !!value.awaitingGrid,
            timerPending: !!value.timerPending,
            wrapPending: !!value.wrapPending,
            selectedMetric: metricValue(value.selectedMetric, 'wdws'),
            lastPrecipitationMetric: metricValue(value.lastPrecipitationMetric, 'pcp'),
            lastWeatherMetric: metricValue(value.lastWeatherMetric, 'wdws')
        });
    }

    function effect(type, values) {
        return Object.freeze(Object.assign({ type: type }, values || {}));
    }

    function result(state, effects) {
        return Object.freeze({ state: state, effects: Object.freeze(effects || []) });
    }

    function initial(options) {
        var source = options || {};
        var selected = metricValue(source.selectedMetric, 'wdws');
        return snapshot({
            playing: false,
            awaitingGrid: false,
            timerPending: false,
            wrapPending: false,
            selectedMetric: selected,
            lastPrecipitationMetric: isPrecipitation(selected) ? selected : source.lastPrecipitationMetric,
            lastWeatherMetric: source.lastWeatherMetric || (isPrecipitation(selected) ? 'wdws' : selected)
        });
    }

    function stopped(current) {
        return snapshot({
            playing: false,
            awaitingGrid: false,
            timerPending: false,
            wrapPending: false,
            selectedMetric: current.selectedMetric,
            lastPrecipitationMetric: current.lastPrecipitationMetric,
            lastWeatherMetric: current.lastWeatherMetric
        });
    }

    function withPlayback(current, changes) {
        return snapshot(Object.assign({}, current, changes));
    }

    function selectFrame(current, targetHour, wrapPending) {
        return result(withPlayback(current, {
            awaitingGrid: true,
            timerPending: false,
            wrapPending: !!wrapPending
        }), [effect('timeline/select', { hour: hourValue(targetHour) })]);
    }

    function transition(current, event) {
        if (!current || !event || typeof event.type !== 'string') return result(current);

        var hour;
        switch (event.type) {
        case 'metric/select': {
            var metric = metricValue(event.metric, current.selectedMetric);
            return result(snapshot(Object.assign({}, current, {
                selectedMetric: metric,
                lastPrecipitationMetric: isPrecipitation(metric) ? metric : current.lastPrecipitationMetric,
                lastWeatherMetric: event.rememberWeather === false ? current.lastWeatherMetric : metric
            })));
        }
        case 'play/start':
            if (current.playing) return result(current);
            hour = hourValue(event.currentHour);
            if (event.loading) {
                return result(withPlayback(current, {
                    playing: true,
                    awaitingGrid: true,
                    timerPending: false,
                    wrapPending: hour === LAST_HOUR
                }));
            }
            return selectFrame(withPlayback(current, { playing: true }),
                hour === LAST_HOUR ? FIRST_HOUR : Math.min(LAST_HOUR, hour + FRAME_STEP), false);
        case 'play/stop':
            if (!current.playing && !current.timerPending && !current.awaitingGrid) return result(current);
            return result(stopped(current), [effect('timer/cancel')]);
        case 'grid/settled':
            if (!current.playing) return result(current);
            if (event.success === false) return result(stopped(current), [effect('timer/cancel')]);
            hour = hourValue(event.currentHour);
            if (hour === LAST_HOUR && !current.wrapPending) {
                return result(stopped(current), [effect('timer/cancel')]);
            }
            return result(withPlayback(current, {
                awaitingGrid: false,
                timerPending: true
            }), [effect('timer/schedule', { delay: FRAME_DELAY })]);
        case 'timer/fired':
            if (!current.playing || !current.timerPending) return result(current);
            if (event.loading) {
                return result(withPlayback(current, {
                    awaitingGrid: true,
                    timerPending: false
                }));
            }
            hour = hourValue(event.currentHour);
            if (hour === LAST_HOUR && !current.wrapPending) {
                return result(stopped(current), [effect('timer/cancel')]);
            }
            return selectFrame(current,
                current.wrapPending ? FIRST_HOUR : Math.min(LAST_HOUR, hour + FRAME_STEP), false);
        default:
            return result(current);
        }
    }

    return Object.freeze({
        FIRST_HOUR: FIRST_HOUR,
        LAST_HOUR: LAST_HOUR,
        FRAME_STEP: FRAME_STEP,
        FRAME_DELAY: FRAME_DELAY,
        PRECIPITATION_METRICS: PRECIPITATION_METRICS,
        isPrecipitation: isPrecipitation,
        initial: initial,
        transition: transition
    });
}));
