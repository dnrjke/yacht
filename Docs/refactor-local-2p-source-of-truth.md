# 로컬 2P 리팩터링: Source of Truth 확립 + 상태 머신 버그 수정

## Context

로컬 플레이로 확정된 상황에서 2P 턴 전환/주사위 소환이 불안정하다.
근본 원인은 (1) 동일한 위치 상수가 3곳에 하드코딩되어 발산 가능, (2) `endTurn()` 상태 전이 버그로 불가능한 플래그 조합이 발생하는 것.

---

## 변경 요약

| 파일 | 변경 | 이유 |
|---|---|---|
| `core/src/index.ts` | `CUP_DICE_OFFSETS` 상수 + `getTraySlotPosition()` 함수 추가 | 3곳 중복 제거, source of truth |
| `backend/src/physics/PhysicsWorld.ts` | 하드코딩 오프셋/트레이 공식 → core import로 교체 | 중복 제거 |
| `frontend/src/components/3d/PhysicsDice.tsx` | 하드코딩 오프셋/트레이 공식 → core import + COLLECT_TO_CUP 반복 emit 버그 수정 | 중복 제거 + 버그 수정 |
| `frontend/src/store/gameStore.ts` | `endTurn()` 내 `canPour: true` → `false` | canPour+isReturningToCup 동시 true 방지 |
| `frontend/src/components/3d/PhysicsCup.tsx` | 턴 가드 설계 의도 주석 | 문서화 |
| `backend/src/server.ts` | 서버 역할 명시 주석 | 문서화 |

---

## Phase 1: core — Source of Truth 상수 추출

### 1-A. `core/src/index.ts` 에 추가

```typescript
// 컵 내부 주사위 5개 상대 위치 (컵 중심 기준)
export const CUP_DICE_OFFSETS = [
  { x: -1.2, y: -2.5, z: -1.2 },
  { x:  1.2, y: -2.5, z: -1.2 },
  { x: -1.2, y: -2.5, z:  1.2 },
  { x:  1.2, y: -2.5, z:  1.2 },
  { x:  0.0, y: -0.5, z:  0.0 },
] as const;

// 트레이 슬롯 월드 좌표 계산
export function getTraySlotPosition(slotIdx: number): { x: number; y: number; z: number } {
  const { TRAY_SLOT_COUNT, TRAY_SLOT_SPACING, BOARD_SIZE, WALL_THICKNESS, TRAY_DEPTH } = BOARD_CONSTANTS;
  const trayStartX = -((TRAY_SLOT_COUNT - 1) * TRAY_SLOT_SPACING) / 2;
  const trayCenterZ = -(BOARD_SIZE / 2 + WALL_THICKNESS + TRAY_DEPTH / 2);
  return { x: trayStartX + slotIdx * TRAY_SLOT_SPACING, y: 1.0, z: trayCenterZ };
}
```

### 1-B. 교체 대상 (총 6곳)

| 위치 | 현재 | 변경 후 |
|---|---|---|
| `PhysicsWorld.ts` spawnDiceInCup (L330-336) | 하드코딩 offsets 배열 | `CUP_DICE_OFFSETS[i]` |
| `PhysicsWorld.ts` spawnNonKeptDiceInCup (L358-372) | 하드코딩 offsets + tray 공식 | `CUP_DICE_OFFSETS` + `getTraySlotPosition(slotIdx)` |
| `PhysicsWorld.ts` spawnNonKeptDiceInCup (L381-387) | 하드코딩 cupOffsets 배열 | `CUP_DICE_OFFSETS[cupSlot]` |
| `PhysicsDice.tsx` return animation (L349-355) | 하드코딩 cupOffsets 배열 | `CUP_DICE_OFFSETS[cupSlot] + CUP_REST` |
| `PhysicsDice.tsx` return animation (L359-361) | 하드코딩 tray 공식 | `getTraySlotPosition(slotIdx)` |
| `PhysicsDice.tsx` placement mode (L297-299) | 하드코딩 tray 공식 | `getTraySlotPosition(slotIdx)` |

---

## Phase 2: 상태 머신 버그 수정

### 2-A. `endTurn()` canPour 버그 — `gameStore.ts`

**현재 (L168-179):**
```typescript
endTurn: () => set((state) => ({
  ...
  canPour: true,           // BUG: 리턴 애니메이션 중인데 컵 조작 허용
  isReturningToCup: true,
  isSyncingDice: true,
  ...
}))
```

**수정:**
```typescript
canPour: false    // 리턴+동기화 완료(COLLECTION_DONE) 시 true로 복원
```

### 2-B. COLLECT_TO_CUP 반복 emit 버그 — `PhysicsDice.tsx`

**현재 (L402-412):** return 애니메이션 rawT>=1 도달 시 `returnAnim.current = null` 하지만
`isReturningToCup`은 여전히 true → 다음 프레임에서 새 returnAnim 생성 → 반복 emit

**수정:** rawT>=1 도달 시 `store.setIsReturningToCup(false)` 호출.
- `isReturningToCup = false` → 애니메이션 재진입 차단
- `isSyncingDice = true` 유지 → DICE_STATES 수신 차단 지속
- `COLLECTION_DONE` 수신 시 isSyncingDice=false, canPour=true (기존 로직)

**플래그 역할 정리:**
| 플래그 | 역할 | true 구간 |
|---|---|---|
| `isReturningToCup` | 리턴 애니메이션 제어 | endTurn() ~ 애니메이션 완료 |
| `isSyncingDice` | DICE_STATES 수신 차단 | endTurn() ~ COLLECTION_DONE |
| `canPour` | 컵 상호작용 게이트 | COLLECTION_DONE ~ 다음 endTurn() |

---

## Phase 3: 문서화 (코드 주석)

- `PhysicsCup.tsx`: canPour가 로컬 2P에서 암묵적 턴 가드 역할
- `server.ts`: 순수 물리 엔진 역할, 플레이어/턴/점수 무관

---

## 실행 순서

1. `core/src/index.ts` 수정 → `cd core && npm run build`
2. 나머지 5개 파일 수정 (상호 의존 없음)
3. 타입 검사: `npx tsc --noEmit` (core, frontend, backend)

## 검증

- P1 굴리기 → 점수 기록 → P2 턴 전환 → 컵에 주사위 정확히 소환 확인
- P2 굴리기 → 점수 기록 → P1 턴 복귀 확인
- 리턴 애니메이션 중 컵 드래그 시도 → 반응 없어야 함
- 콘솔에서 COLLECT_TO_CUP가 턴당 1회만 emit되는지 확인
