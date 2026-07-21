/**
 * 지점 상세예보 스트립.
 *
 * 일반 요소는 /api/weather/timeseries 차트와 병렬로 조회하고, 단기예보 요소는 같은 응답을
 * 상세 카드와 48시간 차트가 공유해 중복 상류 요청을 만들지 않는다.
 */
(function () {
    'use strict';

    var section = document.getElementById('forecast_strip_section');
    var strip = document.getElementById('forecast_strip');
    var state = document.getElementById('forecast_strip_state');
    var stateText = document.getElementById('forecast_strip_state_text');
    var retryButton = document.getElementById('forecast_strip_retry');
    var stationModal = document.querySelector('.station_modal');
    var sourceLabel = document.getElementById('forecast_strip_source');
    if (!section || !strip || !state || !stateText || !retryButton) return;

    var requestSequence = 0;
    var activeController = null;
    var activeTimeout = null;
    var lastRequest = null;
    var REQUEST_TIMEOUT_MS = 20000;

    var dateFormatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short'
    });
    var timeFormatter = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });

    function isMissing(value) {
        if (value === null || value === undefined || value === '') return true;
        var numeric = Number(value);
        return Number.isFinite(numeric) && (numeric === 9999 || numeric <= -900);
    }

    function numericText(value, suffix, digits) {
        if (isMissing(value)) return '—';
        var numeric = Number(value);
        if (!Number.isFinite(numeric)) return String(value);
        var rounded = digits === 1 ? Math.round(numeric * 10) / 10 : Math.round(numeric);
        return rounded + suffix;
    }

    /** PCP/SNO의 범위형 원문은 보존하고, 단순 수치에만 단위를 보완한다. */
    function amountText(value, unit) {
        if (isMissing(value)) return '—';
        var text = String(value).trim();
        return /^\d+(?:\.\d+)?$/.test(text) ? text + unit : text;
    }

    function windText(speedValue, directionValue) {
        var speed = isMissing(speedValue) ? null : Number(speedValue);
        var direction = isMissing(directionValue) ? null : Number(directionValue);
        if (!Number.isFinite(speed) && !Number.isFinite(direction)) return '—';
        var parts = [];
        if (Number.isFinite(speed)) parts.push((Math.round(speed * 10) / 10) + 'm/s');
        // 기상청 풍향장미 기준(0.4m/s 이하)은 방향성이 없는 정온으로 표시한다.
        if (Number.isFinite(speed) && speed <= 0.4) {
            parts.push('정온');
            return parts.join(' · ');
        }
        if (Number.isFinite(direction)) {
            var directions = ['북풍', '북동풍', '동풍', '남동풍', '남풍', '남서풍', '서풍', '북서풍'];
            parts.push(directions[Math.round((((direction % 360) + 360) % 360) / 45) % 8]);
        }
        return parts.join(' · ');
    }

    function forecastDate(raw) {
        if (raw === null || raw === undefined) return null;
        var value = String(raw).trim();
        var digits = value.replace(/\D/g, '');
        if (digits.length >= 10) {
            var y = digits.slice(0, 4), m = digits.slice(4, 6), d = digits.slice(6, 8);
            var h = digits.slice(8, 10), minute = digits.length >= 12 ? digits.slice(10, 12) : '00';
            var parsedKst = new Date(y + '-' + m + '-' + d + 'T' + h + ':' + minute + ':00+09:00');
            if (!Number.isNaN(parsedKst.getTime())) return parsedKst;
        }
        var parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function conditionInfo(item) {
        var precipitationLabel = item.precipitationTypeLabel == null
            ? '' : String(item.precipitationTypeLabel).trim();
        var precipitationCode = Number(item.precipitationType);
        var hasPrecipitation = precipitationLabel
            && !/^(없음|강수없음|해당없음)$/.test(precipitationLabel);
        if (!hasPrecipitation && Number.isFinite(precipitationCode)) hasPrecipitation = precipitationCode > 0;

        if (hasPrecipitation) {
            var labels = { 1: '비', 2: '비/눈', 3: '눈', 4: '소나기' };
            var resolvedLabel = precipitationLabel || labels[precipitationCode] || '강수';
            if ((resolvedLabel.includes('눈') && resolvedLabel.includes('비')) || precipitationCode === 2) {
                return { label: resolvedLabel, className: 'is-mixed' };
            }
            if (resolvedLabel.includes('눈') || precipitationCode === 3) {
                return { label: resolvedLabel, className: 'is-snow' };
            }
            return { label: resolvedLabel, className: 'is-rain' };
        }

        var skyLabel = item.skyLabel == null ? '' : String(item.skyLabel).trim();
        var skyCode = Number(item.skyCode);
        if (!skyLabel) {
            skyLabel = skyCode === 1 ? '맑음' : skyCode === 3 ? '구름많음' : skyCode === 4 ? '흐림' : '상태 미상';
        }
        return {
            label: skyLabel,
            className: skyCode === 1 || skyLabel.includes('맑') ? 'is-clear' : 'is-cloud'
        };
    }

    function appendText(parent, tagName, className, text) {
        var element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function metric(label, value) {
        var row = document.createElement('div');
        appendText(row, 'dt', '', label);
        appendText(row, 'dd', '', value);
        return row;
    }

    function buildCard(item) {
        var hour = Number(item.forecastHour);
        var card = document.createElement('li');
        card.className = 'forecast_card';
        if (Number.isFinite(hour)) card.dataset.forecastHour = String(hour);

        var date = forecastDate(item.forecastDateTime);
        var timeElement = document.createElement('time');
        timeElement.className = 'forecast_card_time';
        if (date) {
            timeElement.dateTime = date.toISOString();
            appendText(timeElement, 'span', 'forecast_card_date', dateFormatter.format(date));
            appendText(timeElement, 'strong', '', timeFormatter.format(date));
        } else {
            appendText(timeElement, 'span', 'forecast_card_date', '예보시간');
            appendText(timeElement, 'strong', '', Number.isFinite(hour) ? '+' + hour + 'h' : '—');
        }
        card.appendChild(timeElement);

        var condition = conditionInfo(item);
        var conditionRow = document.createElement('div');
        conditionRow.className = 'forecast_condition';
        var mark = document.createElement('span');
        mark.className = 'forecast_condition_mark ' + condition.className;
        mark.setAttribute('aria-hidden', 'true');
        conditionRow.appendChild(mark);
        appendText(conditionRow, 'span', 'forecast_condition_label', condition.label);
        card.appendChild(conditionRow);

        appendText(card, 'strong', 'forecast_temperature', numericText(item.temperature, '℃', 1));

        var metrics = document.createElement('dl');
        metrics.className = 'forecast_metrics';
        metrics.appendChild(metric('강수확률', numericText(item.precipitationProbability, '%', 0)));
        metrics.appendChild(metric('1시간 강수량', amountText(item.precipitationAmount, 'mm')));
        if (!isMissing(item.snowfallAmount)) {
            metrics.appendChild(metric('1시간 신적설', amountText(item.snowfallAmount, 'cm')));
        }
        metrics.appendChild(metric('상대습도', numericText(item.humidity, '%', 0)));
        if (!isMissing(item.waveHeight)) metrics.appendChild(metric('파고', numericText(item.waveHeight, 'm', 1)));
        metrics.appendChild(metric('바람', windText(item.windSpeed, item.windDirection)));
        card.appendChild(metrics);
        return card;
    }

    function showState(kind, message, canRetry) {
        section.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
        state.hidden = false;
        state.dataset.state = kind;
        stateText.textContent = message;
        retryButton.disabled = false;
        retryButton.removeAttribute('aria-busy');
        retryButton.hidden = !canRetry;
        strip.hidden = true;
    }

    function render(items, source) {
        var slots = items.filter(function (item) {
            var hour = Number(item && item.forecastHour);
            return item && Number.isFinite(hour) && hour >= 1 && hour <= 48;
        }).sort(function (a, b) { return Number(a.forecastHour) - Number(b.forecastHour); });

        if (!slots.length) throw new Error('EMPTY_FORECAST');
        if (sourceLabel) sourceLabel.textContent = (source || '기상청 단기예보') + ' · DFS 5 km · KST · +1~48h';

        var fragment = document.createDocumentFragment();
        slots.forEach(function (item) { fragment.appendChild(buildCard(item)); });
        strip.replaceChildren(fragment);
        strip.scrollLeft = 0;
        strip.hidden = false;
        state.hidden = true;
        section.setAttribute('aria-busy', 'false');
        retryButton.disabled = false;
        retryButton.removeAttribute('aria-busy');
    }

    /** 호출부가 상세 카드와 강수 차트에 같은 응답을 재사용할 수 있도록 계약을 고정한다. */
    function forecastResult(payload, items, params) {
        var response = payload && !Array.isArray(payload) ? payload : {};
        return Object.assign({}, response, {
            source: response.source || '기상청 단기예보',
            baseDate: response.baseDate || params.baseDate,
            baseTime: response.baseTime || params.baseTime,
            items: items
        });
    }

    async function loadForecast(params) {
        if (activeController) activeController.abort();
        if (activeTimeout) window.clearTimeout(activeTimeout);
        var controller = new AbortController();
        activeController = controller;
        var sequence = ++requestSequence;
        var timedOut = false;
        var timeout = window.setTimeout(function () {
            timedOut = true;
            controller.abort();
        }, REQUEST_TIMEOUT_MS);
        activeTimeout = timeout;
        lastRequest = params;
        strip.replaceChildren();
        showState('loading', '상세예보를 불러오는 중…', false);

        var query = new URLSearchParams({
            latitude: String(params.latitude),
            longitude: String(params.longitude),
            baseDate: String(params.baseDate),
            baseTime: String(params.baseTime)
        });

        try {
            var response = await fetch(apiUrl('/api/weather/point-forecast?' + query.toString()), {
                headers: { Accept: 'application/json' }, signal: controller.signal
            });
            if (!response.ok) throw new Error(response.status === 503 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_FAILED');
            var payload = await response.json();
            var items = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.items) ? payload.items : []);
            if (sequence !== requestSequence) return null;
            render(items, payload && !Array.isArray(payload) ? payload.source : null);
            return forecastResult(payload, items, params);
        } catch (error) {
            if (error && error.name === 'AbortError' && !timedOut) return null;
            if (sequence !== requestSequence) return null;
            var message = timedOut
                ? '상세예보 응답 시간이 초과되었습니다. 다시 시도해 주세요. 기존 차트는 계속 사용할 수 있습니다.'
                : (error && error.message === 'EMPTY_FORECAST'
                    ? '이 지점의 상세예보가 아직 제공되지 않습니다. 기존 차트는 계속 사용할 수 있습니다.'
                    : '상세예보를 불러오지 못했습니다. 기존 차트는 계속 사용할 수 있습니다.');
            showState('error', message, true);
            return null;
        } finally {
            window.clearTimeout(timeout);
            if (activeTimeout === timeout) activeTimeout = null;
            if (sequence === requestSequence && activeController === controller) activeController = null;
        }
    }

    function cancel() {
        requestSequence++;
        if (activeController) activeController.abort();
        if (activeTimeout) window.clearTimeout(activeTimeout);
        activeController = null;
        activeTimeout = null;
        section.setAttribute('aria-busy', 'false');
        retryButton.disabled = false;
        retryButton.removeAttribute('aria-busy');
    }

    retryButton.addEventListener('click', function () {
        if (!lastRequest) return;
        retryButton.disabled = true;
        retryButton.setAttribute('aria-busy', 'true');
        loadForecast(lastRequest);
    });

    if (stationModal) {
        new MutationObserver(function () {
            if (getComputedStyle(stationModal).display === 'none') cancel();
        }).observe(stationModal, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }

    window.WEATHER_GRID_STATION_FORECAST = {
        open: function (params) {
            if (!params || !params.latitude || !params.longitude || !params.baseDate || !params.baseTime) {
                return Promise.resolve(null);
            }
            var latitude = Number(params.latitude), longitude = Number(params.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Promise.resolve(null);
            // Spring/Worker 계약의 소수 8자리 상한에 맞춰 검색 입력의 과도한 정밀도를 정규화한다.
            return loadForecast({
                latitude: Math.round(latitude * 1e8) / 1e8,
                longitude: Math.round(longitude * 1e8) / 1e8,
                baseDate: params.baseDate,
                baseTime: params.baseTime
            });
        },
        cancel: cancel
    };
})();
