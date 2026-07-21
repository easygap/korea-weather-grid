/*
 * Weather Grid wind particle renderer
 *
 * The input is a weather-grid.wind-field/v1 vector field. U/V stay in m/s; only the
 * animation clock is accelerated so a several-hour atmospheric flow can be
 * read on screen. The renderer converts local east/north directions through
 * the active map projection before integrating particles with a midpoint
 * (RK2) step. Forecast U/V already includes the model's atmospheric dynamics,
 * so no separate Coriolis deflection is added here.
 *
 * The particle rendering approach was originally inspired by cambecc/earth.
 * This implementation uses KMA DFS sampling and a projection-aware typed field.
 */
(function (root) {
    'use strict';

    const EARTH_RADIUS_METERS = 6371008.8;
    const DEG_PER_RADIAN = 180 / Math.PI;
    const DEFAULT_VISUAL_TIME_SCALE = 1800;
    const DEFAULT_MAX_DISPLAY_SPEED = 55;
    const DEFAULT_PARTICLE_DENSITY = 1 / 900;
    const DEFAULT_LINE_WIDTH = 1.15;
    const MAX_DESKTOP_PARTICLES = 1500;
    const MAX_MOBILE_PARTICLES = 520;
    const MIN_PARTICLES = 70;
    const TARGET_FRAME_MS = 1000 / 30;
    const MAX_FRAME_SECONDS = 0.05;
    const MAX_PARTICLE_AGE_SECONDS = 4.2;
    const FIELD_TASK_BUDGET_MS = 8;
    const FIELD_SAMPLE_LIMIT = 180000;
    const BASIS_DISTANCE_METERS = 1000;

    const now = root.performance && typeof root.performance.now === 'function'
        ? function () { return root.performance.now(); }
        : function () { return Date.now(); };
    const requestFrame = typeof root.requestAnimationFrame === 'function'
        ? root.requestAnimationFrame.bind(root)
        : function (callback) { return root.setTimeout(function () { callback(now()); }, 33); };
    const cancelFrame = typeof root.cancelAnimationFrame === 'function'
        ? root.cancelAnimationFrame.bind(root)
        : root.clearTimeout.bind(root);

    function finitePositive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function isMobileViewport() {
        return (root.matchMedia && root.matchMedia('(max-width: 640px), (pointer: coarse)').matches)
            || (root.navigator && root.navigator.maxTouchPoints > 0 && root.innerWidth <= 900);
    }

    function prefersReducedMotion() {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function makeProjectionTransforms(projectionCode) {
        if (!root.ol || !root.ol.proj) {
            throw new Error('Windy requires OpenLayers projection transforms.');
        }
        return {
            toView: root.ol.proj.getTransform('EPSG:4326', projectionCode),
            toLonLat: root.ol.proj.getTransform(projectionCode, 'EPSG:4326')
        };
    }

    function createScreenProjection(width, height, extent, projectionCode) {
        if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite)) {
            throw new TypeError('Windy start() requires a finite viewProjectionExtent.');
        }
        const spanX = extent[2] - extent[0];
        const spanY = extent[3] - extent[1];
        if (!(spanX > 0) || !(spanY > 0)) throw new TypeError('Windy received an empty map extent.');
        const transforms = makeProjectionTransforms(projectionCode);

        function viewToScreen(viewCoordinate) {
            if (!viewCoordinate || !Number.isFinite(viewCoordinate[0]) || !Number.isFinite(viewCoordinate[1])) {
                return null;
            }
            return [
                (viewCoordinate[0] - extent[0]) / spanX * width,
                (extent[3] - viewCoordinate[1]) / spanY * height
            ];
        }

        return {
            toLonLat: function (x, y) {
                const viewCoordinate = [
                    extent[0] + x / width * spanX,
                    extent[3] - y / height * spanY
                ];
                const lonLat = transforms.toLonLat(viewCoordinate);
                return lonLat && Number.isFinite(lonLat[0]) && Number.isFinite(lonLat[1]) ? lonLat : null;
            },
            toScreen: function (longitude, latitude) {
                return viewToScreen(transforms.toView([longitude, latitude]));
            }
        };
    }

    /**
     * Converts earth-relative U/V (east/north m/s) into screen pixels per real
     * second. Central differences preserve the local basis of LCC, Mercator and
     * geographic views, including longitude convergence and cos(latitude).
     */
    function projectVelocity(screenProjection, longitude, latitude, u, v, visualTimeScale, maxSpeed) {
        const latitudeRadians = latitude / DEG_PER_RADIAN;
        const safeCosLatitude = Math.max(0.08, Math.abs(Math.cos(latitudeRadians)));
        const eastDegrees = BASIS_DISTANCE_METERS / (EARTH_RADIUS_METERS * safeCosLatitude) * DEG_PER_RADIAN;
        const northDegrees = BASIS_DISTANCE_METERS / EARTH_RADIUS_METERS * DEG_PER_RADIAN;

        const eastPlus = screenProjection.toScreen(longitude + eastDegrees, latitude);
        const eastMinus = screenProjection.toScreen(longitude - eastDegrees, latitude);
        const northPlus = screenProjection.toScreen(longitude, latitude + northDegrees);
        const northMinus = screenProjection.toScreen(longitude, latitude - northDegrees);
        if (!eastPlus || !eastMinus || !northPlus || !northMinus) return null;

        const denominator = BASIS_DISTANCE_METERS * 2;
        const eastX = (eastPlus[0] - eastMinus[0]) / denominator;
        const eastY = (eastPlus[1] - eastMinus[1]) / denominator;
        const northX = (northPlus[0] - northMinus[0]) / denominator;
        const northY = (northPlus[1] - northMinus[1]) / denominator;
        let vx = (eastX * u + northX * v) * visualTimeScale;
        let vy = (eastY * u + northY * v) * visualTimeScale;
        const displaySpeed = Math.hypot(vx, vy);
        if (!Number.isFinite(displaySpeed)) return null;
        if (displaySpeed > maxSpeed) {
            const ratio = maxSpeed / displaySpeed;
            vx *= ratio;
            vy *= ratio;
        }
        return [vx, vy];
    }

    function ScreenField(width, height, step) {
        this.width = width;
        this.height = height;
        this.step = step;
        this.columns = Math.ceil(width / step) + 1;
        this.rows = Math.ceil(height / step) + 1;
        const length = this.columns * this.rows;
        this.vx = new Float32Array(length);
        this.vy = new Float32Array(length);
        this.speed = new Float32Array(length);
        this.opacity = new Float32Array(length);
        this.valid = new Uint8Array(length);
    }

    ScreenField.prototype.release = function () {
        this.vx = null;
        this.vy = null;
        this.speed = null;
        this.opacity = null;
        this.valid = null;
    };

    ScreenField.prototype.sample = function (x, y, target) {
        if (!this.valid || x < 0 || y < 0 || x > this.width || y > this.height) return null;
        const gx = clamp(x / this.step, 0, this.columns - 1);
        const gy = clamp(y / this.step, 0, this.rows - 1);
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const x1 = Math.min(x0 + 1, this.columns - 1);
        const y1 = Math.min(y0 + 1, this.rows - 1);
        const i00 = y0 * this.columns + x0;
        const i10 = y0 * this.columns + x1;
        const i01 = y1 * this.columns + x0;
        const i11 = y1 * this.columns + x1;
        const tx = gx - x0;
        const ty = gy - y0;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        if ((w00 && !this.valid[i00]) || (w10 && !this.valid[i10])
            || (w01 && !this.valid[i01]) || (w11 && !this.valid[i11])) return null;
        const output = target || [0, 0, 0];
        output[0] = this.vx[i00] * w00 + this.vx[i10] * w10 + this.vx[i01] * w01 + this.vx[i11] * w11;
        output[1] = this.vy[i00] * w00 + this.vy[i10] * w10 + this.vy[i01] * w01 + this.vy[i11] * w11;
        output[2] = this.speed[i00] * w00 + this.speed[i10] * w10 + this.speed[i01] * w01 + this.speed[i11] * w11;
        output[3] = this.opacity[i00] * w00 + this.opacity[i10] * w10 + this.opacity[i01] * w01 + this.opacity[i11] * w11;
        return output;
    };

    function Windy(parameters) {
        const params = parameters || {};
        if (!params.canvas || typeof params.canvas.getContext !== 'function') {
            throw new TypeError('Windy requires a canvas element.');
        }
        if (!root.WeatherGridWindGrid) throw new Error('wind-grid.js must be loaded before windy.js.');

        this.canvas = params.canvas;
        this.windField = root.WeatherGridWindGrid.create(params.data);
        this.visualTimeScale = finitePositive(params.visualTimeScale, DEFAULT_VISUAL_TIME_SCALE);
        this.maxDisplaySpeed = finitePositive(params.maxDisplaySpeed, DEFAULT_MAX_DISPLAY_SPEED);
        this.particleDensity = finitePositive(params.particleDensity, DEFAULT_PARTICLE_DENSITY);
        this.lineWidth = clamp(finitePositive(params.lineWidth, DEFAULT_LINE_WIDTH), 0.5, 3);
        this.screenField = null;
        this.particles = null;
        this.buildTimer = null;
        this.animationFrame = null;
        this.generation = 0;
        this.destroyed = false;
        this.lastFrameAt = 0;
        this.frameAccumulator = 0;
        this.diagnostics = {
            state: 'idle',
            generation: 0,
            fieldSamples: 0,
            validSamples: 0,
            fieldStep: 0,
            particleCount: 0,
            frameCount: 0,
            maxObservedWindSpeed: 0,
            maxObservedDisplaySpeed: 0,
            reducedMotion: false,
            visualTimeScale: this.visualTimeScale,
            maxDisplaySpeed: this.maxDisplaySpeed,
            vectorReference: params.data.vectorReference,
            unit: params.data.unit
        };
    }

    Windy.prototype.setData = function (payload) {
        if (this.destroyed) throw new Error('Cannot update a destroyed Windy renderer.');
        this.stop();
        this.windField = root.WeatherGridWindGrid.create(payload);
        this.diagnostics.vectorReference = payload.vectorReference;
        this.diagnostics.unit = payload.unit;
    };

    Windy.prototype.start = function (options) {
        if (this.destroyed) throw new Error('Cannot start a destroyed Windy renderer.');
        const config = options || {};
        const width = Math.max(1, Math.round(finitePositive(config.width, this.canvas.clientWidth || this.canvas.width)));
        const height = Math.max(1, Math.round(finitePositive(config.height, this.canvas.clientHeight || this.canvas.height)));
        const projectionCode = config.projectionCode || 'KMA_GRID_LCC';
        const screenProjection = createScreenProjection(width, height, config.viewProjectionExtent, projectionCode);

        this.stop();
        const generation = this.generation;
        this.diagnostics.state = 'building';
        this.diagnostics.reducedMotion = prefersReducedMotion();
        this.diagnostics.frameCount = 0;

        if (this.diagnostics.reducedMotion) {
            this.diagnostics.state = 'reduced-motion';
            return;
        }

        const baseStep = Math.max(3, Math.ceil(Math.sqrt(width * height / FIELD_SAMPLE_LIMIT)));
        const step = isMobileViewport() ? Math.max(5, baseStep) : Math.max(4, baseStep);
        const field = new ScreenField(width, height, step);
        const total = field.columns * field.rows;
        let index = 0;
        let validSamples = 0;
        let maxObservedWindSpeed = 0;
        let maxObservedDisplaySpeed = 0;
        const self = this;

        function buildBatch() {
            self.buildTimer = null;
            if (self.destroyed || generation !== self.generation) {
                field.release();
                return;
            }
            const batchStartedAt = now();
            while (index < total) {
                const row = Math.floor(index / field.columns);
                const column = index - row * field.columns;
                const x = Math.min(width, column * step);
                const y = Math.min(height, row * step);
                const lonLat = screenProjection.toLonLat(x, y);
                if (lonLat) {
                    const wind = self.windField.sample(lonLat[0], lonLat[1]);
                    if (wind) {
                        const velocity = projectVelocity(screenProjection, lonLat[0], lonLat[1],
                            wind[0], wind[1], self.visualTimeScale, self.maxDisplaySpeed);
                        if (velocity) {
                            field.vx[index] = velocity[0];
                            field.vy[index] = velocity[1];
                            field.speed[index] = wind[2];
                            field.opacity[index] = wind[3] === undefined ? 1 : wind[3];
                            field.valid[index] = 1;
                            validSamples += 1;
                            maxObservedWindSpeed = Math.max(maxObservedWindSpeed, wind[2]);
                            maxObservedDisplaySpeed = Math.max(maxObservedDisplaySpeed,
                                Math.hypot(velocity[0], velocity[1]));
                        }
                    }
                }
                index += 1;
                if (now() - batchStartedAt >= FIELD_TASK_BUDGET_MS) {
                    self.buildTimer = root.setTimeout(buildBatch, 0);
                    return;
                }
            }
            if (self.destroyed || generation !== self.generation) {
                field.release();
                return;
            }
            self.screenField = field;
            self.diagnostics.fieldSamples = total;
            self.diagnostics.validSamples = validSamples;
            self.diagnostics.fieldStep = step;
            self.diagnostics.maxObservedWindSpeed = maxObservedWindSpeed;
            self.diagnostics.maxObservedDisplaySpeed = maxObservedDisplaySpeed;
            self.beginAnimation(width, height, generation);
        }

        buildBatch();
    };

    Windy.prototype.beginAnimation = function (width, height, generation) {
        const field = this.screenField;
        if (!field || generation !== this.generation) return;
        const mobile = isMobileViewport();
        const count = clamp(Math.round(width * height * this.particleDensity * (mobile ? 0.62 : 1)),
            MIN_PARTICLES, mobile ? MAX_MOBILE_PARTICLES : MAX_DESKTOP_PARTICLES);
        const particles = {
            x: new Float32Array(count),
            y: new Float32Array(count),
            age: new Float32Array(count),
            visibility: new Float32Array(count)
        };
        this.particles = particles;
        this.diagnostics.particleCount = count;
        this.diagnostics.state = 'running';

        for (let index = 0; index < count; index += 1) {
            this.randomizeParticle(index, width, height);
            particles.age[index] = Math.random() * MAX_PARTICLE_AGE_SECONDS;
        }

        const self = this;
        this.lastFrameAt = 0;
        this.frameAccumulator = 0;
        function frame(frameAt) {
            if (self.destroyed || generation !== self.generation || !self.screenField || !self.particles) {
                self.animationFrame = null;
                return;
            }
            self.animationFrame = requestFrame(frame);
            if (!self.lastFrameAt) {
                self.lastFrameAt = frameAt;
                return;
            }
            self.frameAccumulator += Math.min(100, Math.max(0, frameAt - self.lastFrameAt));
            self.lastFrameAt = frameAt;
            if (self.frameAccumulator < TARGET_FRAME_MS) return;
            const elapsedSeconds = Math.min(MAX_FRAME_SECONDS, self.frameAccumulator / 1000);
            self.frameAccumulator = 0;
            self.drawFrame(width, height, elapsedSeconds);
        }
        this.animationFrame = requestFrame(frame);
    };

    Windy.prototype.randomizeParticle = function (index, width, height) {
        if (!this.particles || !this.screenField) return false;
        const sample = [0, 0, 0, 0];
        const visibility = Math.random();
        this.particles.visibility[index] = visibility;
        for (let attempt = 0; attempt < 24; attempt += 1) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            if (this.screenField.sample(x, y, sample) && sample[3] >= visibility) {
                this.particles.x[index] = x;
                this.particles.y[index] = y;
                this.particles.age[index] = 0;
                return true;
            }
        }
        this.particles.x[index] = -1;
        this.particles.y[index] = -1;
        this.particles.age[index] = MAX_PARTICLE_AGE_SECONDS;
        return false;
    };

    Windy.prototype.drawFrame = function (width, height, deltaSeconds) {
        const field = this.screenField;
        const particles = this.particles;
        if (!field || !particles) return;
        const context = this.canvas.getContext('2d');
        const scaleX = this.canvas.width / width;
        const scaleY = this.canvas.height / height;
        context.setTransform(scaleX, 0, 0, scaleY, 0, 0);

        context.globalCompositeOperation = 'destination-in';
        context.fillStyle = 'rgba(0,0,0,' + Math.pow(0.935, deltaSeconds * 30).toFixed(4) + ')';
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
        context.strokeStyle = root.WEATHER_GRID_PARTICLE_COLOR || 'rgb(255,255,255)';
        context.globalAlpha = 0.86;
        context.lineWidth = this.lineWidth;
        context.lineCap = 'round';
        context.beginPath();

        const first = [0, 0, 0, 0];
        const midpoint = [0, 0, 0, 0];
        const destination = [0, 0, 0, 0];
        for (let index = 0; index < particles.x.length; index += 1) {
            const x = particles.x[index];
            const y = particles.y[index];
            const age = particles.age[index] + deltaSeconds;
            if (age >= MAX_PARTICLE_AGE_SECONDS || !field.sample(x, y, first)
                || first[3] < particles.visibility[index]) {
                this.randomizeParticle(index, width, height);
                continue;
            }

            // Midpoint (RK2): sample again halfway along the projected vector.
            const middleX = x + first[0] * deltaSeconds * 0.5;
            const middleY = y + first[1] * deltaSeconds * 0.5;
            if (!field.sample(middleX, middleY, midpoint)
                || midpoint[3] < particles.visibility[index]) {
                this.randomizeParticle(index, width, height);
                continue;
            }
            const nextX = x + midpoint[0] * deltaSeconds;
            const nextY = y + midpoint[1] * deltaSeconds;
            if (!field.sample(nextX, nextY, destination)
                || destination[3] < particles.visibility[index]) {
                this.randomizeParticle(index, width, height);
                continue;
            }

            context.moveTo(x, y);
            context.lineTo(nextX, nextY);
            particles.x[index] = nextX;
            particles.y[index] = nextY;
            particles.age[index] = age;
        }
        context.stroke();
        context.globalAlpha = 1;
        context.setTransform(1, 0, 0, 1, 0, 0);
        this.diagnostics.frameCount += 1;
    };

    Windy.prototype.stop = function () {
        this.generation += 1;
        this.diagnostics.generation = this.generation;
        if (this.buildTimer !== null) {
            root.clearTimeout(this.buildTimer);
            this.buildTimer = null;
        }
        if (this.animationFrame !== null) {
            cancelFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this.screenField) this.screenField.release();
        this.screenField = null;
        this.particles = null;
        this.lastFrameAt = 0;
        this.frameAccumulator = 0;
        this.diagnostics.fieldSamples = 0;
        this.diagnostics.validSamples = 0;
        this.diagnostics.fieldStep = 0;
        this.diagnostics.particleCount = 0;
        this.diagnostics.maxObservedWindSpeed = 0;
        this.diagnostics.maxObservedDisplaySpeed = 0;
        if (!this.destroyed) this.diagnostics.state = 'stopped';
    };

    Windy.prototype.destroy = function () {
        if (this.destroyed) return;
        this.stop();
        this.destroyed = true;
        this.diagnostics.state = 'destroyed';
        this.canvas = null;
        this.windField = null;
    };

    Windy.prototype.getDiagnostics = function () {
        return Object.assign({}, this.diagnostics);
    };

    root.Windy = Windy;
})(window);
