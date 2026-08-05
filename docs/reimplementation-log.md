# 독립 재구현 기록

이 기록은 코드의 동작 출처와 검증 근거를 남긴다. 단순 파일 이동, 식별자 변경, 포맷 변경은
독립 재구현 완료로 기록하지 않는다.

## 2026-07-22 · 기상청 DFS 투영

- 범위: `io.github.easygap.weathergrid.geo.KmaDfsProjection`
- 입력 사양: 기상청 「동네예보 격자영역 정보」에 공개된 Lambert conformal conic 투영,
  지구반경 6371.00877 km, 5 km 셀, 표준위도 30°/60°, 기준위경도 38°N/126°E,
  기준 격자 43/136.
- 설계: 변환 결과를 배열 대신 `Cell`과 `GeoPoint` record로 표현하고, 전체 투영과 현재 지도
  노출 범위(`CellWindow`)를 분리했다. 상수로부터 투영 계수를 생성자에서 한 번 계산한다.
- 검증: 기상청 문서의 네 모서리 좌표, 셀 중심 왕복, 포함 경계, 잘못된 입력을 단위 테스트한다.
- 명령: `./gradlew test --tests io.github.easygap.weathergrid.geo.KmaDfsProjectionTest`
- 상태: 완료.

## 2026-07-22 · 지점 시계열 차트

- 범위: `static/js/station-charts.js`
- 구현: 외부 차트 런타임 없이 단일 SVG를 생성하고, 풍향은 저장소 자체 SVG path로 표시한다.
- 의존성: 없음. Highcharts, Windbarb, Chart.js를 로드하지 않는다.
- 검증: 공개 감사 스크립트가 금지 런타임의 재도입을 검사한다.
- 상태: 기능 구현 완료, 향후 UI 셸 재구현 때 DOM 계약을 다시 검토한다.

## 2026-07-22 · 브랜드와 지도 선택 미리보기

- 범위: `static/favicon.svg`, `static/image/basemap-*.svg`
- 입력 사양: 날씨 레이어, 격자, 행정 경계, 도로라는 제품 개념만 사용했다.
- 구현: 외부 지도 캡처·아이콘·이미지 생성 모델 없이 SVG 도형과 경로를 저장소에서 새로 작성했다.
- 검증: `docs/publication-manifest.json`에 byte 수와 SHA-256을 고정한다.
- 상태: 완료. 2026-07-26에 `static/favicon.svg`를 제품 상징(깃발)으로 다시 작성했다. 아래 항목 참고.

## 2026-07-26 · 브랜드 심볼 재작성

- 범위: `static/favicon.svg`.
- 배경: 2026-07-22 판은 제품 개념만으로 그린 탓에 어느 날씨 서비스에나 붙는 일반적인 도형이
  됐고, 16 px 탭 크기에서 형태가 뭉개졌다.
- 입력 사양: 제품명 BORA가 가리키는 보라색과 바람이라는 두 가지 개념만 사용했다. 바람에
  날리는 삼각기(pennant)를 깃대와 함께 배치한다.
- 구현: 외부 아이콘 세트·이미지 생성 모델 없이 저장소 전용 좌표로 새로 정의했다. 깃대는
  `stroke-width` 7.5로 두어 16 px에서도 획이 남고, 마크가 64 뷰박스의 광학 중심에 오도록
  배치했다. 깃대 색은 `prefers-color-scheme`로 밝은 탭에서 `#23262b`, 어두운 탭에서
  `#e8eaf0`이 되고 깃발은 두 경우 모두 `#978ff9`을 유지한다.
- 검증: headless Chromium으로 16·20·32·48·64·128 px, 밝은/어두운 스킴을 각각 렌더링해
  형태와 대비를 확인했다. `docs/publication-manifest.json`의 byte 수와 SHA-256을 갱신한다.
- 상태: 완료.

## 2026-07-22 · Spring 접속·정적 자산·브라우저 정책 설정

- 범위: `KmaClientProperties`, `KmaClientConfiguration`, `StaticResourcesConfiguration`,
  `BrowserPolicyHeadersFilter`, `RequestBodyLimitFilter`.
- 입력 사양: Spring Boot의 type-safe external configuration, Spring WebClient의 Reactor Netty
  connector/timeout/codec limit, Spring MVC resource handler, `OncePerRequestFilter` 공식 문서.
- 설계: 환경 설정을 record로 바인딩하고, HTTP 전송 설정과 자산 캐시를 분리했다. 응답 보안
  헤더와 요청 본문 제한도 서로 다른 필터로 나눠 각각 한 가지 정책만 담당한다.
- 검증: HTTP/HTTPS별 CSP·HSTS, 명시 길이와 chunk 형태의 8 KiB 초과 POST, 허용 본문의
  재읽기, 실제 GeoJSON MIME·gzip 통합 테스트를 수행한다.
- 명령: `./gradlew test --tests io.github.easygap.weathergrid.config.*`
- 상태: 완료.

## 2026-07-22 · Natural Earth 지도 자료

- 범위: `static/data/geodata/*.geojson`, `tools/geodata`.
- 입력 사양: Natural Earth 5.1.1 land와 admin-1 공개 원본, Natural Earth public-domain terms,
  제품의 동아시아 bbox 및 17개 시도 표시 요구사항.
- 설계: 원본 ZIP의 byte 수와 SHA-256을 고정하고, bbox clip·고정 tolerance 단순화·필드 축소·
  최신 한국어 표시명 매핑·0.0001° 반올림을 한 Node 도구에서 결정적으로 수행한다. 반올림 뒤
  중복 좌표를 제거하고 링을 닫으며, 빈 폴리곤·열린 링·범위 밖 좌표를 출력 전에 거부한다.
- 검증: `npm run check --prefix tools/geodata`가 원본 무결성과 생성 결과의 byte 일치를 검사하고,
  Java 통합 테스트가 GeoJSON MIME, gzip, 스키마 ID를 확인한다.
- 상태: 완료.

## 2026-07-22 · 공공데이터포털·ITS JSON gateway

- 범위: `integration/PublicDataGateway`, `integration/TrafficCameraGateway`,
  `integration/BoundedJsonTransport`, `config/UpstreamApiProperties`.
- 입력 사양: 공공데이터포털의 기상청 단기예보·AirKorea REST/JSON endpoint 문서와 ITS
  국가교통정보센터 CCTV 요청·응답 변수 문서. 이전 클라이언트 구현은 입력으로 사용하지 않았다.
- 설계: 임의 경로 대신 세 개의 승인된 공공데이터 dataset enum만 노출한다. ITS는 공식 요청값
  `type=all`, HTTPS HLS `cctvType=4`, `getType=json`을 내부에서 고정하고 검증된 viewport만 받는다.
  두 공급자는 공통 전송기에서 비정상 상태 코드, 빈 본문, 4 MiB/2 MiB를 넘는 선언·실제 본문,
  JSON object가 아닌 응답을 거부한다. 자격 증명은 URL 인코딩 전 단일 행 원문만 받고 URI 변수로
  정확히 한 번 인코딩하며, 실패 예외에 요청 URI나 원인을 포함하지 않는다.
- 검증: `PublicDataGatewayContractTest`, `TrafficCameraGatewayContractTest`가 합성 응답만으로
  경로·query·한글 및 예약문자 인코딩·credential 검증·크기 상한·오류 정규화를 확인한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.integration.*"`
- 상태: 완료. 기존 `DataGoApiClient`, `ItsApiClient`와 해당 테스트는 제거했다.

## 2026-07-22 · KMA DFS·KIM 텍스트 gateway

- 범위: `integration/KmaTextGateway`, `integration/BoundedTextTransport`, `service/GridCacheService` 연결.
- 입력 사양: 기상청 API허브의 단기예보 격자 `nph-dfs_shrt_grd` 요청 인자와
  KIM 표준화 NC `nph-kim_nc_xy_txt2_std` 요청 인자. DFS는 02시부터 3시간
  간격의 8개 발표시각과 문서에 명시된 14개 변수만, KIM은 00/06/12/18 UTC와
  2026-06-22 이후 전지구 예측시간 간격을 허용한다.
- 설계: 캐시/파싱 서비스에서 HTTP 전송을 분리했다. KIM은 현재 `typ06` 표준화
  endpoint, NE57 단일면 `dswrsfc`, 고정 한반도 크롭만 생성한다. 두 응답은
  2 MiB의 선언·실제 byte 상한과 35초 전체 시간 상한을 두고, JSON/HTML/오류 문서를
  격자로 전달하지 않는다. 인증키는 원문 형태만 받아 한 번 인코딩하고 예외 원인을
  외부로 보존하지 않는다.
- 검증: `KmaTextGatewayContractTest`가 합성 응답만으로 경로·고정 query·정확한 1회
  인코딩·시각/변수 허용 목록·선언 및 실제 크기 상한·오류 정규화를 확인한다.
- 명령: `./gradlew test --tests io.github.easygap.weathergrid.integration.KmaTextGatewayContractTest
  --tests io.github.easygap.weathergrid.service.GridCacheServiceTest`
- 상태: 격자 전송 경계 완료.

## 2026-07-22 · KMA 지점예보·발표시각·49시간 슬롯

- 범위: `integration/KmaPointForecastGateway`, `service/ForecastReleaseClock`,
  `service/StationForecastService`, `service/MapService` 연결.
- 입력 사양: 기상청 API허브 동네예보 `getVilageFcst` JSON 요청·응답 계약,
  02시부터 3시간 간격의 일 8회 발표시각, 발표 10분 후 사용 규칙, 브라우저의
  발표 +0~+48시간 고정 슬롯 계약.
- 설계: HTTP/JSON은 지점 한 개와 5개 카테고리만 `ForecastValue` 불변 record로
  정규화한다. 임의 발표시각·격자와 2 MiB를 넘는 응답은 거부하고, 인증키를
  URI 변수로 한 번만 인코딩한다. 발표시각은 JVM 타임존과 분리된 KST `Clock`으로
  계산하고, 슬롯 서비스는 실제 0과 결측 9999를 분리하며 분 단위/범위 밖 값을 버린다.
  유효 슬롯이 없는 실패 결과는 캐시하지 않는다.
- 검증: `KmaPointForecastGatewayContractTest`, `ForecastReleaseClockTest`,
  `StationForecastServiceTest`가 합성 JSON, 인코딩, 범위/크기 제한, 02:09/02:10 KST 경계,
  실제 0, 결측, 49시간 밖 값과 캐시 정책을 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.integration.KmaPointForecastGatewayContractTest"
  --tests "io.github.easygap.weathergrid.service.ForecastReleaseClockTest"
  --tests "io.github.easygap.weathergrid.service.StationForecastServiceTest"`
- 상태: 완료. 기존 `KmaApiService` 구현과 전용 테스트 두 개를 제거했다.

## 2026-07-22 · ITS CCTV 정규화·셀 캐시·공개 응답

- 범위: `integration/TrafficCameraFeed`, `service/CctvTileCache`, `service/CctvService`.
- 입력 사양: ITS 국가교통정보센터의 HTTPS HLS `cctvType=4` 요청, `datacount`,
  `data`, `roadsectionid`, `filecreatetime`, `cctvurl`, `coordx`, `coordy`, `cctvformat`,
  `cctvname` 출력 필드와 지도 viewport 제품 요구사항.
- 설계: 원문 JSON은 공식 소문자 필드만 받아 provider-neutral `Camera` record로
  변환한다. HTTPS, 승인 미디어 호스트, 기본/443 포트, HLS, 제어문자·길이·
  좌표를 검증하고 query·fragment·userinfo URL은 노출하지 않는다. 0.25° 셀은 최대
  24개만 한 요청에서 병렬 조회하며, 셀별 잠금으로 cold miss를 하나로 합친다.
  1분 fresh, 5분 stale, 1분 retry pause, 10초 batch deadline, 6 worker, 256셀 LRU로
  상류 장애와 메모리/스레드 점유를 제한한다. 공개 응답은 요청 bbox를 다시 적용하고
  ID 중복을 제거·정렬한 뒤 1,000개로 제한한다.
- 검증: `TrafficCameraFeedContractTest`, `CctvTileCacheTest`, 새 `CctvServiceTest`가
  공식 필드, 안전한 URL, 손상 항목, fresh/stale/backoff, 동시 cold miss, 24/256/1,000개
  상한, 범위 필터와 중복 제거를 합성 응답으로 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.integration.TrafficCameraFeedContractTest"
  --tests "io.github.easygap.weathergrid.service.CctvTileCacheTest"
  --tests "io.github.easygap.weathergrid.service.CctvServiceTest"`
- 상태: 완료. 기존 단일 `CctvService` 구현과 테스트를 새 책임 경계로 교체했다.

## 2026-07-22 · 지점 상세예보·AirKorea 정규화와 스냅샷

- 범위: `integration/VillageForecastFeed`, `integration/AirQualityFeed`,
  `service/PointForecastTimeline`, `service/AirQualitySnapshotCache`,
  `service/AirQualityService`, `service/EnvironmentalDataService`.
- 입력 사양: 공공데이터포털 기상청 단기예보 `getVilageFcst`의 발표일·발표시각·격자와
  `category`, `fcstDate`, `fcstTime`, `fcstValue` 응답 필드. 한국환경공단 AirKorea의
  시도별 실시간 측정 `getCtprvnRltmMesureDnsty`와 측정소 목록 `getMsrstnList`에 공개된
  페이지, 측정소명, 측정시각, PM10/PM2.5, 1시간 등급·플래그, 주소·측정망·WGS84 좌표 필드.
- 설계: 상세예보 원문은 한 발표·격자에서 최대 1,000행의 완전한 응답만 정규화하고,
  공개 서비스가 +0~+48시간의 고정 슬롯을 새로 조립한다. 실제 0과 결측을 구분하며 숫자·
  코드·원문 강수량을 서로 다른 검증 규칙으로 처리하고, 200개 LRU와 1시간 TTL을 둔다.
  AirKorea는 측정값과 측정소 메타데이터를 별도 자원으로 읽어 각각 1시간/7일 fresh,
  6시간/30일 stale 상한, 15분 실패 재시도 간격, 잠금 기반 single-flight를 적용한다.
  측정소명은 주소의 시도와 측정망으로 모호성을 해소하고, 동일 좌표는 최신 시각만 남긴다.
  외부 플래그가 있는 농도는 공개 값에서 제외하고 24시간 등급을 1시간 등급으로 대체하지 않는다.
  컨트롤러가 의존하는 `EnvironmentalDataService`는 두 기능을 위임하는 얇은 경계만 유지한다.
- 검증: `VillageForecastFeedContractTest`, `PointForecastTimelineTest`,
  `AirQualityFeedContractTest`, `AirQualitySnapshotCacheTest`, `AirQualityServiceTest`,
  새 `EnvironmentalDataServiceTest`가 공식 query·필드·페이지 완전성, 49시간 범위,
  실제 0, 손상 행 격리, 좌표 방향, 지역 중복 이름, fresh/stale/backoff, 동시 cold miss,
  실패 미캐싱과 viewport를 합성 데이터로 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.integration.VillageForecastFeedContractTest"
  --tests "io.github.easygap.weathergrid.integration.AirQualityFeedContractTest"
  --tests "io.github.easygap.weathergrid.service.PointForecastTimelineTest"
  --tests "io.github.easygap.weathergrid.service.AirQualitySnapshotCacheTest"
  --tests "io.github.easygap.weathergrid.service.AirQualityServiceTest"
  --tests "io.github.easygap.weathergrid.service.EnvironmentalDataServiceTest"`
- 상태: 완료. 기존 600행 단일 서비스와 내부 구조 중심 테스트를 여섯 책임 경계와 합성 계약
  테스트로 교체했다.

## 2026-07-22 · 환경 REST 요청 정책·기능별 컨트롤러

- 범위: `controller/PublicRequestPolicy`, `controller/PublicApiExceptionHandler`,
  `controller/EnvironmentalDataController`, `controller/TrafficCameraController`,
  `controller/HazardStatusController`.
- 입력 사양: Spring Framework 7 MVC의 [`@RequestParam` 필수값·형 변환](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/requestparam.html)과
  [`@RestControllerAdvice` 예외 처리](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-advice.html) 계약, 브라우저가 사용하는 세 JSON 응답 스키마,
  Cloudflare 경로와 공유하는 400·429·503 텍스트·`Retry-After`·`Cache-Control` 계약.
- 설계: 한 컨트롤러에 있던 예보·대기질, CCTV, 위험기상 연결 상태를 서로 다른 의존성의
  세 컨트롤러로 분리했다. 요청 정책은 쿼리 이름 집합과 단일값을 먼저 확인해 인증키나 상류
  옵션을 받을 수 없게 한다. 주입 가능한 KST `Clock`으로 발표+10분, 오늘부터 60일,
  일 8회 발표시각을 검사하며 좌표·빈 viewport·0.25° CCTV 24셀 상한도 rate limit과
  서비스 호출보다 먼저 적용한다. 오류 매핑은 이 세 컨트롤러에만 한정한 advice로 옮기고,
  기존 영문 텍스트 계약을 보존하면서 한글 400 응답까지 `text/plain; charset=UTF-8`로
  명시했다. 위험기상 연결 상태는 임의 `Map` 대신 불변 record로 직렬화한다.
- 검증: 새 `EnvironmentalDataControllerTest`, `TrafficCameraControllerTest`,
  `HazardStatusControllerTest`, `PublicRequestPolicyTest`가 정상 JSON·cache header, stale,
  알 수 없는/중복/누락/형식 오류 query, 비유한 좌표, 24셀 상한, 02:09:59/02:10:00 KST,
  60일 경계, UTF-8 오류 본문, rate limit 이전 차단과 429·503을 MockMvc로 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.controller.EnvironmentalDataControllerTest"
  --tests "io.github.easygap.weathergrid.controller.TrafficCameraControllerTest"
  --tests "io.github.easygap.weathergrid.controller.HazardStatusControllerTest"
  --tests "io.github.easygap.weathergrid.controller.PublicRequestPolicyTest"`
- 상태: 완료. 과거 `EnvironmentalDataController`와 단일 테스트의 rename 유사 후보가 제거됐다.

## 2026-07-22 · 지도 페이지·격자·좌표 HTTP 경계

- 범위: `controller/MapPageController`, `controller/WeatherGridController`,
  `controller/WeatherLocationController`, `controller/WeatherMapRequestPolicy`,
  `controller/WeatherMapExceptionHandler`.
- 입력 사양: 브라우저가 호출하는 `/api/weather/grid`, `/api/weather/grid/stats`,
  `/api/weather/coverage`, `/api/weather/timeseries` 공개 query와 JSON 형태, 기상청 단기예보의
  일 8회 발표·+0~+48시간 제품 범위, Spring MVC의 필수 `@RequestParam`·기본값·형 변환·
  scoped controller advice 계약.
- 설계: HTML 모델 렌더링, 전국 격자/통계, 좌표 범위/지점 시계열을 세 컨트롤러로 나눴다.
  공통 지도 요청 정책은 endpoint별 필수·선택 query 집합과 단일값을 검사하고, 공개 발표일,
  9개 격자 요소, `10m`, 0~48 lead hour, 한국 좌표를 서비스 전에 검증한다. 강수량·신적설·
  강수형태·습도·하늘상태·파고 지점 요청은 구조화된 상세예보 endpoint로 보낸다. 격자와
  통계는 같은 `weather-grid` 요청 예산을 공유하고 지점 시계열은 별도 `weather-timeseries`
  예산과 5분 client cache를 사용한다. 지도 advice는 상류 상세 오류를 노출하지 않고 UTF-8
  400, `Retry-After`가 있는 429·503으로만 정규화한다.
- 검증: `WeatherGridControllerTest`, `WeatherLocationControllerTest`,
  `MapPageControllerTest`, `WeatherMapRequestPolicyTest`가 페이지 모델, 격자와 통계의 서로
  다른 서비스 경로, 동일 예산, 9개 요소, 기본 query, 중복·알 수 없는 상류 옵션,
  잘못된 고도·lead hour·형 변환, DFS coverage, 상세예보 라우팅, 시계열 cache와 429·503을
  합성 MockMvc 요청으로 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.controller.WeatherGridControllerTest"
  --tests "io.github.easygap.weathergrid.controller.WeatherLocationControllerTest"
  --tests "io.github.easygap.weathergrid.controller.MapPageControllerTest"
  --tests "io.github.easygap.weathergrid.controller.WeatherMapRequestPolicyTest"`
- 상태: 완료. 이전 단일 `MapController`와 그 내부 예외·검증 테스트를 책임별 파일로 교체했다.

## 2026-07-22 · 지도 격자 원천·응답·지점 시계열 경계

- 범위: `service/DfsWindGridSource`, `service/DfsScalarGridSource`,
  `service/KimSolarGridSource`, `service/WeatherGridWindow`, `service/WeatherGridDataset`,
  `service/WeatherGridService`, `service/WeatherStationSeriesService`, `service/MapService`.
- 입력 사양: 기상청 DFS의 WSD·UUU·VVV와 TMP·PCP·SNO·PTY·REH·SKY·WAV 격자,
  KIM NE57 `dswrsfc`의 2026-07-01 전 3시간/이후 1시간 출력, 브라우저의 north-to-south
  평탄 격자·0.1 m/s 정수 벡터장·49시간 지점 배열·수치/범주 통계 공개 계약.
- 설계: 790줄 단일 서비스에서 발표시각, 세 데이터 원천, 물리 범위 검증, 이전 런 선택,
  KIM 좌표 표본, 데모 합성장, 통계, 공간 메타데이터, 지점 배열을 분리했다. 모든 원천은
  `WeatherGridWindow`가 정한 동일 셀과 순서를 사용하고 `WeatherGridDataset`으로 정규화한 뒤,
  `WeatherGridService`만 공개 JSON을 조립한다. 스칼라 범주 코드는 평균을 만들지 않고 건수만
  제공하며, 실제 0은 결측 sentinel과 구분한다. `MapService`는 최신 발표 정보와 세 공개
  메서드를 위임하는 47줄 facade만 남겼다.
- 검증: `DfsWindGridSourceTest`, `DfsScalarGridSourceTest`, `KimSolarGridSourceTest`,
  `WeatherGridServiceTest`, `WeatherStationSeriesServiceTest`, `WeatherGridWindowTest`,
  `MapServiceTest`가 WSD/벡터 대체, 7개 스칼라 변수, 범주 코드, 직전 DFS/KIM 런,
  시간별 KIM 49슬롯, 실제 0/결측, 운영 503, 데모 합성, step 경계와 facade 위임을 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.service.DfsWindGridSourceTest"
  --tests "io.github.easygap.weathergrid.service.DfsScalarGridSourceTest"
  --tests "io.github.easygap.weathergrid.service.KimSolarGridSourceTest"
  --tests "io.github.easygap.weathergrid.service.WeatherGridServiceTest"
  --tests "io.github.easygap.weathergrid.service.WeatherStationSeriesServiceTest"
  --tests "io.github.easygap.weathergrid.service.WeatherGridWindowTest"
  --tests "io.github.easygap.weathergrid.service.MapServiceTest"`
- 상태: 완료. 기존 `MapService` 내부 구현과 `MapService*Test` 3개를 책임별 구현과 공개 계약
  중심 테스트로 교체했으며, 추적 중인 rename 후보는 25개에서 21개로 감소했다.

## 2026-07-22 · 공개 응답 record·단일 오류 계층

- 범위: `dto/AirQualityReport`, `dto/AirQualityReading`, `dto/TrafficCameraReport`,
  `dto/TrafficCameraView`, `dto/PointForecastReport`, `dto/PointForecastHour`,
  `dto/StationSeriesSlot`, `dto/NumericSummary`, `exception/PublicServiceException`과
  세 구체 오류, 환경·지도 controller advice.
- 입력 사양: 브라우저가 소비하는 대기질 `dataTime`/`stations`, CCTV `fetchedAt`/`cctvs`,
  지점예보 `baseDate`/`items`, 격자 통계 `min`/`avg`/`max` JSON 스키마와 기존 UTF-8
  400·429·503 텍스트, `Retry-After`, `Cache-Control: no-store` HTTP 계약.
- 설계: 공개 JSON 이름은 각 record component의 `@JsonProperty`로 명시하고 내부에서는
  관측시각, provider, 농도, camera ID, 발표시각처럼 역할이 드러나는 이름을 사용한다.
  응답 목록은 생성 즉시 `List.copyOf`로 고정하고 좌표, 0~48시간 슬롯, 유한 통계 범위를
  생성자에서 거부한다. 사용되지 않던 범용 `WeatherDataDto`를 제거했다. 입력 거부, 요청
  예산 초과, 상류 장애는 sealed `PublicServiceException` 계층의 kind·재시도 시간으로
  통일하고 두 scoped advice가 같은 분류에서 각 API에 맞는 안전한 본문을 만든다.
- 검증: `PublicContractModelTest`가 내부 이름이 JSON에 새지 않는지, null 필드 보존,
  방어적 복사와 값 불변식을 검사한다. `PublicServiceExceptionTest`와 환경·CCTV·지도
  MockMvc 테스트가 failure kind, 최소 retry 시간, 내부 상류 메시지 비노출과 기존 HTTP
  상태·헤더·본문 호환성을 검사한다.
- 명령: `./gradlew test --tests "io.github.easygap.weathergrid.dto.PublicContractModelTest"
  --tests "io.github.easygap.weathergrid.exception.PublicServiceExceptionTest"
  --tests "io.github.easygap.weathergrid.controller.EnvironmentalDataControllerTest"
  --tests "io.github.easygap.weathergrid.controller.TrafficCameraControllerTest"
  --tests "io.github.easygap.weathergrid.controller.WeatherGridControllerTest"
  --tests "io.github.easygap.weathergrid.controller.WeatherLocationControllerTest"`
- 상태: 완료. 기존 DTO 9개와 예외 4개는 새 이름·불변 계약으로 교체됐고, 내용 유사도
  검사에서 새 타입으로 다시 매칭되지 않았다. 추적 후보는 21개에서 8개로 감소했다.

## 2026-07-22 · 단조 시간 기반 요청·갱신 예산

- 범위: `service/WeatherRequestBudget`, `service/MonotonicQuota`,
  `service/ClientAddressPolicy`와 환경·CCTV·지도 컨트롤러 및 상류 캐시 연결.
- 입력 사양: 공개 route별 client 요청 상한, KMA 예보·AirKorea 측정/측정소·ITS CCTV의
  source별 갱신 상한, HTTP 429 `Retry-After`, Cloudflare의 원본 client 주소 전달 계약.
- 설계: 문자열 route와 wall-clock 고정 창을 제거하고 enum으로 한정된 route/source와
  `System.nanoTime` 경과 시간 창을 사용한다. 공개 bucket은 route와 검증된 client 주소의
  조합이며 access-order LRU 상한으로 메모리를 제한한다. 상류 source별 전역 bucket은 서로
  독립적이다. 직접 peer가 설정된 IPv4/IPv6 CIDR에 포함될 때만 `CF-Connecting-IP`를 허용하고,
  DNS 조회가 가능한 hostname·zone ID·손상 IP·`X-Forwarded-For`는 client 식별에 사용하지
  않는다. 잘못된 trusted CIDR 설정은 시작 시 실패한다.
- 검증: `MonotonicQuotaTest`, `ClientAddressPolicyTest`, `WeatherRequestBudgetTest`가 정확한
  창 경계와 초 단위 올림, ticker 역행, 동시 40회 claim, LRU 퇴출, route/client·source 격리,
  IPv4/IPv6 CIDR, 전달 헤더 신뢰 경계를 검사한다. 기존 컨트롤러·캐시 테스트는 typed claim을
  검증하며 전체 Spring context를 포함한 155개 테스트를 통과한다.
- 명령: `./gradlew test`; `node scripts/audit-publication.mjs`.
- 상태: 완료. 기존 요청 제한 구현과 테스트는 제거됐고 새 세 구현·세 테스트로 50% 이상
  rename 재매칭되지 않았다. 추적 후보는 8개에서 6개로 감소했으며 공개 차단 2개는 유지한다.

## 2026-07-22 · 격자 원문 아카이브·파싱 저장소·서버 시작 경계

- 범위: `service/GridDataRepository`, `service/GridRawArchive`, `service/GridArchiveKey`,
  `service/DfsFieldQuality`, `KoreaWeatherGridServer`, `WeatherGridRuntime`과 세 격자 원천 연결.
- 입력 사양: KMA DFS 149×253 텍스트와 KIM NE57 한반도 크롭, 승인 변수·실행/발효시각,
  운영 표출 영역의 물리 범위, 동일 조회 single-flight, 32개 parsed LRU, 14일 원문 보존,
  Spring Boot 자동 설정·component scan·scheduled cleanup 요구사항.
- 설계: DFS/KIM 조회 키는 시각·변수·예측시간을 생성 시 검증해 파일 경로 조각으로 임의 입력이
  들어가지 않게 한다. 파싱 결과 저장소는 조회 키마다 한 leader만 상류 또는 디스크를 읽고,
  결측 치환값까지 포함한 LRU key를 사용한다. 원문 아카이브는 이전 경로를 재사용하지 않는
  `grid-v2`에서 UTF-8 2 MiB 상한을 적용하고, 같은 디렉터리의 임시 파일을 강제 기록한 뒤
  atomic move가 지원될 때만 공개한다. 손상·전체 결측·물리 범위 밖 원문은 폐기하고 재조회한다.
  정리는 UTC 날짜를 파싱할 수 있는 `dfs`/`kim` 소유 디렉터리만 대상으로 하며 다른 이름은
  보존한다. 서버 main과 Spring root configuration도 서로 다른 파일로 분리했다.
- 검증: `GridRawArchiveTest`, `GridDataRepositoryTest`, `DfsFieldQualityTest`가 원자 기록과
  임시 파일 제거, 빈/2 MiB 초과 거부, 보존 경계와 비소유 경로, 8개 동시 miss 통합,
  재시작 후 원문 재사용, 손상 파일 교체, 실제 0, 물리·범주 범위, LRU 상한과 키 거부를
  임시 디렉터리·합성 격자로 검사한다. `ApplicationStartupTest`는 실제 context의 핵심 빈을
  확인하며 전체 156개 테스트가 통과한다.
- 명령: `./gradlew test`; `node scripts/audit-publication.mjs`.
- 상태: 완료. 기존 단일 캐시·테스트와 기존 진입점·빈 테스트는 새 파일로 50% 이상 rename
  재매칭되지 않았다. 추적 후보는 6개에서 5개로 감소했으며 공개 차단 2개는 유지한다.

## 2026-07-22 · DFS·KIM strict ASCII reader와 KIM geometry

- 범위: `util/AsciiNumberStream`, `util/DfsAsciiFieldReader`, `util/KimAsciiCropReader`,
  `util/KimGridGeometry`, KMA text gateway·격자 저장소·KIM 일사 원천 연결.
- 입력 사양: DFS 149×253 남→북·서→동 값 순서와 `-99` 결측, 공백/쉼표 구분자와 `#` 주석;
  KIM NE57 전구 4,320×2,160 좌표식, 고정 한반도 subset `1482,1452,1596,1560`, 응답의
  `i`/`j` 크기 및 `x_min`/`y_min`/`x_max`/`y_max` echo, NC fill·비유한 값 처리.
- 설계: 공통 숫자 스트림은 전체 행 주석만 제외하고 데이터 token을 하나씩 엄격히 소비한다.
  DFS만 쉼표를 구분자로 허용하며 정확히 37,697개를 요구하고, 비유한 값과 `-99` 이하는
  호출자 sentinel로 같은 셀에서 치환한다. KIM reader는 서로 다른 주석 행의 크기와 subset을
  병합하되 중복 header가 상충하면 거부하고 정확히 12,535개를 요구한다. 임의 문자열을
  건너뛰지 않아 뒤 셀 정렬이 바뀌지 않는다. KIM 전구↔crop 좌표 계산은 parser에서 분리한
  `Cell`·`Coordinate` record와 유한값·index 범위 검증으로 제공한다.
- 검증: `DfsAsciiFieldReaderTest`, `KimAsciiCropReaderTest`, `KimGridGeometryTest`가 혼합
  구분자, 남쪽 첫 행, 결측/비유한 위치, 비숫자·초과·부족, 필수/불일치/상충 header, 오류 응답,
  NC fill, 음수 보존, crop 모서리와 좌표 왕복을 합성 fixture로 검사한다. gateway·저장소·KIM
  원천 계약을 포함한 전체 158개 테스트가 통과한다.
- 명령: `./gradlew test`; `node scripts/audit-publication.mjs`.
- 상태: 완료. 기존 두 파서와 테스트는 제거됐고 새 숫자 스트림·reader·geometry로 50% 이상
  rename 재매칭되지 않았다. 추적 후보는 5개에서 3개로 감소했으며 공개 차단 2개는 유지한다.

## 2026-07-22 · 배포 GeoJSON HTTP 계약 테스트

- 범위: `config/PublishedGeodataHttpContractTest`, 두 Natural Earth 파생 GeoJSON과 geodata manifest.
- 입력 사양: 브라우저 공개 경로의 `application/geo+json`, gzip 압축, 1일 public cache와 7일
  stale-while-revalidate, publication manifest에 고정된 byte·SHA-256, GeoJSON/manifest v1 스키마.
- 설계: 한 자산의 문자열 포함 여부만 확인하던 테스트를 제거하고 실제 random-port 서버에서
  두 자산을 parameterized 요청한다. 압축 표현을 해제한 원문 byte에 SHA-256을 다시 계산하고
  type·schema·ID·feature 수를 JSON tree로 검증한다. 별도 manifest 요청은 검증된 두 초기
  자산의 순서와 경로, 아직 자료가 선택되지 않은 `koreaAdmin2` unavailable 항목을 확인한다.
- 검증: `PublishedGeodataHttpContractTest`의 두 자산 case와 manifest case를 포함해 전체
  160개 테스트가 통과한다.
- 명령: `./gradlew test --tests io.github.easygap.weathergrid.config.PublishedGeodataHttpContractTest`;
  `./gradlew test`.
- 상태: 완료. 기존 단일 GeoJSON 테스트는 새 3개 HTTP 계약 case로 50% 이상 rename
  재매칭되지 않았다. 추적 후보는 3개에서 2개로 감소했으며 공개 차단 2개는 유지한다.

## 2026-07-22 · 브라우저 셸 조립 경계 준비

- 범위: `WEB-INF/jsp/weather-grid.jsp`, `WEB-INF/jsp/weather-grid-shell/*.jspf`,
  `cloudflare/jsp-shell.mjs`, Cloudflare 빌드와 Spring/정적 셸 parity 테스트.
- 입력 사양: 상단 탐색, 지도와 오버레이, 설정 패널, +1~+48시간 탐색, 지점·3D 대화상자의
  공개 DOM ID·ARIA 계약과 CSP의 인라인 스크립트 금지, Spring·Cloudflare 동일 자산 요구사항.
- 설계: 670줄 JSP를 문서 head, 주 탐색, 지도 표면, 설정 패널, 시간축·대화상자, script 자산의
  여섯 번역 시점 조각으로 분리했다. JSP scriptlet과 서버 전용 48개 반복 마크업을 제거하고
  서버 발표 메타데이터는 EL data attribute로 전달하되 브라우저가 형식 검증 후 폴백한다.
  정적 조립기는 include 경로를 템플릿 루트 아래로 제한하고 순환 include와 미해결 JSP 구문을
  실패 처리한다. 각 조각은 UTF-8 번역을 명시하며, 데모 상태 표시는 emoji 대신 CSS 도형을 쓴다.
- 검증: `StaticShellParityTest`와 Cloudflare 셸 계약 8개, 조립기 경로·순환 테스트 3개,
  전체 Spring 테스트, Worker 테스트, 실제 Spring JSP를 대상으로 한 Playwright 64개가 통과한다.
- 명령: `./gradlew test`; `npm test --prefix cloudflare`; `npm test --prefix e2e`;
  `node scripts/audit-publication.mjs --mode development`.
- 상태: 구조 경계 준비 완료, 독립 재구현 판정은 미완료. 기존 DOM과 스타일 hook을 보존한
  분해 작업 자체는 독창성 증거로 계산하지 않으며 추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-22 · 브라우저 인터랙션 상태 기반 재구현

- 범위: `static/js/weather-grid-interface-state.js`, `static/js/weather-grid-interface.js`,
  `static/js/weather-grid-ui.js`의 테마·설정 시트·모달·키보드 경계, 두 배포 셸의 script 자산 순서.
- 입력 사양: 허용 테마는 dark/light 두 값, 작은 화면 진입 시 설정 시트 닫기, 모바일 설정 시트와
  모달의 상호 배타성, Escape 닫기, 모달 내부 Tab 순환, 닫힌 표면의 `inert`·`aria-hidden`,
  열기 버튼으로의 안전한 포커스 복귀, skip link가 URL 상태 해시를 오염시키지 않는다는 공개 UX 계약.
  기존 E2E는 사용자 관점 회귀 oracle로만 사용하고 새 모듈의 내부 구조 입력으로 사용하지 않았다.
- 설계: DOM 없는 불변 상태 스냅샷과 `theme/*`, `viewport/change`, `dock/*`, `modal/*` 사건을
  처리하는 순수 전이 함수를 먼저 작성했다. 별도 DOM 어댑터가 상태 결과를 테마 메타데이터,
  토글 ARIA, 모바일 dialog·scrim, background inert ledger와 포커스에 반영한다. 지점·3D 모달은
  닫기 함수를 등록하는 공개 API만 공유하고 지도 데이터나 렌더러에는 접근하지 않는다. 기존 UI
  파일에서는 이 책임과 jQuery backdrop 처리를 제거해 2,029줄에서 1,683줄로 줄였다.
- 검증: 순수 상태 테스트 4개가 잘못된 테마 정규화, 좁은 화면 전환, 모달·설정 시트 상호 배타와
  잘못된 모달 close 무시를 검사한다. 실제 Spring JSP에서 테마 전환, 375×812 설정 dialog의
  포커스·Escape 복귀와 scrim 클릭 닫기, 지점 시계열 모달의 Escape 복귀를 Playwright CLI로 확인했다. 전체
  Spring 159개와 Worker 92개, 실제 브라우저 E2E 64개가 통과했다.
- 명령: `node --test cloudflare/test/interface-state.test.js`; `./gradlew test`;
  `npm test --prefix cloudflare`; `npm test --prefix e2e -- --workers=4`.
- 상태: 접근성 인터랙션 기반은 완료, `weather-grid-ui.js` 전체는 진행 중. 단순 함수명 변경이나
  파일 분할을 완료 근거로 삼지 않으며 추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-22 · 기상 요소 선택과 예보 재생 제어 재구현

- 범위: `static/js/weather-grid-control-state.js`, `static/js/weather-grid-controls.js`,
  `static/js/weather-grid.js`의 공개 시간축 API, `app-bootstrap.js`의 시간 이동 사건,
  `weather-grid-ui.js`의 요소 선택·재생 책임 제거와 두 배포 셸의 자산 순서.
- 입력 사양: 기상 요소 세그먼트와 숨은 select의 단일 선택·`aria-pressed`, 강수 세부 요소 기억,
  요소별 3D·흐름선·등치선 가용성, +1~+48시간 범위, 자동 재생의 3시간 간격, 조회 완료 뒤
  6.2초 대기, 실패·수동 시간 조작·모달 진입 시 중지, 마지막 시간에서 시작할 때 +1시간 순환.
  기존 E2E는 사용자 관점 결과만 회귀 oracle로 사용하고 상태나 함수 구조의 입력으로 사용하지 않았다.
- 설계: DOM 없는 불변 제어 스냅샷과 `metric/select`, `play/*`, `grid/settled`, `timer/fired`
  사건 및 실행 효과를 먼저 작성했다. 브라우저 어댑터는 요소 메타데이터에 따라 세그먼트·세부 그룹·
  3D 버튼을 동기화하고, 재생 버튼·타이머·키보드·수동 이동을 공개 `WeatherGridTimeline` API에만
  연결한다. 시간축은 내부 커서를 음수로 바꾸는 우회 없이 `select`·`move`·`restore` 경계로
  유효 시간을 검사한다. 존재하지 않던 전역 `forecast()` 호출은 명시적인
  `weather-grid:forecast-control` 사건으로 교체했다. 기존 UI 파일은 1,683줄에서 1,516줄로 줄었다.
- 검증: 순수 상태 테스트 8개가 요소 기억, 즉시 +3시간 이동, 완료 후 예약, 마지막 프레임 정지,
  +48시간 시작 순환, 조회 중 대기, 실패·수동 중지를 검사한다. Playwright CLI로 실제 Spring JSP의
  +1→+4 재생, 다음 프레임 뒤 수동 +1시간 중지, 기온 선택의 ARIA·범례·레이어 상태와 콘솔 오류
  부재를 확인했다. Spring 159개와 Worker/정적 셸 100개가 통과했고, 브라우저 64개 중 63개는
  기본 로컬 분당 60회 한도를 쓰면 63개 통과 뒤 한 건이 429로 중지됨을 확인했다. 운영 코드는
  바꾸지 않고 검증 서버의 공개 요청 한도만 1,000회로 설정한 최종 실행에서 64개가 모두 통과했다.
- 명령: `node --test cloudflare/test/control-state.test.js`; `./gradlew test`;
  `npm test --prefix cloudflare`; 검증 서버에
  `WEATHER_GRID_REQUEST_BUDGET_PUBLIC_PER_MINUTE=1000`을 적용한 뒤
  `npm test --prefix e2e -- --workers=4`.
- 상태: 요소 선택·예보 재생 제어 경계는 완료, `weather-grid.js`와 `weather-grid-ui.js` 전체는
  진행 중이다. 추적 후보 2개와 공개 차단 2개는 그대로 유지한다.

## 2026-07-22 · 범례 모델과 공유 URL·도법 선택 상태 재구현

- 범위: `static/js/weather-grid-legend-model.js`, `static/js/weather-grid-legend.js`,
  `static/js/weather-grid-navigation-state.js`, `static/js/weather-grid-navigation.js`,
  `weather-grid-ui.js`의 범례·URL 해시·도법 버튼 책임 제거와 두 배포 셸의 자산 순서.
- 입력 사양: 바람·기온·강수량·신적설·습도·강수형태·하늘상태·파고의 겹치지 않는 구간,
  월별 일사 상한과 지도 팔레트, 유효 격자 수·분포·단위·텍스트 레이블, 작은 화면 범례 접힘과
  `aria-expanded`. 공유 URL은 공개 요소, 10m 고도, 최근 60일, 일 8회 발표시각, +1~+48시간,
  세 도법, heat/stream/iso의 정확한 토큰, 대기질·CCTV·태풍·낙뢰 선택을 고정 순서로 표현한다.
  기존 E2E는 색상·통계·사용자 흐름의 회귀 oracle로만 사용하고 새 내부 구조의 입력으로 쓰지 않았다.
- 설계: 범례 순수 모델은 DOM 없이 구간 경계, count/share, 빈 자료 문구, 접근성 레이블,
  일사 histogram과 접힘 전이를 불변 스냅샷으로 만든다. 별도 어댑터만 범례 DOM을 생성하며
  색상만으로 의미를 전달하지 않고 모든 행에 구간명과 격자 수를 제공한다. 탐색 순수 모델은
  부분 문자열 검사를 제거해 허용 토큰만 복원하고, 존재하지 않는 날짜·미래 발표시각·미지원 고도와
  도법을 현재 안전 상태로 정규화한다. 브라우저 어댑터는 초기 해시를 한 번 해석하고 도법 버튼의
  선택·ARIA와 `weather-grid:projection-requested` 사건만 소유한다. 실제 OpenLayers 뷰·벡터 소스
  재구성은 아직 UI 모듈의 지도 효과로 남겨 상태와 렌더 부작용을 분리했다. 기존 UI 파일은
  1,516줄에서 1,154줄로 줄었다.
- 검증: 범례 모델 7개 테스트가 풍속·강수·습도 경계, 범주형 텍스트, 빈 자료, 월별 일사 10개
  버킷과 반응형 접힘을 검사한다. 탐색 모델 8개 테스트가 허용값 복원, 잘못된 값과 미래 발표시각,
  정확한 레이어 토큰, 범주형 레이어 제한, 구버전 링크, 60일 경계, 고정 순서 직렬화와 빈 해시를
  검사한다. 전체 Spring 159개와 Worker/정적 셸 115개, 검증 서버 한도를 분당 1,000회로 둔
  실제 브라우저 E2E 64개가 모두 통과했다.
- 명령: `node --test cloudflare/test/legend-model.test.js cloudflare/test/navigation-state.test.js`;
  `./gradlew test`; `npm test --prefix cloudflare`;
  `WEATHER_GRID_REQUEST_BUDGET_PUBLIC_PER_MINUTE=1000` 검증 서버에서
  `npm test --prefix e2e -- --reporter=line`.
- 상태: 범례와 공유 URL·도법 선택 상태 경계는 완료했다. 실제 도법 뷰 재구성 등
  `weather-grid.js`·`weather-grid-ui.js`의 나머지 지도 효과는 진행 중이며, 추적 후보 2개와
  공개 차단 2개는 그대로 유지한다.

## 2026-07-22 · 도법 뷰 효과와 좌표·격자 리드아웃 재구현

- 범위: `static/js/weather-grid-map-state.js`, `static/js/weather-grid-projection.js`,
  `static/js/weather-grid-readout.js`, `weather-grid.js`의 최소 지도 runtime 경계,
  `weather-grid-ui.js`의 OpenLayers 뷰 교체·기본 벡터 재투영·포인터 리드아웃 책임 제거.
- 입력 사양: 허용 도법은 KMA LCC·EPSG:3857·EPSG:4326 세 값, 전환 전 보이던 지리 범위 보존,
  동아시아 이동 제한, 현재 화면을 기준으로 한 다섯 줌 단계와 위험기상의 2.5 최소 줌,
  GeoJSON의 EPSG:4326 원본 좌표, 대표 지점·인프라 재투영, DFS 격자의 남쪽 기준 좌표와
  북쪽부터 저장된 응답 행, 포인터 위경도·요소별 값·단위 텍스트, 60ms 갱신 제한을 공개 계약으로
  삼았다. 기존 E2E는 도법별 렌더 결과와 사용자 흐름의 회귀 oracle로만 사용했다.
- 설계: 순수 지도 모델은 도법 요청의 허용·변경 여부, fit 뒤 줌 한계, 분수 격자의 최근접 열·
  남쪽 행과 북→남 배열 index, 격자 밖·손상 응답, 색상에 의존하지 않는 리드아웃 문구를 불변
  결과로 만든다. 도법 어댑터는 navigation 사건을 받아 뷰를 교체하고, 최소 runtime API를 통해
  기본 지도·행정 경계·대표 지점을 재투영한다. 인프라처럼 후속 기능이 소유한 레이어는 등록형
  reprojector로 결합해 내부 변수를 공유하지 않는다. 전환 중 `aria-busy`, 완료·실패 사건과 선택
  복구를 제공한다. 리드아웃 어댑터는 `innerHTML` 없이 안전한 텍스트 노드를 만들고 위치·값·단위를
  `aria-label`로 제공하며, 드래그·격자 밖·요소 변경·도법 전환에서는 즉시 숨긴다. 기존 UI 파일은
  1,154줄에서 1,055줄로 줄었다.
- 검증: 순수 모델 8개 테스트가 도법 허용/재선택/거부, 일반·위험기상 줌, 남북 행 변환,
  step 격자 반올림, 격자 밖·손상·typed array와 접근성 문구를 검사한다. Playwright CLI에서 실제
  지도에 포인터를 올려 좌표와 `1.8 m/s` 값을 확인하고, 메르카토르 전환 뒤 URL·선택 ARIA·
  `aria-busy=false`·리드아웃 초기화 및 콘솔 오류 부재를 확인했다. 전체 Spring 159개,
  Worker/정적 셸 123개와 실제 브라우저 E2E 64개가 모두 통과했다.
- 명령: `node --test cloudflare/test/map-state.test.js`; `./gradlew test`;
  `npm test --prefix cloudflare`; Playwright CLI named session의 `snapshot`·`hover`·`click`·`eval`·
  `console error`; `WEATHER_GRID_REQUEST_BUDGET_PUBLIC_PER_MINUTE=1000` 검증 서버에서
  `npm test --prefix e2e -- --reporter=line`.
- 상태: 실제 도법 뷰·기본 레이어 재투영과 좌표 리드아웃 경계는 완료했다. 인프라 레이어·
  탐색 문맥·3D 연결 등 UI의 나머지 지도 효과는 진행 중이며, 추적 후보 2개와 공개 차단 2개는
  그대로 유지한다.

## 2026-07-23 · 주요 지점 인프라 상태·벡터 선택 재구현

- 범위: `static/js/weather-grid-infrastructure-state.js`,
  `static/js/weather-grid-infrastructure.js`, `static/js/infra.js`, 주요 지점 설정 마크업과
  `weather-grid.js`의 지점 예보 요청 사건, `weather-grid-ui.js`의 기존 인프라 책임 제거.
- 입력 사양: 대교·공항·항만은 서로 독립적으로 표시하고 데이터가 없는 종류는 활성화하지 않는다.
  지도 표식은 색상만으로 구분하지 않고 세 가지 코드 기반 도형과 이름을 사용하며, 라벨은 도법과
  무관하게 800 m/px 미만에서만 표시한다. 토글은 네이티브 `aria-pressed`와 44px 최소 터치 영역을
  갖고, 클릭 또는 지도 Enter 입력은 보이는 피처 하나의 이름·검증된 대표 좌표로 예보를 연다.
  도법·테마 전환 뒤에도 피처 수와 가시성을 보존한다. 기존 E2E는 결과 회귀에만 사용했다.
- 설계: DOM 없는 불변 모델이 데이터 가용성, 종류별 표시 전이와 효과, 도법 단위 환산, 이름·좌표
  정규화 및 다이아몬드·삼각형·사각형 심벌 계약을 소유한다. 브라우저 어댑터는 OpenLayers
  `RegularShape`와 CSS 의미 토큰으로 점·선과 라벨을 만들고, 각 피처를 공용 오버레이 라우터의
  `infrastructure` 종류로 등록한다. 선택은 `weather-grid:location-forecast-requested` 사건으로
  차트 경계에 전달해 기존 UI 내부 함수나 지도 전역 변수에 직접 결합하지 않는다. 등록형 재투영과
  테마 사건이 소스와 스타일을 다시 만들며 버튼 상태는 모델 효과에서만 갱신한다. 이 과정에서
  안내와 달리 기존 인프라 피처 클릭이 예보 경로에 도달하지 못하던 결함도 해결했다. 기존 UI
  파일은 1,055줄에서 906줄로 줄었다.
- 검증: 순수 상태 테스트 8개가 초기 가용성, 독립 토글, 중복·잘못된 사건, 색상 외 도형,
  도법 단위 라벨 임계값, 이름·좌표 경계를 검사한다. Playwright CLI에서 실제 Spring JSP의
  12개 대교·15개 공항·11개 항만 피처, 종류별 `RegularShape`, 세 버튼 ARIA, 44px 높이,
  Enter로 이순신대교 예보 모달 열기, EPSG:3857 재투영 뒤 가시성·개수 보존, light 테마에서
  의미 색상 재계산을 확인했다. 같은 계약과 벡터 표식 직접 클릭을 새 브라우저 회귀 테스트 3개로
  고정했다. 전체 Spring 159개, Worker/정적 셸 132개, 실제 브라우저 E2E 67개와 development 공개 감사 247개 파일이
  통과했다.
- 명령: `node --test cloudflare/test/infrastructure-state.test.js`; `./gradlew test`;
  `npm test --prefix cloudflare`; Playwright CLI named session의 `snapshot`·`click`·`press`·
  `eval`·`screenshot`; `npm test --prefix e2e -- --reporter=line tests/infrastructure.spec.js`;
  `WEATHER_GRID_ENV_REQUESTS_PER_MINUTE=1000` 검증 서버에서
  `npm test --prefix e2e -- --reporter=line`; `node scripts/audit-publication.mjs --mode development`.
- 상태: 주요 지점 상태·렌더·선택 경계는 완료했다. 탐색 문맥·3D 연결 등 UI의 나머지 효과는
  진행 중이며, 추적 후보 2개와 공개 차단 2개는 그대로 유지한다.

## 2026-07-23 · 탐색 문맥과 3D 연결 상태 재구현

- 범위: `static/js/weather-grid-explore-state.js`, `static/js/weather-grid-explore.js`,
  `static/js/weather-grid-view3d-state.js`, `static/js/weather-grid-view3d.js`, 두 배포 셸의 자산
  순서와 `weather-grid-ui.js`의 기존 탐색·3D 책임 제거.
- 입력 사양: 바람·기온·강수·일사·위험기상 빠른 보기와 기상·대기질·교통 영역은 요소,
  색상면·흐름선·등치선, 대표 지점, 배경지도, 대기질·CCTV·태풍·낙뢰 상태를 결정적으로
  선택한다. 비기상 영역에서 기상으로 돌아오면 마지막 기상 보기를 복구하며, 위험기상 진입 전
  지도 중심·축척은 도법과 reduced-motion 설정에 맞게 복구한다. 3D는 지원 요소와 조회 결과가
  있을 때만 열고, 지연 로딩 중 보이는 진행 상태, 중복 없는 모듈 요청, 10초 안내, Escape 닫기,
  모달 포커스 순환·복귀, 실제로 보이던 2D 바람장만 재개하는 계약을 사용한다.
- 설계: 탐색 순수 모델이 모드별 설명·시간 문맥·데이터 영역과 요소·레이어·배경지도·환경
  오버레이 실행 계획을 불변 결과로 계산하고, 현재 화면 조합에서 표준 모드 또는 사용자 설정을
  추론한다. 별도 어댑터만 OpenLayers 뷰 스냅샷, 환경 서비스, DOM 텍스트·ARIA와 공유 URL을
  갱신한다. 3D 순수 모델은 `idle/loading/open` 전이, 표시 플래그, 오류 문구와 흐름선 복구 조건을
  계산한다. 어댑터는 취소 불가능한 `import()` 요청 하나를 유지하고 로딩 버튼 문구·`aria-busy`,
  geodata 준비, 모달 열기·닫기와 자원 해제를 명시적으로 수행한다. DOM class 변경을 감시하던
  `MutationObserver`는 제거했다. 기존 UI 파일은 906줄에서 351줄로 줄었다.
- 검증: 탐색 모델 9개 테스트가 고정 카탈로그, 모드별 실행 계획, 작은 화면, 환경 우선 추론,
  요소별 문맥, 데이터 영역 왕복과 해상·부가 요소 기억을 검사한다. 3D 모델 5개 테스트가 단일
  로딩 효과, 성공·닫기 대칭, 실패 재시도, 흐름선 복구와 명시적 모달 계약을 검사한다. 첫 전체
  E2E에서 강수형태 뒤 상대습도 선택 시 순수 모델의 동결 레이어를 실행 전역에 직접 전달해
  기존 렌더러가 중단되는 경계를 발견했고, 어댑터가 가변 실행 스냅샷으로 복사하도록 수정한 뒤
  해당 회귀와 전체 검사를 다시 통과했다. Playwright CLI에서는 기온→대기질→기상 왕복,
  3D 캔버스 포커스, Escape 닫기와 열기 버튼 포커스 복귀를 확인했다. 전체 Spring 159개,
  Worker/정적 셸 146개와 실제 브라우저 E2E 67개가 모두 통과했다.
- 명령: `node --test cloudflare/test/explore-state.test.js cloudflare/test/view3d-state.test.js`;
  `./gradlew test`; `npm test --prefix cloudflare`; Playwright CLI의 `snapshot`·`click`·`press`·
  `screenshot`; `WEATHER_GRID_ENV_REQUESTS_PER_MINUTE=1000` 검증 서버에서
  `npm test --prefix e2e`.
- 상태: 탐색 문맥과 3D 연결 경계는 완료했다. `weather-grid-ui.js`에는 레이어 표현,
  발표시각 이동과 공유 URL 실행 효과가 남아 있다. development 공개 감사는 253개 파일을
  통과했고 release 감사는 의도한 publication manifest와 루트 `LICENSE` 두 차단만 보고한다.
  추적 후보 2개와 공개 차단 2개는 유지한다.

## 2026-07-23 · 지도 표현·발표 이동·공유 URL 실행 경계 재구현

- 범위: `static/js/weather-grid-layer-state.js`, `static/js/weather-grid-layers.js`,
  `static/js/weather-grid-run-state.js`, `static/js/weather-grid-runs.js`,
  `static/js/weather-grid-session.js`, 탐색·3D 소비자와 두 배포 셸의 자산 순서. 기존
  `static/js/weather-grid-ui.js`는 모든 책임 이전을 마치고 제거했다.
- 입력 사양: 색상면·바람 흐름선·등치선은 서로 독립적으로 선택하되, 흐름선은 바람에서만
  사용할 수 있고 강수형태·하늘상태처럼 등치선이 성립하지 않는 범주형 요소는 색상면을
  필수로 사용한다. 발표는 KST 02·05·08·11·14·17·20·23시의 3시간 주기이며 자정을 넘어
  이동하고, 최신 발표 이후와 최신 발표를 기준으로 60일 이전에는 이동하지 않는다. 공유 URL은
  허용된 요소·날짜·발표·예보시간·도법·레이어·환경 상태만 복원하고 복원 도중 발생하는 요소
  사건은 조회하지 않으며 최종 상태에서 한 번만 조회한다.
- 설계: 레이어 순수 모델이 세 레이어의 불변 스냅샷, 요소별 가용성, 토글·교체·요소 전이를
  계산한다. 어댑터는 지도 내부 컬렉션을 검색하지 않고 공개 runtime의 기상 래스터 참조만 받아
  래스터·범례·등치선·입자 효과와 `disabled`·`aria-disabled`·`aria-pressed`를 함께 갱신한다.
  발표 순수 모델은 KST epoch 왕복, 3시간 이동, 60일 경계와 날짜 clamp를 DOM 없이 계산하고,
  어댑터는 이전·최신·다음과 날짜·발표 버튼을 단일 조회 사건에 연결한다. 세션 어댑터는 검증된
  navigation 상태를 요소·발표·시간축·레이어·환경·도법 순으로 적용하며 복원 플래그로 중간
  조회와 해시 쓰기를 억제한다. 탐색과 3D는 가변 전역 레이어 객체 대신 동결된 공개 스냅샷을
  소비한다.
- 검증: 새 순수 모델 테스트 11개가 기본 상태, 비바람 흐름선, 범주형 필수 색상·등치선 차단,
  허용 토글, 잘못된 사건, KST 자정 왕복, 잘못된 날짜·시각, 3시간 이동, 최신·60일 경계와
  날짜 clamp를 검사한다. Playwright CLI에서 색상 토글의 URL 반영, 기온 전환의 흐름선 차단,
  `pty + EPSG:3857 + f=7` 딥링크 복원과 `v=heat` 정규화, 08→05시 이전 발표 이동,
  최신·다음 버튼 ARIA와 콘솔 오류 부재를 확인했다. 전체 Spring 159개,
  Worker/정적 셸 157개, 실제 브라우저 E2E 67개가 통과했고 development 공개 감사는
  259개 파일을 통과했다.
- 명령: `node --test cloudflare/test/layer-state.test.js cloudflare/test/run-state.test.js`;
  `./gradlew test`; `npm test --prefix cloudflare`; Playwright CLI named session의
  `snapshot`·`click`·`goto`·`console error`; 새 검증 서버에서 `npm test --prefix e2e`;
  `node scripts/audit-publication.mjs --mode development`; `node scripts/audit-publication.mjs --release`.
- 상태: 기존 통합 UI 파일은 제거했고 레이어 표현·발표 이동·공유 URL 실행 경계는 완료했다.
  `weather-grid.js`의 데이터 조회·래스터·스트림라인 실행 경계와 JSP 시맨틱 재작성은 계속
  추적한다. release 감사는 의도한 publication manifest와 루트 `LICENSE` 두 차단만 보고하며,
  추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-23 · 격자 요청·응답 생명주기 재구현

- 범위: `static/js/weather-grid-data-state.js`, `static/js/weather-grid-data.js`,
  `weather-grid.js`의 지도 렌더 runtime 경계와 두 배포 셸의 자산 순서.
- 입력 사양: 공개 격자 요청은 바람·기온·강수량·강수형태·신적설·상대습도·하늘상태·파고·
  일사강도 중 하나, 10m 고도, 최신 발표를 기준으로 최근 60일 안의 KST 02·05·08·11·14·
  17·20·23시, +1~+48시간만 허용한다. query 순서는 발표일·발표시각·요소·고도·발효시간으로
  고정하고, 새 조회는 진행 중 전송을 취소하며 늦은 이전 응답은 화면에 반영하지 않는다.
  정상 격자는 차원·원점·간격·값 수를 확인하고, 빈 자료·손상 응답·HTTP 429·네트워크 실패·
  35초 시간 초과는 서로 구분하되 모든 종료 경로가 로딩과 재생 상태를 정리해야 한다.
- 설계: DOM 없는 상태 모델이 선택 검증, 요청 정규화·직렬화, 증가 순번과
  `start/succeeded/failed/completed` 전이를 불변 상태와 명시적 효과로 계산한다. 브라우저
  어댑터만 `fetch`·`AbortController`·타이머를 소유하고 화면 초기화, 정상 표시, 빈 자료 복구,
  오류와 `weather-grid:grid-settled` 사건을 최소 렌더 runtime에 전달한다. 기존 jQuery AJAX,
  요청 전역 순번·XHR 참조, 중복 선택 검증과 암묵적 월 전역을 제거했다. 초기 조회는 jQuery
  준비 타이머 대신 네이티브 `DOMContentLoaded`에서 시작해 가상 시계와 병렬 브라우저에서도
  결정적으로 실행한다. `weather-grid.js`는 2,303줄에서 2,195줄로 줄었다.
- 검증: 새 순수 상태 테스트 7개가 정상 query, 미지원 선택, 첫 요청 효과, 이전 전송 취소와
  오래된 응답 폐기, 성공 완료, 빈 자료·손상 응답, 시간 초과·429 문구를 검사한다. 핵심
  브라우저 16개와 앞서 병렬 초기화가 지연됐던 4개를 별도로 통과시킨 뒤, localhost 한 IP를
  공유하는 테스트 러너에만 공개 요청 예산을 분당 1,000회로 둔 전체 E2E 67개가 통과했다.
  운영 기본 60회와 429 응답 계약은 변경하지 않았고 Spring 테스트가 별도로 검사한다. 전체
  Spring 159개, Worker/정적 셸 165개와 development 공개 감사 262개 파일이 통과했다.
- 명령: `node --test cloudflare/test/data-state.test.js`; `./gradlew test`;
  `npm run build --prefix cloudflare`; `npm test --prefix cloudflare`;
  `--weather-grid.request-budget.public-per-minute=1000` 검증 서버에서 `npm test --prefix e2e`;
  `node scripts/audit-publication.mjs --mode development`;
  `node scripts/audit-publication.mjs --release`.
- 상태: 격자 선택·전송·응답 생명주기 경계는 완료했다. 래스터 표본·풍장 실행과 지점 조회,
  JSP 각 조각의 시맨틱 재작성은 계속 추적한다. release 감사는 의도한 publication manifest와
  루트 `LICENSE` 두 차단만 보고하며, 추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-23 · 격자 래스터 표본·캐시·렌더 경계 재구현

- 범위: `static/js/weather-grid-raster-state.js`, `static/js/weather-grid-raster.js`,
  `weather-grid.js`의 지도 runtime과 두 배포 셸의 자산 순서.
- 입력 사양: 출력 Canvas는 약 12만 표본을 목표로 최소 2 CSS 픽셀 간격의 균일 표본을 만들고,
  각 표본을 현재 화면 도법에서 위경도로 역변환한 뒤 공식 DFS 분수 좌표의 최근접 셀로 연결한다.
  응답 배열은 북쪽 행부터 저장되므로 남쪽 기준 행을 반전한다. 최근 화면 LUT는 화면 extent,
  해상도, OpenLayers·기기 pixel ratio, 출력·표본 크기, 도법, 격자 원점·간격·차원과 테마가 모두
  같을 때만 재사용한다. 현재 데이터와 요소별 색상은 LUT에 넣지 않고 매 렌더마다 다시 읽으며,
  범주형 요소에는 최소·평균·최대 통계를 만들지 않는다.
- 설계: 순수 래스터 모델이 표본 계획, 결정적 캐시 키, 북→남 배열 index, 유효값 통계와
  `rgb/rgba` 바이트 변환을 DOM 없이 계산한다. 브라우저 어댑터만 OpenLayers `ImageCanvas`,
  지도 runtime의 도법·DFS 변환, 가장자리 알파, typed-array LUT와 Canvas 확대를 소유한다.
  회귀 진단에서 사용하던 캐시 통계·키 전역 이름은 얇은 호환 래퍼로 유지하되 구현과 상태는
  어댑터 안으로 옮겼다. `weather-grid.js`의 인라인 LUT·통계·색상 파서·Canvas 루프를 제거하고
  `render/clear` runtime 호출만 남겨 파일을 2,195줄에서 2,016줄로 줄였다.
- 검증: 새 순수 모델 테스트 5개가 640×480·QHD 표본 계획, 캐시 조건별 무효화, 남북 행 변환,
  결측 제외 통계·범주형 통계 차단과 안전한 CSS 색상 변환을 검사한다. 실제 브라우저에서는
  LCC·메르카토르·위경도에서 서울·부산·제주·백령도·울릉도·목포의 API 셀과 렌더 픽셀 색이
  일치했고, 줌 10·기온·일사, 같은 뷰 재사용, 데이터 변경, 테마 무효화가 통과했다. 전체 Spring
  159개, Worker/정적 셸 171개, 실제 브라우저 E2E 67개가 통과했고 development 공개 감사는
  265개 파일을 통과했다.
- 명령: `node --test cloudflare/test/raster-state.test.js`; `npm run build --prefix cloudflare`;
  `npm test --prefix cloudflare`; `./gradlew test`; 검증 서버에
  `WEATHER_GRID_REQUEST_BUDGET_PUBLIC_PER_MINUTE=1000`을 적용한 뒤
  `npm test --prefix e2e -- --workers=4`; `node scripts/audit-publication.mjs --mode development`;
  `node scripts/audit-publication.mjs --release`.
- 상태: 래스터 표본·캐시·OpenLayers 렌더 경계는 완료했다. 풍장 실행과 지점 조회,
  JSP 각 조각의 시맨틱 재작성은 계속 추적한다. release 감사는 의도한 publication manifest와
  루트 `LICENSE` 두 차단만 보고하며, 추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-23 · 2D 풍장 Canvas·애니메이션 생명주기 재구현

- 범위: `static/js/weather-grid-wind-state.js`, `static/js/weather-grid-wind.js`,
  `weather-grid.js`의 풍장 runtime 연결과 두 배포 셸의 자산 순서.
- 입력 사양: 2D 풍장은 구조가 검증된 10m U/V 벡터장이 있고 현재 요소가 바람이며 흐름선
  레이어가 켜지고 3D가 닫힌 경우에만 실행한다. Canvas CSS 크기는 지도와 1:1로 유지하고
  backing store는 기기 DPR을 따르되 8MP를 넘지 않는다. 지도 이동 시작에는 즉시 정지·페이드하고
  종료 0.08초 뒤 마지막 extent에서 한 번 재시작하며, resize는 지도 크기를 갱신하고 0.14초 뒤
  재시작한다. 레이어·3D 중단은 원본장과 인스턴스를 보존하고 새 조회·페이지 종료는 렌더러와
  Canvas를 폐기한다.
- 설계: 순수 풍장 모델이 `field/set`, `field/clear`, `view/start`, `view/end`,
  `viewport/resize`, `render/request`, `render/suspend`, `page/hide` 사건을 불변 상태와 명시적
  효과로 계산하며 화면 크기·DPR에서 Canvas 계획을 만든다. 브라우저 어댑터만 Canvas 생성,
  `Windy` 검증·인스턴스, OpenLayers extent·projection, 이동·resize 리스너와 재시작 타이머를
  소유한다. 기존 `refreshStreamlines`, `suspendStreamlines`, `clearStreamlines`,
  `getWindDiagnostics`, `lastWindField`는 레이어·3D·E2E 호환 경계로 유지했다. 코어의 풍장 전역,
  jQuery resize, Canvas·렌더러 생성과 RAF 재시작 블록을 제거해 `weather-grid.js`를 2,016줄에서
  1,880줄로 줄였다. 함께 발견한 일사 응답의 미정의 월 변수는 검증된 요청 날짜에서 계산하도록
  수정했다.
- 검증: 새 순수 모델 테스트 6개가 모바일 DPR 3, 4K·8K 메모리 상한, 요소·레이어·3D 표시 조건,
  벡터장 교체, 이동·resize 디바운스, 중단과 완전 폐기를 검사한다. 풍장 집중 Playwright 11개가
  모바일·노트북·데스크톱·QHD·4K·8K Canvas, 3D 진입·resize·복구, 연속 줌 애니메이션 중 중단과
  기존 렌더러 한 번 재시작을 통과했다. 전체 Spring 159개, Worker/정적 셸 178개, 실제 브라우저
  E2E 67개가 통과했고 development 공개 감사는 268개 파일을 통과했다.
- 명령: `node --test cloudflare/test/wind-state.test.js`; `npm run build --prefix cloudflare`;
  `npm test --prefix cloudflare`; `./gradlew test`; 검증 서버에
  `WEATHER_GRID_REQUEST_BUDGET_PUBLIC_PER_MINUTE=1000`을 적용한 뒤
  `npm test --prefix e2e -- --workers=1 tests/viewport-streamline.spec.js`와
  `npm test --prefix e2e -- --workers=4`; `node scripts/audit-publication.mjs --mode development`;
  `node scripts/audit-publication.mjs --release`.
- 상태: 2D 풍장 Canvas·애니메이션 경계는 완료했다. 지점 조회와 JSP 각 조각의 시맨틱 재작성은
  계속 추적한다. release 감사는 의도한 publication manifest와 루트 `LICENSE` 두 차단만
  보고하며, 추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-23 · 지점 시계열·지도 좌표 범위 조회 재구현

- 범위: `static/js/weather-grid-location-state.js`, `static/js/weather-grid-location.js`,
  `weather-grid.js`의 지도·검색 진입점과 두 배포 셸의 자산 순서.
- 입력 사양: 지점 요청은 선택 이름 80자 이하, 유효한 위·경도, 공개 기상 요소, 10m 고도,
  KST 02·05·08·11·14·17·20·23시 발표를 사용하고 좌표를 소수 넷째 자리로 정규화한다.
  바람·기온·일사는 별도 시계열 endpoint를 사용하고, 강수량·강수형태·신적설·상대습도·
  하늘상태·파고는 상세예보 응답의 같은 48시간 슬롯을 카드와 차트가 공유한다. 새 지점 또는
  지도 좌표 조회는 진행 중 전송을 취소하고 늦은 이전 응답을 무시한다. 시계열은 20초,
  지도 범위 확인은 12초 안에 끝내며 정상·범위 밖·취소·시간 초과·일반 실패를 구분한다.
- 설계: 순수 위치 모델이 이름·좌표 정규화, 시계열·범위 query, 상세예보 공유 여부와 두 독립
  요청 채널의 `start/succeeded/failed/completed/cancel` 전이를 불변 상태·효과로 계산한다.
  브라우저 어댑터만 `fetch`·`AbortController`·타이머, 상세예보/차트 준비의 병렬 조정, 모달
  로딩·오류·한 번 쓰는 재시도 버튼, 좌표 팝업의 화면 경계 배치를 소유한다. 대표 지역 검색,
  인프라 선택과 지도 클릭은 코어의 얇은 진입점을 통해 어댑터에 전달하며 기존
  `WEATHER_GRID_CANCEL_POINT_LOOKUP` 사건 계약은 유지했다. 코어의 두 요청 순번·컨트롤러,
  직접 fetch와 차트 오류 DOM을 제거해 `weather-grid.js`를 1,880줄에서 1,626줄로 줄였다.
- 검증: 순수 모델 테스트 8개가 좌표 정규화, 일반·공유 요소 query, 미지원 선택 거부, 범위 query,
  새 요청 취소·이전 응답 폐기, 성공·오류·취소·완료와 오류 문구를 검사한다. 지점 집중 E2E 10개가
  상세예보·대기질 독립성, 신적설 한 요청 공유, 시계열·상세예보 시간 초과와 재시도, SVG 차트,
  인프라 키보드·클릭 선택을 통과했다. 새 좌표 E2E는 지원 범위 안의 반올림 좌표·팝업과 범위 밖
  안내·이전 팝업 제거를 검사한다. 전체 Spring 159개, Worker/정적 셸 187개, 실제 브라우저 E2E
  68개가 통과했고 development 공개 감사는 272개 파일을 통과했다.
- 명령: `node --test cloudflare/test/location-state.test.js`; `npm run build --prefix cloudflare`;
  `npm test --prefix cloudflare`; `./gradlew test`; 검증 서버에
  `WEATHER_GRID_REQUEST_BUDGET_PUBLIC_PER_MINUTE=1000`을 적용한 뒤 지점 관련 Playwright 10개,
  `npm test --prefix e2e -- --workers=1 tests/location-flow.spec.js`,
  `npm test --prefix e2e -- --workers=4`; `node scripts/audit-publication.mjs --mode development`;
  `node scripts/audit-publication.mjs --release`.
- 상태: 지점 시계열·지도 좌표 범위 요청 경계는 완료했다. 기본 지도 부트스트랩·팔레트·검색
  표면과 JSP 각 조각의 시맨틱 재작성은 계속 검토한다. release 감사는 의도한 publication
  manifest와 루트 `LICENSE` 두 차단만 보고하며, 추적 후보 2개와 공개 차단 2개를 유지한다.

## 2026-07-23 · 기상 팔레트·기본 지도·대표 지역 검색 재구현

- 범위: `static/js/weather-grid-palette-state.js`, `static/js/weather-grid-basemap-state.js`,
  `static/js/weather-grid-map-bootstrap.js`, `static/js/weather-grid-search-state.js`,
  `static/js/weather-grid-search.js`, `weather-grid.js`와 두 배포 셸의 자산 순서.
- 입력 사양: 기상 요소 계약은 요소별 단위·범주 여부·유효 물리 범위와 풍속, 기온, 1시간
  강수량, 신적설, 상대습도, 강수형태, 하늘상태, 파고, 월별 일사강도의 결정적 색상 경계를
  제공한다. 지도 backing store는 화면·기기 DPR 중 큰 CSS 면적을 기준으로 12MP 예산을
  넘지 않으며, 화면 폭 네 구간의 초기 여백과 일반·좁은 화면의 한반도 초기 영역을 사용한다.
  배경은 기상 중심·행정 경계·도로 세 모드이고 행정 경계 진입은 지역 라벨을 켜고 도 경계를
  끈 상태에서 시작한다. 대표 지역 검색은 NFKC 정규화 뒤 공백과 대소문자를 무시하고 유효한
  전 지구 위·경도 후보 중 입력 순서를 보존한 최대 20개를 제시한다. 검색 버튼과 제안 없는
  Enter는 정확히 일치하는 이름만 선택하고 방향키는 후보의 처음과 끝을 순환한다.
- 설계: 순수 팔레트 모델이 메타데이터·값 검증·표시 문자열·색상을 하나의 불변 API로 제공해
  래스터·범례·3D·지점 차트가 같은 함수를 사용한다. 순수 배경지도 모델은 픽셀 비율, 초기
  영역·여백, 모드·경계·라벨·대표 지역 상태와 테마 스타일 계획을 계산한다. OpenLayers
  부트스트랩만 도법 등록, 지도·레이어 생성, OSM, GeoJSON 지연 로드, 벡터 대표 지점 스타일,
  테마와 지도 클릭을 소유하고 최소 `WeatherGridMapRuntime`을 공개한다. 순수 검색 모델은
  정규화·후보·정확 일치·키보드 index·상태 문구를 계산하며 DOM 어댑터만 combobox, 좌표
  팝오버, Escape·외부 클릭·포커스 복귀와 위치 조회 API 연결을 소유한다. 코어에서 지도 생성,
  지오데이터, 벡터 지점, 팔레트 본문, 배경지도와 검색 DOM을 제거해 `weather-grid.js`를
  1,626줄에서 594줄로 줄였다.
- 검증: 팔레트 8개, 배경지도 7개, 검색 7개의 새 순수 테스트가 전체 경계값, 25단계 월별 일사,
  범주 코드, 물리 범위, 불변 모드 전이, 모바일~8K 픽셀 예산, 화면별 여백, 후보 정규화·상한과
  키보드 순환을 검사한다. 정적 셸 계약은 상태→지도 부트스트랩→코어와 위치 조회→검색
  상태→검색 어댑터의 순서를 확인하고 코어에 OpenLayers 생성·지오데이터 로딩·검색 DOM이
  남지 않았음을 검사한다. 새 브라우저 테스트 2개가 배경지도 레이어·ARIA·테마와 combobox
  제안·Enter 선택, 좌표 팝오버 Escape·포커스 복귀를 검사한다. 전체 Spring 159개,
  Worker/정적 셸 211개, 실제 브라우저 E2E 70개가 통과했고 development 공개 감사는
  281개 파일을 통과했다.
- 명령: `node --test cloudflare/test/palette-state.test.js cloudflare/test/basemap-state.test.js
  cloudflare/test/search-state.test.js`; `npm run build --prefix cloudflare`;
  `npm test --prefix cloudflare`; `./gradlew test`; 검증 서버에
  `WEATHER_GRID_ENV_REQUESTS_PER_MINUTE=1000`을 적용한 뒤
  `npm test --prefix e2e -- --workers=1 tests/map-shell.spec.js tests/geodata-loading.spec.js
  tests/legend-consistency.spec.js tests/projection-accuracy.spec.js tests/location-flow.spec.js`,
  `npm test --prefix e2e -- --workers=4`; `node scripts/audit-publication.mjs --mode development`;
  `node scripts/audit-publication.mjs --release`.
- 상태: 브라우저 runtime의 기본 지도·팔레트·대표 지역 검색 경계까지 완료해 코어 조정 계층을
  완료 판정했다. 다음 독립 재구현 대상은 JSP 조각의 시맨틱 DOM 사양이다. release 감사는
  publication manifest와 루트 `LICENSE` 두 차단이 해결될 때까지 공개를 막는다.

## 2026-07-23 · JSP 시맨틱 애플리케이션 셸 재구현

- 범위: `WEB-INF/jsp/weather-grid.jsp`, `weather-grid-shell/*.jspf`, 검색 DOM 어댑터,
  공통 reset/style, Cloudflare 정적 셸과 접근성·동등성 브라우저 계약.
- 입력 사양: 문서에는 한 개의 서비스 제목과 명명된 main이 있고 지도 region은 그 제목을
  공유한다. 대표 지역 검색과 위경도 검색은 서로 중첩되지 않은 독립 form이어야 하며 combobox
  제안·상태·submit 동작을 유지한다. 범례·예보 시간축·모바일 데이터 탐색에는 구분 가능한
  landmark 이름이 있어야 한다. 설정의 관련 선택지는 fieldset/legend로 묶고, 지점 상세와
  3D 화면은 제목·모달 여부·열기 제어가 연결된 dialog여야 한다. 데스크톱 설정은 보조 영역,
  모바일 설정은 열려 있는 동안만 modal dialog로 전환한다.
- 설계: 서버·정적 배포가 공유하는 여섯 JSP 조각의 ID·기능 경계는 유지하되 태그 구조를 공개
  접근성 요구사항에서 다시 정의했다. 대표 지역 검색을 submit form으로 만들고 좌표 dialog를
  형제 form으로 분리했으며 검색 어댑터가 form submit을 단일 진입점으로 처리한다. main,
  지도, 범례 stack과 각 범례, 예보 시간축은 숨은 제목과 `aria-labelledby`로 명명했다.
  지도 선택 팝업은 제목이 있는 aside로, 설정 묶음은 fieldset/legend로, 지점·3D 화면은
  labelled dialog section으로 구성했다. reset은 fieldset·legend 기본 여백을 제거하고 기존
  클래스 기반 레이아웃은 그대로 적용되도록 legend 폭만 명시했다.
- 검증: 정적 셸 테스트는 Spring JSP와 생성된 Cloudflare 문서의 ID·자산 버전뿐 아니라 main,
  search form 비중첩, 범례·시간축 landmark, 설정 fieldset/legend, 두 modal dialog 계약과
  문맥 팝업의 불필요한 `role=region` 제거를 검사한다. 실제 Chromium은 데스크톱 landmark와
  모바일 fieldset 이름, 설정 modal 전환·inert·포커스, 검색·좌표 팝오버, 3D·차트, 모바일~8K
  레이아웃을 검사했다. 전체 Spring 159개, Worker/정적 셸 212개, E2E 70개가 통과했다.
- 명령: `npm run build --prefix cloudflare`; `npm test --prefix cloudflare`;
  `./gradlew test`; 검증 서버를 8090에서 실행한 뒤 `npm test --prefix e2e -- --workers=4`;
  `node scripts/audit-publication.mjs --mode development`;
  `node scripts/audit-publication.mjs --release`; `git diff --check`.
- 상태: 추적한 애플리케이션 재구현 항목은 모두 완료해 publication manifest의 애플리케이션
  차단을 제거했다. 저장소는 권리 귀속 검토와 루트 `LICENSE` 결정이 끝날 때까지 계속
  `blocked`이며, 기술적 재작성은 비침해에 대한 법적 보증을 대신하지 않는다.

## 2026-07-23 · 공개 경계·원격 저장소 마감 감사

- 범위: GitHub 원격 ref와 공개 루트, 로컬 푸시 보호, 추적 파일의 Secret·이전 프로젝트
  식별자, 의존성 취약점, Worker 배포 구성, 알려진 기능 공백과 공개 차단 문서.
- 원격 감사: `origin`은 `easygap/korea-weather-grid`를 가리키며 저장소는 private이다.
  원격에는 `main` 한 브랜치와 승인된 `Initial public release` 루트 한 커밋만 있고 태그,
  release, issue, PR, fork는 없었다. 공개 루트의 GitHub Actions `품질 게이트`도 성공했다.
  루트 작성자·커미터는 모두 GitHub 계정에 연결된 신원임을 값 노출 없이 확인했다.
- 로컬 보호: 추적된 `.githooks/pre-push`가 실제 동작하도록
  `core.hooksPath=.githooks`, `push.default=simple`을 저장소 로컬 설정에 적용했다. hook은
  승인된 공개 루트 전송을 허용하고 로컬 archive 브랜치 전송은 거부했다. 작성자 설정도
  승인된 공개 루트의 GitHub noreply 신원과 일치시켰다. 이어서 공개 감사에
  `--ref=<commit>` 모드를 추가해 worktree가 아니라 실제 전송할 commit tree의 전체 파일,
  고지, manifest, 자산 해시와 금지 경로를 읽도록 했다. pre-push와 GitHub Actions는 이
  모드를 사용하며 Node 또는 감사 실패 시 push를 fail-closed로 거부한다.
- 공개 파일 감사: 로컬 Secret 파일은 ignore되고 추적되지 않았으며, 제1자 소스에서
  placeholder·이전 회사 식별자·금지 차트 런타임을 찾지 못했다. 공개 감사 스크립트는
  단일 승인 루트, 추적·미추적 파일, 금지 경로, 하드코딩 키, 제3자 고지와 자산 해시를
  계속 검사한다. `CONTRIBUTING.md`와 PR template에는 허용 입력, 비공개 자료 금지,
  공개 사양 기반 독립 구현, 합성 fixture, 외부 라이선스·원문 URL 기록과 제출 권한 확인을
  명시했으며 공개 감사가 두 파일의 누락을 차단한다.
- 감사 규칙: 금지 경로·차트, 일반 키 대입과 GitHub·AWS·Google·개인키 Secret 지표,
  로컬 denylist 해석을 `publication-rules.mjs`로 분리하고 합성 테스트 5개를 pre-push와
  CI에서 실행한다. 첫 테스트가 `.gitignore`는 허용하지만 기존 감사는 거부하던
  `.env.example` 불일치를 찾아, 정확한 예제 파일만 허용하고 다른 `.env*`는 계속 차단하도록
  수정했다. 실제 이전 회사·프로젝트 식별자는 공개하지 않고 ignore된 로컬 목록에서만
  대소문자 없는 literal로 검사하며 실패 시 일치어가 아닌 파일 경로만 출력한다.
- 알려진 제한: 검증된 최신·전국·재배포 가능 원천을 아직 선정하지 않은
  `koreaAdmin2` 경계·선택을 현재 기능 공백으로 분리했다. 실 Secret·상류 자료·CCTV HLS가
  필요한 검증은 RC 운영 조건이며, 사람의 권리 귀속 검토와 루트 `LICENSE`는 공개 차단이다.
  세 범주는 `docs/known-limitations.md`에서 따로 관리하고 공개 감사가 문서와 지오데이터
  manifest의 일치를 검사한다.
- 배포 사전 검증: Cloudflare·E2E·지오데이터 도구의 `npm audit`은 취약점 0건이었고,
  지오데이터 크기·SHA-256 검사와 Worker build가 통과했다. Wrangler 4.113.0
  `deploy --dry-run`은 86개 자산, Worker 129.25 KiB(gzip 32.31 KiB)와 예상한 KV,
  rate-limit, assets binding을 확인했다. compatibility date는 `2026-07-20`이다.
- GitHub 보호: 현재 private 저장소 요금제에서는 branch protection과 repository ruleset
  API가 모두 403을 반환했다. 공개 전에는 commit-tree pre-push 감사와 Actions로 보완하고,
  public 전환 승인 직후 required status checks와 force-push 금지를 설정하는 절차를
  공개 준비 문서와 출시 체크리스트에 남겼다. Actions·Gradle·세 npm workspace는 매주
  그룹 업데이트하는 Dependabot 설정으로 추적한다. Dependabot alerts와 automated
  security fixes는 저장소에 활성화하고 API에서 각각 204와 `enabled:true`를 확인했다.
  현재 열린 Dependabot alert는 0개였다.
  public 저장소에서만 가능한 private vulnerability reporting은 전환 승인 직후 활성화한다.
  public 저장소의 자동 secret scanning·사용자 push protection과 가능한 저장소 수준
  push protection도 같은 시점에 확인한다.
  `SECURITY.md`에는 advisory 기반 비공개 신고, Secret 우선 폐기, 합성 재현과 회귀·롤백
  기록 원칙을 정했다. `.gitattributes`와 `.editorconfig`는 텍스트 LF·배치 CRLF를 고정한다.
- 명령: `gh api`; `git ls-remote --heads --tags origin`;
  `node scripts/audit-publication.mjs --mode development`;
  `npm audit --prefix cloudflare --audit-level=high`; `npm audit --prefix e2e --audit-level=high`;
  `npm run check --prefix tools/geodata`; `npm audit --prefix tools/geodata --audit-level=high`;
  `npm run build --prefix cloudflare`; `npx wrangler deploy --dry-run`.
- 상태: 애플리케이션과 원격 공개 이력의 기술 감사는 완료했다. 저장소는 private이며,
  `project-license-awaits-rights-review`와 루트 `LICENSE` 결정이 끝날 때까지
  `releaseStatus: blocked`를 유지한다. 공개 전환은 별도 명시적 작업이다.

## 2026-07-23 · Kakao 도로 배경지도 기능 진단

- 증상 확인: 설정의 `도로` 배경지도를 실제 Chromium에서 선택하면 UI 상태와 OpenLayers
  레이어 가시성은 `streets`로 정상 전환되고 콘솔 오류는 없다.
- 원인: 현재 `weather-grid-map-bootstrap.js`의 도로 레이어는 `ol.source.OSM`이며 source
  URL도 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`다. 저장소에는 Kakao SDK,
  JavaScript 앱 키 설정, Kakao 타일·SDK URL, 등록 도메인 또는 CSP 허용값이 없다. 따라서
  Kakao 요청 실패가 아니라 독립 재구현 과정에서 OSM으로 대체된 미구현 기능이다.
- 브라우저 근거: 도로 선택 뒤 OpenStreetMap 타일 요청은 모두 200이었고 Kakao 도메인
  요청은 0건이었다. `WeatherGridMapBootstrap.snapshot()`은 `mode: streets`,
  `streetTileLayer.getSource().getUrls()`는 OpenStreetMap URL을 반환했다.
- 공식 입력 조건: Kakao Map Web SDK는 JavaScript 키, 해당 키에 등록된 JavaScript SDK
  도메인, Map API 활성화를 요구한다. 실제 서비스와 미리보기 도메인·사용량 조건이 정해지기
  전에는 비공식 타일 URL을 연결하지 않는다.
- 상태: `docs/known-limitations.md`와 재구현 백로그에 별도 기능 공백으로 추가했다. 현재
  대안인 OpenStreetMap 도로지도는 정상 동작한다. Kakao 구현은 키·등록 도메인이 준비된 뒤
  공식 SDK 기반 독립 어댑터와 실제 도메인 브라우저 테스트로 진행한다.

## 2026-07-23 · Kakao 공식 SDK 독립 어댑터 구현

- 설정 경계: 저장소 밖 JavaScript 키를 `KAKAO_MAP_JAVASCRIPT_KEY`로 주입하고 Spring과
  Worker가 동일한 `/api/runtime/map-config` no-store 계약을 제공한다. 32자리 16진수 형식만
  허용하며 로그·JSP·정적 셸에는 키를 넣지 않는다.
- 독립 구현: `weather-grid-kakao-state.js`가 설정·확대 수준·좌표 계획을 계산하고,
  `weather-grid-kakao.js`가 공식 `dapi.kakao.com/v2/maps/sdk.js`만 동적으로 불러온다.
  OpenLayers 뷰의 중심·해상도·도법 교체를 Kakao 지도와 동기화하고 기존 기상 레이어는
  OpenLayers에 유지한다. 문서화되지 않은 Kakao 타일 URL은 사용하지 않는다.
- 실패 정책: 키 누락, 설정 응답 실패, SDK timeout·403이면 `streets` 모드는 OSM을 계속
  표시하며 버튼의 공급자 이름과 live status를 함께 갱신한다.
- 콘솔 확인: Kakao Developers 앱에는 활성 JavaScript 키와 공개 서비스,
  `localhost:8090`, `127.0.0.1:8090`, Worker 미리보기용 8787 도메인이 등록돼 있다.
  다만 `카카오맵 → 사용 설정`은 OFF여서 등록 도메인에서도 SDK가 403을 반환했다.
  외부 설정 변경과 사용량 조건 승인이 필요한 항목이므로 임의로 켜지 않고 RC 검증 대기로
  분류했다.
- 검증: Spring 164개와 Worker·정적 셸 218개가 통과했다. 실제 Chromium은 Kakao SDK 성공
  응답을 제어해 활성화·뷰 동기화·OSM 숨김·종료를 검증하고, 실제 키에서는 Map API OFF의
  403을 OSM으로 대체했다. 전체 E2E 71개를 병렬 실행할 때 기존 기온·일사·4K 풍장 3개가
  로컬 서버 부하로 시간 초과했으나 실패 항목을 단일 워커로 재실행해 모두 통과했다.

## 2026-07-24 · VWorld 벡터 도로 배경지도 전환

- 입력과 권한: 개인 VWorld 키에 2D 지도·배경지도·WMTS/TMS API를 허용했다. 키는
  `VWORLD_API_KEY` 환경변수로만 주입하고 저장소·화면 문서·로그에는 원문을 넣지 않는다.
  운영 키에는 RC와 운영 도메인 제한을 유지한다.
- 공식 API 확인: VWorld 벡터 지도 가이드의 `{z}/{x}/{y}` 순서를 실제 키로 확인했다.
  Base PNG와 traffic·POI PBF, 벡터 스타일 응답이 모두 200이었다. 비공식 URL이나 VWorld
  JavaScript SDK 복사본은 사용하지 않는다.
- 독립 구현: `weather-grid-vworld-state.js`가 UUID 설정과 공식 타일 URL을 계산하고,
  `weather-grid-vworld.js`가 OpenLayers 10.9의 XYZ·MVT로 Base와 벡터 도로를 같은 지도에
  올린다. MVT는 보이는 타일을 최대 24개만 읽어 현재 도법의 일반 벡터 피처로 변환한다.
  전국 축척에서는 Base만 사용하고 지역 확대 시 벡터 도로를 추가한다. 기상 격자·흐름선·
  경계 레이어는 기존 사용자 정의 도법에 유지한다. Kakao 전용 SDK, 컨테이너, CSP origin,
  런타임 계약은 제거했다.
- 실패와 출처: 키 누락·형식 오류·probe 실패·지역 확대 PBF 전체 실패에서는 OSM으로 자동
  전환한다. 지도에 VWorld 출처 링크를 상시 표시하고 `THIRD_PARTY_NOTICES.md`에
  [API 정책](https://www.vworld.kr/v4po_prcint_a001.do)과
  [저작권 정책](https://www.vworld.kr/v4po_prcint_a006.do)을 연결했다.
- 검증: Spring 전체 테스트와 Worker·정적 셸 218개, VWorld 지도 E2E 3개가 통과했다.
  1440×900 실제 Chromium의 지역 확대 화면에서 PBF 12건이 모두 200이었고 도로 피처
  9,400개를 현재 도법으로 렌더링했다. 실패 요청과 콘솔 오류는 0건이었다. 활성 상태,
  Base·벡터 레이어, OSM 숨김, VWorld 출처와 실제 화면 캡처를 함께 확인했다. 같은 소스를
  비운영 `public-readiness` Worker 프리뷰에 올린 뒤 실제 RC 도메인에서도 같은 PBF 응답,
  피처 수, OSM 상태와 오류 0건을 재확인했다.

## 2026-07-24 · DFS LCC 정의와 등치선 가공 보완

- 입력 사양: 기상청 단기예보 5 km DFS 문서의 구면 반지름 `6,371,008.77 m`, 표준위도
  30°·60°, 기준 경도·위도 126°E·38°N, 기준 격자 `(43, 136)`과 공개된 네 모서리
  위경도를 기준으로 삼았다.
- 좌표계 정의: `weather-grid-dfs-projection.js`가 DFS 정·역변환과 Proj4 문자열을 한곳에서
  관리한다. OpenLayers용 LCC는 구면 `+R`, 기준 위도 38°, 기준 격자에 해당하는 false
  easting `215,000 m`·northing `680,000 m`를 사용하므로 격자 좌표에 5 km를 곱한 값과
  Proj4 결과가 일치한다. 바람 LUT·지도 리드아웃·등치선도 같은 모듈만 사용한다.
- 등치선 가공: `weather-grid-isoline-state.js`로 Marching Squares, 결측 인지 가우시안
  스무딩, 선 연결, Chaikin 스무딩을 분리했다. 대각선 값이 교차하는 5·10번 안장점은
  bilinear asymptotic decider로 연결 방향을 정하고, 결측 셀과 맞닿은 값은 평균하지 않아
  바다·자료 경계를 가로지르는 가짜 선을 만들지 않는다. 열린 선의 끝점과 닫힌 선의 이음새는
  각각 보존하며 범주형·알 수 없는 요소에는 등치선을 생성하지 않는다.
- 유지보수 경계: 계산 모듈은 DOM·OpenLayers를 모르며 `isoline.js`는 유효 응답 확인,
  피처 생성, 현재 도법 변환과 스타일만 담당한다. 공개 계산식의 이유와 경계 조건만 한국어
  주석으로 남기고 요소별 단계값과 스무딩 횟수는 순수 모듈에서 관리한다.
- 검증: 공식 기준점·네 모서리, 분수 격자 왕복, Proj4 미터 좌표 일치, 잘못된 입력,
  안장점 양쪽 연결, 결측 경계, 닫힌 선, 한 셀짜리 열린 선, 요소별 단계값과 조회 교체 중
  빈 응답을 Node 테스트로 고정했다. Worker·정적 셸 231개와 Spring 164개가 통과했다.
  실제 Chromium에서 LCC→메르카토르→위경도→LCC를 전환해 각 화면이 등치선 47개·정점
  1,657개와 같은 첫 위경도 `(127.8973109, 36.9482650)`를 유지했고 콘솔 오류는 0개였다.

## 2026-07-29 · 외부 API 키와 브라우저 경계 보강

- 범위: Worker·Spring의 VWorld 런타임 설정과 타일 경계, 업스트림 URL 검증, 브라우저 CSP,
  Jackson·Netty 관리 버전.
- 설계: Spring의 `/api/runtime/map-config`는 키 대신 고정된 `/api/map/vworld` 경로만
  반환한다. 타일 프록시는 `base` PNG와 `traffic` PBF의 정해진 경로·확대 단계·국내 인접
  범위만 허용하고 응답 종류와 실제 바이트 상한을 확인한다. 자격 증명 URL이 포함될 수 있는
  상류 예외 원인은 보존하거나 로그에 남기지 않는다. Cloudflare RC에서는 VWorld 원점의
  edge 요청이 502로 거부됨을 확인해 실패하는 프록시를 배포하지 않고, 키를 읽지 않는
  비활성 런타임 계약으로 OSM 대체를 즉시 선택한다.
- 전송 정책: 운영 HTTP 요청은 HTTPS로 308 전환하고 HSTS를 적용한다. 자격 증명을 쓰는
  Java 업스트림 주소는 절대 HTTPS URL만 허용한다. CSP에서 사용하지 않는 VWorld 직접
  연결과 CCTV 8082 포트를 제거하고, 요소 스타일과 스타일 속성 권한을 분리했다.
- 의존성: Jackson BOM 3.1.5와 Netty 4.2.16.Final로 공개 취약점 수정 버전을 고정했다.
- 검증: Spring 계약 테스트는 런타임 키 비노출, 허용 타일 중계, 잘못된 경로·쿼리·지역·
  응답 종류·크기 거부와 오류 내용 비노출을 검사한다. Worker 계약 테스트는 키가 있어도
  비활성 설정만 반환하고 VWorld 경로를 외부로 중계하지 않는지, HTTPS·CSP 정책을 검사한다.

## 2026-08-05 · 위험기상 실데이터 형식과 CCTV 부분 장애 처리

- 입력 사양: 기상청 태풍 경로의 EUC-KR 본문, `TYP_TM(UTC)` 헤더, 긴 구분선과 레코드 종료
  기호를 실제 응답으로 확인했다. 기상특보는 공공데이터포털 기상청_기상특보 조회서비스의
  `getPwnStatus` JSON 계약을 사용한다. CCTV는 화면을 나눈 여러 ITS 요청 중 일부만 성공할
  수 있는 상류 장애를 입력 조건에 포함했다.
- 설계: 태풍 본문은 Content-Type에 선언된 문자셋을 크기 제한 안에서 해석하고 헤더와 종료
  기호를 정규화한 뒤 기존 공개 계약으로 변환한다. 특보 JSON은 응답 크기·resultCode·건수와
  필수 필드를 검증하고 가장 최근 발효 상태를 기존 스냅샷 계약으로 정규화한다. CCTV 전역
  차단기는 실시간 요청이 모두 실패한 경우에만 열어 부분 성공 결과와 다른 지역 조회를 막지
  않는다.
- 실패 정책: 잘못된 문자셋·본문 크기·JSON 구조·상류 상태 코드는 기존 안전 스냅샷을
  유지하고, 유효한 실시간 결과가 하나라도 있으면 실패한 타일만 부분 장애로 표시한다.
- 검증: 현재 태풍 응답 2개 계통과 기상특보 4개 그룹, KIM 입력 지점 49개, ITS HLS
  master·variant·H.264 1920×1080 스트림을 실제 상류에서 확인했다. Spring 172개,
  Worker·정적 셸 238개, 실제 Chromium E2E 81개가 모두 통과했다.
