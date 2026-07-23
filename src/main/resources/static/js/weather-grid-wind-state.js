/**
 * 2D 풍장 Canvas 예산과 렌더 생명주기를 지도·DOM·애니메이션 구현에서 분리한다.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridWindState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MAX_CANVAS_PIXELS = 8000000;
    var MOVE_END_DELAY_MS = 80;
    var RESIZE_DELAY_MS = 140;

    function frozenEffects(effects) {
        return Object.freeze(effects.map(function (effect) { return Object.freeze(effect); }));
    }

    function snapshot(hasField, status, revision) {
        return Object.freeze({
            hasField: Boolean(hasField),
            status: status,
            revision: revision
        });
    }

    function outcome(state, effects) {
        return Object.freeze({ state: state, effects: frozenEffects(effects || []) });
    }

    function initial() {
        return snapshot(false, 'empty', 0);
    }

    function canvasPlan(size, devicePixelRatio, pixelBudget) {
        if (!Array.isArray(size) || size.length !== 2) return null;
        var width = Math.round(Number(size[0]));
        var height = Math.round(Number(size[1]));
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) return null;
        var budget = Number.isFinite(pixelBudget) && pixelBudget > 0
            ? pixelBudget : MAX_CANVAS_PIXELS;
        var desiredScale = Math.max(1, Number(devicePixelRatio) || 1);
        var budgetScale = Math.sqrt(budget / (width * height)) * 0.995;
        var scale = Math.min(desiredScale, budgetScale);
        var backingWidth = Math.max(1, Math.round(width * scale));
        var backingHeight = Math.max(1, Math.round(height * scale));
        return Object.freeze({
            cssWidth: width,
            cssHeight: height,
            backingWidth: backingWidth,
            backingHeight: backingHeight,
            scale: scale,
            pixels: backingWidth * backingHeight
        });
    }

    function renderDecision(input) {
        input = input || {};
        if (!input.fieldAvailable) return Object.freeze({ render: false, reason: 'no-field', plan: null });
        if (input.metric !== 'wdws') return Object.freeze({ render: false, reason: 'metric', plan: null });
        if (input.view3dOpen) return Object.freeze({ render: false, reason: 'view3d', plan: null });
        if (!input.streamEnabled) return Object.freeze({ render: false, reason: 'layer', plan: null });
        var plan = canvasPlan(input.size, input.devicePixelRatio, input.pixelBudget);
        if (!plan) return Object.freeze({ render: false, reason: 'size', plan: null });
        return Object.freeze({ render: true, reason: 'ready', plan: plan });
    }

    function transition(state, event) {
        state = state || initial();
        event = event || {};
        if (event.type === 'field/set') {
            return outcome(snapshot(true, 'ready', state.revision + 1), [
                { type: 'renderer/replace' },
                { type: 'render/request' }
            ]);
        }
        if (event.type === 'field/clear') {
            return outcome(snapshot(false, 'empty', state.revision + 1), [
                { type: 'renderer/destroy' },
                { type: 'canvas/clear' }
            ]);
        }
        if (event.type === 'view/start') {
            if (!state.hasField) return outcome(state, [
                { type: 'render/cancel' },
                { type: 'canvas/settle' }
            ]);
            return outcome(snapshot(true, 'moving', state.revision), [
                { type: 'render/cancel' },
                { type: 'renderer/stop' },
                { type: 'canvas/moving' }
            ]);
        }
        if (event.type === 'view/end') {
            if (!state.hasField) return outcome(state, [{ type: 'canvas/settle' }]);
            return outcome(snapshot(true, 'ready', state.revision), [
                { type: 'render/schedule', delay: MOVE_END_DELAY_MS }
            ]);
        }
        if (event.type === 'viewport/resize') {
            var resizeEffects = [{ type: 'map/resize' }];
            if (state.hasField) {
                resizeEffects.push({ type: 'renderer/stop' });
                resizeEffects.push({ type: 'canvas/moving' });
                resizeEffects.push({ type: 'render/schedule', delay: RESIZE_DELAY_MS });
                return outcome(snapshot(true, 'moving', state.revision), resizeEffects);
            }
            resizeEffects.push({ type: 'canvas/settle' });
            return outcome(state, resizeEffects);
        }
        if (event.type === 'render/suspend') {
            return outcome(snapshot(state.hasField, state.hasField ? 'suspended' : 'empty', state.revision), [
                { type: 'renderer/stop' },
                { type: 'canvas/hide' },
                { type: 'canvas/settle' }
            ]);
        }
        if (event.type === 'render/request') {
            var decision = renderDecision(Object.assign({}, event.conditions, {
                fieldAvailable: state.hasField
            }));
            if (!decision.render) {
                return outcome(snapshot(state.hasField, state.hasField ? 'suspended' : 'empty', state.revision), [
                    { type: 'renderer/stop' },
                    { type: 'canvas/hide' },
                    { type: 'canvas/settle', reason: decision.reason }
                ]);
            }
            return outcome(snapshot(true, 'running', state.revision), [
                { type: 'canvas/prepare', plan: decision.plan },
                { type: 'renderer/start' },
                { type: 'canvas/settle' }
            ]);
        }
        if (event.type === 'page/hide') {
            return outcome(snapshot(false, 'empty', state.revision), [{ type: 'renderer/destroy' }]);
        }
        return outcome(state);
    }

    return Object.freeze({
        maxCanvasPixels: MAX_CANVAS_PIXELS,
        moveEndDelay: MOVE_END_DELAY_MS,
        resizeDelay: RESIZE_DELAY_MS,
        initial: initial,
        canvasPlan: canvasPlan,
        renderDecision: renderDecision,
        transition: transition
    });
}));
