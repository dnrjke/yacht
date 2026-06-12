# Yacht Dice

3D 물리 기반 야추 주사위 게임. 현재 플레이 가능한 기본 모드는 싱글 플레이(AI 상대)와 로컬 2인 대전입니다.

**GitHub Pages**: https://dnrjke.github.io/yacht/

## 플레이 방법

메인 메뉴에서 `Single Play` 또는 `Local Play`를 선택합니다. 컵을 드래그해서 흔들고 놓으면 주사위가 쏟아집니다. 턴당 최대 3회 굴릴 수 있고, 원하는 주사위를 탭해 킵한 뒤 점수판에서 카테고리를 선택해 기록합니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 18 + TypeScript + Vite |
| 3D 렌더링 | Three.js, @react-three/fiber, @react-three/drei |
| 물리 엔진 | Rapier 3D WASM |
| 상태 관리 | Zustand |
| 백엔드 | Express + Socket.io + Rapier 3D |
| 공유 로직 | npm workspaces + `@yacht/core` |
| 배포 | GitHub Pages (GitHub Actions, Vite `base: '/yacht/'`) |

## 모노레포 구조

```
yacht/
  package.json                 # npm workspaces 루트, server 빌드/실행 스크립트
  run.ps1                      # core 빌드 후 backend(:3001) + frontend(:5173) 동시 실행
  frontend/                    # React + R3F 클라이언트. 현재 실제 플레이의 기본 런타임
    src/
      App.tsx                  # GamePhase에 따라 Splash/MainMenu/Game 분기
      main.tsx                 # React 진입점 + PWA viewport 동기화
      ai/                      # 싱글 플레이 P2 AI 턴 오케스트레이션과 의사결정
      components/
        GameScene.tsx          # R3F Canvas, 카메라, 3D 오브젝트 조립
        3d/                    # 컵, 주사위, 보드, 리롤 버튼, 콤보 연출
        screens/               # Splash, MainMenu, GameScreen, ResultOverlay
        ui/                    # 가로/세로 점수판, 점수 클릭 공통 로직
      physics/                 # 클라이언트 Rapier 물리 월드와 싱글톤 이벤트 버스
      store/                   # Zustand 게임 상태와 액션
      utils/                   # 사운드, i18n, viewport, 성능 유틸
    public/                    # PWA manifest/sw 및 사운드 경로
  backend/                     # Express + Socket.io 물리 서버. 구현됨, 프론트와는 아직 미연결
    src/
      server.ts                # /health, Socket.io 이벤트, 60fps 물리 브로드캐스트
      physics/PhysicsWorld.ts  # 서버용 Rapier 물리 월드
  core/                        # @yacht/core: 공유 상수, 타입, 점수/콤보 로직
    src/
      index.ts                 # 공유 export 진입점
      scoring.ts               # 야추 점수 계산과 콤보 감지
  Docs/                        # 구현 계획과 작업 문서
```

## 아키텍처

현재 프론트엔드는 서버 연결 없이 클라이언트 Rapier 물리를 직접 실행합니다. 백엔드에도 같은 방향의 물리 서버가 구현되어 있지만, 현 프론트 플레이 흐름은 `socket.io-client`를 사용하지 않습니다.

### 클라이언트 물리

- `PhysicsWorld`가 컵, 주사위, 보드/벽/트레이 콜라이더를 관리합니다.
- 컵 드래그 중 `updateCupTransform()` → 매 프레임 `step()` → `getDiceStates()`로 주사위 위치를 반영합니다.
- 쏟기 시 `simulatePour()`가 기울이기, 쏟기, 복귀, 안정화까지의 궤적을 계산하고 `onPourResult()` 구독자들이 컵/주사위 애니메이션을 재생합니다.
- 새 게임 시작 시 `resetGame()`이 Zustand 상태와 물리 싱글턴 상태를 함께 초기화합니다.

### 게임 상태

`frontend/src/store/gameStore.ts`가 다음 상태를 소유합니다.

```ts
export type GameMode = 'local' | 'single';
export type GamePhase = 'LOBBY' | 'MAIN_MENU' | 'GAME' | 'GAME_OVER';
```

- 점수판, 현재 턴, 굴림 횟수, 현재 주사위 값, 프리뷰 점수
- 킵 슬롯, 배치 모드, 컵 복귀/동기화 플래그, 콤보 연출 상태
- `resetGame()`, `endTurn()`, `keepDie()`, `unkeepDie()`, `updateScore()` 등 게임 진행 액션

### 공유 로직 (`@yacht/core`)

| 함수/상수 | 시그니처 | 설명 |
|---|---|---|
| `calculateScore` | `(dice: number[], category: RulesCategory) => number` | 5개 주사위와 카테고리로 점수 계산 |
| `checkBonus` | `(scoreBoard: ScoreBoard) => number` | 상단 합계 63점 이상이면 35점 |
| `getUpperTotal` | `(scoreBoard: ScoreBoard) => number` | Aces~Sixes 합계 |
| `getTotalScore` | `(scoreBoard: ScoreBoard) => number` | 점수판 총점 |
| `detectCombo` | `(dice: number[]) => ComboResult | null` | Yacht, Large Straight 등 최고 우선순위 콤보 감지 |
| `getTraySlotPosition` | `(slotIdx: number) => { x: number; y: number; z: number }` | 킵 트레이 슬롯 월드 좌표 |
| `SCORE_CATEGORIES` | `RulesCategory[]` | 13개 점수 카테고리 순서 |
| `BOARD_CONSTANTS` | `as const` | 보드, 벽, 트레이, 컵 기본 좌표 |

```ts
export type RulesCategory =
  | 'Aces' | 'Deuces' | 'Threes' | 'Fours' | 'Fives' | 'Sixes' | 'Bonus'
  | 'Choice' | 'FourOfAKind' | 'FullHouse' | 'SmallStraight'
  | 'LargeStraight' | 'Yacht';

export interface ComboResult {
  name: string;
  tier: 1 | 2;
}
```

### 백엔드 물리 서버

`backend/src/server.ts`는 물리 전용 서버입니다. 플레이어, 턴, 점수, 게임 페이즈는 소유하지 않습니다.

| 방향 | 이벤트 | 역할 |
|---|---|---|
| Client → Server | `CUP_TRANSFORM` | 컵 위치/회전 갱신 |
| Client → Server | `POUR_CUP` | 쏟기 시뮬레이션 요청 |
| Client → Server | `COLLECT_TO_CUP` | 비킵 주사위를 컵으로 복귀 |
| Server → Client | `DICE_STATES` | 60fps 주사위 상태 브로드캐스트 |
| Server → Client | `POUR_RESULT` | 쏟기 궤적과 최종 결과 |
| Server → Client | `COLLECTION_DONE` | 컵 복귀 완료 알림 |

## 기능

- 싱글 플레이 AI 상대와 로컬 2인 대전
- 3D 물리 기반 컵 흔들기/주사위 쏟기
- 주사위 킵/언킵, 카메라 HUD 배치, 트레이 고정
- 13개 야추 카테고리 점수 계산과 상단 보너스
- Yacht, Large Straight 등 콤보 감지 및 3D 연출
- 가로형/세로형 반응형 점수판과 모바일 대응 카메라
- 결과 오버레이: 승자 표시, 다시 플레이, 메인 메뉴
- 마스터 볼륨 조절과 7개 언어 UI
- PWA 전체화면 대응과 `?debug` 디버그 표시

## 게임 흐름

```
LOBBY (스플래시 / Touch to Start)
  -> MAIN_MENU (Single Play, Local Play, Settings)
    -> GAME (각 턴: 굴리기 최대 3회 -> 킵/리롤 -> 점수 기록 -> 턴 교대)
      -> GAME_OVER (ResultOverlay -> 다시 플레이 / 메인 메뉴)
```

## 로컬 개발

처음 설치:

```bash
npm install
```

프론트엔드 단독 실행:

```bash
npm run build --workspace=core
npm run dev --workspace=frontend
```

http://localhost:5173 에서 실행됩니다. URL에 `?debug`를 붙이면 디버그 표시가 활성화됩니다.

백엔드까지 함께 실행하려면 Windows에서 다음 스크립트를 사용할 수 있습니다.

```powershell
.\run.ps1
```

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

`main` 브랜치에 push하면 GitHub Actions가 `core`와 `frontend`를 빌드한 뒤 `frontend/dist`를 GitHub Pages에 배포합니다. 배포 경로는 Vite 설정의 `/yacht/` 서브패스를 기준으로 합니다.
