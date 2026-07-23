/**
 * 탐색 모드의 설명, 선택 효과와 현재 화면에서의 모드 추론을 순수 상태로 계산한다.
 */
(function (root, factory) {
    'use strict';

    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridExploreState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MODE_COPY = Object.freeze({
        wind: Object.freeze({ title: '바람 흐름', kind: '예보', body: '풍속 색상과 흐름선을 함께 표시합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' }),
        temperature: Object.freeze({ title: '기온 분포', kind: '예보', body: '전국의 기온 차이를 색상으로 비교합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' }),
        precipitation: Object.freeze({ title: '1시간 강수량', kind: '예보', body: '해당 시각까지 1시간 동안의 예상 강수량을 표시합니다.', timeline: '강수 예보', timelineDetail: '향후 48시간' }),
        solar: Object.freeze({ title: '일사 강도', kind: '예보', body: '지면에 도달하는 하향단파복사 강도를 비교합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' }),
        hazards: Object.freeze({ title: '위험기상', kind: '최근 관측·발표', body: '태풍 분석·예측 경로와 최근 낙뢰, 발효 특보를 확인합니다.', timeline: '위험기상', timelineDetail: '최근 관측·발표' }),
        air: Object.freeze({ title: '초미세먼지', kind: '최신 관측', body: 'PM2.5 관측과 선택 시각의 바람 흐름을 함께 봅니다.', timeline: '바람 예보 시간', timelineDetail: '미세먼지 최신 관측' }),
        road: Object.freeze({ title: '도로 CCTV', kind: '실시간', body: '지역을 확대해 CCTV 위치와 실시간 영상을 확인합니다.', timeline: '도로 CCTV', timelineDetail: '실시간' }),
        custom: Object.freeze({ title: '직접 조정한 보기', kind: '설정', body: '선택한 레이어 조합을 표시하고 있습니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' })
    });
    var METRIC_COPY = Object.freeze({
        pcp: Object.freeze({ title: '1시간 강수량', kind: '예보', body: '해당 시각 직전 1시간의 예상 강수량입니다.', timeline: '강수·적설 예보', timelineDetail: '향후 48시간' }),
        pty: Object.freeze({ title: '강수형태', kind: '예보', body: '비·비/눈·눈·소나기 예상 구역을 범주별로 표시합니다.', timeline: '강수·적설 예보', timelineDetail: '향후 48시간' }),
        sno: Object.freeze({ title: '1시간 신적설', kind: '예보', body: '해당 시각 직전 1시간에 새로 쌓일 눈의 깊이입니다.', timeline: '강수·적설 예보', timelineDetail: '향후 48시간' }),
        reh: Object.freeze({ title: '상대습도', kind: '예보', body: '공기가 현재 온도에서 포함한 수증기 비율을 표시합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' }),
        sky: Object.freeze({ title: '하늘상태', kind: '예보', body: '맑음·구름많음·흐림 예상 구역을 범주별로 표시합니다.', timeline: '기상 예보', timelineDetail: '향후 48시간' }),
        wav: Object.freeze({ title: '파고', kind: '해상 예보', body: '해상의 예상 파고를 표시하며 육지는 값이 없습니다.', timeline: '해상 예보', timelineDetail: '향후 48시간' })
    });
    var MODES = Object.freeze(Object.keys(MODE_COPY));
    var REMEMBERED_WEATHER_MODES = Object.freeze(['wind', 'temperature', 'precipitation', 'solar', 'hazards']);
    var PRECIPITATION_METRICS = Object.freeze(['pcp', 'pty', 'sno']);

    function validMode(value, fallback) {
        return MODES.indexOf(value) >= 0 ? value : fallback;
    }

    function freezeLayers(value) {
        value = value || {};
        return Object.freeze({ heat: Boolean(value.heat), stream: Boolean(value.stream), iso: Boolean(value.iso) });
    }

    function initial(options) {
        options = options || {};
        var activeMode = validMode(options.activeMode, 'wind');
        var lastWeatherMode = validMode(options.lastWeatherMode,
            REMEMBERED_WEATHER_MODES.indexOf(activeMode) >= 0 ? activeMode : 'wind');
        if (lastWeatherMode === 'air' || lastWeatherMode === 'road') lastWeatherMode = 'wind';
        return Object.freeze({ activeMode: activeMode, lastWeatherMode: lastWeatherMode });
    }

    function dataDomain(mode) {
        if (mode === 'air') return 'air';
        if (mode === 'road') return 'traffic';
        return 'weather';
    }

    function dockContext(mode, metric, metricGroup) {
        if (mode === 'wind') return '기상 · 바람';
        if (mode === 'temperature') return '기상 · 기온';
        if (mode === 'precipitation') return '기상 · 강수·눈';
        if (mode === 'solar') return '기상 · 일사';
        if (mode === 'hazards') return '기상 · 위험기상';
        if (mode === 'air') return '대기질 · 미세먼지';
        if (mode === 'road') return '교통 · CCTV';
        if (metricGroup === 'marine') return '기상 · 해상';
        if (metric === 'reh') return '기상 · 상대습도';
        if (metric === 'sky') return '기상 · 하늘상태';
        return '기상 · 사용자 설정';
    }

    function context(mode, metric, metricGroup) {
        var selectedMode = validMode(mode, 'wind');
        var copy = ((selectedMode === 'precipitation' || selectedMode === 'custom') && METRIC_COPY[metric])
            ? METRIC_COPY[metric] : MODE_COPY[selectedMode];
        return Object.freeze({
            mode: selectedMode,
            domain: dataDomain(selectedMode),
            title: copy.title,
            kind: copy.kind,
            body: copy.body,
            timeline: copy.timeline,
            timelineDetail: copy.timelineDetail,
            dockContext: dockContext(selectedMode, metric, metricGroup)
        });
    }

    function normalizeWeatherLayers(metric, layers, metricMeta) {
        var current = layers || {};
        var meta = metricMeta || {};
        return freezeLayers({
            heat: true,
            stream: metric === 'wdws' && Boolean(current.stream),
            iso: meta.isoline === false ? false : Boolean(current.iso)
        });
    }

    function plan(mode, options) {
        options = options || {};
        var selectedMode = validMode(mode, null);
        if (!selectedMode) return null;
        var compact = Boolean(options.compact);
        var metric = null;
        var layers = freezeLayers({ heat: true, stream: false, iso: false });
        var stations = !compact;
        var basemap = 'weather';
        var air = 'off';
        var cctv = false;
        var typhoon = false;
        var lightning = false;
        var stopPlayback = false;

        if (selectedMode === 'wind') {
            metric = 'wdws';
            layers = freezeLayers({ heat: true, stream: true, iso: false });
        } else if (selectedMode === 'temperature') {
            metric = 'tmp';
        } else if (selectedMode === 'precipitation') {
            metric = typeof options.lastPrecipitation === 'string' ? options.lastPrecipitation : 'pcp';
        } else if (selectedMode === 'solar') {
            metric = 'swdn';
        } else if (selectedMode === 'hazards') {
            layers = freezeLayers({ heat: false, stream: false, iso: false });
            stations = false;
            typhoon = true;
            lightning = true;
            stopPlayback = true;
        } else if (selectedMode === 'air') {
            metric = 'wdws';
            layers = freezeLayers({ heat: false, stream: true, iso: false });
            stations = false;
            air = 'pm25';
        } else if (selectedMode === 'road') {
            layers = freezeLayers({ heat: false, stream: false, iso: false });
            stations = false;
            basemap = 'streets';
            cctv = true;
        } else {
            metric = typeof options.lastWeather === 'string' ? options.lastWeather : 'wdws';
            layers = normalizeWeatherLayers(metric, options.layers, options.metricMeta);
        }

        return Object.freeze({
            mode: selectedMode,
            metric: metric,
            layers: layers,
            stations: stations,
            basemap: basemap,
            environment: Object.freeze({ air: air, cctv: cctv }),
            hazards: Object.freeze({ typhoon: typhoon, lightning: lightning }),
            stopPlayback: stopPlayback
        });
    }

    function isPrecipitation(metric) {
        return PRECIPITATION_METRICS.indexOf(metric) >= 0;
    }

    function infer(snapshot) {
        snapshot = snapshot || {};
        if (snapshot.air === 'pm10' || snapshot.air === 'pm25') return 'air';
        if (snapshot.cctv) return 'road';
        var layers = snapshot.layers || {};
        var hazards = snapshot.hazards || {};
        if ((hazards.typhoon || hazards.lightning) && !layers.heat && !layers.stream && !layers.iso) return 'hazards';
        if (snapshot.metric === 'tmp' && layers.heat && !layers.stream && !layers.iso) return 'temperature';
        if (isPrecipitation(snapshot.metric) && layers.heat && !layers.stream && !layers.iso) return 'precipitation';
        if (snapshot.metric === 'swdn' && layers.heat && !layers.stream && !layers.iso) return 'solar';
        if (snapshot.metric === 'wdws' && layers.heat && layers.stream && !layers.iso) return 'wind';
        return 'custom';
    }

    function outcome(state, effects) {
        return Object.freeze({ state: state, effects: Object.freeze((effects || []).map(Object.freeze)) });
    }

    function transition(state, event) {
        state = state || initial();
        event = event || {};
        var mode;
        if (event.type === 'mode/select') mode = validMode(event.mode, null);
        else if (event.type === 'domain/select') {
            mode = event.domain === 'air' ? 'air' : event.domain === 'traffic' ? 'road' : state.lastWeatherMode;
        } else if (event.type === 'state/observe') {
            mode = infer(event.snapshot);
            var observedLast = state.lastWeatherMode;
            if (REMEMBERED_WEATHER_MODES.indexOf(mode) >= 0) observedLast = mode;
            else if (mode === 'custom' && (event.metricGroup === 'additional' || event.metricGroup === 'marine')) {
                observedLast = 'custom';
            }
            return outcome(initial({ activeMode: mode, lastWeatherMode: observedLast }));
        } else return outcome(state);

        if (!mode) return outcome(state);
        var nextLast = REMEMBERED_WEATHER_MODES.indexOf(mode) >= 0 ? mode : state.lastWeatherMode;
        var next = initial({ activeMode: mode, lastWeatherMode: nextLast });
        return outcome(next, [{ type: 'explore/apply', mode: mode }]);
    }

    return Object.freeze({
        modes: MODES,
        modeCopy: MODE_COPY,
        metricCopy: METRIC_COPY,
        initial: initial,
        transition: transition,
        infer: infer,
        plan: plan,
        context: context,
        dataDomain: dataDomain,
        normalizeWeatherLayers: normalizeWeatherLayers,
        isPrecipitation: isPrecipitation
    });
}));
