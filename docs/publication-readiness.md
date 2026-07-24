# 공개 준비 상태

현재 상태는 **공개 보류(blocked)** 다. 파일명·함수명·변수명 변경만으로 독립 구현이 되지는
않으므로, 출처를 설명할 수 없는 구현은 기능 사양과 공개 문서만 보고 모듈 단위로 다시 작성한다.
법률 판단을 대신하는 문서가 아니며, 실제 공개 전에는 근로계약·보안서약·사내 규정과 최종
산출물을 지식재산권 전문가에게 검토받아야 한다.

## 완료된 항목

- 원격 기본 브랜치는 `Initial public release` 한 개의 루트 커밋만 가진다.
- 2026-07-23 원격 감사에서 `main` 외 브랜치, 태그, release, issue, PR, fork가 없고
  공개 루트의 GitHub Actions 품질 게이트가 성공한 것을 확인했다. 저장소는 아직 private이다.
- 저장소 로컬 `core.hooksPath=.githooks`, `push.default=simple`을 설정하고 pre-push hook이
  승인된 공개 루트는 허용하고 로컬 archive 이력은 거부하는지 확인했다. hook과 CI는
  작업 폴더가 아니라 실제 전송·빌드할 commit tree를 `--ref=<commit>`으로 감사한다.
- 지점 차트는 외부 차트 런타임이 없는 저장소 자체 SVG 구현이다.
- 지도 선택 미리보기와 파비콘은 저장소에서 새로 작성한 SVG로 교체했다.
- 기상청 DFS 좌표 투영은 기상청 공개 격자 사양을 근거로 새 API와 테스트로 재작성했다.
- 공공데이터포털·ITS 호출은 승인된 endpoint만 노출하는 gateway로 교체하고 자격 증명 단일
  인코딩, 고정 CCTV 요청, 상태 코드, 선언·실제 응답 크기를 합성 계약 테스트로 검증한다.
- KMA DFS·KIM 원문 요청은 전용 gateway로 분리했고, KIM은 2026년 표준화
  `typ06` endpoint를 사용한다. 사용하지 않는 변수·시각·영역은 호출할 수 없고,
  응답 byte 상한과 비밀키 비노출을 합성 계약 테스트로 검증한다.
- KMA 지점예보도 별도 JSON gateway로 재작성했다. KST 발표시각과 49시간 슬롯
  조립은 HTTP 코드에서 분리했고, 실제 0과 결측, 시간 범위, 실패 미캐싱을 합성
  테스트로 고정했다. 이전 `KmaApiService`는 제거했다.
- CCTV는 ITS 공식 필드만 해석하는 원문 경계, 0.25° 셀 캐시, 공개 응답 조립으로
  분리했다. 승인된 HTTPS HLS URL, 동시 miss 통합, fresh/stale/backoff, 범위·중복·
  24셀/256셀/1,000개 상한을 새 합성 테스트로 고정했다.
- 지점 상세예보와 AirKorea는 원문 정규화, 스냅샷 캐시, 공개 응답 조립을 분리했다.
  49개 시간 슬롯의 실제 0/결측, 공식 1시간 대기질 등급, 측정소 좌표·중복 이름 결합,
  동시 갱신 통합, 6시간 측정값·30일 측정소 stale 상한을 합성 테스트로 고정했다.
- 환경 REST API는 예보·대기질, CCTV, 위험기상 연결 상태 컨트롤러로 분리했다. 정확한
  query 이름·단일값, KST 발표+10분과 60일 범위, 한국 좌표, CCTV 24셀 제한을 서비스 호출
  전에 검사하고 400·429·503 텍스트 응답을 명시적인 UTF-8 및 캐시 정책으로 통일했다.
- 지도 HTTP 경계는 서버 페이지, 격자·통계, 좌표·시계열 컨트롤러로 분리했다. 필수·선택
  query 이외의 값과 중복을 차단하고, 격자·통계는 하나의 요청 예산을 공유한다. 시계열은
  별도 예산과 5분 클라이언트 캐시를 사용하며 상세예보 요소는 전용 endpoint로 안내한다.
- 지도 도메인은 공통 DFS 표본 창 위에서 바람, 7개 스칼라, KIM 일사를 서로 다른 원천으로
  정규화한다. 응답 조립과 지점 시계열도 분리했으며 `MapService`는 컨트롤러 호환 facade만
  유지한다. 운영 결측은 503, 명시적 데모 모드만 결정적 합성장을 허용한다.
- 격자 캐시는 파싱 저장소, 원문 아카이브, 파일 주소, DFS 값 품질 정책으로 분리했다. 실행·
  발효시각과 변수는 파일 접근 전에 검증하고 원문은 2 MiB로 제한한다. 새 `grid-v2` 경로에서
  동일 디렉터리 임시 파일을 강제 기록한 뒤 atomic move가 가능한 경우에만 공개하며, 실패하면
  메모리 캐시로만 동작한다. UTC 날짜 보존 정책은 소유한 실행시각 디렉터리만 정리한다.
- DFS와 KIM ASCII 해석은 공통 strict 숫자 스트림 위의 제품별 reader로 교체했다. DFS는
  149×253 값과 남→북 행 순서를, KIM은 필수 크기·subset header와 115×109 값을 정확히
  요구한다. 주석이 아닌 비숫자 token, 값 초과·부족, 상충 header는 조용히 건너뛰지 않고
  실패 처리한다. KIM 좌표 변환은 별도 불변 geometry가 유한 좌표·crop 범위를 검사한다.
- 서버 프로세스 실행기와 Spring root configuration을 분리했다. startup 테스트는 독립 요청
  예산과 격자 저장소가 실제 애플리케이션 컨텍스트에서 발견되는지 검사한다.
- 공개 응답은 브라우저 JSON 이름과 내부 도메인 이름을 분리한 불변 record로 교체했다.
  컬렉션은 생성 시 복사하고 좌표·시간 슬롯·통계 불변식을 검사한다. 모든 공개 실패는
  `PublicServiceException`의 세 종류로 통합하고 endpoint 범위별 400·429·503 본문만 노출한다.
- 공개 요청과 상류 갱신 예산은 문자열 키 대신 route·source enum으로 구분한다. 경과 시간은
  시스템 시각 변경의 영향을 받지 않는 단조 ticker로 계산하고, client bucket은 access-order
  LRU 상한을 둔다. 전달 주소는 직접 peer가 명시된 trusted proxy CIDR에 속할 때만
  `CF-Connecting-IP`에서 받으며, hostname·손상 IP·`X-Forwarded-For`는 신뢰하지 않는다.
- 브라우저의 테마·설정·재생·범례·공유 URL·지도 표현·발표 이동·도법·리드아웃·주요 지점·탐색 문맥·3D 연결은
  DOM 없는 불변 상태 모델과 기능별 어댑터로 분리했다. 주요 지점은 이모지 대신 대교·공항·
  항만별 코드 기반 벡터 도형을 사용한다. 탐색 영역 왕복은 마지막 기상 보기를 복구하고,
  3D 연결은 단일 지연 로딩·명시적 모달 생명주기·2D 흐름선 복구를 사용하며 클릭·키보드·
  Escape·포커스 복귀를 실제 브라우저로 검증한다. 요소별 색상·흐름선·등치선 가용성,
  KST 3시간 발표와 60일 경계, 딥링크 복원 중 중간 조회 억제도 별도 계약으로 고정했고,
  기존 2,029줄 통합 UI 파일은 배포 셸과 소스에서 제거했다.
- 격자 데이터 조회도 DOM·네트워크와 분리한 불변 상태 모델로 교체했다. 허용 요소·10m 고도·
  발표와 발효시간을 요청 전에 검증하고, 고정 query 직렬화, 증가 순번, 이전 전송 취소,
  오래된 응답 폐기, 정상·빈 자료·손상 응답·429·35초 시간 초과와 완료 사건을 독립 계약으로
  검사한다. 브라우저 어댑터는 jQuery AJAX 없이 `fetch`와 `AbortController`를 사용하며,
  지도 렌더 효과는 최소 runtime 경계 뒤에 둔다.
- 격자 래스터도 표본 계획, 최근접 셀 index, 캐시 키, 유효값 통계와 CSS 색상 해석을 DOM 없는
  순수 모델로 분리했다. 별도 브라우저 어댑터만 OpenLayers `ImageCanvas`, 현재 도법의 역변환,
  격자 가장자리 알파와 최근 화면 LUT를 소유한다. LCC·메르카토르·위경도에서 본토와 경계 섬의
  API 셀 색 일치, 데이터 변경 시 캐시 재사용, 화면·DPR·도법·테마 변경 시 무효화를 검사한다.
- 2D 풍장은 8MP backing-store 계획과 벡터장 교체·지도 이동·resize·레이어 중단·3D 전환·폐기
  생명주기를 순수 상태로 계산한다. 별도 어댑터만 Canvas와 `Windy` 인스턴스, OpenLayers extent,
  80/140ms 재시작 타이머를 소유한다. 모바일 DPR 3부터 8K까지 메모리 상한, 3D 뒤쪽 RAF 차단,
  연속 줌 중 즉시 중단과 종료 뒤 기존 렌더러 한 번 재시작을 실제 브라우저로 검사한다.
- 지점·좌표 조회는 이름·위경도·공개 요소·10m·KST 발표시각과 query 순서를 순수 모델에서
  검증한다. 지점 차트와 지도 범위 확인은 독립 요청 채널을 사용해 새 요청 취소, 오래된 응답 폐기,
  정상·범위 밖·전송 실패·시간 초과를 구분한다. 브라우저 어댑터만 상세예보와 시계열의 병렬 조정,
  `fetch`·`AbortController`, 차트·재시도·팝업 효과를 소유하며 강수 계열은 상세예보 응답 하나를
  카드와 48시간 차트가 공유한다.
- 기상 색상 계약은 요소 메타데이터·물리 범위·범주 레이블과 모든 팔레트를 DOM 없는 순수
  모듈에서 계산한다. 기본 지도도 12MP 픽셀 예산, 반응형 초기 영역·여백, 기상·행정 경계·도로
  모드와 라벨·경계·대표 지역 표시를 불변 상태로 계산하고, 별도 OpenLayers 부트스트랩만 지도
  인스턴스·OSM·GeoJSON·벡터 지점·테마 효과를 소유한다. 대표 지역 검색은 NFKC·공백·대소문자
  정규화와 유효 좌표 필터를 거친 최대 20개 후보만 제시하며 정확 선택, 순환 키보드 탐색,
  combobox ARIA와 좌표 팝오버 포커스를 독립 검색 모델·어댑터로 검증한다.
- JSP 애플리케이션 셸은 서버 scriptlet 없이 여섯 책임 조각으로 조립한다. 대표 지역 검색은
  중첩되지 않은 실제 form, 지도·범례·예보 시간축은 제목에 연결된 landmark, 설정 선택 묶음은
  fieldset/legend, 지점·3D 화면은 명시적 labelled dialog를 사용한다. 같은 셸을 Cloudflare
  정적 문서로 결정적으로 생성하고 정적 계약과 데스크톱·모바일 Chromium 회귀로 검증한다.
- 브라우저에 직접 배포하는 제3자 라이브러리의 버전·라이선스·원문 위치를 기록했다.
- 브라우저 런타임의 byte 수와 SHA-256을 `docs/vendor-lock.json`에 고정했고 three.js는 공식
  최신 r185로 갱신했다.
- Natural Earth 5.1.1 원본 ZIP의 크기·SHA-256과 결정적 변환 도구를 추가해 GeoJSON을
  byte 단위로 재현할 수 있고, 빈 폴리곤·열린 링·잘못된 좌표를 생성 단계에서 거부한다.
- 실제 서버의 GeoJSON 계약 테스트는 두 자산을 gzip으로 받아 압축 해제 후 고정 byte 수와
  SHA-256, `application/geo+json`, 공개 cache policy, 스키마·ID·feature 수를 검사한다.
  manifest도 검증된 두 초기 자산과 아직 선택하지 않은 시군구 자료를 명시적으로 구분한다.
- Wrangler는 공식 최신 4.113.0으로 고정했다. Miniflare가 아직 취약한 `sharp` 0.34.5를
  요구하므로, GitHub 보안 권고의 패치 버전 0.35.3을 명시적으로 override하고 Worker 테스트·
  dry-run·`npm audit`으로 호환성과 취약점 해소를 검증한다.
- 생성된 Cloudflare 정적 파일과 내부 API 스냅샷은 Git 추적 및 공개 감사 대상에서 제외했다.
- `CONTRIBUTING.md`와 PR template에 허용 입력, 금지 자료, 독립 구현 절차, 출처·권리·보안
  확인을 명시하고 공개 감사의 필수 관리 파일로 고정했다.
- Dependabot은 Actions·Gradle·Cloudflare·E2E·지오데이터 도구를 매주 그룹 업데이트하도록
  설정했다. `SECURITY.md`는 public issue에 상세를 남기지 않는 advisory 기반 신고,
  합성 재현, Secret 우선 폐기와 회귀·롤백 기록 절차를 정의한다.
- GitHub Dependabot alerts와 automated security fixes를 활성화했고 API에서 각각 활성
  상태를 다시 확인했다. 텍스트 파일은 `.gitattributes`와 `.editorconfig`에서 플랫폼과
  무관한 LF, 배치 파일은 CRLF로 고정한다.
- 공개 금지 경로, 금지 차트, 일반 키 대입·GitHub·AWS·Google·개인키 Secret 지표와 로컬
  식별자 목록 해석을 순수 규칙 모듈과 합성 테스트 5개로 분리했다. 정확한 `.env.example`만
  허용하고 다른 `.env*`는 차단한다. 비공개 이전 회사·프로젝트 용어는 Git에 넣지 않는
  `.publication-denylist.local`과 `docs/publication-denylist.md` 절차로 검사한다.

## 알려진 제한 사항

전국 시군구(Admin-2) 경계·선택은 최신성·전국 범위·재배포 조건을 검증할 수 있는 원천을
선정하지 않아 제공하지 않는다. 시도(Admin-1) 경계와 대표 지역 검색은 제공하며,
지오데이터 manifest도 `koreaAdmin2`를 unavailable로 명시한다. 실제 Secret과 상류 자료가
필요한 RC 검증 및 공개 차단과 혼동하지 않도록 전체 조건은 `docs/known-limitations.md`에서
별도로 관리한다. 도로 배경지도는 VWorld 공식 벡터 지도 API의 Base PNG와 traffic PBF를
현재 OpenLayers 지도에 연결하는 독립 어댑터로 구현했고, 키 미설정·타일 실패 시
OpenStreetMap으로 안전하게 대체한다. 개인 VWorld 키로 localhost 실타일과 벡터 렌더링을
확인했고 비운영 `public-readiness` Worker 도메인에서도 같은 결과를 재검증했다. 키 원문은
저장소와 문서에 넣지 않는다.

## 공개 차단 항목

1. 추적한 애플리케이션 모듈의 독립 재구현은 완료했지만, 기술적 변경만으로 비침해나 권리 귀속을
   보증할 수는 없다. 근로계약·보안서약·사내 규정과 최종 산출물에 대한 사람의 권리 검토가
   끝나지 않아 루트 `LICENSE`를 아직 발행하지 않는다. 제3자 라이선스 파일은 이 판단과
   무관하게 계속 보존한다.

현재 private 저장소 요금제에서는 GitHub `main` branch protection과 ruleset을 사용할 수 없다.
공개 전까지는 커밋 트리 기반 pre-push 감사와 GitHub Actions 품질 게이트로 보완한다.
권리 검토가 끝나 public 전환이 승인되면 required status checks와 force-push 금지를 즉시
설정하고, 적용 여부를 다시 확인한 뒤 release를 만든다.
private vulnerability reporting도 같은 시점에 활성화하고 실제 비공개 신고 경로를 확인한다.
public 저장소에 무료로 자동 적용되는 secret scanning과 사용자 push protection도 확인하고,
저장소 수준 push protection을 사용할 수 있으면 별도로 활성화한다.

## 독립 재구현 순서

| 우선순위 | 영역 | 독립 입력 사양 | 완료 조건 |
|---:|---|---|---|
| 1 | 외부 API 클라이언트 | 기상청·공공데이터포털·ITS 공개 API 문서 | 새 요청/응답 경계, 합성 fixture 테스트, 출처 기록 |
| 2 | 격자 캐시와 기상 도메인 서비스 | 공개 API 응답 스키마와 제품 요구사항 | 새 데이터 모델, 새 오류 정책, 동등 기능 회귀 테스트 |
| 3 | HTTP 컨트롤러·보안 설정 | Spring 공식 문서와 공개 REST 계약 | 새 요청 검증·오류 응답·보안 헤더 테스트 |
| 4 | 지도 UI·JSP 셸 | 공개 UX 요구사항과 접근성 기준 | 새 DOM 구조·상태 모델·브라우저 회귀 테스트 |
| 5 | DTO와 기존 테스트 | 새 공개 API 계약 | record/명시적 mapper와 새 합성 테스트로 교체 |
| 6 | Worker 및 운영 스크립트 | Cloudflare 공식 문서와 공개 API 계약 | Java 경로와 독립적인 Worker 계약 테스트 |

각 완료 항목은 `docs/reimplementation-log.md`에 입력 사양, 새 설계, 작성일, 검증 명령을 남긴다.
과거 구현을 옆에 놓고 줄 단위로 변환하거나 기계적으로 이름만 바꾸는 방식은 사용하지 않는다.
파일별 재구현 상태는 `docs/reimplementation-backlog.md`, 현재 기능 공백과 운영·공개 조건은
`docs/known-limitations.md`에서 추적한다.

## 공개 직전 판정

다음 명령이 모두 성공하고 `docs/publication-manifest.json`의 차단 목록이 비어 있어야 한다.

```bash
node scripts/audit-publication.mjs --release
./gradlew test
npm test --prefix cloudflare
npm audit --prefix cloudflare --audit-level=high
npm run check --prefix tools/geodata
npm audit --prefix tools/geodata --audit-level=high
npm test --prefix e2e
npm audit --prefix e2e --audit-level=high
```

또한 원격 저장소의 브랜치·태그·릴리스·PR·포크에 이전 이력이 남지 않았는지 확인한다. GitHub의
공개 전환은 이 검토와 별도의 명시적 작업으로 취급한다.
