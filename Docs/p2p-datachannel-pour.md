# P2P DataChannel 붓기 직접 전송

## 개요

온라인 대전에서 관전자(P2)가 상대(P1)의 붓기 애니메이션을 보는 데 **2.3초** 지연이 발생하던 문제를 P2P WebRTC DataChannel로 해소. P1이 로컬 시뮬레이션 완료 즉시 궤적을 DC로 직접 전달하여 지연을 **23ms**로 단축.

---

## P2P DataChannel이란

WebRTC의 `RTCDataChannel`은 브라우저 간 직접 데이터를 주고받는 채널.

```
일반 서버 경로:
  P1 → Koyeb proxy → container → game logic → container → Koyeb proxy → P2
  (881ms ~ 2114ms)

P2P DataChannel:
  P1 → (STUN으로 확보한 UDP 홀펀칭) → P2
  (16ms)
```

**핵심 특성:**
- SCTP over DTLS over UDP. TCP의 head-of-line blocking 없음
- `ordered: false, maxRetransmits: 0` 설정으로 UDP와 동등한 최소 지연
- 시그널링(SDP/ICE 교환)만 서버 경유, 이후 데이터는 브라우저 직결
- NAT 통과에 STUN 사용. Symmetric NAT/기업 방화벽에서는 실패 가능 → 서버 폴백 필요

**이 프로젝트에서의 사용:**
- Phase 1: 셰이크 프레임 전달 (172B 바이너리, 60fps)
- Phase 2 (이번 적용): 붓기 궤적 전달 (~28KB 바이너리, 1회성)

---

## 문제 — 관전자 붓기 지연

dbg15a+dbg15b 페어드 로그에서 측정:

| 구간 | 소요 |
|---|---|
| P1 finger up → LOCAL_FINAL_POUR | 82ms (로컬 시뮬) |
| POUR_CUP_EMIT → P2 POUR_RESULT | **2114ms** (Koyeb 왕복) |
| P2 spectatorBuffer | 250ms (고정 버퍼) |
| P2 shakeHold + restLerp | ~1472ms (phase chain 대기) |
| **총 P1→P2 cupPlayback 차이** | **~2365ms** |

Koyeb 왕복은 세션 중 열화: 361ms → 2148ms → 2114ms. TCP_NODELAY 적용 이력 있으나 미해소 — 병목이 TCP 프로토콜이 아닌 Koyeb 인프라 경로 전체에 있음.

---

## 채택한 방법 — DC 붓기 직접 전송

### 아키텍처

```
P1 로컬 시뮬 완료
  ├─ sendPourResultViaDC(result)   → P2 DC: 16ms, 즉시 cupPlayback
  └─ emitPourResult(result) + socket.emit('POUR_CUP')
       → 서버 → P2 socket: 1635ms, POUR_RESULT_DEDUP (중복 무시)
```

### 바이너리 프로토콜 (msgType 0x02)

```
[1B msgType=0x02] [5B finalValues] [2B numFrames] [168B × numFrames]
                                                    └─ cup(28B) + 5×dice(28B)
총 ~25KB (149프레임 기준)
```

### Dedup (중복 재생 방지)

```typescript
let pourPlayedThisRoll = false;

// CAN_POUR 수신 시 리셋
pourPlayedThisRoll = false;

// DC 경로: 먼저 도착 → 즉시 재생, 플래그 set
if (pourPlayedThisRoll) return;
pourPlayedThisRoll = true;
emitPourResult(result);

// 서버 경로: 나중에 도착 → 상태 업데이트만, 재생 스킵
const alreadyPlayed = pourPlayedThisRoll;
s.setRollCount(result.rollCount);  // 권한적 상태는 항상 적용
if (alreadyPlayed) return;         // 재생은 스킵
```

### 변경 파일

| 파일 | 변경 |
|---|---|
| `shakeDataChannel.ts` | `sendPourResultViaDC()`, `decodePourResult()`, `registerDCPourHandler()` 추가 |
| `PhysicsCup.tsx` | 로컬 시뮬 완료 직후 `sendPourResultViaDC(localResult)` 호출 |
| `socket.ts` | DC/서버 dedup 로직, `pourPlayedThisRoll` 플래그 |

---

## 결과 (dbg16a+dbg16b)

| 지표 | 이전 (dbg15) | 이후 (dbg16) |
|---|---|---|
| P1→P2 cupPlayback 차이 | 2365ms | **23ms** |
| DC 전달 시간 | — | **16ms** |
| 서버 POUR_RESULT 도착 | 2114ms | 1635ms (DEDUP) |
| P2 phase chain | opponentShake→shakeHold→restLerp→cupPlayback | opponentShake→cupPlayback **(직행)** |
| 프리즈 | 870ms | **없음** |
| shakeSpeed median | 0 | **35.6** |

---

## spectatorBuffer 제거

DC 직접 전달로 wall-clock 동기화가 자연 달성(23ms 차이)되어 spectatorBuffer(250ms 고정 지연) 제거.

- 서버 폴백 경로에서도 2s+ 지연 대비 250ms 버퍼는 동기화 효과 없음
- `PourResult` 타입에서 `spectator`/`spectatorBufferMs`/`scheduledStartAt` 필드 삭제
- PhysicsCup/PhysicsDice의 buffering 대기 로직 삭제
- `spectatorBuffer.ts` 모듈 삭제

---

## 미채택 방법론

### 1. 서버 시뮬레이션 최적화

서버에서 physics 시뮬을 돌려 POUR_RESULT를 빠르게 반환하는 방식. 이미 `serverSimMs=0` (클라이언트 결과 신뢰)으로 서버 시뮬은 생략 중이었고, 병목이 시뮬 시간이 아닌 네트워크 경로였으므로 효과 없음.

### 2. 서버 인프라 교체 (UDP 지원)

Koyeb은 HTTP-only proxy로 UDP 불가. Fly.io/Render 등 UDP 지원 인프라로 이전하면 서버 경로 자체의 지연을 줄일 수 있으나, P2P DC가 이미 서버를 우회하므로 붓기 지연 문제에 대해서는 인프라 이전보다 DC가 더 직접적이고 효과적.

### 3. 예측 기반 선행 재생

P2가 P1의 셰이크 종료를 감지해 붓기를 예측 시작하는 방식. 셰이크→붓기 전환 시점 예측이 부정확하면 오재생, 예측 실패 시 롤백 필요. 복잡도 대비 DC 직접 전달이 확실.

### 4. spectatorBuffer 증량

250ms → 더 큰 값으로 증량하여 네트워크 지터 흡수. 문제가 지터(편차)가 아닌 절대 지연(2s+)이었으므로 버퍼 증량은 지연을 더 늘릴 뿐.

---

## 서버 경로의 존속 이유

DC가 붓기 전달을 담당하지만 서버 경로는 제거하지 않음:

1. **권한적 상태**: `rollCount`, `rollId`, `turnNumber`는 서버만 발행
2. **검증**: `POUR_ACCEPTED` / `POUR_REJECTED` 판정
3. **DC 실패 폴백**: Symmetric NAT, 기업 방화벽 등 DC 연결 불가 시 유일한 경로
4. **게임 무결성**: 서버가 최종 상태 authority 유지

---

## 잔존 사항

- **POUR_ACCEPTED 지연**: 881ms (서버 왕복). 게임 상태 전이에만 사용되므로 체감 무관이나, 다른 서버 이벤트 지연 가능성 내포.
- **DC 불가 환경 테스트**: Symmetric NAT에서 서버 폴백 경로 정상 작동 확인 필요.
- **arrivalGap max 108ms**: 마지막 셰이크 프레임. P1 손 떼기 직전 emit 간격 확장은 정상 범위이나 반복 관찰 필요.
