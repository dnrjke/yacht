# 재접속(Reconnection) 프로토콜 설계

## 1. 플레이어 식별 — 영속 ID

socket.id는 재접속 시 변경된다. 영속 식별자를 별도 운용한다.

```typescript
// core/src/index.ts
export interface PlayerIdentity {
  playerId: string;   // crypto.randomUUID() — 탭 세션 수명
  secret: string;     // 재접속 인증용 (서버 대조)
  playerName: string;
}
```

**생성 시점**: 클라이언트가 CREATE_ROOM / JOIN_ROOM 시 생성하여 `sessionStorage`에 저장.
- `sessionStorage`: 같은 탭 새로고침 시 유지, 탭 닫기 시 소멸
- 탭 닫기 후 재접속: `localStorage`에 `{ playerId, secret, roomId }` 백업 (게임 진행 중에만, 종료 시 삭제)

```typescript
// frontend/src/network/identity.ts
export function getOrCreateIdentity(): PlayerIdentity {
  const stored = sessionStorage.getItem('yacht_identity');
  if (stored) return JSON.parse(stored);

  // sessionStorage 없으면 localStorage 백업 확인
  const backup = localStorage.getItem('yacht_reconnect');
  if (backup) return JSON.parse(backup);

  // 최초 생성
  const identity: PlayerIdentity = {
    playerId: crypto.randomUUID(),
    secret: crypto.randomUUID(),
    playerName: '',  // 로비에서 설정
  };
  sessionStorage.setItem('yacht_identity', JSON.stringify(identity));
  return identity;
}
```

**서버측 매핑**:

```typescript
// RoomManager 내부
interface PlayerSlot {
  playerId: string;
  secret: string;
  socketId: string | null;  // null = 현재 끊김
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
}
```

## 2. 끊김 감지 → 유예 → 타임아웃

```
끊김 감지 ──→ 유예(grace) ──→ 타임아웃 ──→ 기권 처리
  0초          30초 대기        30초 경과      상대 승리
```

### 타이밍

| 단계 | 시간 | 동작 |
|---|---|---|
| Socket.IO pingTimeout | 5초 | 서버가 끊김 감지 |
| Grace period | 30초 | 방·게임 상태 보존, 상대에게 `OPPONENT_DISCONNECTED` |
| Timeout | 30초 경과 | `OPPONENT_TIMEOUT` → 상대 승리, 방 정리 |

```typescript
// server.ts — disconnect 핸들러
socket.on('disconnect', () => {
  const slot = room.findPlayerBySocketId(socket.id);
  if (!slot) return;

  slot.socketId = null;
  slot.connected = false;
  slot.disconnectedAt = Date.now();

  // 상대에게 통보
  const opponent = room.getOpponent(slot.playerId);
  if (opponent?.socketId) {
    io.to(opponent.socketId).emit('OPPONENT_DISCONNECTED', {
      gracePeriodMs: 30_000,
    });
  }

  // 유예 타이머
  room.disconnectTimer = setTimeout(() => {
    if (!slot.connected) {
      if (opponent?.socketId) {
        io.to(opponent.socketId).emit('OPPONENT_TIMEOUT');
      }
      destroyRoom(room.id);
    }
  }, 30_000);
});
```

## 3. 상태 스냅샷 구조

재접속 시 서버가 전송하는 전체 게임 상태:

```typescript
// core/src/index.ts
export interface GameSnapshot {
  // 게임 진행
  currentTurn: 'p1' | 'p2';
  rollCount: number;
  turnNumber: number;  // 1부터 시작, SCORE_CONFIRMED마다 +1. 게임 진행도 표시용 (총 24턴 = 12카테고리 × 2명)

  // 주사위
  currentDiceValues: (number | null)[];  // 5개, null = 아직 안 굴림
  keptDiceSlots: (number | null)[];      // keep tray 배치

  // 점수
  scores: {
    p1: Record<string, number | null>;
    p2: Record<string, number | null>;
  };

  // 상태 플래그
  phase: 'playing' | 'finished';
  turnPhase: 'waiting_pour' | 'simulating' | 'placement' | 'collecting' | 'scoring';
  canPour: boolean;
  isSimulating: boolean;

  // 메타
  myRole: 'p1' | 'p2';
  opponentName: string;
  opponentConnected: boolean;

  // AI 자동 진행
  autoPlayActive: boolean;  // 내 턴에서 AI가 대행 중인지
}
```

스냅샷은 **항상 최종 확정 상태**만 담는다. 궤적 재생 중간 프레임, 수거 애니메이션 진행도 등 과도 상태는 포함하지 않는다.

## 4. 재접속 핸드셰이크 시퀀스

```
Client                          Server
  │                               │
  │─── RECONNECT ────────────────→│  { playerId, secret, roomId }
  │                               │
  │                               │── 검증: secret 대조, 방 존재 확인
  │                               │── slot.socketId = 새 socket.id
  │                               │── slot.connected = true
  │                               │── clearTimeout(disconnectTimer)
  │                               │
  │←── RECONNECT_OK ─────────────│  { snapshot: GameSnapshot }
  │                               │
  │    클라이언트: gameStore에     │
  │    스냅샷 일괄 적용            │
  │                               │
  │←── (상대에게) ───────────────│  OPPONENT_RECONNECTED
  │                               │
```

```typescript
// server.ts — RECONNECT 핸들러
socket.on('RECONNECT', ({ playerId, secret, roomId }) => {
  const room = rooms.get(roomId);
  if (!room) return socket.emit('RECONNECT_FAIL', { reason: 'room_gone' });

  const slot = room.findPlayer(playerId);
  if (!slot || slot.secret !== secret) {
    return socket.emit('RECONNECT_FAIL', { reason: 'auth_failed' });
  }

  // 소켓 교체
  slot.socketId = socket.id;
  slot.connected = true;
  slot.disconnectedAt = null;
  socket.join(roomId);

  if (room.disconnectTimer) {
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;
  }

  // 스냅샷 전송
  socket.emit('RECONNECT_OK', {
    snapshot: room.state.buildSnapshot(slot.playerId),
  });

  // 상대 통보
  const opponent = room.getOpponent(playerId);
  if (opponent?.socketId) {
    io.to(opponent.socketId).emit('OPPONENT_RECONNECTED');
  }

  // 이벤트 핸들러 재바인딩
  bindGameEvents(socket, room, slot);
});
```

**클라이언트 자동 재접속 흐름**:

```typescript
// frontend/src/network/socket.ts
socket.on('connect', () => {
  const backup = localStorage.getItem('yacht_reconnect');
  if (backup) {
    const { playerId, secret, roomId } = JSON.parse(backup);
    socket.emit('RECONNECT', { playerId, secret, roomId });
  }
});

socket.on('RECONNECT_OK', ({ snapshot }) => {
  applySnapshot(snapshot);  // gameStore 일괄 갱신
});

socket.on('RECONNECT_FAIL', () => {
  localStorage.removeItem('yacht_reconnect');
  // 메인 메뉴로 복귀
});
```

## 5. Socket.IO 내장 재접속 활용

Socket.IO v4의 자동 재접속과 본 프로토콜의 역할 분담:

| 계층 | 담당 | 처리 |
|---|---|---|
| Socket.IO transport | 일시적 끊김 (WiFi 전환, 터널) | `reconnection: true`, 자동 재연결 시도 |
| 본 프로토콜 | transport 복구 후 게임 상태 동기화 | RECONNECT 핸드셰이크 |

```typescript
// 클라이언트 소켓 설정
const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
```

Socket.IO가 transport를 복구하면 새 socket.id가 부여된다. `connect` 이벤트에서 RECONNECT를 보내 게임 상태를 동기화한다. 이 두 계층은 독립적으로 작동하므로 transport 복구 실패(10회 초과) 시에도 사용자가 수동으로 페이지 새로고침하면 본 프로토콜의 localStorage 경로로 재접속된다.

## 6. 시나리오별 처리

### 시나리오 1~2: 새로고침 / 탭 닫기 후 재접속

`sessionStorage`(새로고침) 또는 `localStorage`(탭 닫기)에서 identity 복원 → `connect` 시 자동 RECONNECT → 스냅샷 적용.

### 시나리오 3~4: 네트워크 끊김 / 모바일 백그라운드

Socket.IO 자동 재연결 → 새 socket.id → RECONNECT 핸드셰이크. 30초 이내면 게임 계속.

### 시나리오 5: 끊김 중 상대가 행동

서버는 끊김과 무관하게 상대의 요청을 정상 처리한다 (턴 소유자 검증은 playerId 기반이므로 socket 끊김 영향 없음). 재접속 시 스냅샷에 상대의 행동 결과가 반영되어 있다.

### 시나리오 6: 양쪽 동시 끊김

두 slot 모두 `connected: false`. 각자 30초 grace period. 먼저 돌아온 쪽이 RECONNECT 성공, 나중에 돌아온 쪽도 동일하게 성공. 둘 다 30초 내 미복귀 시 방 파괴.

### 시나리오 7~8: 시뮬레이션/궤적 재생 중 끊김

서버의 `simulatePour()`는 **동기 실행**이므로 중간에 끊겨도 결과는 서버에 확정 저장된다. 재접속 시 스냅샷의 `currentDiceValues`가 시뮬레이션 최종 결과이므로, 클라이언트는 궤적 재생 없이 주사위를 최종 위치에 즉시 배치한다.

```typescript
// 클라이언트 — 스냅샷 적용 시
function applySnapshot(snapshot: GameSnapshot) {
  const store = useGameStore.getState();
  // 궤적 재생 스킵, 최종 값으로 즉시 배치
  store.setCurrentDiceValues(snapshot.currentDiceValues);
  store.setKeptDiceSlots(snapshot.keptDiceSlots);
  store.setCurrentTurn(snapshot.currentTurn);
  store.setRollCount(snapshot.rollCount);
  store.setScores(snapshot.scores);
  store.setCanPour(snapshot.canPour);

  // turnPhase에서 UI 플래그 파생
  store.setIsInPlacementMode(snapshot.turnPhase === 'placement');
  store.setIsReturningToCup(false);   // 과도 상태 — 재접속 시 스킵
  store.setIsSyncingDice(false);
  store.setReturnReason(null);

  // placementOrder 재계산 (placement 모드인 경우)
  // derivePlacementOrder는 core/src/index.ts에서 import (multiplayer-plan.md 참조)
  if (snapshot.turnPhase === 'placement') {
    store.setPlacementOrder(derivePlacementOrder(snapshot.keptDiceSlots, snapshot.currentDiceValues));
  }

  // AI 자동 진행 상태 복원
  // autoPlayActive=true이면 "자동 진행 중" 오버레이 표시
  // 플레이어는 터치/클릭으로 RESUME_CONTROL emit하여 복귀 가능
  store.setAutoPlayActive(snapshot.autoPlayActive);
}
```

### 시나리오 9: SUBMIT_SCORE 직후 끊김 — 멱등성

```
Client                          Server
  │── SUBMIT_SCORE {category} ─→│
  │        (끊김)                │── 처리 완료, scores 갱신
  │                              │── SCORE_CONFIRMED emit (전달 실패)
  │── RECONNECT ────────────────→│
  │←── RECONNECT_OK {snapshot} ──│  snapshot.scores에 이미 반영됨
```

서버가 SUBMIT_SCORE를 처리했으면 스냅샷에 반영되어 있고, 처리 전이었으면 미반영 상태로 스냅샷이 내려온다. 클라이언트는 스냅샷을 진실로 삼으므로 중복 기입이 발생하지 않는다.

**재전송 방어**: 재접속 후 클라이언트가 같은 SUBMIT_SCORE를 재전송하더라도, 서버의 `validateSubmitScore()`가 "해당 카테고리가 이미 기입됨(non-null)"을 확인하고 거부한다. 별도 시퀀스 번호 없이 **게임 규칙 자체가 멱등성을 보장**한다.

동일한 원리가 KEEP_DIE, POUR_CUP 등 모든 상태 변경 이벤트에 적용된다. 서버의 검증 규칙이 이미 처리된 요청을 자연스럽게 걸러낸다.

## 7. 상대방 UX

```typescript
// 이벤트 및 UI 매핑
interface ReconnectionEvents {
  OPPONENT_DISCONNECTED: { gracePeriodMs: number };  // → "상대 연결 끊김 (30초 대기)"
  OPPONENT_RECONNECTED:  {};                          // → 토스트 후 정상 복귀
  OPPONENT_TIMEOUT:      {};                          // → "상대 이탈 — 승리!" 오버레이
}
```

상대 끊김 중에도 **내 턴이면 정상 플레이 가능**하다. 상대 턴 중 끊기면 카운트다운 UI를 표시하고 대기한다.

## 8. Koyeb 무료 티어 고려

| 제약 | 대응 |
|---|---|
| 512MB RAM | grace period 중 PhysicsWorld 유지 (추가 메모리 없음). 타임아웃 시 즉시 `world.free()` |
| Cold start | 재접속 프로토콜과 무관. 첫 접속 지연은 로비 UX로 흡수 |
| 단일 인스턴스 | 방 상태가 메모리에만 존재하므로 서버 재시작 시 모든 게임 소실. 야추 한 판(5~10분)이므로 허용 가능 |

서버 재시작 시나리오: 클라이언트 RECONNECT → `room_gone` 응답 → localStorage 정리 → 메인 메뉴 복귀. 게임 소실은 불가피하나, 무료 티어의 현실적 한계이며 유저에게 명확한 피드백을 제공한다.

## 9. 추가 이벤트 요약

기존 multiplayer-plan.md의 이벤트 테이블에 추가되는 항목:

| 이벤트 | 방향 | 페이로드 |
|---|---|---|
| `RECONNECT` | C→S | `{ playerId, secret, roomId }` |
| `RECONNECT_OK` | S→C | `{ snapshot: GameSnapshot }` |
| `RECONNECT_FAIL` | S→C | `{ reason: string }` |
| `OPPONENT_DISCONNECTED` | S→C | `{ gracePeriodMs: number }` |
| `OPPONENT_RECONNECTED` | S→C | `{}` |
| `OPPONENT_TIMEOUT` | S→C | `{}` |
