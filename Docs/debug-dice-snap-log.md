# 주사위 쿼터니언 스냅 진단 로그

## 상태: 활성 (잔존 버그 조사 중)

주사위 눈이 시각적으로 갑자기 변경되는 버그군을 추적하기 위한 진단 코드.
180° 스냅 버그는 수정 완료. 잔존 유사 버그 조사를 위해 로그를 유지한다.

## 로그 읽는 법

콘솔에 출력되는 `[SNAP]` 로그 형식:

```
[SNAP] die=N src=SOURCE angle=X.X° face:OLD→NEW ⚠️ FACE CHANGED storedVal=V kept=BOOL flags={...}
```

| 필드 | 의미 |
|------|------|
| `die=N` | 주사위 인덱스 (0~4) |
| `src=` | 스냅이 감지된 코드 지점 (아래 표 참고) |
| `angle=` | 이전 프레임 대비 쿼터니언 회전 각도 (8.6° 이상만 출력) |
| `face:X→Y` | 위를 향하는 눈 값 변화 |
| `⚠️ FACE CHANGED` | 눈 값이 실제로 바뀐 경우에만 표시 — **이것이 핵심 버그 지표** |
| `storedVal=` | `gameStore.currentDiceValues[i]` 에 저장된 기대값 |
| `kept=` | 킵 트레이에 있는 주사위인지 여부 |
| `flags=` | 가드 플래그 상태 (plc/ret/sync/wait) |

### src 값 해석

| src | 의미 | 정상 여부 |
|-----|------|-----------|
| `DICE_STATES` | 서버 물리 브로드캐스트 적용 직후 | 흔들기 중 정상. 가드 해제 직후 발생 시 의심 |
| `playback-done` | 궤적 재생 종료 직후 | storedVal과 newFace 일치하면 정상 |
| `exit-placement` | 배치 모드 → 리턴 애니메이션 전환 | face 유지되면 정상 (방향만 변경) |
| `returnAnim-frame` | 컵 복귀 애니메이션 중 | face 유지되면 정상 |
| `returnAnim-done` | 컵 복귀 애니메이션 완료 시점 | face 유지되면 정상 |
| `pre-COLLECTION_DONE` | COLLECTION_DONE 수신 직전 상태 | 비교 기준점 |

### 버그 판별 기준

- `⚠️ FACE CHANGED` + `storedVal ≠ newFace` → **값 불일치 버그**
- `⚠️ FACE CHANGED` + `kept=true` → **킵 주사위 눈 변경 버그**
- `angle=180.0°` + `face 동일` → **anti-parallel 쿼터니언 불일치** (수정 완료)
- `src=DICE_STATES` + `flags` 전부 false + 게임 진행 중 → **가드 누락 의심**

## 수정 완료된 버그

### anti-parallel 쿼터니언 불일치 (180° 스냅)

서버 `quatFromVectors`와 클라이언트 `THREE.Quaternion.setFromUnitVectors`의 anti-parallel 분기 불일치.
`storedVal=6` (face normal `{0,-1,0}` → worldUp `{0,1,0}`)일 때 서버는 X축, 클라이언트는 Z축 기준 180° 회전을 생성.

**수정**: `backend/src/physics/PhysicsWorld.ts` `quatFromVectors` anti-parallel 분기를 Three.js와 일치시킴.

## 대상 파일

`frontend/src/components/3d/PhysicsDice.tsx`

## 추가된 코드 목록

### 1. 진단 유틸리티 (선언부)

**위치**: `const lastPlacementCount = useRef(5);` 바로 아래, `// ── DEBUG: track quaternion snaps ──` ~ `// ── END DEBUG ──` 블록 전체.

포함 항목:
- `prevQuats` ref (이전 프레임 쿼터니언 저장)
- `debugReadFace()` 함수 (쿼터니언에서 윗면 값 읽기)
- `debugCheckSnap()` 함수 (각도 변화 감지 + 콘솔 출력)

### 2. 호출 지점 (6곳)

| 코드 | 삽입 위치 |
|---|---|
| `debugCheckSnap('DICE_STATES');` | `handleDiceUpdate` 내, `setDiceInCup(data.diceInCup);` 바로 위 |
| `console.log('[DEBUG] COLLECTION_DONE received');` | `handleCollectionDone` 함수 시작부 |
| `debugCheckSnap('pre-COLLECTION_DONE');` | 위 console.log 바로 아래 |
| `debugCheckSnap('exit-placement');` | 배치 모드 종료 분기, `placementAnim.current = null;` 바로 위 |
| `debugCheckSnap('returnAnim-frame');` | 리턴 애니메이션 루프, `if (rawT >= 1)` 바로 위 |
| `console.log('[DEBUG] returnAnim complete, emitting COLLECT_TO_CUP');` + `debugCheckSnap('returnAnim-done');` | `returnAnim.current = null;` 바로 아래 |
| `debugCheckSnap('playback-done');` | 궤적 재생 완료, `playbackData.current = null;` 바로 위 |

## 제거 방법

조사 완료 후 아래 순서로 제거:

1. `// ── DEBUG: track quaternion snaps ──` 부터 `// ── END DEBUG ──` 까지 블록 삭제
2. 파일 내 `debugCheckSnap(` 가 포함된 줄 6개 삭제
3. 파일 내 `console.log('[DEBUG]` 가 포함된 줄 2개 삭제
4. 저장 후 빌드 확인

검색 명령:
```bash
grep -n "debugCheckSnap\|debugReadFace\|prevQuats\|\[DEBUG\]" frontend/src/components/3d/PhysicsDice.tsx
```
