# 알려진 제한 사항

이 문서는 현재 제공하지 않는 기능, 실서비스에서 별도로 확인할 운영 조건, 공개를 막는 조건을
서로 구분한다. 제한 사항을 숨기지 않고 현재 구현 범위와 완료 조건을 공개적으로 추적하기 위한
문서이며, 비침해나 권리 귀속에 관한 법률 판단을 대신하지 않는다.

기준일은 2026-07-23이다.

## 알려진 기능 공백

| 항목 | 현재 상태 | 현재 대안 | 완료 조건 |
|---|---|---|---|
| 전국 시군구(Admin-2) 경계·선택 | `koreaAdmin2` unavailable | 시도(Admin-1) 경계와 대표 지역 지점 검색 | 최신성·전국 범위·재배포 조건을 확인할 수 있는 원천과 라이선스 URL을 선정하고, 원본 크기·SHA-256 고정, 결정적 변환기, 스키마·해시 HTTP 계약 테스트와 지도 표시·선택 브라우저 테스트를 추가 |

현재 배포 지오데이터 manifest도 `koreaAdmin2`를 unavailable로 명시한다. 이 기능은 README의
현재 제공 기능으로 주장하지 않으며, 검증된 원천이 선정되기 전에는 임의의 행정 경계 파일로
대체하지 않는다. 지도 경계는 시각화를 위한 자료이며 법적·지적 경계를 나타내지 않는다.

현재 알려진 기능 공백은 위 한 항목이다. 나머지 추적 중인 애플리케이션 독립 재구현 항목은
Spring 164개, Worker·정적 셸 218개, 실제 Chromium E2E 71개 계약 테스트를 통과한
2026-07-23 기준으로 완료했으며, 이후 변경은 같은 품질 게이트로 다시 검증한다.

Kakao 도로 배경지도는 공식 JavaScript SDK를 동적으로 불러오는 독립 어댑터와 OpenLayers
중심·확대 수준 동기화, CSP, 키 미설정·SDK 실패 시 OSM fallback까지 구현했다. 비공식 또는
문서화되지 않은 Kakao 타일 URL을 OpenLayers XYZ source에 직접 연결하지 않는다.

## 운영 검증 대기

아래 항목은 구현 누락이 아니라 실제 자격 증명과 상류 자료가 있는 RC 환경에서 확인해야 하는
운영 조건이다.

- 기상청·공공데이터포털·ITS Secret을 새 RC 버전에 안전하게 연결한 실제 자료 응답
- Kakao Developers의 `카카오맵 → 사용 설정`을 승인 후 ON으로 전환하고, 이미 등록된
  서비스·localhost 도메인에서 공식 SDK·타일·OpenLayers 오버레이 동기화를 실제 확인
- 서로 다른 CCTV HLS manifest와 첫 segment의 실제 재생
- 위험기상 snapshot, Cron, KV binding과 fresh/stale 전환
- 운영 전환 뒤 15분간 오류율·429·503·예외 로그와 화면 성능 관찰
- private 요금제에서 사용할 수 없는 GitHub `main` branch protection·ruleset을 public 전환
  승인 직후 required status checks와 force-push 금지로 설정
- GitHub private vulnerability reporting을 public 전환 승인 직후 활성화하고
  `SECURITY.md`의 외부 비공개 신고 경로를 확인
- public 저장소에 자동 적용되는 secret scanning·사용자 push protection을 확인하고,
  저장소 수준 push protection을 사용할 수 있으면 활성화

구체적인 확인 절차와 실패 시 롤백 순서는 `docs/release-checklist.md`에서 관리한다.

## 공개 차단

프로젝트 자체 코드의 권리 귀속에 대한 사람의 검토가 끝나지 않았으므로
`project-license-awaits-rights-review` 차단을 유지하고 루트 `LICENSE`를 아직 발행하지 않는다.
이 조건이 해결되기 전에는 저장소를 public으로 전환하거나 release를 만들지 않는다.
제3자 라이선스와 고지는 이 판단과 무관하게 계속 보존한다.
