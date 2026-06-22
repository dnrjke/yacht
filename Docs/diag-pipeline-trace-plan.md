# 관전 흔들기 프레임 손실 진단 — 파이프라인 구간별 타임라인 트레이스

## 목적

관전자(p2)가 체감하는 스터터의 원인이 파이프라인의 **어느 구간**에서 프레임이 빠지거나 지연되는지를 특정한다.
현재 aggregate 메트릭(min/median/p95/max)으로는 "대체로 건강"까지만 보이고, 언제 어디서 프레임이 빠지는지는 보이지 않음.

## 파이프라인 구간

```
P1 emit (60fps) → [구간A] → Server receive → immediate relay → [구간B] → P2 receive (pushShakeFrame)
→ buffer (180ms delay) → [구간C] → P2 consume (interpolateShake) → render
```

- **구간A**: P1→Server. P1이 실제로 균등하게 emit하는가? 네트워크 배칭으로 뭉쳐 도착하는가?
- **구간B**: Server→P2. 서버가 즉시 relay하지만 P2까지 오는 데 지터가 있는가?
- **구간C**: Buffer→Render. 버퍼에서 꺼내 쓰는 시점에 버퍼가 비는가? t값이 편향되는가?

## 수집할 데이터

### 1. 서버 도착 타임라인 (구간A 진단)
- **위치**: `RoomPhysicsLoop.enqueueShake()`
- **수집**: relayed된 각 프레임의 `[serverTimestamp, seq]` 쌍
- **출력**: `SHAKE_RELAY_METRICS`에 `arrivalTimeline: number[]` (각 프레임의 서버 도착시각, 첫 프레임 기준 상대값 ms)

### 2. 클라이언트 도착 타임라인 (구간B 진단)
- **위치**: `shakeBuffer.pushShakeFrame()`
- **수집**: 각 프레임의 `[performance.now() 상대값, seq, 현재 버퍼 크기]`
- **출력**: `getShakeTimeline()` → 스냅샷에 포함

### 3. 소비 타임라인 (구간C 진단)
- **위치**: `shakeBuffer.interpolateShake()`
- **수집**: opponentShake 중 매 소비의 `[timestamp 상대값, 버퍼크기, t값, underrun여부]`
- **출력**: 같은 `getShakeTimeline()`에 포함

### 4. P1 emit 타임라인 (구간A 보조)
- **위치**: P1의 CUP_SHAKE_STATE emit 지점
- **수집**: 각 emit의 `[performance.now() 상대값, seq]`
- **출력**: POUR_CUP 시 서버에 함께 전송 → 서버가 SHAKE_RELAY_METRICS에 포함하여 P2에 전달

## 데이터 형식 (compact)

메모리/대역폭 절약을 위해 타임라인은 숫자 배열로:

```typescript
// 서버 도착: 첫 프레임 기준 상대 ms
serverArrival: number[]  // [0, 17, 33, 50, 51, 68, ...]

// 클라이언트 도착: [relativeMs, seq, bufSize] 튜플의 flat array
clientArrival: number[]  // [0, 0, 3, 16, 1, 4, 33, 2, 5, ...]  (매 3개씩)

// 소비: [relativeMs, bufSize, t×1000, underrun] 튜플의 flat array  
consumeTrace: number[]   // [0, 8, 500, 0, 17, 7, 333, 0, ...]  (매 4개씩)

// P1 emit: 첫 emit 기준 상대 ms
p1EmitTimeline: number[]  // [0, 17, 33, 50, ...]
```

## 스냅샷 통합

```typescript
shakeTimeline: {
  p1Emit: number[] | null,       // P1이 보낸 emit 간격 (서버 경유 수신)
  serverArrival: number[] | null, // 서버 도착 간격
  clientArrival: number[],        // P2 도착 [ms, seq, bufSize] flat
  consumeTrace: number[],         // P2 소비 [ms, bufSize, t*1000, underrun] flat
}
```

## 수정 대상 파일

1. `backend/src/RoomPhysicsLoop.ts` — 서버 도착 타임라인 수집, metrics에 포함
2. `backend/src/server.ts` — P1 emit 타임라인 수신(POUR_CUP), relay metrics에 포함
3. `frontend/src/network/shakeBuffer.ts` — 클라이언트 도착/소비 타임라인 수집, export
4. `frontend/src/components/3d/PhysicsCup.tsx` — P1 emit 타임라인 기록 (송신 측)
5. `frontend/src/components/ui/DebugOverlay.tsx` — 스냅샷에 타임라인 포함, 스키마 v18
6. `frontend/src/network/socket.ts` — P1 emit 타임라인 POUR_CUP에 첨부, 서버 타임라인 수신

## 구현 순서

1. shakeBuffer에 arrival/consume 타임라인 → 이것만으로도 구간B+C 진단 가능
2. RoomPhysicsLoop + server에 서버 도착 타임라인 → 구간A 진단
3. P1 emit 타임라인 → 구간A 완전 진단
4. 스냅샷 통합 + 스키마 bump
