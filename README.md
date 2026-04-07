# 🎲 3D Yacht Dice (멀티플레이어 야추 다이스)

환영합니다! 이 프로젝트는 Three.js 3D 환경과 물리 엔진을 기반으로 동작하는 실시간 멀티플레이어 보드게임 '야추 다이스(Yacht Dice)' 입니다.

초심자나 프로젝트를 처음 접하는 분들도 구조를 쉽게 파악하고 개발에 참여할 수 있도록 전체적인 아키텍처와 흐름을 설명합니다.

---

## 🏗️ 프로젝트 디렉터리 구조 (Monorepo)

이 프로젝트는 **NPM Workspaces**를 활용한 모노레포(Monorepo) 구조로 되어 있습니다. 프론트엔드와 백엔드가 분리되어 있지만, 하나의 저장소 안에서 핵심 로직 패키지를 서로 공유하며 사용합니다.

```text
c:\yacht\
├── package.json        (최상위 워크스페이스 관리 - NPM Workspaces)
├── .gitignore          (깃허브 커밋 시 제외할 파일 및 폴더 설정)
├── 실행하기.bat        (원클릭 통합 실행 배치 파일 - **권장**)
├── run.ps1             (통합 실행 내부 스크립트)
│
├── core/               (공유 로직 패키지 - @yacht/core)
│   ├── src/
│   │   ├── index.ts        (게임 페이즈·보드 상수·공통 타입 정의)
│   │   └── scoring.ts      (야추 족보 점수 계산·콤보 감지 로직)
│   ├── dist/           (빌드 산출물 - index.js, scoring.js + d.ts)
│   └── package.json
│
├── frontend/           (클라이언트 - React + Three.js)
│   ├── public/         (텍스처, 3D 모델, 효과음 등 정적 파일)
│   ├── src/
│   │   ├── components/
│   │   │   ├── 3d/         (Three.js 3D 렌더링 영역)
│   │   │   │   ├── PhysicsDice.tsx       (주사위 궤적 재생·HUD 정렬·트레이 토글)
│   │   │   │   ├── PhysicsCup.tsx        (야추통 드래그 조작 및 소켓 통신)
│   │   │   │   ├── PhysicsBoard.tsx      (보드 지오메트리·펠트 바닥·벽·키핑 트레이)
│   │   │   │   ├── DecisionButton.tsx    (배치 모드 '다시 굴리기' 버튼 GUI)
│   │   │   │   └── ComboAnnouncement.tsx (족보 콤보 이펙트·골든 셰이더·파티클)
│   │   │   ├── screens/    (스플래시, 메뉴, 게임 화면 등 전체 UI)
│   │   │   │   ├── SplashScreen.tsx      (로딩 스플래시, 2.5초 타이머)
│   │   │   │   ├── TouchScreen.tsx       (터치/키 입력 대기 화면)
│   │   │   │   ├── MainMenuScreen.tsx    (멀티플레이·설정 버튼)
│   │   │   │   └── GameScreen.tsx        (메인 게임플레이 레이아웃)
│   │   │   ├── ui/         (HTML/CSS UI 조각)
│   │   │   │   ├── Scoreboard.tsx        (점수판 테이블·클릭 기록)
│   │   │   │   └── TurnIndicator.tsx     (굴림 횟수 표시)
│   │   │   └── GameScene.tsx             (Three.js Canvas·카메라·조명·그림자 설정)
│   │   ├── store/
│   │   │   └── gameStore.ts (Zustand 전역 상태 - 점수·주사위·턴·소켓)
│   │   ├── App.tsx     (소켓 초기화 및 페이즈 라우팅)
│   │   ├── main.tsx    (React 마운트 엔트리포인트)
│   │   └── index.css   (전역 스타일)
│   └── package.json
│
├── backend/            (서버 - Node.js + Express + Socket.io)
│   ├── src/
│   │   ├── physics/
│   │   │   └── PhysicsWorld.ts       (Rapier 3D 물리 시뮬레이션·궤적 생성)
│   │   └── server.ts   (소켓 이벤트 수신·브로드캐스트·60FPS 물리 루프)
│   └── package.json
│
├── Docs/               (설계 문서 및 가이드)
│   ├── implementation_plan.md     (아키텍처 개요·개발 단계)
│   ├── rapier-migration-plan.md   (cannon-es → Rapier 마이그레이션 계획)
│   ├── cup-animation-redesign.md  (컵 붓기 애니메이션 개선 설계)
│   ├── cup-phase0-position-change.md (컵 기본 위치 변경 계획)
│   └── task.md                    (개발 작업 체크리스트)
│
└── node_modules/       (자동 설치 - 커밋 제외)
```

---

## 🛠️ 핵심 기술 스택

* **Frontend**: `React` (UI 구성), `Zustand` (상태 관리), `@react-three/fiber` (React 기반 Three.js 3D 렌더링)
* **Backend**: `Node.js`, `Socket.io` (실시간 소켓 통신)
* **Physics / Game Engine**: `@dimforge/rapier3d-compat` (Rapier 3D WASM 물리 엔진, cannon-es에서 마이그레이션 완료)
* **Shared Logic**: `TypeScript` ES Modules

---

## 🧠 핵심 동작 원리: "결정론적 물리 동기화"

온라인 멀티플레이 주사위 게임에서 가장 큰 문제는 **"모든 플레이어가 동일한 주사위 결과를 보아야 한다"**는 것입니다. 만약 클라이언트(브라우저)에서 각자 주사위를 굴린다면 랜섬 값으로 인해 서로 다른 점수를 보게 됩니다.

이를 해결하기 위해 이 프로젝트는 다음과 같은 혁신적이고 견고한 방식을 사용합니다.

### 1. 흔들기 단계 (Shaking Phase)
- **프론트엔드**: 플레이어가 화면의 야추통을 클릭하고 드래그(`onPointerDown`)하면, 해당 마우스 좌표가 3D 공간으로 변환됩니다. 프론트엔드는 이 "통의 위치"를 `CUP_TRANSFORM` 이라는 이름표를 달아 빈번하게 서버로 보냅니다 (`PhysicsCup.tsx`).
- **백엔드**: 서버는 클라이언트의 통 위치를 받아 "보이지 않는 서버측 Rapier 물리 세계(`PhysicsWorld`)" 안에 있는 가상의 통을 움직입니다. 서버는 그 안에 담긴 5개의 주사위가 통 안에서 부딪히는 모습을 실시간으로 계산(1/240초 서브스텝 × 4)하여 모든 접속자에게 60FPS로 브로드캐스트합니다.

### 2. 붓기 단계 (Pouring Phase)
- **명령**: 플레이어가 야추통 드래그를 중단하면 `POUR_CUP` 이벤트가 발생합니다.
- **예측 연산 (Server-side Determinism)**:
  1. 서버는 즉시 브로드캐스트를 멈추고 `simulatePour`를 실행합니다: 컵을 130° 기울이기(40프레임) → 수직 상승(20프레임) → 주사위 안정화 대기(최대 600프레임).
  2. 서버는 **컵 궤적 + 주사위별 궤적 + 최종 결과**(ex. 1, 3, 3, 4, 6)를 `POUR_RESULT`로 클라이언트에 보냅니다.
- **재생 (Playback)**: 클라이언트(`PhysicsDice.tsx`)는 서버가 보낸 궤적 데이터를 마치 비디오를 틀듯이 화면에 그대로 재생합니다. 이미 미래(결과)가 결정된 애니메이션을 틀어주기 때문에 **네트워크 지연이 발생해도 결과가 100% 동일**하며 플레이어들은 매우 부드러운 3D 물리 효과를 감상할 수 있습니다.
- **콤보 감지**: 재생 완료 후 `detectCombo()`가 족보를 판별하고, 야추(Yacht) 등 특수 조합이면 골든 셰이더 이펙트와 파티클로 `ComboAnnouncement`가 표시됩니다.

### 3. 평가 및 보관 (Keeping & Placement)
- **배치 모드 (HUD)**: 주사위가 멈추면 카메라 앞(`HUD`)에 주사위들이 정렬됩니다. 이 UI는 단순한 평면이 아니라 3D 공간 상에서 카메라를 따라다니며, 항상 정해진 눈이 카메라를 향하도록 `FACE_NORMALS` 룩업으로 보정됩니다.
- **키핑 트레이 (Keep Tray)**: 주사위를 클릭하면 보드 상단의 '키핑 트레이'(5슬롯, 3유닛 간격)로 이동하며, 다음 굴리기에서 제외됩니다. 트레이의 주사위는 해당 눈금이 위를 향하도록 고정됩니다.
- **다시 굴리기 (DecisionButton)**: 빌보드 방식의 '다시 굴리기' 버튼(`DecisionButton.tsx`)을 누르면 `COLLECT_TO_CUP` 이벤트가 전송됩니다. 서버는 트레이에 있는 주사위를 물리 세계에서 고정(freeze)하고, 나머지 주사위만 야추통으로 돌아가 다음 굴리기를 준비합니다.
- **점수 기록**: 플레이어가 점수판(`Scoreboard.tsx`)에서 미기록 카테고리를 클릭하면 점수가 기록되고, `endTurn()`으로 턴이 교대됩니다. 상단 합계 63점 이상 시 보너스 +35가 자동 부여됩니다.

---
 
## 🛠️ 초간단 작업 루틴
- **코드 수정**: `frontend`나 `backend` 파일 수정 시 **Vite HMR**에 의해 즉시 반영됩니다. (저장 즉시 확인 가능)
- **새로 시작/리빌드**: `core` 패키지를 수정했거나 포트 충돌이 나면, `실행하기.bat`를 더블 클릭하세요.

---
 
## ⚡ 간편 실행 - **권장 사양**

여러 개의 터미널을 열고 각각 명령어를 입력하는 번거로움을 줄이기 위해, **원클릭 실행 스크립트**를 활용하는 것을 강력히 권장합니다.

### 🏁 **`실행하기.bat` (Windows 전용)**
프로젝트 루트 폴더에 있는 `실행하기.bat` 파일을 더블 클릭하면 다음과 같은 작업이 자동으로 수행됩니다:
1. **포트 점검**: 기존에 실행 중이던 유령 프로세스(3001, 5173 포트)를 자동으로 종료하여 충돌을 방지합니다.
2. **Core 빌드**: 공유 로직 패키지(`@yacht/core`)를 최신화합니다.
3. **병렬 실행**: 
   - **Windows Terminal** 설치 시: 하나의 창에서 화면이 분할(Split-pane)되어 백엔드와 프론트엔드가 동시에 실행됩니다.
   - **기본 PowerShell** 사용 시: 두 개의 개별 PowerShell 창이 열리며 각각 백엔드와 프론트엔드 개발 서버를 구동합니다.

> [!TIP]
> 개발 중이라면 이 배치 파일을 통해 환경을 구축하는 것이 가장 빠르고 안전한 워크루틴입니다.

---

## 🚀 수동 실행 방법 (Manual run)

자동화 스크립트 대신 각 단계를 수동으로 제어하고 싶을 때 사용합니다.

0. **저장소 클론하기 (Clone)**
   ```bash
   git clone https://github.com/dnrjke/yacht.git
   cd yacht
   ```

1. **초기 모듈 통합 설치**
   최상위 폴더(`c:\yacht` 등)에서 실행:
   ```bash
   npm install
   ```

2. **Core 로직 빌드**
   ```bash
   cd core
   npm run build
   cd ..
   ```

3. **서버(Backend) 및 클라이언트(Frontend) 개별 실행**
   각각의 터미널에서 다음 명령어를 실행합니다:
   - **Backend**: `cd backend && npm run dev`
   - **Frontend**: `cd frontend && npm run dev`

이후 브라우저에서 `http://localhost:5173`으로 접속하여 게임을 확인하세요! 
*(주소 뒤에 `?debug`를 붙이면 프레임 레이트 모니터 등 개발자 도구가 활성화됩니다.)*
- **서버 상태 확인**: `http://localhost:3001/health` → "Yacht Dice Backend is running!"

---

## 🔌 소켓 이벤트 요약

게임 동기화는 Socket.io를 통해 이루어집니다. 주요 이벤트 목록:

| 방향 | 이벤트명 | 페이로드 | 설명 |
|------|----------|----------|------|
| Client → Server | `CUP_TRANSFORM` | `{position, quaternion}` | 흔들기 중 컵 위치 전송 (매 프레임) |
| Client → Server | `POUR_CUP` | `{position, quaternion}` | 드래그 해제 시 붓기 요청 |
| Client → Server | `COLLECT_TO_CUP` | `{keptIndices}` | 다시 굴리기 버튼 클릭, 보관 주사위 인덱스 |
| Server → All | `DICE_STATES` | `{diceStates}` | 흔들기 중 60FPS 주사위 위치 |
| Server → All | `POUR_RESULT` | `{diceTrajectory, cupTrajectory, finalValues}` | 붓기 완료, 궤적 + 결과 |
| Server → All | `COLLECTION_DONE` | `{}` | 보관 완료, 비보관 주사위 컵 복귀 |

---

## 🎮 게임 흐름 (Phase Diagram)

```
LOBBY (스플래시 2.5초)
  → TOUCH_TO_START (클릭/터치/키 입력)
  → MAIN_MENU (멀티플레이 선택)
  → GAME (활성 게임플레이 - 13라운드)
  → GAME_OVER (미구현)
```

각 턴: **굴리기(최대 3회)** → **배치 모드(HUD ↔ 트레이 토글)** → **점수 기록** → **턴 교대**
