# Scoreboard 반응형 개선 계획

## 목표
1. "Yacht Dice" 제목 + 주사위 5개 미리보기 UI 제거
2. 세로 스크롤 없이 화면 높이에 항상 맞도록 반응형 전환

## 현재 구조

```
GameScreen (flex row, 100% × 100%)
├── 좌측 사이드바 (350px 고정)
│   ├── <h2>Yacht Dice</h2>          ← 제거
│   ├── 주사위 5개 미리보기 div       ← 제거
│   └── <Scoreboard />
│       └── table (13 카테고리 행)
└── 우측 3D Scene (flex: 1)
```

## 변경 사항

### 1단계: 제거
- `GameScreen.tsx` line 14: `<h2>Yacht Dice</h2>` 삭제
- `GameScreen.tsx` line 17~23: 주사위 미리보기 div 삭제
- `currentDiceValues`, `rollCount` state 구독도 GameScreen에서 불필요해지면 제거

### 2단계: 사이드바 반응형
- 고정 `width: 350px` → `clamp(250px, 20vw, 350px)` 등으로 뷰포트 비례
- `overflowY: 'auto'` → `overflow: 'hidden'` (스크롤 제거 목적)
- 사이드바 전체를 `display: flex; flex-direction: column; height: 100%`로 전환

### 3단계: Scoreboard 테이블 반응형
- Scoreboard 컴포넌트 wrapper: `flex: 1; display: flex; flex-direction: column`
- `<table>` → `flex: 1`로 남은 공간 채움
- 각 `<tr>` 높이: 고정 px 대신 균등 분배 (`flex: 1` 또는 `height: calc(100% / 행수)`)
- 셀 패딩: `padding: 10px 5px` → `padding: 0.5vh 0.3vw` 수준으로 축소
- 폰트: `14px` 고정 → `clamp(11px, 1.2vh, 14px)` 등

### 4단계: 턴 표시 헤더
- Scoreboard 내 `<h3>` (현재 턴 표시)도 축소: 폰트 `clamp()`, 패딩 축소
- 하지만 기능은 유지

## 영향 범위
- `GameScreen.tsx` — 사이드바 레이아웃 + 제거
- `Scoreboard.tsx` — 테이블 반응형 스타일
- 다른 컴포넌트 영향 없음

## 리스크
- table 요소는 flex 자식으로 쓸 때 브라우저마다 약간 다를 수 있음 → 필요시 div 기반으로 전환
- 극단적으로 낮은 뷰포트(600px 이하)에서 13행이 눌릴 수 있음 → 최소 높이 보장 or 폰트 추가 축소
