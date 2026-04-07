# Phase 0: 컵 기본 위치 이동 — 상세 구현 계획서

> **작성일**: 2026-04-06
> **전제**: Rapier 물리 엔진 전환 완료, cup-animation-redesign.md의 사전 작업
> **목적**: 컵과 주사위의 초기 위치를 보드 바깥 오른편으로 이동하고, 관련된 모든 참조를 일괄 수정

---

## 개요

현재 컵은 보드 중앙 `(0, 5, 0)`에서 시작한다. 이를 보드 오른쪽 바깥 `(CUP_REST_X, CUP_REST_Y, CUP_REST_Z)` = `(12, 5, 0)`으로 이동하는 것이 이 Phase의 전부이다.

이 작업은 후속 Phase(벽 토글, 애니메이션 개선, 붓기 보정)의 **기초**이며, 이것만으로도 다음을 변경해야 한다:

1. 공유 상수 추가 (core)
2. 백엔드 물리 월드의 컵/주사위/뚜껑 초기 위치 (backend)
3. 붓기 후 컵/뚜껑 리셋 위치 (backend)
4. 프론트엔드 컵 초기 위치 및 스냅 (frontend)
5. 프론트엔드 return-to-cup 애니메이션 목표 위치 (frontend)
6. 카메라 프레이밍 (frontend)

---

## Step 1: core/src/index.ts — 상수 추가

**파일**: `core/src/index.ts`
**위치**: `BOARD_CONSTANTS` 객체 (L23-44)

```typescript
// 추가할 상수 (CUP_REST_Y: 5 바로 아래에)
CUP_REST_X: 12,   // BOARD_SIZE/2(8) + WALL_THICKNESS(1) + gap(3) = 12
CUP_REST_Z: 0,
```

**변경 후 BOARD_CONSTANTS:**
```typescript
export const BOARD_CONSTANTS = {
  BOARD_SIZE: 16,
  BOARD_THICKNESS: 1,
  WALL_THICKNESS: 1,
  PLAY_WALL_HEIGHT: 2,
  TRAY_DEPTH: 4,
  TRAY_SLOT_COUNT: 5,
  TRAY_SLOT_SPACING: 3,
  PHYSICS_WALL_HEIGHT: 200,
  CUP_REST_Y: 5,
  CUP_REST_X: 12,
  CUP_REST_Z: 0,
} as const;
```

---

## Step 2: backend/src/physics/PhysicsWorld.ts — 물리 위치 변경

**파일**: `backend/src/physics/PhysicsWorld.ts`

### 2-a. import 및 destructure (파일 상단)

기존 `BOARD_CONSTANTS` import에서 `CUP_REST_X`, `CUP_REST_Y`, `CUP_REST_Z`를 destructure.

### 2-b. 주사위 초기 위치 (L168-169)

```typescript
// 변경 전 (L169):
.setTranslation(0, 5 + i, 0)

// 변경 후:
.setTranslation(CUP_REST_X, CUP_REST_Y + i, CUP_REST_Z)
```

### 2-c. 컵 body 초기 위치 (L186-187)

```typescript
// 변경 전 (L187):
.setTranslation(0, 5, 0)

// 변경 후:
.setTranslation(CUP_REST_X, CUP_REST_Y, CUP_REST_Z)
```

### 2-d. 뚜껑 body 초기 위치 (L293-294)

```typescript
// 변경 전 (L294):
.setTranslation(0, 5 + wallHeight / 2 + 0.5, 0)

// 변경 후:
.setTranslation(CUP_REST_X, CUP_REST_Y + wallHeight / 2 + 0.5, CUP_REST_Z)
```

### 2-e. simulatePour() 리셋 — 컵 (L615)

```typescript
// 변경 전 (L615):
this.cupBody.setNextKinematicTranslation({ x: 0, y: 5, z: 0 });

// 변경 후:
this.cupBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z });
```

### 2-f. simulatePour() 리셋 — 뚜껑 (L617)

```typescript
// 변경 전 (L617):
this.cupLidBody.setNextKinematicTranslation({ x: 0, y: 5 + 4.5, z: 0 });

// 변경 후:
this.cupLidBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y + 4.5, z: CUP_REST_Z });
```

### 자동 반영 (변경 불필요)

- `spawnDiceInCup()` (L308): `this.cupBody.translation()`을 참조하므로 컵 위치가 바뀌면 자동으로 새 위치 기준.
- `spawnNonKeptDiceInCup()`: 동일하게 `this.cupBody.translation()` 참조.
- `updateCupTransform()`: 클라이언트가 보내는 실시간 위치를 적용하므로 무관.

---

## Step 3: frontend/src/components/3d/PhysicsCup.tsx — 초기 위치 & 스냅

**파일**: `frontend/src/components/3d/PhysicsCup.tsx`

### 3-a. destructure 확장 (L7)

```typescript
// 변경 전 (L7):
const { CUP_REST_Y } = BOARD_CONSTANTS;

// 변경 후:
const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;
```

### 3-b. 드래그 평면 (L16) — 변경 없음

```typescript
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUP_REST_Y);
```
Y 평면이므로 X/Z 변경과 무관. 변경 불필요.

### 3-c. 재생 완료 후 스냅 (L80)

```typescript
// 변경 전 (L80):
cupRef.current.position.set(0, CUP_REST_Y, 0);

// 변경 후:
cupRef.current.position.set(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
```

### 3-d. JSX 초기 위치 (L107)

```typescript
// 변경 전 (L107):
position={[0, CUP_REST_Y, 0]}

// 변경 후:
position={[CUP_REST_X, CUP_REST_Y, CUP_REST_Z]}
```

---

## Step 4: frontend/src/components/3d/PhysicsDice.tsx — return-to-cup 목표 위치

**파일**: `frontend/src/components/3d/PhysicsDice.tsx`

### 4-a. cupOffsets 변경 (L306-314)

```typescript
// 변경 전 (L308-313):
const cupOffsets = [
  { x: -1.2, y: cupY - 2.5, z: -1.2 },
  { x: 1.2, y: cupY - 2.5, z: -1.2 },
  { x: -1.2, y: cupY - 2.5, z: 1.2 },
  { x: 1.2, y: cupY - 2.5, z: 1.2 },
  { x: 0.0, y: cupY - 0.5, z: 0.0 },
];

// 변경 후:
const cupX = BOARD_CONSTANTS.CUP_REST_X;
const cupZ = BOARD_CONSTANTS.CUP_REST_Z;
const cupOffsets = [
  { x: cupX - 1.2, y: cupY - 2.5, z: cupZ - 1.2 },
  { x: cupX + 1.2, y: cupY - 2.5, z: cupZ - 1.2 },
  { x: cupX - 1.2, y: cupY - 2.5, z: cupZ + 1.2 },
  { x: cupX + 1.2, y: cupY - 2.5, z: cupZ + 1.2 },
  { x: cupX,       y: cupY - 0.5, z: cupZ       },
];
```

> `BOARD_CONSTANTS`는 이 파일에서 이미 import되어 있음 (L306에서 `BOARD_CONSTANTS.CUP_REST_Y` 사용 중).

---

## Step 5: frontend/src/components/GameScene.tsx — 카메라 프레이밍

**파일**: `frontend/src/components/GameScene.tsx`

### 문제

현재 카메라는 보드+트레이를 중심으로 대칭 구도 (centerX = 0). 컵이 x=12에 있으면:
- 왼쪽 끝: `-(BOARD_SIZE/2 + WALL_THICKNESS)` = **-9**
- 오른쪽 끝: `CUP_REST_X + cupVisualRadius(~5)` ≈ **17**
- 기존 boardWidth(18)으로는 오른쪽이 잘림.

### 5-a. 상수 변경 (L12-26)

```typescript
// 변경 전 (L12-26):
const {
  BOARD_SIZE,
  WALL_THICKNESS,
  TRAY_DEPTH,
  PLAY_WALL_HEIGHT,
} = BOARD_CONSTANTS;

const boardWidth  = BOARD_SIZE + WALL_THICKNESS * 2;           // 18
const boardLength = BOARD_SIZE + WALL_THICKNESS * 3 + TRAY_DEPTH; // 23
const cameraZ     = -(TRAY_DEPTH / 4);                         // -1.0
const lookAtZ     = -(TRAY_DEPTH / 2 + WALL_THICKNESS / 2);    // -2.5

// 변경 후:
const {
  BOARD_SIZE,
  WALL_THICKNESS,
  TRAY_DEPTH,
  PLAY_WALL_HEIGHT,
  CUP_REST_X,
} = BOARD_CONSTANTS;

const leftEdge   = -(BOARD_SIZE / 2 + WALL_THICKNESS);         // -9
const rightEdge  = CUP_REST_X + 5;                              // 17 (cup visual radius ~5)
const centerX    = (leftEdge + rightEdge) / 2;                   // 4
const boardWidth = rightEdge - leftEdge;                         // 26

const boardLength = BOARD_SIZE + WALL_THICKNESS * 3 + TRAY_DEPTH; // 23 (변경 없음)
const cameraZ     = -(TRAY_DEPTH / 4);                           // -1.0 (변경 없음)
const lookAtZ     = -(TRAY_DEPTH / 2 + WALL_THICKNESS / 2);      // -2.5 (변경 없음)
```

### 5-b. ResponsiveCameraManager — X 오프셋 (L49-50)

```typescript
// 변경 전 (L49-50):
camera.position.set(0, cameraY, cameraZ);
camera.lookAt(0, 0, lookAtZ);

// 변경 후:
camera.position.set(centerX, cameraY, cameraZ);
camera.lookAt(centerX, 0, lookAtZ);
```

### 5-c. Canvas 초기 카메라 (L62)

```typescript
// 변경 전 (L62):
camera={{ position: [0, BOARD_SIZE + PLAY_WALL_HEIGHT * 2 + 1, cameraZ], fov: 45 }}

// 변경 후:
camera={{ position: [centerX, BOARD_SIZE + PLAY_WALL_HEIGHT * 2 + 1, cameraZ], fov: 45 }}
```

### 5-d. OrbitControls target (L91)

```typescript
// 변경 전 (L91):
target={[0, 0, -2.5]}

// 변경 후:
target={[centerX, 0, lookAtZ]}
```

### 카메라 높이 영향 분석

| 환경 | 기존 | 변경 후 | 영향 |
|------|------|---------|------|
| 데스크톱 (16:9) | boardLength(23) 기준 | boardLength(23) 기준 (aspect>1이므로) | **변화 없음** |
| 모바일 세로 (9:16) | boardWidth(18)/aspect 기준 | boardWidth(26)/aspect 기준 | 카메라 ~44% 높아짐 |

> 모바일에서 카메라가 너무 높으면 `CUP_REST_X`를 11이나 10으로 줄여 조정 가능. 실제 테스트 후 결정.

---

## Step 6: core 빌드

상수 추가 후 core 패키지를 빌드해야 frontend/backend에서 참조 가능:

```bash
cd C:/yacht/core && npm run build
```

---

## 수정 파일 요약

| Step | 파일 | 변경 내용 | 줄 수 |
|------|------|-----------|-------|
| 1 | `core/src/index.ts` | `CUP_REST_X`, `CUP_REST_Z` 상수 추가 | L42-43 |
| 2-b | `backend/src/physics/PhysicsWorld.ts` | 주사위 초기 위치 | L169 |
| 2-c | 〃 | 컵 body 초기 위치 | L187 |
| 2-d | 〃 | 뚜껑 초기 위치 | L294 |
| 2-e | 〃 | simulatePour 컵 리셋 | L615 |
| 2-f | 〃 | simulatePour 뚜껑 리셋 | L617 |
| 3-a | `frontend/src/components/3d/PhysicsCup.tsx` | destructure 확장 | L7 |
| 3-c | 〃 | 재생 완료 스냅 위치 | L80 |
| 3-d | 〃 | JSX 초기 위치 | L107 |
| 4-a | `frontend/src/components/3d/PhysicsDice.tsx` | return-to-cup 오프셋 | L308-313 |
| 5-a | `frontend/src/components/GameScene.tsx` | boardWidth, centerX 계산 | L12-26 |
| 5-b | 〃 | 카메라 position/lookAt X 오프셋 | L49-50 |
| 5-c | 〃 | Canvas 초기 카메라 X | L62 |
| 5-d | 〃 | OrbitControls target X | L91 |

---

## 검증 체크리스트

- [ ] 서버 시작 시 컵이 (12, 5, 0)에 생성됨
- [ ] 주사위 5개가 컵 안에 정상 배치됨 (x=12 근처)
- [ ] 뚜껑이 컵 위에 정상 위치
- [ ] 컵 드래그 → 보드 위로 이동 가능
- [ ] 붓기 후 컵이 (12, 5, 0)으로 리셋됨
- [ ] return-to-cup 애니메이션이 (12, 5, 0) 근처로 주사위를 이동시킴
- [ ] 카메라가 보드 + 컵 영역을 모두 포함 (데스크톱)
- [ ] 카메라가 보드 + 컵 영역을 모두 포함 (모바일 세로)
- [ ] tsc --noEmit 통과 (core, frontend, backend 모두)

---

## 주의사항

1. **이 Phase에서는 붓기 애니메이션 로직을 변경하지 않는다.** 기존 2-phase 애니메이션은 그대로 유지. Phase 3에서 전면 교체.
2. **벽 토글도 이 Phase에서 하지 않는다.** Phase 2에서 처리. 즉, 이 Phase만 적용하면 컵이 벽 바깥에서 시작하므로 드래그 시 주사위가 벽에 걸릴 수 있다 — Phase 2가 해결.
3. **카메라 값(centerX=4, boardWidth=26)은 초기값.** 실제 렌더링 후 미세 조정 필요. CUP_REST_X 자체를 조정할 수도 있음.
