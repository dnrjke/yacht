# 온라인 멀티플레이어 계획

## 목표

- 1:1 온라인 대전 (`gameMode: 'online'`) 추가
- 기존 로컬 2P / 싱글(AI) 모드 변경 없이 공존
- 서버 권위 모델: 서버가 턴·점수·주사위 값을 소유, 치팅 방지
- Koyeb 무료 티어에서 동시 수십 방 수용 가능한 경량 설계

## 현재 상태

| 항목 | 현재 | 비고 |
|---|---|---|
| 게임 모드 | `'local' \| 'single'` (gameStore에만 정의) | core에는 GameMode 없음 |
| GamePhase | `'LOBBY' \| 'MAIN_MENU' \| 'GAME' \| 'GAME_OVER'` | LOBBY = SplashScreen 용도 |
| 물리 엔진 | 프론트엔드 로컬 실행 | 백엔드에도 PhysicsWorld 잔존 (온라인용 보존) |
| 턴·점수 관리 | 전부 클라이언트 gameStore | 서버 검증 없음 |
| 방 매칭 | 없음 | 서버는 단일 PhysicsWorld |
| Socket.IO 이벤트 | CUP_TRANSFORM, POUR_CUP, POUR_RESULT, COLLECT_TO_CUP, COLLECTION_DONE, DICE_STATES | 방 구분 없이 broadcast (online에서 재설계) |
| 물리 이벤트 | physicsEngine.ts의 모듈 레벨 pub/sub (onPourResult/emitPourResult) | Socket.IO를 대체 |

## 아키텍처

### GameMode/GamePhase 타입 정비

**GameMode 이전**: 현재 `gameStore.ts`에만 정의된 `GameMode`를 `core/src/index.ts`로 이전. 서버도 GameMode를 알아야 하므로 core가 단일 진실 원천.

```typescript
// core/src/index.ts
export type GameMode = 'local' | 'single' | 'online';
```

마이그레이션: gameStore.ts의 `export type GameMode = ...` 삭제 → `import { GameMode } from '@yacht/core'`로 교체.

**GamePhase 확장**: 기존 `'LOBBY'`는 SplashScreen 전용. 온라인 로비는 새 phase 추가.

```typescript
// core/src/index.ts
export type GamePhase = 'LOBBY' | 'MAIN_MENU' | 'ONLINE_LOBBY' | 'GAME' | 'GAME_OVER';
```

App.tsx 라우팅 추가: `phase === 'ONLINE_LOBBY' && <LobbyScreen />`

### 서버 역할 확장

현재 "순수 물리 서버" → "게임 로직 권위 서버"로 격상.

```
┌─ Server ─────────────────────────────┐
│  RoomManager                         │
│    └─ Room[]                         │
│         ├─ id, code, players[2]      │
│         ├─ PhysicsWorld (방별 인스턴스)│
│         ├─ ServerGameState           │
│         │   ├─ currentTurn           │
│         │   ├─ rollCount             │
│         │   ├─ scores { p1, p2 }     │
│         │   ├─ currentDiceValues     │
│         │   └─ keptDiceSlots         │
│         └─ phase: waiting→playing→end│
└──────────────────────────────────────┘
```

서버가 소유하는 것:
- **턴 소유권**: 누구 차례인지, 클라이언트 요청이 현재 턴 플레이어의 것인지 검증
- **주사위 값**: simulatePour 결과의 finalValues를 서버가 보유
- **점수 기입**: 클라이언트가 카테고리 선택 → 서버가 `core/calculateScore()`로 재계산·검증 후 확정
- **게임 종료 판정**: 서버가 모든 카테고리 충족 여부 확인

클라이언트가 소유하는 것:
- 궤적 재생 (diceTrajectory, cupTrajectory)
- 컵 드래그 위치 (로컬 렌더링)
- UI 상태 (placement mode, combo 표시 등)

### 방별 PhysicsWorld 생명주기

```typescript
// RoomManager.ts

async createRoom(playerName: string, playerId: string, secret: string, socketId: string): Promise<Room> {
  if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
    throw new Error('server_full');  // CREATE_ROOM 거부
  }
  const physics = await PhysicsWorld.create();  // async: WASM init
  const room: Room = {
    id: generateId(),
    code: generateCode(),
    players: [{
      playerId,           // 클라이언트가 CREATE_ROOM 시 제공 (PlayerIdentity)
      secret,             // 재접속 인증용
      socketId,
      name: playerName,
      connected: true,
      disconnectedAt: null,
    }],
    physics,
    state: new ServerGameState(),
    disconnectTimer: null,
  };
  return room;
}

// 물리 루프 없음 — simulatePour() 호출 시에만 PhysicsWorld 사용
// 흔들기 중 주사위 상태는 클라이언트가 CUP_SHAKE_STATE로 직접 relay

destroyRoom(room: Room) {
  room.physics.world.free();  // Rapier WASM 메모리 해제
  this.rooms.delete(room.id);
}
```

- 방 생성 시 `PhysicsWorld.create()` (async)
- 서버는 60fps 물리 루프를 돌리지 않음 — POUR_CUP 수신 시 `simulatePour()`만 호출
- 흔들기 중 주사위 상태는 활성 클라이언트가 CUP_SHAKE_STATE로 상대에게 relay
- 양쪽 disconnect 또는 타임아웃 시 `destroyRoom()` → `world.free()` 호출로 WASM 메모리 해제
- idle 방 (대기 중 상대 미입장) 5분 타임아웃 후 자동 파괴

### 방 관리

```typescript
// backend/src/RoomManager.ts

interface Room {
  id: string;
  code: string;
  players: PlayerSlot[];          // reconnection-protocol.md 참조
  physics: PhysicsWorld;          // simulatePour() 전용
  state: ServerGameState;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}
```

- **동시 방 상한**: `MAX_ACTIVE_ROOMS = 25`. 초과 시 CREATE_ROOM 거부 + 사유 응답. Rapier WASM 인스턴스당 수 MB이므로 512MB 제한 내 안전 운용 (프로파일링 후 조정)
- **방 생성**: 플레이어 1이 CREATE_ROOM → 서버가 Room 생성, 6자리 숫자 코드 발급 (`generateCode()`: `Math.random().toString().slice(2,8)`, 기존 방 코드와 중복 시 재생성)
- **방 참가**: 플레이어 2가 JOIN_ROOM(code) → socket.io room join, 양쪽에 GAME_START emit
- **방 정리**: 양쪽 disconnect 시 Room 파괴, PhysicsWorld 해제. 한쪽만 끊기면 대기 → 타임아웃(30초) 후 승리 처리

socket.io의 `socket.join(roomId)` / `io.to(roomId).emit(...)` 활용으로 방 간 격리.

### Socket.IO 이벤트 설계

| 이벤트 | 방향 | 페이로드 | 설명 |
|---|---|---|---|
| `CREATE_ROOM` | C→S | `{ playerName, playerId, secret }` | 방 생성, 코드 발급 |
| `ROOM_CREATED` | S→C | `{ roomId, code }` | 대기 화면 표시 |
| `JOIN_ROOM` | C→S | `{ code, playerName, playerId, secret }` | 방 참가 요청 |
| `JOIN_ERROR` | S→C | `{ reason }` | 참가 실패 (코드 무효, 방 가득 참 등) |
| `GAME_START` | S→C | `{ players, yourRole }` | 양쪽에 p1/p2 역할 통보 |
| `CUP_SHAKE_STATE` | C→S | `{ cupPosition, cupQuaternion, diceStates }` | 흔들기 중 컵+주사위 상태 (30fps) |
| `OPPONENT_SHAKE_STATE` | S→C | (동일) | 서버가 상대에게 relay |
| `POUR_CUP` | C→S | `{ position, quaternion }` | 붓기 요청 (서버: 턴+canPour 검증) |
| `POUR_REJECTED` | S→C | `{ reason }` | 붓기 거부 (turnPhase 불일치 등) → 클라이언트 canPour 복원 |
| `POUR_RESULT` | S→C | `{ diceTrajectory, cupTrajectory, finalValues, rollCount }` | 양쪽에 broadcast |
| `KEEP_DIE` | C→S | `{ dieIndex }` | 주사위 킵 요청 |
| `UNKEEP_DIE` | C→S | `{ dieIndex }` | 킵 해제 요청 |
| `KEPT_UPDATE` | S→C | `{ keptDiceSlots }` | 킵 상태 동기화 |
| `REROLL` | C→S | — | 리롤 요청 → 서버가 검증 후 COLLECT_TO_CUP emit |
| `REROLL_REJECTED` | S→C | — | 리롤 거부 → 클라이언트 낙관적 애니메이션 롤백 |
| `COLLECT_TO_CUP` | S→C | `{ keptIndices }` | 리롤용 수거 시작 |
| `COLLECTION_DONE` | C→S | — | **턴 소유자만 emit**. 수거 애니메이션 완료 → 서버가 spawnNonKeptDiceInCup 후 canPour 복원 |
| `CAN_POUR` | S→C | — | 서버가 컵 붓기 가능 상태를 명시적으로 통보 |
| `SUBMIT_SCORE` | C→S | `{ category }` | 점수 기입 요청 |
| `SCORE_CONFIRMED` | S→C | `{ player, category, value, scores, nextTurn }` | 검증 완료된 점수 + 턴 전환 |
| `GAME_OVER` | S→C | `{ scores, winner }` | 게임 종료 |
| `REQUEST_REMATCH` | C→S | — | 리매치 요청 (양쪽 모두 보내야 성립) |
| `REMATCH_REQUESTED` | S→C | — | 상대가 리매치를 원함 (UI 표시용) |
| `REMATCH_START` | S→C | — | 양쪽 동의 완료, 새 게임 시작 |
| `OPPONENT_DISCONNECTED` | S→C | — | 상대 이탈 통보 |
| `OPPONENT_CONNECTION_QUALITY` | S→C | `{ quality: 'good' \| 'unstable' \| 'poor' }` | 상대 연결 품질 (변화 시에만) |
| `TURN_TIMER_SYNC` | S→C | `{ remainingMs: number }` | 턴 타이머 잔여 시간 동기화 |
| `AUTO_PLAY_STARTED` | S→C | `{ player: 'p1' \| 'p2' }` | AI 자동 진행 시작 |
| `AUTO_PLAY_ENDED` | S→C | `{ player: 'p1' \| 'p2' }` | AI 자동 진행 종료 |
| `RESUME_CONTROL` | C→S | — | 플레이어 복귀 의사 (AI 대행 중단 요청) |

### 서버 턴 서브페이즈 (사고실험 A2, A4, D3 대응)

서버가 턴 내에서 어떤 이벤트를 수용하는지 명시적으로 관리. 허용 외 이벤트는 무시.

```typescript
// ServerGameState
type TurnPhase =
  | 'waiting_pour'   // 컵 붓기 대기 (CUP_SHAKE_STATE, POUR_CUP 허용)
  | 'simulating'     // simulatePour 실행 중 (모든 게임 이벤트 거부)
  | 'placement'      // 주사위 배치 중 (KEEP_DIE, UNKEEP_DIE, REROLL, SUBMIT_SCORE 허용)
  | 'collecting'     // 리롤 수거 중 (COLLECTION_DONE만 허용)
  | 'scoring';       // 점수 기입 처리 중 (모든 게임 이벤트 거부)

// 이벤트 수신 시 phase 체크
const ALLOWED_EVENTS: Record<TurnPhase, string[]> = {
  waiting_pour: ['CUP_SHAKE_STATE', 'POUR_CUP'],
  simulating:   [],
  placement:    ['KEEP_DIE', 'UNKEEP_DIE', 'REROLL', 'SUBMIT_SCORE'],
  collecting:   ['COLLECTION_DONE'],
  scoring:      [],
};
```

**A2/F3 — simulatePour 동기 블로킹**: `simulatePour()`는 동기 실행으로 Node.js 이벤트 루프를 수십~수백ms 블로킹한다. 이 기간 동안 `turnPhase: 'simulating'`으로 설정되어 다른 이벤트가 도착해도 큐에 쌓였다가 완료 후 phase 체크로 걸러진다. 동시 여러 방에서 simulatePour가 겹치면 지연이 누적될 수 있으나, Koyeb 무료 티어의 동시 방 수(MAX_ACTIVE_ROOMS ≤ 25) 제한으로 실용적 범위 내.

**A4 — 턴 전환 원자성**: SCORE_CONFIRMED 처리 시 서버가 `currentTurn` 변경 + `turnPhase: 'waiting_pour'` 설정 + `rollCount: 0` 리셋을 단일 함수 내에서 수행. Node.js 단일 스레드이므로 이 함수 실행 중에는 다른 이벤트가 끼어들 수 없어 원자성 보장.

**D3 — CAN_POUR 전 CUP_SHAKE_STATE 가드**: `turnPhase`가 `'waiting_pour'`일 때만 CUP_SHAKE_STATE를 relay. 다른 phase에서는 서버가 무시.

### 이벤트 rate limiting (사고실험 C5 대응)

```typescript
// server.ts — 연결별 rate limiter (이벤트 종류별 분리)
const GAME_EVENT_LIMIT = { maxPerSecond: 10, windowMs: 1000 };
const SHAKE_EVENT_LIMIT = { maxPerSecond: 35, windowMs: 1000 };

// 소켓별 히스토리를 이벤트 종류별로 관리
const socketRateMap = new Map<string, { game: number[], shake: number[] }>();

function checkRateLimit(socket: Socket, type: 'game' | 'shake'): boolean {
  const now = Date.now();
  const entry = socketRateMap.get(socket.id) ?? { game: [], shake: [] };
  const limit = type === 'shake' ? SHAKE_EVENT_LIMIT : GAME_EVENT_LIMIT;
  const history = entry[type];
  const recent = history.filter(t => now - t < limit.windowMs);
  if (recent.length >= limit.maxPerSecond) return false;
  recent.push(now);
  entry[type] = recent;
  socketRateMap.set(socket.id, entry);
  return true;
}

// 사용:
// socket.on('CUP_SHAKE_STATE', (data) => {
//   if (!checkRateLimit(socket, 'shake')) return;
//   ...
// });
// socket.on('POUR_CUP', (data) => {
//   if (!checkRateLimit(socket, 'game')) return;
//   ...
// });
```

CUP_SHAKE_STATE는 30fps(초당 30회)이므로 별도 `shake` 카테고리로 초당 35회 상한. 게임 이벤트(POUR_CUP, KEEP_DIE, REROLL 등)는 `game` 카테고리로 초당 10회 상한.

### CUP_SHAKE_STATE 좌표 검증 (사고실험 C6 대응)

서버 relay 전 최소 검증:

```typescript
function validateShakeState(data: CupShakeState): boolean {
  const { BOARD_SIZE } = BOARD_CONSTANTS;
  const bound = BOARD_SIZE / 2 + 5;  // 약간의 여유
  if (Math.abs(data.cupPosition.x) > bound) return false;
  if (Math.abs(data.cupPosition.z) > bound) return false;
  if (data.cupPosition.y < 0 || data.cupPosition.y > 30) return false;
  if (data.diceStates.length !== 5) return false;
  return true;
}
```

### POUR_RESULT 수신 보장 (사고실험 D1 대응)

POUR_RESULT는 게임 진행의 핵심 이벤트. 수신 실패 시 클라이언트가 붓기 이후 상태로 진입하지 못한다.

별도 ACK 프로토콜 대신, **재접속 프로토콜이 커버**:
- POUR_RESULT 미수신 = 클라이언트가 `turnPhase` 전환을 모름 = UI 잠김 상태
- 사용자가 새로고침 → RECONNECT → 스냅샷에 최종 주사위 값 포함 → 정상 복귀
- 추가로, 서버가 POUR_RESULT 전송 후 5초 이내 클라이언트 응답(KEEP_DIE, SUBMIT_SCORE 등)이 없으면 POUR_RESULT를 재전송하는 간단한 재시도 로직을 Phase 4에서 추가 검토

### 서버 검증 규칙

#### KEEP_DIE / UNKEEP_DIE 검증

```typescript
// ServerGameState

validateKeep(socketId: string, dieIndex: number): boolean {
  // 1. 현재 턴 소유자의 요청인지
  if (this.getPlayerRole(socketId) !== this.currentTurn) return false;
  // 2. rollCount > 0 (한 번은 굴려야 킵 가능)
  if (this.rollCount === 0) return false;
  // 3. dieIndex 범위 유효성 (0~4)
  if (dieIndex < 0 || dieIndex >= 5) return false;
  // 4. 이미 킵된 주사위를 중복 킵하지 않음 (KEEP_DIE) / 킵 안 된 걸 언킵하지 않음 (UNKEEP_DIE)
  return true;
}
```

#### POUR_CUP 처리

검증:
- 현재 턴 소유자의 요청인지
- `rollCount < MAX_ROLLS_PER_TURN` (3회 초과 불가)
- 이전 붓기/수거가 완료된 상태인지

검증 실패 시: `socket.emit('POUR_REJECTED', { reason })` → 클라이언트가 `canPour = true` 복원.
```typescript
// 클라이언트
socket.on('POUR_REJECTED', () => {
  useGameStore.getState().setCanPour(true);
});
```

검증 통과 후 시뮬레이션 준비 — 주사위-컵 위치 동기화:
- 서버는 흔들기 중 물리를 돌리지 않아 주사위가 CUP_REST 좌표에 남아 있음
- `physics.updateCupTransform(position, quaternion)` → 컵을 pour 위치로 이동 설정
- `physics.step()` → 물리 1스텝 실행. 컵 collider가 내부 주사위를 물리적으로 함께 밀어 이동
- `physics.simulatePour(position, quaternion)` → 궤적 생성
- `spawnDiceInCup()` 재호출이 아닌 물리 이동 방식을 사용하는 이유: 리롤 후에는 kept 주사위가 트레이에, 비킵만 컵 안에 있음. `spawnDiceInCup()`은 전체 5개를 리셋하므로 kept 상태가 파괴됨

#### SUBMIT_SCORE 검증

- 현재 턴 소유자의 요청인지
- `rollCount > 0` (한 번은 굴려야 점수 기입 가능)
- 선택한 카테고리가 아직 미기입(null)인지
- 서버가 `calculateScore(currentDiceValues, category)`로 독립 계산하여 값 확정

#### REROLL 검증

- 현재 턴 소유자의 요청인지
- `rollCount < MAX_ROLLS_PER_TURN`
- placement 모드 상태인지 (이미 한 번은 굴린 후)
- 검증 실패 시: `socket.emit('REROLL_REJECTED')` → 클라이언트가 낙관적 애니메이션 롤백
  ```typescript
  socket.on('REROLL_REJECTED', () => {
    const s = useGameStore.getState();
    // 낙관적으로 시작한 return animation 중단, placement 모드 복원
    s.setIsReturningToCup(false);
    s.setIsSyncingDice(false);
    s.setReturnReason(null);
    s.setIsInPlacementMode(true);
  });
  ```

### 클라이언트 변경

#### gameStore 확장 필드

```typescript
// gameStore.ts 추가 필드

myRole: 'p1' | 'p2' | null;       // GAME_START에서 수신
roomId: string | null;              // ROOM_CREATED/JOIN 시 설정
opponentName: string | null;        // GAME_START에서 수신
isConnected: boolean;               // 소켓 연결 상태
opponentConnectionQuality: ConnectionQuality;  // 상대 연결 품질
turnTimerEnd: number | null;        // performance.now() 기준 타이머 종료 시각
returnReason: 'turnEnd' | 'reroll' | null;  // return animation의 원인 구분 (online 전용)
autoPlayActive: boolean;                    // 내 턴에서 AI 자동 진행 중 여부
setReturnReason: (reason: 'turnEnd' | 'reroll' | null) => void;
setAutoPlayActive: (active: boolean) => void;
setOpponentConnectionQuality: (q: ConnectionQuality) => void;
setTurnTimerEnd: (end: number | null) => void;

// 서버 상태 일괄 덮어쓰기용 setter (기존 updateScore와 별도)
// updateScore(player, category, score): 단일 카테고리 갱신 (로컬/싱글용)
// setScores(scores): 전체 scores 객체 덮어쓰기 (SCORE_CONFIRMED/RECONNECT용)
setScores: (scores: { p1: Record<string, number | null>; p2: Record<string, number | null> }) => void;
setCurrentTurn: (turn: 'p1' | 'p2') => void;
setRollCount: (count: number) => void;
setKeptDiceSlots: (slots: (number | null)[]) => void;
setPreviewScores: (previews: Record<string, number>) => void;
```

#### gameStore 분기

online 모드에서는 서버에서 내려온 상태를 gameStore에 반영하는 구조:

```typescript
// 점수 기입
if (gameMode === 'online') {
  socket.emit('SUBMIT_SCORE', { category });
  // → 서버 검증 후 SCORE_CONFIRMED 수신 시 store 반영
} else {
  applyScoreAndAdvance(category);  // 기존 로컬 로직
}
```

- `canPour`: online에서는 서버의 `CAN_POUR` 이벤트 수신 시에만 true로 전환
- `currentDiceValues`: POUR_RESULT에서 서버가 내려준 finalValues 사용
- `keptDiceSlots`: KEEP_DIE/UNKEEP_DIE → 서버 검증 → KEPT_UPDATE로 양쪽 동기화

#### online 모드 상태 플래그 전이 시퀀스

#### 낙관적 업데이트 원칙

**"로컬 플레이와 동일한 체감으로 플레이. 보이지 않는 처리는 조금 늦어도 된다."**

- **내 동작 → 즉각 반응**: keepDie, unkeepDie, reroll, score 모두 로컬 플레이와 동일하게 즉시 시각 피드백
- **서버 = 백그라운드 확인**: 서버 응답은 로컬 낙관적 상태를 덮어쓰기. 정상 시 동일하므로 시각 변화 없음. 거부 시 롤백.
- **상대 화면 = 자연스러운 지연**: 상대의 동작이 RTT만큼 늦게 보이는 것은 "렉"이 아닌 "지연"으로 읽힘
- **canPour만 서버 대기**: 물리 시뮬레이션(붓기)은 서버 권위이므로, 붓기 가능 여부(CAN_POUR)만 서버 응답 필수

```
[내 턴 시작]
  서버 SCORE_CONFIRMED(nextTurn=나) 또는 GAME_START(yourRole=p1)
  → gameStore: currentTurn = myRole, rollCount = 0, keptDiceSlots 초기화
    (endTurn() 호출 금지 — online에서는 필요한 필드만 개별 세팅)
  → 서버: spawnDiceInCup() (서버 PhysicsWorld)
  → 클라이언트: 로컬 PhysicsWorld에도 spawnDiceInCup() 호출 (내 턴 흔들기용)
  → 서버 emit CAN_POUR
  → gameStore: canPour = true

[컵 흔들기]
  사용자 드래그 → 로컬 물리엔진 실행 (컵 안 주사위 시뮬)
  → 30fps로 CUP_SHAKE_STATE emit (컵 위치 + 주사위 5개 상태)
  → 서버: 턴 검증 후 OPPONENT_SHAKE_STATE로 상대에게 relay
  → 상대: 보간 버퍼(2~3프레임)에 적재, lerp/slerp로 60fps 매끄러운 재생

[붓기]
  사용자 pointerup → POUR_CUP emit
  → gameStore: canPour = false (즉시, 중복 요청 방지)
  → 서버: updateCupTransform + step() (컵·주사위 물리 이동) → simulatePour() → POUR_RESULT broadcast { ..., rollCount }
  → 클라이언트: socket.ts가 POUR_RESULT 수신
    → gameStore: rollCount = result.rollCount (서버가 진실)
    → emitPourResult() 호출 → 궤적 재생 시작
  → 재생 완료 → placement mode 진입
  → detectCombo(finalValues) → activeCombo 설정 (양쪽 모두 — 상대 콤보도 표시)

[킵/언킵 — 낙관적 업데이트]
  사용자 탭 → 즉시 로컬 store.keepDie()/unkeepDie() 호출 (로컬 플레이와 동일한 즉각 반응)
            + 동시에 KEEP_DIE/UNKEEP_DIE emit
  → 서버 검증 후 KEPT_UPDATE broadcast (양쪽)
  → 내 클라이언트: KEPT_UPDATE로 로컬 상태 덮어쓰기 (정상 시 동일 → 시각 변화 없음)
  → 상대 클라이언트: KEPT_UPDATE로 상태 반영 (RTT만큼 자연스러운 지연)
  ※ 서버 거부 시 (비정상 — 턴 아님/위조 등): KEPT_UPDATE의 서버 상태로 롤백됨

[리롤 — 낙관적 로컬 애니메이션]
  사용자 리롤 버튼 → 즉시 로컬 애니메이션 시작 (DecisionButton 기존 로직과 동일:
                     setIsInPlacementMode(false), setIsSyncingDice(true), setIsReturningToCup(true))
                   + 동시에 REROLL emit
  → 서버 검증 후 COLLECT_TO_CUP emit — 양쪽에 broadcast
  → 내 클라이언트: 이미 애니메이션 진행 중이므로 COLLECT_TO_CUP 수신 시 스킵 (중복 방지)
  → 상대 클라이언트: COLLECT_TO_CUP 수신 → 수거 애니메이션 시작
  → 턴 소유자만 애니메이션 완료 시 COLLECTION_DONE emit
  → 서버: spawnNonKeptDiceInCup() (서버 PhysicsWorld)
  → 턴 소유자 클라이언트: 로컬 PhysicsWorld에도 spawnNonKeptDiceInCup() 호출
  → 서버 emit CAN_POUR
  → gameStore: canPour = true

[점수 기입 — 점수값 즉시 반영, 턴 전환은 서버 확인]
  사용자 카테고리 선택 → 즉시 로컬 updateScore() 호출 (점수가 셀에 즉시 표시)
                       + 동시에 SUBMIT_SCORE emit
  → 서버: calculateScore 검증 → SCORE_CONFIRMED broadcast (양쪽 점수 갱신)
  → 클라이언트: SCORE_CONFIRMED 수신 시 scores 서버값으로 덮어쓰기 + currentTurn/rollCount 갱신
    (applyScoreAndAdvance() 호출 금지 — endTurn() 포함이라 online에서 부작용)
  → 게임 종료 조건 충족 시 GAME_OVER emit
  → 아니면 nextTurn으로 턴 전환 → 위 시퀀스 반복
```

#### online 전용 클라이언트 동작 명세

**endTurn() / applyScoreAndAdvance() — online에서 호출 금지**:
- `endTurn()`은 `isReturningToCup: true`, `isSyncingDice: true`를 세팅하여 수거 플로우를 트리거함. online에서는 수거가 COLLECT_TO_CUP 이벤트 기반이므로 이 플래그가 잘못 세팅됨.
- `applyScoreAndAdvance()`는 내부에서 `endTurn()`을 호출하므로 같은 문제.
- online에서 턴 전환은 SCORE_CONFIRMED 수신 시 필요한 필드만 개별 세팅:
  ```typescript
  socket.on('SCORE_CONFIRMED', ({ scores, nextTurn }) => {
    const s = useGameStore.getState();
    s.setScores(scores);
    s.setCurrentTurn(nextTurn);
    s.setRollCount(0);
    s.setKeptDiceSlots([null, null, null, null, null]);
    s.setPreviewScores({});
    s.setIsInPlacementMode(false);
    s.setActiveCombo(null);
    s.setPlacementOrder([0, 1, 2, 3, 4]);
    // 주사위 시각 전환: HUD에서 컵으로 return animation
    s.setIsReturningToCup(true);
    s.setIsSyncingDice(true);
  });
  ```

**keepDie/unkeepDie — 낙관적 업데이트 (로컬 플레이 동일 반응성)**:
- 클릭 시 즉시 로컬 `store.keepDie(dieIndex)` / `store.unkeepDie(dieIndex)` 호출 (로컬 플레이와 동일)
- 동시에 `socket.emit('KEEP_DIE', { dieIndex })` / `socket.emit('UNKEEP_DIE', { dieIndex })` 전송
- 서버 KEPT_UPDATE 수신 시 `store.setKeptDiceSlots(data.keptDiceSlots)` + placementOrder 재계산으로 덮어쓰기
  - 정상 경로: 서버 상태 === 로컬 낙관적 상태 → 시각 변화 없음
  - 거부 경로 (비정상): 서버 상태로 롤백됨 → 주사위가 원래 위치로 돌아감
- 사운드(`tap`/`tap_smooth`)도 즉시 재생 (서버 응답 대기 안 함)
- 상대 클라이언트: KEPT_UPDATE 수신 시에만 반영 — RTT만큼 자연스러운 지연 ("렉"이 아닌 "지연")
  ```typescript
  // PhysicsDice click handler — online 분기
  if (gameMode === 'online') {
    // 낙관적: 로컬 즉시 반영 (로컬 플레이와 동일)
    isKeeping ? store.keepDie(dieIndex) : store.unkeepDie(dieIndex);
    // 서버 전송
    socket.emit(isKeeping ? 'KEEP_DIE' : 'UNKEEP_DIE', { dieIndex });
    return;
  }
  // 기존 local/single 로직
  ```

**rollCount — 서버 소유, POUR_RESULT로 동기화**:
- 클라이언트의 `incrementRollCount()` 호출 금지 (online)
- POUR_RESULT에 포함된 rollCount를 `store.setRollCount()`으로 반영
- DecisionButton의 "남은 횟수" 표시가 서버 값과 일치 보장

**spawnDiceInCup — 서버+클라이언트 양쪽 호출**:
- 서버: simulatePour용 PhysicsWorld에 spawnDiceInCup() (초기 주사위 배치)
- 클라이언트 (내 턴): 로컬 PhysicsWorld에도 spawnDiceInCup() (흔들기 물리용)
- 클라이언트 (상대 턴): 로컬 물리 불필요, OPPONENT_SHAKE_STATE로 시각 재생만

**detectCombo — 양쪽 모두 표시**:
- 궤적 재생 완료 → 주사위 정지 감지 → detectCombo(currentDiceValues) → ComboAnnouncement
- 상대 턴이어도 동일하게 작동 — 상대의 콤보를 내 화면에서도 관찰
- 기존 PhysicsDice 로직 수정 불필요 (POUR_RESULT → setCurrentDiceValues → 자동)

**점수판 닉네임 표시**:
- Scoreboard/PortraitScoreboard에서 P2 라벨: `gameMode === 'online' ? opponentName : (isSingle ? 'AI' : 'P2')`
- P1 라벨은 "P1" 유지 (본인)
- 동일 useScoreClick 훅 사용, isMyTurn() 가드로 입력 차단

**PhysicsDice.onPourResult — online 분기 필요**:
- 현재 핸들러(PhysicsDice.tsx:108-120)가 `incrementRollCount()`를 호출함
- online에서는 POUR_RESULT의 rollCount를 서버에서 받으므로 `incrementRollCount()` 호출 금지
- socket.ts의 POUR_RESULT 핸들러가 `setRollCount(result.rollCount)` 호출 → 그 후 `emitPourResult()` 호출
- PhysicsDice.onPourResult에서 `gameMode === 'online'`이면 incrementRollCount() 스킵

**KEPT_UPDATE 시 placementOrder 재계산 — 낙관적 덮어쓰기**:
- `setKeptDiceSlots()`만 호출하면 HUD 배치(placementOrder)가 갱신되지 않음
- KEPT_UPDATE 핸들러에서 keptDiceSlots 세팅 후 placementOrder를 재도출
- 내 턴: 낙관적 업데이트로 이미 로컬에 반영된 상태 → 서버 값으로 덮어쓰기 (정상 시 동일, 거부 시 롤백)
- 상대 턴: 이 이벤트가 상태 변경의 유일한 경로
- **placementOrder 재계산 로직 공통화**: 이 로직은 KEPT_UPDATE 핸들러, reconnection-protocol의 applySnapshot, gameStore의 unkeepDie에 동일하게 존재한다. `derivePlacementOrder(keptDiceSlots, currentDiceValues): number[]` 유틸 함수를 `core/src/index.ts`에 추출하여 3곳에서 공유할 것.
  ```typescript
  // core/src/index.ts
  export function derivePlacementOrder(
    keptDiceSlots: (number | null)[],
    diceValues: number[]
  ): number[] {
    const keptSet = new Set(keptDiceSlots.filter((v): v is number => v !== null));
    return [0,1,2,3,4]
      .filter(i => !keptSet.has(i))
      .map(i => ({ v: diceValues[i], i }))
      .sort((a, b) => a.v !== b.v ? a.v - b.v : a.i - b.i)
      .map(x => x.i);
  }

  // 사용처:
  socket.on('KEPT_UPDATE', ({ keptDiceSlots }) => {
    const s = useGameStore.getState();
    s.setKeptDiceSlots(keptDiceSlots);
    s.setPlacementOrder(derivePlacementOrder(keptDiceSlots, s.currentDiceValues));
  });
  ```

**useScoreClick — online 낙관적 분기**:
- 현재: `applyScoreAndAdvance()`가 updateScore → endTurn 일체 호출
- online: 점수값만 즉시 반영 + SUBMIT_SCORE emit, 턴 전환은 SCORE_CONFIRMED 대기
  ```typescript
  // useScoreClick — online 분기
  if (gameMode === 'online') {
    // 낙관적: 점수값 즉시 표시 (로컬 플레이 동일 반응성)
    store.updateScore(store.currentTurn, category, previewScores[category]);
    soundManager.play('score');
    // 즉시 입력 차단 — SCORE_CONFIRMED 전까지 재클릭 방지
    store.setIsInPlacementMode(false);
    // 서버 전송
    socket.emit('SUBMIT_SCORE', { category });
    return;
  }
  // 기존 local/single: applyScoreAndAdvance()
  ```
- `setIsInPlacementMode(false)` 즉시 호출로 다른 카테고리 재클릭 원천 차단
- SCORE_CONFIRMED에서 scores를 서버값으로 덮어쓰므로, 낙관적 점수가 틀려도 교정됨
- 점수 기입 → 셀에 즉시 표시 + 입력 잠금 → RTT 후 턴 전환 애니메이션 시작 → 자연스러운 흐름

**점수→다음턴 주사위 시각 전환**:
- 현재 로컬 모드: `endTurn()` → `isReturningToCup=true` → 주사위가 HUD에서 컵으로 애니메이션
- SCORE_CONFIRMED 핸들러에서 isReturningToCup을 건드리지 않으면, isInPlacementMode=false 설정 시 주사위가 HUD에서 즉시 사라져 물리 위치(판 위)로 순간이동 — 시각적으로 부자연스러움
- 해결: SCORE_CONFIRMED 핸들러에서 `isReturningToCup=true`, `isSyncingDice=true` 추가 세팅
- return animation 완료 시 online 분기에서: 로컬 `spawnDiceInCup()` 호출 + COLLECTION_DONE 미전송 (이것은 리롤이 아닌 턴 전환이므로)
- 로컬 spawnDiceInCup 완료 후 CAN_POUR 대기

수정된 SCORE_CONFIRMED 핸들러:
  ```typescript
  socket.on('SCORE_CONFIRMED', ({ scores, nextTurn }) => {
    const s = useGameStore.getState();
    s.setScores(scores);
    s.setCurrentTurn(nextTurn);
    s.setRollCount(0);
    s.setKeptDiceSlots([null, null, null, null, null]);
    s.setPreviewScores({});
    s.setCanPour(false);  // 이전 턴 canPour 잔류 방지 — CAN_POUR 이벤트 대기
    s.setIsInPlacementMode(false);
    s.setActiveCombo(null);
    s.setPlacementOrder([0, 1, 2, 3, 4]);
    // 주사위 시각 전환: HUD에서 컵으로 return animation
    s.setReturnReason('turnEnd');  // rollCount=0과 무관하게 명시적 구분
    s.setIsReturningToCup(true);
    s.setIsSyncingDice(true);
  });
  ```

**COLLECT_TO_CUP 클라이언트 핸들러**:
- 턴 소유자: 낙관적 업데이트로 이미 애니메이션 진행 중 → 스킵
- 상대 클라이언트: 이 이벤트가 수거 애니메이션의 유일한 트리거
  ```typescript
  socket.on('COLLECT_TO_CUP', () => {
    const s = useGameStore.getState();
    if (isMyTurn()) {
      // 낙관적 업데이트로 이미 애니메이션 시작됨 — 스킵
      return;
    }
    // 상대 턴: 수거 애니메이션 시작
    s.setIsInPlacementMode(false);
    s.setIsSyncingDice(true);
    s.setReturnReason('reroll');
    if (s.placementOrder.length > 0) {
      s.setIsReturningToCup(true);
    }
  });
  ```

**PhysicsDice return animation 완료 — online 분기**:
- 현재(PhysicsDice.tsx:284-295): animation 끝 → spawnNonKeptDiceInCup → setCanPour(true)
- online에서 분기 필요. **turnEnd vs reroll 구분**: rollCount는 SCORE_CONFIRMED에서 이미 0으로 리셋되므로 구분 불가. 대신 `returnReason` 플래그를 사용:
  ```typescript
  // gameStore 추가 필드
  returnReason: 'turnEnd' | 'reroll' | null;
  setReturnReason: (reason: 'turnEnd' | 'reroll' | null) => void;
  ```
  - SCORE_CONFIRMED 핸들러: `setReturnReason('turnEnd')` → `setIsReturningToCup(true)`
  - DecisionButton 낙관적 리롤: `setReturnReason('reroll')` → `setIsReturningToCup(true)`
  - local/single: returnReason 사용 안 함 (기존 로직 그대로)
  ```
  animation 완료 시:
    if (online && isMyTurn) {
      if (returnReason === 'turnEnd') {
        // 턴 전환 후 return → spawnDiceInCup (전체 주사위)
        physics.spawnDiceInCup();
      } else {
        // 리롤 return → spawnNonKeptDiceInCup (비킵만)
        physics.spawnNonKeptDiceInCup(keptDiceSlots);
        socket.emit('COLLECTION_DONE');
      }
      setReturnReason(null);
      // canPour는 CAN_POUR 이벤트 대기
      setIsSyncingDice(false);
    } else if (online && !isMyTurn) {
      // 상대 턴: 시각 애니메이션만 완료, 물리 불필요
      setReturnReason(null);
      setIsSyncingDice(false);
    } else {
      // local/single: 기존 로직
    }
  ```

**DecisionButton — online 낙관적 분기**:
- 현재: 로컬에서 직접 isReturningToCup/spawnNonKeptDiceInCup/setCanPour 세팅
- online: 로컬 애니메이션 즉시 시작 + 서버에 REROLL emit (로컬 플레이와 동일한 즉각 반응)
  ```typescript
  onPointerDown: {
    if (gameMode === 'online') {
      soundManager.play('reroll');
      // 낙관적: 로컬 애니메이션 즉시 시작 (로컬 플레이 동일)
      store.setIsInPlacementMode(false);
      store.setIsSyncingDice(true);
      store.setReturnReason('reroll');
      if (store.placementOrder.length > 0) {
        store.setIsReturningToCup(true);
      }
      // 서버 전송
      socket.emit('REROLL');
      return;
    }
    // 기존 local/single 로직
  }
  ```
- COLLECT_TO_CUP 핸들러에서 내 턴일 때 중복 방지 (이미 애니메이션 진행 중)

**상대 턴 시각 렌더링 — PhysicsCup/PhysicsDice 통합**:
- PhysicsCup: 상대 턴일 때 OPPONENT_SHAKE_STATE의 cupPosition/cupQuaternion으로 컵 위치 세팅
  - isDragging 대신 shakeBuffer에서 프레임을 꺼내 lerp/slerp
  - 드래그 입력 불가 (isMyTurn 가드)
- PhysicsDice: 상대 턴일 때 OPPONENT_SHAKE_STATE의 diceStates로 주사위 위치 세팅
  - 로컬 물리 스텝 스킵 (physics.step() 호출 안 함)
  - shakeBuffer에서 프레임을 꺼내 5개 주사위 각각 lerp/slerp
- 구현 방식: PhysicsCup과 PhysicsDice의 useFrame에서 `isMyTurn()` 분기
  - 내 턴: 기존 로직 (드래그 → 로컬 물리)
  - 상대 턴: shakeBuffer 보간 재생 (기존 궤적 재생 로직과 동일 패턴)
  - 비활성 (붓기 후): 기존 로직 유지

**상대 턴 로컬 물리 스텝 충돌 방지**:
- PhysicsDice useFrame의 live physics 섹션(현재 354-375행)에서:
  - `gameMode === 'online' && !isMyTurn()` 일 때 physics.step() 호출 스킵
  - dice mesh 위치는 shakeBuffer 보간 데이터로 세팅 (shake 중)
  - shake가 아닌 상태(궤적 재생 후 등)에서는 보간 데이터 없으므로 마지막 위치 유지

**효과음 — 낙관적 업데이트와의 관계**:
- **내 동작 효과음**: 낙관적 업데이트로 즉시 재생 (서버 응답 대기 안 함)
  - keepDie/unkeepDie: 탭 시 즉시 `tap`/`tap_smooth` 재생 (로컬 플레이 동일)
  - reroll: 클릭 시 즉시 `reroll` 재생
  - score: 클릭 시 즉시 `score` 재생
- **상대 동작 효과음**: 서버 이벤트 수신 시 재생
  - OPPONENT_SHAKE_STATE 수신 시작 시: `soundManager.startLoop('rolling_dice')` (볼륨 고정 ~0.4)
  - OPPONENT_SHAKE_STATE 수신 중단 감지 (200ms 무수신) 시: `soundManager.stopLoop('rolling_dice')`
  - POUR_RESULT 수신 시: `soundManager.play('pouring_dice')` — 기존 PhysicsCup onPourResult에서 이미 처리됨
  - KEPT_UPDATE 수신 시 (상대 턴일 때만): `soundManager.play('tap')` / `soundManager.play('tap_smooth')`
  - SCORE_CONFIRMED 수신 시 (상대 턴일 때만): `soundManager.play('score')`

**ResultOverlay — online 분기**:
- `p2Name`: `gameMode === 'online' ? opponentName : (gameMode === 'single' ? 'AI' : 'Player 2')`
- `handleRematch`: online에서는 `socket.emit('REQUEST_REMATCH')` 전송 → 버튼 비활성 + "대기 중..." 표시
- `handleMenu`: online에서는 소켓 연결 해제 후 resetGame + setPhase('MAIN_MENU')

**리매치 프로토콜 상세**:
- 양쪽 모두 REQUEST_REMATCH를 보내야 성립 (양쪽 동의 필수)
- 서버 상태: `Room.rematchFlags: { p1: boolean, p2: boolean }` — 각 플레이어의 리매치 의사
- 한쪽만 요청: 상대에게 `REMATCH_REQUESTED` emit → 상대 ResultOverlay에 "상대가 재대결을 원합니다" 표시
- 양쪽 동의: 서버가 `ServerGameState.reset()` + `spawnDiceInCup()` 후 양쪽에 `REMATCH_START` emit
- 거부: 상대가 메뉴로 나가면 → OPPONENT_DISCONNECTED → 리매치 불가 안내
- 타임아웃: GAME_OVER 후 60초 내 양쪽 동의 없으면 방 파괴
  ```typescript
  // 이벤트 추가
  // REMATCH_REQUESTED  S→C  {} — 상대가 리매치를 원함
  // REMATCH_START      S→C  {} — 양쪽 동의, 새 게임 시작
  
  // 서버
  socket.on('REQUEST_REMATCH', () => {
    room.rematchFlags[playerRole] = true;
    const opponent = room.getOpponent(playerId);
    if (room.rematchFlags.p1 && room.rematchFlags.p2) {
      room.state.reset();
      room.physics.spawnDiceInCup();
      room.rematchFlags = { p1: false, p2: false };
      io.to(room.id).emit('REMATCH_START');
    } else if (opponent?.socketId) {
      io.to(opponent.socketId).emit('REMATCH_REQUESTED');
    }
  });

  // 클라이언트
  socket.on('REMATCH_START', () => {
    const s = useGameStore.getState();
    s.resetGame();
    // resetGame()이 canPour=true로 초기화하므로, online에서는 서버 CAN_POUR 대기를 위해 즉시 덮어쓰기
    s.setCanPour(false);
    s.setPhase('GAME');
  });
  ```

**홈 버튼 — online 분기**:
- 확인 다이얼로그 → 확정 시 소켓 연결 해제 → 상대방에게 OPPONENT_DISCONNECTED 자동 발생 (서버 disconnect 핸들러)
- 기존 `setPhase('MAIN_MENU')` 동작에 소켓 정리 추가

#### 물리 이벤트 시스템 접합

online 모드에서 기존 pub/sub 파이프라인을 재활용:

```typescript
// frontend/src/network/socket.ts

socket.on('POUR_RESULT', (result: PourResult) => {
  const s = useGameStore.getState();
  if (s.gameMode === 'online') {
    s.setRollCount(result.rollCount);
  }
  // 기존 physicsEngine.ts의 emitPourResult()를 직접 호출
  // → PhysicsCup/PhysicsDice의 onPourResult 리스너가 궤적 재생 시작
  emitPourResult(result);
});
```

이 접합으로 기존 궤적 재생 파이프라인(PhysicsCup의 cupPlayback, PhysicsDice의 playbackData)이 온라인에서도 그대로 작동. rollCount는 emitPourResult 전에 서버 값으로 세팅되므로, PhysicsDice.onPourResult의 incrementRollCount를 online에서 스킵하면 이중 증가 방지.

#### 입력 차단

기존 `isAiTurnNow()` 패턴 확장:

```typescript
// gameStore.ts

export function isMyTurn(): boolean {
  const s = useGameStore.getState();
  if (s.gameMode === 'online') return s.currentTurn === s.myRole;
  if (s.gameMode === 'single') return s.currentTurn === 'p1';
  return true; // local
}
```

교체 대상 (모두 `isAiTurnNow()` → `!isMyTurn()` 변경):
- **PhysicsCup.tsx:208** — `onPointerDown` 가드: `if (... || isAiTurnNow()) return;` → `if (... || !isMyTurn()) return;`
- **PhysicsDice.tsx:396** — 주사위 클릭 (keepDie/unkeepDie) 가드: `if (isAiTurnNow()) return;` → `if (!isMyTurn()) return;`
- **DecisionButton.tsx:102** — 리롤 버튼 가드: `if (disabled || isAiTurnNow()) return;` → `if (disabled || !isMyTurn()) return;`
- **useScoreClick.ts:36** — 점수판 클릭 가드: `if (isAiTurnNow()) return;` → `if (!isMyTurn()) return;`

`isAiTurnNow()`는 삭제하지 않음 — AiController 내부에서 자체 가드(`gameMode === 'single' && currentTurn === 'p2' && phase === 'GAME'`)를 사용하므로 online에서 자동 비활성. 확인 대상에 포함하되 수정 불필요. AiController는 GameScreen에서 무조건 렌더(`<AiController />` — GameScreen.tsx:270)되나, 내부 `stillAiTurn()` 가드가 gameMode !== 'single'이면 모든 효과를 즉시 반환하므로 online에서 부작용 없음.

#### 물리 엔진 사용 분기

| 모드 | 물리 위치 | 시뮬레이션 |
|---|---|---|
| local / single | 프론트엔드 로컬 | 클라이언트 simulatePour |
| online | 서버 | 서버 simulatePour → 궤적만 수신하여 재생 |

online 모드에서는 로컬 `tryPour()` 대신 `socket.emit('POUR_CUP')` 후 `POUR_RESULT` 대기.

**로컬 PhysicsWorld 사용 분기**:
- **내 턴**: 컵 흔들기 중 주사위 물리 시뮬을 위해 로컬 PhysicsWorld 필요. CUP_SHAKE_STATE로 상대에게 relay하는 주사위 상태가 이 로컬 물리에서 나옴. 단, `simulatePour()`는 서버에서 실행하므로 로컬에서는 호출하지 않음.
- **상대 턴**: 로컬 물리 불필요. OPPONENT_SHAKE_STATE로 받은 데이터를 보간 재생만 함.

### UI 추가

#### 메인 메뉴

기존 "2 Players" / "vs AI" 버튼 아래에 "Online" 버튼 추가.
클릭 시 `phase = 'ONLINE_LOBBY'`로 전환.

#### 로비 화면 (신규, phase: ONLINE_LOBBY)

작혼(Mahjong Soul) 스타일 — 닉네임 상단 고정, 방 생성/참가 통합 UI.

```
┌────────────────────────────────────┐
│  ← 뒤로                           │
│                                    │
│  닉네임                            │
│  ┌──────────────────────────┐      │
│  │ Guest_a7f2               │ ✏️   │
│  └──────────────────────────┘      │
│                                    │
│  ─────────────────────────────     │
│                                    │
│  ┌──────────────────────────┐      │
│  │     방 만들기              │      │
│  └──────────────────────────┘      │
│                                    │
│  ┌────────┐  ┌───────────────┐     │
│  │ 코드:   │  │ 참가           │     │
│  │ [______]│  │               │     │
│  └────────┘  └───────────────┘     │
│                                    │
└────────────────────────────────────┘

방 만들기 후 → 대기 상태:
┌────────────────────────────────────┐
│  ← 뒤로 (방 나가기)                │
│                                    │
│  닉네임: Guest_a7f2               │
│                                    │
│  ─────────────────────────────     │
│                                    │
│  방 코드                           │
│       ┌──────────┐                 │
│       │  384927  │  [복사]         │
│       └──────────┘                 │
│                                    │
│  상대를 기다리는 중...              │
│  ● ● ●                            │
│                                    │
└────────────────────────────────────┘
```

**닉네임**:
- 초기값: `"Guest_" + playerId.slice(0, 4)` (PlayerIdentity에서 파생)
- 인라인 편집 가능 (연필 아이콘 클릭 또는 직접 클릭)
- 제약: 2~12자, 공백 trim, 빈 문자열 시 기본값 복원
- `sessionStorage`에 저장 → 같은 탭 세션 내 유지
- CREATE_ROOM / JOIN_ROOM 시 `playerName`으로 서버 전송

**방 코드**:
- 6자리 숫자 (예: 384927). 모바일에서 숫자 키패드로 빠르게 입력 가능 (`inputMode="numeric"`, `pattern="[0-9]*"`)
- 방 만들기: CREATE_ROOM emit → ROOM_CREATED 수신 → 코드 표시 + 대기 상태
- 참가: 코드 입력 → JOIN_ROOM emit → 성공 시 GAME_START, 실패 시 JOIN_ERROR 표시
- 코드 복사 버튼: `navigator.clipboard.writeText(code)`

**대기 → 게임 전환**: 상대 참가 시 GAME_START 수신 → `phase = 'GAME'` 자동 전환.
**대기 중 뒤로**: 소켓에서 방 나가기 emit → 서버가 방 파괴 → `phase = 'MAIN_MENU'`.

#### 게임 중 표시

- 상대 닉네임 표시 (Scoreboard 상단)
- 상대 턴일 때 "상대방 차례" 인디케이터
- 연결 끊김 시 오버레이 ("상대가 나갔습니다. 승리!")

### 연결 품질 표시

**서버측**:
- Engine.IO `pingInterval: 5000`으로 설정. ping/pong RTT 추적 (최근 3회 이동 평균)
- RTT 기반 품질 판정:
  ```typescript
  type ConnectionQuality = 'good' | 'unstable' | 'poor';
  // good: avg RTT < 200ms
  // unstable: 200~500ms
  // poor: > 500ms

  function assessQuality(recentPings: number[]): ConnectionQuality {
    if (recentPings.length === 0) return 'poor';
    const avg = recentPings.reduce((a, b) => a + b, 0) / recentPings.length;
    if (avg > 500) return 'poor';
    if (avg > 200) return 'unstable';
    return 'good';
  }
  ```
- 품질 변화 시에만(이전과 다를 때만) `OPPONENT_CONNECTION_QUALITY` emit → 불필요한 트래픽 절감

**클라이언트측**:
- Scoreboard/PortraitScoreboard의 상대 닉네임 옆에 연결 아이콘 표시
  - good: 아이콘 없음 (기본)
  - unstable: 노란 WiFi 아이콘
  - poor: 빨간 WiFi 아이콘 + "연결 불안정" 텍스트
- OPPONENT_DISCONNECTED(완전 끊김) 시 기존 오버레이 유지

### 턴 타임아웃

**서버측**:
- `ServerGameState`에 턴 타이머:
  ```typescript
  turnTimer: ReturnType<typeof setTimeout> | null;
  turnTimerFrozen: boolean;
  turnRemainingOnFreeze: number;  // freeze 시점 잔여 ms
  ```
- `TURN_TIMEOUT_MS = 60_000` (60초, 널널하게)
- 시작: `CAN_POUR` emit 시 (턴 시작) 또는 `POUR_RESULT` emit 후 placement 진입 시
- 리셋: 플레이어의 유효한 게임 진행 액션(POUR_CUP, KEEP_DIE, UNKEEP_DIE, REROLL, SUBMIT_SCORE) 수신 시 60초 리셋. CUP_SHAKE_STATE는 30fps로 상시 발생하므로 **리셋 대상에서 제외** — 흔들기만 하고 붓지 않는 경우에도 타이머가 걸려야 함
- freeze: disconnect grace 진입 시 턴 타이머 일시정지, 재접속 시 resume
- 만료: AI 자동 진행 시작

**disconnect grace와 턴 타이머 상호작용**:
```
[정상 플레이]
  → disconnect 발생 → turnTimer.freeze() + grace 30초 시작
    → grace 내 재접속 → turnTimer.resume() + RECONNECT_OK
    → grace 만료 → 기권 처리 (턴 타이머 무관)

[정상 플레이]
  → 턴 타이머 만료 (연결 유지 상태) → AI 자동 진행 시작
    → 플레이어 복귀 액션 → AI 중단, 타이머 리셋
    → AI가 턴 완료 → 다음 턴으로 전환 (타이머 새로 시작)

[AI 자동 진행 중]
  → disconnect 발생 → AI 진행 계속 (이미 대행 중이므로 freeze 불필요)
    → grace 내 재접속 → AI 중단, 플레이어 제어 복귀, 타이머 리셋
    → grace 만료 → 기권 처리
```

**클라이언트측**:
- `TURN_TIMER_SYNC` S→C `{ remainingMs: number }` — 턴 시작/리셋 시 전송
- 클라이언트: `performance.now() + remainingMs`로 로컬 카운트다운 계산
- 표시: 점수판 턴 라벨 옆에 잔여 시간 숫자 또는 프로그레스 바
- 잔여 10초: 빨간색 전환 + 깜빡임 경고

### 턴 타임아웃 시 AI 자동 진행

**AI 로직 이전 — core로**:
- `frontend/src/ai/yachtAi.ts`의 `chooseAction()` 및 관련 순수 함수 → `core/src/ai/yachtAi.ts`
- `core/src/index.ts`에 `export * from './ai/yachtAi.js'` + `AiDecision` 타입 export
- `frontend/src/ai/AiController.tsx`는 `@yacht/core`에서 `chooseAction` import하도록 경로만 변경

**게임 액션 공통 함수 — GameActions**:
소켓 핸들러와 ServerAutoPlay가 동일 검증 경로를 공유:
```typescript
// backend/src/GameActions.ts

class GameActions {
  constructor(private room: Room, private io: Server) {}

  // 소켓 핸들러 진입점
  handleFromSocket(playerRole: 'p1' | 'p2', event: string, data: any): void {
    this.execute(playerRole, event, data);
  }

  // AutoPlay 진입점 — 동일 검증 경로
  handleFromAutoPlay(playerRole: 'p1' | 'p2', event: string, data: any): void {
    this.execute(playerRole, event, data);
  }

  private execute(playerRole: 'p1' | 'p2', event: string, data: any): void {
    const state = this.room.state;
    // 1. 턴 소유자 검증
    if (state.currentTurn !== playerRole) return;
    // 2. turnPhase 허용 이벤트 검증 (ALLOWED_EVENTS)
    if (!ALLOWED_EVENTS[state.turnPhase].includes(event)) return;
    // 3. 이벤트별 처리 (POUR_CUP, KEEP_DIE, SUBMIT_SCORE, REROLL 등)
    // ...
  }
}
```
rate limiter는 소켓 핸들러 레벨에서만 적용 (AutoPlay는 서버 내부 호출이므로 불필요).

**ServerAutoPlay**:
```typescript
// backend/src/ServerAutoPlay.ts

class ServerAutoPlay {
  private timers: NodeJS.Timeout[] = [];
  private active = false;
  private pendingResume = false;  // 되돌릴 수 없는 단계에서 복귀 요청 시

  start(room: Room, gameActions: GameActions) {
    this.active = true;
    this.pendingResume = false;
    io.to(room.id).emit('AUTO_PLAY_STARTED', { player: room.state.currentTurn });
    this.executeNextStep();
  }

  stop(): void {
    this.active = false;
    this.pendingResume = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    io.to(room.id).emit('AUTO_PLAY_ENDED', { player: room.state.currentTurn });
  }

  // 플레이어 복귀 요청 (RESUME_CONTROL 또는 유효 게임 액션)
  requestResume(): void {
    const phase = this.room.state.turnPhase;
    if (phase === 'waiting_pour' || phase === 'placement') {
      // 즉시 복귀 가능
      this.stop();
    } else {
      // 되돌릴 수 없는 단계 — 완료 후 복귀
      this.pendingResume = true;
    }
  }

  private executeNextStep() {
    if (!this.active) return;
    if (this.pendingResume) { this.stop(); return; }

    switch (this.room.state.turnPhase) {
      case 'waiting_pour':
        this.scheduleAfter(1000, () => {
          // 서버 직접 실행: updateCupTransform + step() + simulatePour (동기)
          // → POUR_RESULT broadcast → turnPhase = 'placement'
          // simulatePour 완료 후 즉시 executeNextStep
          this.executeNextStep();
        });
        break;

      case 'placement':
        this.scheduleAfter(1500, () => {
          const state = this.room.state;
          const decision = chooseAction(
            state.currentDiceValues,
            state.scores[state.currentTurn],
            GAME_CONSTANTS.MAX_ROLLS_PER_TURN - state.rollCount
          );
          if (decision.action === 'score') {
            gameActions.handleFromAutoPlay(state.currentTurn, 'SUBMIT_SCORE',
              { category: decision.category });
            // → SCORE_CONFIRMED → 턴 전환 → stop
          } else {
            this.executeKeepAndReroll(decision.keepIndices);
          }
        });
        break;

      case 'collecting':
        // 서버 내부 직접 처리 — COLLECTION_DONE 대기 불필요
        // spawnNonKeptDiceInCup 후 CAN_POUR → waiting_pour → executeNextStep
        break;
    }
  }

  private executeKeepAndReroll(keepIndices: number[]) {
    // 킵 변경 (현재 상태와 차이만큼)
    // GameActions를 통해 KEEP_DIE/UNKEEP_DIE 처리 → KEPT_UPDATE broadcast
    // 딜레이 후 GameActions를 통해 REROLL 처리
    // → COLLECT_TO_CUP broadcast → 서버 spawnNonKeptDiceInCup
    // → CAN_POUR → executeNextStep (waiting_pour)
  }
}
```

**AutoPlay 경로에서 simulating/collecting 완료 감지**:
- `simulatePour()`는 동기 호출 → 함수 반환이 곧 완료
- collecting: AutoPlay 경로에서는 서버가 직접 `spawnNonKeptDiceInCup()` 호출 → 클라이언트의 `COLLECTION_DONE` 대기 불필요. COLLECT_TO_CUP broadcast 후 서버 내부에서 바로 수거 처리 → CAN_POUR emit

**복귀 규칙 (turnPhase별)**:

| turnPhase | 복귀 | 동작 |
|---|---|---|
| waiting_pour | 즉시 | AI 예약 취소. 플레이어가 흔들기+붓기 재개. |
| simulating | 완료 대기 | simulatePour 완료 후 placement에서 플레이어 제어. |
| placement | 즉시 | AI 예약 취소. 킵 상태 그대로 인수. 플레이어가 재변경 가능. |
| collecting | 완료 대기 | 수거 완료 후 waiting_pour에서 플레이어 제어. |
| scoring | 완료 대기 | 기입 완료 후 다음 턴에서 플레이어 제어. |

**복귀 트리거**:
- `RESUME_CONTROL` C→S: 오버레이 터치/클릭 시 emit. 게임 액션 없이 복귀 의사만 표시
- 실제 게임 액션(POUR_CUP, KEEP_DIE 등): 서버가 autoPlay 활성 확인 → requestResume() 호출 후 액션 처리

**클라이언트 표시**:
- `AUTO_PLAY_STARTED` S→C: 내 화면에 "자동 진행 중" 반투명 오버레이 + "터치하여 복귀" 버튼
- `AUTO_PLAY_ENDED` S→C: 오버레이 제거
- 상대 화면: 닉네임 옆 "[자동]" 라벨 표시

**이벤트 추가**:

| 이벤트 | 방향 | 페이로드 | 설명 |
|---|---|---|---|
| `OPPONENT_CONNECTION_QUALITY` | S→C | `{ quality: 'good' \| 'unstable' \| 'poor' }` | 상대 연결 품질 (변화 시에만) |
| `TURN_TIMER_SYNC` | S→C | `{ remainingMs: number }` | 턴 타이머 잔여 시간 동기화 |
| `AUTO_PLAY_STARTED` | S→C | `{ player: 'p1' \| 'p2' }` | AI 자동 진행 시작 |
| `AUTO_PLAY_ENDED` | S→C | `{ player: 'p1' \| 'p2' }` | AI 자동 진행 종료 |
| `RESUME_CONTROL` | C→S | — | 플레이어 복귀 의사 |

## 구현 순서

### Phase 1: 타입 및 서버 기반

1. `core/src/index.ts` — GameMode 타입 추가 + GamePhase에 'ONLINE_LOBBY' 추가 + 공유 인터페이스 추가 (PlayerIdentity, GameSnapshot, TurnPhase, ConnectionQuality — frontend/backend 양쪽에서 import) + `derivePlacementOrder()` 유틸 함수 추가
2. `frontend/src/store/gameStore.ts` — GameMode import 경로 변경 + online 관련 필드 추가 + setter 추가 (`setCurrentTurn`, `setRollCount`, `setScores`, `setKeptDiceSlots`, `setPreviewScores`, `setReturnReason` — SCORE_CONFIRMED/POUR_RESULT/KEPT_UPDATE 핸들러에서 사용)
3. `backend/src/RoomManager.ts` — Room 생성/참가/정리 + PhysicsWorld 생명주기
4. `backend/src/ServerGameState.ts` — 턴·점수·주사위값·turnNumber 관리 + 검증 규칙, core 함수 활용. turnNumber는 1부터 시작, SCORE_CONFIRMED마다 +1 (총 24턴 = 12카테고리 × 2명). GameSnapshot의 turnNumber로 노출.
5. `backend/src/server.ts` — RoomManager 통합, 이벤트 핸들러 방별 격리, 기존 단일 PhysicsWorld 제거

### Phase 2: 클라이언트 연동

6. `frontend/src/network/` 디렉터리 생성
7. `frontend/src/network/socket.ts` — 소켓 연결 관리, 이벤트 핸들러 (POUR_RESULT/POUR_REJECTED/KEPT_UPDATE/COLLECT_TO_CUP/SCORE_CONFIRMED/CAN_POUR/OPPONENT_SHAKE_STATE/GAME_OVER/REROLL_REJECTED/REMATCH_REQUESTED/REMATCH_START/OPPONENT_DISCONNECTED/OPPONENT_RECONNECTED/OPPONENT_TIMEOUT)
8. PhysicsCup — online 시 POUR_CUP emit 분기 (tryPour 대체), 상대 턴 시 shake 보간 재생
9. PhysicsDice — onPourResult online 분기, useFrame 상대 턴 물리 스킵 + shake 보간, return animation online 분기
10. DecisionButton — online 시 REROLL emit 분기
11. useScoreClick — online 시 SUBMIT_SCORE emit 분기
12. 입력 차단 통합 (`isMyTurn()`)

### Phase 3: UI

13. `frontend/src/App.tsx` — ONLINE_LOBBY phase 라우팅 추가
14. MainMenuScreen — "Online" 버튼 추가
15. `frontend/src/components/screens/LobbyScreen.tsx` — 방 생성/참가 화면 신규
16. Scoreboard/PortraitScoreboard — 상대 닉네임, 턴 인디케이터
17. ResultScreen — online 닉네임, rematch/menu online 분기
18. GameScreen — 홈 버튼 online 분기 (소켓 해제)
19. 연결 끊김/리매치 UI

### Phase 3.5: 연결 품질 · 턴 타이머 · AI 자동 진행

20. `core/src/ai/yachtAi.ts` — `frontend/src/ai/yachtAi.ts`에서 이전 (chooseAction + AiDecision 타입)
21. `core/src/index.ts` — `export * from './ai/yachtAi.js'` 추가
22. `frontend/src/ai/AiController.tsx` — chooseAction import 경로를 `@yacht/core`로 변경
23. `backend/src/GameActions.ts` — 게임 액션 공통 검증/실행 클래스 (소켓 핸들러 + AutoPlay 공유)
24. `backend/src/ServerAutoPlay.ts` — 턴 타임아웃 시 AI 자동 진행, phase별 복귀 규칙
25. `backend/src/ServerGameState.ts` — 턴 타이머(turnTimer, turnTimerFrozen, turnRemainingOnFreeze), RTT 추적 + 연결 품질 판정 추가
26. `frontend/src/network/socket.ts` — OPPONENT_CONNECTION_QUALITY, TURN_TIMER_SYNC, AUTO_PLAY_STARTED, AUTO_PLAY_ENDED, RESUME_CONTROL 핸들러 추가
27. Scoreboard/PortraitScoreboard — 연결 품질 아이콘 + 턴 타이머 표시 + "[자동]" 라벨
28. GameScreen — "자동 진행 중" 오버레이 + "터치하여 복귀" 버튼 (RESUME_CONTROL emit)

### Phase 4: 안정화

29. 네트워크 지연 대응 (낙관적 업데이트 덕에 대부분 불필요 — canPour 대기 등 서버 필수 응답 구간에만 해당)
30. 비정상 상태 복구 (새로고침 시 재접속, 게임 상태 스냅샷)
31. 로드 테스트 (동시 방 수 기준 Koyeb 성능 확인)

## 영향 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `backend/src/RoomManager.ts` | 방 생성·참가·정리 + PhysicsWorld 생명주기 |
| `backend/src/ServerGameState.ts` | 서버측 게임 상태 + 검증 규칙 |
| `frontend/src/network/socket.ts` | 소켓 연결 + 이벤트 바인딩 + emitPourResult 접합 |
| `frontend/src/components/screens/LobbyScreen.tsx` | 방 생성/참가 UI |
| `backend/src/GameActions.ts` | 게임 액션 공통 검증/실행 (소켓 핸들러 + AutoPlay 공유) |
| `backend/src/ServerAutoPlay.ts` | 턴 타임아웃 시 AI 자동 진행 + phase별 복귀 규칙 |

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `core/src/index.ts` | GameMode 타입 추가, GamePhase에 'ONLINE_LOBBY' 추가 |
| `backend/src/server.ts` | RoomManager 통합, 이벤트 핸들러 방별 분기, 단일 PhysicsWorld 제거 |
| `frontend/src/store/gameStore.ts` | GameMode import 변경, myRole/roomId/opponentName/isConnected/returnReason/autoPlayActive 추가, isMyTurn() 추가, online 분기 |
| `frontend/src/App.tsx` | ONLINE_LOBBY phase 라우팅 |
| `frontend/src/components/3d/PhysicsCup.tsx` | online 시 POUR_CUP emit 분기 |
| `frontend/src/components/ui/useScoreClick.ts` | online 시 SUBMIT_SCORE emit |
| `frontend/src/components/ui/Scoreboard.tsx` | 닉네임 표시, 턴 인디케이터, online 분기 |
| `frontend/src/components/ui/PortraitScoreboard.tsx` | 닉네임 표시 (Scoreboard와 동일 범위) |
| `frontend/src/components/screens/MainMenuScreen.tsx` | Online 버튼 |
| `frontend/src/components/screens/GameScreen.tsx` | online 모드 확인 (AiController 비활성 검증), 홈 버튼 online 분기 |
| `frontend/src/components/3d/PhysicsDice.tsx` | onPourResult online 분기 (incrementRollCount 스킵), useFrame 상대 턴 물리 스텝 스킵 + shake 보간, return animation online 분기 |
| `frontend/src/components/3d/DecisionButton.tsx` | online 시 REROLL emit 분기, isMyTurn() 가드 |
| `frontend/src/components/3d/ComboAnnouncement.tsx` | 수정 불필요 (activeCombo 스토어 구독이라 자동 작동) |
| `frontend/src/components/screens/ResultScreen.tsx` | online 닉네임 표시, rematch/menu 버튼 online 분기 |
| `core/src/ai/yachtAi.ts` | frontend에서 이전 — chooseAction + AiDecision 타입 |
| `core/src/index.ts` | (추가 변경) yachtAi re-export |
| `frontend/src/ai/AiController.tsx` | chooseAction import 경로 `@yacht/core`로 변경 |

### 확인만 필요 (수정 불필요 예상)

| 파일 | 확인 내용 |
|---|---|
| `frontend/src/ai/AiController.tsx` | `gameMode === 'single' && currentTurn === 'p2' && phase === 'GAME'` 가드로 online에서 자동 비활성 확인 |
| `frontend/src/physics/physicsEngine.ts` | emitPourResult()가 외부(socket.ts)에서 호출 가능한지 export 확인 |

## 비주얼 동기화 — 상대 화면의 시각적 무결성

### 설계 원칙

컵 뚜껑이 투명하여 흔들기 중 주사위 움직임이 관찰 가능하다. 따라서 독립 연출(클라이언트별 개별 물리)은 불가능하며, **활성 플레이어의 실제 물리 상태를 relay하여 관전자가 동일한 장면을 본다**.

레이턴시(50~200ms)는 존재하지만, 보간 버퍼로 매끄럽게 재생하여 지연을 느끼지 못하게 한다. 마스터 듀얼 등 온라인 게임에서 상대 행동이 빠르게 반영되는 것처럼 보이는 원리와 동일 — 지연을 없애는 게 아니라 시각적으로 매끄러운 재생으로 체감을 없앤다.

### Phase별 동작

#### Phase 1: 흔들기 (드래그 중)

```
A 클라이언트 (활성 플레이어):
  - 드래그로 컵 이동 → 로컬 물리엔진이 컵 안 주사위 실시간 시뮬
  - 30fps 주기로 서버에 전송:
    CUP_SHAKE_STATE {
      cupPosition, cupQuaternion,
      diceStates: [{ position, quaternion } × 5]
    }

서버:
  - 턴 소유자 검증 후 상대에게 relay (OPPONENT_SHAKE_STATE)
  - 서버는 물리를 돌리지 않음 — 단순 relay

B 클라이언트 (관전자):
  - 수신 큐에 2~3프레임 분량 버퍼링
  - 버퍼에서 꺼내며 컵·주사위 각각 lerp/slerp로 60fps 보간 재생
  - A의 실제 물리를 ~100~150ms 지연으로 매끄럽게 관찰
```

**대역폭**: 30fps × (컵 1 + 주사위 5) × (position 3 + quaternion 4) × float32 ≈ 5.9KB/s. Koyeb 무료 티어에서 문제 없음.

**B에서의 보간 재생 구조**:

```typescript
// OpponentView (관전자 측)
const shakeBuffer = useRef<ShakeFrame[]>([]);
const BUFFER_SIZE = 3;  // 3프레임 분량 = ~100ms @30fps

// 수신 시: 버퍼에 적재
socket.on('OPPONENT_SHAKE_STATE', (frame) => {
  shakeBuffer.current.push({ ...frame, receivedAt: performance.now() });
});

// useFrame에서: 버퍼 소화하며 lerp/slerp 보간
useFrame((_, delta) => {
  if (shakeBuffer.current.length < 2) return;  // 버퍼 부족 시 마지막 프레임 유지
  // 가장 오래된 두 프레임 사이를 보간
  const a = shakeBuffer.current[0];
  const b = shakeBuffer.current[1];
  // ... lerp/slerp (기존 궤적 재생과 동일 패턴)
});
```

#### Phase 2: 붓기 (pointerup → 궤적 재생)

```
A 클라이언트:
  - 손을 뗌 → socket.emit('POUR_CUP', { position, quaternion })
  - CUP_SHAKE_STATE 전송 중단

서버:
  - updateCupTransform(pourPos, pourQuat) + step() → 컵을 pour 위치로 물리 이동 (컵 collider가 내부 주사위를 함께 밀어줌)
  - simulatePour() 실행 → PourResult 생성
  - POUR_RESULT를 양쪽에 broadcast

B 클라이언트:
  - POUR_RESULT 수신
  - 버퍼에 남은 흔들기 프레임을 정상 속도로 소화
  - 소화 완료 → diceTrajectory/cupTrajectory 재생 시작
```

#### 흔들기→붓기 전환의 연속성

이 전환이 시각적으로 가장 민감한 구간이다.

**컵 위치는 연속, 주사위 미세 위치는 불연속**:

1. A가 POUR_CUP을 보내기 직전까지 CUP_SHAKE_STATE를 전송 중
2. B의 버퍼에는 A의 마지막 몇 프레임이 적재되어 있음
3. 서버는 POUR_CUP의 `{ position, quaternion }`으로 `updateCupTransform()` + `step()` → 컵 collider가 내부 주사위를 물리적으로 pour 위치까지 이동시킨 뒤 `simulatePour()` 실행
4. **컵 위치**: 버퍼 마지막 프레임의 컵 위치 ≈ PourResult 첫 프레임의 컵 위치 (같은 POUR_CUP 좌표 기준)
5. **주사위 위치**: 버퍼 마지막 프레임 = 클라이언트 물리의 shaken 상태, PourResult 첫 프레임 = 서버 물리에서 step()으로 이동된 상태. **서로 다른 PhysicsWorld 인스턴스**이므로 컵 내부 미세 위치가 일치하지 않음. 단, 서버가 `updateCupTransform + step()`으로 컵을 이동시키면 dice collider가 컵 collider 안에서 자연스럽게 재배치되므로, 주사위는 최소한 **컵 내부 어딘가**에 위치함

**시각적 흡수 근거**: 주사위가 컵 안에서 격렬히 움직이는 혼돈적 상태에서 전환이 발생하므로, 컵 내부 미세 위치 차이는 시각적으로 구별하기 어려움. 컵 자체의 위치 연속성이 유지되고, 붓기 시작 시 주사위가 급격히 쏟아지면서 이전 미세 위치 차이가 즉시 덮어씌워짐.

### CUP_TRANSFORM / DICE_STATES → CUP_SHAKE_STATE 통합

기존 `CUP_TRANSFORM`(컵 위치만)과 `DICE_STATES`(서버 물리 결과)를 **`CUP_SHAKE_STATE`로 통합** (메인 이벤트 테이블 참조). 온라인 모드에서 서버는 흔들기 중 물리를 돌리지 않으므로, 클라이언트가 컵+주사위 상태를 함께 보내는 구조가 적합.

### DICE_STATES 이벤트의 역할 변경

기존 계획에서 서버가 60fps 물리 루프를 돌며 DICE_STATES를 broadcast하는 구조 → **삭제**.

- 흔들기 중: 클라이언트가 CUP_SHAKE_STATE로 직접 relay (서버 물리 불필요)
- 붓기: 서버가 simulatePour()로 궤적 일괄 생성 후 POUR_RESULT로 전송

서버는 **물리 루프를 상시 가동하지 않는다**. simulatePour() 호출 시에만 PhysicsWorld를 사용. 이로써:
- 서버 CPU 부하 대폭 감소 (60fps 루프 제거)
- Koyeb 무료 티어에서 더 많은 동시 방 수용 가능
- startPhysicsLoop() / loopInterval 불필요

### 서버 물리 역할 축소에 따른 아키텍처 변경

```
기존 계획:
  서버: 60fps 물리 루프 → DICE_STATES broadcast
  클라이언트: CUP_TRANSFORM → 서버 물리에 반영

변경 후:
  서버: simulatePour() 호출 시에만 물리 사용
  클라이언트: 흔들기 물리는 로컬 실행, CUP_SHAKE_STATE로 상대에게 relay
```

이 변경으로 RoomManager의 `startPhysicsLoop()`, `loopInterval` 관련 코드가 불필요해진다. Room 구조 단순화:

```typescript
interface Room {
  id: string;
  code: string;
  players: PlayerSlot[];
  physics: PhysicsWorld;     // simulatePour() 전용
  state: ServerGameState;
  // loopInterval 제거
}
```

## 재접속 프로토콜

별도 문서 참조: [reconnection-protocol.md](./reconnection-protocol.md)

요약:
- playerId + secret 기반 영속 식별 (sessionStorage/localStorage 이중 저장)
- 30초 grace period, 타임아웃 시 기권 처리
- RECONNECT 핸드셰이크로 GameSnapshot 일괄 복원
- 시뮬레이션/궤적 재생 중 끊김 시 최종 결과 즉시 배치 (궤적 스킵)

## 리스크

- **네트워크 지연**: 흔들기 관전은 보간 버퍼(~100~150ms 지연)로 매끄럽게 처리. 붓기 요청 → 서버 simulatePour → 궤적 수신까지 RTT + 시뮬레이션 시간(200ms 내외). 흔들기→붓기 전환은 버퍼 잔여 프레임과 궤적 첫 프레임이 물리적으로 연속되므로 시각적 단절 없음
- **Koyeb cold start**: 무료 티어 슬립 후 첫 접속 시 수 초 지연. health check 핑으로 완화 가능
- **방별 PhysicsWorld 메모리**: Rapier WASM 인스턴스당 수 MB. MAX_ACTIVE_ROOMS = 25로 상한 설정하여 512MB 내 운용. 60fps 물리 루프 제거로 CPU 부하 대폭 감소. idle 방 5분 타임아웃 + destroyRoom 시 world.free() 필수. 상한값은 실제 프로파일링 후 조정
- **재접속**: reconnection-protocol.md에 상세 설계 완료. playerId+secret 기반 식별, 30초 grace period, GameSnapshot 복원
- **상태 플래그 경합**: canPour/isReturningToCup/isSyncingDice의 순서 의존성이 네트워크 지연과 결합 시 경합 조건 발생 가능. CAN_POUR 이벤트로 서버가 명시적으로 canPour 타이밍 통제
