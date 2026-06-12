# Yacht Dice

3D 야추 주사위 게임. 로컬 2인 대전.

**GitHub Pages**: https://dnrjke.github.io/yacht/

## 플레이 방법

컵을 드래그해서 흔들고 놓으면 주사위가 쏟아집니다. 턴당 최대 3회 굴림, 원하는 주사위를 탭하여 킵한 뒤 점수판에서 카테고리를 선택하여 기록합니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 렌더링 | React + Three.js (@react-three/fiber) |
| 물리 엔진 | Rapier 3D WASM (클라이언트 실행) |
| 상태 관리 | Zustand |
| 빌드 | Vite + TypeScript |
| 배포 | GitHub Pages (GitHub Actions) |

## 프로젝트 구조

```
yacht/
  core/             공유 타입, 상수, 점수 계산 로직 (@yacht/core)
  frontend/         React + Three.js 프론트엔드
    src/
      components/     UI 컴포넌트, 3D 씬
        3d/             PhysicsDice, PhysicsCup, PhysicsBoard, DecisionButton, ComboAnnouncement
        screens/        SplashScreen, MainMenuScreen, GameScreen, ResultScreen
        ui/             Scoreboard, TurnIndicator
      physics/        Rapier 물리 엔진 (클라이언트)
        PhysicsWorld.ts   물리 세계 (컵, 주사위, 보드 콜라이더, 쏟기 시뮬레이션)
        physicsEngine.ts  싱글톤 관리 + 이벤트 시스템
      store/          Zustand 게임 상태 (점수, 턴, 킵, 콤보)
      utils/          사운드 매니저, i18n, 훅
    public/
      sounds/         효과음 9종
  backend/          Socket.io 서버 (온라인 대전용, 현재 미사용)
  Docs/             설계 문서
```

## 아키텍처

물리 시뮬레이션과 게임 로직이 모두 클라이언트에서 실행됩니다. 서버 불필요.

### 물리 (Rapier WASM, 브라우저 실행)
- 컵 드래그 시 `updateCupTransform()` → 매 프레임 `step()` (4 서브스텝 × 1/240s) → `getDiceStates()`로 주사위 위치 즉시 갱신
- 쏟기 시 `simulatePour()`가 동기적으로 전체 궤적 계산 (기울이기 → 쏟기 → 복귀 아크 → 안정화 대기) → 클라이언트에서 즉시 재생
- CCD(연속 충돌 감지), 16 솔버 반복, 4× 중력으로 결정론적이고 안정적인 시뮬레이션

### 게임 로직 (Zustand)
- 턴 관리, 점수 기록, 킵/언킵, 콤보 감지
- 13개 카테고리: 상단 6종 (Aces~Sixes) + 보너스(63점 이상 시 +35) + 하단 6종 (Choice, FourOfAKind, FullHouse, SmallStraight, LargeStraight, Yacht)

### 백엔드 (현재 미사용)
- 동일한 Rapier 물리 코드를 서버에서 실행 가능. 향후 온라인 대전 시 서버 권위 검증용으로 활용 예정.

## 기능

- 3D 물리 기반 주사위 굴림 (지연 없는 로컬 물리)
- 주사위 킵/언킵 (카메라 HUD + 트레이 배치)
- 콤보 감지 및 연출 (Yacht, Large Straight 등)
- 효과음 9종 + 마스터 볼륨 조절 (localStorage 저장)
- 다국어 7개 (한국어, English, 日本語, 中文, Español, Français, Deutsch)
- 게임 결과 오버레이 (승자 표시, 재경기/메인메뉴)
- PWA 전체화면 모드 (iOS/Android)
- 반응형 카메라 (모바일 세로/데스크톱 가로)

## 게임 흐름

```
LOBBY (스플래시 → Touch to Start)
  → MAIN_MENU (설정: 볼륨, 언어)
    → GAME (13라운드, 각 턴: 굴리기 최대 3회 → 킵 → 점수 기록 → 턴 교대)
      → GAME_OVER (결과 오버레이 → 재경기 / 메인메뉴)
```

## 로컬 개발

```bash
npm install
npm run build --workspace=core
npm run dev --workspace=frontend
```

http://localhost:5173 에서 실행됩니다. URL에 `?debug`를 붙이면 디버그 모드 활성화.

## 배포

`main` 브랜치에 push하면 GitHub Actions가 자동으로 빌드 후 GitHub Pages에 배포합니다.
