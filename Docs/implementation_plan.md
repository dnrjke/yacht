# Yacht (Yacht Dice) 게임 구현 계획서

본 계획서는 웹 기반 실시간 멀티플레이어 야추(Yacht Dice) 게임의 아키텍처 및 구현 방향을 정의합니다. 특히 3D 물리 엔진의 서버-클라이언트 동기화(결정론적 시뮬레이션)에 중점을 둡니다.

## 1. 아키텍처 및 기술 스택

### Frontend (Vercel 배포)
*   **Core**: React, TypeScript, Vite
*   **State Management**: Zustand (UI 상태, 게임 룰, 턴 관리)
*   **3D Graphics**: Three.js (@react-three/fiber, @react-three/drei 가능성 고려)
*   **UI/Styling**: HTML + Vanilla CSS (좌측 스코어보드 및 컨트롤 패널)
*   **Network**: socket.io-client

### Backend (Koyeb 배포)
*   **Core**: Node.js, Express
*   **Network**: Socket.io (실시간 양방향 통신, Room 관리)
*   **Physics Engine**: cannon-es (서버 사이드 물리 연산용)
*   **Game Logic**: 야추 룰, 점수 검증, 턴 관리 로직 (서버 권위)

### Database
*   **Supabase**: 사용자 인증(Auth), 매치 전적, 글로벌 리더보드 등 메타 데이터 저장.

---

## 2. 핵심 동기화 전략 (결정론적 물리 시뮬레이션)

사용자의 요구사항(서버에서 결정하고 클라이언트는 재생, 야추통 흔들기는 클라이언트 수행 및 동기화)을 만족시키기 위해 **"실시간 릴레이 + 서버 사전 연산 후 재생(Playback)"** 혼합 방식을 사용합니다.

### Phase 1: 야추통 흔들기 (Shaking Phase)
*   **입력(Client A)**: 턴을 가진 플레이어가 마우스/터치로 야추통을 잡고 흔듭니다.
*   **전송(Client A -> Server)**: 야추통의 `Position`, `Rotation` 위치 데이터를 높은 빈도(예: 20~30Hz)로 서버에 전송합니다.
*   **물리 연산(Server)**: 서버에는 눈에 보이지 않는 `cannon-es` 물리 세계가 존재합니다. 전달받은 야추통의 좌표를 서버의 야추통(Kinematic Body)에 적용합니다. 서버의 물리 엔진이 Step을 진행하며 통 안에 있는 5개의 주사위(Dynamic Body)들이 이리저리 부딪히며 움직입니다.
*   **브로드캐스트(Server -> All Clients)**: 서버는 야추통의 좌표와 주사위 5개의 현재 좌표(Position, Quaternion)를 모든 클라이언트로 브로드캐스트합니다.
*   **렌더링(All Clients)**: 모든 클라이언트는 서버로부터 받은 좌표 데이터를 바탕으로 Three.js 객체를 보간(Interpolation)하여 부드럽게 렌더링합니다. 이로써 **모든 플레이어가 동일하게 움직이는 통과 주사위를 보게 됩니다.**

### Phase 2: 주사위 굴리기 (Rolling & Resolution Phase)
*   **액션(Client A)**: 플레이어가 야추통을 화면에 던지거나 붓습니다 (마우스 릴리스).
*   **결정 및 시뮬레이션(Server)**: 
    1. 서버는 "굴리기" 이벤트를 수신합니다.
    2. 서버는 즉시 브로드캐스트를 중단하고, 서버 내 물리 엔진을 **while 루프(주사위가 모두 멈출 때까지)** 로 매우 빠르게(Headless) 끝까지 연산합니다.
    3. 이 연산 과정 중 매 프레임(예: 60fps 간격)마다 주사위들의 궤적(Trajectory) 데이터를 배열에 저장합니다.
    4. 최종적으로 주사위가 어떤 면(1~6)을 바라보고 멈췄는지 판단하여 점수를 계산합니다.
*   **결과 전송(Server -> All Clients)**: 서버는 계산이 끝난 **주사위 궤적 데이터 배열 + 최종 주사위 눈금 결과**를 모든 클라이언트에게 전송합니다.
*   **재생(All Clients)**: 클라이언트는 전송받은 궤적 데이터를 기반으로 애니메이션을 재생(Playback)합니다. 이미 결과가 정해진 애니메이션을 틀어주는 것이므로 **100% 동일한 결과와 움직임을 보장**하며, 중간에 네트워크 지연(Lag)이 발생하더라도 궤적 데이터가 이미 클라이언트에 있으므로 끊김 없이 부드럽게 주사위가 굴러가는 모습을 렌더링할 수 있습니다.

---

## 3. 화면 레이아웃

*   **좌측 (UI 영역)**: HTML/CSS로 구현된 스코어보드 표. 자신과 상대방의 점수를 기입할 수 있으며, 족보(카테고리)별 가능 점수가 표시됩니다.
*   **우측 (3D 영역)**: Three.js 캔버스가 화면의 우측(또는 배경 전체)을 채우며, 나무 테이블 재질, 가죽 야추통, 5개의 주사위, 조명 등이 배치됩니다.

---

## 4. 구현 단계 (Phases)

1.  **Phase 1: 기반 설정**
    *   프로젝트 구조 잡기 (Client / Server 분리)
    *   서버: Socket.io 룸 관리, cannon-es 셋업
    *   클라이언트: Three.js 캔버스 셋업, Zustand 스토어 구조 설계
2.  **Phase 2: 3D 모델링 및 인터랙션**
    *   주사위 및 야추통 임시 Mesh 생성
    *   클라이언트 내 야추통 드래그 로직 구현 (화면 좌표 -> 3D 공간 좌표 변환)
3.  **Phase 3: 물리 동기화 구현 (가장 중요)**
    *   서버 cannon-es를 활용한 실시간 통 물리 동기화 구성 (Shaking)
    *   서버 Headless Physics 궤적 생성 및 클라이언트 Playback 구현 (Rolling)
4.  **Phase 4: 게임 로직 개발**
    *   주사위 눈금 인식 로직 (서버측 Quaternion 계산 기반)
    *   야추 점수 계산 로직 및 턴 넘기기
5.  **Phase 5: UI 및 연동**
    *   스코어보드 UI 퍼블리싱 (Vanilla CSS 적용)
    *   Zustand와 UI, 게임 로직 연동
6.  **Phase 6: 배포**
    *   Koyeb & Vercel 배포 세팅

---

## User Review Required

> [!IMPORTANT]
> 구조 및 방향성에 대해 다음 사항을 확인 부탁드립니다.
> 1. 물리 엔진을 서버에서 구동하는 방식(cannon-es in Node.js)에 동의하시나요? (오차 방지를 위한 최적의 방식입니다.)
> 2. 클라이언트-서버 통신 중 데이터 패킷 최소화를 위해 주사위 궤적 전송 방식을 사용합니다. 이 방식이 마음에 드시나요?
> 3. Supabase는 현재 매치 기록과 사용자 계정 용도로만 계획되어 있습니다. 게임의 룸 목록이나 실시간 부분(Socket.io 역할)까지 Supabase Realtime으로 대체할 의향이 있으신가요, 아니면 Socket.io + Express 구조를 유지할까요? (커스텀 물리 연산이 필요하므로 현재 구성된 Node.js + Socket.io 구조가 유리합니다.)
