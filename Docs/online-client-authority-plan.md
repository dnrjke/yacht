# 온라인 관전 일치화 — 클라이언트 권위 전환 계획

작성일: 2026-06-16
상태: 방향 확정(사용자 승인), 구현 전

## 배경 / 문제

온라인 플레이에서 **관전자 화면의 주사위 모션·결과가 턴 플레이어 화면과 불일치**한다.

근본 원인은 **모션의 단일 진실원천이 없음**:
- 턴 플레이어는 *자기 로컬 물리* 결과를 본다.
- 서버는 *독립적인 자기 물리*를 돌린다.
- 관전자는 서버가 내려준 프레임을 **충실히 재생만** 한다(관전자는 물리를 돌리지 않음).

두 독립 시뮬레이션(턴 플레이어 vs 서버)은 부동소수 적분 특성상 발산하므로, 서버 권위를 유지하는 한 시각적 불일치는 필연이다.

### 구체 증상 (확인됨)
1. **셰이크 페이즈**: 턴 플레이어는 `CUP_SHAKE_STATE`에 자기 실제 `diceStates`를 보내지만 **서버가 이를 버리고 재시뮬레이션**해서(`RoomPhysicsLoop.applyLatestInput`) 관전자에게 보냄 → 셰이크 모션 불일치.
2. **붓기 페이즈 (turn1 OK, turn2+ 깨짐)**: 턴 플레이어는 로컬 프리뷰(값 X)를 보드에 멈춰 보여주는데, 키핑 진입 시 서버 권위값(값 Y)으로 점프. 보드 settle(X) ≠ 키핑 정렬(Y). 관전자는 항상 서버 trajectory만 보므로 보드=키핑 일치.
   - 보드→서버값 수렴 보정 코드(`PhysicsDice.tsx`의 `authoritativeBlend` 경로)는 **할당이 없어 죽은 코드**다(오직 `null`로만 세팅). 그래서 보드는 X에 남고 키핑만 Y로 튄다.
   - turn1이 멀쩡한 이유: 로컬·서버가 동일 fresh 상태에서 출발해 발산이 작아 X≈Y. 구조적 보장은 아니며 turn1도 어쩌다 틀릴 수 있음.

## 결정 (사용자 승인 2026-06-16)

- **셰이크**: 서버 재시뮬 폐기, 턴 플레이어의 전송된 dice states를 관전자에게 그대로 forward.
- **붓기**: **선택 1 — 클라이언트 권위.** 턴 플레이어의 로컬 시뮬레이션을 canonical로 삼아 관전자에게 중계. 서버 독립 시뮬은 인간 턴에서 제거.
- **근거**: 게임 본질이 물리 시뮬레이션이라 서버 권위는 시각 불일치를 강제함. 안티치트는 직교한 문제로, 필요하면 별도 검증 레이어로 푸는 게 더 효과적.
- **안티치트는 본 계획 범위 밖** (명시적 비목표).

## 변경하지 않는 것

- 서버의 **상태 기계 권위**(턴/페이즈/점수/룰 검증)는 유지. 클라 권위는 *물리 모션·주사위 값*에 한정.
- **서버 물리(`simulatePour`)는 자동플레이 경로용으로 유지.** 타임아웃/연결 끊김 시 `ServerAutoPlay`가 `handlePour`→`simulatePour`를 호출하며, 이땐 서버가 곧 "클라" 역할(양쪽 다 관전자). 인간 턴만 클라 결과를 쓰도록 분기.
- 관전자 지터 버퍼(`SPECTATOR_POUR_BUFFER_MS=250`, `shakeBuffer`의 `SHAKE_INTERPOLATION_DELAY_MS=180`)는 유지.

---

## Phase 1 — 셰이크 forward (저위험, 트러스트 무관)

데이터는 이미 전선에 있음. 서버가 버리는 걸 살려 중계.

### 서버
- `RoomPhysicsLoop.enqueueShake`: `latestInput`에 클라의 `diceStates`도 보관.
- `RoomPhysicsLoop.applyLatestInput`: 서버 `step()` + `getDiceStates()`로 만들어 보내던 것을, **클라가 보낸 `diceStates`를 그대로** `OPPONENT_SHAKE_STATE`에 실어 forward.
  - 서버 물리 step은 (a) 완전히 생략하거나 (b) 자동플레이 폴백 대비 유지. **잠정: 생략**(인간 셰이크 중 서버 물리는 붓기 결과에 더 이상 쓰이지 않음; 폴백은 fresh 스폰에서 시작하므로 무방). 구현 시 폴백 경로 재확인.
- `server.ts` `CUP_SHAKE_STATE` 핸들러: `validateShakeState`가 `diceStates`(5개, 유한 수치)까지 검증하는지 확인·보강. 관전자에게 relay되므로 sanity 필수.

### 클라이언트
- 변경 거의 없음. `shakeBuffer`는 이미 cup+dice 프레임을 보간 재생.

### 검증
- 디버그: `getShakeBufferDebugSnapshot`로 버퍼 점유·도착 간격 관찰. 턴 플레이어 화면과 셰이크 모션 육안 비교.

---

## Phase 2 — 붓기 클라이언트 권위 (선택 1)

### 프로토콜
- 신규(또는 `POUR_CUP` 확장) 이벤트: 턴 플레이어 → 서버로
  `{ turnNumber, finalValues, diceTrajectory, cupTrajectory }` 전송.
- 서버 검증: `validatePour`(턴/페이즈/rollCount/canPour) + **sanity**
  - `finalValues`: 길이 5, 정수 1–6.
  - trajectory: 프레임 수 상한(과대 payload 방지), 수치 유한성.
  - (전체 물리 정합성 검증은 하지 않음 — 비목표.)
- 서버 처리: `state.currentDiceValues = finalValues`, rollId/rollCount/turnPhase 전환(기존 `handlePour`의 상태 전이 재사용), trajectory를 **관전자에게만** `POUR_RESULT`로 relay.
- 자동플레이: 기존대로 서버 `simulatePour` 사용, 결과를 **양쪽**에 broadcast.

### 클라이언트 (턴 플레이어)
- 붓기 시 로컬 `simulatePour` 1회 → **최종 결과로 즉시 재생**(preview 개념 폐기).
- 재생 종료 후 로컬에서 placement 진입. 결과·trajectory를 서버로 전송.
- `POUR_REJECTED` 수신 시에만 롤백(드묾).

### 클라이언트 (관전자)
- 기존 `POUR_RESULT` 경로 + 250ms 지터버퍼로 relay된 trajectory 재생. 변경 최소.

### 정리/삭제 대상 (버그 유발 reconcile 머신 제거)
- `PhysicsDice.tsx`: `pendingAuthoritativeResult`, `commitAuthoritativePreviewResult`, **죽은 `authoritativeBlend` 경로**, `preview` 분기 — 클라 권위에선 reconcile 자체가 불필요해지므로 단순화.
- `socket.ts` `POUR_RESULT` 핸들러: 턴 플레이어(roller)는 자기 결과가 이미 final이므로 서버 relay를 적용하지 않도록 분기(또는 서버가 roller에 안 보냄).

### 영향 파일 (예상)
- `backend/src/GameActions.ts` — 인간 붓기: 클라 결과 수용 / 자동플레이: 서버 sim 분기.
- `backend/src/server.ts` — 신규 이벤트 핸들러 + 검증.
- `backend/src/ServerGameState.ts` — finalValues 수용 검증 보조.
- `frontend/src/components/3d/PhysicsCup.tsx` — 붓기 emit 페이로드(결과 포함)로 변경.
- `frontend/src/components/3d/PhysicsDice.tsx` — preview/reconcile 제거, 로컬 결과 final 처리.
- `frontend/src/network/socket.ts` — roller/spectator 분기.

---

## 리스크 / 미해결

- **자동플레이 분기 정확성**: 인간↔봇 전환 시 붓기 소스가 바뀜. waiting_pour 중 연결 끊김→봇 전환 경계에서 중복/누락 없는지 확인 필요. (중간 확신)
- **셰이크→붓기 연속성**: Phase 1+2 모두 적용 시 관전자의 셰이크 dice와 붓기 시작 dice가 같은 소스(턴 플레이어)라 연속. 한쪽만 적용하면 핸드오프 불연속 가능 → **두 Phase 함께 가는 게 자연스러움**.
- **페이로드 크기**: trajectory blob은 현재도 서버→방 전송 중. 클라→서버→관전자로 경로만 바뀜. 압축(쿼터니언 smallest-three, 위치 고정소수점)은 **선택적 후속 최적화**이며 발산 원인과 무관. 연속 셰이크 스트림에서 우선 가치 있음.
- **롤백 UX**: `POUR_REJECTED` 시 로컬 결과를 되돌리는 연출 필요(빈도 낮음).

## 비목표

- 안티치트(결과 위조 방어). 필요 시 별도 검증/리플레이 레이어로 분리.
- 결정적 lockstep(부동소수 결정성 이슈로 고위험 — 채택 안 함).
