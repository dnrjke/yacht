# Skills 가이드

이 프로젝트에서 사용할 수 있는 슬래시 커맨드(스킬) 목록.

---

## 스킬이란?

스킬은 AI에게 **미리 정해둔 작업 절차를 한 번에 실행**시키는 단축 명령어다.

평소 AI 채팅에서 "이 코드 검토해줘", "여기에 기능 추가해줘" 같은 요청을 할 때, AI가 매번 어떻게 할지 고민하고, 빠뜨리는 것도 있고, 할 때마다 방식이 달라진다. 스킬은 이런 문제를 해결한다. "이 프로젝트에서 코드를 검토할 때는 이 순서로, 이 기준으로 해라"를 미리 정의해놓고, `/명령어` 한 줄로 실행하는 것이다.

비유하면:
- 일반 채팅 = "대충 알아서 해줘"
- 스킬 = "이 체크리스트대로 해"

### 웹 채팅 사용자를 위한 활용법

CLI(터미널)를 쓰지 않고 웹 채팅(ChatGPT, Claude 등)으로 AI를 활용하는 경우에도 스킬의 내용을 그대로 활용할 수 있다. 스킬 파일(`.claude/skills/*/SKILL.md`)은 결국 **텍스트로 된 작업 지시서**이기 때문이다.

#### 방법 1: 스킬 내용을 프롬프트에 붙여넣기

1. 이 문서 아래에서 원하는 스킬을 찾는다
2. 해당 스킬의 SKILL.md 파일을 열어 내용을 복사한다
3. 웹 채팅에 코드와 함께 붙여넣고 "이 절차대로 진행해줘"라고 요청한다

```
예시:
"아래 지시서의 절차대로 frontend/src/store/gameStore.ts를 점검해줘.

[yacht-audit SKILL.md 내용 붙여넣기]

대상 코드:
[코드 붙여넣기]"
```

#### 방법 2: 핵심 기준만 발췌해서 사용

스킬 전체를 붙여넣을 필요 없이, 점검 기준이나 규칙 테이블만 뽑아서 쓸 수도 있다.

```
예시:
"아래 기준으로 이 코드를 검토해줘:
- 서버 권위 원칙: 게임 결과는 서버에서 결정, 클라이언트는 표시만
- 워크스페이스 경계: 게임 로직은 core, UI는 frontend, 서버는 backend
- 타입 공유: frontend/backend 공유 타입은 core 경유
- 매직넘버 지양: 상수로 추출

[코드 붙여넣기]"
```

#### 방법 3: 프로젝트 지식으로 등록

Claude Projects, ChatGPT GPTs 등 커스텀 지식을 등록할 수 있는 서비스라면, SKILL.md 파일을 프로젝트 지식/시스템 프롬프트에 등록해두면 매번 붙여넣을 필요 없이 `/yacht-audit 해줘` 같은 자연어로 동일한 효과를 낼 수 있다.

### 스킬 파일 위치

모든 스킬은 `.claude/skills/` 아래에 폴더별로 저장되어 있다:

```
.claude/skills/
  yacht-session/SKILL.md    ← 세션 시작
  yacht-implement/SKILL.md  ← 신규 구현
  yacht-approve/SKILL.md    ← 계획 승인 & 검수
  yacht-audit/SKILL.md      ← 코드 위생 점검
  yacht-readme/SKILL.md     ← README 갱신
```

---

## 스킬 목록

---

## `/yacht-session` — 세션 시작

프로젝트 컨텍스트를 로드하고 작업 준비를 완료한다.

- README.md, CLAUDE.md, 메모리 로드
- 프로젝트 현재 상태 파악 (구조, 최근 변경, core 빌드 상태)
- 웹 탐색·리서치·서브에이전트 자율 사용 승인 선언
- "무엇을 진행할까요?"로 마무리

**사용법**: `/yacht-session`

---

## `/yacht-implement` — 신규 요소 구현

새 UI 컴포넌트, 게임 로직, 서버 기능, 3D 요소 등을 구현한다.

### 절차

1. **부트스트랩** — `Docs/implementation_plan.md`, `Docs/task.md`, 메모리, 프로젝트 구조 로드
2. **기존 패턴 파악** — 구현 대상과 유사한 기존 코드를 반드시 읽고 패턴 추출
3. **구현 계획 수립** — 파일 목록, 워크스페이스 경계, 아키텍처 체크리스트 포함 → 사용자 승인 대기
4. **구현** — 기존 패턴 그대로 따름 (일관성 > 개별 최적)
5. **빌드 검증** — 각 워크스페이스 `tsc --noEmit` → `/approve review` 검수

### 핵심 규칙

| 규칙 | 내용 |
|------|------|
| 기존 코드 먼저 | 유사 코드를 반드시 읽은 뒤 구현 |
| 패턴 일관성 | 기존 패턴과 동일 방식 우선 |
| 워크스페이스 경계 | 게임 로직 → core, UI → frontend, 서버 → backend |
| 서버 권위 | 게임 결과는 서버에서 결정, 클라이언트는 표시만 |
| 타입 공유 | frontend/backend 공유 타입은 core 경유 |
| 매직넘버 지양 | 상수로 추출 |

**사용법**: `/yacht-implement [구현 대상 설명]`

---

## `/yacht-approve` — 계획 승인 & 구현 검수

두 가지 모드를 지원한다.

### Plan 모드 (기본) — 구현 전 계획 승인

- 구현 계획이 이미 수립되어 있어야 함
- opus 서브에이전트가 최대 8회 반복 검토
- 검토 기준: 논리적 모순, 누락 단계, 패턴 준수, 아키텍처 문서 충돌
- APPROVED / REJECTED 판정

```
/yacht-approve              ← 직전 계획 전체 검토
/yacht-approve plan 스코어보드  ← 특정 범위 검토
```

### Review 모드 — 구현 후 코드 검수

- 세션에서 코드 구현이 완료되어 있어야 함
- opus 서브에이전트가 최대 8회 반복 검수
- 검수 기준: 코드 정확성, 아키텍처 문서 준수, 패턴 준수, 실사용 부자연스러움
- CRITICAL/WARNING → 자동 수정 후 재검수, NITPICK → 보고만
- tsc 게이트 통과 필수

```
/yacht-approve review       ← 세션 내 전체 변경 검수
/yacht-approve review 물리엔진 ← 특정 범위 검수
```

---

## `/yacht-audit` — 코드베이스 위생 점검

전체 또는 지정 범위의 코드를 순차 점검하여 죽은 코드, 타입 이슈, 공통화/리팩터링 대상을 찾아 보고한다.

### 절차

1. **범위 결정 + tsc** — 각 워크스페이스에서 `tsc --noEmit` 실행, 타입 에러 수집
2. **모듈 분할** — screens / ui / 3d / store / backend / physics / core 단위로 분할
3. **순차 점검** — 모듈별로 직접 Grep/Read 확인 (병렬 서브에이전트 미사용)
4. **심각도 분류** — P1~P5 등급 + 확신도(확실/추정) 두 축
5. **결과 파일 작성** — `Docs/Audit/YYYY-MM-DD.md`에 심각도별 테이블
6. **터미널 보고** — 요약 보고 후 사용자 지시 대기
7. **순차 수정** — "수정 진행" 지시 시 P1→P2→P3→P4 순서, 등급별 tsc 게이트

### 점검 항목

| 카테고리 | 내용 |
|----------|------|
| A. 죽은 코드 | 미참조 export, 도달 불가 분기, 주석 처리 코드, 빈 함수 |
| B. 타입 이슈 | `any`, 불필요한 `as`/`!`, `ts-ignore` |
| C. 공통화 대상 | 중복 패턴, 매직넘버, core 미경유 타입 공유 |
| D. 리팩터링 후보 | 과대 파일, 깊은 중첩, God object |
| E. 아키텍처 위반 | 서버 권위, 결정론적 물리, Zustand 패턴, R3F 패턴, Socket.io, 워크스페이스 경계 |

### 심각도

| 등급 | 수정 여부 |
|------|----------|
| P1 크리티컬 | 즉시 수정 |
| P2 수정 권장 | 수정 |
| P3 통합 권장 | 수정 |
| P4 리팩터링 권장 | 수정 |
| P5 보류 | 보고만 (수정 안 함) |

```
/yacht-audit                    ← 전체 (frontend + backend + core)
/yacht-audit frontend           ← frontend만
/yacht-audit backend            ← backend만
/yacht-audit core               ← core만
/yacht-audit frontend/src/store ← 특정 경로
```

---

## `/yacht-readme` — README.md 갱신

README.md를 현재 코드베이스 실제 상태에 맞게 갱신한다.

- Explore 서브에이전트로 코드베이스 실사
- 현행 README와 비교하여 차분(diff) 산출
- 추가/삭제/수정/구조 변경 반영
- 코드는 수정하지 않음, 문서만 갱신

```
/yacht-readme              → 루트 README.md
/yacht-readme frontend     → frontend README.md
/yacht-readme backend      → backend README.md
/yacht-readme core         → core README.md
```

---

## 일반적인 작업 흐름

```
/yacht-session                    # 1. 세션 시작
  ↓
/yacht-implement 스코어보드 UI     # 2. 구현 시작
  ↓
/yacht-approve                    # 3. 계획 승인
  ↓
(구현 진행)                        # 4. 코드 작성
  ↓
/yacht-approve review             # 5. 코드 검수
  ↓
/yacht-audit                      # 6. 코드 위생 점검
  ↓
/yacht-readme                     # 7. README 갱신
```
