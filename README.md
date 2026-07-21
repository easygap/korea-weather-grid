<p align="center">
  <img src="src/main/resources/static/favicon-512.png" width="72" alt="BORA">
</p>

<h1 align="center">BORA · Korea Weather Grid</h1>

<p align="center">
기상청 격자 예보를 전국 분포와 시간 변화로 살펴보는 웹 지도입니다.<br>
지역을 검색하거나 지도를 선택하면 향후 48시간 예보도 확인할 수 있습니다.
</p>

<p align="center">
  <a href="https://bora-weather.dlwnstndlwld.workers.dev"><strong>서비스 바로가기</strong></a>
</p>

## 주요 기능

- 바람·기온·강수·눈·상대습도·하늘상태·파고·일사 분포
- +1~+48시간 예보 탐색과 과거 발표 자료 비교
- 지역 검색 및 지점별 예보 카드·시계열 차트
- PM10·PM2.5 관측, ITS 도로 CCTV, 태풍·낙뢰·기상특보
- 3D 지형·지구본, 지도 축척과 거리 측정

## 사용 흐름

### 기상 요소와 시간 탐색

같은 시간축에서 요소를 바꿔가며 전국 분포와 범례 구간별 비율을 비교할 수 있습니다.

### 지점별 48시간 예보

지역을 검색하거나 지도에서 지점을 선택하면 풍향·풍속 차트와 시간대별 상세예보가 열립니다.

### 대기질과 도로 CCTV

대기질 측정소와 ITS 도로 CCTV는 별도 레이어로 필요한 때에만 불러옵니다.

### 3D 지형 · 지구본

현재 분포를 3D 지형 또는 동아시아 지구본 위에서 확인할 수 있습니다.

## 로컬 실행

JDK 17이 필요합니다. 외부 API 없이 지도 UI만 확인할 때는 데모 모드를 사용합니다.

```bash
WEATHER_GRID_DEMO_MODE=true ./gradlew bootRun --args='--server.port=8080'
```

```powershell
$env:WEATHER_GRID_DEMO_MODE = "true"
.\gradlew.bat bootRun --args='--server.port=8080'
```

## 데이터 출처

| 데이터 | 출처 |
|---|---|
| 기상 예보·위험기상 | 기상청 API Hub 단기예보·KIM·태풍·낙뢰·기상특보 자료 · [단기예보 조회서비스](https://www.data.go.kr/data/15084084/openapi.do) |
| 미세먼지 관측 | [한국환경공단 AirKorea](https://www.airkorea.or.kr) |
| 도로 CCTV | [국가교통정보센터](https://its.go.kr/opendata/opendataList?service=cctv) |
| 배경지도·행정 경계 | OpenStreetMap contributors · Natural Earth 5.1.1 |
