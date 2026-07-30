/**
 * 등치선 계산만 담당하는 순수 모듈.
 * OpenLayers와 화면 상태를 모르기 때문에 작은 합성 격자로 경계 조건을 바로 검증할 수 있다.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridIsolineState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var FIXED_LEVELS = Object.freeze({
        wdws: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]),
        tmp: Object.freeze([-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35]),
        pcp: Object.freeze([1, 3, 15, 30, 50]),
        sno: Object.freeze([1, 3, 5, 10, 20]),
        reh: Object.freeze([20, 40, 60, 80, 90]),
        wav: Object.freeze([0.5, 1, 2, 3, 4])
    });
    var MAX_SOLAR_LEVELS = 8;
    var VERTEX_EPSILON = 1e-10;
    var GAUSSIAN_WEIGHTS = Object.freeze([
        Object.freeze([1, 2, 1]),
        Object.freeze([2, 4, 2]),
        Object.freeze([1, 2, 1])
    ]);

    function isFiniteValue(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    function validGridSize(nx, ny) {
        return Number.isInteger(nx) && nx >= 2 && Number.isInteger(ny) && ny >= 2;
    }

    function validGridResult(result) {
        if (!result) return false;
        var data = result.data;
        var supported = Array.isArray(data)
            || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data));
        var step = result.step == null ? 1 : Number(result.step);
        return supported
            && validGridSize(result.nx, result.ny)
            && data.length === result.nx * result.ny
            && isFiniteValue(result.nxMin)
            && isFiniteValue(result.nyMin)
            && isFiniteValue(step)
            && step > 0;
    }

    function solarLevels(thresholds) {
        if (!Array.isArray(thresholds)) return [];
        var unique = Array.from(new Set(thresholds
            .filter(isFiniteValue)
            .filter(function (value) { return value > 0; })))
            .sort(function (a, b) { return a - b; });
        if (unique.length <= MAX_SOLAR_LEVELS) return unique;

        var sampled = [];
        for (var index = 0; index < MAX_SOLAR_LEVELS; index++) {
            var sourceIndex = Math.round(index * (unique.length - 1) / (MAX_SOLAR_LEVELS - 1));
            sampled.push(unique[sourceIndex]);
        }
        return Array.from(new Set(sampled));
    }

    function levelsFor(element, solarThresholds) {
        if (FIXED_LEVELS[element]) return FIXED_LEVELS[element].slice();
        if (element === 'swdn') return solarLevels(solarThresholds);
        return [];
    }

    function smoothingPasses(element) {
        // 누적 강수·적설은 좁은 극값을 두 번 평균내면 실제 영역보다 넓어 보일 수 있다.
        return element === 'pcp' || element === 'sno' ? 1 : 2;
    }

    function interpolation(a, b, level) {
        var difference = b - a;
        if (difference === 0) return 0.5;
        var ratio = (level - a) / difference;
        return Math.max(0, Math.min(1, ratio));
    }

    function endpoint(x1, y1, x2, y2, edgeKey, a, b, level) {
        var ratio = interpolation(a, b, level);
        var key = edgeKey;
        if (ratio <= VERTEX_EPSILON) key = 'p:' + x1 + ':' + y1;
        else if (ratio >= 1 - VERTEX_EPSILON) key = 'p:' + x2 + ':' + y2;
        return {
            key: key,
            point: [x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio]
        };
    }

    function addSegment(segments, first, second) {
        if (first.key !== second.key) segments.push([first, second]);
    }

    /**
     * 한 셀의 교차 선분을 만든다.
     * 5·10번 안장점은 네 모서리 평균이 아니라 bilinear asymptotic decider로 연결 방향을 고른다.
     */
    function cellSegments(values, column, row, level) {
        var v00 = values[0], v10 = values[1], v11 = values[2], v01 = values[3];
        if (![v00, v10, v11, v01, level].every(isFiniteValue)) return [];

        var index = (v00 >= level ? 1 : 0)
            | (v10 >= level ? 2 : 0)
            | (v11 >= level ? 4 : 0)
            | (v01 >= level ? 8 : 0);
        if (index === 0 || index === 15) return [];

        var bottom = endpoint(column, row, column + 1, row,
            'h:' + column + ':' + row, v00, v10, level);
        var right = endpoint(column + 1, row, column + 1, row + 1,
            'v:' + (column + 1) + ':' + row, v10, v11, level);
        var top = endpoint(column, row + 1, column + 1, row + 1,
            'h:' + column + ':' + (row + 1), v01, v11, level);
        var left = endpoint(column, row, column, row + 1,
            'v:' + column + ':' + row, v00, v01, level);
        var segments = [];

        switch (index) {
            case 1: case 14: addSegment(segments, left, bottom); break;
            case 2: case 13: addSegment(segments, bottom, right); break;
            case 3: case 12: addSegment(segments, left, right); break;
            case 4: case 11: addSegment(segments, right, top); break;
            case 6: case 9: addSegment(segments, bottom, top); break;
            case 7: case 8: addSegment(segments, left, top); break;
            case 5:
            case 10: {
                var a00 = v00 - level;
                var a10 = v10 - level;
                var a11 = v11 - level;
                var a01 = v01 - level;
                var determinant = a00 * a11 - a10 * a01;
                var scale = Math.max(1, Math.abs(a00 * a11), Math.abs(a10 * a01));
                var diagonal00Connected = Math.abs(determinant) <= Number.EPSILON * scale
                    ? v00 + v11 >= v10 + v01
                    : determinant > 0;

                if (index === 5 && diagonal00Connected) {
                    addSegment(segments, left, top);
                    addSegment(segments, bottom, right);
                } else if (index === 5) {
                    addSegment(segments, left, bottom);
                    addSegment(segments, right, top);
                } else if (diagonal00Connected) {
                    addSegment(segments, bottom, right);
                    addSegment(segments, left, top);
                } else {
                    addSegment(segments, left, bottom);
                    addSegment(segments, right, top);
                }
                break;
            }
        }
        return segments;
    }

    function takeUnused(adjacency, used, key) {
        var candidates = adjacency.get(key);
        if (!candidates) return -1;
        while (candidates.length && used[candidates[candidates.length - 1]]) candidates.pop();
        return candidates.length ? candidates[candidates.length - 1] : -1;
    }

    function chainSegments(segments) {
        var adjacency = new Map();
        var used = new Array(segments.length).fill(false);
        segments.forEach(function (segment, segmentIndex) {
            segment.forEach(function (point) {
                if (!adjacency.has(point.key)) adjacency.set(point.key, []);
                adjacency.get(point.key).push(segmentIndex);
            });
        });

        var lines = [];
        for (var start = 0; start < segments.length; start++) {
            if (used[start]) continue;
            used[start] = true;
            var line = [segments[start][0], segments[start][1]];

            for (var direction = 0; direction < 2; direction++) {
                for (;;) {
                    var end = direction === 0 ? line[line.length - 1] : line[0];
                    var nextIndex = takeUnused(adjacency, used, end.key);
                    if (nextIndex < 0) break;
                    used[nextIndex] = true;
                    var nextSegment = segments[nextIndex];
                    var next = nextSegment[0].key === end.key ? nextSegment[1] : nextSegment[0];
                    if (direction === 0) line.push(next);
                    else line.unshift(next);
                }
            }

            var coordinates = line.map(function (entry) { return entry.point; });
            // 한 셀을 지나는 두 점짜리 선도 작은 극값이나 자료 경계에서 생긴 유효한 등치선이다.
            if (coordinates.length >= 2) lines.push(coordinates);
        }
        return lines;
    }

    function isolinesForLevel(get, nx, ny, level) {
        if (typeof get !== 'function' || !validGridSize(nx, ny) || !isFiniteValue(level)) return [];
        var segments = [];
        for (var row = 0; row < ny - 1; row++) {
            for (var column = 0; column < nx - 1; column++) {
                var values = [
                    get(column, row),
                    get(column + 1, row),
                    get(column + 1, row + 1),
                    get(column, row + 1)
                ];
                if (!values.every(isFiniteValue)) continue;
                Array.prototype.push.apply(
                    segments, cellSegments(values, column, row, level));
            }
        }
        return chainSegments(segments);
    }

    /**
     * 자료 바깥쪽과 결측 셀 주변은 그대로 두고 내부만 3×3 가우시안 평균을 낸다.
     * 바다·자료 경계 건너편 값이 섞이거나 열린 등치선 끝점이 밀리는 것을 막기 위한 조건이다.
     */
    function smoothField(get, nx, ny, passes) {
        if (typeof get !== 'function' || !validGridSize(nx, ny)) {
            return function () { return NaN; };
        }
        var current = new Array(nx * ny);
        for (var row = 0; row < ny; row++) {
            for (var column = 0; column < nx; column++) {
                var value = get(column, row);
                current[row * nx + column] = isFiniteValue(value) ? value : NaN;
            }
        }

        var passCount = Math.max(0, Math.min(3, Math.floor(Number(passes) || 0)));
        for (var pass = 0; pass < passCount; pass++) {
            var next = current.slice();
            for (var y = 0; y < ny; y++) {
                for (var x = 0; x < nx; x++) {
                    var sourceIndex = y * nx + x;
                    if (!isFiniteValue(current[sourceIndex])) continue;
                    if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1) continue;

                    var weightedSum = 0;
                    var totalWeight = 0;
                    var completeWindow = true;
                    for (var offsetY = -1; offsetY <= 1; offsetY++) {
                        for (var offsetX = -1; offsetX <= 1; offsetX++) {
                            var sampleX = x + offsetX;
                            var sampleY = y + offsetY;
                            var sample = current[sampleY * nx + sampleX];
                            if (!isFiniteValue(sample)) {
                                completeWindow = false;
                                break;
                            }
                            var weight = GAUSSIAN_WEIGHTS[offsetY + 1][offsetX + 1];
                            weightedSum += sample * weight;
                            totalWeight += weight;
                        }
                        if (!completeWindow) break;
                    }
                    if (completeWindow && totalWeight) next[sourceIndex] = weightedSum / totalWeight;
                }
            }
            current = next;
        }
        return function (x, y) { return current[y * nx + x]; };
    }

    /** 열린 선은 끝점을 보존하고, 닫힌 선은 이음새까지 같은 비율로 코너를 다듬는다. */
    function smoothLine(line) {
        if (!Array.isArray(line) || line.length < 3) return Array.isArray(line) ? line.slice() : [];
        var closed = line.length > 3
            && line[0][0] === line[line.length - 1][0]
            && line[0][1] === line[line.length - 1][1];
        var source = closed ? line.slice(0, -1) : line;
        var output = closed ? [] : [source[0]];

        for (var index = 0; index < source.length - (closed ? 0 : 1); index++) {
            var first = source[index];
            var second = source[(index + 1) % source.length];
            output.push([
                first[0] * 0.75 + second[0] * 0.25,
                first[1] * 0.75 + second[1] * 0.25
            ]);
            output.push([
                first[0] * 0.25 + second[0] * 0.75,
                first[1] * 0.25 + second[1] * 0.75
            ]);
        }
        if (closed && output.length) output.push(output[0].slice());
        else output.push(source[source.length - 1]);
        return output;
    }

    return Object.freeze({
        validGridResult: validGridResult,
        levelsFor: levelsFor,
        smoothingPasses: smoothingPasses,
        cellSegments: cellSegments,
        isolinesForLevel: isolinesForLevel,
        smoothField: smoothField,
        smoothLine: smoothLine
    });
}));
