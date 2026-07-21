/**
 * 바람 민감 인프라 레이어 데이터 (weather-grid-ui.js가 소비)
 *
 * - 교량: 해상 장대교량 — 강풍 시 통행 제한 대상이라 풍속 예보와 직접 연관
 * - 공항: 이착륙 풍속·풍향 참고
 * - 항만: 무역항 — 해상풍 참고
 *
 * 좌표는 대표 지점(교량은 주경간 근사 선형) 기준의 개략값이다.
 * 클릭 시 해당 좌표의 5km 격자 예보를 조회하는 용도라 수백 m 오차는 기능에 영향 없다.
 */

const infraBridgeData = {
    "type": "FeatureCollection",
    "features": [
        { "type": "Feature", "properties": { "name": "인천대교" },
          "geometry": { "type": "LineString", "coordinates": [[126.642, 37.393], [126.552, 37.448]] } },
        { "type": "Feature", "properties": { "name": "영종대교" },
          "geometry": { "type": "LineString", "coordinates": [[126.583, 37.545], [126.520, 37.517]] } },
        { "type": "Feature", "properties": { "name": "서해대교" },
          "geometry": { "type": "LineString", "coordinates": [[126.848, 36.999], [126.826, 36.935]] } },
        { "type": "Feature", "properties": { "name": "광안대교" },
          "geometry": { "type": "LineString", "coordinates": [[129.112, 35.147], [129.138, 35.158]] } },
        { "type": "Feature", "properties": { "name": "부산항대교" },
          "geometry": { "type": "LineString", "coordinates": [[129.045, 35.095], [129.075, 35.108]] } },
        { "type": "Feature", "properties": { "name": "거가대교" },
          "geometry": { "type": "LineString", "coordinates": [[128.700, 35.020], [128.620, 34.930]] } },
        { "type": "Feature", "properties": { "name": "이순신대교" },
          "geometry": { "type": "LineString", "coordinates": [[127.735, 34.925], [127.705, 34.900]] } },
        { "type": "Feature", "properties": { "name": "남해대교" },
          "geometry": { "type": "LineString", "coordinates": [[127.878, 34.946], [127.884, 34.938]] } },
        { "type": "Feature", "properties": { "name": "진도대교" },
          "geometry": { "type": "LineString", "coordinates": [[126.297, 34.575], [126.303, 34.569]] } },
        { "type": "Feature", "properties": { "name": "목포대교" },
          "geometry": { "type": "LineString", "coordinates": [[126.352, 34.796], [126.378, 34.780]] } },
        { "type": "Feature", "properties": { "name": "마창대교" },
          "geometry": { "type": "LineString", "coordinates": [[128.605, 35.196], [128.625, 35.185]] } },
        { "type": "Feature", "properties": { "name": "울산대교" },
          "geometry": { "type": "LineString", "coordinates": [[129.375, 35.505], [129.397, 35.497]] } }
    ]
};

const infraAirportData = {
    "type": "FeatureCollection",
    "features": [
        { "type": "Feature", "properties": { "name": "인천국제공항", "code": "ICN" }, "geometry": { "type": "Point", "coordinates": [126.4407, 37.4602] } },
        { "type": "Feature", "properties": { "name": "김포국제공항", "code": "GMP" }, "geometry": { "type": "Point", "coordinates": [126.7906, 37.5583] } },
        { "type": "Feature", "properties": { "name": "김해국제공항", "code": "PUS" }, "geometry": { "type": "Point", "coordinates": [128.9382, 35.1795] } },
        { "type": "Feature", "properties": { "name": "제주국제공항", "code": "CJU" }, "geometry": { "type": "Point", "coordinates": [126.4930, 33.5113] } },
        { "type": "Feature", "properties": { "name": "대구국제공항", "code": "TAE" }, "geometry": { "type": "Point", "coordinates": [128.6589, 35.8941] } },
        { "type": "Feature", "properties": { "name": "청주국제공항", "code": "CJJ" }, "geometry": { "type": "Point", "coordinates": [127.4990, 36.7166] } },
        { "type": "Feature", "properties": { "name": "광주공항", "code": "KWJ" }, "geometry": { "type": "Point", "coordinates": [126.8086, 35.1264] } },
        { "type": "Feature", "properties": { "name": "무안국제공항", "code": "MWX" }, "geometry": { "type": "Point", "coordinates": [126.3828, 34.9914] } },
        { "type": "Feature", "properties": { "name": "여수공항", "code": "RSU" }, "geometry": { "type": "Point", "coordinates": [127.6161, 34.8423] } },
        { "type": "Feature", "properties": { "name": "울산공항", "code": "USN" }, "geometry": { "type": "Point", "coordinates": [129.3517, 35.5935] } },
        { "type": "Feature", "properties": { "name": "포항경주공항", "code": "KPO" }, "geometry": { "type": "Point", "coordinates": [129.4198, 35.9878] } },
        { "type": "Feature", "properties": { "name": "양양국제공항", "code": "YNY" }, "geometry": { "type": "Point", "coordinates": [128.6690, 38.0613] } },
        { "type": "Feature", "properties": { "name": "원주공항", "code": "WJU" }, "geometry": { "type": "Point", "coordinates": [127.9605, 37.4381] } },
        { "type": "Feature", "properties": { "name": "군산공항", "code": "KUV" }, "geometry": { "type": "Point", "coordinates": [126.6159, 35.9038] } },
        { "type": "Feature", "properties": { "name": "사천공항", "code": "HIN" }, "geometry": { "type": "Point", "coordinates": [128.0704, 35.0886] } }
    ]
};

const infraPortData = {
    "type": "FeatureCollection",
    "features": [
        { "type": "Feature", "properties": { "name": "부산항" },      "geometry": { "type": "Point", "coordinates": [129.040, 35.104] } },
        { "type": "Feature", "properties": { "name": "부산신항" },    "geometry": { "type": "Point", "coordinates": [128.784, 35.077] } },
        { "type": "Feature", "properties": { "name": "인천항" },      "geometry": { "type": "Point", "coordinates": [126.616, 37.454] } },
        { "type": "Feature", "properties": { "name": "평택·당진항" }, "geometry": { "type": "Point", "coordinates": [126.822, 36.966] } },
        { "type": "Feature", "properties": { "name": "광양항" },      "geometry": { "type": "Point", "coordinates": [127.755, 34.903] } },
        { "type": "Feature", "properties": { "name": "울산항" },      "geometry": { "type": "Point", "coordinates": [129.383, 35.501] } },
        { "type": "Feature", "properties": { "name": "포항항" },      "geometry": { "type": "Point", "coordinates": [129.425, 36.047] } },
        { "type": "Feature", "properties": { "name": "군산항" },      "geometry": { "type": "Point", "coordinates": [126.617, 35.976] } },
        { "type": "Feature", "properties": { "name": "목포항" },      "geometry": { "type": "Point", "coordinates": [126.383, 34.780] } },
        { "type": "Feature", "properties": { "name": "동해항" },      "geometry": { "type": "Point", "coordinates": [129.143, 37.494] } },
        { "type": "Feature", "properties": { "name": "제주항" },      "geometry": { "type": "Point", "coordinates": [126.527, 33.520] } }
    ]
};
