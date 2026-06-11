# Sound Effects Implementation Plan

## 파일 목록 (frontend/public/sounds/)

| 파일 | 용도 |
|---|---|
| `make.mp3` | 특정 족보 달성 시 ComboAnnouncement 팝업과 함께 재생 |
| `yacht.mp3` | Yacht(최고 족보) 달성 시 ComboAnnouncement 팝업과 함께 재생 |
| `score.mp3` | Scoreboard에서 점수 기입 시 재생 |
| `rolling_dice.mp3` | 컵 드래그(흔들기) 중 루프 재생 |
| `pouring_dice.mp3` | 컵에서 주사위를 부을 때 재생 (약간 딜레이) |
| `victory.mp3` | 결과창에서 승자에게 원본 재생, 패자에게 playbackRate 낮춰서 재생 |

---

## 1단계: SoundManager 유틸리티

**파일**: `frontend/src/utils/soundManager.ts`

Web Audio API 기반 싱글턴. 역할:
- AudioContext 생성 및 관리 (모바일 unlock 대응 포함)
- 사운드 파일 프리로드 (`AudioBuffer` 캐시)
- `play(name, options?)` — 1회 재생. options: `{ delay?, playbackRate?, loop? }`
- `startLoop(name)` / `stopLoop(name)` — 루프 재생 시작/정지 (rolling_dice용)
- `stopAll()` — 전체 정지

AudioBuffer를 미리 fetch+decode 해두고, 재생 시마다 `AudioBufferSourceNode`를 새로 만드는 패턴. 동시 다발 재생도 자연스럽게 처리됨.

---

## 2단계: 각 트리거 포인트 연결

### 2-1. make / yacht → ComboAnnouncement.tsx

`ComboAnnouncement`에서 `activeCombo`가 세팅될 때:
- `activeCombo.tier === 2` (Yacht) → `yacht.mp3` 재생
- 그 외 (`tier === 1`, Small Straight 등) → `make.mp3` 재생

트리거 위치: `useEffect([activeCombo])` 내부, 팝업 표시 시점과 동일.

### 2-2. score → Scoreboard.tsx

`handleScoreClick` 내부, `updateScore()` 호출 직후 `play('score')`.

### 2-3. rolling_dice → PhysicsCup.tsx

- 컵 `onPointerDown` (드래그 시작) → `startLoop('rolling_dice')`
- `pointerup` 핸들러 (드래그 종료) → `stopLoop('rolling_dice')`

컵을 잡고 있는 동안만 루프 재생.

### 2-4. pouring_dice → PhysicsCup.tsx

`POUR_CUP` emit 시점에서 약간의 딜레이(~200ms 정도, 체감 조절 가능) 후 `play('pouring_dice')`.
컵 기울어지는 애니메이션과 타이밍 맞추기 위함.

### 2-5. victory → 결과창 (미구현)

결과창 구현 시:
- 승자 측: `play('victory')` (원본 피치)
- 패자 측: `play('victory', { playbackRate: 0.85 })` — 반 키(semitone) 낮춤

반 키 = `2^(-1/12) ≈ 0.9439`. 정확히 반 키면 0.9439, "반 키 정도"의 체감이면 0.85~0.9 범위에서 조절 가능. 이 부분은 실제로 들어보고 결정하는 게 나을 듯.

---

## 3단계: 초기화 타이밍

`GameScene.tsx` 또는 `App.tsx`에서 게임 시작 시 SoundManager 초기화 + 6개 파일 프리로드.
모바일에서는 첫 사용자 인터랙션(터치/클릭) 시 `AudioContext.resume()` 호출 필요 — SoundManager 내부에서 처리.

---

## 구현 순서

1. `soundManager.ts` 작성
2. 프리로드 연결 (App 또는 GameScene)
3. ComboAnnouncement에 make/yacht 연결
4. Scoreboard에 score 연결
5. PhysicsCup에 rolling_dice 루프 + pouring_dice 연결
6. (결과창 구현 시) victory 연결

## 미결 사항

- `pouring_dice` 딜레이 정확한 ms 값 — 실제 컵 애니메이션 보고 조절
- victory의 패자 playbackRate 정확한 값 — 들어보고 결정
- 볼륨 밸런스 — 전체적으로 들어본 뒤 개별 gain 조절 필요할 수 있음
