# Git 원격 저장소 로컬 덮어쓰기 절차

> 원격 저장소의 **커밋 로그를 보존**하면서, 파일 내용을 **로컬 프로젝트로 완전히 교체**하는 방법.
> 원격에만 존재하던 파일은 삭제되고, 로컬에만 존재하는 파일은 추가된다.

## 전제 조건

- 로컬에 git 저장소가 초기화되어 있어야 함 (`git init`)
- 원격 저장소 URL을 알고 있어야 함

## 절차

### 1. 원격 저장소 연결 및 히스토리 가져오기

```bash
git remote add origin https://github.com/<user>/<repo>.git
git fetch origin
```

### 2. 원격 브랜치를 로컬 브랜치로 체크아웃

기존 커밋 로그를 이어받기 위해, 원격 main 브랜치 기반으로 로컬 브랜치를 생성한다.

```bash
git checkout -b main origin/main
```

> 이 시점에서 워킹 디렉터리에는 원격의 파일들이 체크아웃된다.
> 로컬에서 작업하던 untracked 파일들은 충돌하지 않는 한 그대로 남아 있다.

### 3. 원격 파일 전부 삭제 (인덱스에서)

```bash
git rm -rf --cached .
git clean -fd    # 원격에서 체크아웃된 tracked 파일 제거 (로컬 untracked 파일은 유지)
```

또는 더 안전하게, tracked 파일만 워킹 트리에서 삭제:

```bash
git ls-files -z | xargs -0 rm -f
```

### 4. 로컬 파일 전부 스테이징

```bash
git add -A
```

이렇게 하면:
- 원격에만 있던 파일 -> **삭제(deleted)** 로 기록
- 로컬에만 있는 파일 -> **추가(new file)** 로 기록
- 양쪽 다 있지만 내용이 다른 파일 -> **수정(modified)** 로 기록

### 5. 커밋

```bash
git commit -m "Replace with local project files"
```

> 이 커밋은 원격의 기존 커밋 로그 위에 **새 커밋 하나**로 쌓인다.
> `--force`, `--amend`, `rebase` 등을 사용하지 않으므로 기존 로그가 훼손되지 않는다.

### 6. 푸시

```bash
git push origin main
```

일반 push이므로 기존 히스토리는 완전히 보존된다.

## 주의사항

- `git push --force`는 절대 사용하지 않는다 (커밋 로그 훼손 위험).
- `.gitignore`에 포함된 파일은 스테이징되지 않으므로, 사전에 `.gitignore`를 정리해둔다.
- 이 절차는 "원격 파일을 로컬로 완전 교체"하는 일회성 작업이다.
