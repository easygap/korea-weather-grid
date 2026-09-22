# BORA 실행 안내

## 화면 먼저 확인하기

JDK 17이 필요하다. 저장소에 포함된 Gradle Wrapper를 사용한다.

```powershell
$env:WEATHER_GRID_DEMO_MODE = "true"
.\gradlew.bat bootRun --args='--server.port=8080'
```

```bash
WEATHER_GRID_DEMO_MODE=true ./gradlew bootRun --args='--server.port=8080'
```

[localhost:8080](http://localhost:8080)을 연다. 데모 모드는 바람·기온·일사강도 예제 자료를 제공한다. 예제 자료는 화면에 표시되며 실제 예보가 아니다. 대기질, CCTV, 지역별 상세예보 등 외부 서비스는 해당 API 키와 이용 권한이 필요하다.

## 실제 자료 연결하기

키는 환경변수로 설정한다. 개인 설정 파일이나 키를 저장소에 올리지 않는다.

| 환경변수 | 필요한 기능 |
| --- | --- |
| `KMA_API_AUTH_KEY` | 기상청 격자 예보, 태풍·낙뢰 |
| `DATA_GO_KR_SERVICE_KEY` | 지역별 상세예보, 에어코리아, 기상특보 |
| `ITS_API_KEY` | 도로 CCTV |
| `VWORLD_API_KEY` | 브이월드 배경지도·벡터 도로 사용 시 |

각 API의 활용 신청과 승인이 별도로 필요하다. 브이월드는 실행 도메인과 지도 API 권한도 등록한다. Cloudflare 환경의 도로 배경지도는 원본 서버의 요청 제약 때문에 OpenStreetMap을 기본으로 사용한다.

## 코드 구성

- Java 17 / Spring Boot: 로컬 실행과 서버 API
- OpenLayers 10 / JavaScript / CSS: 지도와 조작 화면
- Three.js: 사용자가 3D 화면을 열 때만 불러오는 렌더러
- Cloudflare Workers: 운영 API와 정적 화면

JSP 조각이 화면의 원본이다. `cloudflare/build.mjs`에서 같은 조각으로 정적 HTML을 생성하므로 두 환경을 따로 수정하지 않는다.

## 확인 명령

```bash
./gradlew test
npm ci --prefix cloudflare
npm test --prefix cloudflare
npm run build --prefix cloudflare
node scripts/audit-publication.mjs
```

브라우저 검증은 서버를 먼저 실행한 뒤 진행한다.

```bash
cd e2e
npm ci
npx playwright install chromium
npx playwright test
```

기본 주소는 `http://localhost:8090`이다. 다른 포트는 `WEATHER_GRID_BASE`로 지정한다. 설치된 Chrome을 사용하려면 `PLAYWRIGHT_CHANNEL=chrome`을 설정한다.

공개 전 검증과 배포 절차는 [기여 안내](../CONTRIBUTING.md)와 [출시 점검표](release-checklist.md)를 참고한다. `audit-publication.mjs --release`는 프로젝트 라이선스 검토가 끝나지 않은 현재 상태에서 실패하도록 되어 있다.
