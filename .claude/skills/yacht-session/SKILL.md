---
name: yacht-session
description: Yacht Dice 프로젝트 세션을 시작한다. 메모리/CLAUDE.md 로드 + 조사 자율 진행 승인.
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash
---

# Yacht Dice 세션 시작

다음을 순서대로 수행한다:

## 1. 프로젝트 컨텍스트 로드

- `C:/yacht/README.md` 읽기
- `C:/yacht/CLAUDE.md` 읽기 (존재하는 경우)
- 메모리 인덱스(`C:/Users/Garnet/.claude/projects/C--yacht/memory/MEMORY.md`) 확인
- 관련 메모리 파일 읽기

## 2. 현재 상태 파악

- 프로젝트 구조 확인: `ls` (frontend/src, backend/src, core/src)
- 최근 변경 파악: `git log --oneline -5` (git repo인 경우) 또는 최근 수정 파일 확인
- core 빌드 상태 확인: `core/dist/` 존재 여부

## 3. 승인 사항 선언

이 세션에서는 다음이 자동 승인된다:

- 웹 탐색, 리서치, 서브에이전트 활용 → 임의 판단 후 사후 보고
- 복잡한 설계/계획 → opus 서브에이전트 요청
- 대량 구현 후 → opus 검수

## 4. 사용자에게 보고

간결하게 다음을 보고:

- 프로젝트 현재 상태 요약 (1~2줄)
- 기술 스택 요약 (React + R3F (Three.js) / Node + Socket.io / Rapier 3D)
- 조사 자율 진행 승인됨 확인
- "무엇을 진행할까요?" 로 마무리
