/**
 * 지점의 향후 48시간(+1~+48h) 시계열, 요약, 접근 가능한 수치표를 한 번에 렌더링한다.
 * 외부 차트 런타임 없이 SVG 한 장만 유지해 지점을 반복 선택해도 누적되지 않는다.
 */
(function () {
    'use strict';

    var activeChart = null;
    var lastPayload = null;
    var HOUR = 3600 * 1000;
    var CALM_MAX_SPEED = 0.4;
    var activeSolarResolutionHours = 1;
    var PALETTE = {
        wind: '#62c7f5',
        windSoft: '#a9e2ff',
        direction: '#b8a7ff',
        temperature: '#ff8fa3',
        temperatureSoft: '#ffc2cf',
        solar: '#ffd166',
        solarHot: '#ff8a5b',
        precipitation: '#38bdf8',
        precipitationSoft: '#93c5fd',
        probability: '#a78bfa',
        snow: '#7dd3fc',
        humidity: '#34d399',
        wave: '#22d3ee',
        categoryMuted: '#64748b'
    };
    var FORECAST_CHART_ELEMENTS = new Set(['pcp', 'pty', 'sno', 'reh', 'sky', 'wav']);

    /** SVG 렌더러는 이 파일에 포함되므로 네트워크 의존성 없이 즉시 준비된다. */
    function ensureReady() {
        return Promise.resolve(true);
    }

    function cssVar(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    }

    function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function finiteValue(value) {
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
        var number = Number(value);
        return Number.isFinite(number) && number !== 9999 ? number : null;
    }

    function startTimestamp(date) {
        var year = Number(date.slice(0, 4));
        var month = Number(date.slice(4, 6));
        var day = Number(date.slice(6, 8));
        var hour = Number(date.slice(8, 10));
        return Date.UTC(year, month - 1, day, hour);
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function shiftDateToken(date, hours) {
        var shifted = new Date(startTimestamp(date) + hours * HOUR);
        return shifted.getUTCFullYear() + pad(shifted.getUTCMonth() + 1) + pad(shifted.getUTCDate())
            + pad(shifted.getUTCHours());
    }

    function solarResolutionHours(date) {
        var baseKst = Date.parse(date.slice(0, 4) + '-' + date.slice(4, 6) + '-'
            + date.slice(6, 8) + 'T' + date.slice(8, 10) + ':00:00+09:00');
        if (!Number.isFinite(baseKst)) return 1;
        var baseUtc = new Date(baseKst);
        var runUtc = Date.UTC(baseUtc.getUTCFullYear(), baseUtc.getUTCMonth(), baseUtc.getUTCDate(),
            Math.floor(baseUtc.getUTCHours() / 6) * 6);
        if ((baseKst - runUtc) / HOUR < 5) runUtc -= 6 * HOUR;
        return runUtc < Date.UTC(2026, 6, 1) ? 3 : 1;
    }

    /** 구형 3시간 KIM 런은 실제 모델 발효시각에 해당하는 슬롯만 남긴다. */
    function maskLegacySolarSlots(data, date) {
        var baseKst = Date.parse(date.slice(0, 4) + '-' + date.slice(4, 6) + '-'
            + date.slice(6, 8) + 'T' + date.slice(8, 10) + ':00:00+09:00');
        var baseUtc = new Date(baseKst);
        var runUtc = Date.UTC(baseUtc.getUTCFullYear(), baseUtc.getUTCMonth(), baseUtc.getUTCDate(),
            Math.floor(baseUtc.getUTCHours() / 6) * 6);
        if ((baseKst - runUtc) / HOUR < 5) runUtc -= 6 * HOUR;
        var runToBase = (baseKst - runUtc) / HOUR;
        return data.map(function (slot, hour) {
            var modelHour = Math.max(0, Math.round((runToBase + Math.max(hour, 1)) / 3) * 3);
            return hour === modelHour - runToBase ? slot : [9999, 0];
        });
    }

    function forecastHour(index) { return index + 1; }

    function formatTimestamp(timestamp, compact) {
        var date = new Date(timestamp);
        var day = pad(date.getUTCMonth() + 1) + '.' + pad(date.getUTCDate());
        var hour = pad(date.getUTCHours()) + ':00';
        return compact ? hour + '<br>' + day : date.getUTCFullYear() + '.' + day + ' ' + hour;
    }

    function formatNumber(value, digits) {
        if (value === null || !Number.isFinite(value)) return '—';
        var rounded = Number(value.toFixed(digits === undefined ? 1 : digits));
        return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('ko-KR');
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }

    /** PCP 원문과 수치 범위를 함께 보존한다. 차트 높이 때문에 범위를 단일값으로 치환하지 않는다. */
    function precipitationAmount(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return { kind: 'missing', display: '—', lower: null, upper: null, rain: false };
        }
        var display = String(value).trim();
        var compact = display.replace(/\s+/g, '').replace(/㎜/g, 'mm').toLowerCase();
        var sentinel = Number(compact.replace(/mm$/, ''));
        if (Number.isFinite(sentinel) && (sentinel === 9999 || sentinel <= -900)) {
            return { kind: 'missing', display: '—', lower: null, upper: null, rain: false };
        }
        if (/^(강수없음|없음|-)$/.test(compact)) {
            return { kind: 'none', display: display, lower: 0, upper: 0, rain: false };
        }

        var match = compact.match(/^([0-9]+(?:\.[0-9]+)?)mm미만$/);
        if (match) {
            var lessThan = Number(match[1]);
            return Number.isFinite(lessThan) && lessThan > 0
                ? { kind: 'range', display: display, lower: 0, upper: lessThan, rain: true, upperExclusive: true }
                : { kind: 'missing', display: display, lower: null, upper: null, rain: false };
        }

        match = compact.match(/^([0-9]+(?:\.[0-9]+)?)(?:mm)?[~～]([0-9]+(?:\.[0-9]+)?)mm(?:미만)?$/);
        if (match) {
            var lower = Number(match[1]), upper = Number(match[2]);
            return Number.isFinite(lower) && Number.isFinite(upper) && upper >= lower
                ? { kind: 'range', display: display, lower: lower, upper: upper, rain: upper > 0, upperExclusive: true }
                : { kind: 'missing', display: display, lower: null, upper: null, rain: false };
        }

        match = compact.match(/^([0-9]+(?:\.[0-9]+)?)mm이상$/);
        if (match) {
            var atLeast = Number(match[1]);
            return Number.isFinite(atLeast)
                ? { kind: 'at-least', display: display, lower: atLeast, upper: Infinity, rain: atLeast > 0 }
                : { kind: 'missing', display: display, lower: null, upper: null, rain: false };
        }

        match = compact.match(/^([0-9]+(?:\.[0-9]+)?)(?:mm)?$/);
        if (match) {
            var exact = Number(match[1]);
            return Number.isFinite(exact) && exact >= 0
                ? { kind: exact === 0 ? 'none' : 'exact', display: display, lower: exact, upper: exact, rain: exact > 0 }
                : { kind: 'missing', display: display, lower: null, upper: null, rain: false };
        }
        return { kind: 'missing', display: display, lower: null, upper: null, rain: false };
    }

    function precipitationProbability(value) {
        if (value === null || value === undefined || String(value).trim() === '') return null;
        var number = finiteValue(value);
        return number !== null && number >= 0 && number <= 100 ? number : null;
    }

    function forecastTimestamp(value) {
        if (value === null || value === undefined) return null;
        var digits = String(value).replace(/\D/g, '');
        if (digits.length < 10) return null;
        var timestamp = Date.UTC(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1,
            Number(digits.slice(6, 8)), Number(digits.slice(8, 10)),
            digits.length >= 12 ? Number(digits.slice(10, 12)) : 0);
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    /** 단기예보 응답의 발표시각 슬롯을 실제 예보인 +1~+48시간으로 고정한다. */
    function normalizeForecastSlots(data, date) {
        var payload = data && !Array.isArray(data) ? data : {};
        var items = Array.isArray(data) ? data : (Array.isArray(payload.items) ? payload.items : []);
        if (!items.length) return [];
        var byHour = Object.create(null);
        items.forEach(function (item) {
            var hour = Number(item && item.forecastHour);
            if (Number.isInteger(hour) && hour >= 1 && hour <= 48) byHour[hour] = item;
        });

        var baseToken = payload.baseDate && payload.baseTime
            ? String(payload.baseDate) + String(payload.baseTime).slice(0, 2) : String(date || '');
        var base = /^\d{10}$/.test(baseToken) ? startTimestamp(baseToken) : null;
        if (!Number.isFinite(base)) {
            Object.keys(byHour).some(function (key) {
                var timestamp = forecastTimestamp(byHour[key].forecastDateTime);
                if (timestamp === null) return false;
                base = timestamp - Number(key) * HOUR;
                return true;
            });
        }
        if (!Number.isFinite(base)) return [];

        return Array.from({ length: 48 }, function (_, index) {
            var hour = index + 1;
            var item = byHour[hour] || null;
            return {
                hour: hour,
                timestamp: item ? (forecastTimestamp(item.forecastDateTime) || base + hour * HOUR) : base + hour * HOUR,
                item: item
            };
        });
    }

    function normalizePrecipitation(data, date) {
        return normalizeForecastSlots(data, date).map(function (slot) {
            return {
                hour: slot.hour,
                timestamp: slot.timestamp,
                amount: precipitationAmount(slot.item && slot.item.precipitationAmount),
                probability: precipitationProbability(slot.item && slot.item.precipitationProbability)
            };
        });
    }

    function categoryDetails(element, item) {
        if (!item) return { code: null, label: '—', color: PALETTE.categoryMuted };
        var isPrecipitation = element === 'pty';
        var rawCode = isPrecipitation ? item.precipitationType : item.skyCode;
        var code = finiteValue(rawCode);
        var labels = isPrecipitation
            ? { 0: '강수 없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기' }
            : { 1: '맑음', 3: '구름많음', 4: '흐림' };
        if (code === null || !Object.prototype.hasOwnProperty.call(labels, code)) {
            return { code: null, label: '—', color: PALETTE.categoryMuted };
        }
        var sourceLabel = isPrecipitation ? item.precipitationTypeLabel : item.skyLabel;
        var colors = isPrecipitation
            ? { 0: '#64748b', 1: '#38bdf8', 2: '#a5b4fc', 3: '#e0f2fe', 4: '#818cf8' }
            : { 1: '#facc15', 3: '#94a3b8', 4: '#64748b' };
        return {
            code: code,
            label: sourceLabel == null || String(sourceLabel).trim() === '' ? labels[code] : String(sourceLabel).trim(),
            color: colors[code]
        };
    }

    /** SNO 원문 표기는 보존하고, 시각화에 쓸 수치만 별도로 정규화한다. 0은 정상값이다. */
    function snowfallAmount(value) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return { display: '—', value: null, approximate: false };
        }
        var display = String(value).trim();
        var compact = display.replace(/\s+/g, '').replace(/㎝/g, 'cm').toLowerCase();
        var sentinel = Number(compact.replace(/cm$/, ''));
        if (Number.isFinite(sentinel) && (sentinel === 9999 || sentinel <= -900)) {
            return { display: '—', value: null, approximate: false };
        }
        if (/^(적설없음|신적설없음|없음|-)$/.test(compact)) {
            return { display: display, value: 0, approximate: false };
        }
        var match = compact.match(/^([0-9]+(?:\.[0-9]+)?)(?:cm)?$/);
        if (match) return { display: display, value: Number(match[1]), approximate: false };
        match = compact.match(/^([0-9]+(?:\.[0-9]+)?)cm미만$/);
        if (match) return { display: display, value: Number(match[1]), approximate: true };
        match = compact.match(/^([0-9]+(?:\.[0-9]+)?)(?:cm)?[~～]([0-9]+(?:\.[0-9]+)?)cm(?:미만)?$/);
        if (match) {
            return { display: display, value: (Number(match[1]) + Number(match[2])) / 2, approximate: true };
        }
        match = compact.match(/^([0-9]+(?:\.[0-9]+)?)cm이상$/);
        if (match) return { display: display, value: Number(match[1]), approximate: true };
        return { display: display, value: null, approximate: false };
    }

    function normalizeForecastElement(data, date, element) {
        return normalizeForecastSlots(data, date).map(function (slot) {
            var item = slot.item;
            if (element === 'sno') {
                var amount = snowfallAmount(item && item.snowfallAmount);
                return Object.assign({}, slot, { value: amount.value, display: amount.display, approximate: amount.approximate });
            }
            if (element === 'reh') {
                var humidity = finiteValue(item && item.humidity);
                humidity = humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null;
                return Object.assign({}, slot, { value: humidity, display: humidity === null ? '—' : formatNumber(humidity, 0) + '%' });
            }
            if (element === 'wav') {
                var wave = finiteValue(item && item.waveHeight);
                wave = wave !== null && wave >= 0 && wave <= 50 ? wave : null;
                return Object.assign({}, slot, { value: wave, display: wave === null ? '—' : formatNumber(wave) + 'm' });
            }
            var category = categoryDetails(element, item);
            return Object.assign({}, slot, category, { value: category.code === null ? null : 1, display: category.label });
        });
    }

    function formatHourText(timestamp, includeDate) {
        var date = new Date(timestamp);
        var hour = pad(date.getUTCHours()) + ':00';
        return includeDate ? pad(date.getUTCMonth() + 1) + '.' + pad(date.getUTCDate()) + ' ' + hour : hour;
    }

    /** PCP 발효시각은 직전 한 시간 구간의 끝이므로 표와 툴팁에 구간을 명시한다. */
    function formatPrecipitationPeriod(endTimestamp) {
        var startTimestampValue = endTimestamp - HOUR;
        var start = new Date(startTimestampValue), end = new Date(endTimestamp);
        var sameDate = start.getUTCFullYear() === end.getUTCFullYear()
            && start.getUTCMonth() === end.getUTCMonth() && start.getUTCDate() === end.getUTCDate();
        return formatHourText(startTimestampValue, true) + '–' + formatHourText(endTimestamp, !sameDate);
    }

    function directionName(degree) {
        if (!Number.isFinite(degree)) return '자료 없음';
        var directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
        return directions[Math.floor((degree + 22.5) / 45) % 8] + '풍';
    }

    function isCalm(speed) {
        return speed !== null && Number.isFinite(speed) && speed <= CALM_MAX_SPEED;
    }

    function normalizedDegree(value) {
        var degree = finiteValue(value);
        return degree === null ? null : ((degree % 360) + 360) % 360;
    }

    function average(values) {
        return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
    }

    function createMetricCard(label, value, unit, note, tone) {
        var card = document.createElement('article');
        card.className = 'station_metric_card' + (tone ? ' is-' + tone : '');
        var eyebrow = document.createElement('span');
        eyebrow.className = 'station_metric_label';
        eyebrow.textContent = label;
        var reading = document.createElement('div');
        reading.className = 'station_metric_reading';
        var strong = document.createElement('strong');
        strong.textContent = value;
        reading.appendChild(strong);
        if (unit) {
            var unitText = document.createElement('span');
            unitText.textContent = unit;
            reading.appendChild(unitText);
        }
        var detail = document.createElement('small');
        detail.textContent = note;
        card.appendChild(eyebrow);
        card.appendChild(reading);
        card.appendChild(detail);
        return card;
    }

    function createCompassCard(degree, speed, index) {
        var card = document.createElement('article');
        card.className = 'station_metric_card station_compass_card is-direction';
        var calm = isCalm(speed);
        var hasDirection = degree !== null && !calm;
        var forecastLabel = Number.isInteger(index) ? '+' + forecastHour(index) + '시간 예보' : '48시간 예보';
        var speedLabel = speed === null ? '' : ', 풍속 ' + formatNumber(speed) + ' 미터 매 초';
        card.setAttribute('aria-label', calm
            ? forecastLabel + ' 정온' + speedLabel + '. 0.4 미터 매 초 이하여서 풍향을 표시하지 않음'
            : hasDirection
            ? forecastLabel + ' 풍향 ' + directionName(degree) + ', ' + Math.round(degree) + '도'
                + speedLabel + '. 바람이 불어오는 방향'
            : '48시간 예보 풍향 자료 없음');
        var label = document.createElement('span');
        label.className = 'station_metric_label';
        label.textContent = calm ? '첫 예보 바람' : (!hasDirection ? '풍향 예보' : '첫 유효 풍향');
        var content = document.createElement('div');
        content.className = 'station_compass_content';
        var dial = document.createElement('div');
        dial.className = 'station_compass';
        dial.setAttribute('aria-hidden', 'true');
        ['N', 'E', 'S', 'W'].forEach(function (point) {
            var cardinal = document.createElement('span');
            cardinal.className = 'station_compass_' + point.toLowerCase();
            cardinal.textContent = point;
            dial.appendChild(cardinal);
        });
        if (hasDirection) {
            var arrow = document.createElement('span');
            arrow.className = 'station_compass_arrow';
            arrow.style.setProperty('--wind-bearing', degree + 'deg');
            dial.appendChild(arrow);
        }
        var copy = document.createElement('div');
        copy.className = 'station_compass_copy';
        var name = document.createElement('strong');
        name.textContent = calm ? '정온' : (hasDirection ? directionName(degree) : '—');
        var degreeText = document.createElement('span');
        degreeText.textContent = calm ? formatNumber(speed) + ' m/s · 풍향 없음'
            : !hasDirection ? '풍향 자료 없음'
            : Math.round(degree) + '°' + (speed === null ? '' : ' · ' + formatNumber(speed) + ' m/s');
        var note = document.createElement('small');
        note.textContent = calm ? '0.4 m/s 이하' : '바람이 불어오는 방향';
        copy.appendChild(name);
        copy.appendChild(degreeText);
        copy.appendChild(note);
        content.appendChild(dial);
        content.appendChild(copy);
        card.appendChild(label);
        card.appendChild(content);
        return card;
    }

    function setPanelHeading(element, start, length) {
        var heading = document.getElementById('station_chart_heading');
        var period = document.getElementById('station_chart_period');
        var source = document.getElementById('station_chart_source');
        var labels = {
            wdws: '풍향·풍속 시계열',
            tmp: '기온 시계열',
            pcp: '1시간 예상 강수량',
            pty: '강수형태 변화',
            sno: '1시간 신적설 시계열',
            reh: '상대습도 시계열',
            sky: '하늘상태 변화',
            wav: '파고 시계열',
            swdn: '일사강도 시계열' + (activeSolarResolutionHours === 3 ? ' · 3시간 간격' : '')
        };
        if (heading) heading.textContent = labels[element] || '기상 시계열';
        if (source) source.textContent = element === 'swdn' ? 'KIM NE57 · 원자료 8 km'
            : element === 'wav' ? '기상청 단기예보 · DFS 5 km · 해상 제공'
            : '기상청 단기예보 · DFS 5 km';
        if (period) period.textContent = element === 'pcp' || element === 'sno'
            ? formatTimestamp(start - HOUR, false) + ' – '
                + formatTimestamp(start + Math.max(0, length - 1) * HOUR, false) + ' KST'
            : formatTimestamp(start, false) + ' – '
                + formatTimestamp(start + Math.max(0, length - 1) * HOUR, false) + ' KST';
    }

    function renderSummary(element, data, date) {
        var host = document.getElementById('station_chart_summary');
        var description = document.getElementById('station_chart_description');
        if (!host) return '';
        var start = startTimestamp(date);
        var fragment = document.createDocumentFragment();
        var summaryText = '';

        if (element === 'wdws') {
            var windEntries = data.map(function (item, index) {
                var speed = finiteValue(item && item[0]);
                return {
                    speed: speed,
                    degree: normalizedDegree(item && item[1]),
                    calm: isCalm(speed),
                    index: index
                };
            });
            var speedEntries = windEntries.filter(function (item) { return item.speed !== null; });
            if (!speedEntries.length) return '';
            var directionEntries = windEntries.filter(function (item) { return item.degree !== null && !item.calm; });
            var speeds = speedEntries.map(function (item) { return item.speed; });
            var firstSpeed = speedEntries[0];
            var firstDirection = directionEntries.length ? directionEntries[0] : null;
            fragment.appendChild(createMetricCard(firstSpeed.index === 0 ? '첫 예보 풍속' : '첫 유효 풍속',
                formatNumber(firstSpeed.speed), 'm/s', '+' + forecastHour(firstSpeed.index) + '시간 예보', 'wind'));
            fragment.appendChild(createMetricCard('48시간 범위',
                formatNumber(Math.min.apply(null, speeds)) + ' – ' + formatNumber(Math.max.apply(null, speeds)),
                'm/s', '평균 ' + formatNumber(average(speeds)) + ' m/s', 'range'));
            var compassEntry = firstDirection || firstSpeed;
            fragment.appendChild(createCompassCard(
                compassEntry ? compassEntry.degree : null,
                compassEntry ? compassEntry.speed : null,
                compassEntry ? compassEntry.index : null));
            var speedSummary = firstSpeed.index === 0
                ? '첫 예보 풍속은 ' + formatNumber(firstSpeed.speed) + '미터 매 초입니다. '
                : '첫 유효 풍속은 +' + forecastHour(firstSpeed.index) + '시간 예보의 '
                    + formatNumber(firstSpeed.speed) + '미터 매 초입니다. ';
            var allCalm = speedEntries.every(function (item) { return item.calm; });
            var directionSummary = firstDirection
                ? (firstDirection.index === 0 ? '첫 예보 풍향은 '
                    : '첫 유효 풍향은 +' + forecastHour(firstDirection.index) + '시간 예보의 ')
                    + directionName(firstDirection.degree) + '입니다.'
                : (allCalm ? '48시간 예보는 정온(0.4미터 매 초 이하)입니다.'
                    : '48시간 예보에 유효한 풍향 자료가 없습니다.');
            summaryText = speedSummary + '48시간 풍속은 '
                + formatNumber(Math.min.apply(null, speeds)) + '에서 '
                + formatNumber(Math.max.apply(null, speeds)) + '미터 매 초 범위이며 평균은 '
                + formatNumber(average(speeds)) + '미터 매 초입니다. ' + directionSummary;
        } else {
            var values = data.map(function (item, index) {
                return { value: finiteValue(item && item[0]), index: index };
            }).filter(function (item) { return item.value !== null; });
            if (!values.length) return '';
            var numbers = values.map(function (item) { return item.value; });
            var first = values[0];
            var isTemperature = element === 'tmp';
            var unit = isTemperature ? '℃' : 'W/㎡';
            var tone = isTemperature ? 'temperature' : 'solar';
            fragment.appendChild(createMetricCard(first.index === 0 ? '첫 예보' : '첫 유효 값',
                formatNumber(first.value), unit, '+' + forecastHour(first.index) + '시간 예보', tone));
            fragment.appendChild(createMetricCard(isTemperature ? '최저 기온' : '평균 강도',
                formatNumber(isTemperature ? Math.min.apply(null, numbers) : average(numbers)), unit,
                isTemperature ? '48시간 최저' : '유효 시간 평균', 'range'));
            fragment.appendChild(createMetricCard(isTemperature ? '최고 기온' : '최대 강도',
                formatNumber(Math.max.apply(null, numbers)), unit, '48시간 최고', tone));
            summaryText = (isTemperature ? '기온은 ' : 'KIM 일사강도'
                + (activeSolarResolutionHours === 3 ? ' 3시간 간격 샘플은 ' : '는 '))
                + formatNumber(Math.min.apply(null, numbers)) + unit + '에서 '
                + formatNumber(Math.max.apply(null, numbers)) + unit + ' 범위이며 평균은 '
                + formatNumber(average(numbers)) + unit + '입니다.';
        }

        host.replaceChildren(fragment);
        if (description) description.textContent = summaryText;
        var chart = document.getElementById('chart');
        if (chart) chart.setAttribute('aria-label', summaryText + ' 아래에서 시간별 수치표를 펼쳐 확인할 수 있습니다.');
        setPanelHeading(element, start, data.length);
        return summaryText;
    }

    function precipitationTotal(slots) {
        var valid = slots.filter(function (slot) { return slot.amount.kind !== 'missing'; });
        var lower = valid.reduce(function (sum, slot) { return sum + slot.amount.lower; }, 0);
        var unbounded = valid.some(function (slot) { return slot.amount.upper === Infinity; });
        var upper = unbounded ? Infinity
            : valid.reduce(function (sum, slot) { return sum + slot.amount.upper; }, 0);
        return { valid: valid.length, lower: lower, upper: upper };
    }

    function precipitationTotalText(total) {
        if (!total.valid) return { value: '—', unit: '', spoken: '자료 없음' };
        if (total.upper === Infinity) {
            return { value: formatNumber(total.lower), unit: 'mm 이상', spoken: formatNumber(total.lower) + '밀리미터 이상' };
        }
        if (Math.abs(total.upper - total.lower) < 0.0001) {
            return { value: formatNumber(total.lower), unit: 'mm', spoken: formatNumber(total.lower) + '밀리미터' };
        }
        return {
            value: formatNumber(total.lower) + ' – <' + formatNumber(total.upper),
            unit: 'mm',
            spoken: formatNumber(total.lower) + '밀리미터 이상 ' + formatNumber(total.upper) + '밀리미터 미만'
        };
    }

    function rainPeriods(slots) {
        var groups = [];
        slots.forEach(function (slot) {
            if (!slot.amount.rain) return;
            var last = groups[groups.length - 1];
            if (last && slot.hour === last.last.hour + 1) last.last = slot;
            else groups.push({ first: slot, last: slot });
        });
        return groups;
    }

    function rainPeriodNote(groups) {
        if (!groups.length) return '48시간 강수 신호 없음';
        var visible = groups.slice(0, 2).map(function (group) {
            var start = group.first.timestamp - HOUR;
            var startDate = new Date(start), endDate = new Date(group.last.timestamp);
            var crossesDate = startDate.getUTCFullYear() !== endDate.getUTCFullYear()
                || startDate.getUTCMonth() !== endDate.getUTCMonth()
                || startDate.getUTCDate() !== endDate.getUTCDate();
            return formatHourText(start, true) + '–' + formatHourText(group.last.timestamp, crossesDate);
        });
        if (groups.length > 2) visible.push('외 ' + (groups.length - 2) + '구간');
        return visible.join(' · ');
    }

    function renderPrecipitationSummary(slots) {
        var host = document.getElementById('station_chart_summary');
        var description = document.getElementById('station_chart_description');
        if (!host || !slots.length) return '';
        var validAmounts = slots.filter(function (slot) { return slot.amount.kind !== 'missing'; });
        var validProbabilities = slots.filter(function (slot) { return slot.probability !== null; });
        if (!validAmounts.length && !validProbabilities.length) return '';

        var total = precipitationTotal(slots);
        var totalText = precipitationTotalText(total);
        var rainy = slots.filter(function (slot) { return slot.amount.rain; });
        var firstRain = rainy[0] || null;
        var groups = rainPeriods(slots);
        var maxProbability = validProbabilities.length
            ? Math.max.apply(null, validProbabilities.map(function (slot) { return slot.probability; })) : null;
        var fragment = document.createDocumentFragment();
        fragment.appendChild(createMetricCard('48시간 예상 합계 범위', totalText.value, totalText.unit,
            (total.valid < 48 ? '유효 ' + total.valid + '/48시간 · ' : '') + '원문 범위를 하한·폭으로 표시', 'precipitation'));
        fragment.appendChild(createMetricCard('첫 강수', firstRain
            ? formatHourText(firstRain.timestamp, true) : '예상 없음', '', firstRain
            ? '직전 1시간 · ' + firstRain.amount.display : '강수량 예보 기준', 'precipitation'));
        fragment.appendChild(createMetricCard('강수 예상 시간', String(rainy.length), '시간',
            (maxProbability === null ? '' : '최고 확률 ' + formatNumber(maxProbability, 0) + '% · ')
                + rainPeriodNote(groups), 'probability'));
        host.replaceChildren(fragment);

        var missingText = total.valid < 48 ? ' 강수량 자료가 없는 ' + (48 - total.valid) + '시간은 합계에서 제외했습니다.' : '';
        var firstText = firstRain
            ? ' 첫 강수 구간은 ' + formatPrecipitationPeriod(firstRain.timestamp) + '이며 원문 강수량은 '
                + firstRain.amount.display + '입니다.'
            : ' 강수량이 표시된 시간은 없습니다.';
        var probabilityText = maxProbability === null ? '' : ' 최고 강수확률은 ' + formatNumber(maxProbability, 0) + '퍼센트입니다.';
        var totalSummary = total.valid
            ? '향후 48시간 예상 강수량 합계는 ' + totalText.spoken
                + (total.upper === total.lower ? '입니다.' : ' 범위입니다.')
            : '향후 48시간 예상 강수량 합계 자료가 없습니다.';
        var summaryText = totalSummary
            + firstText + ' 강수 예상 시간은 총 ' + rainy.length + '시간입니다.' + probabilityText + missingText;
        if (description) description.textContent = summaryText;
        var chart = document.getElementById('chart');
        if (chart) chart.setAttribute('aria-label', summaryText
            + ' 막대의 진한 부분은 범위의 하한, 옅은 부분은 가능한 추가 범위입니다. 아래 수치표에서 API 원문을 확인할 수 있습니다.');
        setPanelHeading('pcp', slots[0].timestamp, slots.length);
        return summaryText;
    }

    function snowDisplayText(slot) {
        if (!slot || slot.display === '—') return '—';
        return /^\d+(?:\.\d+)?$/.test(slot.display) ? slot.display + 'cm' : slot.display;
    }

    function renderForecastElementSummary(element, slots) {
        var host = document.getElementById('station_chart_summary');
        var description = document.getElementById('station_chart_description');
        if (!host || !slots.length) return '';
        var fragment = document.createDocumentFragment();
        var summaryText = '';

        if (element === 'pty' || element === 'sky') {
            var validCategories = slots.filter(function (slot) { return slot.code !== null; });
            if (!validCategories.length) return '';
            var counts = Object.create(null);
            validCategories.forEach(function (slot) { counts[slot.label] = (counts[slot.label] || 0) + 1; });
            var dominant = Object.keys(counts).sort(function (left, right) { return counts[right] - counts[left]; })[0];
            var changes = validCategories.reduce(function (count, slot, index) {
                return count + (index > 0 && validCategories[index - 1].code !== slot.code ? 1 : 0);
            }, 0);
            fragment.appendChild(createMetricCard('첫 예보 상태', validCategories[0].label, '',
                '+' + validCategories[0].hour + '시간 예보', 'range'));
            fragment.appendChild(createMetricCard('가장 잦은 상태', dominant, '',
                counts[dominant] + '/' + validCategories.length + '시간', 'range'));
            fragment.appendChild(createMetricCard('상태 변화', String(changes), '회',
                '유효 ' + validCategories.length + '/48시간', 'range'));
            summaryText = '향후 48시간 ' + (element === 'pty' ? '강수형태' : '하늘상태')
                + '의 첫 유효 예보는 ' + validCategories[0].label + '이며, 가장 자주 나타나는 상태는 '
                + dominant + '입니다. 상태는 ' + changes + '회 바뀝니다.';
        } else {
            var valid = slots.filter(function (slot) { return slot.value !== null; });
            if (!valid.length) return '';
            var numbers = valid.map(function (slot) { return slot.value; });
            var first = valid[0];
            var min = Math.min.apply(null, numbers), max = Math.max.apply(null, numbers);
            var spec = element === 'sno'
                ? { label: '1시간 신적설', unit: 'cm', tone: 'precipitation' }
                : element === 'reh'
                ? { label: '상대습도', unit: '%', tone: 'range' }
                : { label: '파고', unit: 'm', tone: 'wind' };
            var firstValue = element === 'sno' ? snowDisplayText(first) : formatNumber(first.value, element === 'reh' ? 0 : 1);
            var firstUnit = element === 'sno' ? '' : spec.unit;
            fragment.appendChild(createMetricCard('첫 유효 ' + spec.label, firstValue, firstUnit,
                '+' + first.hour + '시간 예보', spec.tone));
            fragment.appendChild(createMetricCard('48시간 최저', formatNumber(min, element === 'reh' ? 0 : 1), spec.unit,
                '유효 ' + valid.length + '/48시간', 'range'));
            fragment.appendChild(createMetricCard('48시간 최고', formatNumber(max, element === 'reh' ? 0 : 1), spec.unit,
                '평균 ' + formatNumber(average(numbers), element === 'reh' ? 0 : 1) + spec.unit, spec.tone));
            summaryText = '향후 48시간 ' + spec.label + '은 ' + formatNumber(min, element === 'reh' ? 0 : 1)
                + spec.unit + '에서 ' + formatNumber(max, element === 'reh' ? 0 : 1) + spec.unit
                + ' 범위이며 평균은 ' + formatNumber(average(numbers), element === 'reh' ? 0 : 1) + spec.unit + '입니다.';
            if (element === 'sno' && valid.some(function (slot) { return slot.approximate; })) {
                summaryText += ' 범위형 원문은 차트에서 경계값 또는 범위 중간값으로 표시하며 표에는 원문을 유지합니다.';
            }
            if (element === 'wav' && valid.length < 48) {
                summaryText += ' 파고가 제공되지 않는 육지 또는 결측 시간은 계산에서 제외했습니다.';
            }
        }

        host.replaceChildren(fragment);
        if (description) description.textContent = summaryText;
        var chart = document.getElementById('chart');
        if (chart) chart.setAttribute('aria-label', summaryText + ' 아래에서 시간별 수치표를 펼쳐 확인할 수 있습니다.');
        setPanelHeading(element, slots[0].timestamp, slots.length);
        return summaryText;
    }

    function appendCell(row, tag, text, scope) {
        var cell = document.createElement(tag);
        cell.textContent = text;
        if (scope) cell.setAttribute('scope', scope);
        row.appendChild(cell);
    }

    function renderPrecipitationTable(slots) {
        var host = document.getElementById('station_data_table');
        if (!host) return;
        var table = document.createElement('table');
        var caption = document.createElement('caption');
        caption.textContent = '향후 48시간 1시간 예상 강수량과 강수확률. 강수량은 기상청 API 원문을 유지합니다.';
        table.appendChild(caption);
        var thead = document.createElement('thead');
        var header = document.createElement('tr');
        appendCell(header, 'th', '예보 구간(KST)', 'col');
        appendCell(header, 'th', '1시간 강수량', 'col');
        appendCell(header, 'th', '강수확률', 'col');
        thead.appendChild(header);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        slots.forEach(function (slot) {
            var row = document.createElement('tr');
            appendCell(row, 'th', formatPrecipitationPeriod(slot.timestamp), 'row');
            appendCell(row, 'td', slot.amount.display);
            appendCell(row, 'td', slot.probability === null ? '—' : formatNumber(slot.probability, 0) + '%');
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        host.replaceChildren(table);
    }

    function renderForecastElementTable(element, slots) {
        var host = document.getElementById('station_data_table');
        if (!host) return;
        var spec = {
            pty: { caption: '향후 48시간 강수형태', heading: '강수형태' },
            sno: { caption: '향후 48시간 1시간 신적설. 범위형 값은 기상청 API 원문을 유지합니다.', heading: '1시간 신적설(cm)' },
            reh: { caption: '향후 48시간 상대습도', heading: '상대습도(%)' },
            sky: { caption: '향후 48시간 하늘상태', heading: '하늘상태' },
            wav: { caption: '향후 48시간 파고. 육지는 값이 제공되지 않을 수 있습니다.', heading: '파고(m)' }
        }[element];
        if (!spec) return;
        var table = document.createElement('table');
        var caption = document.createElement('caption');
        caption.textContent = spec.caption;
        table.appendChild(caption);
        var thead = document.createElement('thead');
        var header = document.createElement('tr');
        appendCell(header, 'th', element === 'sno' ? '예보 구간(KST)' : '예측 시각(KST)', 'col');
        appendCell(header, 'th', spec.heading, 'col');
        thead.appendChild(header);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        slots.forEach(function (slot) {
            var row = document.createElement('tr');
            appendCell(row, 'th', element === 'sno'
                ? formatPrecipitationPeriod(slot.timestamp) : formatTimestamp(slot.timestamp, false), 'row');
            appendCell(row, 'td', element === 'sno' ? snowDisplayText(slot) : slot.display);
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        host.replaceChildren(table);
    }

    function renderDataTable(element, data, date) {
        var host = document.getElementById('station_data_table');
        if (!host) return;
        var table = document.createElement('table');
        var caption = document.createElement('caption');
        var labels = { wdws: '풍향·풍속', tmp: '기온', swdn: '일사강도' };
        caption.textContent = (labels[element] || '기상') + ' 향후 48시간 예측 수치'
            + (element === 'swdn' && activeSolarResolutionHours === 3 ? ' (KIM 3시간 간격 샘플)' : '');
        table.appendChild(caption);
        var thead = document.createElement('thead');
        var header = document.createElement('tr');
        appendCell(header, 'th', '예측 시각(KST)', 'col');
        if (element === 'wdws') {
            appendCell(header, 'th', '풍속(m/s)', 'col');
            appendCell(header, 'th', '풍향', 'col');
        } else {
            appendCell(header, 'th', element === 'tmp' ? '기온(℃)' : '일사강도(W/㎡)', 'col');
        }
        thead.appendChild(header);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        var start = startTimestamp(date);
        data.forEach(function (item, index) {
            var row = document.createElement('tr');
            appendCell(row, 'th', formatTimestamp(start + index * HOUR, false), 'row');
            var value = finiteValue(item && item[0]);
            appendCell(row, 'td', formatNumber(value));
            if (element === 'wdws') {
                var degree = normalizedDegree(item && item[1]);
                appendCell(row, 'td', isCalm(value) ? '정온 (풍향 없음)'
                    : (degree === null ? '—' : directionName(degree) + ' (' + Math.round(degree) + '°)'));
            }
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        host.replaceChildren(table);
    }

    function transparent(color, opacity) {
        var hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color || '');
        if (hex) {
            var digits = hex[1].length === 3
                ? hex[1].split('').map(function (digit) { return digit + digit; }).join('') : hex[1];
            return 'rgba(' + parseInt(digits.slice(0, 2), 16) + ','
                + parseInt(digits.slice(2, 4), 16) + ',' + parseInt(digits.slice(4, 6), 16)
                + ',' + opacity + ')';
        }
        var rgb = /^rgba?\(([^)]+)\)$/i.exec(color || '');
        if (rgb) return 'rgba(' + rgb[1].split(',').slice(0, 3).join(',') + ',' + opacity + ')';
        return color;
    }

    function plainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    /** 차트 옵션 전용 병합. 배열은 덮어쓰고 객체만 재귀적으로 합친다. */
    function mergeOptions() {
        var result = {};
        Array.prototype.forEach.call(arguments, function (source) {
            if (!plainObject(source)) return;
            Object.keys(source).forEach(function (key) {
                var value = source[key];
                if (plainObject(value)) result[key] = mergeOptions(plainObject(result[key]) ? result[key] : {}, value);
                else result[key] = Array.isArray(value) ? value.slice() : value;
            });
        });
        return result;
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var chartSequence = 0;

    function svgNode(name, attributes, text) {
        var node = document.createElementNS(SVG_NS, name);
        Object.keys(attributes || {}).forEach(function (key) {
            if (attributes[key] !== null && attributes[key] !== undefined) node.setAttribute(key, attributes[key]);
        });
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function pointValue(point) {
        var value = plainObject(point) ? point.y : point;
        var number = Number(value);
        return value === null || value === undefined || !Number.isFinite(number) ? null : number;
    }

    function paint(value, fallback) {
        if (typeof value === 'string') return value;
        if (value && Array.isArray(value.stops) && value.stops.length) return value.stops[0][1];
        return fallback;
    }

    function axisRange(axisOptions, series, axisIndex) {
        var values = [];
        series.forEach(function (item) {
            if (Number(item.options.yAxis || 0) !== axisIndex || item.type === 'wind-vector') return;
            item.data.forEach(function (point) {
                var value = pointValue(point);
                if (value !== null) values.push(value);
            });
        });
        var minimum = Number(axisOptions.min);
        var maximum = Number(axisOptions.max);
        if (!Number.isFinite(minimum)) minimum = values.length ? Math.min.apply(null, values) : 0;
        if (!Number.isFinite(maximum)) maximum = values.length ? Math.max.apply(null, values) : minimum + 1;
        if (minimum === maximum) maximum = minimum + 1;
        return { min: minimum, max: maximum };
    }

    function lineSegments(data, xFor, yFor) {
        var segments = [];
        var current = [];
        data.forEach(function (point, index) {
            var value = pointValue(point);
            if (value === null) {
                if (current.length) segments.push(current);
                current = [];
                return;
            }
            current.push([xFor(index), yFor(value)]);
        });
        if (current.length) segments.push(current);
        return segments;
    }

    function pathFor(points) {
        return points.map(function (point, index) {
            return (index ? 'L' : 'M') + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
        }).join(' ');
    }

    function addWindArrow(layer, x, y, speed, direction, color) {
        if (!Number.isFinite(speed) || !Number.isFinite(direction)) return;
        var group = svgNode('g', {
            transform: 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') rotate(' + direction.toFixed(1) + ')',
            class: 'station-chart-wind-arrow'
        });
        group.appendChild(svgNode('line', { x1: 0, y1: 7, x2: 0, y2: -8, stroke: color, 'stroke-width': 1.5 }));
        group.appendChild(svgNode('path', { d: 'M -3 -4 L 0 -9 L 3 -4', fill: 'none', stroke: color, 'stroke-width': 1.5 }));
        group.appendChild(svgNode('title', {}, formatNumber(speed) + ' m/s · ' + Math.round(direction) + '°'));
        layer.appendChild(group);
    }

    /**
     * 이 프로젝트에 필요한 선·영역·막대·상태 밴드·풍향 기호만 그리는 작은 SVG 렌더러다.
     * 반환 객체는 화면 테스트와 테마 재렌더링에 필요한 최소 차트 상태를 제공한다.
     */
    function createChart(hostId, options) {
        var host = document.getElementById(hostId);
        if (!host) return null;
        host.replaceChildren();
        host.classList.add('station-chart-native');
        var width = Math.max(320, Math.round(host.clientWidth || 760));
        var height = Math.max(240, Math.round(host.clientHeight || 350));
        var axes = Array.isArray(options.yAxis) ? options.yAxis : [options.yAxis || {}];
        var baseSeries = options.plotOptions && options.plotOptions.series || {};
        var chartType = options.chart && options.chart.type || 'line';
        var series = (options.series || []).map(function (definition) {
            var merged = mergeOptions(baseSeries, definition);
            return {
                type: merged.type || chartType,
                name: merged.name || '',
                data: definition.data || [],
                userOptions: definition,
                options: merged
            };
        });
        var left = 50;
        // 두 번째 축이 실제 값 축인지(제목 있음) 윈드바브 레인 같은 배치용 밴드인지 구분한다.
        // 배치용 밴드(min 0, max 1, 제목 없음)에 눈금을 그리면 1·1·1·0·0 처럼 무의미한 라벨이 남는다.
        var secondaryAxis = axes.length > 1 ? (axes[1] || {}) : null;
        var secondaryLabelled = Boolean(secondaryAxis && secondaryAxis.visible !== false
            && secondaryAxis.title && secondaryAxis.title.text);
        // 라벨 없는 경우에도 마지막 x축 라벨의 절반이 들어갈 여백은 남긴다.
        var right = secondaryLabelled ? 48 : 30;
        var top = 14;
        var bottom = 48;
        var plotWidth = Math.max(1, width - left - right);
        var plotHeight = Math.max(1, height - top - bottom);
        var count = Math.max(1, series.reduce(function (maximum, item) {
            return Math.max(maximum, item.data.length);
        }, 0));
        var ranges = axes.map(function (axis, index) { return axisRange(axis || {}, series, index); });
        var xFor = function (index) { return left + (count <= 1 ? plotWidth / 2 : index * plotWidth / (count - 1)); };
        var yFor = function (value, axisIndex) {
            var range = ranges[axisIndex] || ranges[0];
            return top + (range.max - value) / (range.max - range.min) * plotHeight;
        };
        var svg = svgNode('svg', {
            class: 'station-chart-root', viewBox: '0 0 ' + width + ' ' + height,
            width: '100%', height: '100%', role: 'presentation', focusable: 'false',
            'data-chart-renderer': 'native-svg'
        });
        var textColor = cssVar('--text-2', '#9fb0c3');
        var gridColor = cssVar('--stroke-strong', 'rgba(148,163,184,.28)');
        var clipId = 'station-chart-clip-' + (++chartSequence);
        var defs = svgNode('defs');
        var clip = svgNode('clipPath', { id: clipId });
        clip.appendChild(svgNode('rect', { x: left, y: top, width: plotWidth, height: plotHeight }));
        defs.appendChild(clip);
        svg.appendChild(defs);
        var grid = svgNode('g', { class: 'station-chart-grid' });
        var primaryVisible = axes[0].visible !== false;
        if (primaryVisible) {
            for (var tick = 0; tick <= 4; tick += 1) {
                var y = top + tick * plotHeight / 4;
                var value = ranges[0].max - tick * (ranges[0].max - ranges[0].min) / 4;
                grid.appendChild(svgNode('line', { x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: gridColor, 'stroke-dasharray': '3 4' }));
                grid.appendChild(svgNode('text', { x: left - 7, y: y + 4, fill: textColor, 'font-size': 10, 'text-anchor': 'end' }, formatNumber(value, Math.abs(value) < 10 ? 1 : 0)));
            }
        }
        if (secondaryLabelled) {
            for (var rightTick = 0; rightTick <= 4; rightTick += 1) {
                var rightY = top + rightTick * plotHeight / 4;
                var rightValue = ranges[1].max - rightTick * (ranges[1].max - ranges[1].min) / 4;
                grid.appendChild(svgNode('text', { x: left + plotWidth + 7, y: rightY + 4, fill: textColor, 'font-size': 10, 'text-anchor': 'start' },
                    formatNumber(rightValue, Math.abs(rightValue) < 10 ? 1 : 0)));
            }
        }
        var start = baseSeries.pointStart || 0;
        var labelIndexes = [];
        var maxLabelCount = width < 420 ? 4 : (width < 640 ? 6 : 9);
        var labelStep = count <= maxLabelCount
            ? 1 : Math.max(1, Math.ceil((count - 1) / (maxLabelCount - 1)));
        for (var labelIndex = 0; labelIndex < count; labelIndex += labelStep) labelIndexes.push(labelIndex);
        if (labelIndexes[labelIndexes.length - 1] !== count - 1) labelIndexes.push(count - 1);
        labelIndexes.forEach(function (index) {
            var date = new Date(start + index * HOUR);
            var label = pad(date.getUTCHours()) + ':00 ' + pad(date.getUTCMonth() + 1) + '.' + pad(date.getUTCDate());
            grid.appendChild(svgNode('line', { x1: xFor(index), y1: top + plotHeight, x2: xFor(index), y2: top + plotHeight + 5, stroke: gridColor }));
            grid.appendChild(svgNode('text', { x: xFor(index), y: height - 18, fill: textColor, 'font-size': 9, 'text-anchor': 'middle' }, label));
        });
        svg.appendChild(grid);
        var marks = svgNode('g', { class: 'station-chart-marks', 'clip-path': 'url(#' + clipId + ')' });
        var stackBases = Object.create(null);
        series.forEach(function (item, seriesIndex) {
            var axisIndex = Number(item.options.yAxis || 0);
            var stroke = paint(item.options.color, PALETTE.wind);
            if (item.type === 'column') {
                var columnWidth = Math.max(2, Math.min(18, plotWidth / count * 0.68));
                item.data.forEach(function (point, index) {
                    var value = pointValue(point);
                    if (value === null) return;
                    var stackKey = axisIndex + ':' + index + ':' + (item.options.stack || seriesIndex);
                    var stacked = !!item.options.stack;
                    var base = stacked ? (stackBases[stackKey] || 0) : Math.max(0, ranges[axisIndex].min);
                    if (stacked) stackBases[stackKey] = base + value;
                    var y0 = yFor(base, axisIndex);
                    var y1 = yFor(base + value, axisIndex);
                    var pointColor = plainObject(point) && point.color ? point.color : stroke;
                    marks.appendChild(svgNode('rect', {
                        x: xFor(index) - columnWidth / 2, y: Math.min(y0, y1), width: columnWidth,
                        height: Math.max(1, Math.abs(y0 - y1)), fill: paint(pointColor, stroke), rx: item.options.borderRadius || 1,
                        opacity: seriesIndex === 1 && stacked ? 0.58 : 0.88
                    }));
                });
                return;
            }
            if (item.type === 'wind-vector') {
                item.data.forEach(function (point, index) {
                    if (!Array.isArray(point) || point[0] === null || point[1] === null) return;
                    addWindArrow(marks, xFor(index), yFor(0.5, axisIndex), Number(point[0]), Number(point[1]), stroke);
                });
                return;
            }
            if (item.type === 'scatter') {
                item.data.forEach(function (point, index) {
                    var value = pointValue(point);
                    if (value === null) return;
                    var x = xFor(index), y = yFor(value, axisIndex);
                    marks.appendChild(svgNode('path', { d: 'M' + x + ' ' + (y - 5) + ' L' + (x - 5) + ' ' + (y + 4) + ' L' + (x + 5) + ' ' + (y + 4) + ' Z', fill: stroke }));
                });
                return;
            }
            lineSegments(item.data, xFor, function (value) { return yFor(value, axisIndex); }).forEach(function (points) {
                var path = pathFor(points);
                if (item.type === 'area-line' && points.length > 1) {
                    var baseline = yFor(Math.max(0, ranges[axisIndex].min), axisIndex);
                    marks.appendChild(svgNode('path', {
                        d: path + ' L' + points[points.length - 1][0] + ' ' + baseline + ' L' + points[0][0] + ' ' + baseline + ' Z',
                        fill: transparent(paint(item.options.fillColor, stroke), 0.18), stroke: 'none'
                    }));
                }
                marks.appendChild(svgNode('path', {
                    d: path, fill: 'none', stroke: stroke, 'stroke-width': item.options.lineWidth || 2,
                    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
                }));
            });
        });
        svg.appendChild(marks);
        host.appendChild(svg);

        var tooltip = document.createElement('div');
        tooltip.className = 'station-chart-svg-tooltip';
        tooltip.hidden = true;
        host.appendChild(tooltip);
        if (options.tooltip && typeof options.tooltip.formatter === 'function') {
            svg.addEventListener('pointermove', function (event) {
                var bounds = svg.getBoundingClientRect();
                var relative = Math.max(0, Math.min(plotWidth, (event.clientX - bounds.left) * width / bounds.width - left));
                var index = Math.max(0, Math.min(count - 1, Math.round(relative / plotWidth * (count - 1))));
                tooltip.innerHTML = options.tooltip.formatter.call({ x: start + index * HOUR });
                tooltip.hidden = false;
                tooltip.style.left = Math.min(host.clientWidth - tooltip.offsetWidth - 8, Math.max(8, event.clientX - bounds.left + 12)) + 'px';
                tooltip.style.top = Math.max(8, event.clientY - bounds.top - tooltip.offsetHeight - 12) + 'px';
            });
            svg.addEventListener('pointerleave', function () { tooltip.hidden = true; });
        }
        return {
            options: options,
            series: series,
            container: host,
            destroy: function () {
                host.replaceChildren();
                host.classList.remove('station-chart-native');
            }
        };
    }

    function commonOptions(start, length) {
        var text = cssVar('--text', '#e6edf6');
        var muted = cssVar('--text-2', '#9fb0c3');
        var stroke = cssVar('--stroke-strong', 'rgba(148,163,184,.28)');
        var surface = cssVar('--surface-solid', '#111a2c');
        var animate = !reducedMotion();
        return {
            chart: {
                backgroundColor: 'transparent',
                animation: animate ? { duration: 260 } : false,
                spacing: [16, 10, 6, 4],
                zoomType: window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? '' : 'x',
                resetZoomButton: { theme: { fill: surface, stroke: stroke, style: { color: text }, r: 8 } }
            },
            title: { text: null },
            xAxis: {
                type: 'datetime',
                min: start,
                max: start + Math.max(0, length - 1) * HOUR,
                tickPositioner: function () {
                    var positions = [];
                    for (var index = 0; index < length; index += 6) positions.push(start + index * HOUR);
                    if (positions[positions.length - 1] !== start + (length - 1) * HOUR) {
                        positions.push(start + (length - 1) * HOUR);
                    }
                    return positions;
                },
                labels: {
                    useHTML: false,
                    style: { color: muted, fontSize: '10px' },
                    formatter: function () { return formatTimestamp(this.value, true); }
                },
                lineColor: stroke,
                tickColor: stroke,
                tickLength: 5,
                gridLineWidth: 0,
                crosshair: { color: transparent(PALETTE.direction, 0.45), dashStyle: 'ShortDash', width: 1 }
            },
            yAxis: {
                title: { style: { color: muted, fontSize: '11px', fontWeight: '700' } },
                labels: { style: { color: muted, fontSize: '10px' } },
                gridLineColor: stroke,
                gridLineDashStyle: 'ShortDash',
                lineWidth: 0,
                tickAmount: 5
            },
            legend: { enabled: false },
            tooltip: {
                useHTML: true,
                backgroundColor: surface,
                borderColor: stroke,
                borderRadius: 12,
                shadow: false,
                padding: 11,
                style: { color: text, fontSize: '12px' }
            },
            plotOptions: {
                series: {
                    animation: animate ? { duration: 300 } : false,
                    pointStart: start,
                    pointInterval: HOUR,
                    connectNulls: false,
                    states: { inactive: { opacity: 1 } },
                    marker: { enabled: false, states: { hover: { enabled: true, radius: 4, lineWidth: 2 } } }
                }
            },
            credits: { enabled: false },
            exporting: { enabled: false },
            responsive: {
                rules: [{
                    condition: { maxWidth: 520 },
                    chartOptions: {
                        chart: { spacing: [10, 2, 4, 0] },
                        xAxis: { showLastLabel: false, labels: { style: { fontSize: '9px' } } }
                    }
                }]
            }
        };
    }

    function tooltipShell(timestamp, rows) {
        return '<div class="station_chart_tooltip"><b>' + formatTimestamp(timestamp, false) + ' KST</b>'
            + rows.map(function (row) {
                return '<span><i style="background:' + row.color + '"></i>' + escapeHtml(row.label)
                    + '<strong>' + escapeHtml(row.value) + '</strong></span>';
            }).join('') + '</div>';
    }

    function precipitationTooltip(slot) {
        return '<div class="station_chart_tooltip"><b>' + escapeHtml(formatPrecipitationPeriod(slot.timestamp)) + ' KST</b>'
            + '<span><i style="background:' + PALETTE.precipitation + '"></i>1시간 강수량<strong>'
            + escapeHtml(slot.amount.display) + '</strong></span>'
            + '<span><i style="background:' + PALETTE.probability + '"></i>강수확률<strong>'
            + escapeHtml(slot.probability === null ? '—' : formatNumber(slot.probability, 0) + '%')
            + '</strong></span></div>';
    }

    function renderWind(data, start) {
        var speeds = data.map(function (item) { return finiteValue(item && item[0]); });
        var valid = speeds.filter(function (value) { return value !== null; });
        if (!valid.length) return false;
        var directions = data.map(function (item) { return normalizedDegree(item && item[1]); });
        var barbs = data.map(function (item, index) {
            return index % 3 === 0 && !isCalm(speeds[index])
                ? [speeds[index], directions[index]] : [null, null];
        });
        var options = mergeOptions(commonOptions(start, data.length), {
            yAxis: [{
                title: { text: '풍속 (m/s)' },
                min: 0,
                max: Math.max(1, Math.ceil(Math.max.apply(null, valid) * 1.15)),
                height: '76%'
            }, {
                title: { text: null }, top: '82%', height: '18%', min: 0, max: 1,
                labels: { enabled: false }, gridLineWidth: 0, tickLength: 0, offset: 0
            }],
            tooltip: {
                formatter: function () {
                    var index = Math.max(0, Math.min(data.length - 1, Math.round((this.x - start) / HOUR)));
                    var direction = directions[index];
                    var calm = isCalm(speeds[index]);
                    return tooltipShell(this.x, [
                        { color: PALETTE.wind, label: '풍속', value: formatNumber(speeds[index]) + ' m/s' },
                        { color: PALETTE.direction, label: '풍향', value: calm ? '정온 · 풍향 없음'
                            : (direction === null ? '—' : directionName(direction) + ' · ' + Math.round(direction) + '°') }
                    ]);
                }
            },
            series: [{
                type: 'area-line', name: '풍속', data: speeds, yAxis: 0,
                color: PALETTE.wind, lineWidth: 3,
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [[0, transparent(PALETTE.wind, 0.34)], [1, transparent(PALETTE.wind, 0.02)]]
                }
            }, {
                type: 'wind-vector', name: '풍향', data: barbs, yAxis: 1,
                color: PALETTE.direction, lineWidth: 1.5, vectorLength: 17, enableMouseTracking: false
            }]
        });
        activeChart = createChart('chart', options);
        return true;
    }

    function renderTemperature(data, start) {
        var values = data.map(function (item) { return finiteValue(item && item[0]); });
        var valid = values.filter(function (value) { return value !== null; });
        if (!valid.length) return false;
        var min = Math.min.apply(null, valid), max = Math.max.apply(null, valid);
        var options = mergeOptions(commonOptions(start, data.length), {
            yAxis: { title: { text: '기온 (℃)' }, min: Math.floor(min) - 1, max: Math.max(Math.ceil(max) + 1, Math.floor(min) + 1) },
            tooltip: {
                formatter: function () {
                    var index = Math.max(0, Math.min(data.length - 1, Math.round((this.x - start) / HOUR)));
                    return tooltipShell(this.x, [{ color: PALETTE.temperature, label: '기온', value: formatNumber(values[index]) + ' ℃' }]);
                }
            },
            series: [{
                type: 'area-line', name: '기온', data: values,
                color: PALETTE.temperature, lineWidth: 3,
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [[0, transparent(PALETTE.temperature, 0.3)], [1, transparent(PALETTE.temperatureSoft, 0.02)]]
                }
            }]
        });
        activeChart = createChart('chart', options);
        return true;
    }

    function renderSolar(data, start) {
        var values = data.map(function (item) { return finiteValue(item && item[0]); });
        var valid = values.filter(function (value) { return value !== null; });
        if (!valid.length) return false;
        var max = Math.max.apply(null, valid);
        var options = mergeOptions(commonOptions(start, data.length), {
            chart: { type: 'column' },
            yAxis: { title: { text: '일사강도 (W/㎡)' }, min: 0, max: Math.max(1, Math.ceil(max * 1.12)) },
            tooltip: {
                formatter: function () {
                    var index = Math.max(0, Math.min(data.length - 1, Math.round((this.x - start) / HOUR)));
                    return tooltipShell(this.x, [{ color: PALETTE.solar, label: '일사강도', value: formatNumber(values[index], 0) + ' W/㎡' }]);
                }
            },
            plotOptions: {
                column: { borderWidth: 0, borderRadius: 4, groupPadding: 0.08, pointPadding: 0.08, maxPointWidth: 18 }
            },
            series: [{
                type: 'column', name: '일사강도', data: values,
                color: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [[0, PALETTE.solar], [1, PALETTE.solarHot]]
                }
            }]
        });
        activeChart = createChart('chart', options);
        return true;
    }

    function renderPrecipitation(slots) {
        var hasAmount = slots.some(function (slot) { return slot.amount.kind !== 'missing'; });
        var hasProbability = slots.some(function (slot) { return slot.probability !== null; });
        if (!hasAmount && !hasProbability) return false;
        var start = slots[0].timestamp;
        var lowerData = slots.map(function (slot) {
            return slot.amount.lower !== null && slot.amount.lower > 0 ? slot.amount.lower : null;
        });
        var rangeData = slots.map(function (slot) {
            var width = slot.amount.upper !== null && Number.isFinite(slot.amount.upper)
                ? Math.max(0, slot.amount.upper - slot.amount.lower) : 0;
            return width > 0 ? width : null;
        });
        var probabilities = slots.map(function (slot) { return slot.probability; });
        var unbounded = slots.map(function (slot) {
            return slot.amount.upper === Infinity ? slot.amount.lower : null;
        });
        var visualValues = slots.map(function (slot) {
            if (slot.amount.upper === Infinity) return slot.amount.lower;
            return Number.isFinite(slot.amount.upper) ? slot.amount.upper : null;
        }).filter(function (value) { return value !== null; });
        var visualMax = visualValues.length ? Math.max.apply(null, visualValues) : 0;
        var options = mergeOptions(commonOptions(start, slots.length), {
            chart: { type: 'column', alignTicks: false },
            xAxis: { crosshair: { color: transparent(PALETTE.precipitation, 0.42), dashStyle: 'ShortDash', width: 1 } },
            yAxis: [{
                title: { text: '1시간 강수량 (mm)' }, min: 0,
                max: Math.max(1, Math.ceil(visualMax * 1.15)), reversedStacks: false
            }, {
                title: { text: '강수확률 (%)' }, min: 0, max: 100, tickInterval: 25,
                opposite: true, gridLineWidth: 0
            }],
            tooltip: {
                shared: true,
                formatter: function () {
                    var index = Math.max(0, Math.min(slots.length - 1, Math.round((this.x - start) / HOUR)));
                    return precipitationTooltip(slots[index]);
                }
            },
            plotOptions: {
                column: {
                    stacking: 'normal', borderWidth: 0, groupPadding: 0.07, pointPadding: 0.08,
                    maxPointWidth: 18, minPointLength: 2
                },
                spline: { lineWidth: 2, marker: { enabled: true, radius: 2.5, lineWidth: 0 } }
            },
            series: [{
                type: 'column', name: '예상 강수량 하한', data: lowerData, yAxis: 0, stack: 'precipitation',
                color: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [[0, PALETTE.precipitation], [1, transparent(PALETTE.precipitation, 0.58)]]
                }
            }, {
                type: 'column', name: '예상 강수량 범위', data: rangeData, yAxis: 0, stack: 'precipitation',
                color: transparent(PALETTE.precipitationSoft, 0.5),
                borderColor: transparent(PALETTE.precipitation, 0.8), borderWidth: 1
            }, {
                type: 'scatter', name: '이상 범위', data: unbounded, yAxis: 0,
                color: PALETTE.precipitation, enableMouseTracking: false,
                marker: { enabled: true, symbol: 'triangle', radius: 5, lineWidth: 0 }
            }, {
                type: 'spline', name: '강수확률', data: probabilities, yAxis: 1,
                color: PALETTE.probability, connectNulls: false, zIndex: 4
            }]
        });
        activeChart = createChart('chart', options);
        return true;
    }

    function renderContinuousForecast(element, slots) {
        var values = slots.map(function (slot) { return slot.value; });
        var valid = values.filter(function (value) { return value !== null; });
        if (!valid.length) return false;
        var start = slots[0].timestamp;
        var max = Math.max.apply(null, valid);
        var spec = element === 'sno'
            ? { label: '1시간 신적설', unit: 'cm', color: PALETTE.snow, max: Math.max(1, Math.ceil(max * 1.15)) }
            : element === 'reh'
            ? { label: '상대습도', unit: '%', color: PALETTE.humidity, max: 100 }
            : { label: '파고', unit: 'm', color: PALETTE.wave, max: Math.max(1, Math.ceil(max * 1.15 * 10) / 10) };
        var options = mergeOptions(commonOptions(start, slots.length), {
            yAxis: {
                title: { text: spec.label + ' (' + spec.unit + ')' },
                min: 0,
                max: spec.max,
                tickAmount: element === 'reh' ? 6 : 5
            },
            tooltip: {
                formatter: function () {
                    var index = Math.max(0, Math.min(slots.length - 1, Math.round((this.x - start) / HOUR)));
                    var slot = slots[index];
                    var valueText = element === 'sno' ? snowDisplayText(slot)
                        : slot.value === null ? '—' : formatNumber(slot.value, element === 'reh' ? 0 : 1) + ' ' + spec.unit;
                    var timestamp = element === 'sno'
                        ? escapeHtml(formatPrecipitationPeriod(slot.timestamp))
                        : escapeHtml(formatTimestamp(slot.timestamp, false));
                    return '<div class="station_chart_tooltip"><b>' + timestamp + ' KST</b>'
                        + '<span><i style="background:' + spec.color + '"></i>' + escapeHtml(spec.label)
                        + '<strong>' + escapeHtml(valueText) + '</strong></span></div>';
                }
            },
            series: [{
                type: 'area-line', name: spec.label, data: values,
                color: spec.color, lineWidth: 3,
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [[0, transparent(spec.color, 0.3)], [1, transparent(spec.color, 0.02)]]
                }
            }]
        });
        activeChart = createChart('chart', options);
        return true;
    }

    /** PTY/SKY는 수치 크기가 아니라 시간별 상태이므로 높이가 같은 색상 밴드로 그린다. */
    function renderCategoricalForecast(element, slots) {
        if (!slots.some(function (slot) { return slot.code !== null; })) return false;
        var start = slots[0].timestamp;
        var label = element === 'pty' ? '강수형태' : '하늘상태';
        var data = slots.map(function (slot) {
            return slot.code === null ? null : { y: 1, color: slot.color, custom: { label: slot.label } };
        });
        var options = mergeOptions(commonOptions(start, slots.length), {
            chart: { type: 'column' },
            yAxis: {
                title: { text: null }, min: 0, max: 1, visible: false,
                gridLineWidth: 0, tickLength: 0
            },
            tooltip: {
                formatter: function () {
                    var index = Math.max(0, Math.min(slots.length - 1, Math.round((this.x - start) / HOUR)));
                    return tooltipShell(slots[index].timestamp, [{
                        color: slots[index].color, label: label, value: slots[index].display
                    }]);
                }
            },
            plotOptions: {
                column: {
                    borderWidth: 0, borderRadius: 0, groupPadding: 0, pointPadding: 0.02,
                    minPointLength: 12, maxPointWidth: 30
                }
            },
            series: [{ type: 'column', name: label, data: data }]
        });
        activeChart = createChart('chart', options);
        return true;
    }

    function destroy() {
        if (activeChart) {
            activeChart.destroy();
            activeChart = null;
        }
        var chart = document.getElementById('chart');
        if (chart) chart.replaceChildren();
    }

    function clearSupportingContent() {
        ['station_chart_summary', 'station_data_table'].forEach(function (id) {
            var element = document.getElementById(id);
            if (element) element.replaceChildren();
        });
        var description = document.getElementById('station_chart_description');
        if (description) description.textContent = '';
    }

    function render(element, data, date) {
        if (element === 'pcp') {
            var precipitationSlots = normalizePrecipitation(data, date);
            if (!precipitationSlots.length) return false;
            destroy();
            clearSupportingContent();
            var precipitationSummary = renderPrecipitationSummary(precipitationSlots);
            if (!precipitationSummary) return false;
            renderPrecipitationTable(precipitationSlots);
            var precipitationRendered = renderPrecipitation(precipitationSlots);
            if (precipitationRendered) lastPayload = { element: element, data: data, date: date };
            return precipitationRendered;
        }
        if (FORECAST_CHART_ELEMENTS.has(element)) {
            var forecastSlots = normalizeForecastElement(data, date, element);
            if (!forecastSlots.length) return false;
            destroy();
            clearSupportingContent();
            var forecastSummary = renderForecastElementSummary(element, forecastSlots);
            if (!forecastSummary) return false;
            renderForecastElementTable(element, forecastSlots);
            var forecastRendered = element === 'pty' || element === 'sky'
                ? renderCategoricalForecast(element, forecastSlots)
                : renderContinuousForecast(element, forecastSlots);
            if (forecastRendered) lastPayload = { element: element, data: data, date: date };
            return forecastRendered;
        }
        if (!Array.isArray(data) || !data.length) return false;
        var sourceData = data;
        var sourceDate = date;
        activeSolarResolutionHours = element === 'swdn' ? solarResolutionHours(date) : 1;
        if (element === 'swdn' && activeSolarResolutionHours === 3) {
            data = maskLegacySolarSlots(data, date);
        }
        // 서버 호환 배열은 발표시각 슬롯을 포함한다. 실제 단기예보가 시작되는 +1h부터만 노출한다.
        data = (data.length > 48 ? data.slice(1, 49) : data.slice(0, 48));
        date = shiftDateToken(date, 1);
        destroy();
        clearSupportingContent();
        var summary = renderSummary(element, data, date);
        if (!summary) return false;
        renderDataTable(element, data, date);
        var start = startTimestamp(date);
        var rendered = element === 'wdws' ? renderWind(data, start)
            : element === 'tmp' ? renderTemperature(data, start) : renderSolar(data, start);
        if (rendered) lastPayload = { element: element, data: sourceData, date: sourceDate };
        return rendered;
    }

    function refreshTheme() {
        if (!lastPayload || !activeChart) return;
        var details = document.getElementById('station_data_details');
        var wasOpen = !!(details && details.open);
        render(lastPayload.element, lastPayload.data, lastPayload.date);
        if (details) details.open = wasOpen;
    }

    window.WEATHER_GRID_STATION_CHARTS = {
        ensureReady: ensureReady,
        render: render,
        destroy: destroy,
        refreshTheme: refreshTheme,
        getChart: function () { return activeChart; }
    };
})();
