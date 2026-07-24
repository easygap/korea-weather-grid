/**
 * 기상청 단기예보 5 km DFS 격자의 좌표 계산을 한곳에서 관리한다.
 *
 * 격자 번호는 지도 좌표가 아니므로 OpenLayers에는 5 km를 곱한 미터 좌표로 등록한다.
 * 기준 격자점 (43, 136)이 기준 위경도 (126°E, 38°N)에 오도록 false easting과
 * false northing을 잡으면 공개된 DFS 계산식과 Proj4 변환이 같은 좌표를 가리킨다.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WeatherGridDfsProjection = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var CODE = 'KMA_GRID_LCC';
    var DEG_TO_RAD = Math.PI / 180;
    var RAD_TO_DEG = 180 / Math.PI;
    var HALF_PI = Math.PI / 2;
    var QUARTER_PI = Math.PI / 4;

    var published = Object.freeze({
        earthRadiusMeters: 6_371_008.77,
        gridSpacingMeters: 5_000,
        standardParallel1Degrees: 30,
        standardParallel2Degrees: 60,
        originLongitudeDegrees: 126,
        originLatitudeDegrees: 38,
        originGridX: 43,
        originGridY: 136
    });

    var standardParallel1 = published.standardParallel1Degrees * DEG_TO_RAD;
    var standardParallel2 = published.standardParallel2Degrees * DEG_TO_RAD;
    var originLongitude = published.originLongitudeDegrees * DEG_TO_RAD;
    var originLatitude = published.originLatitudeDegrees * DEG_TO_RAD;
    var scaledEarthRadius = published.earthRadiusMeters / published.gridSpacingMeters;

    var coneRatio = tangentAt(standardParallel2) / tangentAt(standardParallel1);
    var coneExponent = Math.log(Math.cos(standardParallel1) / Math.cos(standardParallel2))
        / Math.log(coneRatio);
    var coneScale = Math.cos(standardParallel1)
        * Math.pow(tangentAt(standardParallel1), coneExponent) / coneExponent;
    var originRadius = radiusAtRadians(originLatitude);

    var parameters = Object.freeze({
        earthRadiusMeters: published.earthRadiusMeters,
        gridSpacingMeters: published.gridSpacingMeters,
        originGridX: published.originGridX,
        originGridY: published.originGridY,
        coneExponent: coneExponent,
        coneScale: coneScale,
        originRadius: originRadius,
        scaledEarthRadius: scaledEarthRadius
    });

    var PROJ4_DEFINITION = [
        '+proj=lcc',
        '+lat_1=' + published.standardParallel1Degrees,
        '+lat_2=' + published.standardParallel2Degrees,
        '+lat_0=' + published.originLatitudeDegrees,
        '+lon_0=' + published.originLongitudeDegrees,
        '+x_0=' + (published.originGridX * published.gridSpacingMeters),
        '+y_0=' + (published.originGridY * published.gridSpacingMeters),
        '+R=' + published.earthRadiusMeters,
        '+units=m',
        '+no_defs'
    ].join(' ');

    function tangentAt(latitudeRadians) {
        return Math.tan(QUARTER_PI + latitudeRadians / 2);
    }

    function radiusAtRadians(latitudeRadians) {
        return scaledEarthRadius * coneScale
            / Math.pow(tangentAt(latitudeRadians), coneExponent);
    }

    function requireLatitude(latitude) {
        if (!Number.isFinite(latitude) || latitude <= -90 || latitude >= 90) {
            throw new TypeError('위도는 -90보다 크고 90보다 작은 유한한 값이어야 합니다');
        }
    }

    function requireLongitude(longitude) {
        if (!Number.isFinite(longitude)) {
            throw new TypeError('경도는 유한한 값이어야 합니다');
        }
    }

    function requireGridCoordinate(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new TypeError('DFS 격자 좌표는 유한한 값이어야 합니다');
        }
    }

    /** 경도 차이는 입력 범위와 관계없이 -π..π로 정규화한다. */
    function angleAtLongitude(longitude) {
        requireLongitude(longitude);
        var delta = longitude * DEG_TO_RAD - originLongitude;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        return delta * coneExponent;
    }

    function radiusAtLatitude(latitude) {
        requireLatitude(latitude);
        return radiusAtRadians(latitude * DEG_TO_RAD);
    }

    /** 위경도 → DFS 분수 격자 [x, y]. 정수 좌표가 각 셀의 중심이다. */
    function latLonToGridFraction(latitude, longitude) {
        var radius = radiusAtLatitude(latitude);
        var angle = angleAtLongitude(longitude);
        return [
            radius * Math.sin(angle) + published.originGridX,
            originRadius - radius * Math.cos(angle) + published.originGridY
        ];
    }

    /** DFS 분수 격자 → [위도, 경도]. 등치선 정점도 같은 역변환을 사용한다. */
    function gridToLatLon(x, y) {
        requireGridCoordinate(x, y);
        var east = x - published.originGridX;
        var north = originRadius - y + published.originGridY;
        var radius = Math.hypot(east, north);
        if (coneExponent < 0) radius = -radius;

        var latitude;
        var angle;
        if (radius === 0) {
            latitude = Math.sign(coneExponent || 1) * HALF_PI;
            angle = 0;
        } else {
            latitude = 2 * Math.atan(Math.pow(
                scaledEarthRadius * coneScale / radius, 1 / coneExponent)) - HALF_PI;
            angle = Math.atan2(east, north);
        }

        var longitude = published.originLongitudeDegrees + angle / coneExponent * RAD_TO_DEG;
        longitude = ((longitude + 180) % 360 + 360) % 360 - 180;
        return [latitude * RAD_TO_DEG, longitude];
    }

    /** OpenLayers용 KMA_GRID_LCC 좌표. 격자 한 칸은 정확히 5,000 m다. */
    function gridToProjected(x, y) {
        requireGridCoordinate(x, y);
        return [x * published.gridSpacingMeters, y * published.gridSpacingMeters];
    }

    function projectedToGrid(easting, northing) {
        requireGridCoordinate(easting, northing);
        return [
            easting / published.gridSpacingMeters,
            northing / published.gridSpacingMeters
        ];
    }

    return Object.freeze({
        code: CODE,
        proj4Definition: PROJ4_DEFINITION,
        published: published,
        parameters: parameters,
        angleAtLongitude: angleAtLongitude,
        radiusAtLatitude: radiusAtLatitude,
        latLonToGridFraction: latLonToGridFraction,
        gridToLatLon: gridToLatLon,
        gridToProjected: gridToProjected,
        projectedToGrid: projectedToGrid
    });
}));
