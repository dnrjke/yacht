# 싱글 플레이 (AI) 모드 계획

## 목표
메인 화면에 싱글 플레이 모드 추가. P2를 AI가 대체:
- AI가 야추통 붓기(셰이크 연출 포함), 주사위 키핑, 리롤 판단, 점수 기입을 수행
- AI(P2) 턴 동안 사람의 입력(컵 조작·키핑·리롤 버튼·점수 기입) 차단
- 턴 표시·점수판 헤더·결과 화면에서 P2를 AI로 표기

## 아키텍처

### 상태
- `gameStore`에 `gameMode: 'local' | 'single'` + `setGameMode` 추가
- AI 턴 판정 헬퍼 `isAiTurnNow()` (= single && currentTurn === 'p2') export —
  이벤트 핸들러들이 getState 기반으로 호출

### AI 두뇌: `frontend/src/ai/yachtAi.ts` (순수 함수)
`chooseAction(dice, board, rollsLeft) → { action: 'score', category } | { action: 'reroll', keepIndices }`

판단 규칙 (휴리스틱):
1. 리롤 소진 → 최적 카테고리 기입
2. 완성 콤보 즉시 기입: Yacht(50), LargeStraight(30), FullHouse
3. FourOfAKind 완성 + Yacht 열려있음 + 리롤 남음 → 4개 킵하고 야추 추격 (리스크 없음)
4. SmallStraight 완성 + LargeStraight 열림 + 연장 가능 → 런 킵하고 LS 추격, 아니면 SS 기입
5. 그 외 타깃 선택:
   - 스트레이트 추격: 고유값 런 4개 이상, 또는 (런 3 + 페어 없음 + 리롤 2회)
   - 면(face) 추격: 최다 등장 면 킵 (동률 시 높은 면, 상단 열림/4oK/Yacht 열림 가중)
   - 전부 1개씩 + 스트레이트 닫힘 → 전체 리롤
6. 기입 카테고리 선정: `score - 희생비용(카테고리별) + 상단 보너스 진행 가중`
   - 0점 기입 시 아까운 순서: Yacht > LargeStraight > FourOfAKind > Choice > FullHouse > …> Aces
   - Choice 저점 낭비 방지 약한 패널티

### AI 오케스트레이터: `frontend/src/ai/AiController.tsx`
GameScreen의 공용 sceneContent에 마운트되는 무화면 컴포넌트. store 구독으로 동작:
- **붓기 트리거**: AI 턴 && canPour && !placement → 0.7~1.3초 사고 딜레이 후 `requestAiPour()`
- **placement 트리거**: AI 턴 && isInPlacementMode → 0.8~1.3초 후 `chooseAction` 실행:
  - 키핑 조정: 현재 킵과 목표 킵 diff → unkeep/keep을 ~0.4초 간격으로 순차 탭 (사운드 포함)
  - 이후 리롤(DecisionButton 로직 재현 + reroll 사운드) 또는 점수 기입
- 모든 타이머는 effect cleanup에서 해제, 각 스텝 실행 전 상태 재검증 (홈 이탈/리셋 대비)

### AI 붓기 연출: PhysicsCup 확장
- `physicsEngine.ts`에 `onAiPour / requestAiPour` 이벤트 추가
- PhysicsCup이 구독: 컵을 보드 위 랜덤 지점으로 이동시키며 ~1.1초 셰이크
  (사인 진동 + `updateCupTransform`으로 내부 주사위 실제 덜그럭 + rolling_dice 루프 사운드)
  → 완료 시 사람과 동일한 `simulatePour` + `emitPourResult` 경로
- 리팩터: cupTrajectory 재생·pouring 사운드를 `onPourResult` 구독으로 이동 —
  사람/AI 붓기가 같은 재생 경로 공유 (기존엔 pointerup 핸들러에서 직접 설정)

### 점수 기입 공용화
- `useScoreClick.ts`: 로직을 `applyScoreAndAdvance(cat)` 순수 함수로 분리 (getState 기반)
- 훅 반환 핸들러는 AI 턴 가드 추가 (사람 클릭 차단), AI는 함수 직접 호출

### 입력 차단 (AI 턴)
| 입력 | 위치 | 처리 |
|---|---|---|
| 컵 드래그 | PhysicsCup onPointerDown | `isAiTurnNow()` 가드 (+AI 셰이크 중 가드) |
| 주사위 키핑 탭 | PhysicsDice onPointerDown | 동일 가드 |
| 리롤 버튼 | DecisionButton onPointerDown | 동일 가드 |
| 점수 기입 | useScoreClick 핸들러 | 동일 가드 |

### UI 표기
- MainMenu: `Single Play` 버튼 신설 (Local Play 위). 두 버튼 모두 진입 시
  `resetGame()` + `setGameMode()` 호출 (홈 이탈 후 재진입 시 잔여 상태 방지)
- 턴 라벨: single && p2 → `t('aiTurn')` (7개 언어 추가). 점수판 P2 헤더 → 'AI'
- ResultScreen: single 모드에서 'Player 2' → 'AI', 'AI Wins!' 표기

## 영향 범위
- 신규: `ai/yachtAi.ts`, `ai/AiController.tsx`
- 수정: gameStore, physicsEngine(이벤트), PhysicsCup(셰이크+재생 경로), PhysicsDice(가드),
  DecisionButton(가드), useScoreClick(분리+가드), MainMenu, GameScreen(라벨),
  Scoreboard/PortraitScoreboard(헤더), ResultScreen(표기), i18n(aiTurn)

## 리스크
- PhysicsCup 재생 경로 리팩터가 사람 붓기에도 영향 — 동작 동일성 확인 필요 (같은 데이터로
  같은 재생을 구독에서 시작하는 구조라 위험도 낮음)
- AI 턴 중 홈 이탈/리매치 시 타이머 잔존 → cleanup + 스텝별 상태 재검증으로 방어
- AI 강도는 휴리스틱 수준 (EV 완전 계산 아님) — 체감 난이도는 플레이 후 조정 가능
