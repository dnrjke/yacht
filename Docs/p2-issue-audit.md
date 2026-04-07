# P2 멀티플레이어 결함 감사 보고서

> 작성일: 2026-04-07
> 범위: core / backend / frontend 전체 코드베이스
> 목적: 2인 플레이(P2) 도입 후 발생한 구조적 결함과 버그를 식별하고 해결 우선순위를 정한다.

---

## 1. 발견된 결함 전체 목록

### 1.1 [Critical] 서버에 플레이어 식별 체계 부재

- **파일**: `backend/src/server.ts`
- **현상**: 소켓 연결 시 P1/P2 할당 로직 없음. `socket.id`와 플레이어 역할 간 매핑 없음.
- **영향**: 서버가 어떤 클라이언트가 어떤 플레이어인지 구분 불가. 모든 후속 검증의 전제 조건이 깨짐.

### 1.2 [Critical] 서버 측 턴 검증 부재

- **파일**: `backend/src/server.ts`
- **현상**: `CUP_TRANSFORM`, `POUR_CUP`, `COLLECT_TO_CUP` 이벤트 핸들러에 발신자 검증 없음.
- **영향**: 상대 턴에도 컵 조작·주사위 굴리기·수집이 가능. 게임 규칙이 서버에서 강제되지 않음.

### 1.3 [Critical] 턴 상태(`currentTurn`)가 클라이언트 로컬 전용

- **파일**: `frontend/src/store/gameStore.ts` — `currentTurn: 'p1' | 'p2'`
- **현상**: 턴 정보가 서버를 거치지 않고 각 브라우저에서 독립적으로 관리됨.
- **영향**: 두 브라우저의 턴 상태가 어긋날 수 있음. 한쪽이 P1 턴이라 생각하는데 다른 쪽은 P2 턴이라 표시하는 desync 발생.

### 1.4 [Critical] 턴 전환 시 서버 물리 초기화 누락

- **파일**: `frontend/src/store/gameStore.ts` — `endTurn()`
- **관련**: `backend/src/physics/PhysicsWorld.ts`
- **현상**: `endTurn()`이 프론트엔드 상태만 리셋. 서버의 `PhysicsWorld`에는:
  - `diceInCup` 배열이 이전 턴의 값(전부 `false`) 그대로
  - `keptDice` 배열이 이전 턴의 킵 상태 그대로
  - `currentDiceValues`가 이전 턴의 결과값 그대로
- **영향**: 새 턴 시작 시 서버 물리 세계가 오염된 상태. `allDiceReadyToPour()`가 `false` 반환하여 첫 번째 POUR가 무시되거나, 이전 턴 킵 주사위가 남아있는 버그 발생.

### 1.5 [Critical] 점수 기록이 클라이언트 전용 — 동기화·검증 없음

- **파일**: `frontend/src/components/ui/Scoreboard.tsx`, `frontend/src/store/gameStore.ts`
- **현상**: `updateScore()`가 로컬 Zustand 스토어만 업데이트. 서버에 `RECORD_SCORE` 이벤트 없음.
- **영향**:
  - P1 브라우저에서 기록한 점수가 P2 브라우저에 전파되지 않음
  - 각 브라우저가 자체 점수판을 갖게 되어 최종 결과가 불일치
  - 점수 조작 가능(DevTools로 스토어 직접 수정)

### 1.6 [High] `rollCount`가 로컬 전용 — 3회 제한 우회 가능

- **파일**: `frontend/src/store/gameStore.ts` — `rollCount`, `incrementRollCount()`
- **현상**: 굴림 횟수를 클라이언트가 자체 관리. 서버에서 카운트하지 않음.
- **영향**: 악의적 클라이언트가 `POUR_CUP`을 무한 전송 가능. 서버가 거부하지 않음.

### 1.7 [High] 프론트엔드 컵 조작에 턴 가드 없음

- **파일**: `frontend/src/components/3d/PhysicsCup.tsx`
- **현상**: `onPointerDown`에서 `currentTurn` 확인 없음. 양쪽 클라이언트 모두 컵 드래그 가능.
- **영향**: 상대 턴에 내가 컵을 잡고 흔들 수 있음. 서버 턴 검증이 없으므로 실제로 물리 시뮬레이션까지 작동함.

### 1.8 [High] 방/로비 시스템 부재

- **파일**: `backend/src/server.ts`, `frontend/src/App.tsx`
- **현상**: 모든 소켓이 하나의 전역 `PhysicsWorld`에 연결. 방 생성·참가·매칭 없음.
- **영향**: 3명 이상 접속 시 전부 같은 게임에 간섭. 2인 매칭이 불가능.

### 1.9 [High] PhysicsWorld에 턴 리셋 메서드 없음

- **파일**: `backend/src/physics/PhysicsWorld.ts`
- **현상**: `spawnDiceInCup()`은 모든 주사위를 컵에 넣지만, 턴 전환 전용으로 설계되지 않음. `keptDice` 리셋, `diceInCup` 리셋, `currentDiceValues` 초기화를 한 번에 수행하는 메서드 없음.
- **영향**: 턴 전환 시 부분적으로만 상태가 리셋되어 불일치 발생.

### 1.10 [Medium] 주사위 클릭(keep/unkeep)에 턴 체크 없음

- **파일**: `frontend/src/components/3d/PhysicsDice.tsx` — `onPointerDown`
- **현상**: 배치 모드에서 주사위 클릭 시 `currentTurn` 확인 없음.
- **영향**: 상대 턴에 주사위를 킵 트레이로 이동할 수 있음. (서버 턴 검증이 있으면 후속 POUR에서 걸리겠지만, UX 혼란 유발)

---

## 2. 결함 간 의존 관계

```
1.8 방/로비 시스템
 └─▶ 1.1 플레이어 식별
      └─▶ 1.2 서버 턴 검증
           ├─▶ 1.3 턴 상태 동기화
           ├─▶ 1.6 rollCount 서버 관리
           └─▶ 1.7 프론트엔드 턴 가드
      └─▶ 1.5 점수 동기화
 └─▶ 1.9 PhysicsWorld 턴 리셋
      └─▶ 1.4 턴 전환 초기화
           └─▶ 1.10 주사위 클릭 턴 체크
```

---

## 3. 해결 순서 (권장)

의존 관계를 기반으로, 아래 순서대로 해결한다. 각 단계가 완료되면 다음 단계의 전제 조건이 충족된다.

### Phase A: 서버 기반 게임 상태 확립 (기반 작업)

| 순서 | 대상 결함 | 작업 요약 |
|------|-----------|-----------|
| **A-1** | 1.8 | 방/로비: 서버에 Room 관리 구조 추가, 소켓 JOIN/LEAVE 처리 |
| **A-2** | 1.1 | 플레이어 식별: Room 내 P1/P2 할당, socket↔player 매핑 |
| **A-3** | 1.9 | PhysicsWorld 턴 리셋: `resetForNewTurn()` 메서드 추가 |

### Phase B: 턴 시스템 서버 이전 (핵심 로직)

| 순서 | 대상 결함 | 작업 요약 |
|------|-----------|-----------|
| **B-1** | 1.2 + 1.6 | 서버 턴 검증 + rollCount 관리: 모든 이벤트 핸들러에 턴 가드 추가 |
| **B-2** | 1.4 | 턴 전환 서버 주도: `RECORD_SCORE` → 검증 → `resetForNewTurn()` → `TURN_CHANGED` 브로드캐스트 |
| **B-3** | 1.3 | 프론트엔드 턴 상태를 서버 구독으로 교체: 로컬 `currentTurn` 제거 |

### Phase C: 점수 동기화 (데이터 무결성)

| 순서 | 대상 결함 | 작업 요약 |
|------|-----------|-----------|
| **C-1** | 1.5 | 점수 기록 서버 경유: `RECORD_SCORE` 이벤트 추가, 서버에서 `calculateScore` 검증 후 `SCORE_UPDATED` 브로드캐스트 |

### Phase D: 프론트엔드 가드 (UX 보호)

| 순서 | 대상 결함 | 작업 요약 |
|------|-----------|-----------|
| **D-1** | 1.7 | PhysicsCup 턴 가드: `myPlayerId !== currentTurn`이면 드래그 차단 |
| **D-2** | 1.10 | PhysicsDice 턴 가드: 주사위 클릭 시 내 턴인지 확인 |

---

## 4. 검증 체크리스트

각 Phase 완료 후 아래를 확인한다.

### Phase A 완료 후
- [ ] 브라우저 2개로 접속 시 각각 P1/P2로 할당됨
- [ ] 3번째 접속자는 대기 또는 거부됨
- [ ] 서버 콘솔에 `Player 1 joined room X`, `Player 2 joined room X` 출력

### Phase B 완료 후
- [ ] P2 턴에 P1이 `POUR_CUP` 전송 시 서버가 무시하고 로그 출력
- [ ] 3회 굴림 후 추가 `POUR_CUP` 전송 시 서버가 거부
- [ ] 점수 기록 시 서버가 턴 전환, 양 클라이언트 동시에 턴 변경 확인
- [ ] 새 턴 시작 시 서버 `PhysicsWorld`의 주사위가 모두 컵 안에 위치

### Phase C 완료 후
- [ ] P1이 점수 기록 시 P2 브라우저 점수판에 즉시 반영
- [ ] 서버가 `calculateScore(finalValues, category)` 결과와 클라이언트 요청값 비교, 불일치 시 거부

### Phase D 완료 후
- [ ] 상대 턴에 컵 클릭 시 반응 없음(커서 변화 없음)
- [ ] 상대 턴에 주사위 클릭 시 keep/unkeep 동작 안 함
