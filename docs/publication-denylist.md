# 로컬 비공개 식별자 검사

공개 소스에 남아서는 안 되는 이전 회사·고객·내부 프로젝트 식별자는 공개 파일에 목록 자체를
기록하지 않는다. 각 작업자는 로컬 전용 `.publication-denylist.local`에서만 관리한다.

## 준비

`.publication-denylist.example`을 `.publication-denylist.local`로 복사하고 주석 아래에
한 줄에 한 개씩 검사할 literal을 적는다.

- 이전 회사·고객 명칭과 고유 약칭
- 내부 프로젝트·서비스 codename
- 내부 domain·package prefix·endpoint
- 독자적인 자산 파일명·레이어명·문구

일반 단어처럼 오탐이 많은 값은 피하고, 실제 비공개 구현을 식별할 수 있는 고유한 문자열만
사용한다. 빈 줄과 `#`으로 시작하는 주석은 무시하고 대소문자는 구분하지 않는다.

## 안전 원칙

- `.publication-denylist.local`은 Git ignore 상태를 유지한다.
- 목록을 issue, PR, CI 변수, 로그 또는 채팅에 붙여 넣지 않는다.
- 검사 실패 메시지는 일치한 식별자를 출력하지 않고 파일 경로만 알린다.
- 오탐은 목록에서 더 고유한 표현으로 좁히며 공개 코드에 예외 문자열을 추가하지 않는다.
- 이 검사는 보조 증거일 뿐 독립 구현이나 비침해를 보증하지 않는다.

## 실행

```bash
git check-ignore -v .publication-denylist.local
node --test scripts/publication-rules.test.mjs
node scripts/audit-publication.mjs
```

CI에는 실제 목록을 전달하지 않는다. CI는 공개 가능한 공통 규칙만 검사하고, 비공개 식별자는
작업자의 pre-push 감사에서 로컬 목록을 사용해 추가 검사한다.
