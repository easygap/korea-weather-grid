/** Spring의 비루트 context-path와 Cloudflare 정적 배포를 모두 지원한다. */
const WEATHER_GRID_CONTEXT_PATH = (document.querySelector('.app')?.dataset.contextPath || '').replace(/\/$/, '');
function apiUrl(path) {
    const normalized = path.startsWith('/') ? path : '/' + path;
    return WEATHER_GRID_CONTEXT_PATH + normalized;
}

function alertText(options) {
	return options.text || String(options.html || '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '');
}

function fireAlert(options) {
	return new Promise(function (resolve) {
		document.querySelectorAll('.app-alert').forEach(function (node) { node.remove(); });
		const dialog = document.createElement('dialog');
		dialog.className = 'app-alert';
		dialog.setAttribute('aria-labelledby', 'app_alert_title');
		const title = document.createElement('h2');
		title.id = 'app_alert_title';
		title.textContent = options.title || '알림';
		const body = document.createElement('p');
		body.textContent = alertText(options).trim();
		const actions = document.createElement('div');
		actions.className = 'app-alert-actions';
		let confirmed = false;
		if (options.showCancelButton) {
			const cancel = document.createElement('button');
			cancel.type = 'button';
			cancel.className = 'app-alert-cancel';
			cancel.textContent = options.cancelButtonText || '취소';
			cancel.addEventListener('click', function () { dialog.close(); });
			actions.appendChild(cancel);
		}
		const confirm = document.createElement('button');
		confirm.type = 'button';
		confirm.className = 'app-alert-confirm';
		confirm.textContent = options.confirmButtonText || '확인';
		confirm.addEventListener('click', function () {
			confirmed = true;
			dialog.close();
		});
		actions.appendChild(confirm);
		dialog.append(title, body, actions);
		dialog.addEventListener('close', function () {
			dialog.remove();
			resolve({ isConfirmed: confirmed });
		}, { once: true });
		document.body.appendChild(dialog);
		dialog.showModal();
	});
}

function setDataError(message, source) {
    const banner = document.getElementById('data_error');
    if (!banner) return;
    const text = banner.querySelector('[data-error-message], span');
    if (text) text.textContent = message || '기상 데이터를 불러오지 못했습니다.';
    banner.dataset.errorSource = source || 'grid';
    banner.hidden = false;
}

function clearDataError(source) {
    const banner = document.getElementById('data_error');
    if (!banner || (source && banner.dataset.errorSource !== source)) return;
    banner.hidden = true;
    delete banner.dataset.errorSource;
}

const paletteState = window.WeatherGridPaletteState;
if (!paletteState || !window.WeatherGridMapRuntime) {
	throw new Error('Palette state and map bootstrap must load before weather-grid');
}

/** 기존 소비자와 새 기능 모듈이 같은 공개 색상 계약을 공유한다. */
const WEATHER_GRID_WEATHER_ELEMENTS = paletteState.elements;
const monthlySolarThresholds = paletteState.solarThresholds;
const solarPalette = paletteState.solarPalette;
const kmaLatLonToGridFrac = window.WeatherGridMapRuntime.gridCoordinate;
function weatherElementMeta(element) { return paletteState.elementMeta(element); }
function weatherCategoryLabel(element, value) { return paletteState.categoryLabel(element, value); }
function isValidWeatherValue(element, value) { return paletteState.isValidValue(element, value); }
function weatherValueText(element, value) { return paletteState.valueText(element, value); }
function thresholdColor(value, thresholds, colors) {
	return paletteState.thresholdColor(value, thresholds, colors);
}
function windPaletteColor(value) { return paletteState.windColor(value); }
function findTmpColor(value) { return paletteState.temperatureColor(value); }
function findRainColor(value) { return paletteState.rainColor(value); }
function findSnowColor(value) { return paletteState.snowColor(value); }
function findHumidityColor(value) { return paletteState.humidityColor(value); }
function findPrecipitationTypeColor(value) { return paletteState.precipitationTypeColor(value); }
function findSkyColor(value) { return paletteState.skyColor(value); }
function findWaveColor(value) { return paletteState.waveColor(value); }
function solarPaletteColor(value, month) { return paletteState.solarColor(value, month); }
function weatherColorFor(element, value, selectedMonth) {
	return paletteState.colorFor(element, value, selectedMonth);
}

window.WEATHER_GRID_WEATHER_ELEMENTS = WEATHER_GRID_WEATHER_ELEMENTS;
window.WEATHER_GRID_WEATHER_VALUE_TEXT = weatherValueText;
window.WEATHER_GRID_WEATHER_VALUE_VALID = isValidWeatherValue;
window.WEATHER_GRID_WEATHER_COLOR = weatherColorFor;
window.WEATHER_GRID_SOLAR_SCALE = Object.freeze({
	thresholds: monthlySolarThresholds,
	palette: solarPalette
});

let leadHourCursor = 1; // 지원하는 첫 리드타임은 +1시간이다.

function isValidCalendarDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
	const parts = value.split('-').map(Number);
	const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
	return date.getUTCFullYear() === parts[0]
		&& date.getUTCMonth() === parts[1] - 1
		&& date.getUTCDate() === parts[2];
}

function shiftIsoDate(value, days) {
	const parts = value.split('-').map(Number);
	const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
	return date.getUTCFullYear() + '-'
		+ String(date.getUTCMonth() + 1).padStart(2, '0') + '-'
		+ String(date.getUTCDate()).padStart(2, '0');
}

/** 단기예보 발표 후 10분의 제공 지연을 반영한 현재 최신 기준시각(KST). */
function latestForecastBaseKst() {
	const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
	let hour = now.getUTCHours();
	let baseHour;
	if (hour < 2 || (hour === 2 && now.getUTCMinutes() < 10)) {
		now.setUTCDate(now.getUTCDate() - 1);
		baseHour = '23';
	} else {
		if ((hour - 2) % 3 === 0 && now.getUTCMinutes() < 10) hour -= 3;
		baseHour = String(2 + 3 * Math.floor((hour - 2) / 3)).padStart(2, '0');
	}
	return {
		date: now.getUTCFullYear() + '-'
			+ String(now.getUTCMonth() + 1).padStart(2, '0') + '-'
			+ String(now.getUTCDate()).padStart(2, '0'),
		time: baseHour
	};
}

function refreshLatestForecastGlobals() {
	const latest = latestForecastBaseKst();
	window.todayStr = latest.date;
	window.time = latest.time;
	const dateInput = document.getElementById('forecast_date');
	if (dateInput) {
		dateInput.min = shiftIsoDate(latest.date, -60);
		dateInput.max = latest.date;
	}
	return latest;
}

/** 선택 날짜에 실제로 발표된 시각만 활성화한다. 과거 날짜는 8개 발표시각을 모두 허용한다. */
function syncAvailableBaseTimes() {
	const latest = refreshLatestForecastGlobals();
	const dateControl = document.getElementById('forecast_date');
	const timeControl = document.getElementById('baseTime');
	const selectedDate = dateControl ? dateControl.value : '';
	const selectedTime = timeControl ? timeControl.value : '';
	const latestHour = Number(latest.time);
	let lastEnabled = null;
	document.querySelectorAll('.forecast_run_button').forEach(function (button) {
		const hour = button.textContent.trim();
		const enabled = isValidCalendarDate(selectedDate)
			&& selectedDate <= latest.date
			&& (selectedDate < latest.date || Number(hour) <= latestHour);
		button.disabled = !enabled;
		button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
		if (enabled) lastEnabled = hour;
	});

	const currentButton = Array.from(document.querySelectorAll('.forecast_run_button'))
		.find(button => button.textContent.trim() === selectedTime);
	if (currentButton && !currentButton.disabled) return;
	if (!lastEnabled || !timeControl) return;
	selectForecastBaseTime(lastEnabled);
}

function selectForecastBaseTime(value) {
	const hiddenField = document.getElementById('baseTime');
	document.querySelectorAll('.forecast_run_button').forEach(function (button) {
		const selected = button.textContent.trim() === value;
		button.classList.toggle('on', selected);
		button.setAttribute('aria-pressed', String(selected));
	});
	if (hiddenField) hiddenField.value = value;
}

function readForecastControls() {
	const dateControl = document.getElementById('forecast_date');
	const timeControl = document.getElementById('baseTime');
	const elementControl = document.getElementById('element');
	const heightControl = document.getElementById('height');
	return {
		date: dateControl ? dateControl.value.replaceAll('-', '') : '',
		time: timeControl ? timeControl.value : '',
		element: elementControl ? elementControl.value : 'wdws',
		height: heightControl ? heightControl.value : '10m'
	};
}

function selectedForecastMonth() {
	const dateControl = document.getElementById('forecast_date');
	return dateControl ? dateControl.value.split('-')[1] || '' : '';
}

		function initializeWeatherGrid() {
			leadHourCursor = Number.parseInt(leadHours, 10);
			selectForecastBaseTime(time);

			/** 첫 조회 날짜를 최신 발표일로 맞춘다. */
			const forecastDateControl = document.getElementById('forecast_date');
			if (forecastDateControl) forecastDateControl.value = todayStr;
			syncAvailableBaseTimes();
			setInterval(syncAvailableBaseTimes, 60 * 1000);
			document.addEventListener('visibilitychange', function () {
				if (!document.hidden) syncAvailableBaseTimes();
			});
			applyMapThemeStyles();

			refreshWeatherGrid();
		}
		if (document.readyState === 'complete') initializeWeatherGrid();
		else document.addEventListener('DOMContentLoaded', initializeWeatherGrid, { once: true });

		const timelineTimestampFormatter = new Intl.DateTimeFormat('ko-KR', {
			timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
			hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
		});
		const timelineTickFormatter = new Intl.DateTimeFormat('ko-KR', {
			timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', hourCycle: 'h23'
		});

		function forecastValidDate(baseDate, baseHour, forecastHour) {
			if (!/^\d{8}$/.test(baseDate) || !Number.isInteger(baseHour)) return null;
			const instant = new Date(baseDate.substring(0, 4) + '-' + baseDate.substring(4, 6) + '-'
				+ baseDate.substring(6, 8) + 'T' + String(baseHour).padStart(2, '0') + ':00:00+09:00');
			if (Number.isNaN(instant.getTime())) return null;
			return new Date(instant.getTime() + forecastHour * 60 * 60 * 1000);
		}

		function compactTimelineLabel(date) {
			const parts = {};
			timelineTickFormatter.formatToParts(date).forEach(function (part) {
				if (part.type !== 'literal') parts[part.type] = part.value;
			});
			return Number(parts.month) + '.' + Number(parts.day) + ' ' + parts.hour + '시';
		}

		function updateTimelineTickLabels(baseDate, baseHour) {
			const ticks = document.querySelectorAll('#forecast_timeline_ticks span');
			[1, 12, 24, 36, 48].forEach(function (forecastHour, index) {
				const date = forecastValidDate(baseDate, baseHour, forecastHour);
				if (ticks[index] && date) ticks[index].textContent = compactTimelineLabel(date);
			});
		}

		function renderForecastTimeline(activeHour) {
			const slots = Array.from(document.querySelectorAll('#forecast_timeline li'));
			slots.forEach(function (slot) {
				slot.classList.remove('on');
				const label = slot.querySelector('span');
				if (label) label.textContent = '';
			});

			const dateInput = document.getElementById('forecast_date');
			const baseTimeInput = document.getElementById('baseTime');
			const baseDate = dateInput ? dateInput.value.replaceAll('-', '') : '';
			const baseTime = Number.parseInt(baseTimeInput ? baseTimeInput.value : '', 10);

			if (/^\d{8}$/.test(baseDate) && Number.isInteger(baseTime)) {
				const date = forecastValidDate(baseDate, baseTime, activeHour);
				if (!date) return;
				const forecastTimeLabel = timelineTimestampFormatter.format(date).replace(/\.$/, '');
				const activeSlot = slots.find(function (slot) {
					return slot.getAttribute('value') === String(activeHour);
				});
				if (activeSlot) {
					activeSlot.classList.add('on');
					const label = activeSlot.querySelector('span');
					if (label) label.textContent = forecastTimeLabel;
				}
				updateTimelineTickLabels(baseDate, baseTime);
				const scrubber = document.getElementById('forecast_scrubber');
				if (scrubber) {
					scrubber.value = String(activeHour);
					scrubber.setAttribute('aria-valuetext', '+' + activeHour + '시간 예보, ' + forecastTimeLabel + ' KST');
					scrubber.style.setProperty('--timeline-progress', ((activeHour - 1) / 47 * 100).toFixed(2) + '%');
				}
			}
		}

		/** 독립 데이터 어댑터가 로드된 뒤 실제 조회로 위임하는 안정적인 공개 진입점. */
		function refreshWeatherGrid() {
			return window.WeatherGridData ? window.WeatherGridData.refresh() : false;
		}
		window.WEATHER_GRID_REFRESH_GRID = refreshWeatherGrid;

		function moveForecastCursor(action, stepSize) {
			const firstHour = 1;
			const lastHour = 48;
			const step = Math.max(1, Math.min(lastHour, Number(stepSize) || 1));
			const requested = {
				add: Math.min(lastHour, leadHourCursor + step),
				sub: Math.max(firstHour, leadHourCursor - step),
				ini: firstHour,
				fnl: lastHour
			}[action];
			if (!Number.isInteger(requested)) return false;
			if (requested === leadHourCursor) {
				notifyUser(leadHourCursor === firstHour ? '더 이른 예보는 없습니다.' : '더 늦은 예보는 없습니다.');
				return false;
			}
			return selectForecastHour(requested);
		}

		/** 공개 컨트롤러가 내부 커서를 우회하지 않고 유효한 시간으로 이동하게 한다. */
		function setForecastHour(requestedHour, refreshData) {
			const requested = Number.parseInt(requestedHour, 10);
			if (!Number.isInteger(requested) || requested < 1 || requested > 48) return false;
			if (requested === leadHourCursor) return false;
			leadHourCursor = requested;
			renderForecastTimeline(leadHourCursor);
			updateSelectionSummary();
			if (refreshData) {
				refreshWeatherGrid();
				syncSolarLegend(selectedForecastMonth());
			}
			return true;
		}

		function selectForecastHour(requestedHour) {
			return setForecastHour(requestedHour, true);
		}

		window.WeatherGridTimeline = Object.freeze({
			currentHour: function () { return leadHourCursor; },
			move: moveForecastCursor,
			select: selectForecastHour,
			restore: function (requestedHour) { return setForecastHour(requestedHour, false); }
		});


		/** 현재 지도에서 보고 있는 지표·예보 시각·시각화 의미를 사람이 읽는 문장으로 갱신한다. */
		function updateSelectionSummary() {
			let mapStatusPanel = document.querySelector('.map_status_panel');
			const mapDiv = document.getElementById('map');
			const mapContainer = document.querySelector('.map_workspace');
			const selectedElement = document.getElementById('element').value;
			const heightText = document.getElementById('height').value;
			const fallbackContent = {
				wdws: { metric: '바람 · 지상 ' + heightText, hint: '색은 풍속 · 선은 이동 방향(재생 속도는 시각화용)' },
				tmp: { metric: '기온', hint: '색은 기온 · 등치선은 같은 기온' },
				pcp: { metric: '1시간 예상 강수량', hint: '색은 해당 시각까지 1시간 동안의 예상 강수량' },
				pty: { metric: '예상 강수형태', hint: '색은 비·비/눈·눈·소나기 구분' },
				sno: { metric: '1시간 예상 신적설', hint: '색은 해당 시각까지 1시간 동안 새로 쌓일 것으로 예상되는 눈' },
				reh: { metric: '상대습도', hint: '색은 공기 중 수증기 포화 정도' },
				sky: { metric: '예상 하늘상태', hint: '색은 맑음·구름많음·흐림 구분' },
				wav: { metric: '예상 파고', hint: '색은 해상 파고 · 육지는 자료 없음' },
				swdn: { metric: '일사강도', hint: '색은 지면 하향단파복사 강도' }
			}[selectedElement] || { metric: '기상 정보', hint: '색으로 전국 분포를 비교합니다' };
			const content = fallbackContent;
			const source = window.lastGridElement === selectedElement ? window.lastGridResult : null;
			let sourceHint = content.hint;
			if (source && selectedElement === 'swdn') {
				let runLabel = '';
				const modelRun = new Date(source.modelRunTime);
				if (!Number.isNaN(modelRun.getTime())) {
					runLabel = ' · ' + String(modelRun.getUTCHours()).padStart(2, '0') + ' UTC 런';
				}
				sourceHint += ' · KIM NE57 원자료 8 km' + runLabel;
			} else if (source && selectedElement !== 'swdn') {
				sourceHint += ' · 기상청 단기예보 5 km';
			}
			if (source && source.fallbackUsed) {
				sourceHint += selectedElement !== 'swdn'
					? ' · 직전 발표본 사용' : ' · 직전 모델 런 사용';
			}
			if (source && source.timeAdjusted && source.validTime) {
				const actual = new Date(source.validTime);
				if (!Number.isNaN(actual.getTime())) {
					sourceHint += ' · 실제 자료 ' + compactTimelineLabel(actual)
						+ ' (' + source.temporalResolutionHours + '시간 간격)';
				}
			}

			if (!mapStatusPanel) {
				mapStatusPanel = document.createElement('div');
				mapStatusPanel.className = 'map_status_panel';
				mapStatusPanel.setAttribute('role', 'status');
				mapStatusPanel.setAttribute('aria-label', '현재 지도 정보');
				mapContainer.insertBefore(mapStatusPanel, mapDiv);
			}

			function ensurePart(className, tagName) {
				let part = mapStatusPanel.querySelector('.' + className);
				if (!part) {
					part = document.createElement(tagName || 'span');
					part.className = className;
					mapStatusPanel.appendChild(part);
				}
				return part;
			}

			const selectedTime = document.querySelector('#forecast_timeline li.on span');
			const timeText = selectedTime && selectedTime.textContent.trim()
				? selectedTime.textContent.trim() + ' 예보'
				: '예보 시각 확인 중…';
			ensurePart('info_metric', 'strong').textContent = content.metric;
			ensurePart('info_time').textContent = timeText;
			ensurePart('info_hint').textContent = sourceHint;
			mapStatusPanel.setAttribute('aria-label', content.metric + ', ' + timeText + ', ' + sourceHint);
			mapStatusPanel.style.removeProperty('display');
		}

		/** 선택 요소의 단위와 독립 범례 어댑터를 함께 동기화한다. */
		function updateWeatherLegend() {
			const chosenElementValue = document.getElementById("element").value;
			const meta = weatherElementMeta(chosenElementValue);
			const stats = document.querySelector('#weather_legend .grid_stats');
			if (stats) stats.hidden = !!meta.categorical;
			document.querySelectorAll('.grid_stats h3').forEach(function (heading) {
				heading.textContent = meta.label + (meta.unit ? ' (' + meta.unit + ')' : '');
			});
			if (window.WeatherGridLegend) window.WeatherGridLegend.render();
		}

		/** 월에 따라 달라지는 일사 스케일을 독립 범례 어댑터와 동기화한다. */
		function syncSolarLegend(month) {
			if (window.WeatherGridLegend) window.WeatherGridLegend.render();
		}

		/** 예외 상황에서만 알림 UI를 불러와 초기 로딩 비용을 줄인다. */
		function notifyUser(message) {
			return fireAlert({
				text: message,
				title: '안내',
				confirmButtonText: '닫기'
			});
		}

		let mapNoticeTimer = 0;
		/** 지도 빈 영역의 우발적 탭은 모달로 흐름을 막지 않고 짧은 상태 메시지로 안내한다. */
		function showMapNotice(input) {
			const options = input && typeof input === 'object' ? input : { message: input };
			const message = String(options.message || '').trim();
			if (!message) return;
			let notice = document.getElementById('map_notice');
			if (!notice) {
				notice = document.createElement('div');
				notice.id = 'map_notice';
				notice.className = 'map_notice';
				notice.setAttribute('role', 'status');
				notice.setAttribute('aria-live', 'polite');
				document.querySelector('.map_workspace').appendChild(notice);
			}
			const text = document.createElement('span');
			text.textContent = message;
			notice.replaceChildren(text);
			notice.dataset.action = 'false';
			if (options.actionLabel && typeof options.onAction === 'function') {
				const action = document.createElement('button');
				action.type = 'button';
				action.textContent = String(options.actionLabel);
				action.addEventListener('click', function () {
					clearTimeout(mapNoticeTimer);
					notice.hidden = true;
					options.onAction();
				}, { once: true });
				notice.appendChild(action);
				notice.dataset.action = 'true';
			}
			notice.hidden = false;
			clearTimeout(mapNoticeTimer);
			mapNoticeTimer = window.setTimeout(function () { notice.hidden = true; },
				Number.isFinite(options.duration) ? Math.max(2000, options.duration) : 2600);
		}
		window.WEATHER_GRID_SHOW_NOTICE = showMapNotice;

		function setLoadingState(active) {
			const display = active ? 'block' : 'none';
			document.getElementById('loading').style.display = display;
			const overlay = document.getElementById('loading-overlay');
			overlay.style.display = display;
			overlay.setAttribute('aria-hidden', String(!active));
			const mapElement = document.getElementById('map');
			if (active) mapElement.setAttribute('aria-busy', 'true');
			else mapElement.removeAttribute('aria-busy');
		}
		function endGridLoading() { setLoadingState(false); }

		function clearGridWindData() {
			window.WeatherGridWind.clear();
		}

		/** 새 조회 레이블 아래에 이전 발표 자료가 남지 않도록 렌더 상태를 원자적으로 비운다. */
		function resetGridPresentation(request) {
			clearGridWindData();
			window.lastGridResult = null;
			window.lastGridElement = null;
			window.WeatherGridRaster.clear();
			if (window.WEATHER_GRID_ISO) window.WEATHER_GRID_ISO.refresh();
			if (typeof window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION === 'function') {
				window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION(null, request.element);
			}
			document.querySelectorAll('#grid_stat_min, #grid_stat_avg, #grid_stat_max')
				.forEach(function (node) { node.textContent = '—'; });
			const mockBadge = document.getElementById('mock_badge');
			if (mockBadge) mockBadge.style.display = 'none';
			renderForecastTimeline(Number(request.leadHours));
			updateWeatherLegend();
			updateSelectionSummary();
		}

		/** 검증된 한 응답을 히트맵·통계·풍장·범례가 함께 소비한다. */
		function presentGridResult(result, request) {
			const element = request.element;
			window.lastGridResult = result;
			window.lastGridElement = element;
			updateSelectionSummary();
			if (typeof window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION === 'function') {
				window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION(result, element);
			}

			const mockBadge = document.getElementById('mock_badge');
			if (mockBadge) mockBadge.style.display = result.mock ? 'block' : 'none';
			window.WeatherGridRaster.render(result, request);
			if (window.applyRenderMode) window.applyRenderMode();

			if (result.stats && !weatherElementMeta(element).categorical) {
				document.getElementById('grid_stat_min').textContent = result.stats.min;
				document.getElementById('grid_stat_avg').textContent = result.stats.avg;
				document.getElementById('grid_stat_max').textContent = result.stats.max;
			} else if (weatherElementMeta(element).categorical) {
				document.querySelectorAll('#grid_stat_min, #grid_stat_avg, #grid_stat_max')
					.forEach(function (node) { node.textContent = '—'; });
			}

			if (element === 'wdws' && result.windField) {
				window.WeatherGridWind.present(result.windField, request);
			} else {
				clearGridWindData();
				if (element === 'swdn') syncSolarLegend(request.baseDate.substring(4, 6));
			}
		}

		window.WeatherGridRenderRuntime = Object.freeze({
			reset: resetGridPresentation,
			present: presentGridResult,
			clearWind: clearGridWindData,
			setLoading: setLoadingState
		});

			document.querySelectorAll('.latest_run_button').forEach(function (button) {
				button.addEventListener('click', function () {
					const latest = refreshLatestForecastGlobals();
					const dateControl = document.getElementById('forecast_date');
					if (dateControl) dateControl.value = latest.date;
					selectForecastBaseTime(latest.time);
					syncAvailableBaseTimes();
				});
			});

			document.querySelectorAll('#forecast_timeline li').forEach(function (slot) {
				slot.addEventListener('click', function () {
					selectForecastHour(slot.getAttribute('value'));
				});
			});

			const forecastScrubber = document.getElementById('forecast_scrubber');
			if (forecastScrubber) {
				forecastScrubber.addEventListener('input', function () {
					leadHourCursor = Math.max(1, Math.min(48, parseInt(this.value, 10) || 1));
					renderForecastTimeline(leadHourCursor);
					updateSelectionSummary();
				});
				forecastScrubber.addEventListener('change', function () {
					syncSolarLegend(selectedForecastMonth());
					refreshWeatherGrid();
				});
			}

			document.querySelectorAll('.forecast_run_button').forEach(function (button) {
				button.addEventListener('click', function () {
					const val = button.textContent.trim();
					const timeControl = document.getElementById('baseTime');
					const alreadySelected = button.classList.contains('on')
						&& timeControl && timeControl.value === val;
					if (alreadySelected) return;
					selectForecastBaseTime(val);
					// 상태 반영 뒤 조회하도록 별도 이벤트를 쓴다. defer 스크립트의 리스너 등록 순서에 의존하지 않는다.
					document.dispatchEvent(new CustomEvent('weather-grid:base-time-changed', { detail: { baseTime: val } }));
				});
			});

			function hideStationModal() {
				const stationModal = document.querySelector('.station_modal');
				if (window.WEATHER_GRID_STATION_FORECAST) window.WEATHER_GRID_STATION_FORECAST.cancel();
				document.dispatchEvent(new CustomEvent('weather-grid:station-modal-closed'));
				if (stationModal) stationModal.style.display = 'none';
			}
			document.querySelector('.station_modal_close').addEventListener('click', hideStationModal);


			// 지도 밖의 비대화형 영역에서만 좌우키를 전역 예보 이동에 사용한다.
			document.addEventListener('keydown', function (event) {
				const target = event.target;
				if (target && (target.id === 'map'
					|| target.closest('input, select, textarea, button, a, [contenteditable="true"], [role="dialog"]'))) return;
				const action = { ArrowRight: 'add', ArrowLeft: 'sub' }[event.key];
				if (action) {
					document.dispatchEvent(new CustomEvent('weather-grid:forecast-control', {
						detail: { action: action }
					}));
				}
			});
