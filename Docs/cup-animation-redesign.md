# 야추통 붓기 애니메이션 재설계 계획서

> **작성일**: 2026-04-06
> **전제**: Rapier 물리 엔진 전환 완료 (`@dimforge/rapier3d-compat`)
> **목적**: 컵 기본 위치를 보드 바깥 오른편으로 이동하고, 붓기 애니메이션을 포물선 아크로 개선

---

## 현재 동작의 문제

### 위치 문제
1. 컵이 보드 중앙 `(0, 5, 0)`에 상주 → 카메라 시야 차단
2. 컵이 항상 보드 위에 있어 주사위 결과 확인 어려움

### 애니메이션 품질 문제
3. **끊어지는 2-phase 구조**: Phase 1(회전 40f) → [급정지] → Phase 2(수직 상승 20f). 회전이 완전히 멈춘 후 상승이 시작됨. 실제 컵 동작은 기울이기/들기/이동이 동시에 겹쳐야 자연스러움.
4. **130° 기울기 과도**: 실제 컵 붓기는 90~100°면 충분. 130°면 컵 바닥이 위를 향해 부자연스러움.
5. **선형 보간 (easing 없음)**: 모든 움직임이 등속 → 기계적 느낌.
6. **Phase 2에서 자세 고정**: 수직 상승 중 컵이 130° 기울어진 채 유지. 동시에 정립 복원되어야 자연스러움.

### 게임플레이 문제
7. **항상 왼쪽으로 기울임**: Z축 회전 고정. 컵이 보드 왼쪽 끝에 있어도 왼쪽으로 부어 주사위가 즉시 벽에 부딪혀 뭉침. 보드 중앙 방향으로 적응적이어야 함.

---

## 설계 요약

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| 컵 기본 위치 | `(0, 5, 0)` 보드 중앙 | `(CUP_REST_X, CUP_REST_Y, CUP_REST_Z)` 보드 오른쪽 바깥 |
| 붓기 애니메이션 | 2-phase 분리 (회전→수직상승) | 단일 연속 모션 (기울기+아크+정립 동시 진행) |
| 기울기 각도 | 130° (과도) | 100° (자연스러운 붓기) |
| 기울기 방향 | 항상 Z축 (왼쪽) | 컵→보드 중심 방향 적응적 |
| 보간 | 선형 (등속) | ease-in-out (가감속) |
| 오른쪽 벽 | 항상 활성 | 컵 통과 시 비활성, 주사위 정착 시 활성 |
| 벽 밖 붓기 | 미처리 | 최근접 유효 지점으로 보정 후 붓기 |

---

## Phase 0: 컵 기본 위치 이동 (기초 작업)

> **별도 상세 계획서**: [`Docs/cup-phase0-position-change.md`](cup-phase0-position-change.md)

### 목표
컵/주사위/뚜껑의 초기 위치를 보드 중앙 `(0, 5, 0)`에서 보드 바깥 오른편 `(CUP_REST_X, CUP_REST_Y, CUP_REST_Z)` = `(12, 5, 0)`으로 이동.
카메라를 비대칭 구도로 전환하여 확장된 영역을 포함.

### 변경 파일 요약
| 파일 | 변경 |
|------|------|
| `core/src/index.ts` | `CUP_REST_X: 12`, `CUP_REST_Z: 0` 상수 추가 |
| `backend/src/physics/PhysicsWorld.ts` | 컵/주사위/뚜껑 초기 위치 + simulatePour 리셋 위치 (5곳) |
| `frontend/src/components/3d/PhysicsCup.tsx` | 초기 위치, 재생 후 스냅 위치 |
| `frontend/src/components/3d/PhysicsDice.tsx` | return-to-cup 오프셋 |
| `frontend/src/components/GameScene.tsx` | boardWidth, centerX, 카메라 위치/lookAt/OrbitControls |

### 검증
- [ ] 컵이 보드 오른편 바깥에 표시됨
- [ ] 카메라가 보드 + 컵 영역을 모두 포함
- [ ] 컵 드래그 → 보드 위로 이동 가능
- [ ] 붓기 후 컵이 오른편 위치로 리셋
- [ ] return-to-cup 애니메이션이 새 위치로 주사위를 이동시킴

---

## Phase 1: 보이지 않는 벽 전체 on/off

### 목표
흔들기 중에는 컵이 보드 어디든 자유롭게 다닐 수 있도록 **보이지 않는 벽 4면 전체를 OFF**하고,
붓기/정착 시에는 **전체를 ON**하여 주사위 이탈을 방지한다.

### 핵심 원리
- 컵은 kinematic → 벽 무시. 문제는 **컵 안의 dynamic 주사위**가 벽에 걸림.
- 흔들기 중 주사위는 항상 컵 안 → 벽이 없어도 탈출 불가 (컵 벽 + 뚜껑이 가둠).
- 붓기 시 Phase 3 보정이 컵을 보드 안으로 이동시킨 뒤 쏟음 → 주사위는 보드 안에 착지.
- 따라서 벽 ON/OFF 분기는 단순: **흔들기=OFF, 그 외=ON**.

### 1-1. PhysicsWorld — 벽 collider 핸들 저장

기존 4방향 벽 collider를 배열로 보관:

```typescript
private borderWallColliders: RAPIER.Collider[] = [];

// 생성자에서 (기존 벽 생성 코드에 핸들 저장 추가):
this.borderWallColliders.push(
  this.world.createCollider(tbCollider().setTranslation(0, wallCenterY, -(halfBoard + hw)), wallBody),
  this.world.createCollider(tbCollider().setTranslation(0, wallCenterY,  (halfBoard + hw)), wallBody),
  this.world.createCollider(lrCollider().setTranslation(-(halfBoard + hw), wallCenterY, 0), wallBody),
  this.world.createCollider(lrCollider().setTranslation( (halfBoard + hw), wallCenterY, 0), wallBody),
);
// 천장은 토글 대상 아님 (항상 ON)
```

### 1-2. 토글 메서드

```typescript
private wallsEnabled = true;

setBorderWallsEnabled(enabled: boolean): void {
  if (this.wallsEnabled === enabled) return;
  this.wallsEnabled = enabled;
  for (const c of this.borderWallColliders) {
    c.setEnabled(enabled);
  }
}
```

### 1-3. 토글 타이밍 (단순)

| 시점 | 벽 상태 | 이유 |
|------|---------|------|
| 서버 시작 | **OFF** | 컵이 rest(보드 바깥)에 있고 주사위가 컵 안 |
| `updateCupTransform()` 수신 | **OFF** | 흔들기 중. 주사위는 컵+뚜껑 안 |
| `simulatePour()` 시작 직후 | **ON** | 보정(Phase 3) 완료 후, 기울기 시작 전에 벽 활성화 |
| `simulatePour()` 완료 | **OFF** | 컵이 rest 복귀. 다음 흔들기 대비 |
| `spawnDiceInCup()` | **OFF** | 주사위 텔레포트 (컵이 보드 바깥) |
| `spawnNonKeptDiceInCup()` | **OFF** | 주사위 텔레포트 (컵이 보드 바깥) |

> **원칙**: 주사위가 컵 밖(보드 위)에 있는 구간에만 ON. 나머지는 OFF.

### 검증
- [ ] 컵 드래그 시 4면 벽을 자유롭게 통과, 주사위가 걸리지 않음
- [ ] 붓기 후 주사위가 벽에 막혀 보드 안에 머무름
- [ ] spawnDiceInCup 시 주사위가 정상적으로 컵 안에 배치됨

---

## Phase 2: 붓기 애니메이션 전면 개선

### 목표
기존의 분리된 2-phase(회전→수직상승)를 **단일 연속 모션**으로 교체한다.
기울이기, 들어올리기, 수평 이동, 정립 복원이 **동시에 겹쳐** 자연스러운 한 동작으로 보이게 한다.

### 2-1. 설계 원칙

1. **단일 시간축**: t ∈ [0, 1] over 70 frames (~1.17초). 별도 phase 분리 없음.
2. **채널별 독립 easing**: 기울기/상승/수평이동/정립이 각각 다른 타이밍 곡선을 따름.
3. **적응적 기울기 방향**: 컵 위치 → 보드 중심(0,0) 방향으로 기울임.
4. **기울기 100°**: 130° → 100°로 감소.
5. **주사위 산포는 물리에 맡김**: 인위적 임펄스 없이 컵 애니메이션의 자연스러운 동작만으로 산포. 애니메이션 품질이 곧 산포 품질.

### 2-2. 타이밍 다이어그램

```
글로벌 t   0.0 ──────── 0.3 ──────── 0.6 ──────── 0.8 ──── 1.0
           │              │              │              │        │
기울기     ╔══ease-in═══▶ 100°──유지────╗              │        │
(tilt)     ║  0→100°                    ╚══ease-out═══▶ 0°      │
           ║                                                     │
상승(Y)    ║        ╔═══포물선 아크════════════════════════════╗  │
           ║        ║  정점: t≈0.5, +20u                      ║  │
           ║        ╚═════════════════════════════════════════╝  │
           ║                                                     │
수평(XZ)   ║              ╔══ease-in-out═══════════════════════╗│
→rest위치  ║              ║  현재pos → CUP_REST_X/Z           ║│
           ║              ╚═══════════════════════════════════╝│
           │                                                    │
정립복원   │                        ╔══ease-out════════════════╗│
(uprighting)                        ║  기울어진 → 정립(0,0,0,1)║│
                                    ╚═════════════════════════╝│
```

**핵심**: 기울기와 상승이 겹치고, 수평 이동은 기울기 후반부터 시작. 모든 것이 하나의 t로 제어.

### 2-3. 적응적 기울기 방향

기존: 항상 Z축 회전 (왼쪽으로 부음)
변경: 컵 위치에서 보드 중심 방향을 계산하여 기울기 축 결정

```typescript
// 컵→보드 중심 방향 벡터 (XZ 평면)
const dx = 0 - cupPosition.x;
const dz = 0 - cupPosition.z;
const dist = Math.sqrt(dx * dx + dz * dz);

// 기울기 축 = 중심방향과 수직인 수평축 (외적: direction × up)
// direction = (dx/dist, 0, dz/dist), up = (0,1,0)
// cross = (dz/dist, 0, -dx/dist)
const tiltAxis = dist > 0.1
  ? { x: dz / dist, y: 0, z: -dx / dist }
  : { x: 0, y: 0, z: 1 }; // 중앙이면 기본 Z축

// 이 축을 기준으로 100° 회전 → 컵 개구부가 보드 중심을 향함
```

### 2-4. 채널별 보간 수식

```typescript
const TOTAL_FRAMES = 70;
const TILT_ANGLE = (100 * Math.PI) / 180;
const ARC_PEAK_HEIGHT = 20;

// Easing 함수들
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

for (let f = 0; f < TOTAL_FRAMES; f++) {
  const t = (f + 1) / TOTAL_FRAMES;

  // ── 기울기 (tilt) ──
  // 0.0~0.3: ease-in 0→100°, 0.3~0.6: 유지, 0.6~1.0: ease-out 100°→0°
  let tiltAngle: number;
  if (t <= 0.3) {
    tiltAngle = TILT_ANGLE * easeIn(t / 0.3);
  } else if (t <= 0.6) {
    tiltAngle = TILT_ANGLE;
  } else {
    tiltAngle = TILT_ANGLE * (1 - easeOut((t - 0.6) / 0.4));
  }
  const tiltQuat = quatFromAxisAngle(tiltAxis, tiltAngle);
  const currentQuat = quatMultiply(startQuat, tiltQuat);

  // ── 수평 이동 (XZ → rest) ──
  // 0.0~0.3: 정지, 0.3~1.0: ease-in-out로 rest 위치까지
  const moveT = t <= 0.3 ? 0 : easeInOut((t - 0.3) / 0.7);
  const x = startPos.x + (restPos.x - startPos.x) * moveT;
  const z = startPos.z + (restPos.z - startPos.z) * moveT;

  // ── 높이 (Y: 포물선) ──
  // t=0.0~1.0 전체에 걸쳐 포물선. 정점 t≈0.45
  const baseY = startPos.y + (restPos.y - startPos.y) * t;
  const parabola = 4 * ARC_PEAK_HEIGHT * t * (1 - t);
  const y = baseY + parabola;

  this.cupBody.setNextKinematicTranslation({ x, y, z });
  this.cupBody.setNextKinematicRotation(currentQuat);

  for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(); }
  // ... trajectory 기록
}
```

### 2-5. 벽 ON 타이밍

```typescript
// simulatePour 시작 직후 (보정 완료, 기울기 시작 전):
this.setBorderWallsEnabled(true);

// 애니메이션 루프 (70f) + settle 루프 실행...

// simulatePour 완료 후:
this.setBorderWallsEnabled(false);
```

벽은 기울기 시작 전에 ON → settle 완료 후 OFF. 루프 내부에서 토글할 필요 없음.

### 2-6. 프론트엔드 변경 없음

`PhysicsCup.tsx`는 서버가 보낸 `cupTrajectory`를 그대로 재생하므로, 서버 측 궤적 변경만으로 자동 반영.

### 검증
- [ ] 컵이 하나의 연속된 동작으로 기울이기→아크→정립 수행 (끊김 없음)
- [ ] 기울기 방향이 보드 중심을 향함 (왼쪽 끝에서 부어도 중앙으로)
- [ ] 기울기가 자연스러운 각도(100°)에서 멈춤
- [ ] ease-in/out으로 가감속이 느껴짐
- [ ] 아크 끝에서 컵이 정립 상태로 rest 위치에 도착
- [ ] 주사위가 보드 안에서 정착 (벽에 막힘)

---

## Phase 3: 벽 밖 붓기 보정

### 목표
플레이어가 컵을 보드 벽 바깥(주로 오른편)에서 놓아 붓기를 시도하면,
주사위가 벽 밖 바닥에 떨어지는 문제를 방지한다.

### 핵심 규칙
> **붓기(pour) 시작 시점에 컵이 보드 경계 밖이면,
> 컵을 최근접 유효 지점으로 먼저 이동한 뒤 기울기를 시작한다.**

### 3-1. 유효 붓기 영역 정의

```typescript
// core/src/index.ts — BOARD_CONSTANTS에 추가
POUR_BOUNDARY_MARGIN: 2, // 벽 안쪽으로 2 units 여유

// 유효 붓기 영역: 벽 안쪽 margin만큼의 직사각형
// X: -(halfBoard - margin) ~ +(halfBoard - margin) = -6 ~ +6
// Z: -(halfBoard - margin) ~ +(halfBoard - margin) = -6 ~ +6
```

### 3-2. PhysicsWorld.simulatePour() — 보정 로직

`simulatePour()` 진입부에 clamp 로직 추가:

```typescript
simulatePour(cupPosition, cupQuaternion): PourResult {
  const { BOARD_SIZE, POUR_BOUNDARY_MARGIN } = BOARD_CONSTANTS;
  const halfBound = BOARD_SIZE / 2 - POUR_BOUNDARY_MARGIN; // 6

  // 벽 밖이면 최근접 유효 지점으로 보정
  const clampedPosition = {
    x: Math.max(-halfBound, Math.min(halfBound, cupPosition.x)),
    y: cupPosition.y,
    z: Math.max(-halfBound, Math.min(halfBound, cupPosition.z)),
  };

  const needsCorrection = (
    clampedPosition.x !== cupPosition.x ||
    clampedPosition.z !== cupPosition.z
  );

  if (needsCorrection) {
    // Phase 0: 빠른 슬라이드 보정 (15 프레임, ~0.25초)
    // 현재 위치 → 보정 위치로 직선 이동
    const correctionFrames = 15;
    for (let f = 0; f < correctionFrames; f++) {
      const t = (f + 1) / correctionFrames;
      const interpPos = {
        x: cupPosition.x + (clampedPosition.x - cupPosition.x) * t,
        y: cupPosition.y,
        z: cupPosition.z + (clampedPosition.z - cupPosition.z) * t,
      };
      this.cupBody.setNextKinematicTranslation(interpPos);
      this.cupBody.setNextKinematicRotation(cupQuaternion);

      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(); }
      diceTrajectory.push(this.getDiceStates());
      cupTrajectory.push({ position: interpPos, quaternion: cupQuaternion });
    }
  }

  // 이후 Phase 1 (기울이기)은 clampedPosition에서 시작
  const startPos = needsCorrection ? clampedPosition : cupPosition;
  // ... 기존 Phase 1, 2, 3 로직
}
```

### 3-3. 보정 중 벽 상태 & 주사위 관리

- 보정 슬라이드 동안 벽 상태: **OFF** (주사위가 컵 안에 있으므로 안전)
- 보정 중 주사위: 컵 안에서 lid가 있는 상태이므로 탈출 불가
  - 단, 보정 시작 전 lid를 제거하면 안 됨 → **lid 제거는 보정 완료 후, 기울기 시작 직전에 수행**
- 보정 완료 후 벽 ON → lid 제거 → 기울기 시작 (Phase 2의 2-5절과 동일)

### 3-4. 보정의 시각적 표현

- 보정 이동은 15프레임(~0.25초)의 짧은 직선 슬라이드 (easeOut 적용)
- 클라이언트는 `cupTrajectory`에 포함된 보정 프레임을 자연스럽게 재생
- 별도 클라이언트 코드 변경 불필요

### 검증
- [ ] 보드 중앙에서 붓기 → 보정 없이 정상 동작 (기존과 동일)
- [ ] 보드 오른편 바깥(x>6)에서 붓기 → 컵이 x=6으로 슬라이드 후 기울기 시작
- [ ] 보드 모서리 근처에서 붓기 → 적절히 clamp되어 주사위가 보드 안에 착지
- [ ] 보정 슬라이드가 자연스러워 보임 (급격한 텔레포트 아님)

---

## 수정 파일 요약

| Phase | 파일 | 변경 유형 |
|-------|------|-----------|
| 0 | `core/src/index.ts` | 상수 추가 (`CUP_REST_X`, `CUP_REST_Z`) |
| 0 | `backend/src/physics/PhysicsWorld.ts` | 컵/주사위/뚜껑 초기 위치, 리셋 위치 변경 |
| 0 | `frontend/src/components/3d/PhysicsCup.tsx` | 초기 위치, 재생 후 스냅 위치 |
| 0 | `frontend/src/components/3d/PhysicsDice.tsx` | return-to-cup 목표 위치 |
| 0 | `frontend/src/components/GameScene.tsx` | 카메라 비대칭 구도 전환 |
| 1 | `backend/src/physics/PhysicsWorld.ts` | borderWallColliders 배열, setBorderWallsEnabled 토글 메서드 |
| 2 | `backend/src/physics/PhysicsWorld.ts` | simulatePour() 전면 교체: 단일 연속 모션, 적응적 기울기, easing |
| 3 | `core/src/index.ts` | `POUR_BOUNDARY_MARGIN` 추가 |
| 3 | `backend/src/physics/PhysicsWorld.ts` | simulatePour() 진입부 clamp 로직 |

---

## 아키텍처 체크리스트

- [ ] 모노레포 경계: 상수 → core, 물리 → backend, 비주얼 → frontend
- [ ] 서버 권위: 붓기 궤적은 서버에서 사전 연산
- [ ] 결정론적 재생: 클라이언트는 서버 궤적을 그대로 재생
- [ ] 새 소켓 이벤트: 불필요 (기존 POUR_CUP / POUR_RESULT 유지)
- [ ] 매직넘버: 모두 BOARD_CONSTANTS로 상수화
- [ ] Rapier API: setNextKinematicTranslation, collider.setEnabled 활용
- [ ] 프론트엔드 물리 의존: 없음 (Three.js 렌더링만)

---

## 위험 요소 & 대응

| 위험 | 영향 | 대응 |
|------|------|------|
| 카메라 줌아웃으로 보드가 작아짐 | 가독성 저하 | lookAt X 오프셋으로 비대칭 구도 사용, 실제 비율 테스트 후 CUP_REST_X 미세 조정 |
| 벽 OFF 중 주사위 탈출 | 불가능 — 흔들기 중 주사위는 컵+뚜껑 안. 붓기 시 벽 ON 상태 | Phase 3 보정이 보드 안 붓기를 보장 |
| 포물선 아크 중 컵이 비주얼 벽과 겹침 | 시각적 부자연스러움 | 비주얼 벽 높이(PLAY_WALL_HEIGHT=2)가 낮아 컵(y=5+)이 항상 위로 지나감 → 문제 없음 |
| 보정 슬라이드가 어색하게 느껴짐 | UX 저하 | 보정 프레임 수(15) 및 easing 조정, 필요 시 곡선 보간 |
| easing 곡선 타이밍 부자연 | 동작이 부자연스러움 | 채널별 t 구간 경계(0.3, 0.6)를 상수화하여 미세 조정 용이하게 |
