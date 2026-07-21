/**
 * Weather Grid 3D 격자 지형 뷰 (three.js)
 *
 * 마지막 /api/weather/grid 응답(window.lastGridResult)을 3D 표면으로 렌더링한다.
 *   · 높이 = 격자 값(연속형 기상 요소), 색 = 2D 분포도와 동일한 색상 함수
 *   · 시도 경계를 같은 격자 좌표계로 투영해 표면 위에 오버레이
 *   · 표면 호버 시 해당 셀의 위경도·값 표시 — 공식 격자변환(정변환·역변환)을
 *     그대로 쓰므로 2D 지도·지점 조회와 동일한 좌표 정합을 갖는다
 *
 * weather-grid.js의 전역(windPaletteColor, findTmpColor, solarPaletteColor, findRainColor,
 * kmaLatLonToGridFrac)을 재사용한다. findRainColor가 없거나 사용할 수 없으면
 * 내장 강수 팔레트로 안전하게 대체한다.
 */
import * as THREE from './three/three.module.js';
import { OrbitControls } from './three/addons/controls/OrbitControls.js?v=20260710.2';

/* ---------- 기상청 DFS 격자 → 위경도 역변환 (서버 CoordinateConverter.gridToLatLon 이식) ---------- */
function kmaGridToLatLon(nx, ny) {
    const RE = 6371.00877, GRID = 5.0, DEGRAD = Math.PI / 180.0, RADDEG = 180.0 / Math.PI;
    const SLAT1 = 30.0 * DEGRAD, SLAT2 = 60.0 * DEGRAD;
    const OLON = 126.0 * DEGRAD, OLAT = 38.0 * DEGRAD, XO = 43, YO = 136;
    const re = RE / GRID;
    let sn = Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
    sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(sn);
    let sf = Math.pow(Math.tan(Math.PI * 0.25 + SLAT1 * 0.5), sn) * Math.cos(SLAT1) / sn;
    const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + OLAT * 0.5), sn);

    const xn = nx - XO, yn = ro - ny + YO;
    let ra = Math.sqrt(xn * xn + yn * yn);
    if (sn < 0) ra = -ra;
    let alat = Math.pow(re * sf / ra, 1.0 / sn);
    alat = 2.0 * Math.atan(alat) - Math.PI * 0.5;
    let theta;
    if (Math.abs(xn) <= 0.0) theta = 0.0;
    else if (Math.abs(yn) <= 0.0) { theta = Math.PI * 0.5; if (xn < 0) theta = -theta; }
    else theta = Math.atan2(xn, yn);
    const alon = theta / sn + OLON;
    return [alat * RADDEG, alon * RADDEG];
}

/* ---------- 모듈 상태 ---------- */
const el = () => document.getElementById('view3d');
const geodata = (key) => window.WeatherGridGeodata ? window.WeatherGridGeodata.peek(key) : null;
let renderer = null, scene = null, camera = null, controls = null, rafId = null, frameTimerId = null;
let group = null, surfaceMesh = null;
let cur = null;    // { nx, ny, nxMin, nyMin, step, data, element, unit }
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-2, -2);    // 화면 밖 초기값 — 마우스 이동 전 툴팁 방지
let pointerClient = { x: 0, y: 0 };
let rendererViewport = { left: 0, top: 0, width: 1, height: 1 };
let rendererResizeTimerId = null;
let rendererResizeObserver = null;
let tapGesture = null;
let hoverDirty = true, renderDirty = true;
let lastFrameAt = 0, lastHoverAt = 0, windFrameMs = 0;
let viewOpen = false;
let lastBuildDiagnostics = {
    mode: null,
    buildMs: 0,
    patchTextureSize: null,
    patchTextureSamples: 0,
    patchTextureVisibleSamples: 0,
    patchTextureMaxAlpha: 0,
    patchTextureBuildMs: 0,
    terrainMissingVertices: 0,
    terrainTriangleCount: 0
};
const H_MAX = 34;    // 표면 최대 높이 (월드 단위)
const RAIN_SCALE_FLOOR = 50;    // 약한 강수에서도 시각 스케일을 0~50 mm로 유지
// 일반 모니터는 DPR을 유지하고, QHD·레티나에서도 4K drawing buffer까지 허용한다.
// 4K를 넘는 화면만 해상도를 줄여 GPU 메모리와 30fps 바람 렌더 비용을 제한한다.
const MAX_RENDER_PIXELS = 8_294_400;

/* ---------- 지구본 모드 상태 ---------- */
let mode = 'terrain';                 // 'terrain' | 'globe'
let openArgs = null;                  // 마지막 open() 인자 — 모드 전환 시 재빌드용
let globePatch = null;                // 히트맵 패치 메시 (호버 대상)
let windSim = null;                   // 바람 입자 시뮬레이션 {step()}
let patchIndexLutKey = '';
let patchIndexLut = null;
const GLOBE_R = 100;
const REG = { lonMin: 114, lonMax: 142, latMin: 24, latMax: 47 };    // 경계 감쇠를 위한 동아시아 여백 포함
const GLOBE_TOUCH_ROTATE_FACTOR = 0.56;
const GLOBE_TOUCH_DAMPING = 0.34;
const GLOBE_TOUCH_SETTLE_MS = 180;
const TAP_MAX_MOVE_PX = 10;
const TAP_MAX_DURATION_MS = 450;
const activeTouchPointers = new Set();
let globeTouchSettleUntil = 0;

const D2R = Math.PI / 180;
function latLonToVec3(lat, lon, r) {
    const cl = Math.cos(lat * D2R);
    return new THREE.Vector3(
        r * cl * Math.cos(lon * D2R),
        r * Math.sin(lat * D2R),
        -r * cl * Math.sin(lon * D2R)
    );
}

/** 위경도 사각 영역을 구면으로 올린 메시 (UV: u=경도, v=위도 선형) */
function sphericalPatch(radius, lonMin, lonMax, latMin, latMax, segX, segY, material) {
    const geo = new THREE.PlaneGeometry(1, 1, segX, segY);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const lon = lonMin + (pos.getX(i) + 0.5) * (lonMax - lonMin);
        const lat = latMin + (pos.getY(i) + 0.5) * (latMax - latMin);
        const p = latLonToVec3(lat, lon, radius);
        pos.setXYZ(i, p.x, p.y, p.z);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
}

/** GeoJSON 경계를 구면 벡터 라인으로 올려 텍스처 확대 시에도 해안선을 또렷하게 유지한다. */
function sphericalBoundaryLines(featureCollection, radius, sampleStep, color, opacity) {
    if (!featureCollection || !featureCollection.features) return null;
    const positions = [];
    for (const feature of featureCollection.features) {
        const geometry = feature.geometry;
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.coordinates || []);
        for (const polygon of polygons) {
            for (const ring of polygon) {
                for (let i = sampleStep; i < ring.length; i += sampleStep) {
                    const a = ring[i - sampleStep], b = ring[i];
                    if (!a || !b || !Number.isFinite(a[0]) || !Number.isFinite(a[1])
                        || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
                    // 데이터 오류나 경도 래핑으로 지구를 가로지르는 긴 선분은 그리지 않는다.
                    if (Math.abs(a[0] - b[0]) > 8 || Math.abs(a[1] - b[1]) > 8) continue;
                    const p0 = latLonToVec3(a[1], a[0], radius);
                    const p1 = latLonToVec3(b[1], b[0], radius);
                    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
                }
            }
        }
    }
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    return new THREE.LineSegments(geometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

function rgbaToColor(str) {
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    const c = new THREE.Color();
    c.setRGB((+m[1]) / 255, (+m[2]) / 255, (+m[3]) / 255, THREE.SRGBColorSpace);
    return c;
}

/** 2D 강수 색상 함수가 로드되지 않은 경우에도 값의 크기를 구분할 수 있게 한다. */
function fallbackRainColor(value) {
    const rain = Math.max(0, Number(value) || 0);
    if (rain <= 0) return 'rgba(148,163,184,0)';
    if (rain < 1) return 'rgba(186,230,253,0.78)';
    if (rain < 3) return 'rgba(56,189,248,0.86)';
    if (rain < 15) return 'rgba(37,99,235,0.90)';
    if (rain < 30) return 'rgba(16,185,129,0.92)';
    if (rain < 50) return 'rgba(245,158,11,0.95)';
    return 'rgba(225,29,72,0.98)';
}

function rainColor(value) {
    const sharedColor = globalThis.findRainColor;
    if (typeof sharedColor === 'function') {
        try {
            const color = sharedColor(value);
            // 현재 3D 텍스처·정점 색 파서가 처리할 수 있는 형식만 사용한다.
            if (typeof color === 'string' && /^rgba?\s*\(/i.test(color.trim())) return color;
        } catch (error) { /* 공유 함수 오류 시 내장 팔레트 사용 */ }
    }
    return fallbackRainColor(value);
}

function weatherColor(element, value, selectedMonth) {
    if (typeof globalThis.WEATHER_GRID_WEATHER_COLOR === 'function') {
        const shared = globalThis.WEATHER_GRID_WEATHER_COLOR(element, value, selectedMonth);
        if (typeof shared === 'string' && /^rgba?\s*\(/i.test(shared.trim())) return shared;
    }
    if (element === 'wdws') return windPaletteColor(value);
    if (element === 'tmp') return findTmpColor(value);
    if (element === 'pcp') return rainColor(value);
    return solarPaletteColor(value, selectedMonth);
}

function weatherUnit(element) {
    const meta = globalThis.WEATHER_GRID_WEATHER_ELEMENTS && globalThis.WEATHER_GRID_WEATHER_ELEMENTS[element];
    if (meta && typeof meta.unit === 'string') return meta.unit;
    if (element === 'wdws') return 'm/s';
    if (element === 'tmp') return '℃';
    if (element === 'pcp') return 'mm';
    return 'W/㎡';
}

/** 2D 범례와 같은 색상 함수를 사용해 3D에서도 값의 의미를 잃지 않게 한다. */
function updateColorScale(result, element, selectedMonth) {
    const root = document.getElementById('view3d_scale');
    const bar = document.getElementById('view3d_scale_bar');
    const minLabel = document.getElementById('view3d_scale_min');
    const maxLabel = document.getElementById('view3d_scale_max');
    const unitLabel = document.getElementById('view3d_scale_unit');
    if (!root || !bar || !minLabel || !maxLabel || !unitLabel) return;

    let actualMin = Infinity, actualMax = -Infinity;
    for (const value of (result && result.data) || []) {
        if (!hasWeatherValue(value, element)) continue;
        if (value < actualMin) actualMin = value;
        if (value > actualMax) actualMax = value;
    }
    const unit = weatherUnit(element);
    if (!Number.isFinite(actualMin) || !Number.isFinite(actualMax)) {
        minLabel.textContent = '—';
        maxLabel.textContent = '—';
        unitLabel.textContent = '자료 없음';
        bar.style.background = 'var(--stroke-strong)';
        root.setAttribute('aria-label', '3D 데이터 색상 범례, 자료 없음');
        return;
    }

    let scaleMin = 0, scaleMax;
    if (element === 'wdws') {
        scaleMax = Math.max(12, Math.ceil(actualMax));
    } else if (element === 'tmp') {
        scaleMin = Math.min(-15, Math.floor(actualMin / 5) * 5);
        scaleMax = Math.max(35, Math.ceil(actualMax / 5) * 5);
    } else if (element === 'pcp') {
        scaleMax = Math.max(RAIN_SCALE_FLOOR, Math.ceil(actualMax));
    } else if (element === 'sno') {
        scaleMax = Math.max(20, Math.ceil(actualMax));
    } else if (element === 'reh') {
        scaleMax = 100;
    } else if (element === 'wav') {
        scaleMax = Math.max(4, Math.ceil(actualMax));
    } else {
        const ranges = typeof monthlySolarThresholds !== 'undefined' && monthlySolarThresholds[selectedMonth];
        scaleMax = ranges && ranges.length ? ranges[ranges.length - 1] : Math.max(1, Math.ceil(actualMax));
    }
    const colorAt = (value) => weatherColor(element, value, selectedMonth);
    const stops = [];
    for (let index = 0; index <= 10; index++) {
        const ratio = index / 10;
        stops.push(colorAt(scaleMin + (scaleMax - scaleMin) * ratio) + ' ' + (ratio * 100) + '%');
    }
    bar.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
    minLabel.textContent = String(scaleMin);
    maxLabel.textContent = String(scaleMax) + (actualMax > scaleMax ? '+' : '');
    unitLabel.textContent = unit;
    root.setAttribute('aria-label', '3D 색상 범례, ' + scaleMin + '에서 ' + scaleMax + ' ' + unit);
}

/** CSS 화면 크기와 실제 DPR을 함께 고려해 drawing buffer가 MAX_RENDER_PIXELS를 넘지 않게 한다. */
function cappedPixelRatio(width, height) {
    const cssPixels = Math.max(1, width * height);
    const pixelBudgetRatio = Math.sqrt(MAX_RENDER_PIXELS / cssPixels);
    return Math.max(0.1, Math.min(window.devicePixelRatio || 1, pixelBudgetRatio));
}

function hasWeatherValue(value, requestedElement) {
    const element = requestedElement || (cur && cur.element) || (openArgs && openArgs.element);
    return typeof globalThis.WEATHER_GRID_WEATHER_VALUE_VALID === 'function'
        ? globalThis.WEATHER_GRID_WEATHER_VALUE_VALID(element, value)
        : Number.isFinite(value) && value > -900 && value < 9000;
}

function weatherTitle(element) {
    return ({
        wdws: '풍속·바람 흐름', tmp: '기온', pcp: '1시간 예상 강수량',
        sno: '1시간 예상 신적설', reh: '상대습도', wav: '파고', swdn: '하향단파복사'
    })[element] || '기상 격자';
}

/** 정적 장면은 이벤트가 있을 때만 RAF를 만들고, 바람 장면도 30fps 이상 깨우지 않는다. */
function requestRender(delayMs = 0) {
    if (!viewOpen || !renderer || !scene) return;
    if (delayMs <= 0) {
        if (frameTimerId) {
            clearTimeout(frameTimerId);
            frameTimerId = null;
        }
        if (!rafId) rafId = requestAnimationFrame(loop);
        return;
    }
    if (rafId || frameTimerId) return;
    frameTimerId = window.setTimeout(() => {
        frameTimerId = null;
        requestRender();
    }, delayMs);
}

function cancelScheduledRender() {
    if (rafId) cancelAnimationFrame(rafId);
    if (frameTimerId) clearTimeout(frameTimerId);
    rafId = null;
    frameTimerId = null;
}

function updatePointerFromClient(clientX, clientY) {
    if (!renderer) return false;
    const rect = rendererViewport;
    if (rect.width <= 0 || rect.height <= 0) return false;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    pointerClient = { x: clientX, y: clientY };
    return true;
}

function resizeRendererToViewport() {
    if (!renderer || !camera) return;
    const rect = el().getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    rendererViewport = { left: rect.left || 0, top: rect.top || 0, width, height };
    renderer.setPixelRatio(cappedPixelRatio(width, height));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (viewOpen && mode === 'terrain' && group) fitTerrainCamera(group, true);
    hoverDirty = true;
    renderDirty = true;
    requestRender();
}

function scheduleRendererResize() {
    if (!viewOpen) return;
    if (rendererResizeTimerId) clearTimeout(rendererResizeTimerId);
    rendererResizeTimerId = window.setTimeout(() => {
        rendererResizeTimerId = null;
        if (viewOpen) resizeRendererToViewport();
    }, 80);
}

/** 터치 회전 중에는 이동량과 관성을 줄이고, 마우스 조작감은 기존 값으로 유지한다. */
function applyGlobeControlFeel(now = performance.now()) {
    if (!controls || mode !== 'globe') return;
    const distance = camera.position.length();
    const baseRotateSpeed = Math.min(0.24, Math.max(0.055,
        (distance - GLOBE_R) / GLOBE_R * 0.24));
    const isTouching = activeTouchPointers.size > 0 || now < globeTouchSettleUntil;
    controls.rotateSpeed = baseRotateSpeed * (isTouching ? GLOBE_TOUCH_ROTATE_FACTOR : 1);
    controls.dampingFactor = isTouching ? GLOBE_TOUCH_DAMPING : 0.20;
    controls.panSpeed = isTouching ? 0.24 : 1;
}

function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label',
        '3D 기상 지도. 드래그로 회전하고 휠 또는 두 손가락으로 확대하며, 방향키로 이동할 수 있습니다.');
    el().insertBefore(renderer.domElement, el().firstChild);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 3000);
    camera.position.set(0, 170, 185);
    resizeRendererToViewport();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.18;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 40;
    controls.maxDistance = 700;
    controls.listenToKeyEvents(renderer.domElement);

    const beginPointerControl = (event) => {
        if (event.pointerType === 'touch') {
            activeTouchPointers.add(event.pointerId);
            globeTouchSettleUntil = 0;
            applyGlobeControlFeel();
        }
        if (!event.isPrimary || activeTouchPointers.size > 1) {
            tapGesture = null;
            return;
        }
        tapGesture = {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            x: event.clientX,
            y: event.clientY,
            startedAt: performance.now(),
            moved: false
        };
        renderer.domElement.focus({ preventScroll: true });
    };

    const movePointerControl = (event) => {
        if (tapGesture && tapGesture.pointerId === event.pointerId) {
            const dx = event.clientX - tapGesture.x;
            const dy = event.clientY - tapGesture.y;
            if (Math.hypot(dx, dy) > TAP_MAX_MOVE_PX) tapGesture.moved = true;
        }
        // 터치는 회전 중 툴팁을 쫓아다니지 않고, 짧은 탭이 끝났을 때만 조회한다.
        if (event.pointerType === 'touch' || !updatePointerFromClient(event.clientX, event.clientY)) return;
        hoverDirty = true;
        requestRender();
    };

    const endPointerControl = (event, cancelled = false) => {
        const wasOnlyTouch = event.pointerType !== 'touch' || activeTouchPointers.size === 1;
        if (event.pointerType === 'touch') {
            activeTouchPointers.delete(event.pointerId);
            if (activeTouchPointers.size === 0) {
                globeTouchSettleUntil = performance.now() + GLOBE_TOUCH_SETTLE_MS;
            }
            applyGlobeControlFeel();
        }
        const isTap = !cancelled && wasOnlyTouch && tapGesture
            && tapGesture.pointerId === event.pointerId
            && !tapGesture.moved
            && performance.now() - tapGesture.startedAt <= TAP_MAX_DURATION_MS;
        if (isTap && updatePointerFromClient(event.clientX, event.clientY)) {
            hoverDirty = true;
            requestRender();
        }
        if (tapGesture && tapGesture.pointerId === event.pointerId) tapGesture = null;
    };
    // OrbitControls보다 먼저 감도를 바꿔 첫 touchmove부터 동일한 조작감을 보장한다.
    renderer.domElement.addEventListener('pointerdown', beginPointerControl, true);
    renderer.domElement.addEventListener('pointermove', movePointerControl, true);
    renderer.domElement.addEventListener('pointerup', (event) => endPointerControl(event), true);
    renderer.domElement.addEventListener('pointercancel', (event) => endPointerControl(event, true), true);

    // resize 연속 이벤트마다 drawing buffer와 지형 카메라를 다시 만들지 않고 마지막 크기만 반영한다.
    window.addEventListener('resize', scheduleRendererResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleRendererResize);
    if (typeof ResizeObserver !== 'undefined') {
        rendererResizeObserver = new ResizeObserver(scheduleRendererResize);
        rendererResizeObserver.observe(el());
    }

    renderer.domElement.addEventListener('pointerleave', () => {
        pointer.set(-2, -2);
        hoverDirty = true;
        requestRender();
    });
    controls.addEventListener('change', () => {
        hoverDirty = true;
        renderDirty = true;
        requestRender();
    });

    // 모드 토글 (지형 | 지구본)
    const modes = document.createElement('div');
    modes.className = 'view3d_modes';
    modes.innerHTML = '<button type="button" data-mode="terrain" class="on">지형</button>'
        + '<button type="button" data-mode="globe">지구본</button>';
    modes.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-mode]');
        if (!btn || btn.dataset.mode === mode) return;
        mode = btn.dataset.mode;
        modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        buildCurrent();
    });
    el().appendChild(modes);
}

/** 장면 리소스 정리 (지오메트리·재질·텍스처) */
function disposeScene() {
    if (scene) {
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();

        if (scene.background && scene.background.isTexture) textures.add(scene.background);
        if (scene.environment && scene.environment.isTexture) textures.add(scene.environment);

        scene.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            const objectMaterials = object.material
                ? (Array.isArray(object.material) ? object.material : [object.material])
                : [];
            objectMaterials.forEach((material) => {
                if (!material) return;
                materials.add(material);
                Object.values(material).forEach((value) => {
                    if (value && value.isTexture) textures.add(value);
                });
            });
        });

        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        textures.forEach((texture) => {
            const image = texture.image;
            texture.dispose();
            // CanvasTexture.dispose()는 GPU만 해제한다. backing bitmap도 축소해 CPU 메모리를 즉시 반환한다.
            if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
                image.width = 1;
                image.height = 1;
            }
            texture.image = null;
        });
        scene.clear();
    }
    if (renderer) renderer.renderLists.dispose();
    scene = null;
    group = null;
    surfaceMesh = null;
    cur = null;
    globePatch = null;
    windSim = null;
}

/** OrbitControls의 내부 회전·팬 델타를 한 번 소비해 모드 전환/재오픈 때 이전 관성이 재생되지 않게 한다. */
function clearControlMomentum() {
    if (!controls) return;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
}

function updateCanvasAccessibility() {
    if (!renderer) return;
    const modeName = mode === 'globe' ? '지구본' : '격자 지형';
    renderer.domElement.setAttribute('aria-label',
        `3D ${modeName}. 드래그로 회전하고 휠 또는 두 손가락으로 확대합니다. `
        + '방향키로 이동하고 Shift와 방향키로 회전하며, 표면을 짧게 탭하면 좌표와 값을 확인할 수 있습니다.');
}

function buildCurrent() {
    if (!openArgs) return;
    const startedAt = performance.now();
    lastBuildDiagnostics = {
        mode,
        buildMs: 0,
        patchTextureSize: null,
        patchTextureSamples: 0,
        patchTextureVisibleSamples: 0,
        patchTextureMaxAlpha: 0,
        patchTextureBuildMs: 0,
        terrainMissingVertices: 0,
        terrainTriangleCount: 0
    };
    clearControlMomentum();
    disposeScene();
    updateColorScale(openArgs.result, openArgs.element, openArgs.month);
    if (mode === 'globe') buildGlobe(openArgs.result, openArgs.element, openArgs.month);
    else buildScene(openArgs.result, openArgs.element, openArgs.month);
    lastBuildDiagnostics.buildMs = performance.now() - startedAt;
    updateCanvasAccessibility();
    hoverDirty = true;
    renderDirty = true;
    windFrameMs = 0;
    requestRender();
}

/* ==================== 지구본 뷰 ==================== */

/** 전 구 베이스 텍스처 — 어두운 바다와 위경도선. 육지는 별도 3D 경계선으로 그린다. */
function makeBaseTexture() {
    // 전구는 2048로 제한하고, 한반도 클로즈업 선명도는 별도의 고밀도 지역 패치가 담당한다.
    const W = 2048, H = 1024;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X = (lon) => (lon + 180) / 360 * W;
    const Y = (lat) => (90 - lat) / 180 * H;

    g.fillStyle = '#0a1526';
    g.fillRect(0, 0, W, H);

    // 위경도선 (10°)
    g.strokeStyle = 'rgba(148,163,184,0.12)';
    g.lineWidth = 1.6;
    for (let lon = -180; lon <= 180; lon += 10) {
        g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), H); g.stroke();
    }
    for (let lat = -80; lat <= 80; lat += 10) {
        g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(W, Y(lat)); g.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();    // 비스듬한 각도에서 선명도 유지
    return tex;
}

/** 유효 픽셀에서 결측/캔버스 경계까지의 거리를 계산해 패치 알파를 안쪽으로 페더한다. */
function featherPatchAlpha(pixels, validMask, width, height, featherPixels) {
    const distance = new Float32Array(width * height);
    const diagonal = Math.SQRT2;
    const cappedDistance = featherPixels + 1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            distance[i] = validMask[i]
                ? Math.min(cappedDistance, x + 1, y + 1, width - x, height - y)
                : 0;
        }
    }

    // 8방향 chamfer distance transform. 데이터 실제 경계와 내부 결측 모두 같은 방식으로 부드럽게 처리한다.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (!validMask[i]) continue;
            let d = distance[i];
            if (x > 0) d = Math.min(d, distance[i - 1] + 1);
            if (y > 0) d = Math.min(d, distance[i - width] + 1);
            if (x > 0 && y > 0) d = Math.min(d, distance[i - width - 1] + diagonal);
            if (x + 1 < width && y > 0) d = Math.min(d, distance[i - width + 1] + diagonal);
            distance[i] = d;
        }
    }
    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const i = y * width + x;
            if (!validMask[i]) continue;
            let d = distance[i];
            if (x + 1 < width) d = Math.min(d, distance[i + 1] + 1);
            if (y + 1 < height) d = Math.min(d, distance[i + width] + 1);
            if (x + 1 < width && y + 1 < height) d = Math.min(d, distance[i + width + 1] + diagonal);
            if (x > 0 && y + 1 < height) d = Math.min(d, distance[i + width - 1] + diagonal);
            distance[i] = d;
        }
    }

    for (let i = 0; i < validMask.length; i++) {
        if (!validMask[i]) continue;
        const t = Math.max(0, Math.min(1, (distance[i] - 0.5) / featherPixels));
        const edgeAlpha = t * t * (3 - 2 * t);
        // RGBA 자체를 넓게 감쇠해 구면 위에서 직사각형 텍스처의 네 변이 드러나지 않게 한다.
        const x = i % width;
        const y = Math.floor(i / width);
        const nx = ((x + 0.5) / width - 0.5) / 0.5;
        const ny = ((y + 0.5) / height - 0.5) / 0.5;
        const radius = Math.sqrt(nx * nx + ny * ny);
        const radialT = Math.max(0, Math.min(1, (1 - radius) / 0.78));
        const radialAlpha = radialT * radialT * (3 - 2 * radialT);
        const alpha = edgeAlpha * radialAlpha;
        pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * alpha);
    }
}

/** 한반도 패치 히트맵 텍스처 — 2D 분포도와 동일한 픽셀→격자 샘플링 */
function makePatchTexture(result, element, month) {
    const startedAt = performance.now();
    // 원본 5km 격자보다 충분히 조밀한 512×448이면 화면상 정보량은 유지하면서
    // 좌표 변환 횟수와 ImageData 메모리를 기존 1024×896의 1/4로 줄일 수 있다.
    const W = 512, H = 448;
    // 일반 격자는 넓게 감쇠하되 강수는 유효 영역 폭이 좁아 같은 값을 쓰면
    // 강수대 전체가 흐려진다. 강수만 약 0.5° 경계 블렌딩으로 정보량을 보존한다.
    const FEATHER_PIXELS = ['pcp', 'sno', 'wav'].includes(element) ? 8 : 72;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const px = img.data;
    const validMask = new Uint8Array(W * H);
    const colorCache = {};
    const colorOf = (v) => {
        const s = weatherColor(element, v, month);
        let arr = colorCache[s];
        if (!arr) {
            const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?/);
            arr = [+m[1], +m[2], +m[3], Math.round((m[4] === undefined ? 1 : +m[4]) * 232)];
            colorCache[s] = arr;
        }
        return arr;
    };

    const { nx, ny, nxMin, nyMin, step = 1, data } = result;
    const lutKey = [W, H, nx, ny, nxMin, nyMin, step,
        REG.lonMin, REG.lonMax, REG.latMin, REG.latMax].join(':');
    if (patchIndexLutKey !== lutKey || !patchIndexLut) {
        patchIndexLut = window.WeatherGridWindGrid.createNearestIndexLut({
            width: W, height: H, nx, ny, nxMin, nyMin, step,
            lonMin: REG.lonMin, lonMax: REG.lonMax,
            latMin: REG.latMin, latMax: REG.latMax
        });
        patchIndexLutKey = lutKey;
    }
    for (let i = 0; i < patchIndexLut.length; i++) {
        const gridCellIndex = patchIndexLut[i];
        if (gridCellIndex < 0) continue;
        const v = data[gridCellIndex];
        if (!hasWeatherValue(v, element)) continue;    // 모든 요소의 결측은 투명
        // 강수 없음(0 mm)은 색을 쓰지 않되 유효 영역 마스크에는 남긴다.
        // 그래야 얇은 강수대가 자체 경계로 오인돼 72px 페더링에 지워지지 않는다.
        if (element === 'pcp' && Number(v) <= 0) {
            validMask[i] = 1;
            continue;
        }
        const cc = colorOf(v);
        const o = i * 4;
        px[o] = cc[0]; px[o + 1] = cc[1]; px[o + 2] = cc[2];
        px[o + 3] = cc[3];
        validMask[i] = 1;
    }
    featherPatchAlpha(px, validMask, W, H, FEATHER_PIXELS);
    let visibleSamples = 0;
    let maxAlpha = 0;
    for (let i = 3; i < px.length; i += 4) {
        if (px[i] > 0) visibleSamples++;
        if (px[i] > maxAlpha) maxAlpha = px[i];
    }
    g.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // 가까운 한반도 패치는 원본 해상도로 읽히므로 mipmap을 만들지 않아도 충분히 선명하다.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    lastBuildDiagnostics.patchTextureSize = [W, H];
    lastBuildDiagnostics.patchTextureSamples = W * H;
    lastBuildDiagnostics.patchTextureVisibleSamples = visibleSamples;
    lastBuildDiagnostics.patchTextureMaxAlpha = maxAlpha;
    lastBuildDiagnostics.patchTextureBuildMs = performance.now() - startedAt;
    return tex;
}

/** 데이터 패치를 타원형 지리 초점으로 페더해 구면에 사각 텍스처처럼 보이지 않게 한다. */
function makePatchFeatherTexture() {
    const W = 256, H = 224, F = 56;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const rectangleEdge = Math.max(0, Math.min(1,
                Math.min(x, W - 1 - x) / F,
                Math.min(y, H - 1 - y) / F));
            const nx = (x / (W - 1) - 0.5) / 0.5;
            const ny = (y / (H - 1) - 0.5) / 0.5;
            const radius = Math.sqrt(nx * nx + ny * ny);
            const radialRaw = Math.max(0, Math.min(1, (1 - radius) / 0.38));
            const radial = radialRaw * radialRaw * (3 - 2 * radialRaw);
            const edge = rectangleEdge * rectangleEdge * (3 - 2 * rectangleEdge);
            const value = Math.round(255 * edge * radial);
            const o = (y * W + x) * 4;
            img.data[o] = value; img.data[o + 1] = value; img.data[o + 2] = value; img.data[o + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(c);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

/** 바람 입자 시뮬레이션 — 2D와 같은 m/s 벡터장을 패치 캔버스 위에 애니메이션 */
function makeWindSim() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    if (!window.lastWindField || !window.WeatherGridWindGrid) return null;
    let windField;
    try {
        windField = window.WeatherGridWindGrid.create(window.lastWindField);
    } catch (error) {
        console.warn('3D 바람 벡터장을 초기화하지 못했습니다.', error);
        return null;
    }

    // 트레일 캔버스는 매 프레임 GPU로 재업로드된다(needsUpdate) — 1024×896일 때
    // 프레임당 ~3.7MB 업로드로 지구본이 14fps까지 떨어져 절반 해상도를 쓴다.
    // 트레일은 잔상 그래픽이라 표시 품질 차이는 사실상 없다.
    const W = 512, H = 448;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // 매 프레임 needsUpdate 되는 트레일은 mipmap을 다시 만들지 않고 선형 필터로 갱신한다.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const sample = (lat, lon) => windField.sample(lon, lat);
    const spawn = () => ({
        lon: 124 + Math.random() * 8.3,
        lat: 31.8 + Math.random() * 7.2,
        ageMs: Math.random() * 2400
    });
    const parts = Array.from({ length: 650 }, spawn);
    // 실제 U/V(m/s)를 유지한 채 애니메이션 시계만 압축한다. 예보 모델에 이미
    // 코리올리 효과가 반영돼 있으므로 화면에서 별도 곡률을 추가하지 않는다.
    const EARTH_RADIUS_METERS = 6371008.8;
    const SIM_SECONDS_PER_REAL_SECOND = 1500;
    const MAX_AGE_MS = 3000;

    /** 구면 위 RK2 이동. 중간점에서 U/V를 다시 샘플링해 격자 경계의 궤적 꺾임을 줄인다. */
    const advect = (lat, lon, realSeconds) => {
        const first = sample(lat, lon);
        if (!first) return null;
        const simulationSeconds = realSeconds * SIM_SECONDS_PER_REAL_SECOND;
        const halfSeconds = simulationSeconds * 0.5;
        const cosLat = Math.max(0.08, Math.abs(Math.cos(lat * D2R)));
        const midLat = lat + first[1] * halfSeconds / EARTH_RADIUS_METERS / D2R;
        const midLon = lon + first[0] * halfSeconds / (EARTH_RADIUS_METERS * cosLat) / D2R;
        const middle = sample(midLat, midLon);
        if (!middle) return null;
        const midCosLat = Math.max(0.08, Math.abs(Math.cos(midLat * D2R)));
        return {
            lat: lat + middle[1] * simulationSeconds / EARTH_RADIUS_METERS / D2R,
            lon: lon + middle[0] * simulationSeconds / (EARTH_RADIUS_METERS * midCosLat) / D2R
        };
    };

    // 히트맵과 같은 페더 비율 — 트레일이 색칠 영역 밖으로 삐져나오지 않게
    const F = Math.round(224 / 1024 * W);
    const FLON = F / W * (REG.lonMax - REG.lonMin);    // 페더 폭의 경도 환산
    const FLAT = F / H * (REG.latMax - REG.latMin);
    // 그라디언트는 매 프레임 재사용 (생성 비용 절감)
    const grads = (() => {
        const mk = (x0, y0, x1, y1) => {
            const m = g.createLinearGradient(x0, y0, x1, y1);
            m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
            return m;
        };
        return [
            [mk(0, 0, F, 0), 0, 0, F, H],
            [mk(W, 0, W - F, 0), W - F, 0, F, H],
            [mk(0, 0, 0, F), 0, 0, W, F],
            [mk(0, H, 0, H - F), 0, H - F, W, F]
        ];
    })();
    const edgeMask = () => {
        g.globalCompositeOperation = 'destination-out';
        for (const [m, x, y, w, h] of grads) { g.fillStyle = m; g.fillRect(x, y, w, h); }
        g.globalCompositeOperation = 'source-over';
    };

    return {
        texture: tex,
        step(deltaMs) {
            const dt = Math.min(50, Math.max(1, deltaMs)) / 1000;
            // 잔상 페이드
            g.globalCompositeOperation = 'destination-in';
            g.fillStyle = `rgba(0,0,0,${Math.pow(0.93, dt * 60).toFixed(4)})`;
            g.fillRect(0, 0, W, H);
            g.globalCompositeOperation = 'source-over';
            g.strokeStyle = 'rgba(255,255,255,0.9)';
            g.lineWidth = 1.25;
            g.beginPath();
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                // 페더 구간에 진입하면 리스폰 — 경계에 트레일이 쌓이지 않게
                const nearEdge = p.lon < REG.lonMin + FLON || p.lon > REG.lonMax - FLON
                    || p.lat < REG.latMin + FLAT || p.lat > REG.latMax - FLAT;
                p.ageMs += dt * 1000;
                if (nearEdge || p.ageMs > MAX_AGE_MS) { parts[i] = spawn(); continue; }
                const next = advect(p.lat, p.lon, dt);
                if (!next) { parts[i] = spawn(); continue; }
                const nlon = next.lon;
                const nlat = next.lat;
                const x0 = (p.lon - REG.lonMin) / (REG.lonMax - REG.lonMin) * W;
                const y0 = (REG.latMax - p.lat) / (REG.latMax - REG.latMin) * H;
                const x1 = (nlon - REG.lonMin) / (REG.lonMax - REG.lonMin) * W;
                const y1 = (REG.latMax - nlat) / (REG.latMax - REG.latMin) * H;
                g.moveTo(x0, y0); g.lineTo(x1, y1);
                p.lon = nlon; p.lat = nlat;
            }
            g.stroke();
            edgeMask();    // 잔여 트레일도 히트맵과 같은 페더로 감쇠
            tex.needsUpdate = true;
        }
    };
}

function buildGlobe(result, element, month) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#05080f');

    // 별 배경 (은은하게)
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(450 * 3);
    for (let i = 0; i < 450; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(1400 + Math.random() * 400);
        starPos[i * 3] = v.x; starPos[i * 3 + 1] = v.y; starPos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo,
        new THREE.PointsMaterial({ color: 0x93a6c4, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x0a0f1a, 1.05));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.copy(latLonToVec3(30, 115, 500));
    scene.add(dir);

    // 지구 본체
    const base = sphericalPatch(GLOBE_R, -180, 180, -90, 90, 128, 64,
        new THREE.MeshStandardMaterial({ map: makeBaseTexture(), roughness: 0.95, metalness: 0 }));
    scene.add(base);

    const coastLines = sphericalBoundaryLines(
        geodata('eastAsiaLand'),
        GLOBE_R * 1.003, 1, 0x7dd3fc, 0.50);
    if (coastLines) scene.add(coastLines);
    const provinceLines = sphericalBoundaryLines(
        geodata('koreaAdmin1'),
        GLOBE_R * 1.0035, 1, 0xa78bfa, 0.34);
    if (provinceLines) scene.add(provinceLines);

    // 대기 글로우 (뒤집힌 반투명 셸)
    const glow = new THREE.Mesh(
        new THREE.SphereGeometry(GLOBE_R * 1.035, 48, 32),
        new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.07, side: THREE.BackSide }));
    scene.add(glow);

    // 한반도 데이터 패치 (호버 대상)
    globePatch = sphericalPatch(GLOBE_R * 1.004, REG.lonMin, REG.lonMax, REG.latMin, REG.latMax, 96, 96,
        new THREE.MeshBasicMaterial({
            map: makePatchTexture(result, element, month),
            transparent: true,
            alphaTest: 0.015,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        }));
    scene.add(globePatch);

    // 바람 입자 (바람 요소일 때만)
    windSim = (element === 'wdws') ? makeWindSim() : null;
    if (windSim) {
        scene.add(sphericalPatch(GLOBE_R * 1.008, REG.lonMin, REG.lonMax, REG.latMin, REG.latMax, 48, 48,
            new THREE.MeshBasicMaterial({ map: windSim.texture, alphaMap: makePatchFeatherTexture(), transparent: true, depthWrite: false })));
    }

    cur = {
        nx: result.nx, ny: result.ny, data: result.data,
        nxMin: result.nxMin, nyMin: result.nyMin, step: result.step || 1,
        element, unit: weatherUnit(element)
    };
    surfaceMesh = null;    // 지형 호버 비활성

    camera.position.copy(latLonToVec3(35.5, 127.8, GLOBE_R * 1.90));    // 동아시아 맥락과 한반도 자료를 함께 읽기 좋은 기본 시점
    controls.target.set(0, 0, 0);
    controls.minDistance = GLOBE_R * 1.08;
    controls.maxDistance = GLOBE_R * 6;
    controls.maxPolarAngle = Math.PI;    // 지구본은 자유 회전
    controls.zoomSpeed = 0.38;    // 표면이 가까운 기본 시점에서 휠 입력이 튀지 않게 제한
    applyGlobeControlFeel();

    document.getElementById('view3d_title').textContent =
        '지구본 — ' + weatherTitle(element);
}

/** 세로 화면에서는 수평 FOV가 좁아지므로 더 좁은 축을 기준으로 지형 전체를 맞춘다. */
function fitTerrainCamera(object, onlyIfTooClose = false) {
    if (!object || !camera || !controls) return;
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(1, sphere.radius);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.1, camera.aspect));
    const limitingFov = Math.max(THREE.MathUtils.degToRad(8), Math.min(verticalFov, horizontalFov));
    const padding = camera.aspect < 0.6 ? 1.16 : (camera.aspect < 0.9 ? 1.10 : 1.04);
    const requiredDistance = radius / Math.sin(limitingFov / 2) * padding;
    const currentDistance = camera.position.distanceTo(controls.target);
    if (onlyIfTooClose && currentDistance >= requiredDistance * 0.99) return;

    let direction = onlyIfTooClose
        ? camera.position.clone().sub(controls.target).normalize()
        : new THREE.Vector3(0, 170, 185).normalize();
    if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.5) {
        direction = new THREE.Vector3(0, 170, 185).normalize();
    }
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, requiredDistance);
    controls.maxDistance = Math.max(700, requiredDistance * 1.35);
    controls.update();
    hoverDirty = true;
    renderDirty = true;
}

function buildScene(result, element, month) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#05080f');
    scene.fog = new THREE.Fog('#05080f', 500, 1600);

    scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x0a0f1a, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.25);
    dir.position.set(120, 220, 90);
    scene.add(dir);

    const nx = result.nx, ny = result.ny, data = result.data;
    const W = nx - 1, H = ny - 1;

    // 값 → 높이 스케일 (최대값 기준 정규화, 기온은 -20℃ 바닥의 시프트 스케일)
    let maxVal = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (hasWeatherValue(data[i], element) && data[i] > maxVal) maxVal = data[i];
    }
    if (!Number.isFinite(maxVal)) maxVal = 0;
    let heightOf;
    if (element === 'tmp') {
        const shift = 20;    // -20℃를 바닥(0)으로
        const hs = (maxVal + shift) > 0 ? H_MAX / (maxVal + shift) : 0;
        heightOf = (v) => Math.max(0, (v + shift) * hs);
    } else {
        const scaleFloors = { pcp: RAIN_SCALE_FLOOR, sno: 20, reh: 100, wav: 4 };
        const heightScaleMax = scaleFloors[element] ? Math.max(scaleFloors[element], maxVal) : maxVal;
        const hs = heightScaleMax > 0 ? H_MAX / heightScaleMax : 0;
        heightOf = (v) => Math.max(0, v * hs);
    }

    // 표면: PlaneGeometry는 위(북) 행부터 행우선 — 데이터(북쪽 행부터)와 1:1 대응
    const geo = new THREE.PlaneGeometry(W, H, W, H);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const validVertices = new Uint8Array(pos.count);
    const missingColor = new THREE.Color('#0d1524');    // 결측(비관측영역)
    const colorOf = (v) => {
        if (!hasWeatherValue(v, element)) return missingColor;
        return rgbaToColor(weatherColor(element, v, month));
    };
    const colorCache = {};

    for (let i = 0; i < pos.count; i++) {
        const v = data[i];
        const valid = hasWeatherValue(v, element);
        validVertices[i] = valid ? 1 : 0;
        // 결측 정점은 높이로 치환하지 않는다. 아래에서 연결 삼각형을 제거해 절벽·슬래브를 막는다.
        if (valid) pos.setZ(i, heightOf(v));
        let c = colorCache[v];
        if (!c) { c = colorOf(v); colorCache[v] = c; }
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    const sourceIndex = geo.getIndex();
    if (sourceIndex) {
        const keptTriangles = [];
        const indices = sourceIndex.array;
        for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i], b = indices[i + 1], c = indices[i + 2];
            if (validVertices[a] && validVertices[b] && validVertices[c]) {
                keptTriangles.push(a, b, c);
            }
        }
        geo.setIndex(keptTriangles);
        lastBuildDiagnostics.terrainTriangleCount = keptTriangles.length / 3;
    }
    lastBuildDiagnostics.terrainMissingVertices = validVertices.length
        - validVertices.reduce((sum, value) => sum + value, 0);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide
    });
    surfaceMesh = new THREE.Mesh(geo, mat);

    group = new THREE.Group();
    group.add(surfaceMesh);

    // 시도 경계 오버레이 — 위경도 → 공식 격자변환 → 표면과 같은 로컬 좌표
    const cx = W / 2, cy = H / 2;
    const toLocal = (lat, lon) => {
        const g = kmaLatLonToGridFrac(lat, lon);
        const col = (g[0] - result.nxMin) / (result.step || 1);
        const rowS = (g[1] - result.nyMin) / (result.step || 1);    // 남쪽 기준
        if (col < 0 || col > W || rowS < 0 || rowS > H) return null;
        return [col - cx, rowS - cy];    // plane 로컬: +y = 북
    };
    try {
        const linePts = [];
        ((geodata('koreaAdmin1') || {}).features || []).forEach((f) => {
            const geom = f.geometry;
            const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.coordinates || []);
            polys.forEach((poly) => {
                (poly || []).forEach((ring) => {
                    for (let i = 2; i < ring.length; i += 2) {
                        const a = toLocal(ring[i - 2][1], ring[i - 2][0]);
                        const b = toLocal(ring[i][1], ring[i][0]);
                        if (a && b) {
                            linePts.push(a[0], a[1], 0.4, b[0], b[1], 0.4);
                        }
                    }
                });
            });
        });
        if (linePts.length) {
            const lgeo = new THREE.BufferGeometry();
            lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePts), 3));
            const lines = new THREE.LineSegments(lgeo,
                new THREE.LineBasicMaterial({ color: 0x9fb0c3, transparent: true, opacity: 0.55 }));
            group.add(lines);
        }
    } catch (e) { /* 경계 데이터 없으면 표면만 */ }

    // 바닥 그리드
    const gh = new THREE.GridHelper(Math.max(W, H) * 1.6, 24, 0x1e293b, 0x101827);
    gh.position.y = -0.6;
    scene.add(gh);

    group.rotation.x = -Math.PI / 2;    // plane(+y=북) → 월드(-z=북), 높이는 +y
    scene.add(group);

    cur = {
        nx, ny, data,
        nxMin: result.nxMin, nyMin: result.nyMin, step: result.step || 1,
        element, unit: weatherUnit(element)
    };
    globePatch = null;    // 지구본 호버 비활성

    // 지형 모드 카메라·컨트롤
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 40;
    controls.maxDistance = 700;
    controls.rotateSpeed = 0.64;
    controls.zoomSpeed = 0.72;
    controls.dampingFactor = 0.14;
    controls.panSpeed = 1;
    fitTerrainCamera(group);

    document.getElementById('view3d_title').textContent =
        weatherTitle(element) + ' 격자 지형 (' + weatherUnit(element) + ')';
}

function showTip(text) {
    const tip = document.getElementById('view3d_tip');
    tip.textContent = text;
    tip.style.display = 'block';
    const margin = 8;
    const gap = 16;
    const placeLeft = pointerClient.x > window.innerWidth / 2;
    const placeAbove = pointerClient.y > window.innerHeight / 2;
    const left = Math.max(margin, Math.min(window.innerWidth - margin,
        pointerClient.x + (placeLeft ? -gap : gap)));
    const top = Math.max(margin, Math.min(window.innerHeight - margin,
        pointerClient.y + (placeAbove ? -gap : gap)));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.transform = `translate(${placeLeft ? '-100%' : '0'}, ${placeAbove ? '-100%' : '0'})`;
}

function hoverTip() {
    const tip = document.getElementById('view3d_tip');
    if (!cur) { tip.style.display = 'none'; return; }
    raycaster.setFromCamera(pointer, camera);

    // 지구본 모드 — 패치 UV(경도·위도 선형) → 공식 격자변환으로 셀 값
    if (mode === 'globe' && globePatch) {
        const hits = raycaster.intersectObject(globePatch);
        if (!hits.length || !hits[0].uv) { tip.style.display = 'none'; return; }
        const uv = hits[0].uv;
        const lon = REG.lonMin + uv.x * (REG.lonMax - REG.lonMin);
        const lat = REG.latMin + uv.y * (REG.latMax - REG.latMin);
        const gr = kmaLatLonToGridFrac(lat, lon);
        const col = Math.round((gr[0] - cur.nxMin) / cur.step);
        const rowS = Math.round((gr[1] - cur.nyMin) / cur.step);
        if (col < 0 || col >= cur.nx || rowS < 0 || rowS >= cur.ny) { tip.style.display = 'none'; return; }
        const v = cur.data[(cur.ny - 1 - rowS) * cur.nx + col];
        const valTxt = hasWeatherValue(v, cur.element) ? (Math.round(v * 10) / 10) + ' ' + cur.unit : '자료 없음';
        showTip(`위도 ${lat.toFixed(3)}° · 경도 ${lon.toFixed(3)}°\n${valTxt}`);
        return;
    }

    if (!surfaceMesh) { tip.style.display = 'none'; return; }
    const hits = raycaster.intersectObject(surfaceMesh);
    if (!hits.length || !hits[0].uv) { tip.style.display = 'none'; return; }

    const uv = hits[0].uv;
    const col = Math.round(uv.x * (cur.nx - 1));
    const rowN = Math.round((1 - uv.y) * (cur.ny - 1));    // 데이터는 북쪽 행부터
    const v = cur.data[rowN * cur.nx + col];

    const gx = cur.nxMin + col * cur.step;
    const gy = cur.nyMin + ((cur.ny - 1) - rowN) * cur.step;    // 남쪽 기준 격자번호
    const ll = kmaGridToLatLon(gx, gy);

    const valTxt = hasWeatherValue(v, cur.element) ? (Math.round(v * 10) / 10) + ' ' + cur.unit : '자료 없음';
    showTip(`위도 ${ll[0].toFixed(3)}° · 경도 ${ll[1].toFixed(3)}°\n격자 (${gx}, ${gy}) · ${valTxt}`);
}

function loop(frameAt) {
    rafId = null;
    if (!viewOpen || !scene || !renderer || !controls) {
        return;
    }
    const deltaMs = lastFrameAt ? Math.min(50, frameAt - lastFrameAt) : 16.67;
    lastFrameAt = frameAt;
    if (mode === 'globe') {
        // 표면에 가까울수록 회전을 느리게 — 클로즈업에서 확확 도는 느낌 방지
        applyGlobeControlFeel(frameAt);
    } else {
        controls.rotateSpeed = 0.64;
        controls.zoomSpeed = 0.72;
        controls.dampingFactor = 0.14;
    }
    const controlsChanged = controls.update();
    let windChanged = false;
    if (windSim) {
        windFrameMs += deltaMs;
        if (windFrameMs >= 33) {    // 동적 텍스처 GPU 업로드는 최대 30fps
            windSim.step(windFrameMs);
            windFrameMs = 0;
            windChanged = true;
        }
    }
    if ((hoverDirty || controlsChanged) && frameAt - lastHoverAt >= 32) {
        hoverTip();
        hoverDirty = false;
        lastHoverAt = frameAt;
    }
    // 정적인 지형 모드에서는 장면이 바뀔 때만 GPU 렌더 — 유휴 상태의 60fps 루프 제거
    if (renderDirty || controlsChanged || windChanged) {
        renderer.render(scene, camera);
        renderDirty = false;
    }
    if (controlsChanged) {
        requestRender();
    } else {
        // 32ms 호버 스로틀 안에서 포인터가 멈춰도 마지막 위치를 한 번은 처리한다.
        let nextDelay = Infinity;
        if (hoverDirty) nextDelay = Math.min(nextDelay, Math.max(8, 32 - (frameAt - lastHoverAt)));
        if (windSim) nextDelay = Math.min(nextDelay, Math.max(8, 33 - windFrameMs));
        if (Number.isFinite(nextDelay)) requestRender(nextDelay);
    }
}

/* ---------- 공개 API ---------- */
const WEATHER_GRID_3D = {
    open(result, element, month) {
        const meta = globalThis.WEATHER_GRID_WEATHER_ELEMENTS && globalThis.WEATHER_GRID_WEATHER_ELEMENTS[element];
        if (meta && meta.view3d === false) {
            throw new Error(meta.label + ' 항목은 3D 표현을 제공하지 않습니다.');
        }
        ensureRenderer();
        viewOpen = true;
        controls.enabled = true;
        el().classList.add('open');
        el().setAttribute('aria-hidden', 'false');
        resizeRendererToViewport();    // close()에서 1×1로 줄인 drawing buffer를 현재 화면 크기로 복원
        openArgs = { result, element, month };
        buildCurrent();
        lastFrameAt = 0;
        requestRender();
    },
    close() {
        viewOpen = false;
        el().classList.remove('open');
        el().setAttribute('aria-hidden', 'true');
        cancelScheduledRender();
        if (rendererResizeTimerId) {
            clearTimeout(rendererResizeTimerId);
            rendererResizeTimerId = null;
        }
        lastFrameAt = 0;
        clearControlMomentum();
        if (controls) controls.enabled = false;
        document.getElementById('view3d_tip').style.display = 'none';
        disposeScene();
        openArgs = null;
        activeTouchPointers.clear();
        globeTouchSettleUntil = 0;
        tapGesture = null;
        pointer.set(-2, -2);
        hoverDirty = true;
        renderDirty = true;
        // WebGL 컨텍스트는 빠른 재오픈을 위해 유지하되 drawing buffer는 최소화한다.
        if (renderer) {
            renderer.setPixelRatio(1);
            renderer.setSize(1, 1, false);
            rendererViewport = { left: 0, top: 0, width: 1, height: 1 };
        }
    },
    getDiagnostics() {
        return Object.assign({}, lastBuildDiagnostics, {
            drawingBufferSize: renderer ? [renderer.domElement.width, renderer.domElement.height] : [0, 0],
            cssViewportSize: [rendererViewport.width, rendererViewport.height],
            pixelRatio: renderer ? renderer.getPixelRatio() : 0,
            maxRenderPixels: MAX_RENDER_PIXELS
        });
    }
};

// 동적 import 호출자가 성공한 모듈만 전역에 채택한다. 모듈 자체가 전역을
// 덮어쓰지 않게 해, 타임아웃 뒤 늦게 끝난 요청과 재시도 요청 사이의 경쟁을 막는다.
export { WEATHER_GRID_3D };
export default WEATHER_GRID_3D;
