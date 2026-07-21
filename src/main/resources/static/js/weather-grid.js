const WEATHER_GRID_PROJECTION_CODE = 'KMA_GRID_LCC';
const WEATHER_GRID_PROJ4 = '+proj=lcc +lat_1=30 +lat_2=60 +lat_0=0 +lon_0=126 +datum=WGS84 +units=m +no_defs';
proj4.defs(WEATHER_GRID_PROJECTION_CODE, WEATHER_GRID_PROJ4);

ol.proj.proj4.register(proj4);

/** 기상 격자 LCC ↔ 위경도 변환기. */
const lccToLonLat = proj4(WEATHER_GRID_PROJECTION_CODE, 'EPSG:4326');

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

/** 현재 지도 도법 코드 — weather-grid-ui.js의 도법 전환이 갱신하고,
 *  히트맵·스트림라인·클릭 변환이 모두 이 값을 기준으로 동작한다. */
window.WEATHER_GRID_VIEW_PROJ = WEATHER_GRID_PROJECTION_CODE;

/** 지도 이동 제한과 첫 화면의 실제 기상 격자 범위. 고정 zoom/center 대신
 *  뷰포트별 UI 안전 여백 안에 한반도 격자가 전부 들어오도록 fit한다. */
window.WEATHER_GRID_GEO_LIMIT_EXTENT = [116.0, 29.0, 140.0, 46.0];
window.WEATHER_GRID_INITIAL_GEO_EXTENT = [123.9, 31.7, 132.4, 39.2];
window.WEATHER_GRID_COMPACT_INITIAL_GEO_EXTENT = [123.8, 31.6, 132.5, 39.2];

function initialGeoExtent() {
	return window.matchMedia('(max-width: 900px)').matches
		? window.WEATHER_GRID_COMPACT_INITIAL_GEO_EXTENT
		: window.WEATHER_GRID_INITIAL_GEO_EXTENT;
}

function initialViewPadding() {
	if (window.matchMedia('(max-width: 360px)').matches) {
		return [108, 12, 104, 12];
	}
	if (window.matchMedia('(max-width: 640px)').matches) {
		return [64, 16, 96, 16];
	}
	if (window.matchMedia('(max-width: 900px)').matches) {
		return [116, 20, 100, 20];
	}
	return [84, 160, 92, 292];
}

/** 위경도 → 기상청 DFS 분수 격자. 2D·3D·바람 보간이 한 구현을 공유한다. */
const kmaLatLonToGridFrac = window.WeatherGridWindGrid.latLonToGridFraction;

const SOLAR_COLOR_STEPS = 25;

/** 월별 일사 상한을 완만한 계절 주기로 근사해 범례 구간을 생성한다. */
function solarScaleForMonth(month) {
	const monthNumber = Math.max(1, Math.min(12, Number(month) || 1));
	const seasonalPosition = Math.cos((monthNumber - 6) * Math.PI / 6);
	const upperBound = Math.round(820 + 280 * seasonalPosition);
	return Object.freeze(Array.from({ length: SOLAR_COLOR_STEPS }, function (_, index) {
		return Math.round(upperBound * index / (SOLAR_COLOR_STEPS - 1));
	}));
}

const monthlySolarThresholds = Object.freeze(Array.from({ length: 12 }, function (_, index) {
	const month = String(index + 1).padStart(2, '0');
	return [month, solarScaleForMonth(month)];
}).reduce(function (ranges, entry) {
	ranges[entry[0]] = entry[1];
	return ranges;
}, {}));

/** 낮은 값의 청록부터 높은 값의 주황까지 연속 RGB 곡선으로 만든다. */
const solarPalette = Object.freeze(Array.from({ length: SOLAR_COLOR_STEPS }, function (_, index) {
	const progress = index / (SOLAR_COLOR_STEPS - 1);
	const red = Math.round(20 + 225 * progress);
	const green = Math.round(115 + 95 * Math.sin(Math.PI * progress) - 40 * progress);
	const blue = Math.round(170 - 120 * progress);
	return `rgba(${red}, ${green}, ${blue}, 0.72)`;
}));

/**
 * 지도·범례·3D·지점 차트가 공유하는 기상 요소 계약.
 * 범주형 요소는 연속값처럼 보간하거나 등치선·3D 높이로 오해하지 않게 명시한다.
 */
const WEATHER_GRID_WEATHER_ELEMENTS = Object.freeze({
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
window.WEATHER_GRID_WEATHER_ELEMENTS = WEATHER_GRID_WEATHER_ELEMENTS;

function weatherElementMeta(element) {
	return WEATHER_GRID_WEATHER_ELEMENTS[element] || WEATHER_GRID_WEATHER_ELEMENTS.wdws;
}

function weatherCategoryLabel(element, value) {
	const code = Number(value);
	if (element === 'pty') return ({0: '강수 없음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기'})[code] || '자료 없음';
	if (element === 'sky') return ({1: '맑음', 3: '구름많음', 4: '흐림'})[code] || '자료 없음';
	return '';
}

function isValidWeatherValue(element, value) {
	if (!Number.isFinite(value) || value <= -900 || value >= 9000) return false;
	if (element === 'pty') return [0, 1, 2, 3, 4].includes(value);
	if (element === 'sky') return [1, 3, 4].includes(value);
	const ranges = {
		wdws: [0, 150], tmp: [-100, 80], pcp: [0, 1000], sno: [0, 100],
		reh: [0, 100], wav: [0, 50], swdn: [0, 2000]
	};
	const range = ranges[element];
	return !!range && value >= range[0] && value <= range[1];
}

function weatherValueText(element, value) {
	if (!isValidWeatherValue(element, value)) return '—';
	const meta = weatherElementMeta(element);
	if (meta.categorical) return weatherCategoryLabel(element, value);
	return (Math.round(value * 10) / 10) + (meta.unit ? ' ' + meta.unit : '');
}

window.WEATHER_GRID_WEATHER_VALUE_TEXT = weatherValueText;
window.WEATHER_GRID_WEATHER_VALUE_VALID = isValidWeatherValue;

const coordinatePanel = document.querySelector('.coordinate_panel');
const coordinateSearchToggle = document.getElementById('coordinate_search_toggle');
const coordinateResultPopup = document.querySelector('.coordinate_popup');
const stationSuggestionList = document.getElementById('suggestions');
const stationSearchStatus = document.getElementById('station_search_status');
const stationSearchInput = document.getElementById('station_query');
const regionLabelControls = document.getElementById('region_label_controls');
const provinceBoundaryControls = document.getElementById('province_boundary_controls');

let regionLabelFlag = true;
let provinceBoundaryFlag = false;

let windRenderer = null;
let leadHourCursor = 1; // 지원하는 첫 리드타임은 +1시간이다.

let stationSearchAnchors = [];    // 검색·마커 표시에 사용하는 대표 기상 지점

let weatherRasterLayer = null;
let lastWindQuery = null;
let lastWindField = null;
let streamlineRefreshTimer = null;
const MAX_STREAM_CANVAS_PIXELS = 8000000;
const MAX_MAP_RENDER_PIXELS = 12000000;
const FORECAST_BASE_HOURS = ['02', '05', '08', '11', '14', '17', '20', '23'];
// Worker의 최장 기상 원문 조회(30초)보다 여유를 두되, 브라우저가 무한 대기하지 않게 한다.
const GRID_REQUEST_TIMEOUT_MS = 35000;
const STATION_REQUEST_TIMEOUT_MS = 20000;

// 히트맵은 시간을 옮겨도 화면 좌표에 대응하는 격자 셀이 같다. 최근 뷰 1건의
// 데이터 인덱스·경계 투명도만 보관하고, 기상 값과 색상은 매 렌더링마다 다시 계산한다.
let gridRenderLookupCache = null;
let gridRenderLookupCacheHits = 0;
let gridRenderLookupCacheMisses = 0;

/** 렌더 회귀 검증에서만 사용하는 읽기 전용 캐시 상태. */
function getGridRenderLookupCacheStats() {
	return {
		hits: gridRenderLookupCacheHits,
		misses: gridRenderLookupCacheMisses,
		sampleCount: gridRenderLookupCache ? gridRenderLookupCache.dataIndices.length : 0
	};
}

function currentGridRenderTheme() {
	const explicitTheme = document.documentElement.getAttribute('data-theme');
	if (explicitTheme) return explicitTheme;
	return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
		? 'system-light' : 'system-dark';
}

function gridRenderLookupKey(extent, resolution, pixelRatio, size, projection,
		viewProjCode, nxMin, nyMin, step, apiNx, apiNy, sampleW, sampleH) {
	const projectionCode = projection && typeof projection.getCode === 'function'
		? projection.getCode() : viewProjCode;
	return [
		projectionCode, viewProjCode,
		extent[0], extent[1], extent[2], extent[3], resolution,
		pixelRatio, window.devicePixelRatio || 1, size[0], size[1], sampleW, sampleH,
		nxMin, nyMin, step, apiNx, apiNy, currentGridRenderTheme()
	].join('|');
}

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
	const selectedDate = $('#forecast_date').val();
	const selectedTime = $('#baseTime').val();
	const latestHour = Number(latest.time);
	let lastEnabled = null;
	$('.forecast_run_button').each(function () {
		const hour = $(this).text().trim();
		const enabled = isValidCalendarDate(selectedDate)
			&& selectedDate <= latest.date
			&& (selectedDate < latest.date || Number(hour) <= latestHour);
		this.disabled = !enabled;
		this.setAttribute('aria-disabled', enabled ? 'false' : 'true');
		if (enabled) lastEnabled = hour;
	});

	const currentButton = Array.from(document.querySelectorAll('.forecast_run_button'))
		.find(button => button.textContent.trim() === selectedTime);
	if (currentButton && !currentButton.disabled) return;
	if (!lastEnabled) return;
	$('#baseTime').val(lastEnabled);
	$('.forecast_run_button').removeClass('on').attr('aria-pressed', 'false').each(function () {
		if ($(this).text().trim() === lastEnabled) $(this).addClass('on').attr('aria-pressed', 'true');
	});
}

function isValidForecastSelection() {
	const latest = refreshLatestForecastGlobals();
	const date = $('#forecast_date').val();
	const baseTime = $('#baseTime').val();
	if (!isValidCalendarDate(date)) return false;
	if (date < shiftIsoDate(latest.date, -60) || date > latest.date) return false;
	if (!FORECAST_BASE_HOURS.includes(baseTime)) return false;
	return date < latest.date || Number(baseTime) <= Number(latest.time);
}

/**
 * OpenLayers가 기기 DPR을 그대로 쓰면 4K·HiDPI에서 레이어 하나당 수천만 픽셀의
 * backing store를 만들 수 있다. 일반 화면에서는 실제 DPR을 유지하고, 큰 화면만
 * 12MP 예산 안으로 낮춘다. 8K처럼 CSS 픽셀 수 자체가 예산보다 큰 화면에서는
 * 1 미만 비율도 허용해 메모리 상한을 우선 보장한다.
 */
function cappedMapPixelRatio() {
	const viewportPixels = Math.max(1, window.innerWidth * window.innerHeight);
	const screenPixels = window.screen
		? Math.max(1, window.screen.width * window.screen.height)
		: viewportPixels;
	const cssPixels = Math.max(viewportPixels, screenPixels);
	// 캔버스 정수 반올림 오차까지 예산 안에 들도록 0.5% 여유를 둔다.
	const budgetRatio = Math.sqrt(MAX_MAP_RENDER_PIXELS / cssPixels) * 0.995;
	return Math.min(window.devicePixelRatio || 1, budgetRatio);
}

const mapPixelRatio = cappedMapPixelRatio();

function createWindRenderer(data) {
	return new Windy({
		canvas: document.getElementById('wind_field_canvas'),
		data: data,
		visualTimeScale: 1800,
		maxDisplaySpeed: 55,
		particleDensity: 1 / 900,
		lineWidth: 1.15
	});
}

let stationVectorLayer = null;

let weatherBasemapLayer = null;

let vectorLayer = null;
let streetTileLayer = null;

let provinceBoundaryLayer = null;

/** 거리지도 — OSM 타일 (OL 래스터 재투영으로 LCC 등 모든 도법에서 표출).
 *  구 VWorld 타일은 인증/서비스 종료로 소스가 비어 있어 거리지도가 죽어 있었음. */
streetTileLayer = new ol.layer.Tile({
	title: 'api',
	source: new ol.source.OSM({ crossOrigin: 'anonymous' })
})

/** 분포도 소스만 교체해 재사용하는 영속 이미지 레이어 */
weatherRasterLayer = new ol.layer.Image({
	title: 'img',
	opacity: 0.7
});

const initialView = new ol.View({
	projection: WEATHER_GRID_PROJECTION_CODE,
	extent: ol.proj.transformExtent(
		window.WEATHER_GRID_GEO_LIMIT_EXTENT, 'EPSG:4326', WEATHER_GRID_PROJECTION_CODE, 16),
	// 세로형 화면에서 뷰포트 가장자리까지 extent 안에 강제로 넣으면 중심이 북쪽으로
	// 밀린다. 지도 중심만 동아시아 범위에 제한해 한반도는 어느 화면에서도 중앙에 둔다.
	constrainOnlyCenter: true,
	showFullExtent: true,
	center: ol.proj.transform([127.8, 38.0], 'EPSG:4326', WEATHER_GRID_PROJECTION_CODE),
	zoom: 6.5,
	minZoom: 5.5,
	// 반 단계 minZoom(5.5)과 정수 maxZoom 조합은 OL에서 실제 상한이 11.5로 잘린다.
	// QHD 이상 화면에서도 CCTV의 24타일 조회 제한 안까지 확대할 수 있도록 여유를 둔다.
	maxZoom: 12.5,
	smoothResolutionConstraint: true,
	constrainResolution: false,
	enableRotation: false
});

let weatherMap = new ol.Map({
	pixelRatio: mapPixelRatio,
	view: initialView,
	target: 'map',
	layers: []
});

/** 줌 수준과 위도에 맞는 실제 거리를 계산하며, 값에 따라 m와 km를 자동 전환한다. */
weatherMap.addControl(new ol.control.ScaleLine({
	target: document.getElementById('map_scale'),
	units: 'metric',
	minWidth: 32,
	maxWidth: 120
}));

/** E2E와 운영 진단에서 실제 지도 캔버스 예산을 바로 확인할 수 있게 한다. */
window.getMapRenderDiagnostics = function () {
	const canvases = Array.from(weatherMap.getViewport().querySelectorAll('canvas:not(#wind_field_canvas)'));
	const canvasPixels = canvases.map(function (canvas) { return canvas.width * canvas.height; });
	return {
		configuredPixelRatio: mapPixelRatio,
		maxMapBackingPixels: MAX_MAP_RENDER_PIXELS,
		canvasPixels: canvasPixels,
		largestCanvasPixels: canvasPixels.length ? Math.max.apply(null, canvasPixels) : 0
	};
};

/**
 * OpenLayers의 핀치 줌이 모바일 브라우저의 페이지 확대·스크롤 제스처와
 * 경쟁하지 않도록 지도 뷰포트 안에서만 포인터 입력을 지도에 맡긴다.
 */
weatherMap.getViewport().style.touchAction = 'none';

initialView.fit(ol.proj.transformExtent(
	initialGeoExtent(), 'EPSG:4326', WEATHER_GRID_PROJECTION_CODE, 16), {
	size: weatherMap.getSize(),
	padding: initialViewPadding(),
	duration: 0,
	nearest: false
});
/** WGS84 GeoJSON을 현재 지도 도법의 OpenLayers 소스로 변환한다. */
function geodataVectorSource(data, projection) {
	return new ol.source.Vector({
		features: new ol.format.GeoJSON().readFeatures(data, {
			dataProjection: 'EPSG:4326',
			featureProjection: projection
		})
	});
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

/** 행정구역 폴리곤 내부점을 지역 검색·클릭용 대표 좌표로 사용한다. */
function provinceSearchAnchors(data, projection) {
	const source = geodataVectorSource(data, projection);
	return source.getFeatures().map(function (feature) {
		const geometry = feature.getGeometry();
		let interior;
		if (geometry.getType() === 'Polygon') {
			interior = geometry.getInteriorPoint().getCoordinates();
		} else if (geometry.getType() === 'MultiPolygon') {
			interior = geometry.getInteriorPoints().getCoordinates().reduce(function (best, candidate) {
				return !best || (candidate[2] || 0) > (best[2] || 0) ? candidate : best;
			}, null);
		}
		if (!interior) return null;
		const lonLat = ol.proj.transform(interior.slice(0, 2), projection, 'EPSG:4326');
		return {
			name: feature.get('nameKo'),
			lon: lonLat[0],
			lat: lonLat[1]
		};
	}).filter(function (item) {
		return item && typeof item.name === 'string'
			&& Number.isFinite(item.lon) && Number.isFinite(item.lat);
	}).sort(function (left, right) {
		return left.name.localeCompare(right.name, 'ko');
	});
}

function stationFeatures(items, projection) {
	return items.map(function (item) {
		return new ol.Feature({
			geometry: new ol.geom.Point(ol.proj.transform([item.lon, item.lat], 'EPSG:4326', projection)),
			stn_name: item.name,
			latitude: item.lat,
			longitude: item.lon
		});
	});
}

// 좌표 데이터는 JS 번들과 분리하고 필요한 시점에 같은 출처에서 스키마 검증 후 읽는다.
weatherBasemapLayer = new ol.layer.Vector({ title: 'base-land' });
weatherBasemapLayer.setSource(new ol.source.Vector());
weatherBasemapLayer.setStyle(new ol.style.Style({
	stroke: new ol.style.Stroke({ color: '#0068df', width: 1 })
}));

[
	{ layer: streetTileLayer, order: 10, visible: false },
	{ layer: weatherBasemapLayer, order: 20, visible: true },
	{ layer: weatherRasterLayer, order: 70, visible: true }
].forEach(function (entry) {
	weatherMap.getLayers().push(entry.layer);
	entry.layer.setZIndex(entry.order);
	entry.layer.setVisible(entry.visible);
});

const streamlineCanvas = document.createElement('canvas');
streamlineCanvas.id = 'wind_field_canvas';
streamlineCanvas.setAttribute('aria-hidden', 'true');
weatherMap.getViewport().appendChild(streamlineCanvas);

const forecastStationSource = new ol.source.Vector();
const compactStationQuery = window.matchMedia('(max-width: 900px)');
const fineStationPointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
const stationDotStyleCache = new Map();
const stationHoverStyleCache = new Map();
const stationLabelStyleCache = new Map();
let hoveredStationFeature = null;
let selectedStationName = '';
let lastStationHoverCheck = 0;

function createStationNodeStyles(radius, coreColor, zIndex, halo) {
	const styles = [];
	if (halo) {
		styles.push(new ol.style.Style({
			image: new ol.style.Circle({
				radius: radius + 4.5,
				fill: new ol.style.Fill({ color: halo })
			}),
			zIndex: zIndex
		}));
	}
	styles.push(
		new ol.style.Style({
			image: new ol.style.Circle({
				radius: radius,
				fill: new ol.style.Fill({ color: '#f7fafc' }),
				stroke: new ol.style.Stroke({ color: '#07192e', width: 1.5 })
			}),
			zIndex: zIndex + 1
		}),
		new ol.style.Style({
			image: new ol.style.Circle({
				radius: Math.max(1.8, radius * 0.45),
				fill: new ol.style.Fill({ color: coreColor })
			}),
			zIndex: zIndex + 2
		})
	);
	return styles;
}

function stationNodeRadius(zoom, compact) {
	const bucket = Math.round(Math.max(6, Math.min(10, zoom)) * 4) / 4;
	const progress = (bucket - 6) / 4;
	return (compact ? 3.9 : 3.6) + progress * (compact ? 2.4 : 2.7);
}

function stationNodeStyles(zoom, compact) {
	const bucket = Math.round(Math.max(6, Math.min(10, zoom)) * 4) / 4;
	const key = (compact ? 'compact:' : 'desktop:') + bucket;
	if (stationDotStyleCache.has(key)) return stationDotStyleCache.get(key);
	const radius = stationNodeRadius(bucket, compact);
	const styles = createStationNodeStyles(radius, '#75d9e5', 2, '');
	stationDotStyleCache.set(key, styles);
	return styles;
}

function stationHoverStyles(zoom, compact) {
	const bucket = Math.round(Math.max(6, Math.min(10, zoom)) * 4) / 4;
	const key = (compact ? 'compact:' : 'desktop:') + bucket;
	if (stationHoverStyleCache.has(key)) return stationHoverStyleCache.get(key);
	const styles = createStationNodeStyles(
		Math.min(7.2, stationNodeRadius(bucket, compact) + 1.2),
		'#75d9e5', 20, 'rgba(117, 217, 229, .16)');
	stationHoverStyleCache.set(key, styles);
	return styles;
}

function stationLabelStyle(name, selected) {
	const key = (selected ? 'selected:' : 'hovered:') + name;
	if (stationLabelStyleCache.has(key)) return stationLabelStyleCache.get(key);
	const style = new ol.style.Style({
		text: new ol.style.Text({
			text: name,
			font: '700 11px system-ui, sans-serif',
			offsetY: selected ? -28 : -24,
			padding: [5, 8, 5, 8],
			fill: new ol.style.Fill({ color: '#f7fafc' }),
			backgroundFill: new ol.style.Fill({ color: 'rgba(7, 25, 46, .94)' }),
			backgroundStroke: new ol.style.Stroke({ color: 'rgba(247, 250, 252, .2)', width: 1 })
		}),
		zIndex: selected ? 103 : 23
	});
	stationLabelStyleCache.set(key, style);
	return style;
}

const selectedStationStyles = createStationNodeStyles(8, '#a99af7', 100, 'rgba(169, 154, 247, .2)');
stationVectorLayer = new ol.layer.Vector({
	source: forecastStationSource,
	title: 'forecast-stations',
	declutter: true,
	style: function (feature) {
		const name = feature.get('stn_name') || '';
		if (name && name === selectedStationName) {
			return selectedStationStyles.concat(stationLabelStyle(name, true));
		}
		const zoom = weatherMap.getView().getZoom() || 6;
		if (feature === hoveredStationFeature) {
			return stationHoverStyles(zoom, compactStationQuery.matches)
				.concat(stationLabelStyle(name, false));
		}
		return stationNodeStyles(zoom, compactStationQuery.matches);
	}
});

weatherMap.addLayer(stationVectorLayer);
stationVectorLayer.setZIndex(100);
if (compactStationQuery.matches) {
	// 작은 화면에서는 대표 지역 표시를 필요할 때 패널에서 켠다.
	stationVectorLayer.setVisible(false);
	const stationToggle = document.getElementById('weather_stations');
	if (stationToggle) {
		stationToggle.classList.remove('clicked');
		stationToggle.setAttribute('aria-pressed', 'false');
	}
}
compactStationQuery.addEventListener('change', function () {
	stationVectorLayer.changed();
});

function setSelectedStationName(name) {
	const next = typeof name === 'string' ? name : '';
	if (selectedStationName === next) return;
	selectedStationName = next;
	stationVectorLayer.changed();
}

if (fineStationPointerQuery.matches) {
	weatherMap.on('pointermove', function (event) {
		const now = performance.now();
		if (!event.dragging && now - lastStationHoverCheck < 80) return;
		lastStationHoverCheck = now;
		const measuring = window.WEATHER_GRID_MEASURE && window.WEATHER_GRID_MEASURE.isActive();
		const next = measuring || event.dragging || !stationVectorLayer.getVisible() ? null
			: weatherMap.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
				return layer === stationVectorLayer ? feature : undefined;
			}, { hitTolerance: 7 });
		if (next === hoveredStationFeature) return;
		hoveredStationFeature = next || null;
		stationVectorLayer.changed();
		weatherMap.getTargetElement().style.cursor = hoveredStationFeature ? 'pointer' : '';
	});
}
bindRegionMarkerSelection();

		function normalizedRegionName(value) {
			return String(value || '').normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase('ko-KR');
		}

		/** 입력한 지역명과 대표 좌표를 연결한다. */
		const regionSearchButton = document.querySelector('.station_search_button');
		if (regionSearchButton) {
			regionSearchButton.addEventListener('click', function () {
				const query = normalizedRegionName(stationSearchInput && stationSearchInput.value);
				const selected = query && stationSearchAnchors.find(function (candidate) {
					return normalizedRegionName(candidate.name) === query;
				});
				if (!selected) {
					notifyUser('일치하는 지역을 찾지 못했습니다.');
					return;
				}
				openStationForecast(selected.name, selected.lat, selected.lon);
			});
		}

	    function addBoundaryLayer(title, zIndex, style) {
			const options = { title: title, source: new ol.source.Vector() };
			if (style) options.style = style;
			const layer = new ol.layer.Vector(options);
			layer.setProperties({ zIndex: zIndex, visible: false });
			weatherMap.addLayer(layer);
			layer.setZIndex(zIndex);
			layer.setVisible(false);
			return layer;
		}

	    // GeoJSON은 초기 로드하고, 경계 레이어는 사용자가 선택할 때 표시한다.
		const boundaryStyle = new ol.style.Style({
			stroke: new ol.style.Stroke({ color: '#0068df', width: 1 })
		});
		vectorLayer = addBoundaryLayer('vector', 25, boundaryStyle);
		provinceBoundaryLayer = addBoundaryLayer('province', 30);

	    let vectorDataPromise = null;
	    function ensureVectorMapData() {
	        if (vectorDataPromise) return vectorDataPromise;
	        vectorDataPromise = Promise.all([
	            window.WeatherGridGeodata.load('eastAsiaLand'),
	            window.WeatherGridGeodata.load('koreaAdmin1')
	        ]).then(function (datasets) {
	            const projection = window.WEATHER_GRID_VIEW_PROJ || WEATHER_GRID_PROJECTION_CODE;
	            vectorLayer.setSource(geodataVectorSource(datasets[0], projection));
	            provinceBoundaryLayer.setSource(geodataVectorSource(datasets[1], projection));
	            if (window.applyMapThemeStyles) window.applyMapThemeStyles();
	            return datasets;
	        }).catch(function (error) {
	            vectorDataPromise = null;
	            throw error;
	        });
	        return vectorDataPromise;
	    }
	    window.ensureVectorMapData = ensureVectorMapData;

	    function loadInitialGeodata() {
	        window.WEATHER_GRID_GEODATA_READY = window.WeatherGridGeodata.loadInitial().then(function (datasets) {
	            const projection = window.WEATHER_GRID_VIEW_PROJ || WEATHER_GRID_PROJECTION_CODE;
	            weatherBasemapLayer.setSource(geodataVectorSource(datasets[0], projection));
	            stationSearchAnchors = provinceSearchAnchors(datasets[1], projection);
	            forecastStationSource.clear(true);
	            forecastStationSource.addFeatures(stationFeatures(stationSearchAnchors, projection));
	            if (window.applyMapThemeStyles) window.applyMapThemeStyles();
	            clearDataError('geodata');
	            return datasets;
	        }).catch(function (error) {
	            setDataError('기본 지도와 기상 지점 정보를 불러오지 못했습니다.', 'geodata');
	            console.error('초기 지도 데이터를 불러오지 못했습니다.', error);
	            throw error;
	        });
	        return window.WEATHER_GRID_GEODATA_READY;
	    }
	    window.WEATHER_GRID_RETRY_GEODATA = loadInitialGeodata;
	    loadInitialGeodata();



		$(document).ready(function () {
			leadHourCursor = Number.parseInt(leadHours, 10);
			selectForecastBaseTime(time);

			/** 첫 조회 날짜를 최신 발표일로 맞춘다. */
			$('#forecast_date').val(todayStr);
			syncAvailableBaseTimes();
			setInterval(syncAvailableBaseTimes, 60 * 1000);
			document.addEventListener('visibilitychange', function () {
				if (!document.hidden) syncAvailableBaseTimes();
			});

			weatherMap.on('moveend', scheduleStreamlineRefresh);

			applyMapThemeStyles();

			refreshWeatherGrid();
		});

		/** 지점 시계열 요청 시퀀스 — 연속 클릭 시 늦게 도착한 이전 응답이 새 차트를 덮지 않게 한다 */
		let stnQuerySeq = 0;
		let stnRequestController = null;
		let pointQuerySeq = 0;
		let pointRequestController = null;

		/** 상세예보 스트립을 열고 같은 응답을 강수 차트에서도 재사용할 수 있게 반환한다. */
		function fetchPointForecast(latitude, longitude, baseDate, baseTime) {
			if (!window.WEATHER_GRID_STATION_FORECAST) return Promise.resolve(null);
			return window.WEATHER_GRID_STATION_FORECAST.open({
				latitude: latitude,
				longitude: longitude,
				baseDate: baseDate,
				baseTime: baseTime
			});
		}

		/** 차트만 실패해도 상세예보 스트립은 유지하는 비차단 오류 상태. */
		function setStationChartBusy(busy) {
			const panel = document.querySelector('.station_chart_panel');
			if (panel) panel.setAttribute('aria-busy', busy ? 'true' : 'false');
		}

		function showStationChartError(message, retryAction) {
			const chart = document.getElementById('chart');
			if (!chart) return;
			const error = document.createElement('div');
			error.className = 'station_chart_error';
			error.setAttribute('role', 'status');
			const text = document.createElement('p');
			text.textContent = message || '시계열 차트를 불러오지 못했습니다.';
			error.appendChild(text);
			if (typeof retryAction === 'function') {
				const retry = document.createElement('button');
				retry.type = 'button';
				retry.className = 'station_chart_retry';
				retry.textContent = '다시 시도';
				retry.addEventListener('click', retryAction, { once: true });
				error.appendChild(retry);
			}
			chart.replaceChildren(error);
			setStationChartBusy(false);
		}

		function showStationChartLoading() {
			const chart = document.getElementById('chart');
			if (!chart) return;
			const state = document.createElement('div');
			state.className = 'station_chart_loading';
			state.setAttribute('role', 'status');
			state.textContent = '시계열 예보를 불러오는 중…';
			chart.replaceChildren(state);
			setStationChartBusy(true);
		}

		function cancelStationRequest() {
			stnQuerySeq++;
			if (stnRequestController) stnRequestController.abort();
			stnRequestController = null;
			setStationChartBusy(false);
		}

		document.addEventListener('weather-grid:station-modal-closed', cancelStationRequest);
		document.addEventListener('weather-grid:station-modal-closed', function () {
			setSelectedStationName('');
		});


		/**
		 * 지도 클릭, 관측지점, 좌표 검색에서 공통으로 사용하는 지점 시계열 진입점.
		 * 상세예보와 격자 시계열은 병렬로 요청하며 마지막으로 선택한 지점만 화면에 반영한다.
		 */
		function openStationTimeline(name, latitude, longitude, includeForecast) {
			if (includeForecast === undefined) includeForecast = true;
			let element = $('#element').val();
			let height = $('#height').val();
			let lat = Number(latitude);
			let lon = Number(longitude);
			if (!Number.isFinite(lat) || !Number.isFinite(lon)
					|| lat < -90 || lat > 90 || lon < -180 || lon > 180) {
				endGridLoading();
				notifyUser('올바른 위도와 경도를 입력해주세요.');
				return;
			}
			$('.coordinate_popup').hide();
			let title = document.querySelector('.station_modal_header h2');
			if (title) {
				title.textContent = (name ? name + ' · ' : '')
					+ '위도 ' + lat.toFixed(4) + ' · 경도 ' + lon.toFixed(4);
			}

			const forecastControls = readForecastControls();
			const forecastBaseDate = forecastControls.date;
			const baseTime = forecastControls.time;
			const date = forecastBaseDate + baseTime;
			let chart = document.getElementById('chart');
			if (window.WEATHER_GRID_STATION_CHARTS) window.WEATHER_GRID_STATION_CHARTS.destroy();
			else if (chart) chart.replaceChildren();
			['station_chart_summary', 'station_data_table'].forEach(function (id) {
				let element = document.getElementById(id);
				if (element) element.replaceChildren();
			});
			let details = document.getElementById('station_data_details');
			if (details) details.open = false;

			if (window.WEATHER_GRID_STOP_PLAYBACK) window.WEATHER_GRID_STOP_PLAYBACK();
			cancelStationRequest();
			let seq = stnQuerySeq;
			const requestController = new AbortController();
			stnRequestController = requestController;
			let requestTimedOut = false;
			const requestTimeout = window.setTimeout(function () {
				requestTimedOut = true;
				requestController.abort();
			}, STATION_REQUEST_TIMEOUT_MS);
			showStationChartLoading();
			let stationDialog = document.querySelector('.station_modal');
			if (stationDialog) stationDialog.style.display = 'block';
			// 단기예보 응답에 함께 들어 있는 요소는 화면 스트립과 차트가 한 요청을 공유한다.
			// 요소별 stnData 호출을 덧붙이지 않아 지점 클릭 한 번이 상류 요청 여러 건으로 번지지 않는다.
			const sharedForecastElements = ['pcp', 'pty', 'sno', 'reh', 'sky', 'wav'];
			const usesSharedForecast = sharedForecastElements.includes(element);
			let forecastRequest = (includeForecast || usesSharedForecast)
				? fetchPointForecast(lat, lon, forecastBaseDate, baseTime + '00')
				: null;
			let query = new URLSearchParams({
				latitude: lat.toFixed(4),
				longitude: lon.toFixed(4),
				baseDate: forecastBaseDate,
				baseTime: baseTime + '00',
				element: element,
				height: height
			});

			let chartReady = window.WEATHER_GRID_STATION_CHARTS
				? window.WEATHER_GRID_STATION_CHARTS.ensureReady(element)
				: Promise.reject(new Error('STATION_CHART_MODULE_UNAVAILABLE'));
			let stationData = usesSharedForecast
				? Promise.resolve(forecastRequest).then(function (forecast) {
					if (!forecast || !Array.isArray(forecast.items)) {
						throw new Error('STATION_FORECAST_ELEMENT_UNAVAILABLE');
					}
					return forecast;
				})
				: fetch(apiUrl('/api/weather/timeseries?' + query.toString()), {
					signal: requestController.signal
				})
					.then(function (response) {
						if (!response.ok) throw new Error('STATION_DATA_UNAVAILABLE');
						return response.json();
					});
			Promise.all([stationData, chartReady])
				.then(function (results) {
					if (seq !== stnQuerySeq) return;
					let data = results[0];
					if (!window.WEATHER_GRID_STATION_CHARTS
							|| !window.WEATHER_GRID_STATION_CHARTS.render(element, data, date)) {
						throw new Error('STATION_CHART_UNAVAILABLE');
					}
					if (stnRequestController === requestController) stnRequestController = null;
					setStationChartBusy(false);
				})
				.catch(function (error) {
					if (seq !== stnQuerySeq) return;
					if (stnRequestController === requestController) stnRequestController = null;
					if (!requestController.signal.aborted) requestController.abort();
					if (error && error.name === 'AbortError' && !requestTimedOut) return;
					let message = '시계열 차트를 불러오지 못했습니다. 상세예보는 계속 확인할 수 있습니다.';
					if (requestTimedOut) {
						message = '시계열 응답 시간이 초과되었습니다. 다시 시도해 주세요. 상세예보는 계속 확인할 수 있습니다.';
					} else if (error && error.code === 'SCRIPT_LOAD_TIMEOUT') {
						message = '차트 모듈 응답 시간이 초과되었습니다. 다시 시도해 주세요. 상세예보는 계속 확인할 수 있습니다.';
					}
					// 상세예보는 독립 요청·재시도 상태를 유지한다. 차트 오류가 상세예보를
					// 다시 내려받거나 성공한 내용을 로딩 상태로 되돌리지 않게 한다.
					showStationChartError(message, function () { openStationTimeline(name, lat, lon, false); });
				})
				.finally(function () {
					window.clearTimeout(requestTimeout);
				});
		}

		function openCoordinateTimeline() {
			openStationTimeline('',
				document.querySelector('#latitude').textContent,
				document.querySelector('#longitude').textContent);
		}

		function openStationForecast(name, latitude, longitude) {
			setSelectedStationName(name);
			openStationTimeline(name, latitude, longitude);
		}

		function submitCoordinateLookup() {
			let latitude = document.getElementById('coordinate_latitude').value;
			let longitude = document.getElementById('coordinate_longitude').value;
			if (!latitude || !longitude) {
				endGridLoading();
				notifyUser('위도와 경도를 빠짐없이 입력해 주세요.');
				return;
			}
			coordinatePanel.style.display = 'none';
			coordinateSearchToggle.setAttribute('aria-expanded', 'false');
			openStationTimeline('', latitude, longitude);
		}
		function cancelPointLookup() {
			pointQuerySeq++;
			if (pointRequestController) pointRequestController.abort();
			pointRequestController = null;
		}
		// 다른 지도 도구가 켜질 때 진행 중인 좌표 조회가 뒤늦게 팝업을 열지 않게 한다.
		window.WEATHER_GRID_CANCEL_POINT_LOOKUP = cancelPointLookup;

		/** 지도 가장자리에서도 좌표 팝업 전체가 보이도록 실제 크기를 측정해 배치한다. */
		function positionStationPopup(pixel) {
			let popup = document.querySelector('.coordinate_popup');
			let container = document.querySelector('.map_workspace');
			if (!popup || !container) return;
			popup.style.left = '8px';
			popup.style.top = '8px';
			popup.style.display = 'block';
			requestAnimationFrame(function () {
				let containerRect = container.getBoundingClientRect();
				let popupRect = popup.getBoundingClientRect();
				let x = pixel[0] + 14;
				let y = pixel[1] + 14;
				if (x + popupRect.width > containerRect.width - 8) x = pixel[0] - popupRect.width - 14;
				if (y + popupRect.height > containerRect.height - 8) y = pixel[1] - popupRect.height - 14;
				x = Math.max(8, Math.min(x, containerRect.width - popupRect.width - 8));
				y = Math.max(8, Math.min(y, containerRect.height - popupRect.height - 8));
				popup.style.left = Math.round(x) + 'px';
				popup.style.top = Math.round(y) + 'px';
			});
		}

		/** 지도 클릭한 지점 좌표를 위경도로 변환해 시계열 지원 범위를 확인한다. */
		function openCoordinateForecast(evt) {
			cancelPointLookup();
			const seq = pointQuerySeq;
			pointRequestController = new AbortController();
			let coordinate = evt.coordinate;
			let lonLat = ol.proj.transform(coordinate, weatherMap.getView().getProjection(), 'EPSG:4326');

			let tranLatitude = lonLat[1].toFixed(4);    //위도
			let tranLongitude = lonLat[0].toFixed(4);    //경도
			let latitude = tranLatitude;
			let longitude = tranLongitude;


			fetch(apiUrl('/api/weather/coverage?latitude=' + encodeURIComponent(latitude) + '&longitude=' + encodeURIComponent(longitude)), {
				signal: pointRequestController.signal
			})
				.then(response => {
					if (!response.ok) {
						throw new Error('선택한 위치의 예보 자료를 찾을 수 없습니다.');
					}
					return response.json();
				})
				.then(data => {
					if (seq !== pointQuerySeq) return;
					pointRequestController = null;
					if (data && data.inside === true) {
						document.getElementById('latitude').textContent = tranLatitude;
						document.getElementById('longitude').textContent = tranLongitude;
						positionStationPopup(evt.pixel);
					} else {
						showMapNotice('선택한 지점은 시계열 지원 범위 밖입니다.');
					}
				})
				.catch(error => {
					if (seq !== pointQuerySeq || (error && error.name === 'AbortError')) return;
					pointRequestController = null;
					showMapNotice('지점 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
				});
		}

		function bindRegionMarkerSelection() {
			function routedOverlayFeature(feature) {
				if (window.WEATHER_GRID_OVERLAY_ROUTER && typeof window.WEATHER_GRID_OVERLAY_ROUTER.handlesFeature === 'function') {
					return window.WEATHER_GRID_OVERLAY_ROUTER.handlesFeature(feature);
				}
				let properties = feature && feature.getProperties ? feature.getProperties() : {};
				let clustered = properties.features;
				return properties.kind === 'air-quality' || properties.kind === 'cctv'
					|| (Array.isArray(clustered) && clustered.some(function (item) {
						let kind = item.get('kind');
						return kind === 'air-quality' || kind === 'cctv';
					}));
			}
			// singleclick은 더블클릭/더블탭 줌의 첫 click과 분리되어 좌표 팝업이 함께 열리지 않는다.
			weatherMap.on('singleclick', function (evt) {
				if (window.WEATHER_GRID_MEASURE && window.WEATHER_GRID_MEASURE.isActive()) return;
				const selectedFeature = weatherMap.forEachFeatureAtPixel(evt.pixel, function (candidate, layer) {
					return layer === stationVectorLayer || routedOverlayFeature(candidate) ? candidate : undefined;
				}, { hitTolerance: 12 });
				if (!selectedFeature) {
					openCoordinateForecast(evt);
					return;
				}
				cancelPointLookup();
				if (routedOverlayFeature(selectedFeature)) return;
				const station = selectedFeature.getProperties();
				const stationName = station.stn_name;
				const latitude = Number(station.latitude);
				const longitude = Number(station.longitude);
				if (stationName && Number.isFinite(latitude) && Number.isFinite(longitude)) {
					openStationForecast(stationName, latitude, longitude);
					return;
				}
				openCoordinateForecast(evt);
			});
		}

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

		/** 조회 함수 - 격자 API 한 번으로 히트맵 + 스트림라인 동시 처리 */
		let gridQuerySeq = 0;    // 응답 순서 역전 방어 — 마지막 요청만 화면에 반영
		let activeGridRequest = null;

		/**
		 * 조회 파이프라인의 진입점 — 현재 컨트롤 상태(요소·고도·날짜·발표시각·발효)를
		 * 읽어 /api/weather/grid 1콜로 분포도+통계+스트림라인을 받고 화면을 다시 그린다.
		 * 응답 순서 역전은 gridQuerySeq로 방어, 표시 레이어 토글은 applyRenderMode 훅이 재적용.
		 */
		function refreshWeatherGrid() {
			const mySeq = ++gridQuerySeq;
			if (activeGridRequest && activeGridRequest.readyState !== 4) {
				activeGridRequest.abort();
			}
			activeGridRequest = null;
			syncAvailableBaseTimes();
			if (!isValidForecastSelection()) {
				window.WEATHER_GRID_GRID_LOADING = false;
				endGridLoading();
				if (window.WEATHER_GRID_STOP_PLAYBACK) window.WEATHER_GRID_STOP_PLAYBACK();
				notifyUser('최근 60일 이내의 유효한 날짜와 발표시각을 선택해 주세요.');
				document.dispatchEvent(new CustomEvent('weather-grid:grid-settled', { detail: { success: false } }));
				return;
			}
			lastWindField = null;
			window.lastWindField = null;
			lastWindQuery = null;
			clearWindStreamlines();
			// 새 요청의 레이블 아래 이전 시각의 지도·3D 원본이 남지 않도록 먼저 비운다.
			window.lastGridResult = null;
			window.lastGridElement = null;
			weatherRasterLayer.setSource(null);
			if (window.WEATHER_GRID_ISO) window.WEATHER_GRID_ISO.refresh();
			if (typeof window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION === 'function') {
				window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION(null, $('#element').val());
			}
			$('#grid_stat_min, #grid_stat_avg, #grid_stat_max').text('—');
			const staleMockBadge = document.getElementById('mock_badge');
			if (staleMockBadge) staleMockBadge.style.display = 'none';

			renderForecastTimeline(leadHourCursor);

			const params = collectWeatherRequest();

			updateWeatherLegend();

			const forecastControls = readForecastControls();
			const element = forecastControls.element;    // 현재 선택한 단일 기상 요소만 지연 조회
			const forecastBaseDate = forecastControls.date;
			const baseTime = forecastControls.time;
			const height = forecastControls.height;
			let leadHoursVal = leadHourCursor;

			// 일사 색상 스케일은 월별로 다르다 — 조회 날짜의 월로 갱신
			// (기존에는 페이지 로드 시점 월이 고정되어 다른 달 조회 시 색이 어긋났음)
			month = forecastBaseDate.substring(4, 6);

			beginGridLoading();
			clearDataError('grid');
			window.WEATHER_GRID_GRID_LOADING = true;
			let requestSucceeded = false;
			activeGridRequest = $.ajax({
				url: apiUrl("/api/weather/grid?baseDate=" + encodeURIComponent(forecastBaseDate) + "&baseTime=" + encodeURIComponent(baseTime + "00") + "&element=" + encodeURIComponent(element) + "&height=" + encodeURIComponent(height) + "&leadHours=" + encodeURIComponent(leadHoursVal)),
				method: 'GET',
				dataType: 'json',
				timeout: GRID_REQUEST_TIMEOUT_MS,
				success: function (result) {
					// 재생 등 연속 조회에서 늦게 도착한 이전 응답이 최신 화면을 덮지 않게 폐기
					if (mySeq !== gridQuerySeq) return;
					if(result && result.data && result.data.length != 0){
						requestSucceeded = true;
						// 3D 뷰 등 다른 모듈이 재사용할 수 있게 마지막 응답 보관
						window.lastGridResult = result;
						window.lastGridElement = element;
						updateSelectionSummary();
						if (typeof window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION === 'function') {
							window.WEATHER_GRID_UPDATE_LEGEND_DISTRIBUTION(result, element);
						}

						// API 미연결 데모 데이터 여부 배지
						const mockBadge = document.getElementById('mock_badge');
						if (mockBadge) mockBadge.style.display = result.mock ? 'block' : 'none';
						clearDataError('grid');

						// 히트맵 렌더링 — 픽셀마다 공식 격자변환으로 셀을 직접 찾는다
						renderWeatherRaster(result.data, element, result.nx, result.ny,
							{nxMin: result.nxMin, nyMin: result.nyMin, step: result.step});

						// 표시 모드(히트맵|등치선) 재적용 — 영속 레이어의 소스를 바꾼 뒤에도
						// 사용자가 선택한 visible 상태를 유지한다.
						if (window.applyRenderMode) window.applyRenderMode();
						if (result.stats && !weatherElementMeta(element).categorical) {
							$("#grid_stat_min").text(result.stats.min);
							$("#grid_stat_avg").text(result.stats.avg);
							$("#grid_stat_max").text(result.stats.max);
						} else if (weatherElementMeta(element).categorical) {
							$("#grid_stat_min, #grid_stat_avg, #grid_stat_max").text('—');
						}

						// 같은 응답의 U/V 벡터장을 2D와 3D가 공유한다. 단위는 m/s다.
						if(element === 'wdws' && result.windField){
							lastWindField = result.windField;
							window.lastWindField = lastWindField;
							lastWindQuery = params;
							windRenderer = createWindRenderer(lastWindField);
							restartWindParticles();
						} else {
							clearWindStreamlines();
							if(element === 'swdn'){
								const selectedSolarMonth = $('#forecast_date').val().split('-')[1];
								syncSolarLegend(selectedSolarMonth);
							}
						}

						endGridLoading();
					} else {
						endGridLoading();
						clearWindStreamlines();
						setDataError('선택한 발표시각에는 제공되는 데이터가 없습니다.');
						if (window.WEATHER_GRID_STOP_PLAYBACK) window.WEATHER_GRID_STOP_PLAYBACK();
						fireAlert({
							title: '자료 없음',
							text: '선택한 발표 시각에는 자료가 없습니다.\n'
								+ todayStr + ' ' + time + '시 발표 자료로 이동할까요?',
							showCancelButton: true,
							confirmButtonText: '이동',
							cancelButtonText: '현재 선택 유지'
						}).then(function (decision) {
							if (decision.isConfirmed) {
								$('#forecast_date').val(todayStr);
								selectForecastBaseTime(time);
								leadHourCursor = 1;
								renderForecastTimeline(leadHourCursor);
								refreshWeatherGrid();
							}
						});
					}
				},
				error: function (jqXHR, textStatus, errorThrown) {
					if (mySeq !== gridQuerySeq) return;
					if (textStatus === 'abort') return;
					let message = '기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
					if (textStatus === 'timeout') message = '기상 데이터 응답 시간이 초과되었습니다. 다시 시도해 주세요.';
					else if (jqXHR.status === 429) message = '요청이 많아 잠시 후 다시 시도해 주세요.';
					setDataError(message);
					if (window.WEATHER_GRID_STOP_PLAYBACK) window.WEATHER_GRID_STOP_PLAYBACK();
					console.warn('weather grid request failed', errorThrown);
				},
				complete: function () {
					if (mySeq !== gridQuerySeq) return;
					endGridLoading();
					activeGridRequest = null;
					window.WEATHER_GRID_GRID_LOADING = false;
					document.dispatchEvent(new CustomEvent('weather-grid:grid-settled', {
						detail: { success: requestSucceeded }
					}));
				}
			});

			updateSelectionSummary();
		}
		window.WEATHER_GRID_REFRESH_GRID = refreshWeatherGrid;

		/** 마지막 응답의 조회 조건을 3D 모듈과 공유한다. */
		function collectWeatherRequest() {
			const controls = readForecastControls();
			return {
				element: controls.element,
				baseDate: controls.date,
				baseTime: controls.time,
				leadHours: leadHourCursor.toString().padStart(3, '0'),
				height: controls.height
			};
		}

		/**
		 * 분포도 렌더링 — 화면 픽셀 → 위경도 → 공식 격자변환으로 셀 값을 직접 샘플링.
		 *
		 * 격자 모서리만 사각형 이미지로 투영하면
		 * 데이터 격자의 투영(구면 LCC)과 화면 투영(타원체 LCC)의 내부 왜곡 차이로
		 * 지점별 최대 1.4셀(약 7km)씩 실제 좌표와 어긋난 값을 표출했다.
			 * 이 방식은 지점 예보 조회와 동일한 공식 변환을 픽셀마다 적용하므로
		 * 화면의 모든 픽셀이 정확히 해당 좌표의 격자 값을 보여준다.
		 *
		 * gridInfo: {nxMin, nyMin, step} — 서버 응답의 서브그리드 정보
		 */
		function renderWeatherRaster(dataList, element, apiNx, apiNy, gridInfo) {

			const nxMin = gridInfo.nxMin, nyMin = gridInfo.nyMin, step = gridInfo.step || 1;

			// PTY·SKY 코드의 대소·평균은 기상적 의미가 없다. 범주별 격자 분포만 범례에 표시한다.
			const categorical = !!weatherElementMeta(element).categorical;
			if (categorical) {
				$("#grid_stat_min, #grid_stat_avg, #grid_stat_max").text('—');
			} else {
				let minValue = Number.MAX_SAFE_INTEGER;
				let maxValue = -Number.MAX_SAFE_INTEGER;
				let sum = 0, cnt = 0;
				for (let k = 0; k < dataList.length; k++) {
					const v = dataList[k];
					if (!isValidWeatherValue(element, v)) continue;
					if (v > maxValue) maxValue = v;
					if (v < minValue) minValue = v;
					sum += v;
					cnt++;
				}
				const meanValue = cnt > 0 ? sum / cnt : 0;
				if (cnt === 0) { minValue = 0; maxValue = 0; }
				[
					['grid_stat_min', '최소', minValue],
					['grid_stat_avg', '평균', meanValue],
					['grid_stat_max', '최대', maxValue]
				].forEach(function (stat) {
					document.getElementById(stat[0]).textContent = '· ' + stat[1] + ' : '
						+ stat[2].toFixed(stat[2] === 0 ? 0 : 1);
				});
			}

			// 같은 구간색 변환을 픽셀마다 반복하지 않는다.
			const colorCache = {};
			function rgbaOf(v) {
				if (!isValidWeatherValue(element, v)) return [0, 0, 0, 0];
				const c = weatherColorFor(element, v, month);
				let arr = colorCache[c];
				if (!arr) {
					const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
					arr = [+m[1], +m[2], +m[3], Math.round((m[4] === undefined ? 1 : +m[4]) * 255)];
					colorCache[c] = arr;
				}
				return arr;
			}

			/** 현재 도법의 화면좌표 → 위경도 변환기.
			 *  LCC는 기존 proj4 컨버터를 재사용하고, 그 외 도법은 OL 변환을 쓴다.
			 *  (도법이 무엇이든 위경도 → 공식 격자변환 경로는 동일하므로
			 *   어떤 투영에서도 같은 좌표에는 같은 격자 값이 표출된다) */
			const viewProjCode = window.WEATHER_GRID_VIEW_PROJ || WEATHER_GRID_PROJECTION_CODE;
			const toLonLat = (viewProjCode === WEATHER_GRID_PROJECTION_CODE)
				? function (c) { return lccToLonLat.forward(c); }
				: ol.proj.getTransform(viewProjCode, 'EPSG:4326');
			const edgeOpacityAt = window.WeatherGridWindGrid.edgeOpacityAt;

			/** 뷰가 바뀔 때마다 OL이 호출 — 현재 extent를 픽셀 단위로 정확히 렌더 */
			const canvasFunction = function (extent, resolution, pixelRatio, size, projection) {
				const w = Math.round(size[0]), h = Math.round(size[1]);
				const canvas = document.createElement('canvas');
				canvas.width = w;
				canvas.height = h;
				const ctx = canvas.getContext('2d');
				// 작은 샘플 캔버스에 값을 한 번씩만 쓴 뒤 drawImage로 확대한다. 이전의
				// B×B JavaScript 픽셀 복사는 큰 화면에서 300ms 이상의 long task를 만들었다.
				// 약 12만 샘플을 목표로 반올림한다. 경계 섬(백령도·울릉도)의 한 셀이
				// 저해상도 샘플 중심 사이로 빠지지 않으면서도 고해상도 화면의 long task를 제한한다.
				const B = Math.max(2, Math.round(Math.sqrt((w * h) / 120000)));
				const sampleW = Math.max(1, Math.ceil(w / B));
				const sampleH = Math.max(1, Math.ceil(h / B));
				const sampleCanvas = document.createElement('canvas');
				sampleCanvas.width = sampleW;
				sampleCanvas.height = sampleH;
				const sampleCtx = sampleCanvas.getContext('2d');
				const img = sampleCtx.createImageData(sampleW, sampleH);
				const px = img.data;
				const lookupKey = gridRenderLookupKey(extent, resolution, pixelRatio, size, projection,
					viewProjCode, nxMin, nyMin, step, apiNx, apiNy, sampleW, sampleH);
				let lookup = gridRenderLookupCache;
				if (!lookup || lookup.key !== lookupKey) {
					const sampleCount = sampleW * sampleH;
					const dataIndices = new Int32Array(sampleCount);
					// Canvas 알파 채널과 같은 8비트로 보관해 LUT 메모리를 약 840KB 줄인다.
					const edgeAlpha = new Uint8Array(sampleCount);
					dataIndices.fill(-1);
					const spanX = extent[2] - extent[0];
					const spanY = extent[3] - extent[1];

					for (let y = 0; y < sampleH; y++) {
						const my = extent[3] - ((y + 0.5) / sampleH) * spanY;
						for (let x = 0; x < sampleW; x++) {
							const sampleIndex = y * sampleW + x;
							const mx = extent[0] + ((x + 0.5) / sampleW) * spanX;
							const ll = toLonLat([mx, my]);                     // 화면좌표(현재 도법) → 위경도
							const g = kmaLatLonToGridFrac(ll[1], ll[0]);       // 위경도 → 격자(분수)
							const gridX = (g[0] - nxMin) / step;
							const gridSouthY = (g[1] - nyMin) / step;
							const col = Math.round(gridX);
							const rowS = Math.round(gridSouthY);    // 남쪽 기준 행
							if (col < 0 || col >= apiNx || rowS < 0 || rowS >= apiNy) continue;
							dataIndices[sampleIndex] = (apiNy - 1 - rowS) * apiNx + col;
							edgeAlpha[sampleIndex] = Math.round(
								edgeOpacityAt(gridX, gridSouthY, apiNx, apiNy) * 255
							);
						}
					}
					lookup = {key: lookupKey, dataIndices: dataIndices, edgeAlpha: edgeAlpha};
					gridRenderLookupCache = lookup;
					gridRenderLookupCacheMisses++;
				} else {
					gridRenderLookupCacheHits++;
				}

				for (let sampleIndex = 0; sampleIndex < lookup.dataIndices.length; sampleIndex++) {
					const gridCellIndex = lookup.dataIndices[sampleIndex];
					if (gridCellIndex < 0) continue;    // 격자 밖은 투명
					const c = rgbaOf(dataList[gridCellIndex]);             // 데이터 값·색상은 현재 시각 기준
					const o = sampleIndex * 4;
					px[o] = c[0];
					px[o + 1] = c[1];
					px[o + 2] = c[2];
					px[o + 3] = Math.round(c[3] * lookup.edgeAlpha[sampleIndex] / 255);
				}
				sampleCtx.putImageData(img, 0, 0);
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(sampleCanvas, 0, 0, w, h);
				return canvas;
			};

			weatherRasterLayer.setSource(new ol.source.ImageCanvas({
				canvasFunction: canvasFunction,
				projection: viewProjCode,    // 현재 지도 도법과 동일하게
				ratio: 1
			}));
			endGridLoading();
		}
		/**
		 * 데이터에 따른 풍속 색상 찾기 (m/s, 1m/s 간격 12단계)
		 *
		 * 저풍속 구간을 1m/s 간격으로 세분화하고, 색은
		 * 남색→시안→초록→노랑→주황→빨강→마젠타로
		 * 강할수록 뜨거워지는 순차 팔레트를 쓴다.
		 * 범례(weather-grid-ui buildLegendScale)·등치선 레벨(isoline levelsFor)과 반드시 동기.
		 */
		function thresholdColor(value, thresholds, colors) {
			const index = thresholds.findIndex(function (limit) { return value <= limit; });
			return colors[index < 0 ? colors.length - 1 : index];
		}

		function windPaletteColor(data) {
		    const colors = [
		        "rgba(44, 46, 126, 0.82)",     // 1 이하 — 정온, 딥 인디고
		        "rgba(39, 83, 155, 0.82)",     // 1~2
		        "rgba(31, 119, 173, 0.82)",    // 2~3
		        "rgba(21, 149, 173, 0.82)",    // 3~4
		        "rgba(30, 170, 150, 0.82)",    // 4~5
		        "rgba(88, 184, 108, 0.82)",    // 5~6
		        "rgba(145, 198, 93, 0.82)",    // 6~7
		        "rgba(196, 207, 98, 0.82)",    // 7~8
		        "rgba(236, 211, 106, 0.82)",   // 8~9
		        "rgba(245, 173, 91, 0.82)",    // 9~10
		        "rgba(239, 116, 78, 0.82)",    // 10~12
		        "rgba(216, 68, 112, 0.82)"     // 12 초과 — 강풍 경고색
		    ];
		    const thresholds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

			return thresholdColor(data, thresholds, colors);
		}

		function findTmpColor(v) {
		    if (v <= -900) return 'rgba(0,0,0,0)';    // 결측(비관측영역) — 투명
		    const colors = [
		        "rgba(55, 48, 163, 0.7)",     // -15 이하
		        "rgba(29, 78, 216, 0.7)",     // -15 ~ -10
		        "rgba(2, 132, 199, 0.7)",     // -10 ~ -5
		        "rgba(6, 182, 212, 0.7)",     // -5 ~ 0
		        "rgba(20, 184, 166, 0.7)",    // 0 ~ 5
		        "rgba(34, 197, 94, 0.7)",     // 5 ~ 10
		        "rgba(163, 230, 53, 0.7)",    // 10 ~ 15
		        "rgba(250, 204, 21, 0.7)",    // 15 ~ 20
		        "rgba(251, 146, 60, 0.7)",    // 20 ~ 25
		        "rgba(248, 113, 113, 0.7)",   // 25 ~ 30
		        "rgba(239, 68, 68, 0.7)",     // 30 ~ 35
		        "rgba(190, 18, 60, 0.7)"      // 35 이상
		    ];
		    const th = [-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35];
			return thresholdColor(v, th, colors);
		}

		/**
		 * 기상청 1시간 강수량(mm) 강도 구간.
		 * 지도·범례·등치선·지점 차트가 같은 경계(1/3/15/30/50)를 사용한다.
		 */
		function findRainColor(v) {
			if (!Number.isFinite(v) || v < 0 || v <= -900) return 'rgba(0,0,0,0)';
			if (v === 0) return 'rgba(119, 139, 160, 0)';
			if (v < 1) return 'rgba(143, 224, 238, 0.62)';
			if (v < 3) return 'rgba(68, 187, 221, 0.70)';
			if (v < 15) return 'rgba(48, 126, 211, 0.76)';
			if (v < 30) return 'rgba(91, 91, 195, 0.80)';
			if (v < 50) return 'rgba(153, 72, 179, 0.84)';
			return 'rgba(210, 61, 123, 0.88)';
		}

		/** 신적설(cm)은 강수량(mm)과 단위·의미가 달라 차가운 보라 계열을 독립 사용한다. */
		function findSnowColor(v) {
			if (!Number.isFinite(v) || v < 0 || v <= -900) return 'rgba(0,0,0,0)';
			if (v === 0) return 'rgba(133, 148, 173, 0)';
			if (v < 1) return 'rgba(191, 226, 248, 0.58)';
			if (v < 3) return 'rgba(139, 199, 235, 0.68)';
			if (v < 5) return 'rgba(135, 148, 224, 0.75)';
			if (v < 10) return 'rgba(139, 104, 205, 0.81)';
			if (v < 20) return 'rgba(161, 72, 178, 0.85)';
			return 'rgba(190, 55, 132, 0.9)';
		}

		function findHumidityColor(v) {
			if (!Number.isFinite(v) || v < 0 || v > 100 || v <= -900) return 'rgba(0,0,0,0)';
			if (v <= 20) return 'rgba(225, 174, 91, 0.72)';
			if (v <= 40) return 'rgba(190, 190, 112, 0.72)';
			if (v <= 60) return 'rgba(114, 190, 151, 0.75)';
			if (v <= 80) return 'rgba(55, 170, 177, 0.78)';
			if (v <= 90) return 'rgba(53, 132, 190, 0.81)';
			return 'rgba(77, 92, 177, 0.84)';
		}

		function findPrecipitationTypeColor(v) {
			return ({
				0: 'rgba(119, 139, 160, 0)',
				1: 'rgba(55, 142, 211, 0.82)',
				2: 'rgba(130, 118, 214, 0.84)',
				3: 'rgba(181, 151, 226, 0.86)',
				4: 'rgba(37, 174, 183, 0.84)'
			})[Number(v)] || 'rgba(0,0,0,0)';
		}

		function findSkyColor(v) {
			return ({
				1: 'rgba(245, 190, 83, 0.78)',
				3: 'rgba(111, 151, 188, 0.78)',
				4: 'rgba(91, 97, 132, 0.84)'
			})[Number(v)] || 'rgba(0,0,0,0)';
		}

		function findWaveColor(v) {
			if (!Number.isFinite(v) || v < 0 || v <= -900) return 'rgba(0,0,0,0)';
			if (v < 0.5) return 'rgba(156, 225, 226, 0.58)';
			if (v < 1) return 'rgba(80, 190, 207, 0.68)';
			if (v < 2) return 'rgba(42, 139, 196, 0.76)';
			if (v < 3) return 'rgba(78, 92, 181, 0.81)';
			if (v < 4) return 'rgba(142, 76, 169, 0.85)';
			return 'rgba(205, 71, 111, 0.89)';
		}

		function weatherColorFor(element, value, selectedMonth) {
			if (!isValidWeatherValue(element, value)) return 'rgba(0,0,0,0)';
			if (element === 'wdws') return windPaletteColor(value);
			if (element === 'tmp') return findTmpColor(value);
			if (element === 'pcp') return findRainColor(value);
			if (element === 'sno') return findSnowColor(value);
			if (element === 'reh') return findHumidityColor(value);
			if (element === 'pty') return findPrecipitationTypeColor(value);
			if (element === 'sky') return findSkyColor(value);
			if (element === 'wav') return findWaveColor(value);
			return solarPaletteColor(value, selectedMonth);
		}

		window.WEATHER_GRID_WEATHER_COLOR = weatherColorFor;

		function solarPaletteColor(value, month) {
			const ranges = monthlySolarThresholds[month] || monthlySolarThresholds['01'];
			const bucket = ranges.findIndex(function (upperBound) { return value <= upperBound; });
			return solarPalette[bucket < 0 ? solarPalette.length - 1 : bucket];
		}

		/** 연속 휠·드래그·리사이즈가 끝난 뒤 마지막 뷰에서 한 번만 보간한다. */
		function scheduleStreamlineRefresh() {
			clearTimeout(streamlineRefreshTimer);
			streamlineRefreshTimer = setTimeout(updateStreamlineAfterMove, 80);
		}

		function updateStreamlineAfterMove() {
			if (lastWindField == null || $('#element').val() !== 'wdws') {
				const canvas = document.getElementById('wind_field_canvas');
				if (canvas) canvas.classList.remove('is-map-moving');
				return;
			}
			if (!windRenderer) windRenderer = createWindRenderer(lastWindField);
			restartWindParticles();
		}

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
			if (!Number.isInteger(requested)) return;
			if (requested === leadHourCursor) {
				notifyUser(leadHourCursor === firstHour ? '더 이른 예보는 없습니다.' : '더 늦은 예보는 없습니다.');
				return;
			}
			leadHourCursor = requested;
			renderForecastTimeline(leadHourCursor);
			refreshWeatherGrid();
			syncSolarLegend($('#forecast_date').val().split('-')[1]);
		}

		function suspendStreamlineForViewChange() {
			const canvas = document.getElementById('wind_field_canvas');
			if (canvas) canvas.classList.add('is-map-moving');
			if (windRenderer) windRenderer.stop();
		}

		/** 연속 resize 이벤트마다 보간 필드를 다시 만들지 않고 마지막 크기에서 한 번만 갱신한다. */
		$(window).on('resize', function () {
			weatherMap.updateSize();
			suspendStreamlineForViewChange();
			clearTimeout(streamlineRefreshTimer);
			streamlineRefreshTimer = setTimeout(updateStreamlineAfterMove, 140);
		});
		weatherMap.on('movestart', suspendStreamlineForViewChange);

		// 표시 레이어 토글(weather-grid-ui)이 스트림라인을 제어할 수 있게 노출
		window.refreshStreamlines = function () { restartWindParticles(); };
		window.clearStreamlines = function () { clearWindStreamlines(); };
		/** 토글 OFF용 일시 숨김 — 인스턴스와 원본 벡터장은 보존한다. */
		window.suspendStreamlines = function () {
			const canvas = document.getElementById('wind_field_canvas');
			if (canvas) canvas.style.display = 'none';
			if (windRenderer) windRenderer.stop();
		};
		window.getWindDiagnostics = function () {
			const diagnostics = windRenderer ? windRenderer.getDiagnostics() : { state: 'empty' };
			return Object.assign({ query: lastWindQuery }, diagnostics);
		};

		/** 현재 뷰에서 입자 필드를 다시 만든다. 서버 데이터는 재요청하지 않는다. */
		function restartWindParticles() {
			// 3D 오버레이가 열린 동안 resize·테마·레이어 이벤트가 들어와도 뒤쪽의
			// 2D RAF를 되살리지 않는다. 재개는 3D 닫기 흐름에서 한 번만 수행한다.
			const view3d = document.getElementById('view3d');
			if (view3d && view3d.classList.contains('open')) {
				window.suspendStreamlines();
				return;
			}
			// 표시 토글이 꺼져 있으면 어떤 경로(조회·이동·리사이즈)로 불려도 그리지 않는다.
			// 인스턴스는 남겨 토글을 다시 켰을 때 같은 벡터장을 재사용한다.
			if (window.WEATHER_GRID_LAYERS && !window.WEATHER_GRID_LAYERS.stream) {
				window.suspendStreamlines();
				return;
			}

			const canvas = document.getElementById('wind_field_canvas');
			if (!canvas || !windRenderer) return;
			canvas.style.display = 'block';
			weatherMap.updateSize();

			const mapSize = weatherMap.getSize();
			if (!mapSize || mapSize[0] < 1 || mapSize[1] < 1) return;
			const view = weatherMap.getView();
			const viewProjectionExtent = view.calculateExtent(mapSize);

			/** CSS 크기는 지도와 1:1로 유지한다. backing store만 DPR을 반영하고
			 * 8MP를 상한으로 둬 고해상도 모니터에서도 메모리와 합성 비용을 제한한다. */
			const desiredScale = Math.max(1, window.devicePixelRatio || 1);
			const maxScale = Math.sqrt(MAX_STREAM_CANVAS_PIXELS / (mapSize[0] * mapSize[1]));
			// 반올림 오차를 포함해 8MP 안에 머물도록 여유를 둔다.
			const renderScale = Math.min(desiredScale, maxScale * 0.995);
			canvas.style.width = mapSize[0] + 'px';
			canvas.style.height = mapSize[1] + 'px';
			canvas.width = Math.max(1, Math.round(mapSize[0] * renderScale));
			canvas.height = Math.max(1, Math.round(mapSize[1] * renderScale));

			windRenderer.start({
				width: mapSize[0],
				height: mapSize[1],
				viewProjectionExtent: viewProjectionExtent,
				projectionCode: view.getProjection().getCode()
			});
			canvas.classList.remove('is-map-moving');
		}

		/** 원본 벡터장까지 폐기한다. 새 조회 응답이 올 때만 인스턴스를 다시 만든다. */
		function clearWindStreamlines() {
			const canvas = document.getElementById('wind_field_canvas');
			if (windRenderer) windRenderer.destroy();
			windRenderer = null;
			if (!canvas) return;
			canvas.style.display = 'none';
			canvas.classList.remove('is-map-moving');
			const context = canvas.getContext('2d');
			context.clearRect(0, 0, canvas.width, canvas.height);
		}

		window.addEventListener('pagehide', function () {
			if (windRenderer) windRenderer.destroy();
			windRenderer = null;
		}, { once: true });

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

		/** 색상 스케일은 weather-grid-ui.js가 만들고 이 함수는 선택 요소의 단위만 동기화한다. */
		function updateWeatherLegend() {
			const chosenElementValue = document.getElementById("element").value;
			const meta = weatherElementMeta(chosenElementValue);
			const stats = document.querySelector('#weather_legend .grid_stats');
			if (stats) stats.hidden = !!meta.categorical;
			$('.grid_stats h3').text(meta.label + (meta.unit ? ' (' + meta.unit + ')' : ''));
		}

		/** 월에 따라 달라지는 일사 스케일을 UI 모듈과 동기화한다. */
		function syncSolarLegend(month) {
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
		function showMapNotice(message) {
			let notice = document.getElementById('map_notice');
			if (!notice) {
				notice = document.createElement('div');
				notice.id = 'map_notice';
				notice.className = 'map_notice';
				notice.setAttribute('role', 'status');
				notice.setAttribute('aria-live', 'polite');
				document.querySelector('.map_workspace').appendChild(notice);
			}
			notice.textContent = message;
			notice.hidden = false;
			clearTimeout(mapNoticeTimer);
			mapNoticeTimer = window.setTimeout(function () { notice.hidden = true; }, 2600);
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
		function beginGridLoading() { setLoadingState(true); }
		function endGridLoading() { setLoadingState(false); }

			$('.latest_run_button').on('click', function () {
				const latest = refreshLatestForecastGlobals();
				$('#forecast_date').val(latest.date);
				selectForecastBaseTime(latest.time);
				syncAvailableBaseTimes();
			});

			document.querySelectorAll('#forecast_timeline li').forEach(function (slot) {
				slot.addEventListener('click', function () {
					leadHourCursor = Number.parseInt(slot.getAttribute('value'), 10);
					renderForecastTimeline(leadHourCursor);
					updateSelectionSummary();
					syncSolarLegend(document.getElementById('forecast_date').value.split('-')[1]);
					refreshWeatherGrid();
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
					const selectedMonth = $('#forecast_date').val().split('-')[1];
					syncSolarLegend(selectedMonth);
					refreshWeatherGrid();
				});
			}

			$('.forecast_run_button').on('click', function () {
				const val = $(this).text().trim();
				const alreadySelected = $(this).hasClass('on') && $('#baseTime').val() === val;
				if (alreadySelected) return;
				$('.forecast_run_button').removeClass('on').attr('aria-pressed', 'false');
				$(this).addClass('on').attr('aria-pressed', 'true');
				$('#baseTime').val(val);
				// 상태 반영 뒤 조회하도록 별도 이벤트를 쓴다. defer 스크립트의 리스너 등록 순서에 의존하지 않는다.
				document.dispatchEvent(new CustomEvent('weather-grid:base-time-changed', { detail: { baseTime: val } }));
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
				if (action) moveForecastCursor(action);
			});

			/** 지점명 자동완성과 분리된 위경도 검색 팝오버 */
			coordinateSearchToggle.addEventListener('click', function () {
				const opening = coordinatePanel.style.display === 'none';
				coordinatePanel.style.display = opening ? 'block' : 'none';
				coordinateSearchToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
				if (opening) {
					closeSuggestions();
					requestAnimationFrame(function () { document.getElementById('coordinate_latitude').focus(); });
				}
			});
			document.addEventListener('keydown', function (event) {
				if (event.key !== 'Escape' || coordinatePanel.style.display === 'none') return;
				coordinatePanel.style.display = 'none';
				coordinateSearchToggle.setAttribute('aria-expanded', 'false');
				coordinateSearchToggle.focus({ preventScroll: true });
			});

			document.querySelector('.coordinate_popup_close').addEventListener('click', function () {
				document.querySelector('.coordinate_popup').style.display = 'none';
			});

			document.querySelector('.station_timeline_button').addEventListener('click', openCoordinateTimeline);

			document.getElementById('coordinate_search_form').addEventListener('submit', function (event) {
				event.preventDefault();
				submitCoordinateLookup();
			});

			const stationToggleButton = document.getElementById('weather_stations');
			stationToggleButton.addEventListener('click', function () {
				const nextVisible = !stationVectorLayer.getVisible();
				stationVectorLayer.setVisible(nextVisible);
				stationToggleButton.classList.toggle('clicked', nextVisible);
				stationToggleButton.setAttribute('aria-pressed', String(nextVisible));
			});

			function displayBaseMap(mode) {
				const layerVisibility = {
					weather: { white: true, boundaries: false, road: false },
					boundaries: { white: false, boundaries: true, road: false },
					streets: { white: false, boundaries: false, road: true }
				}[mode];
				if (!layerVisibility) return;
				markSelectedBasemap('basemap_' + mode);
				regionLabelControls.style.display = layerVisibility.boundaries ? 'block' : 'none';
				provinceBoundaryControls.style.display = layerVisibility.boundaries ? 'block' : 'none';
				weatherBasemapLayer.setVisible(layerVisibility.white);
				vectorLayer.setVisible(layerVisibility.boundaries);
				provinceBoundaryLayer.setVisible(layerVisibility.boundaries);
				streetTileLayer.setVisible(layerVisibility.road);
				const mapElement = document.getElementById('map');
				mapElement.classList.toggle('map-weather', layerVisibility.white);
				mapElement.classList.toggle('map-boundaries', layerVisibility.boundaries);
				applyMapThemeStyles();
			}

			document.getElementById('basemap_weather').addEventListener('click', function () {
				displayBaseMap('weather');
			});

			document.getElementById('basemap_boundaries').addEventListener('click', async function () {
				this.disabled = true;
				this.setAttribute('aria-busy', 'true');
				try {
					await ensureVectorMapData();
					provinceBoundaryFlag = false;
					regionLabelFlag = true;
					setBoundaryToggle('province_boundary_toggle', false);
					setBoundaryToggle('region_label_toggle', true);
					displayBaseMap('boundaries');
				} catch (error) {
					notifyUser('벡터지도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
				} finally {
					this.disabled = false;
					this.removeAttribute('aria-busy');
				}
			});

			document.getElementById('basemap_streets').addEventListener('click', function () {
				displayBaseMap('streets');
			});

			/** 테마 변경 시 레이어별 OpenLayers 스타일을 다시 연결한다. */
			function setStyle(layer, fillColor, strokeColor, strokeWidth, textField) {
			    const pal = mapPalette();
			    const fill = fillColor ? new ol.style.Fill({ color: fillColor }) : undefined;
			    const stroke = strokeColor ? new ol.style.Stroke({ color: strokeColor, width: strokeWidth }) : undefined;

			    // 라벨이 없는 육지·경계는 모든 피처가 같은 불변 스타일을 공유한다.
			    if (!textField) {
			        layer.setStyle(new ol.style.Style({ fill: fill, stroke: stroke }));
			        return;
			    }

			    const labelFill = new ol.style.Fill({ color: pal.label });
			    const labelHalo = new ol.style.Stroke({ color: pal.halo, width: 3 });
			    const featureStyles = new WeakMap();
			    layer.setStyle(feature => {
			        const text = feature.get(textField);
			        const cached = featureStyles.get(feature);
			        if (cached && cached.text === text) return cached.style;

			        const style = new ol.style.Style({
			            fill: fill,
			            stroke: stroke,
			            text: new ol.style.Text({
			                font: "600 12px system-ui, sans-serif",
			                fill: labelFill,
			                stroke: labelHalo,
			                text: text
			            })
			        });
			        featureStyles.set(feature, { text: text, style: style });
			        return style;
			    });
			}

			/** 현재 테마(다크/라이트)에 맞는 지도 팔레트 */
			function mapPalette() {
			    const light = document.documentElement.getAttribute('data-theme') === 'light';
			    return light ? {
			        land: '#ffffff',            // 백지도 랜드마스
			        landVec: '#fbfaf2',         // 벡터지도 랜드마스
			        coast: 'rgba(30, 100, 180, 0.55)',
			        stroke: 'rgba(71, 85, 105, 0.45)',
			        label: '#334155',
			        halo: 'rgba(255, 255, 255, 0.92)'
			    } : {
			        land: '#16233a',
			        landVec: '#182741',
			        coast: 'rgba(125, 211, 252, 0.40)',
			        stroke: 'rgba(148, 183, 214, 0.30)',
			        label: '#cbd5e1',
			        halo: 'rgba(6, 12, 24, 0.88)'
			    };
			}

			/** 현재 선택된 배경지도·토글 상태에 테마 팔레트를 적용
			 *  (배경지도 전환/지역명·도경계 토글/테마 전환 시 공통 호출) */
			window.applyMapThemeStyles = function () {
			    const pal = mapPalette();
			    const sel = document.querySelector('#basemap_choices .is-selected-basemap');
			    const mode = sel ? sel.id : 'basemap_weather';
			    if (mode === 'basemap_boundaries') {
			        setStyle(vectorLayer, pal.landVec, pal.stroke, 1);
			        setStyle(provinceBoundaryLayer, undefined, provinceBoundaryFlag ? pal.stroke : undefined, 1,
			            regionLabelFlag ? 'nameKo' : undefined);
			    } else {
			        setStyle(weatherBasemapLayer, pal.land, pal.coast, 1);
			    }
			};

			function markSelectedBasemap(selectedId) {
				document.querySelectorAll('#basemap_choices [id^="basemap_"]').forEach(function (element) {
					const selected = element.id === selectedId;
					element.classList.toggle('is-selected-basemap', selected);
					element.setAttribute('aria-pressed', String(selected));
				});
			}

			/** 검색 제안 combobox: 입력 포커스를 유지한 채 방향키로 선택한다. */
			let activeSuggestionIndex = -1;
			function regionSuggestionNodes() {
				return Array.from(stationSuggestionList.querySelectorAll('[role="option"]:not([aria-disabled="true"])'));
			}
			function setActiveSuggestion(index) {
				const items = regionSuggestionNodes();
				if (!items.length) return;
				activeSuggestionIndex = (index + items.length) % items.length;
				items.forEach((item, itemIndex) => item.setAttribute('aria-selected', itemIndex === activeSuggestionIndex ? 'true' : 'false'));
				stationSearchInput.setAttribute('aria-activedescendant', items[activeSuggestionIndex].id);
				items[activeSuggestionIndex].scrollIntoView({block: 'nearest'});
			}
			function openSuggestions() {
				if (!stationSuggestionList.children.length) return;
				stationSuggestionList.style.display = 'block';
				stationSearchInput.setAttribute('aria-expanded', 'true');
			}
			function closeSuggestions() {
				stationSuggestionList.style.display = 'none';
				stationSearchInput.setAttribute('aria-expanded', 'false');
				stationSearchInput.removeAttribute('aria-activedescendant');
				activeSuggestionIndex = -1;
			}

			stationSearchInput.addEventListener('input', function () {
				const query = normalizedRegionName(stationSearchInput.value);
				stationSuggestionList.replaceChildren();
				if (stationSearchStatus) stationSearchStatus.textContent = '';
				activeSuggestionIndex = -1;

				if (query) {
					const filteredStations = stationSearchAnchors.filter(function (station) {
						return normalizedRegionName(station.name).includes(query);
					}).slice(0, 20);

					filteredStations.forEach(function (station, suggestionIndex) {
						const regionSuggestionNode = document.createElement('button');
						regionSuggestionNode.type = 'button';
						regionSuggestionNode.tabIndex = -1;
						regionSuggestionNode.setAttribute('role', 'option');
						regionSuggestionNode.setAttribute('aria-selected', 'false');
						regionSuggestionNode.id = 'station-option-' + suggestionIndex;
						regionSuggestionNode.className = 'station_suggestion_option';
						regionSuggestionNode.textContent = station.name;
						regionSuggestionNode.addEventListener('pointermove', function () { setActiveSuggestion(suggestionIndex); });
						regionSuggestionNode.addEventListener('click', function () {
							stationSearchInput.value = station.name;
							openStationForecast(station.name, station.lat, station.lon);
							closeSuggestions();
						});
						stationSuggestionList.appendChild(regionSuggestionNode);
					});

					if (!filteredStations.length) {
						const empty = document.createElement('div');
						empty.className = 'suggestion-empty';
						empty.setAttribute('role', 'option');
						empty.setAttribute('aria-disabled', 'true');
						empty.textContent = '일치하는 대표 지역이 없습니다.';
						stationSuggestionList.appendChild(empty);
						if (stationSearchStatus) stationSearchStatus.textContent = '“' + stationSearchInput.value.trim() + '”와 일치하는 대표 지역이 없습니다.';
					} else if (stationSearchStatus) {
						stationSearchStatus.textContent = '검색 제안 ' + filteredStations.length + '개가 있습니다.';
					}

					/** 결과가 없어도 복구 방법이 보이도록 제안 창을 유지한다. */
					openSuggestions();
					stationSuggestionList.style.maxHeight = '150px';
					stationSuggestionList.style.overflowY = filteredStations.length > 5 ? 'auto' : 'hidden';
				} else {
					closeSuggestions();
				}
			});

			stationSearchInput.addEventListener('keydown', (event) => {
				const items = regionSuggestionNodes();
				if (event.key === 'ArrowDown' && items.length) {
					event.preventDefault();
					openSuggestions();
					setActiveSuggestion(activeSuggestionIndex + 1);
				} else if (event.key === 'ArrowUp' && items.length) {
					event.preventDefault();
					openSuggestions();
					setActiveSuggestion(activeSuggestionIndex <= 0 ? items.length - 1 : activeSuggestionIndex - 1);
				} else if (event.key === 'Enter' && !event.isComposing) {
					event.preventDefault();
					if (activeSuggestionIndex >= 0) items[activeSuggestionIndex].click();
					else document.getElementById('station_search_button').click();
				} else if (event.key === 'Escape') {
					closeSuggestions();
				}
			});

			document.addEventListener('click', function (event) {
				const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
				const containsTarget = (element) => eventPath.includes(element) || element.contains(event.target);
				if (!containsTarget(coordinateSearchToggle) && !containsTarget(coordinatePanel)) {
					coordinatePanel.style.display = 'none';
					coordinateSearchToggle.setAttribute('aria-expanded', 'false');
				}
				if (!containsTarget(coordinateResultPopup)) coordinateResultPopup.style.display = 'none';
				if (!containsTarget(stationSearchInput) && !containsTarget(stationSuggestionList)) closeSuggestions();
			});

			stationSearchInput.addEventListener('click', () => {
				if (stationSearchInput.value.trim().length > 0 && regionSuggestionNodes().length) {
					openSuggestions();
				}
			});
			stationSearchInput.addEventListener('blur', function () {
				setTimeout(function () {
					if (!stationSuggestionList.contains(document.activeElement)) closeSuggestions();
				}, 0);
			});

			function setBoundaryToggle(id, active) {
				const button = document.getElementById(id);
				button.classList.toggle('clicked', active);
				button.setAttribute('aria-pressed', String(active));
			}

			function bindBoundaryOption(id, updateFlag) {
				const button = document.getElementById(id);
				button.addEventListener('click', function () {
					const active = button.classList.toggle('clicked');
					button.setAttribute('aria-pressed', String(active));
					updateFlag(active);
					applyMapThemeStyles();
				});
			}
			bindBoundaryOption('region_label_toggle', function (active) { regionLabelFlag = active; });
			bindBoundaryOption('province_boundary_toggle', function (active) { provinceBoundaryFlag = active; });
