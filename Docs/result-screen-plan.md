# 결과창 (Game Over Screen) 구현 계획

## 개요

13라운드(양 플레이어 각 13카테고리) 종료 후 표시되는 결과 화면.
간결한 점수 요약 + 승자 표시 + 재경기/메뉴복귀 버튼 + victory.mp3 재생.

---

## 변경 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/components/screens/ResultScreen.tsx` | **신규** — 결과창 컴포넌트 |
| `frontend/src/components/ui/Scoreboard.tsx` | 게임 종료 감지 로직 추가 (handleScoreClick 내) |
| `frontend/src/store/gameStore.ts` | `resetGame()` 함수 추가 (재경기용 상태 초기화) |
| `frontend/src/App.tsx` | `GAME_OVER` phase 라우팅 추가 |

---

## 1. 게임 종료 감지

**위치**: `Scoreboard.tsx` — `handleScoreClick` 내부

현재 `handleScoreClick`은 점수 기록 → `endTurn()` 호출로 끝남.
여기에 **양쪽 플레이어의 12개 기록 카테고리(Bonus 제외)가 모두 채워졌는지** 확인하는 로직 추가.

```
점수 기록 후:
  - 방금 기록한 것 포함하여 p1, p2 각각의 non-Bonus 카테고리 중 null 개수 확인
  - 양쪽 모두 0개이면 → setPhase('GAME_OVER')
  - 아니면 → endTurn() (기존대로)
```

**판단 시점**: `updateScore` 호출 직후, `endTurn` 호출 전.
마지막 카테고리를 기록하는 플레이어가 p2가 아닐 수도 있으므로(p1이 마지막으로 기록 후 p2 차례가 남아있을 수 있음), 정확히는:
- p1이 기록 → p1 남은 카테고리 0개, p2 남은 카테고리 0개 → 게임 종료
- p1이 기록 → p2에 아직 빈 칸 있음 → endTurn (p2 차례)
- p2가 기록 → 양쪽 0개 → 게임 종료

---

## 2. ResultScreen 컴포넌트

**경로**: `frontend/src/components/screens/ResultScreen.tsx`

### 레이아웃

```
┌──────────────────────────────────┐
│         GAME OVER                │
│                                  │
│    P1: 243점     P2: 198점       │
│                                  │
│      ★ Player 1 Wins! ★         │
│       (또는 무승부 표시)           │
│                                  │
│   [다시 하기]    [메인 메뉴]       │
└──────────────────────────────────┘
```

### 표시 정보
- 양 플레이어 최종 총점 (`getTotalScore` 사용)
- 승자 표시 (P1 초록 / P2 파랑 / 무승부 노랑)
- 점수 차이 표시 ("45점 차이")

### 스타일
- 기존 화면들과 동일한 패턴: 풀스크린, `#222` 배경, 중앙 정렬
- 승자 색상: P1=`#4CAF50`, P2=`#2196F3` (기존 스코어보드 컬러 일치)
- 폰트 크기 및 버튼 스타일: MainMenuScreen과 유사

### 사운드
- 화면 진입 시 `soundManager.play('victory')` 1회 재생
- `useEffect`로 마운트 시점에 트리거

---

## 3. gameStore 변경 — resetGame

재경기(Rematch) 및 메뉴 복귀 시 게임 상태를 초기화하는 `resetGame()` 함수 추가.

```typescript
resetGame: () => set({
  scores: { p1: { ...initialScores, Bonus: 0 }, p2: { ...initialScores, Bonus: 0 } },
  currentTurn: 'p1',
  rollCount: 0,
  currentDiceValues: [1, 1, 1, 1, 1],
  previewScores: {} as Record<RulesCategory, number>,
  keptDiceSlots: [null, null, null, null, null],
  canPour: false,
  isInPlacementMode: false,
  isWaitingForPlacement: false,
  isReturningToCup: false,
  isSyncingDice: false,
  placementOrder: [0, 1, 2, 3, 4],
  activeCombo: null,
})
```

---

## 4. App.tsx 라우팅

```tsx
{phase === 'GAME_OVER' && <ResultScreen />}
```

---

## 5. 버튼 동작

| 버튼 | 동작 |
|------|------|
| **다시 하기** (Rematch) | `resetGame()` → `setPhase('GAME')` |
| **메인 메뉴** | `resetGame()` → `setPhase('MAIN_MENU')` |

---

## 구현 순서

1. `gameStore.ts`에 `resetGame` 추가
2. `ResultScreen.tsx` 생성 (점수 표시 + 버튼 + victory 사운드)
3. `App.tsx`에 GAME_OVER 라우팅 추가
4. `Scoreboard.tsx`에 게임 종료 감지 → `setPhase('GAME_OVER')` 연결
5. 테스트: 전체 13라운드 플레이 → 결과창 전환 확인
