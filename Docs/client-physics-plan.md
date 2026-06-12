# 물리 클라이언트 이전 계획

## 목적
서버에서 실행하던 Rapier 물리 엔진을 프론트엔드로 이전하여 네트워크 지연 제거.
게임 로직(점수, 턴)은 이미 클라이언트에 있으므로, 물리만 옮기면 서버 의존성 완전 제거.

## 현재 흐름 (서버 물리)
```
CUP_TRANSFORM → 서버 → step() → DICE_STATES → 클라이언트 렌더링
POUR_CUP → 서버 simulatePour() → POUR_RESULT → 클라이언트 재생
COLLECT_TO_CUP → 서버 spawnNonKeptDiceInCup() → COLLECTION_DONE
```

## 목표 흐름 (로컬 물리)
```
컵 드래그 → updateCupTransform() 직접 호출
useFrame → step() → getDiceStates() → 메시 위치 적용
컵 놓기 → simulatePour() 직접 호출 → 즉시 PourResult 반환 → 재생
턴 종료 → spawnNonKeptDiceInCup() 직접 호출 → 즉시 완료
```

## 변경 파일

### 신규
1. `frontend/src/physics/PhysicsWorld.ts` — backend 코드 복사 (동일 Rapier WASM)
2. `frontend/src/physics/physicsEngine.ts` — 싱글톤 + 이벤트 시스템

### 수정
3. `frontend/package.json` — `@dimforge/rapier3d-compat` 의존성 추가
4. `frontend/src/components/3d/PhysicsCup.tsx` — socket 제거, 로컬 물리 호출
5. `frontend/src/components/3d/PhysicsDice.tsx` — socket 이벤트 제거, useFrame에서 직접 물리 읽기
6. `frontend/src/components/GameScene.tsx` — 물리 엔진 초기화
7. `frontend/src/App.tsx` — socket 연결 제거
8. `frontend/src/store/gameStore.ts` — socket 관련 정리

### 유지
- `backend/` — 그대로 유지 (향후 온라인 대전용)
- `core/` — 변경 없음

## 물리 스텝 타이밍
- useFrame(PhysicsDice) 내에서 step() + getDiceStates() 실행
- 컵 드래그 중에만 step 필요, 그 외(playback/placement/return)에는 스킵
- simulatePour()는 동기 호출 — 프레임 드롭 10-50ms 수준, 허용 가능

## 이벤트 조율
socket 이벤트 대체로 모듈 레벨 이벤트 시스템 사용:
- `emitPourResult(result)` — PhysicsCup이 발행, PhysicsDice+PhysicsCup이 구독
- `emitCollectionDone()` — PhysicsDice return 애니메이션 완료 시 직접 호출
