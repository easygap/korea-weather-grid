# 출시 체크리스트

실서비스 반영 전에는 아래 순서대로 확인한다. 하나라도 실패하면 배포하지 않는다.

## 1. RC 확인

- 작업 트리가 의도한 변경만 포함하는지 확인
- `main` 최신 커밋 기준으로 테스트
- API 키나 `.dev.vars`, 로컬 설정 파일이 추적되지 않는지 확인
- 채팅·이슈 등 외부 채널에 노출된 키는 재발급하고 기존 키를 폐기
- Git 작성자와 커미터가 본인 계정인지 확인

```bash
git status --short
git diff --check
git grep -nE 'serviceKey=|authKey=|ITS_API_KEY=' -- ':!docs/release-checklist.md'
```

## 2. 품질 게이트

GitHub Actions의 `단위 테스트 · Worker 빌드`, `브라우저 회귀`가 모두 통과해야 한다.
로컬에서 다시 확인할 때는 다음 명령을 사용한다.

```bash
./gradlew test
npm ci --prefix cloudflare
npm test --prefix cloudflare
npm audit --prefix cloudflare --audit-level=high
npm ci --prefix e2e
npm audit --prefix e2e --audit-level=high
```

## 3. Secret과 미리보기

Secret 값은 출력하거나 파일에 적지 않고 이름만 확인한다.

```bash
cd cloudflare
npx wrangler secret list
npx wrangler versions secret put DATA_GO_KR_SERVICE_KEY
npx wrangler versions secret put ITS_API_KEY
npm run build
npm run upload:rc
```

위 두 `versions secret put`은 키를 재발급한 경우에만 실행하며 값을 대화·명령행 인자·셸
히스토리에 남기지 않는다. 일반 `wrangler secret put`은 즉시 운영 배포를 만들 수 있으므로
RC 절차에서는 사용하지 않는다. 새 RC에서 검증이 끝난 뒤 기존 키를 폐기한다.

필수 Secret은 `KMA_API_AUTH_KEY`, `DATA_GO_KR_SERVICE_KEY`, `ITS_API_KEY` 세 개다.
위험기상은 별도 Secret 없이 `KMA_API_AUTH_KEY`를 사용하며, `HAZARD_SNAPSHOTS` KV
binding과 `*/5 * * * *` Cron이 `wrangler.jsonc`에 함께 있어야 한다.
업로드 직후 출력되는 `RC_VERSION_ID`를 기록하고,
`wrangler deployments status`에서 직전 정상 버전 ID도 배포 전에 기록한다. RC 미리보기
URL에서 아래 항목을 확인한다.

- 첫 화면과 모바일 화면이 정상 표시되는지
- 풍속·기온·일사강도 격자가 실제 자료로 200 응답하는지
- 고도 선택 UI가 지원값 하나만 노출하고, 알 수 없는 `h` 주소를 지원값으로 정규화하는지
- 격자·지점 API의 지원하지 않는 고도 요청이 상류 호출 없이 즉시 400을 반환하는지
- 지점 48시간 예보와 PM10·PM2.5가 표시되는지
- 위험기상 보기를 열었을 때 태풍·낙뢰·특보 API 장애가 기존 지도에 전파되지 않는지
- CCTV 응답이 `stale:false`인지
- 서로 다른 CCTV 3개의 HLS manifest와 첫 segment가 실제로 재생되는지
- 콘솔 오류와 실패한 정적 자산 요청이 없는지

## 4. 운영 반영

`workers.dev`에서는 버전 혼합에 따른 상태 불일치를 피하기 위해, 새로 빌드하지 않고 검증한
RC 버전 자체를 한 번에 반영한다. 배포 스크립트는 RC UUID와 `@100%`가 아니면 실행을 거부하고,
버전 전환 뒤 같은 설정의 Cron Trigger를 동기화한다.

```bash
cd cloudflare
npm run deploy -- <RC_VERSION_ID>@100%
```

배포 직후 실제 버전 ID가 기록한 RC와 같은지 확인하고 15분 동안 다음을 확인한다.

- `/api/weather/grid`의 `wdws`, `tmp`, `swdn` 오류율
- `/api/weather/timeseries`, `/api/weather/point-forecast`, `/api/environment/air-quality`, `/api/traffic/cameras` 상태 코드
- `/api/hazards/typhoons`, `/api/hazards/lightning?minutes=30`, `/api/hazards/warnings` 상태와 스냅샷 기준시각
- 429·503·예외 로그 증가 여부
- 첫 화면 LCP, 레이아웃 이동, 모바일 제스처

## 5. 롤백

오류가 재현되면 기능별 임시 우회보다 직전 정상 버전으로 먼저 되돌린다.

```bash
cd cloudflare
npx wrangler versions list
npx wrangler rollback <직전-정상-버전-ID>
```

롤백 후 같은 점검 항목을 다시 확인하고, 원인과 재현 조건은 별도 이슈로 남긴다.
