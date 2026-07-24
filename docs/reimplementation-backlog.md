# 독립 재구현 백로그

이 문서는 기능 누락과 재구현 상태를 공개 전에 추적한다. `pending` 파일은 현재 동작하더라도
독립 구현으로 승인하지 않는다. 과거 로컬 이력과의 Git rename 유사도는 우선순위를 찾는 보조
신호일 뿐 법률 판단이나 독창성 판정이 아니다.

2026-07-22 최초 감사에서 46개 파일이 rename 후보로 검출됐다. 공공데이터포털·ITS gateway와
계약 테스트를 교체한 뒤 42개, KMA 격자·지점 gateway, 발표시각, 49시간 슬롯을
분리하고 기존 `KmaApiService`와 두 테스트를 제거한 뒤 39개, CCTV 원문 해석·셀 캐시·
공개 응답을 분리한 뒤 37개, 지점 상세예보와 AirKorea 원문·캐시·응답 경계를 분리한 뒤
27개, 환경 REST 요청 정책·오류 매핑·기능별 컨트롤러를 분리한 뒤 25개가 남았다.
지도 페이지·격자·통계·좌표·시계열 HTTP 경계를 분리한 뒤에도 25개였고, 790줄 지도 서비스를
DFS 바람·DFS 스칼라·KIM 일사·응답·지점 경계로 교체하고 기존 서비스 테스트 3개를 새 계약
테스트 7개로 교체한 뒤 21개가 남았다. 기존 DTO 9개와 예외 4개를 공개 JSON 이름이 명시된
불변 도메인 record와 단일 예외 계층으로 교체한 뒤 8개가 남았다. 아래 항목을 모두 새 공개
사양과 합성 fixture에서 다시 작성하고, 공개 요청·상류 갱신 예산을 단조 시간 기반 세 모듈과
새 테스트로 교체한 뒤 6개가 남았다. 격자 캐시를 검증된 키·원자적 원문 아카이브·bounded
메모리 저장소·품질 정책으로 분리하고 서버 실행기와 런타임 설정을 분리한 뒤 5개가 남았다.
DFS/KIM 파서를 strict 숫자 스트림·제품별 reader·독립 KIM geometry와 새 합성 테스트로
교체한 뒤 3개가 남았다. GeoJSON 서버 테스트를 두 자산의 압축 byte·해시·스키마·캐시
계약을 확인하는 새 HTTP 통합 테스트로 교체한 뒤 2개가 남았다. JSP는 여섯 책임 조각과
검증된 정적 조립기로 분해하고 scriptlet·서버 전용 시간 슬롯 반복을 제거한 뒤, 공개 UX와
접근성 요구사항에서 검색 form, 명명된 지도·범례·시간축 landmark, 설정 fieldset/legend,
제목에 연결된 popup·dialog 구조를 다시 작성했다. 정적 셸 동등성 및 실제 브라우저 계약까지
통과해 추적 중인 애플리케이션 재구현 항목은 모두 완료했다. Git 유사도 후보 수 2개는 안정된
브라우저 ID·문구·스타일 계약 때문에 남는 보조 신호이며 완료나 권리 판단의 근거로 사용하지
않는다. `docs/publication-manifest.json`에서는 애플리케이션 차단을 해제했지만, 프로젝트
권리 귀속 검토와 루트 라이선스 결정은 별도 공개 차단으로 유지한다.

## 완료된 독립 경계

| 영역 | 상태 | 근거 |
|---|---|---|
| KMA DFS 투영 | complete | KMA 공개 격자 사양, `KmaDfsProjectionTest` |
| Spring HTTP·정적 자산·브라우저 정책 설정 | complete | Spring 공식 문서, 분리된 필터 테스트 |
| 지점 차트 | complete | 외부 런타임 없는 자체 SVG 렌더러 |
| 파비콘·지도 미리보기 | complete | 저장소에서 새로 작성한 SVG |
| 시도·육지 GeoJSON | complete | Natural Earth 원본 고정 및 결정적 생성기 |
| 지점 상세예보·AirKorea | complete | 공개 JSON 필드, 독립 정규화·캐시·응답 조립 테스트 |
| 환경 REST API | complete | Spring MVC 공개 계약, 주입 가능한 시각 정책·기능별 컨트롤러·공통 오류 테스트 |
| 지도 REST API | complete | 페이지·격자/통계·좌표/시계열 분리, query·요소·예산·오류 MockMvc 테스트 |
| 지도 격자·지점 도메인 | complete | DFS/KIM 공개 제품, 공통 공간 창, 원천별 정규화·응답 조립·지점 시계열 합성 테스트 |
| 공개 응답 모델·오류 계층 | complete | 명시적 JSON 이름·불변 컬렉션·값 불변식 record, 단일 typed failure와 scoped HTTP 응답 테스트 |
| 요청·갱신 예산 | complete | typed route/source, 단조 시간 창, trusted proxy CIDR·bounded LRU·동시성 경계 테스트 |
| 격자 원문 아카이브·메모리 저장소 | complete | 검증된 DFS/KIM 키, 2 MiB 상한, atomic-only publish, 날짜 정리, single-flight·LRU·값 품질 테스트 |
| 서버 실행·런타임 설정 | complete | 프로세스 launcher와 Spring root configuration 분리, 핵심 독립 빈 startup 테스트 |
| DFS·KIM ASCII 제품 해석 | complete | strict 숫자 token, 고정 크기, KIM header·subset 검증, 좌표 geometry와 합성 fixture 테스트 |
| 공개 GeoJSON HTTP 계약 | complete | 두 배포 자산의 gzip·MIME·cache, byte·SHA-256·스키마·feature 수와 manifest 통합 테스트 |
| 주요 지점 인프라 레이어 | complete | 불변 표시 상태, 종류별 코드 기반 벡터 도형, 도법·테마 재구성, 클릭·키보드 예보 선택을 Node·실제 브라우저로 검증 |
| 탐색 문맥·3D 연결 | complete | 모드별 실행 계획과 문맥, 데이터 영역 왕복, 3D 로딩·모달·2D 스트림 복구를 순수 상태와 기능별 어댑터로 분리해 Node·실제 브라우저로 검증 |
| 지도 표현·발표 이동·URL 세션 | complete | 레이어 가용성, KST 3시간 발표·60일 경계, 복원 중 조회 억제를 순수 모델과 기능별 어댑터로 분리하고 기존 통합 UI 파일 제거 |
| JSP 시맨틱 애플리케이션 셸 | complete | 검색 form, 명명된 main·범례·시간축, fieldset/legend 설정 그룹, labelled dialog를 Spring/Cloudflare 정적 계약과 데스크톱·모바일 브라우저로 검증 |

## P0 · 서버 공개 계약과 외부 연동

| 대상 | 상태 | 독립 입력 사양 및 완료 조건 |
|---|---|---|
| `controller/EnvironmentalDataController.java`, `controller/TrafficCameraController.java`, `controller/HazardStatusController.java` | complete | 공개 REST 요청·응답·캐시 계약, 기능별 의존성 경계와 MockMvc 합성 테스트 |
| `controller/PublicRequestPolicy.java`, `controller/PublicApiExceptionHandler.java` | complete | 단일값 query allowlist, KST 발표+10분·60일·좌표·24셀 경계, UTF-8 400·429·503 테스트 |
| `controller/MapPageController.java`, `controller/WeatherGridController.java`, `controller/WeatherLocationController.java` | complete | 페이지 모델, 격자/통계와 좌표/시계열 공개 계약, 독립 rate-limit bucket 테스트 |
| `controller/WeatherMapRequestPolicy.java`, `controller/WeatherMapExceptionHandler.java` | complete | 필수·선택 query allowlist, 발표·요소·고도·leadHours·좌표·상세예보 라우팅과 UTF-8 오류 테스트 |
| `integration/PublicDataGateway.java` | complete | 공공데이터포털 공식 명세, endpoint enum·4 MiB 제한·합성 JSON 계약 테스트 |
| `integration/TrafficCameraGateway.java` | complete | ITS 공식 명세, 고정 HTTPS HLS query·viewport·2 MiB 제한 테스트 |
| `integration/KmaTextGateway.java` | complete | KMA APIHub DFS·KIM 표준화 NC 명세, 고정 제품·시각·크기·인코딩 계약 테스트 |
| `integration/KmaPointForecastGateway.java` | complete | KMA 동네예보 공식 JSON 계약, 격자·발표시각 allowlist·2 MiB 제한·합성 테스트 |
| `integration/VillageForecastFeed.java` | complete | 공공데이터포털 단기예보 공식 필드, 단일 격자·1,000행 완전성·문자열 경계 테스트 |
| `integration/AirQualityFeed.java` | complete | AirKorea 실시간 측정·측정소 공식 필드, 페이지 완전성·1시간 등급·좌표 검증 테스트 |
| `integration/TrafficCameraFeed.java` | complete | ITS `datacount`/`data` 공식 필드, HTTPS HLS URL·좌표·문자열 경계 계약 테스트 |
| `service/ForecastReleaseClock.java` | complete | KST 일 8회 발표·10분 지연, 주입 가능한 시계의 경계 시각 테스트 |
| `service/StationForecastService.java` | complete | 불변 예보값에서 49개 슬롯 조립, 0/결측 구분·LRU·실패 미캐싱 테스트 |
| `service/PointForecastTimeline.java`, `service/AirQualitySnapshotCache.java`, `service/AirQualityService.java`, `service/EnvironmentalDataService.java` | complete | 49시간 슬롯·실제 0/결측·LRU, 측정/측정소 분리 캐시·single-flight·stale 상한·지역 중복 측정소 결합 테스트 |
| `service/CctvTileCache.java`, `service/CctvService.java` | complete | 0.25° 셀·24셀 제한·single-flight·stale/backoff·중복/범위/상한 테스트 |
| `service/MapService.java`, `service/WeatherGridService.java`, `service/WeatherStationSeriesService.java` | complete | 지도 facade, 격자 응답/통계, 지점 시계열 계약을 분리하고 원천 서비스만 의존 |
| `service/DfsWindGridSource.java`, `service/DfsScalarGridSource.java`, `service/KimSolarGridSource.java` | complete | DFS WSD/UUU/VVV·7개 스칼라·KIM dswrsfc의 결측, 물리 범위, 이전 런, 시간 해상도, 데모 정책 테스트 |
| `service/WeatherGridWindow.java`, `service/WeatherGridDataset.java` | complete | north-to-south 표본 순서, step별 실제 경계, 원천 독립 정규 격자 계약 테스트 |

## P1 · 도메인 모델·캐시·파서

| 대상 | 상태 | 독립 입력 사양 및 완료 조건 |
|---|---|---|
| `KoreaWeatherGridServer.java`, `WeatherGridRuntime.java` | complete | 프로세스 실행과 root configuration·스케줄 활성화를 분리하고 실제 핵심 빈을 적재하는 startup 테스트 |
| `dto/AirQualityReport.java`, `dto/AirQualityReading.java`, `dto/TrafficCameraReport.java`, `dto/TrafficCameraView.java` | complete | 기존 JSON 이름을 annotation으로 고정하고 내부 이름, 좌표 불변식, 방어적 컬렉션 복사를 새로 설계 |
| `dto/PointForecastReport.java`, `dto/PointForecastHour.java`, `dto/StationSeriesSlot.java`, `dto/NumericSummary.java` | complete | 발표·시간 슬롯·통계 JSON 계약과 내부 지점 모델을 불변 record로 교체, 미사용 `WeatherDataDto` 제거 |
| `exception/PublicServiceException.java`, `exception/RequestRejectedException.java`, `exception/RequestThrottledException.java`, `exception/UpstreamUnavailableException.java` | complete | REJECTED·THROTTLED·UPSTREAM_UNAVAILABLE 단일 계층, 안전 메시지·retry 시간·scoped 400/429/503 매핑 테스트 |
| `service/WeatherRequestBudget.java`, `service/MonotonicQuota.java`, `service/ClientAddressPolicy.java` | complete | 공개 route·상류 source별 독립 예산, 단조 시간 창, trusted peer에서만 전달 주소 허용, bounded LRU·동시성 테스트 |
| `service/GridDataRepository.java`, `service/GridRawArchive.java`, `service/GridArchiveKey.java`, `service/DfsFieldQuality.java` | complete | 검증된 키, 원문 2 MiB 상한, atomic move 실패 시 memory-only, 날짜 보존, bounded LRU·single-flight·물리 범위 테스트 |
| `util/AsciiNumberStream.java`, `util/DfsAsciiFieldReader.java` | complete | 주석 행·쉼표/공백·정확한 149×253 값 수, 결측·비유한 값 위치 보존, 비숫자·초과/부족 fail-closed 테스트 |
| `util/KimAsciiCropReader.java`, `util/KimGridGeometry.java` | complete | 필수 크기·subset header 병합, 115×109 strict 본문, fill 정규화, 좌표 왕복·범위 테스트 |

## P2 · 브라우저 셸

| 대상 | 상태 | 독립 입력 사양 및 완료 조건 |
|---|---|---|
| `static/js/weather-grid.js` | complete | 시간축과 조회 결과 표시를 기능별 공개 runtime에 연결하는 594줄 조정 계층만 유지. 지도 생성·지오데이터·팔레트·검색·네트워크·Canvas·레이어 효과는 소유하지 않음을 정적 계약으로 검증 |
| `static/js/weather-grid-palette-state.js` | complete | 공개 요소 메타데이터, 물리 범위, 범주 레이블, 풍속·기온·강수·적설·습도·강수형태·하늘·파고·월별 일사 색상을 DOM 없는 단일 계약으로 작성하고 경계값을 Node·브라우저로 검증 |
| `static/js/weather-grid-basemap-state.js`, `static/js/weather-grid-map-bootstrap.js` | complete | 12MP 픽셀 예산, 반응형 초기 영역·여백, 세 배경지도와 경계·라벨·대표 지역 전이를 불변 모델로 작성. OpenLayers 생성, OSM·GeoJSON, 벡터 지점·테마·클릭 효과를 어댑터로 분리하고 모바일~8K·세 도법으로 검증 |
| `static/js/weather-grid-search-state.js`, `static/js/weather-grid-search.js` | complete | NFKC·공백·대소문자 정규화, 유효 좌표 후보, 최대 20개 부분 검색·정확 선택·순환 키보드 index를 순수 모델로 작성. combobox ARIA, 좌표 팝오버·포커스·위치 조회 연결은 DOM 어댑터로 분리 |
| `static/js/weather-grid-data-state.js`, `static/js/weather-grid-data.js` | complete | 요소·10m·KST 발표·60일·+1~+48시간 검증, 고정 query, 순번·취소·성공·빈 자료·오류·완료 전이를 불변 모델로 작성. fetch·35초 중단·지도 runtime 효과를 분리하고 Node·실제 브라우저로 검증 |
| `static/js/weather-grid-raster-state.js`, `static/js/weather-grid-raster.js` | complete | 표본 예산·LUT 키·남북 셀 index·수치 통계·CSS 색상 해석을 순수 모델로 작성. OpenLayers ImageCanvas, 도법 변환, 경계 알파와 최근 뷰 캐시는 별도 어댑터로 분리하고 세 도법·경계 섬·테마 무효화를 Node·실제 브라우저로 검증 |
| `static/js/weather-grid-wind-state.js`, `static/js/weather-grid-wind.js` | complete | 8MP Canvas 계획, 요소·레이어·3D 표시 조건, 벡터장 교체·중단·이동·resize·폐기 전이를 순수 모델로 작성. Windy 인스턴스·OpenLayers 뷰·디바운스·호환 진단 API를 별도 어댑터로 분리하고 모바일~8K·3D·연속 줌을 Node·실제 브라우저로 검증 |
| `static/js/weather-grid-location-state.js`, `static/js/weather-grid-location.js` | complete | 이름·좌표·요소·10m·발표시각 정규화, 고정 query, 지점 차트와 지도 범위의 독립 순번·취소·성공·오류·완료 전이를 순수 모델로 작성. 상세예보 공유, fetch·시간 제한·차트/팝업 효과를 별도 어댑터로 분리하고 Node·실제 브라우저로 검증 |
| `static/js/weather-grid-interface-state.js`, `static/js/weather-grid-interface.js` | complete | 키보드·모바일·접근성 요구사항에서 테마·설정 시트·모달의 순수 전이와 DOM 어댑터를 작성하고 Node·실제 브라우저로 검증 |
| `static/js/weather-grid-control-state.js`, `static/js/weather-grid-controls.js` | complete | 요소 기억과 재생 순서를 불변 전이·실행 효과로 작성하고 DOM 어댑터는 공개 시간축 사건만 사용. Node·실제 브라우저로 검증 |
| `static/js/weather-grid-legend-model.js`, `static/js/weather-grid-legend.js` | complete | 공개 요소 메타데이터와 색상 함수에서 구간·분포·빈 자료·접힘 상태를 계산하는 순수 모델 및 텍스트·ARIA를 포함한 DOM 어댑터를 Node·브라우저로 검증 |
| `static/js/weather-grid-navigation-state.js`, `static/js/weather-grid-navigation.js`, `static/js/weather-grid-session.js` | complete | 공유 URL의 정확한 토큰·60일·발표시각·도법·레이어 정규화와 고정 순서 직렬화, 복원 중 중간 조회 차단, 한 번의 최종 조회와 도법 선택 ARIA를 검증 |
| `static/js/weather-grid-dfs-projection.js`, `static/js/weather-grid-map-state.js`, `static/js/weather-grid-projection.js`, `static/js/weather-grid-readout.js` | complete | 기상청 DFS 구면 LCC 상수·분수 격자·Proj4 정의를 단일 순수 모듈로 관리. 세 도법 전이·줌 한계·남북 격자 표본과 OpenLayers 재투영·60ms 포인터 리드아웃을 Node·브라우저 검증 |
| `static/js/weather-grid-infrastructure-state.js`, `static/js/weather-grid-infrastructure.js` | complete | 대교·공항·항만 가용성과 독립 표시 전이, 좌표 검증, 미터 단위 라벨 임계값을 순수 모델로 작성. OpenLayers RegularShape·공용 오버레이 선택·도법·테마 어댑터를 Node·브라우저로 검증 |
| `static/js/weather-grid-layer-state.js`, `static/js/weather-grid-layers.js`, `static/js/weather-grid-isoline-state.js`, `static/js/isoline.js` | complete | 색상·흐름선·등치선 선택과 요소별 가용성을 불변 상태로 작성. 등치선은 결측 경계 보존·안장점 판별·열린 선과 닫힌 선 스무딩을 순수 계산으로 분리하고, 래스터·범례·입자 효과·ARIA와 함께 Node·브라우저 검증 |
| `static/js/weather-grid-run-state.js`, `static/js/weather-grid-runs.js` | complete | KST 일 8회 발표, 자정 경계 3시간 이동, 최신 발표와 60일 경계를 순수 함수로 작성. 날짜·이전·최신·다음 제어와 URL·조회 연결을 Node·브라우저로 검증 |
| `static/js/weather-grid-explore-state.js`, `static/js/weather-grid-explore.js` | complete | 빠른 보기·데이터 영역의 설명과 실행 계획, 현재 화면 추론, 마지막 기상 보기 복구를 불변 모델로 계산하고 지도·환경·ARIA 어댑터를 Node·브라우저로 검증 |
| `static/js/weather-grid-view3d-state.js`, `static/js/weather-grid-view3d.js` | complete | idle/loading/open 전이, 오류 안내와 2D 흐름선 복구 조건을 순수 모델로 작성. 단일 동적 import, 명시적 모달 생명주기, Escape·포커스 복귀를 브라우저로 검증 |
| `static/js/weather-grid-ui.js` | removed | 2,029줄 통합 파일의 모든 책임을 공개 입력 사양에 따른 상태 모델과 기능별 어댑터로 이전하고 두 배포 셸에서 제거 |
| `WEB-INF/jsp/weather-grid.jsp`, `WEB-INF/jsp/weather-grid-shell/*.jspf` | complete | scriptlet 없는 여섯 책임 조각을 단일 정적 조립기에서 Spring/Cloudflare로 공유. 실제 검색 form, 명명된 main·범례·시간축, 설정 fieldset/legend, 제목에 연결된 popup·dialog와 모바일 modal 전환을 정적·브라우저 계약으로 검증 |

## P3 · 테스트 재작성

현재 서버 단위·통합 테스트에는 추적 중인 rename 후보가 없다. 이후 테스트도 기존 테스트의
내부 구조를 이름만 바꾸지 않고 공개 계약의 경계값·합성 fixture·실패 정책을 기준으로 작성한다.
기존 E2E는 사용자 관점의 회귀 oracle로만 사용하며 새 구현 내부 구조를 결정하는 입력으로
사용하지 않는다.

## 현재 기능 공백

| 기능 | 상태 | 독립 구현 입력과 완료 조건 |
|---|---|---|
| 전국 시군구(Admin-2) 경계·선택 | unavailable | 검증 가능한 최신·전국·재배포 가능 원천과 라이선스를 선정한 뒤 결정적 변환기, 자산 hash·HTTP 계약과 지도 선택 E2E 추가 |
| VWorld 도로 배경지도 | implemented · verified | 공식 Base PNG·traffic PBF, 환경변수 런타임 설정, OpenLayers 통합, 화면 출처 표시, CSP, 미설정·타일 실패 OSM fallback과 순수 상태·서버·Worker·브라우저 계약 테스트 완료. localhost와 `public-readiness` RC 실타일·벡터 렌더링 확인 |

각 항목을 완료할 때 `docs/reimplementation-log.md`에 공개 입력 사양, 설계 차이, 검증 명령과
날짜를 남긴다. 완료 전에는 저장소를 public으로 전환하거나 공개 release를 만들지 않는다.
