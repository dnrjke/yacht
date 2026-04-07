---
name: yacht-implement
description: Yacht 프로젝트에 새 요소(UI 컴포넌트, 게임 로직, 서버 기능, 3D 요소 등)를 구현하기 위한 셋업. 기존 패턴 탐색 + 아키텍처 문서 로드 + 구현 가이드라인 적용.
user-invocable: true
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Bash, Agent, Edit, Write
argument-hint: [구현 대상 설명]
effort: max
---

# 신규 요소 구현 셋업

사용자가 `$ARGUMENTS`로 구현 대상을 지정한다.

---

## 0단계: 세션 상태 판별 + 프로젝트 부트스트랩

### 부트스트랩

프로젝트 컨텍스트가 아직 로드되지 않은 경우:

1. `C:/yacht/Docs/implementation_plan.md` 읽기 — 아키텍처 전략 파악
2. `C:/yacht/Docs/task.md` 읽기 — 현재 태스크 파악
3. 메모리 인덱스(`C:/Users/Garnet/.claude/projects/C--yacht/memory/MEMORY.md`) 확인 → 관련 메모리 읽기
4. 프로젝트 구조 확인:
   - `C:/yacht/frontend/src/` 구조 (components/screens, components/ui, components/3d, store)
   - `C:/yacht/backend/src/` 구조
   - `C:/yacht/core/src/` 구조

부트스트랩 완료 후 별도 "무엇을 진행할까요?" 질문 없이 바로 1단계로 진행한다.

### 구현 대상 결정

- `$ARGUMENTS`가 **있으면** → 그것이 구현 대상
- `$ARGUMENTS`가 **없으면** → 직전 대화 맥락에서 논의·설계·계획 중이던 내용이 구현 대상. 맥락에서도 특정할 수 없으면 사용자에게 질문한다.

---

## 1단계: 아키텍처 문서 원칙 로드

다음을 읽고 핵심 규칙을 내재화한다:

- `C:/yacht/Docs/implementation_plan.md` — 아키텍처 결정, 동기화 전략, 서버 권위 원칙 (부트스트랩에서 이미 읽었으면 재읽기 불필요)
- `C:/yacht/Docs/task.md` — 현재 진행 중인 태스크 (부트스트랩에서 이미 읽었으면 재읽기 불필요)

이 단계에서 로드한 원칙은 이후 모든 구현에 **무조건** 적용한다.

---

## 2단계: 구현 대상 분석 + 기존 패턴 파악

사용자가 지정한 구현 대상(`$ARGUMENTS`)을 분석하여:

### 2-a. 유사 기존 코드 탐색

구현 대상과 가장 유사한 기존 모듈/컴포넌트를 찾아 **반드시 읽는다**.

- **React 화면 컴포넌트**: `frontend/src/components/screens/` — GameScreen.tsx, MainMenuScreen.tsx, SplashScreen.tsx, TouchScreen.tsx 등에서 가장 유사한 것을 선택하여 패턴 파악
- **UI 컴포넌트**: `frontend/src/components/ui/` — Scoreboard.tsx 등
- **3D 컴포넌트**: `frontend/src/components/3d/` — PhysicsBoard.tsx, PhysicsCup.tsx, PhysicsDice.tsx, DecisionButton.tsx 등
- **상태 관리**: `frontend/src/store/gameStore.ts` — Zustand 스토어 패턴
- **게임 로직 (core)**: `core/src/` — scoring.ts, index.ts 등 공유 로직
- **서버**: `backend/src/server.ts` — Express + Socket.io + Rapier 3D 서버 구조
- **물리 엔진**: `backend/src/physics/PhysicsWorld.ts` — Rapier 3D WASM 물리 시뮬레이션 패턴

찾은 유사 코드를 읽고, 다음을 파악한다:
- 컴포넌트 구조 패턴 (함수형 컴포넌트, hooks 사용 방식)
- Zustand 스토어 접근 패턴
- Three.js/R3F 선언적 패턴 (@react-three/fiber 컴포넌트 구조)
- Socket.io 이벤트 정의·핸들링 패턴
- Rapier 3D 리지드바디 생성·시뮬레이션 패턴
- 타입 정의 및 공유 방식 (core 패키지를 통한 타입 공유)

### 2-b. Store 확인

구현에 상태 관리가 필요하면:
- `frontend/src/store/gameStore.ts` — 기존 Zustand 스토어 구조와 패턴 확인
- 기존 상태 슬라이스 및 액션 패턴 파악

### 2-c. 서버-클라이언트 통신 확인

새로운 이벤트나 통신이 필요하면:
- `backend/src/server.ts` — 기존 Socket.io 이벤트 구조 파악
- `frontend/` 내 소켓 연결·이벤트 핸들링 패턴 파악
- 서버 권위(server-authoritative) 원칙 준수 여부 확인

---

## 3단계: 구현 계획 수립

탐색 결과를 바탕으로 **구현 계획**을 수립한다.

계획에는 다음을 포함:
1. 생성/수정할 파일 목록
2. 워크스페이스 경계 (어떤 코드가 frontend/backend/core에 위치하는지)
3. 컴포넌트/모듈 구조
4. Store 변경 필요 여부
5. Socket.io 이벤트 추가/변경 필요 여부
6. 물리 엔진 변경 필요 여부
7. 적용할 아키텍처 원칙 체크리스트:
   - [ ] 모노레포 워크스페이스 경계 존중 (게임 로직 → core, UI → frontend, 서버 → backend)
   - [ ] 서버 권위 원칙 (게임 결과는 서버에서 결정)
   - [ ] 결정론적 물리 시뮬레이션 전략 준수
   - [ ] Zustand 스토어 패턴 일관성
   - [ ] React 컴포넌트 디렉터리 구분 (screens/ui/3d)
   - [ ] Three.js/R3F 선언적 패턴
   - [ ] Socket.io 이벤트 패턴 일관성
   - [ ] core를 통한 타입 공유
   - [ ] 매직넘버 지양, 상수화

계획을 사용자에게 보고하고 승인을 대기한다.

---

## 4단계: 구현

승인 후 구현을 진행한다.

- 기존 유사 코드의 패턴을 **그대로** 따른다 (일관성 > 개별 최적)
- 아키텍처 문서 원칙을 빠짐없이 적용
- 구현 중 발견한 패턴 불일치는 기존 패턴에 맞춘다

---

## 5단계: 빌드 검증 + 검수

구현 완료 후:

1. 각 워크스페이스에서 타입 검사:
   - `cd C:/yacht/core && npx tsc --noEmit`
   - `cd C:/yacht/frontend && npx tsc --noEmit`
   - `cd C:/yacht/backend && npx tsc --noEmit`
2. 에러 수정 후 `/approve review`로 검수 진행

---

## 핵심 규칙 요약

| 규칙 | 내용 |
|------|------|
| 기존 코드 먼저 | 유사 기존 코드를 반드시 읽은 뒤 구현. 읽지 않고 작성 금지 |
| 패턴 일관성 | 기존 패턴과 동일 방식 우선. 일관성 > 개별 최적 |
| 워크스페이스 경계 | 게임 로직은 core, UI는 frontend, 서버는 backend. 경계 위반 금지 |
| 서버 권위 | 게임 결과(주사위, 점수)는 반드시 서버에서 결정. 클라이언트는 표시만 |
| 결정론적 물리 | implementation_plan.md의 동기화 전략 준수 |
| 타입 공유 | frontend/backend 간 공유 타입은 core를 경유 |
| 매직넘버 지양 | 숫자·문자열 리터럴은 상수로 추출 |
| 대량 구현 후 검수 | `/approve review` 필수 |
