# 출시 체크리스트

실서비스 반영 전에는 아래 순서대로 확인한다. 하나라도 실패하면 배포하지 않는다.

## 1. RC 확인

- GitHub release를 발행할 때는 `docs/publication-manifest.json`의 `releaseStatus`가 `ready`이고
  차단 목록이 비어 있는지 확인. 런타임 RC 반영만 진행할 때는 공개 차단 상태를 임의로 변경하지 않음
- 독립 재구현 기록, 제3자 고지, 자산 SHA-256이 최신 변경과 일치하는지 확인
- PR의 독립 구현 근거·입력 사양·출처·권리·보안 체크가 실제 변경과 일치하는지 확인
- `docs/known-limitations.md`의 기능 공백·운영 검증 대기·공개 차단 내용이 현재 상태와 일치하는지 확인
- 작업 트리가 의도한 변경만 포함하는지 확인
- `main` 최신 커밋 기준으로 테스트
- API 키나 `.dev.vars`, 로컬 설정 파일이 추적되지 않는지 확인
- 채팅·이슈 등 외부 채널에 노출된 키는 재발급하고 기존 키를 폐기
- Git 작성자와 커미터가 본인 계정인지 확인
- 원격의 브랜치·태그·release·PR·fork에 승인하지 않은 이력이 없는지 다시 확인
- Dependabot이 Actions·Gradle·세 npm workspace 설정을 읽고 있는지 확인
- Dependabot alerts와 automated security fixes가 활성 상태인지 확인
- private vulnerability reporting과 `SECURITY.md`의 외부 비공개 신고 경로를 확인
- secret scanning과 push protection이 활성 상태이고 열린 Secret alert가 없는지 확인
- `main` 보호가 두 Actions 검사를 필수로 요구하고 최신 기준·선형 이력·대화 해결을 적용하며,
  강제 푸시와 브랜치 삭제를 금지하는지 확인

이 저장소를 새로 clone하거나 worktree를 만든 뒤에는 저장소 로컬 푸시 보호 설정을 먼저
활성화한다. `push.default=simple`은 현재 브랜치가 의도하지 않은 원격 브랜치로 확장되는
위험을 줄이고, pre-push hook은 승인된 공개 루트가 아닌 ref 또는 공개 감사를 통과하지 못한
커밋 트리의 전송을 거부한다.

```bash
git config --local core.hooksPath .githooks
git config --local push.default simple
git config --local --get core.hooksPath
git config --local --get push.default
```

```bash
node --test scripts/publication-rules.test.mjs
node scripts/audit-publication.mjs
node scripts/audit-publication.mjs --ref=HEAD
node scripts/audit-publication.mjs --release
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
npm ci --prefix tools/geodata
npm run check --prefix tools/geodata
npm audit --prefix tools/geodata --audit-level=high
```

## 3. Secret과 미리보기

Secret 값은 출력하거나 파일에 적지 않고 이름만 확인한다.

```bash
cd cloudflare
npx wrangler secret list
npx wrangler versions secret put KMA_API_AUTH_KEY
npx wrangler versions secret put DATA_GO_KR_SERVICE_KEY
npx wrangler versions secret put ITS_API_KEY
npm run build
npm run upload:rc
```

앞의 세 필수 `versions secret put`은 키를 재발급한 경우에만 실행하며 값을 대화·명령행 인자·셸
히스토리에 남기지 않는다. 일반 `wrangler secret put`은 즉시 운영 배포를 만들 수 있으므로
RC 절차에서는 사용하지 않는다. 새 RC에서 검증이 끝난 뒤 기존 키를 폐기한다.
`DATA_GO_KR_SERVICE_KEY`와 `ITS_API_KEY`에는 `%2B` 같은 percent-encoded 문자열이 아니라
URL 인코딩 전 원문 키를 저장한다. gateway가 query 값을 정확히 한 번 인코딩한다.

RC의 ITS 실시간 요청만 503이고 같은 키의 공식 `:9443/cctvInfo`가 로컬에서 정상일 때는
공유 위치 스냅샷을 먼저 검증하고 초기화한다. 첫 명령은 읽기 전용이며, 출력의 `dropped`와
`credentialIncluded`가 각각 `0`, `false`인지 확인한 뒤에만 두 번째 명령을 실행한다. 키 값은
Node 프로세스 메모리에서만 읽고 Wrangler 인자·KV 값·출력에 포함하지 않는다.

```powershell
node scripts/seed-cctv-snapshots.mjs --key-file '<ITS 키 파일>'
node scripts/seed-cctv-snapshots.mjs --key-file '<ITS 키 파일>' --apply
```

필수 Secret은 `KMA_API_AUTH_KEY`, `DATA_GO_KR_SERVICE_KEY`, `ITS_API_KEY` 세 개다.
Cloudflare에는 `VWORLD_API_KEY`를 주입하지 않는다. VWorld 원점이 edge 서버 요청을
허용하지 않으므로 런타임 설정은 비활성 계약을 반환하고 브라우저는 즉시 OpenStreetMap을
사용한다. Spring 배포에서 VWorld를 사용할 때만 키를 동일 출처 프록시에 주입하며 런타임
설정·타일 응답·로그에는 포함하지 않고 공급자 도메인 제한도 함께 유지한다.
태풍·낙뢰는 `KMA_API_AUTH_KEY`, 기상특보는 `DATA_GO_KR_SERVICE_KEY`를 사용하며,
`HAZARD_SNAPSHOTS` KV binding과 `*/5 * * * *` Cron이 `wrangler.jsonc`에 함께 있어야 한다.
이 KV는 위험기상 외에 PoP 간 CCTV 위치 복구 스냅샷도 저장한다. CCTV 공유 스냅샷은 비어
있지 않은 타일만 요청당 최대 1건·타일당 24시간에 최대 1회 쓰고 48시간 뒤 삭제되며, 조회
시 24시간을 넘긴 값은 거부하고 유효한 값도 항상 `stale:true`로 반환해야 한다.
업로드 직후 출력되는 `RC_VERSION_ID`를 기록하고,
`wrangler deployments status`에서 직전 정상 버전 ID도 배포 전에 기록한다. RC 미리보기
URL에서 아래 항목을 확인한다.

- 첫 화면과 모바일 화면이 정상 표시되는지
- Cloudflare 도로 배경지도가 지연 없이 OpenStreetMap으로 표시되고 지도 이동·확대·도법
  전환 뒤 기상 오버레이가 유지되는지, `/api/runtime/map-config`와 브라우저 요청에
  VWorld 키가 노출되지 않는지
- Spring VWorld 사용 환경에서는 Base PNG와 PBF 벡터 도로가 표시되고 키 제거·타일 실패
  때 OpenStreetMap으로 대체되는지
- 풍속·기온·일사강도 격자가 실제 자료로 200 응답하는지
- 고도 선택 UI가 지원값 하나만 노출하고, 알 수 없는 `h` 주소를 지원값으로 정규화하는지
- 격자·지점 API의 지원하지 않는 고도 요청이 상류 호출 없이 즉시 400을 반환하는지
- 지점 48시간 예보와 PM10·PM2.5가 표시되는지
- 위험기상 보기를 열었을 때 태풍·낙뢰·특보 API 장애가 기존 지도에 전파되지 않는지
- 기상→대기질/교통→기상 영역 왕복 시 마지막 기상 보기와 시간 문맥이 복구되는지
- 3D 지연 로딩 중 버튼에 진행 상태가 표시되고 Escape 닫기 뒤 열기 버튼으로 포커스가 복귀하는지
- CCTV 응답이 `stale:false`인지
- 서로 다른 CCTV 3개의 HLS manifest와 첫 segment가 실제로 재생되는지
- ITS를 실패시킨 냉시작 PoP에서는 24시간 이내 공유 위치가 `stale:true`로 표시되되 재생
  버튼이 비활성화되고, 24시간을 넘긴 스냅샷은 503으로 닫히는지
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
