---
name: yacht-readme
description: README.md를 현재 코드베이스 상태에 맞게 갱신한다. 디렉터리 구조, 파일 역할, 인터페이스, 타입, 공통 함수를 반영.
user-invocable: true
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Agent
effort: max
argument-hint: [대상 경로 또는 워크스페이스명]
---

# README.md 유지보수

프로젝트의 `README.md`를 **현재 코드베이스 실제 상태**에 맞게 갱신한다.

## 대상 판별

```
/yacht-readme              → C:\yacht 루트 README.md
/yacht-readme frontend     → C:\yacht\frontend 하위 README.md
/yacht-readme backend      → C:\yacht\backend 하위 README.md
/yacht-readme core         → C:\yacht\core 하위 README.md
```

### 매칭 규칙

1. `$ARGUMENTS`가 비어 있으면 → `C:\yacht` 루트 README.md
2. `$ARGUMENTS`가 `frontend`, `backend`, `core` 중 하나이면 → 해당 워크스페이스의 README.md
3. 그 외 → `C:\yacht` 하위에서 대소문자 무시 매칭
   - 0개 매칭 → 유사 이름 후보 제시 + 확인 질문
4. 매칭된 디렉터리에 `README.md`가 없으면 → 신규 생성 여부 확인 질문

매칭 후 **대상 루트** = 매칭된 디렉터리. 이하 모든 경로는 대상 루트 기준.

## 목표

README.md가 코드와 동기화되도록 유지. 추측이 아닌 실제 파일/코드 확인 결과만 반영.

## 갱신 절차

### 1단계: 현행 README 읽기

대상 루트의 `README.md`를 읽어 현재 기술된 내용을 파악한다.
README.md가 없으면 → 프로젝트 구조를 파악한 뒤 신규 작성.

### 2단계: 코드베이스 실사

Explore 서브에이전트를 사용하여 다음을 조사한다:

- 대상 범위의 모든 디렉터리와 소스 파일 목록 (Glob `**/*.ts`, `**/*.tsx` 등)
- 신규/삭제/이동된 파일 식별 (README에 있으나 실제로 없는 파일, 실제로 있으나 README에 없는 파일)
- 각 신규 파일의 export된 클래스/함수/인터페이스/타입
- **루트 README인 경우** 추가 조사:
  - 모노레포 워크스페이스 구조 (frontend/backend/core)
  - 각 워크스페이스의 package.json 의존성
  - Docs/ 디렉터리 내 문서 변경
  - 빌드·실행 스크립트 (run.ps1, 실행하기.bat)
- **frontend README인 경우** 추가 조사:
  - components/ 하위 구조 (screens/ui/3d 디렉터리별 파일)
  - store/ 상태 관리 타입·액션
  - Three.js/R3F 컴포넌트 구조
- **backend README인 경우** 추가 조사:
  - Express 라우트·미들웨어 구조
  - Socket.io 이벤트 목록
  - Rapier 3D 물리 시뮬레이션 구조
- **core README인 경우** 추가 조사:
  - export된 게임 로직 함수/타입
  - frontend/backend에서의 소비 방식

> 조사 항목은 대상에 따라 유연하게 적용. 위 목록은 대표 체크리스트이며, 존재하지 않는 항목은 건너뛴다.

### 3단계: 차분(diff) 산출

현행 README 내용과 실사 결과를 비교하여 다음을 정리:

- **추가 필요**: 신규 파일/디렉터리/인터페이스/함수
- **삭제 필요**: 더 이상 존재하지 않는 파일/인터페이스/함수
- **수정 필요**: 시그니처 변경, 역할 변경, 타입 변경
- **구조 변경**: 디렉터리 이동, 이름 변경

### 4단계: README.md 갱신

Edit 도구로 README.md를 갱신한다. 다음 규칙을 따른다.

## 문서 구조

프로젝트에 이미 확립된 README 구조가 있으면 **기존 구조를 유지**한다.
신규 작성이거나 구조가 부실한 경우, 대상에 맞게 아래를 참고하여 구성:

### 루트 README

```
# 프로젝트 제목 + 한줄 설명
## 기술 스택
## 빌드 & 실행
## 모노레포 구조              ← frontend/backend/core 역할
## 디렉터리 구조              ← 전체 트리
## 아키텍처                   ← 동기화 전략, 서버 권위 등
## 핵심 인터페이스 & 공유 타입  ← core를 통한 타입 공유
```

### 워크스페이스 README

```
# 워크스페이스명 + 한줄 설명
## 디렉터리 구조              ← 전체 트리, 각 파일 역할 주석
## 핵심 인터페이스 & 타입
## 주요 함수 & 유틸
## 아키텍처 패턴              ← 워크스페이스 고유 패턴
```

> 프로젝트 규모·성격에 따라 섹션을 가감한다.

## 서술 규칙

1. **파일 트리에서 각 파일 역할은 `#` 주석으로 같은 줄에** 기술. 한두 줄로 간결하게.
2. **인터페이스/타입은 TypeScript 코드 블록**으로 표기. 실제 코드와 일치시킬 것.
3. **함수 테이블**: `함수명 | 시그니처 | 설명` 3열 Markdown 테이블.
4. **줄 수는 대략적 수치** 허용 (정확히 세지 않아도 됨). 100줄 이상 차이나면 갱신.
5. **삭제된 항목은 즉시 제거**. 주석으로 남기지 말 것.
6. **추측 금지**: 확인하지 않은 시그니처나 역할을 적지 말 것.

## 주의사항

- README 외 다른 파일은 수정하지 않는다.
- 코드 변경은 하지 않는다. 문서만 갱신.
- 갱신 완료 후 변경 요약을 사용자에게 보고한다.
