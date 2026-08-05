# 알려진 제한 사항

이 문서는 현재 제공하지 않는 기능, 실서비스에서 별도로 확인할 운영 조건, 공개를 막는 조건을
서로 구분한다. 제한 사항을 숨기지 않고 현재 구현 범위와 완료 조건을 공개적으로 추적하기 위한
문서이며, 비침해나 권리 귀속에 관한 법률 판단을 대신하지 않는다.

기준일은 2026-08-05이다.

## 알려진 기능 공백

| 항목 | 현재 상태 | 현재 대안 | 완료 조건 |
|---|---|---|---|
| 전국 시군구(Admin-2) 경계·선택 | `koreaAdmin2` unavailable | 시도(Admin-1) 경계와 대표 지역 지점 검색 | 최신성·전국 범위·재배포 조건을 확인할 수 있는 원천과 라이선스 URL을 선정하고, 원본 크기·SHA-256 고정, 결정적 변환기, 스키마·해시 HTTP 계약 테스트와 지도 표시·선택 브라우저 테스트를 추가 |

현재 배포 지오데이터 manifest도 `koreaAdmin2`를 unavailable로 명시한다. 이 기능은 README의
현재 제공 기능으로 주장하지 않으며, 검증된 원천이 선정되기 전에는 임의의 행정 경계 파일로
대체하지 않는다. 지도 경계는 시각화를 위한 자료이며 법적·지적 경계를 나타내지 않는다.

현재 알려진 기능 공백은 위 한 항목이다. 나머지 추적 중인 애플리케이션 독립 재구현 항목은
Spring 172개, Worker·정적 셸 238개, 실제 Chromium E2E 81개 계약 테스트를 통과한
2026-08-05 기준으로 완료했으며, 이후 변경은 같은 품질 게이트로 다시 검증한다.

VWorld 도로 배경지도는 공식 벡터 지도 API의 Base PNG와 traffic PBF를 현재 OpenLayers
지도에 표시한다. Spring 배포에서는 브라우저가 동일 출처 타일 프록시만 호출하고 VWorld
키는 서버 안에서만 사용한다. Cloudflare Worker에서 VWorld 원점 요청이 502로 거부되는
것을 RC에서 확인했으므로 Worker는 키를 읽지 않고 런타임 설정을 비활성화해 즉시 OSM으로
대체한다. 키 미설정, 키 형식 오류, 타일 점검 실패, 연속 타일 오류에도 OSM으로 대체한다.

## 운영 조건

아래 항목은 구현 누락이 아니라 실제 자격 증명과 상류 자료가 있는 RC와 운영 환경에서 계속
확인할 조건이다. 2026년 8월 5일 기준 기상청 격자 8종과 지점예보, AirKorea 측정소 672개,
KIM 일사 입력 지점 49개, ITS CCTV 목록과 HLS 영상을 실제 응답으로 확인했다.

- ITS 상류 일부 구역이 실패해도 성공한 구역의 CCTV를 표시하고 전역 차단기를 열지 않는지,
  서로 다른 HLS master·variant와 첫 media segment를 배포마다 표본 확인한다. 실제 H.264
  1920×1080 스트림 디코딩까지 확인했다.
- VWorld 키의 운영 URL 등록과 호출 한도는 Spring 운영 전환 전에 다시 확인한다. localhost와
  `public-readiness` RC의 지역 확대 화면에서는 PBF 12건이 모두 200으로 응답했고 현재
  도법으로 변환한 도로 피처 9,400개와 Base PNG 렌더링을 확인했다. 전국 축척에서는
  호출량을 제한하기 위해 Base 지도를 사용하고 지역 확대 시 벡터 도로를 추가한다. 기존에
  브라우저로 전달된 운영 키는 VWorld 관리 화면에서 별도로 교체해야 한다. Cloudflare에서는
  VWorld 원점이 edge 요청을 지원하기 전까지 OSM 대체 상태를 유지한다.
- 태풍·낙뢰·기상특보는 실제 상류 응답의 문자 인코딩과 현재 형식을 확인했다. 배포마다
  snapshot Cron과 KV binding의 fresh/stale 전환, 발효 건수와 기준시각을 함께 확인한다.
- 운영 전환 뒤 15분간 오류율·429·503·예외 로그와 화면 성능을 관찰한다.
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
