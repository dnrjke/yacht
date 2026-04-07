# Rapier 물리 엔진 전환 계획서

> **작성일**: 2026-04-06
> **목적**: cannon-es → Rapier 전환을 통한 터널링 문제 근본 해결
> **범위**: backend 서버 사이드 물리 (PhysicsWorld.ts) 전면 교체

---

## 1. 전환 동기

### 현재 문제
- cannon-es의 kinematic body는 `position.set()`으로 **텔레포트**됨
- `world.step()` 서브스텝 간 kinematic 보간이 없어, cup을 빠르게 움직이면 주사위가 벽을 관통
- cannon-es에는 **CCD(Continuous Collision Detection)가 없음** (GitHub Issue #93, 2021~ 미해결)
- cannon-es는 사실상 유지보수 중단 상태

### Rapier 선택 이유
| 항목 | cannon-es | Rapier |
|------|-----------|--------|
| CCD | 없음 | Full CCD + Soft CCD |
| Kinematic 처리 | 텔레포트 (수동 보간 필요) | `KinematicPositionBased` — 자동 속도 추론 |
| 엔진 | JS (single-thread) | Rust → WASM (SIMD 지원) |
| 유지보수 | 중단 | 활발 (2025-2026 로드맵) |
| 성능 | 보통 | 2-5x 빠름 |

---

## 2. 아키텍처 영향 범위

### 변경 대상 (backend만)
```
backend/
  src/
    physics/
      PhysicsWorld.ts   ← 전면 재작성 (유일한 cannon-es 사용처)
  package.json          ← cannon-es 제거, @dimforge/rapier3d-compat 추가
```

### 최소 변경 (backend/server.ts)
- `server.ts` — WASM 비동기 초기화를 위해 `async main()` 래핑 필요. 소켓 핸들러, setInterval, httpServer.listen 모두 `await RAPIER.init()` 이후에 위치해야 함.

### 변경 없음 (frontend)
- `PhysicsCup.tsx` — 소켓으로 position/quaternion만 전송, 물리 엔진 무관
- `PhysicsDice.tsx` — 서버에서 받은 궤적 재생만 담당, 물리 엔진 무관
- `PhysicsBoard.tsx` — 순수 Three.js 메시, 물리 무관
- `gameStore.ts` — 상태 관리, 물리 무관

**핵심: PhysicsWorld의 public 인터페이스를 동일하게 유지하면 frontend 코드 변경이 0이다. server.ts는 async 래핑만 필요.**

### 유지해야 할 Public 인터페이스
```typescript
class PhysicsWorld {
  // 상태
  diceInCup: boolean[];
  keptDice: boolean[];
  currentDiceValues: number[];

  // 메서드
  spawnDiceInCup(): void;
  spawnNonKeptDiceInCup(keptIndices: (number | null)[]): void;
  collectDice(dieIndex: number): void;
  updateCupTransform(position, quaternion): void;
  step(): void;
  getDiceStates(): Array<{ position, quaternion }>;
  checkCollection(): void;
  allDiceInCup(): boolean;
  allDiceReadyToPour(): boolean;
  simulatePour(cupPosition, cupQuaternion): PourResult;
  simulateRoll(throwVelocity, throwAngular): { trajectory, finalValues };
}
```

---

## 3. 패키지 변경

### 설치
```bash
cd backend
npm install @dimforge/rapier3d-compat
npm uninstall cannon-es
```

> `@dimforge/rapier3d-compat`는 WASM을 JS에 인라인 번들하여 별도 .wasm 파일 로딩이 불필요.
> Node.js 서버에서 바로 사용 가능.

### WASM 초기화
```typescript
import RAPIER from '@dimforge/rapier3d-compat';

// 서버 시작 시 1회 호출 (비동기)
await RAPIER.init();
```

`server.ts`에서 PhysicsWorld 생성 전에 `RAPIER.init()` await 필요.
RAPIER 모듈은 PhysicsWorld 내부에서 import하여 server.ts의 RAPIER 직접 의존을 제거.

```typescript
// PhysicsWorld.ts 내부
import RAPIER from '@dimforge/rapier3d-compat';

export class PhysicsWorld {
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }
  // ...
}

// server.ts 변경
const gamePhysics = await PhysicsWorld.create();
```

---

## 4. PhysicsWorld 재작성 상세

### 4-1. World 생성

```typescript
// cannon-es (기존)
this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 4.0, 0) });

// Rapier (신규)
this.world = new RAPIER.World({ x: 0, y: -9.82 * 4.0, z: 0 });
```

### 4-2. 바닥 (Floor)

```typescript
// cannon-es: Plane + 회전
const floorBody = new CANNON.Body({ mass: 0 });
floorBody.addShape(new CANNON.Plane());
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);

// Rapier: Cuboid (얇은 박스)
const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
const floorBody = this.world.createRigidBody(floorDesc);
const floorCollider = RAPIER.ColliderDesc.cuboid(50, 0.5, 50);
this.world.createCollider(floorCollider, floorBody);
```

### 4-3. 보드 벽 (Border Walls) + 천장 (Ceiling)

동일한 Box 기하학 유지. cannon-es `Body({ mass: 0 })` → Rapier `RigidBodyDesc.fixed()`.

```typescript
// 벽 (기존 4방향 + 천장을 하나의 fixed body에 compound)
const wallDesc = RAPIER.RigidBodyDesc.fixed();
const wallBody = this.world.createRigidBody(wallDesc);

// 각 벽 콜라이더를 offset으로 추가
const shape = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
  .setTranslation(offsetX, offsetY, offsetZ);
this.world.createCollider(shape, wallBody);

// ★ 천장 콜라이더 (PHYSICS_WALL_HEIGHT=200 높이에 위치, 주사위 상방 탈출 방지)
const ceilingHalfSize = (BOARD_SIZE + WALL_THICKNESS * 2) / 2 + 10;
const ceilingCollider = RAPIER.ColliderDesc.cuboid(ceilingHalfSize, 0.5, ceilingHalfSize)
  .setTranslation(0, PHYSICS_WALL_HEIGHT, 0);
this.world.createCollider(ceilingCollider, wallBody);
```

### 4-4. 주사위 (Dice) — 핵심: CCD 활성화

```typescript
for (let i = 0; i < 5; i++) {
  const diceDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 5 + i, 0)
    .setCcdEnabled(true);                    // ★ CCD 활성화
  const diceBody = this.world.createRigidBody(diceDesc);

  const diceCollider = RAPIER.ColliderDesc.cuboid(1.0, 1.0, 1.0)
    .setMass(8)
    .setFriction(0.3)
    .setRestitution(0.3);
  this.world.createCollider(diceCollider, diceBody);
}
```

### 4-5. 야추통 (Cup) — 핵심: KinematicPositionBased

```typescript
const cupDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
  .setTranslation(0, 5, 0);
this.cupBody = this.world.createRigidBody(cupDesc);

// 바닥
const baseCollider = RAPIER.ColliderDesc.cylinder(0.5, 4.0)
  .setTranslation(0, -4, 0);
this.world.createCollider(baseCollider, this.cupBody);

// 8개 벽 세그먼트 (기존과 동일한 기하학)
const segmentCount = 8;
const segmentAngle = (2 * Math.PI) / segmentCount;
const innerRadius = 4.0;
const wallThickness = 4.0;
const wallHeight = 8.0;
const segmentWidth = 2 * innerRadius * Math.tan(segmentAngle / 2);

for (let i = 0; i < segmentCount; i++) {
  const angle = i * segmentAngle;
  const wallCenterRadius = innerRadius + wallThickness / 2;
  const wx = Math.sin(angle) * wallCenterRadius;
  const wz = Math.cos(angle) * wallCenterRadius;

  const wallCollider = RAPIER.ColliderDesc.cuboid(
    segmentWidth / 2, wallHeight / 2, wallThickness / 2
  )
    .setTranslation(wx, 0, wz)
    .setRotation(quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle));

  this.world.createCollider(wallCollider, this.cupBody);
}
```

**`KinematicPositionBased`의 동작 원리:**
- `setNextKinematicTranslation(pos)`을 호출하면, Rapier가 **현재 위치→목표 위치의 속도를 자동 계산**
- 다음 `world.step()` 시 cup이 그 속도로 **연속적으로 이동**
- 이동 경로상의 모든 충돌이 감지됨 (텔레포트 아님)

### 4-6. 뚜껑 (Lid)

```typescript
const lidDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
  .setTranslation(0, 5 + wallHeight / 2 + 0.5, 0);
this.cupLidBody = this.world.createRigidBody(lidDesc);

const lidCollider = RAPIER.ColliderDesc.cylinder(0.5, innerRadius + wallThickness);
this.world.createCollider(lidCollider, this.cupLidBody);
```

### 4-7. updateCupTransform 변경

```typescript
// cannon-es (기존) — 텔레포트
updateCupTransform(position, quaternion) {
  this.cupBody.position.set(position.x, position.y, position.z);
  this.cupBody.quaternion.set(...);
}

// Rapier (신규) — 자동 속도 추론
updateCupTransform(position, quaternion) {
  this.cupBody.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
  this.cupBody.setNextKinematicRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

  // 뚜껑도 동일하게
  const lidOffset = rotateVec3ByQuat({ x: 0, y: 4.0, z: 0 }, quaternion);
  this.cupLidBody.setNextKinematicTranslation({
    x: position.x + lidOffset.x,
    y: position.y + lidOffset.y,
    z: position.z + lidOffset.z,
  });
  this.cupLidBody.setNextKinematicRotation(quaternion);
}
```

### 4-8. step 변경

```typescript
// cannon-es (기존)
step() {
  for (let i = 0; i < this.subSteps; i++) {
    this.world.step(this.subStepDt);
  }
}

// Rapier (신규) — CCD가 터널링을 방지하므로 단일 step으로 충분
step() {
  this.world.step();  // timestep = 1/60 (기본값)
}
```

> Rapier의 `world.step()`은 기본 `timestep = 1/60`이며, CCD가 활성화된 body에 대해 자동으로 연속 충돌 감지를 수행한다. 서브스텝 수동 관리 불필요.
>
> **시뮬레이션 안정성 참고**: CCD로 터널링은 해결되지만, 접촉 해석 품질(스태킹 안정성 등)이 1/60s timestep에서 부족할 경우, Rapier에서도 sub-stepping 유지가 가능하다:
> ```typescript
> // 필요 시 sub-stepping 옵션
> this.world.timestep = 1/240;
> for (let i = 0; i < 4; i++) this.world.step();
> ```
> simulatePour/simulateRoll 내부의 프레임별 step 호출도 동일한 패턴으로 통일할 것.

### 4-9. getDiceStates (변경 최소)

```typescript
getDiceStates() {
  return this.diceBodies.map(body => {
    const pos = body.translation();
    const rot = body.rotation();
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      quaternion: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    };
  });
}
```

### 4-10. simulatePour / simulateRoll

로직 흐름은 동일하게 유지. API 차이점 매핑:

| cannon-es | Rapier |
|-----------|--------|
| `body.position.set(x,y,z)` | `body.setTranslation({x,y,z}, true)` |
| `body.quaternion.set(x,y,z,w)` | `body.setRotation({x,y,z,w}, true)` |
| `body.velocity.set(x,y,z)` | `body.setLinvel({x,y,z}, true)` |
| `body.angularVelocity.set(x,y,z)` | `body.setAngvel({x,y,z}, true)` |
| `body.wakeUp()` | `body.wakeUp()` |
| `body.sleepState === SLEEPING` | `body.isSleeping()` |
| `body.type = STATIC` | `body.setBodyType(RAPIER.RigidBodyType.Fixed, true)` |
| `body.type = DYNAMIC` | `body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)` |
| `body.fixedRotation = true` | `body.lockRotations(true, true)` |
| `body.fixedRotation = false` | `body.lockRotations(false, true)` |
| `body.updateMassProperties()` | 불필요 — `setBodyType`/`lockRotations` 두 번째 인자 `true`가 자동 갱신 |
| `world.step(dt)` | `world.step()` 또는 `world.timestep = dt; world.step()` |
| `quat.vmult(vec, out)` | `rotateVec3ByQuat(vec, quat)` — 공통 유틸리티 함수 (아래 참조) |
| `quat.setFromVectors(from, to)` | `quatFromVectors(from, to)` — 공통 유틸리티 함수 (아래 참조) |

**fixedRotation 사용처** (4곳 모두 전환 필요):
- `spawnNonKeptDiceInCup()`: 컵 안 주사위에 `lockRotations(true, true)` → 굴리기 전 면 변경 방지
- `simulatePour()`: pour 시작 시 `lockRotations(false, true)`로 해제
- `updateCupTransform()`: 컵 이동 시 `lockRotations(false, true)`로 해제
- `simulateRoll()`: roll 시작 시 `lockRotations(false, true)`로 해제

### 4-10a. 공통 유틸리티 함수

cannon-es는 `Vec3`, `Quaternion` 클래스에 벡터 연산이 내장되어 있지만, Rapier는 plain object `{x,y,z,w}`만 반환한다. 다음 유틸리티가 필요하며, PhysicsWorld.ts 상단 또는 별도 `mathUtils.ts`에 배치:

```typescript
/** 쿼터니언으로 벡터를 회전 (cannon-es quat.vmult 대체) */
function rotateVec3ByQuat(
  v: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number }
): { x: number; y: number; z: number } {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** from 벡터를 to 벡터로 회전하는 쿼터니언 (cannon-es Quaternion.setFromVectors 대체) */
function quatFromVectors(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
): { x: number; y: number; z: number; w: number } {
  // cross product
  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  // dot product
  const dot = from.x * to.x + from.y * to.y + from.z * to.z;
  const w = 1 + dot;
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz + w * w);
  return { x: cx / len, y: cy / len, z: cz / len, w: w / len };
}

/** Y축 기준 회전 쿼터니언 (cup wall segment 배치용) */
function quatFromAxisAngle(
  axis: { x: number; y: number; z: number },
  angle: number
): { x: number; y: number; z: number; w: number } {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}
```

**사용처:**
- `rotateVec3ByQuat`: `updateCupTransform` (lid offset), `getFinalDiceValues` (면 법선 회전), `snapRotationToValue`
- `quatFromVectors`: `snapRotationToValue` (특정 면을 위로 정렬)
- `quatFromAxisAngle`: cup wall segment 배치 (생성자)

### 4-11. Sleep 설정

```typescript
// cannon-es (기존)
dice.allowSleep = true;
dice.sleepSpeedLimit = 0.1;
dice.sleepTimeLimit = 0.5;

// Rapier (신규)
// RigidBodyDesc 생성 시:
diceDesc.setCanSleep(true);

// World-level sleep 임계값 조정 (IntegrationParameters):
// Rapier의 sleep 임계값은 world.integrationParameters로 접근 가능.
// 기본값이 대부분 적절하지만, 필요 시:
//   this.world.integrationParameters.minIslandSize  (기본 128)
// 등을 조정할 수 있음.

// ★ 핵심: simulatePour/simulateRoll의 calm-frame 수동 체크 로직은 그대로 유지.
// Rapier의 자동 sleep은 보조 수단으로만 활용하고, 정착 판정은 기존
// speedThresholdSq + requiredCalmFrames 방식을 동일하게 사용한다.
// 속도 체크: body.linvel(), body.angvel() → lengthSquared 계산
```

---

## 5. server.ts 변경사항

```typescript
// 기존
const gamePhysics = new PhysicsWorld();

// 변경 — 비동기 초기화
import { PhysicsWorld } from './physics/PhysicsWorld';

async function main() {
  // ★ RAPIER.init()은 PhysicsWorld.create() 내부에서 호출됨
  const gamePhysics = await PhysicsWorld.create();

  // ★ 중요: 아래 모든 코드가 await 이후에 위치해야 함
  // - io.on('connection', ...) — 소켓 핸들러 등록
  // - setInterval(() => { gamePhysics.step(); ... }, 1000/60) — 물리 루프
  // - httpServer.listen(PORT, ...) — 서버 리스닝

  io.on('connection', (socket) => { /* 기존과 동일 */ });
  setInterval(() => { /* 기존과 동일 */ }, 1000 / 60);
  httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

main();
```

> `io.on('connection')`, `setInterval`, `httpServer.listen` 의 **코드 내용**은 변경 없음. 단, 모두 `await PhysicsWorld.create()` 이후에 위치해야 함.

---

## 6. 구현 단계 (권장 순서)

### Phase 1: 패키지 교체 & 스켈레톤 (30분)
1. `npm install @dimforge/rapier3d-compat` (backend)
2. `server.ts`에 `RAPIER.init()` async wrapper 추가
3. `PhysicsWorld.ts` 파일 백업 후 빈 클래스 생성 (동일 인터페이스)

### Phase 2: 정적 월드 구축 (30분)
1. World, Floor, Border Walls, Ceiling 생성
2. 기존 `BOARD_CONSTANTS` 수치 그대로 사용
3. 테스트: 서버 시작, 월드 생성 확인

### Phase 3: 주사위 & 야추통 (1시간)
1. 주사위 5개 (Dynamic + CCD)
2. 야추통 (KinematicPositionBased, 8-segment compound)
3. 뚜껑 (KinematicPositionBased)
4. `spawnDiceInCup()`, `updateCupTransform()`, `step()`, `getDiceStates()` 구현
5. 테스트: 브라우저에서 cup 드래그, 주사위가 컵 안에서 흔들리는지 확인
6. **터널링 테스트: cup을 최대한 빠르게 흔들어 주사위 관통 여부 확인**

### Phase 4: Pour & Roll 시뮬레이션 (1시간)
1. `simulatePour()` 포팅 (틸트 → 리프트 → 정착)
2. `simulateRoll()` 포팅 (임펄스 → 정착)
3. `getFinalDiceValues()` (동일 로직)
4. `snapRotationToValue()` (동일 로직)
5. 테스트: 전체 게임 플로우 (흔들기 → 쏟기 → 배치 → 키핑 → 재굴림)

### Phase 5: 엣지 케이스 & 정리 (30분)
1. `collectDice()`, `checkCollection()`, `spawnNonKeptDiceInCup()` 포팅
2. kept dice의 Static ↔ Dynamic 전환
3. `cannon-es` 패키지 제거
4. 최종 전체 플로우 테스트

---

## 7. 검증 체크리스트

- [ ] 서버 시작 시 WASM 초기화 성공
- [ ] cup 드래그 시 주사위가 자연스럽게 흔들림
- [ ] **cup을 최대한 빠르게 흔들어도 주사위가 벽을 관통하지 않음**
- [ ] cup 쏟기(pour) 시 주사위가 바닥에 자연스럽게 쏟아짐
- [ ] 쏟기 후 주사위가 정지하고 올바른 면 값이 결정됨
- [ ] 키핑 트레이에 주사위 이동/복귀 정상 작동
- [ ] kept dice는 Static으로 고정되어 굴림 시 밀리지 않음
- [ ] 멀티 클라이언트에서 동일한 궤적 재생 확인
- [ ] 60Hz 물리 루프 성능 유지 (Node.js WASM 오버헤드 확인)

---

## 8. 롤백 계획

- 기존 `PhysicsWorld.ts`를 `PhysicsWorld.cannon.ts`로 백업
- `package.json`에 cannon-es를 devDependencies로 유지 (전환 완료 시 제거)
- 문제 발생 시 import만 변경하여 즉시 롤백 가능

---

## 9. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| WASM 초기화 시간 | 서버 cold start 1-2초 증가 | 서버 시작 시 1회만 발생, 무시 가능 |
| Node.js WASM 호환성 | WASM SIMD 미지원 시 성능 저하 | `@dimforge/rapier3d-compat`는 non-SIMD 폴백 포함 |
| Rapier sleep 임계값 미세 조정 | pour/roll 정착 감지 지연 | 기존 calm-frame 수동 체크 로직 유지 |
| Compound collider 성능 | 8-segment cup이 무거울 수 있음 | cannon-es에서도 동일 구조, Rapier가 더 빠름 |
| Cylinder 콜라이더 미지원 가능성 | cup base/lid 형상 | Rapier는 cylinder 지원함. 미지원 시 ConvexHull로 대체 |
