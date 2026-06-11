# Scoreboard 컴팩트 모드 (540p 이하 가로 모드)

## 목표
- 모바일/태블릿 가로 모드(높이 540px 이하)에서 잘림 없이 점수판 전체를 표시
- 540p 브레이크포인트 기준으로 기존 데스크톱 디자인 / 컴팩트 디자인 분기

## 브레이크포인트 판정
- `GameScreen`의 `getDesktopUiScale()`에서 이미 `window.innerHeight / 1080` 계산 중
- `uiScale < 0.5` (= innerHeight < 540px) 일 때 `compact = true`
- Scoreboard에 `compact` prop 전달

## 컴팩트 모드 변경 사항

### 1. h3 턴 표시 → thead Category 자리로 이동
- 기존: 별도 h3 "내 차례 (P1)" → thead "Category | P1 | P2"
- 컴팩트: h3 제거, thead 첫 번째 칸에 턴 표시 텍스트 배치
  - `내 차례 (P1)` / `상대방 (P2)` (짧게)
  - 색상: 현재 턴 강조색 유지 (#4CAF50)
- 절약: ~45px

### 2. 패딩/마진 전반 압축
- 외부 wrapper padding: 10px → 4px
- 셀 padding: `10px 8px` → `3px 4px`
- thead/tfoot padding도 동일 비율 축소
- h3 margin/paddingBottom 영역 완전 제거 (h3 자체가 없으므로)

### 3. 폰트 축소
- 기존 최소값: TITLE 13px, BODY 10px, SECONDARY 9px
- 컴팩트 최소값: TITLE 11px, BODY 9px, SECONDARY 8px

### 4. 높이 계산 검증
가용 높이 ~480px (브라우저 크롬 제외) - sidebar padding 8px = ~472px
- thead: 1행 × ~22px = 22px
- tbody: 14행(13 + subtotal) × ~28px = 392px
- tfoot: 1행 × ~28px = 28px
- 합계: ~442px → 여유 ~30px ✓

## 파일 변경 범위
- `GameScreen.tsx` — compact 판정 + prop 전달
- `Scoreboard.tsx` — compact prop 수신 + 조건부 스타일 분기
