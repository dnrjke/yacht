# Splash/Touch 화면 통합 계획

## 목표
1. SplashScreen + TouchScreen을 하나로 통합
2. 실제 에셋 로딩 완료 후 "Touch to Start" 표시
3. MainMenuScreen 타이틀을 "Yacht Dice"로 변경

## 현재 흐름
```
LOBBY (SplashScreen) → TOUCH_TO_START (TouchScreen) → MAIN_MENU (MainMenuScreen) → GAME
  fake 2.5s 대기        클릭/키 인터랙션              Local Play 버튼
```

## 변경 후 흐름
```
LOBBY (SplashScreen) → MAIN_MENU (MainMenuScreen) → GAME
  실제 에셋 로딩 →        "Yacht Dice" 타이틀
  완료 후 Touch to Start   Local Play 버튼
  클릭 시 AudioContext resume + 전환
```

## 변경 사항

### 1. SplashScreen.tsx 개편
- soundManager.preload() 실제 await
- 로딩 중: "YACHT DICE" + "Loading..." 표시
- 로딩 완료: "Touch or Press Any Key to Start" 표시 (pulse 애니메이션)
- 사용자 인터랙션 시 AudioContext resume + setPhase('MAIN_MENU')

### 2. TouchScreen.tsx 제거
- 파일 삭제
- App.tsx에서 TOUCH_TO_START 분기 제거

### 3. GamePhase 정리
- core/src/index.ts에서 'TOUCH_TO_START' 제거
- gameStore.ts에서 관련 참조 확인

### 4. MainMenuScreen.tsx
- 타이틀 "Main Menu" → "Yacht Dice"

### 5. App.tsx
- soundManager.preload() 호출 제거 (SplashScreen이 담당)
- TOUCH_TO_START phase 분기 제거

## 영향 범위
- SplashScreen.tsx — 대폭 개편
- TouchScreen.tsx — 삭제
- App.tsx — preload 제거, phase 분기 제거
- MainMenuScreen.tsx — 타이틀 변경
- core/src/index.ts — GamePhase 타입 축소
- gameStore.ts — 영향 확인 필요
