# Yacht Dice

3D 물리 기반 야추 주사위 게임. 싱글 플레이(AI 상대), 로컬 2인 대전, 온라인 멀티플레이를 지원합니다.

**GitHub Pages**: https://dnrjke.github.io/yacht/

## 플레이 방법

메인 메뉴에서 `Single Play`, `Local Play`, `Online`을 선택합니다. 온라인 모드에서는 방을 생성하거나 6자리 코드로 참가합니다. 컵을 드래그해서 흔들고 놓으면 주사위가 쏟아집니다. 턴당 최대 3회 굴릴 수 있고, 원하는 주사위를 탭해 킵한 뒤 점수판에서 카테고리를 선택해 기록합니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 18 + TypeScript + Vite |
| 3D 렌더링 | Three.js, @react-three/fiber, @react-three/drei |
| 물리 엔진 | Rapier 3D WASM (클라이언트 + 서버 동일) |
| 상태 관리 | Zustand |
| 네트워킹 | Socket.io (클라이언트 + 서버) |
| 백엔드 | Express + Socket.io + Rapier 3D |
| 공유 로직 | npm workspaces + `@yacht/core` |
| 배포 | GitHub Pages (GitHub Actions, Vite `base: '/yacht/'`) |

## 모노레포 구조

```
yacht/
  package.json                 # npm workspaces 루트, server 빌드/실행 스크립트
  run.ps1                      # core 빌드 후 backend(:3001) + frontend(:5173) 동시 실행
  frontend/                    # React + R3F 클라이언트
    src/
      App.tsx                  # GamePhase에 따라 Splash/MainMenu/Lobby/Game 분기
      main.tsx                 # React 진입점 + PWA viewport 동기화
      GameScene.tsx            # R3F Canvas, 카메라, 3D 오브젝트 조립
      ai/
        AiController.tsx       # 싱글 플레이 P2 AI 턴 오케스트레이션과 의사결정
      components/
        3d/                    # 컵, 주사위, 보드, 리롤 버튼, 콤보 연출
          PhysicsBoard.tsx     # 보드·벽·트레이 메시 + Rapier 콜라이더
          PhysicsCup.tsx       # 드래그 컵, 쏟기, 셰이크 보간(온라인)
          PhysicsDice.tsx      # 5개 주사위 메시, Rapier 리지드바디 동기화
          ComboAnnouncement.tsx # Yacht/Large Straight 3D 텍스트 연출
          DecisionButton.tsx   # Reroll/End Turn 플로팅 버튼
        screens/
          SplashScreen.tsx     # LOBBY: Touch to Start
          MainMenuScreen.tsx   # MAIN_MENU: 모드 선택, 설정
          LobbyScreen.tsx      # ONLINE_LOBBY: 방 생성/참가, 코드 입력
          GameScreen.tsx       # GAME/GAME_OVER: 3D 씬 + 점수판 + 결과 오버레이
          ResultScreen.tsx     # 승자 표시, 리매치, 메인 메뉴
        ui/
          Scoreboard.tsx       # 가로형 13카테고리 점수판 (compact 모드 지원)
          PortraitScoreboard.tsx # 세로(DS형) 2단 점수판
          TurnIndicator.tsx    # 현재 턴 표시 + 색상
          TurnTimer.tsx        # 온라인 60초 턴 타이머
          AutoPlayOverlay.tsx  # 자동 플레이 상태 오버레이
          DebugOverlay.tsx     # FPS, 소켓 이벤트 속도, 물리 타이밍 디버그 HUD
          useScoreClick.ts     # 점수 제출 공통 로직
      network/
        socket.ts              # Socket.io 클라이언트 연결, 이벤트 핸들러
        identity.ts            # 플레이어 ID 생성/복원, 재접속 정보 관리
        shakeBuffer.ts         # 상대 셰이크 프레임 보간 버퍼 (180ms 딜레이)
        spectatorBuffer.ts     # 관전자 쏟기 동기화 버퍼 (250ms)
      physics/
        physicsEngine.ts       # Rapier 물리 싱글턴 팩토리 + 이벤트 에미터
        PhysicsWorld.ts        # 클라이언트 Rapier 물리 시뮬레이션
      store/
        gameStore.ts           # Zustand 게임 상태와 액션
      utils/
        i18n.ts                # 7개 언어 (ko, en, ja, zh, es, fr, de)
        soundManager.ts        # Web Audio API, 9개 사운드 이펙트, 마스터 볼륨
        perfMonitor.ts         # FPS, 소켓 이벤트 속도, 핸들러 지속시간 추적
        viewportSync.ts        # 모바일 PWA visualViewport → CSS 변수 동기화
    public/                    # PWA manifest/sw 및 사운드 에셋
  backend/                     # Express + Socket.io 온라인 서버
    src/
      server.ts                # Express + Socket.io, 방 관리, rate limiting, 연결 품질
      RoomManager.ts           # 방 생성/참가/삭제, 6자리 코드, 최대 25방
      ServerGameState.ts       # 턴 상태 머신, 턴 타이머(60초), 이벤트 검증
      GameActions.ts           # 게임 이벤트 핸들러 (쏟기/킵/리롤/점수 제출)
      ServerAutoPlay.ts        # 연결 끊긴 플레이어 AI 자동 플레이
      RoomPhysicsLoop.ts       # 60fps 물리 틱, 셰이크 입력 릴레이
      physics/PhysicsWorld.ts  # 서버용 Rapier 물리 월드
  core/                        # @yacht/core: 공유 상수, 타입, 점수/콤보/AI 로직
    src/
      index.ts                 # 공유 export 진입점
      scoring.ts               # 야추 점수 계산과 콤보 감지
      ai/yachtAi.ts            # AI 의사결정 (score/reroll 선택)
  Docs/                        # 구현 계획과 작업 문서
```

## 아키텍처

### 클라이언트 물리

- `PhysicsWorld`가 컵, 주사위, 보드/벽/트레이 콜라이더를 관리합니다.
- 컵 드래그 중 `updateCupTransform()` → 매 프레임 `step()` → `getDiceStates()`로 주사위 위치를 반영합니다.
- 쏟기 시 `simulatePour()`가 기울이기, 쏟기, 복귀, 안정화까지의 궤적을 계산하고 `onPourResult()` 구독자들이 컵/주사위 애니메이션을 재생합니다.
- 새 게임 시작 시 `resetGame()`이 Zustand 상태와 물리 싱글턴 상태를 함께 초기화합니다.

### 게임 상태

`frontend/src/store/gameStore.ts`가 다음 상태를 소유합니다.

```ts
export type GameMode = 'local' | 'single' | 'online';
export type GamePhase = 'LOBBY' | 'MAIN_MENU' | 'ONLINE_LOBBY' | 'GAME' | 'GAME_OVER';
```

- 점수판, 현재 턴, 굴림 횟수, 현재 주사위 값, 프리뷰 점수
- 킵 슬롯, 배치 모드, 컵 복귀/동기화 플래그, 콤보 연출 상태
- 온라인: myRole, roomId, opponentName, 연결 상태, 턴 타이머, 자동 플레이 상태
- `resetGame()`, `endTurn()`, `keepDie()`, `unkeepDie()`, `updateScore()` 등 게임 진행 액션

### 온라인 멀티플레이어

프론트엔드가 Socket.io로 백엔드와 실시간 통신합니다. 서버가 턴 진행, 이벤트 검증, 점수 기록의 권위를 가지며, 물리 시뮬레이션은 클라이언트에서 실행 후 서버에 결과를 전송합니다.

- **방 관리**: 6자리 코드 기반, 최대 25방
- **재접속**: 30초 유예 기간, localStorage에 재접속 정보 보존
- **자동 플레이**: 연결 끊긴 플레이어를 서버 AI가 대행 (`@yacht/core`의 `chooseAction()`)
- **셰이크 보간**: 상대 컵 흔들기를 180ms 보간 버퍼로 부드럽게 표시
- **관전 동기화**: 250ms 버퍼로 쏟기 시점 동기화
- **턴 타이머**: 60초 제한, 초과 시 자동 플레이 전환
- **연결 품질**: 3샘플 RTT 롤링 평균 → good/unstable/poor 분류
- **Rate limiting**: 게임 이벤트 10/sec, 셰이크 이벤트 75/sec

### 공유 로직 (`@yacht/core`)

| 함수/상수 | 시그니처 | 설명 |
|---|---|---|
| `calculateScore` | `(dice: number[], category: RulesCategory) => number` | 5개 주사위와 카테고리로 점수 계산 |
| `checkBonus` | `(scoreBoard: ScoreBoard) => number` | 상단 합계 63점 이상이면 35점 |
| `getUpperTotal` | `(scoreBoard: ScoreBoard) => number` | Aces~Sixes 합계 |
| `getTotalScore` | `(scoreBoard: ScoreBoard) => number` | 점수판 총점 |
| `detectCombo` | `(dice: number[]) => ComboResult \| null` | Yacht, Large Straight 등 최고 우선순위 콤보 감지 |
| `chooseAction` | `(dice: number[], board, rollsLeft: number) => AiDecision` | AI 의사결정: score 또는 reroll + 킵 인덱스 |
| `getTraySlotPosition` | `(slotIdx: number) => { x, y, z }` | 킵 트레이 슬롯 월드 좌표 |
| `derivePlacementOrder` | `(keptDiceSlots, diceValues) => number[]` | 비킵 주사위 인덱스 (값순 정렬) |
| `SCORE_CATEGORIES` | `RulesCategory[]` | 13개 점수 카테고리 순서 |
| `BOARD_CONSTANTS` | `as const` | 보드, 벽, 트레이, 컵 기본 좌표 |
| `GAME_CONSTANTS` | `as const` | 최대 굴림 횟수 등 게임 규칙 상수 |
| `CUP_DICE_OFFSETS` | `{ x, y, z }[]` | 컵 내부 주사위 상대 위치 (5개) |

```ts
export type RulesCategory =
  | 'Aces' | 'Deuces' | 'Threes' | 'Fours' | 'Fives' | 'Sixes' | 'Bonus'
  | 'Choice' | 'FourOfAKind' | 'FullHouse' | 'SmallStraight'
  | 'LargeStraight' | 'Yacht';

export type GamePhase = 'LOBBY' | 'MAIN_MENU' | 'ONLINE_LOBBY' | 'GAME' | 'GAME_OVER';
export type GameMode = 'local' | 'single' | 'online';
export type TurnPhase = 'waiting_pour' | 'simulating' | 'placement' | 'collecting' | 'scoring';
export type ConnectionQuality = 'good' | 'unstable' | 'poor';

export interface ComboResult { name: string; tier: 1 | 2; }
export interface PlayerIdentity { playerId: string; secret: string; playerName: string; }
export interface OnlineRollResult extends OnlineTurnContext {
  rollCount: number; serverStartedAt: number;
  finalValues: number[]; diceTrajectory: OnlineDiceFrame[][];
  cupTrajectory: OnlineTransform[];
}
```

### 백엔드 서버

`backend/src/server.ts`는 방 관리, 턴 진행, 이벤트 검증, 자동 플레이를 담당하는 온라인 게임 서버입니다.

| 방향 | 이벤트 | 역할 |
|---|---|---|
| Client → Server | `CREATE_ROOM` | 방 생성 (playerName, playerId, secret) |
| Client → Server | `JOIN_ROOM` | 코드로 방 참가 |
| Client → Server | `RECONNECT` | 재접속 시도 |
| Client → Server | `CUP_SHAKE_STATE` | 컵 흔들기 상태 전송 |
| Client → Server | `POUR_CUP` | 쏟기 시뮬레이션 요청 |
| Client → Server | `KEEP_DIE` / `UNKEEP_DIE` | 주사위 킵/언킵 |
| Client → Server | `REROLL` | 리롤 요청 |
| Client → Server | `SUBMIT_SCORE` | 카테고리 점수 제출 |
| Client → Server | `COLLECTION_DONE` | 컵 복귀 완료 알림 |
| Client → Server | `REQUEST_REMATCH` | 리매치 요청 |
| Server → Client | `GAME_START` | 게임 시작 (turnNumber, rollId) |
| Server → Client | `POUR_RESULT` | 쏟기 궤적과 최종 결과 |
| Server → Client | `POUR_ACCEPTED` / `POUR_REJECTED` | 쏟기 수락/거절 |
| Server → Client | `CAN_POUR` | 쏟기 가능 신호 |
| Server → Client | `TURN_ADVANCED` | 턴 교대 |
| Server → Client | `OPPONENT_SHAKE_STATE` | 상대 셰이크 릴레이 |
| Server → Client | `OPPONENT_DISCONNECTED` | 상대 연결 끊김 (유예 기간) |
| Server → Client | `AUTO_PLAY_STARTED` / `AUTO_PLAY_ENDED` | 자동 플레이 시작/종료 |
| Server → Client | `TURN_TIMER_SYNC` | 턴 타이머 잔여 시간 |
| Server → Client | `OPPONENT_CONNECTION_QUALITY` | 상대 연결 품질 |
| Server → Client | `RECONNECT_OK` / `RECONNECT_FAIL` | 재접속 결과 |
| Server → Client | `GAME_FINISHED` | 게임 종료 |

## 기능

- 싱글 플레이 AI 상대, 로컬 2인 대전, 온라인 멀티플레이
- 온라인: 방 코드 매칭, 재접속(30초 유예), 자동 플레이, 60초 턴 타이머
- 온라인: 상대 연결 품질 표시, 셰이크 보간, 관전 동기화
- 3D 물리 기반 컵 흔들기/주사위 쏟기
- 주사위 킵/언킵, 카메라 HUD 배치, 트레이 고정
- 13개 야추 카테고리 점수 계산과 상단 보너스
- Yacht, Large Straight 등 콤보 감지 및 3D 연출
- 가로형/세로형 반응형 점수판과 모바일 대응 카메라
- 결과 오버레이: 승자 표시, 리매치, 메인 메뉴
- 마스터 볼륨 조절과 7개 언어 UI (ko, en, ja, zh, es, fr, de)
- PWA 전체화면 대응과 `?debug` 디버그 표시

## 게임 흐름

```
LOBBY (스플래시 / Touch to Start)
  -> MAIN_MENU (Single Play, Local Play, Online, Settings)
    -> GAME (각 턴: 굴리기 최대 3회 -> 킵/리롤 -> 점수 기록 -> 턴 교대)
      -> GAME_OVER (ResultOverlay -> 리매치 / 메인 메뉴)
    -> ONLINE_LOBBY (방 생성 또는 코드 참가 -> 상대 대기)
      -> GAME (온라인: 서버 권위 턴 진행)
        -> GAME_OVER
```

## 로컬 개발

처음 설치:

```bash
npm install
```

프론트엔드 단독 실행 (싱글/로컬 모드):

```bash
npm run build --workspace=core
npm run dev --workspace=frontend
```

http://localhost:5173 에서 실행됩니다. URL에 `?debug`를 붙이면 디버그 표시가 활성화됩니다.

백엔드까지 함께 실행 (온라인 모드):

```powershell
.\run.ps1
```

Windows Terminal이 있으면 분할 패널로, 없으면 별도 창으로 backend(:3001) + frontend(:5173)을 동시 실행합니다.

워크스페이스별 주요 명령:

```bash
npm run build --workspace=core
npm run dev --workspace=frontend
npm run build --workspace=frontend
npm run lint --workspace=frontend
npm run dev --workspace=backend
npm run build --workspace=backend
npm run build:server
npm run start:server
```

## 배포

`main` 브랜치에 push하면 GitHub Actions가 `core`와 `frontend`를 빌드한 뒤 `frontend/dist`를 GitHub Pages에 배포합니다. 배포 경로는 Vite 설정의 `/yacht/` 서브패스를 기준으로 합니다. 백엔드는 별도 호스팅이 필요합니다.
