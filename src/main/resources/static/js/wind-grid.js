(function (root, factory) {
    'use strict';
    const projection = typeof module === 'object' && module.exports
        ? require('./weather-grid-dfs-projection.js')
        : root.WeatherGridDfsProjection;
    const api = factory(projection);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WeatherGridWindGrid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DfsProjection) {
    'use strict';

    if (!DfsProjection) throw new Error('DFS projection must load before wind-grid');

    const SCHEMA = 'weather-grid.wind-field/v1';
    const EDGE_FEATHER_CELLS = 10;
    const SUPPORTED_GRID = Object.freeze({
        nxMin: 5,
        nxMax: 149,
        nyMin: 1,
        nyMax: 162
    });
    const projectionParameters = DfsProjection.parameters;

    function invariant(condition, message) {
        if (!condition) throw new TypeError('잘못된 바람 벡터장: ' + message);
    }

    function finiteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Returns a visual-only opacity near the finite forecast-grid boundary.
     * Values and interpolation stay untouched; the taper only prevents the
     * heatmap and particles from ending on the same hard rectangular edge.
     */
    function edgeOpacityAt(gridX, gridY, nx, ny) {
        if (![gridX, gridY, nx, ny].every(finiteNumber) || nx <= 0 || ny <= 0) return 0;
        const featherCells = Math.min(EDGE_FEATHER_CELLS,
            Math.max(0, Math.floor((Math.min(nx, ny) - 1) / 2)));
        if (featherCells === 0) return 1;
        const distance = Math.min(
            gridX + 0.5,
            gridY + 0.5,
            nx - 0.5 - gridX,
            ny - 0.5 - gridY
        );
        const t = Math.max(0, Math.min(1, distance / featherCells));
        return t * t * (3 - 2 * t);
    }

    /** 위경도 → 기상청 DFS 분수 격자 [x, y]. 정수 좌표가 셀 중심이다. */
    function latLonToGridFraction(latitude, longitude) {
        invariant(finiteNumber(latitude) && finiteNumber(longitude), '위경도 형식');
        return DfsProjection.latLonToGridFraction(latitude, longitude);
    }

    /**
     * 일정한 위경도 패치의 각 픽셀을 서버 응답 배열의 최근접 셀 인덱스로 변환한다.
     * 위도별 radius와 경도별 삼각함수를 재사용해 3D 텍스처 생성의 중복 투영 계산을 줄인다.
     */
    function createNearestIndexLut(options) {
        invariant(options && typeof options === 'object', '인덱스 LUT 옵션');
        ['width', 'height', 'nx', 'ny', 'nxMin', 'nyMin', 'step'].forEach(function (key) {
            invariant(Number.isInteger(options[key]) && options[key] > 0, '인덱스 LUT ' + key);
        });
        ['lonMin', 'lonMax', 'latMin', 'latMax'].forEach(function (key) {
            invariant(finiteNumber(options[key]), '인덱스 LUT ' + key);
        });
        invariant(options.lonMax > options.lonMin && options.latMax > options.latMin,
            '인덱스 LUT 범위');

        const width = options.width;
        const height = options.height;
        const sinTheta = new Float64Array(width);
        const cosTheta = new Float64Array(width);
        for (let x = 0; x < width; x += 1) {
            const longitude = options.lonMin
                + (x + 0.5) / width * (options.lonMax - options.lonMin);
            const theta = DfsProjection.angleAtLongitude(longitude);
            sinTheta[x] = Math.sin(theta);
            cosTheta[x] = Math.cos(theta);
        }

        const indices = new Int32Array(width * height);
        indices.fill(-1);
        for (let y = 0; y < height; y += 1) {
            const latitude = options.latMax
                - (y + 0.5) / height * (options.latMax - options.latMin);
            const radius = DfsProjection.radiusAtLatitude(latitude);
            const offset = y * width;
            for (let x = 0; x < width; x += 1) {
                const gridX = radius * sinTheta[x] + projectionParameters.originGridX;
                const gridY = projectionParameters.originRadius - radius * cosTheta[x]
                    + projectionParameters.originGridY;
                const column = Math.round((gridX - options.nxMin) / options.step);
                const southRow = Math.round((gridY - options.nyMin) / options.step);
                if (column < 0 || column >= options.nx || southRow < 0 || southRow >= options.ny) continue;
                indices[offset + x] = (options.ny - 1 - southRow) * options.nx + column;
            }
        }
        return indices;
    }

    /** 서버의 분포도·지점 시계열과 동일한 DFS 셀 지원 범위인지 판정한다. */
    function isInsideSupportedGrid(latitude, longitude) {
        if (!finiteNumber(latitude) || !finiteNumber(longitude)) return false;
        const point = latLonToGridFraction(latitude, longitude);
        const nx = Math.floor(point[0] + 0.5);
        const ny = Math.floor(point[1] + 0.5);
        return nx >= SUPPORTED_GRID.nxMin && nx <= SUPPORTED_GRID.nxMax
            && ny >= SUPPORTED_GRID.nyMin && ny <= SUPPORTED_GRID.nyMax;
    }

    function validatePayload(payload) {
        invariant(payload && typeof payload === 'object' && !Array.isArray(payload), '객체가 아님');
        invariant(payload.schema === SCHEMA, '지원하지 않는 schema');
        invariant(payload.unit === 'm/s', 'unit은 m/s여야 함');
        invariant(finiteNumber(payload.scaleFactor) && payload.scaleFactor > 0, 'scaleFactor');
        invariant(finiteNumber(payload.noData), 'noData');
        invariant(payload.vectorReference === 'earth-relative'
            || payload.vectorReference === 'earth-relative-assumed', 'vectorReference');

        const grid = payload.grid;
        invariant(grid && grid.type === 'kma-dfs-lcc', 'grid.type');
        ['nx', 'ny', 'nxMin', 'nyMin', 'step'].forEach(function (key) {
            invariant(Number.isInteger(grid[key]) && grid[key] > 0, 'grid.' + key);
        });
        invariant(grid.rowOrder === 'north-to-south', 'grid.rowOrder');
        invariant(grid.columnOrder === 'west-to-east', 'grid.columnOrder');

        const expected = grid.nx * grid.ny;
        invariant(Array.isArray(payload.u) && payload.u.length === expected, 'u 길이');
        invariant(Array.isArray(payload.v) && payload.v.length === expected, 'v 길이');
    }

    function WindField(payload) {
        validatePayload(payload);
        this.payload = payload;
        this.grid = payload.grid;
        this.scaleFactor = payload.scaleFactor;
        this.noData = payload.noData;
        this.u = payload.u;
        this.v = payload.v;
    }

    WindField.prototype.valueAt = function (index) {
        const encodedU = this.u[index];
        const encodedV = this.v[index];
        if (!finiteNumber(encodedU) || !finiteNumber(encodedV)
            || encodedU === this.noData || encodedV === this.noData) return null;
        return [encodedU * this.scaleFactor, encodedV * this.scaleFactor];
    };

    /**
     * 위경도에서 U/V를 쌍선형 보간한다. 반환값은 [동향 m/s, 북향 m/s, 풍속 m/s].
     * 결측 셀이 실제 바람 0 m/s로 섞이지 않도록 가중치가 있는 네 셀을 모두 검증한다.
     */
    WindField.prototype.sample = function (longitude, latitude) {
        if (!finiteNumber(longitude) || !finiteNumber(latitude)) return null;
        const dfs = latLonToGridFraction(latitude, longitude);
        const x = (dfs[0] - this.grid.nxMin) / this.grid.step;
        const southY = (dfs[1] - this.grid.nyMin) / this.grid.step;
        const y = (this.grid.ny - 1) - southY;
        if (x < 0 || y < 0 || x > this.grid.nx - 1 || y > this.grid.ny - 1) return null;

        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(x0 + 1, this.grid.nx - 1);
        const y1 = Math.min(y0 + 1, this.grid.ny - 1);
        const tx = x - x0;
        const ty = y - y0;
        const weights = [
            (1 - tx) * (1 - ty),
            tx * (1 - ty),
            (1 - tx) * ty,
            tx * ty
        ];
        const indices = [
            y0 * this.grid.nx + x0,
            y0 * this.grid.nx + x1,
            y1 * this.grid.nx + x0,
            y1 * this.grid.nx + x1
        ];

        let u = 0;
        let v = 0;
        for (let index = 0; index < indices.length; index += 1) {
            if (weights[index] === 0) continue;
            const value = this.valueAt(indices[index]);
            if (!value) return null;
            u += value[0] * weights[index];
            v += value[1] * weights[index];
        }
        return [u, v, Math.hypot(u, v), edgeOpacityAt(x, y, this.grid.nx, this.grid.ny)];
    };

    return Object.freeze({
        SCHEMA: SCHEMA,
        SUPPORTED_GRID: SUPPORTED_GRID,
        create: function (payload) { return new WindField(payload); },
        createNearestIndexLut: createNearestIndexLut,
        edgeOpacityAt: edgeOpacityAt,
        latLonToGridFraction: latLonToGridFraction,
        isInsideSupportedGrid: isInsideSupportedGrid
    });
});
