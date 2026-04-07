# P2 멀티플레이어 구현 가이드

> 작성일: 2026-04-07
> 전제 문서: `p2-issue-audit.md` (결함 목록 및 해결 순서)
> 목적: 감사 보고서의 Phase A→B→C→D를 구체적 코드 수준에서 안내한다.

---

## 목차

- [Phase A: 서버 기반 게임 상태 확립](#phase-a-서버-기반-게임-상태-확립)
  - [A-1. Room 관리 구조](#a-1-room-관리-구조)
  - [A-2. 플레이어 식별 및 할당](#a-2-플레이어-식별-및-할당)
  - [A-3. PhysicsWorld 턴 리셋 메서드](#a-3-physicsworld-턴-리셋-메서드)
- [Phase B: 턴 시스템 서버 이전](#phase-b-턴-시스템-서버-이전)
  - [B-1. 서버 턴 검증 + rollCount](#b-1-서버-턴-검증--rollcount)
  - [B-2. 턴 전환 서버 주도화](#b-2-턴-전환-서버-주도화)
  - [B-3. 프론트엔드 턴 상태 서버 구독](#b-3-프론트엔드-턴-상태-서버-구독)
- [Phase C: 점수 동기화](#phase-c-점수-동기화)
  - [C-1. 점수 기록 서버 경유](#c-1-점수-기록-서버-경유)
- [Phase D: 프론트엔드 가드](#phase-d-프론트엔드-가드)
  - [D-1. PhysicsCup 턴 가드](#d-1-physicscup-턴-가드)
  - [D-2. PhysicsDice 턴 가드](#d-2-physicsdice-턴-가드)
- [소켓 이벤트 최종 명세](#소켓-이벤트-최종-명세)
- [gameStore 최종 스키마](#gamestore-최종-스키마)
- [서버 GameRoom 최종 스키마](#서버-gameroom-최종-스키마)

---

## Phase A: 서버 기반 게임 상태 확립

### A-1. Room 관리 구조

#### 목표
서버에 Room 개념을 도입하여 2인 1게임 단위로 격리한다.

#### 사전 작업: 공유 타입을 `core`에 정의

`PlayerId`, `TurnPhase` 등 서버·클라이언트 양쪽에서 사용하는 타입은 반드시 `core/src/index.ts`에 정의한다.
이는 기존 `RulesCategory`, `GamePhase` 등이 core에 위치하는 패턴과 일치시키기 위함이다.

```typescript
// core/src/index.ts에 추가
export type PlayerId = 'p1' | 'p2';
export type TurnPhase = 'waiting' | 'shaking' | 'pouring' | 'placement' | 'scoring';
```

#### 새 파일: `backend/src/GameRoom.ts`

```typescript
import { PhysicsWorld } from './physics/PhysicsWorld';
import { PlayerId, TurnPhase, RulesCategory, SCORE_CATEGORIES } from '@yacht/core';

export interface GameRoom {
  roomId: string;
  players: {
    p1: string | null;  // socket.id
    p2: string | null;  // socket.id
  };
  physics: PhysicsWorld;
  turnState: {
    currentPlayer: PlayerId;
    rollCount: number;
    phase: TurnPhase;
  };
  scores: {
    p1: Record<RulesCategory, number | null>;
    p2: Record<RulesCategory, number | null>;
  };
  round: number;          // 1~13 (각 플레이어 13턴)
  finalDiceValues: number[]; // 마지막 pour 결과 (점수 검증용)
}

/** SCORE_CATEGORIES 기반 초기 점수판 생성 */
export function createInitialScores(): Record<RulesCategory, number | null> {
  const scores = SCORE_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = null;
    return acc;
  }, {} as Record<RulesCategory, number | null>);
  scores['Bonus'] = 0;
  return scores;
}
```

#### 핵심 설계 결정

- Room당 PhysicsWorld 1개를 갖는다.
- `players.p1/p2`에 socket.id를 저장하여 모든 이벤트에서 발신자를 검증한다.
- `turnState.phase`로 현재 허용 가능한 액션을 제한한다:
  - `waiting`: 게임 시작 전 또는 턴 전환 직후 (컵 조작 불가)
  - `shaking`: 컵 드래그 중 (`CUP_TRANSFORM` 허용)
  - `pouring`: `POUR_CUP` 처리 중 (추가 입력 차단)
  - `placement`: 주사위 배치 모드 (`COLLECT_TO_CUP` 허용)
  - `scoring`: 점수 기록 대기 (`RECORD_SCORE` 허용)

#### `server.ts` 변경 사항

```
변경 전: const gamePhysics = await PhysicsWorld.create();
변경 후: const rooms = new Map<string, GameRoom>();
```

Room 생성/조회 헬퍼 함수:

```typescript
import { PlayerId } from '@yacht/core';

function findRoomBySocket(socketId: string): { room: GameRoom; playerId: PlayerId } | null {
  for (const room of rooms.values()) {
    if (room.players.p1 === socketId) return { room, playerId: 'p1' };
    if (room.players.p2 === socketId) return { room, playerId: 'p2' };
  }
  return null;
}
```

> **주의**: 기존 전역 변수 `isSimulating`은 Room별 `turnState.phase === 'pouring'` 체크로 대체되므로 삭제한다.

---

### A-2. 플레이어 식별 및 할당

#### 목표
소켓 연결 시 방에 참가하고 P1/P2를 부여받는다.

#### 새 소켓 이벤트

| 방향 | 이벤트 | 페이로드 | 설명 |
|------|--------|----------|------|
| Client → Server | `JOIN_ROOM` | `{ roomId?: string }` | 방 참가 요청 (없으면 자동 생성) |
| Server → Client | `ROOM_JOINED` | `{ roomId, playerId, players }` | 참가 성공, 본인 역할 통보 |
| Server → All in room | `PLAYER_JOINED` | `{ playerId, players }` | 상대방 입장 알림 |
| Server → All in room | `GAME_START` | `{ turnState, scores }` | 양쪽 모두 입장 시 게임 시작 |

#### `server.ts` — `JOIN_ROOM` 핸들러

```typescript
socket.on('JOIN_ROOM', async (data?: { roomId?: string }) => {
  // 1. 이미 방에 있으면 무시
  if (findRoomBySocket(socket.id)) return;

  let room: GameRoom | undefined;

  // 2. roomId 지정 시 해당 방 검색, 없으면 대기 중인 방 자동 매칭
  if (data?.roomId) {
    room = rooms.get(data.roomId);
  } else {
    // P2 자리가 비어있는 방 찾기
    for (const r of rooms.values()) {
      if (r.players.p1 && !r.players.p2) {
        room = r;
        break;
      }
    }
  }

  // 3. 적합한 방이 없으면 새로 생성
  if (!room) {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const physics = await PhysicsWorld.create();
    room = {
      roomId,
      players: { p1: socket.id, p2: null },
      physics,
      turnState: { currentPlayer: 'p1', rollCount: 0, phase: 'waiting' },
      scores: { p1: { /* initialScores */ }, p2: { /* initialScores */ } },
      round: 1,
      finalDiceValues: [],
    };
    // scores 초기화 시 createInitialScores() 사용 (SCORE_CATEGORIES 기반)
    room = {
      roomId,
      players: { p1: socket.id, p2: null },
      physics,
      turnState: { currentPlayer: 'p1', rollCount: 0, phase: 'waiting' },
      scores: { p1: createInitialScores(), p2: createInitialScores() },
      round: 1,
      finalDiceValues: [],
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('ROOM_JOINED', { roomId, playerId: 'p1', players: room.players });
    return;
  }

  // 4. 기존 방에 P2로 참가
  if (!room.players.p2) {
    room.players.p2 = socket.id;
    socket.join(room.roomId);
    socket.emit('ROOM_JOINED', { roomId: room.roomId, playerId: 'p2', players: room.players });
    io.to(room.roomId).emit('PLAYER_JOINED', { playerId: 'p2', players: room.players });

    // 양쪽 모두 접속 → 게임 시작
    room.turnState.phase = 'shaking';
    io.to(room.roomId).emit('GAME_START', {
      turnState: room.turnState,
      scores: room.scores,
    });
  }
});
```

#### `disconnect` 핸들러 업데이트

```typescript
socket.on('disconnect', () => {
  const found = findRoomBySocket(socket.id);
  if (found) {
    const { room, playerId } = found;
    room.players[playerId] = null;

    // 게임 진행 중이면 일시정지 (물리 루프는 players 체크로 자동 중단됨)
    if (room.turnState.phase !== 'waiting') {
      room.turnState.phase = 'waiting';
    }

    io.to(room.roomId).emit('PLAYER_LEFT', { playerId });

    // 모두 나가면 방 정리
    if (!room.players.p1 && !room.players.p2) {
      rooms.delete(room.roomId);
    }
  }
});
```

> **향후 과제**: 재접속(reconnect) 시 기존 Room에 복귀하는 로직은 현재 범위 밖. 단, 물리 루프의 `if (!room.players.p1 || !room.players.p2) continue;` 조건으로 한쪽 disconnect 시 물리 루프가 자동 중단되므로 상대방에게 불필요한 데이터가 전송되지 않는다.

#### 프론트엔드 연동 (`App.tsx`)

```typescript
// 소켓 연결 후 자동 방 참가
useEffect(() => {
  if (!socket) return;
  socket.emit('JOIN_ROOM');

  socket.on('ROOM_JOINED', (data) => {
    setRoomId(data.roomId);
    setMyPlayerId(data.playerId);  // 새 스토어 필드
  });

  socket.on('GAME_START', (data) => {
    setCurrentTurn(data.turnState.currentPlayer);
    setRollCount(data.turnState.rollCount);
    setPhase('GAME');
  });
}, [socket]);
```

---

### A-3. PhysicsWorld 턴 리셋 메서드

#### 목표
턴 전환 시 물리 세계를 깨끗하게 초기화하는 단일 메서드를 추가한다.

#### `PhysicsWorld.ts`에 추가

```typescript
/**
 * 턴 전환 시 호출. 모든 주사위를 컵 안으로 리셋하고
 * 킵/값 상태를 초기화한다.
 */
resetForNewTurn(): void {
  // 1. 모든 주사위를 Dynamic으로 되돌림 (이전 턴에서 Fixed된 킵 주사위 해제)
  this.diceBodies.forEach(dice => {
    dice.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  });

  // 2. 상태 배열 초기화
  this.diceInCup = [true, true, true, true, true];
  this.keptDice = [false, false, false, false, false];
  this.currentDiceValues = [1, 1, 1, 1, 1];

  // 3. 주사위를 컵 안에 재배치
  this.spawnDiceInCup();

  // 4. 벽 OFF (컵이 보드 밖 대기 위치)
  this.setBorderWallsEnabled(false);
}
```

#### 기존 `spawnDiceInCup()` 과의 차이

- `spawnDiceInCup()`은 이미 대부분의 작업을 수행하지만, `dice.setBodyType(Dynamic)`을 먼저 호출하지 않아 이전 턴에서 Fixed로 설정된 킵 주사위가 풀리지 않는 문제가 있음.
- `resetForNewTurn()`은 명시적으로 모든 바디를 Dynamic으로 되돌린 후 spawn을 호출.

---

## Phase B: 턴 시스템 서버 이전

### B-1. 서버 턴 검증 + rollCount

#### 목표
모든 게임 액션 이벤트에 턴 가드를 추가하고, rollCount를 서버에서 관리한다.

#### `server.ts` 가드 패턴

모든 게임 이벤트 핸들러의 첫 줄에 공통 가드를 적용한다:

```typescript
// 가드 헬퍼
function guardAction(
  socketId: string,
  allowedPhases: GameRoom['turnState']['phase'][]
): { room: GameRoom; playerId: PlayerId } | null {
  const found = findRoomBySocket(socketId);
  if (!found) return null;
  const { room, playerId } = found;

  // 현재 턴 플레이어인지 확인
  if (room.turnState.currentPlayer !== playerId) {
    console.log(`[GUARD] ${playerId} tried to act on ${room.turnState.currentPlayer}'s turn`);
    return null;
  }

  // 허용된 phase인지 확인
  if (!allowedPhases.includes(room.turnState.phase)) {
    console.log(`[GUARD] action rejected: phase=${room.turnState.phase}, allowed=${allowedPhases}`);
    return null;
  }

  return found;
}
```

#### 각 이벤트에 가드 적용

```typescript
socket.on('CUP_TRANSFORM', (data) => {
  const ctx = guardAction(socket.id, ['shaking']);
  if (!ctx) return;
  ctx.room.physics.updateCupTransform(data.position, data.quaternion);
  // 상대 클라이언트에 컵 위치 릴레이 (상대방 화면에도 컵 움직임 표시)
  socket.to(ctx.room.roomId).emit('CUP_TRANSFORM', data);
});

socket.on('POUR_CUP', (data) => {
  const ctx = guardAction(socket.id, ['shaking']);
  if (!ctx) return;
  const { room } = ctx;

  // rollCount 체크
  if (room.turnState.rollCount >= GAME_CONSTANTS.MAX_ROLLS_PER_TURN) {
    console.log('[GUARD] max rolls reached');
    return;
  }

  if (!room.physics.allDiceReadyToPour()) return;

  // phase 전환: pouring (추가 입력 차단)
  room.turnState.phase = 'pouring';
  room.turnState.rollCount++;

  const result = room.physics.simulatePour(data.position, data.quaternion);
  room.finalDiceValues = result.finalValues;

  // pour 완료 → placement phase
  room.turnState.phase = 'placement';

  io.to(room.roomId).emit('POUR_RESULT', {
    ...result,
    turnState: room.turnState,  // rollCount 동기화용
  });
});

socket.on('COLLECT_TO_CUP', (data) => {
  const ctx = guardAction(socket.id, ['placement']);
  if (!ctx) return;
  const { room } = ctx;

  // rollCount가 MAX면 더 이상 굴릴 수 없으므로 scoring으로
  if (room.turnState.rollCount >= GAME_CONSTANTS.MAX_ROLLS_PER_TURN) {
    room.turnState.phase = 'scoring';
  } else {
    room.turnState.phase = 'shaking';
  }

  const keptIndices = data?.keptIndices ?? [];
  room.physics.spawnNonKeptDiceInCup(keptIndices);

  io.to(room.roomId).emit('COLLECTION_DONE', {
    turnState: room.turnState,
  });
});
```

#### rollCount 관련 변경

- **제거**: `frontend/src/store/gameStore.ts`의 `incrementRollCount()` (자율 증가 금지)
- **변경**: `rollCount`를 서버가 보내주는 `turnState.rollCount`로 갱신
- **PhysicsDice.tsx**: `handlePourResult`에서 `incrementRollCount()` 호출 제거, 대신 `POUR_RESULT`의 `turnState.rollCount`를 스토어에 반영

---

### B-2. 턴 전환 서버 주도화

#### 목표
점수 기록(또는 3회 굴림 후 강제 기록)을 트리거로, 서버가 턴 전환을 수행한다.

#### 새 소켓 이벤트

| 방향 | 이벤트 | 페이로드 | 설명 |
|------|--------|----------|------|
| Client → Server | `RECORD_SCORE` | `{ category: RulesCategory }` | 점수 기록 요청 |
| Server → All | `TURN_CHANGED` | `{ turnState, scores, previousAction }` | 턴 전환 완료 |

#### `server.ts` — `RECORD_SCORE` 핸들러

```typescript
socket.on('RECORD_SCORE', (data: { category: RulesCategory }) => {
  const ctx = guardAction(socket.id, ['placement', 'scoring']);
  if (!ctx) return;
  const { room, playerId } = ctx;
  const { category } = data;

  // 1. 이미 기록된 카테고리인지 확인
  if (room.scores[playerId][category] !== null) {
    console.log(`[GUARD] category ${category} already recorded`);
    return;
  }

  // 2. 서버에서 점수 계산 (클라이언트 값을 신뢰하지 않음)
  const score = calculateScore(room.finalDiceValues, category);
  room.scores[playerId][category] = score;

  // 3. 보너스 체크
  room.scores[playerId]['Bonus'] = checkBonus(room.scores[playerId]);

  // 4. 물리 세계 리셋
  room.physics.resetForNewTurn();

  // 5. 턴 전환
  const nextPlayer: PlayerId = playerId === 'p1' ? 'p2' : 'p1';
  room.turnState = {
    currentPlayer: nextPlayer,
    rollCount: 0,
    phase: 'shaking',
  };

  // 6. 라운드 진행 (P2 턴 종료 시 라운드 증가)
  if (playerId === 'p2') {
    room.round++;
  }

  // 7. 게임 종료 체크 (13라운드 × 2플레이어 = 26턴)
  const p1Done = Object.entries(room.scores.p1)
    .filter(([k]) => k !== 'Bonus')
    .every(([, v]) => v !== null);
  const p2Done = Object.entries(room.scores.p2)
    .filter(([k]) => k !== 'Bonus')
    .every(([, v]) => v !== null);

  if (p1Done && p2Done) {
    room.turnState.phase = 'waiting';
    io.to(room.roomId).emit('GAME_OVER', { scores: room.scores });
    return;
  }

  // 8. 턴 전환 브로드캐스트
  io.to(room.roomId).emit('TURN_CHANGED', {
    turnState: room.turnState,
    scores: room.scores,
    previousAction: { player: playerId, category, score },
  });
});
```

> **UX 주의**: `RECORD_SCORE`는 `placement` phase에서도 허용된다 (3회 미만 굴림 시 바로 점수 기록 가능).
> 이 경우 클라이언트가 아직 placement 모드 애니메이션 중일 수 있으나, `TURN_CHANGED` 수신 시
> `resetLocalTurnState()`가 `isInPlacementMode: false`로 설정하여 즉시 해제된다.
> 애니메이션이 갑자기 중단되는 느낌이 있을 수 있으므로, 구현 후 UX 테스트 필요.

---

### B-3. 프론트엔드 턴 상태 서버 구독

#### 목표
프론트엔드의 `currentTurn`, `rollCount`를 서버가 보내주는 값으로만 갱신한다.

#### `gameStore.ts` 변경

```diff
 interface GameState {
+  myPlayerId: PlayerId | null;
+  setMyPlayerId: (id: PlayerId | null) => void;
+
   currentTurn: 'p1' | 'p2';
+  setCurrentTurn: (turn: 'p1' | 'p2') => void;  // 서버 이벤트에서만 호출
+
   rollCount: number;
-  incrementRollCount: () => void;
+  setRollCount: (count: number) => void;  // 서버 이벤트에서만 호출
-  endTurn: () => void;
+
+  // 내 턴인지 판별하는 파생 getter (컴포넌트에서 사용)
+  isMyTurn: () => boolean;
+
+  // 턴 전환 시 로컬 UI 상태만 리셋 (서버 TURN_CHANGED 수신 시 호출)
+  resetLocalTurnState: () => void;
 }
```

#### `resetLocalTurnState` 구현

```typescript
resetLocalTurnState: () => set({
  currentDiceValues: [1, 1, 1, 1, 1],
  previewScores: {} as Record<RulesCategory, number>,
  keptDiceSlots: [null, null, null, null, null],
  canPour: true,
  isInPlacementMode: false,
  isReturningToCup: false,
  isSyncingDice: false,
  placementOrder: [0, 1, 2, 3, 4],
  activeCombo: null,
}),
```

#### 소켓 리스너 (App.tsx 또는 전용 훅)

```typescript
socket.on('TURN_CHANGED', (data) => {
  const store = useGameStore.getState();
  store.setCurrentTurn(data.turnState.currentPlayer);
  store.setRollCount(data.turnState.rollCount);
  store.resetLocalTurnState();
  // scores도 서버 값으로 덮어쓰기
  store.setScores(data.scores);
});

socket.on('POUR_RESULT', (result) => {
  const store = useGameStore.getState();
  // rollCount를 서버값으로 동기화
  if (result.turnState) {
    store.setRollCount(result.turnState.rollCount);
  }
  // 기존 playback 로직 유지...
});
```

---

## Phase C: 점수 동기화

### C-1. 점수 기록 서버 경유

#### 목표
프론트엔드에서 직접 점수를 쓰지 않고, 서버를 거쳐 검증된 점수를 양쪽에 반영한다.

#### `Scoreboard.tsx` 변경

```diff
 const handleScoreClick = (cat: RulesCategory) => {
   if (cat === 'Bonus') return;
-  const currentPlayerScores = scores[currentTurn];
-  if (currentPlayerScores[cat] !== null) return;
-  const scoreToRecord = previewScores[cat] ?? 0;
-  updateScore(currentTurn, cat, scoreToRecord);
-  endTurn();
+
+  // 내 턴이 아니면 무시
+  if (!useGameStore.getState().isMyTurn()) return;
+
+  // 이미 기록된 칸이면 무시
+  const myScores = scores[myPlayerId!];
+  if (myScores[cat] !== null) return;
+
+  // 서버에 기록 요청 (로컬에서는 아무것도 하지 않음)
+  socket?.emit('RECORD_SCORE', { category: cat });
 };
```

#### `gameStore.ts` 변경

```diff
+  // scores를 서버 값으로 통째로 교체하는 setter 추가
+  setScores: (scores: GameState['scores']) => set({ scores }),
```

#### 검증 흐름 요약

```
[Scoreboard 클릭]
  → socket.emit('RECORD_SCORE', { category })
  → [서버] guardAction 통과
  → [서버] calculateScore(finalDiceValues, category) 계산
  → [서버] scores 업데이트 + 턴 전환
  → [서버] TURN_CHANGED 브로드캐스트 (scores 포함)
  → [양쪽 클라이언트] scores를 서버 값으로 덮어쓰기
```

---

## Phase D: 프론트엔드 가드

### D-1. PhysicsCup 턴 가드

#### `PhysicsCup.tsx` 변경

```diff
 export function PhysicsCup() {
   // ...기존 코드...
+  const isMyTurn = useGameStore(state =>
+    state.myPlayerId === state.currentTurn
+  );

   // onPointerDown 수정
   <group
     onPointerDown={(e) => {
-      if (isPouring.current || !canPour) return;
+      if (isPouring.current || !canPour || !isMyTurn) return;
       e.stopPropagation();
       isDragging.current = true;
     }}
-    onPointerOver={() => document.body.style.cursor = 'grab'}
+    onPointerOver={() => {
+      document.body.style.cursor = isMyTurn && canPour ? 'grab' : 'not-allowed';
+    }}
   >
```

#### `CUP_TRANSFORM` 전송 가드 (이중 안전)

```diff
 // useFrame 내부, 드래그 로직
-if (!socket || !isDragging.current) return;
+if (!socket || !isDragging.current || !useGameStore.getState().isMyTurn()) return;
```

### D-2. PhysicsDice 턴 가드

#### `PhysicsDice.tsx` 변경

```diff
 <mesh
   onPointerDown={isInPlacementMode ? (e) => {
     e.stopPropagation();
     const s = useGameStore.getState();
+    if (s.myPlayerId !== s.currentTurn) return; // 내 턴이 아니면 무시
     const isKept = s.keptDiceSlots.includes(idx);
     // ...이하 동일
   } : undefined}
 >
```

---

## 소켓 이벤트 최종 명세

기존 이벤트와 새 이벤트를 통합한 전체 목록.

### Client → Server

| 이벤트 | 페이로드 | Phase 가드 | 설명 |
|--------|----------|------------|------|
| `JOIN_ROOM` | `{ roomId?: string }` | - | 방 참가/생성 |
| `CUP_TRANSFORM` | `{ position, quaternion }` | `shaking` | 컵 위치 전송 |
| `POUR_CUP` | `{ position, quaternion }` | `shaking` | 붓기 요청 |
| `COLLECT_TO_CUP` | `{ keptIndices }` | `placement` | 다시 굴리기 |
| `RECORD_SCORE` | `{ category }` | `placement`, `scoring` | 점수 기록 |

### Server → Client(s)

| 이벤트 | 페이로드 | 수신 대상 | 설명 |
|--------|----------|-----------|------|
| `ROOM_JOINED` | `{ roomId, playerId, players }` | 발신자 | 방 참가 확인 |
| `PLAYER_JOINED` | `{ playerId, players }` | 방 전체 | 상대 입장 |
| `PLAYER_LEFT` | `{ playerId }` | 방 전체 | 상대 퇴장 |
| `GAME_START` | `{ turnState, scores }` | 방 전체 | 게임 시작 |
| `CUP_TRANSFORM` | `{ position, quaternion }` | 발신자 제외 | 컵 위치 릴레이 (상대방 화면용) |
| `DICE_STATES` | `{ diceStates }` | 방 전체 | 실시간 주사위 상태 |
| `POUR_RESULT` | `{ diceTrajectory, cupTrajectory, finalValues, turnState }` | 방 전체 | 붓기 결과 |
| `COLLECTION_DONE` | `{ turnState }` | 방 전체 | 수집 완료 |
| `TURN_CHANGED` | `{ turnState, scores, previousAction }` | 방 전체 | 턴 전환 |
| `GAME_OVER` | `{ scores }` | 방 전체 | 게임 종료 |

---

## gameStore 최종 스키마

Phase A~D 완료 후 `gameStore.ts`의 인터페이스 목표 상태.

```typescript
interface GameState {
  // ── 연결 ──
  socket: Socket | null;
  setSocket: (socket: Socket) => void;
  roomId: string | null;
  setRoomId: (id: string | null) => void;

  // ── 플레이어 식별 ──
  myPlayerId: 'p1' | 'p2' | null;  // 서버 ROOM_JOINED에서 수신
  setMyPlayerId: (id: 'p1' | 'p2' | null) => void;
  isMyTurn: () => boolean;          // myPlayerId === currentTurn

  // ── 게임 페이즈 ──
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  // ── 디버그 ──
  isDebug: boolean;
  setIsDebug: (val: boolean) => void;

  // ── 턴 (서버 권위) ──
  currentTurn: 'p1' | 'p2';        // 서버 turnState.currentPlayer
  setCurrentTurn: (turn: 'p1' | 'p2') => void;
  rollCount: number;                 // 서버 turnState.rollCount
  setRollCount: (count: number) => void;

  // ── 점수 (서버 권위) ──
  scores: { p1: Record<RulesCategory, number | null>; p2: Record<RulesCategory, number | null> };
  setScores: (scores: GameState['scores']) => void;

  // ── 주사위 (로컬 렌더링용) ──
  currentDiceValues: number[];
  setCurrentDiceValues: (vals: number[]) => void;
  previewScores: Record<RulesCategory, number>;

  // ── 상태 플래그 (로컬 애니메이션용) ──
  canPour: boolean;
  setCanPour: (val: boolean) => void;
  isInPlacementMode: boolean;
  setIsInPlacementMode: (val: boolean) => void;
  isWaitingForPlacement: boolean;
  setIsWaitingForPlacement: (val: boolean) => void;
  isReturningToCup: boolean;
  setIsReturningToCup: (val: boolean) => void;
  isSyncingDice: boolean;
  setIsSyncingDice: (val: boolean) => void;
  placementOrder: number[];
  setPlacementOrder: (val: number[]) => void;

  // ── 킵 트레이 (로컬) ──
  keptDiceSlots: (number | null)[];
  keepDie: (dieIndex: number) => void;
  unkeepDie: (dieIndex: number) => void;

  // ── 콤보 연출 (로컬) ──
  activeCombo: ComboResult | null;
  setActiveCombo: (combo: ComboResult | null) => void;

  // ── 턴 리셋 (TURN_CHANGED 수신 시) ──
  resetLocalTurnState: () => void;
}
```

**삭제 대상**:
- `incrementRollCount()` — 서버가 관리하므로 불필요
- `endTurn()` — 서버 `RECORD_SCORE` → `TURN_CHANGED` 흐름으로 대체
- `updateScore()` — `setScores()`로 대체 (서버 값 통째로 반영)

---

## 서버 GameRoom 최종 스키마

```typescript
import { PlayerId, TurnPhase, RulesCategory } from '@yacht/core';

interface GameRoom {
  roomId: string;

  players: {
    p1: string | null;   // socket.id
    p2: string | null;
  };

  physics: PhysicsWorld;

  turnState: {
    currentPlayer: PlayerId;
    rollCount: number;
    phase: TurnPhase;
  };

  scores: {
    p1: Record<RulesCategory, number | null>;
    p2: Record<RulesCategory, number | null>;
  };

  round: number;               // 1~13
  finalDiceValues: number[];    // 마지막 pour 결과 (점수 검증용)
}
```

---

## 부록: 물리 루프 Room 대응

현재 `setInterval`로 돌아가는 60fps 물리 루프를 Room별로 분리해야 한다.

```typescript
// 변경 전: 전역 단일 루프
setInterval(() => {
  gamePhysics.step();
  io.emit('DICE_STATES', { diceStates: gamePhysics.getDiceStates() });
}, 1000 / 60);

// 변경 후: Room별 루프
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.players.p1 || !room.players.p2) continue;
    if (room.turnState.phase === 'waiting') continue;
    if (room.turnState.phase === 'pouring') continue; // simulatePour가 동기적으로 처리

    room.physics.step();
    const diceStates = room.physics.getDiceStates();
    io.to(room.roomId).emit('DICE_STATES', { diceStates });
  }
}, 1000 / 60);
```

> **주의**: Room이 많아지면 단일 setInterval이 병목이 될 수 있다. 현재 스케일(1~수 개 Room)에서는 문제없으나, 확장 시 Room별 독립 타이머 또는 이벤트 기반 stepping을 고려한다.
