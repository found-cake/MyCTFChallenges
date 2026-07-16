# Submodule Collection Template

[English](README.md) | **한국어**

[![Use this template](https://img.shields.io/badge/Use%20this-template-2ea44f?logo=github)](../../generate)

여러 Git 저장소를 서브모듈로 모아 관리하는 컬렉션 저장소용 GitHub Template입니다.

서브모듈을 직접 추가하면서 `.gitmodules`, gitlink, 경로를 각각 수정할 필요 없이, Issue Form에 저장소와 경로를 입력하면 자동으로 검증하고 Pull Request를 생성합니다.

## 주요 기능

- Issue Form으로 저장소와 상위 경로 입력
- 저장소 이름에서 최종 디렉터리 이름 자동 생성
- 선택적인 디렉터리 이름과 브랜치 지정
- 저장소 접근 가능 여부와 브랜치 존재 여부 확인
- 동일 저장소 및 동일 경로 중복 검사
- 한국어, 공백, 아포스트로피, 세미콜론 등이 포함된 경로 지원
- 잘못된 요청을 이슈 댓글에서 즉시 미리보기
- 쓰기 권한이 있는 관리자의 `/approve` 댓글 이후에만 PR 생성
- Actions 화면에서 전체 또는 특정 서브모듈을 수동 업데이트
- 업데이트할 커밋이 있을 때만 별도 Pull Request 생성
- 비공개 GitHub 저장소를 위한 선택적 토큰 지원
- 외부 패키지와 설치 단계가 없는 순수 Node.js 구현

## 동작 흐름

```text
Issue Form 작성
      ↓
저장소·경로·중복 여부 자동 검증
      ↓
이슈 댓글에 최종 경로 미리보기
      ↓
관리자가 /approve 댓글 작성
      ↓
서브모듈 추가 브랜치와 Pull Request 생성
      ↓
검토 후 병합
```

수동 업데이트는 다음 흐름으로 동작합니다.

```text
Actions → Update submodules → Run workflow
      ↓
전체 또는 특정 서브모듈의 추적 브랜치 확인
      ↓
원격 최신 커밋으로 gitlink 갱신
      ↓
변경이 있을 때만 Pull Request 생성
      ↓
검토 후 병합
```

## 사용 방법

### 1. 템플릿으로 저장소 만들기

상단의 **Use this template** 버튼을 누르거나 GitHub 저장소 화면에서 다음 순서로 진행합니다.

1. `Use this template` 클릭
2. `Create a new repository` 선택
3. 새 컬렉션 저장소 이름과 공개 범위 지정
4. 저장소 생성

템플릿 저장소의 파일과 디렉터리 구조가 새 저장소에 복사됩니다.

### 2. Issues 활성화

새 저장소에서 다음 위치로 이동합니다.

```text
Settings → General → Features → Issues
```

`Issues`가 꺼져 있다면 활성화합니다.

관리형 컬렉션 저장소라면 `Issues` 옆 드롭다운에서 `Collaborators only`를 선택하는 것을 권장합니다. 외부 사용자가 요청 이슈를 생성하여 미리보기 워크플로를 실행하는 것을 막을 수 있습니다. 이 제한은 서브모듈 요청 폼뿐 아니라 저장소의 모든 신규 이슈에 적용됩니다. 자세한 내용은 [GitHub Issues 설정 문서](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues)를 참고하세요.

### 3. GitHub Actions 쓰기 권한 설정

다음 위치로 이동합니다.

```text
Settings → Actions → General → Workflow permissions
```

아래 항목을 설정합니다.

- `Read and write permissions`
- `Allow GitHub Actions to create and approve pull requests`

설정하지 않으면 요청 검증은 가능하지만 브랜치 push 또는 Pull Request 생성 단계가 실패할 수 있습니다.

### 4. 서브모듈 추가 요청하기

```text
Issues → New issue → Add a submodule
```

필드는 다음과 같습니다.

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| Repository | 예 | `owner/repository` 또는 GitHub HTTPS URL |
| Parent path | 예 | 서브모듈이 들어갈 상위 디렉터리. 루트는 `.` |
| Directory name | 아니요 | 비워 두면 저장소 이름 사용 |
| Branch | 아니요 | 비워 두면 대상 저장소의 기본 브랜치 사용 |
| Confirmation | 예 | 저장소와 상위 경로를 검토했음을 확인 |

예시 입력:

```text
Repository: example/example
Parent path: collections
Directory name: example
Branch: main
Confirmation: 체크
```

생성 예정 경로:

```text
collections/example
```

이슈를 생성하거나 수정하면 GitHub Actions가 검증 결과와 최종 경로를 댓글로 표시합니다.

### 5. 요청 승인하기

댓글의 검증 결과가 정상이라면 저장소에 `write`, `maintain`, `admin` 중 하나의 권한이 있는 사용자가 다음 댓글을 작성합니다.

```text
/approve
```

Action은 승인자의 실제 저장소 권한과 현재 이슈 내용을 다시 확인한 뒤 다음 작업을 수행합니다.

1. `submodule/issue-<이슈 번호>` 브랜치 생성
2. `git submodule add` 실행
3. `.gitmodules`와 gitlink 커밋
4. Pull Request 생성
5. 생성된 PR 주소를 이슈에 댓글로 안내

PR 본문에는 `Closes #<이슈 번호>`가 포함되므로 PR이 병합되면 요청 이슈도 닫힙니다.

## 서브모듈 수동 업데이트

등록된 서브모듈을 원격 최신 커밋으로 갱신하려면 저장소의 Actions 화면을 사용합니다.

```text
Actions → Update submodules → Run workflow
```

`path` 입력값에 따라 갱신 범위가 달라집니다.

| 입력 | 동작 |
| --- | --- |
| 비워 둠 | `.gitmodules`에 등록된 모든 서브모듈 업데이트 |
| 정확한 경로 입력 | 지정한 서브모듈 하나만 업데이트 |

특정 경로 업데이트 예시:

```text
collections/example
```

경로는 `.gitmodules`의 `path` 값과 정확히 일치해야 합니다. 오타가 있거나 등록되지 않은 경로이면 워크플로가 실패하면서 사용 가능한 경로를 로그에 표시합니다.

업데이트 워크플로는 다음 규칙으로 대상 커밋을 선택합니다.

1. `.gitmodules`에 해당 서브모듈의 `branch`가 지정되어 있으면 그 브랜치의 최신 커밋
2. `branch`가 없으면 대상 저장소의 원격 기본 브랜치 최신 커밋

예를 들어 다음 서브모듈은 `main` 브랜치를 추적합니다.

```ini
[submodule "collections/example"]
    path = collections/example
    url = https://github.com/example/example.git
    branch = main
```

업데이트가 발견되면 다음과 같은 별도 브랜치와 Pull Request가 생성됩니다.

```text
submodule/update-<workflow run id>
```

PR에는 각 서브모듈의 이전 커밋과 새 커밋이 표시됩니다. 선택한 서브모듈이 이미 최신 상태라면 브랜치와 PR을 만들지 않고 Actions 실행 요약에 결과만 남깁니다.

> 수동 업데이트는 서브모듈 저장소의 파일을 컬렉션 저장소에 복사하지 않습니다. 컬렉션 저장소가 가리키는 gitlink 커밋만 갱신합니다.

## 지원하는 저장소 입력

기본 설정에서는 GitHub HTTPS 저장소만 허용합니다.

아래 입력은 모두 같은 저장소로 정규화됩니다.

```text
example/example
https://github.com/example/example
https://github.com/example/example.git
```

정규화 결과:

```text
https://github.com/example/example.git
```

SSH URL, `file://`, URL 내부 자격 증명, query string 및 fragment는 허용하지 않습니다.

## 저장소 owner 제한

`scripts/submodule-manager.mjs` 상단의 `whitelist_owner` 배열로 추가 가능한 저장소 owner를 제한할 수 있습니다.

기본값은 빈 배열이며 모든 owner를 허용합니다.

```js
export const whitelist_owner = [];
```

특정 owner만 허용하려면 배열에 owner 이름을 추가합니다.

```js
export const whitelist_owner = [
  'example',
  'example-org',
];
```

배열에 값이 하나라도 있으면 목록에 포함된 owner의 저장소만 요청할 수 있습니다. owner 비교는 GitHub 동작에 맞춰 대소문자를 구분하지 않습니다.

```text
example/example         → 허용
example-org/example     → 허용
other-owner/example     → 거부
```

전체 HTTPS URL을 입력하는 경우에는 호스트 다음의 첫 번째 경로 요소를 owner로 판별합니다.

## 설정 변경

`.github/submodule-manager.json`에서 동작을 조정할 수 있습니다.

```json
{
  "allowed_hosts": [
    "github.com"
  ],
  "authenticated_hosts": [
    "github.com"
  ],
  "allow_root": true,
  "portable_paths": true,
  "prevent_duplicate_repository": true,
  "prevent_case_insensitive_path": true
}
```

### allowed_hosts

허용할 HTTPS Git 호스트 목록입니다.

```json
{
  "allowed_hosts": [
    "github.com",
    "git.example.com"
  ]
}
```

`owner/repository` 단축 입력은 항상 `github.com`으로 해석됩니다. 다른 호스트는 전체 HTTPS URL을 입력해야 합니다.

### authenticated_hosts

`SUBMODULE_TOKEN`을 전달할 수 있는 `allowed_hosts`의 하위 목록입니다. 기본값에는 `github.com`만 포함됩니다. 공개 커스텀 호스트는 이 목록에 넣지 말고, 비공개 커스텀 호스트에는 해당 호스트용으로 범위가 제한된 토큰을 사용할 때만 명시적으로 추가합니다.

```json
{
  "allowed_hosts": [
    "github.com",
    "git.example.com"
  ],
  "authenticated_hosts": [
    "github.com"
  ]
}
```

### allow_root

`true`이면 `Parent path`에 `.`을 입력하여 저장소 루트에 서브모듈을 추가할 수 있습니다.

### portable_paths

`true`이면 Windows에서도 체크아웃하기 어려운 문자와 예약 이름을 차단합니다. 한국어, 공백, 작은따옴표, 세미콜론 등은 허용됩니다.

### prevent_duplicate_repository

`.gitmodules`에 같은 저장소 URL이 이미 있으면 요청을 거부합니다. GitHub URL은 대소문자와 `.git` 유무를 정규화하여 비교합니다.

### prevent_case_insensitive_path

대소문자를 구분하지 않는 파일 시스템에서 충돌할 수 있는 경로를 차단합니다.

예를 들어 `Collections/Example`이 존재하면 `collections/example`도 중복으로 처리합니다.

## 비공개 서브모듈

기본 `GITHUB_TOKEN`은 현재 컬렉션 저장소 범위에 한정되므로 다른 비공개 저장소를 읽지 못할 수 있습니다.

비공개 대상 저장소를 추가하려면 새 컬렉션 저장소에 `SUBMODULE_TOKEN` Actions secret을 등록합니다. HTTPS 사용자 이름으로 `x-access-token`을 받지 않는 호스트라면 필요한 사용자 이름을 `SUBMODULE_TOKEN_USERNAME` secret에도 등록합니다.

```text
Settings → Secrets and variables → Actions → New repository secret
```

권장 사항:

- fine-grained personal access token 사용
- 대상 비공개 저장소에 대한 `Contents: Read-only`만 부여
- 컬렉션 저장소에 대한 쓰기 권한은 부여하지 않기
- 가능한 짧은 만료 기간 지정

토큰은 쓰기 권한자의 `/approve` 이후 대상 서브모듈을 다시 검증하고 추가할 때와 수동 업데이트를 실행할 때만 `authenticated_hosts`에 사용됩니다. 공개 이슈 미리보기에는 이 토큰을 전달하지 않으므로, 비공개 저장소는 권한 있는 협업자가 승인하기 전까지 접근 불가로 표시될 수 있습니다. 대상 Git 명령은 컬렉션 checkout 자격 증명을 명시적으로 제거한 뒤 이 토큰을 적용합니다. 컬렉션 저장소 브랜치 push에는 기본 `GITHUB_TOKEN`이 사용됩니다.

## 검증 규칙

요청은 다음 조건을 통과해야 합니다.

- 허용된 호스트의 HTTPS 저장소
- 해당 호스트의 기본 HTTPS 포트 사용
- 대상 저장소에 접근 가능
- 지정한 브랜치가 실제로 존재
- Issue Form의 Confirmation이 체크됨
- 절대 경로가 아님
- `.` 또는 `..` 경로 요소를 포함하지 않음
- `.git` 내부 경로가 아님
- 제어 문자나 줄바꿈을 포함하지 않음
- `.gitmodules`에 동등한 HTTPS, SSH 또는 scp 형식 저장소가 없음
- 대소문자를 구분하지 않는 파일 시스템에서 추적 경로와 충돌하지 않음
- 기존 상위 경로의 심볼릭 링크를 통과하지 않음

승인 단계에서 검사한 브랜치와 커밋은 Pull Request에 스테이징되는 gitlink에 결속됩니다. 검사 이후 원격 상태가 바뀌면 검사한 커밋을 체크아웃하거나 Pull Request를 push하지 않고 실패합니다.

사용자가 입력한 값은 쉘 명령 문자열로 조합하지 않고 검증 후 Node.js `child_process`를 통해 Git 명령의 개별 인자로 전달됩니다.

관리 스크립트는 Node.js 표준 라이브러리만 사용합니다. GitHub 호스팅 `ubuntu-latest` 러너의 기본 Node.js를 사용하며, 워크플로에서 `actions/setup-node`, `npm install`, `npm ci`를 실행하지 않으므로 별도 패키지 설치 시간이 들지 않습니다. 실제 전체 실행 시간은 러너 시작과 원격 Git 작업의 영향을 가장 크게 받습니다.

## 템플릿 저장소 운영자 설정

이 프로젝트를 GitHub에 처음 올린 뒤 템플릿 저장소로 공개하려면 다음 위치에서 설정합니다.

```text
Settings → General → Template repository
```

`Template repository`를 활성화하면 저장소 상단에 `Use this template` 버튼이 표시됩니다.

README 상단의 배지는 현재 저장소를 기준으로 상대 링크를 사용하므로 템플릿 저장소 이름을 바꿔도 별도 수정이 필요하지 않습니다.

## 파일 구조

```text
.
├── .github
│   ├── ISSUE_TEMPLATE
│   │   ├── add-submodule.yml
│   │   └── config.yml
│   ├── workflows
│   │   ├── approve-submodule-request.yml
│   │   ├── preview-submodule-request.yml
│   │   └── update-submodules.yml
│   └── submodule-manager.json
├── scripts
│   └── submodule-manager.mjs
├── LICENSE
├── README.md
└── README_KR.md
```

## 주의 사항

- Action이 생성한 PR은 자동 병합하지 않습니다.
- 요청 이슈를 수정하면 미리보기도 갱신됩니다.
- `/approve` 시점의 최신 이슈 내용을 다시 검증합니다.
- 같은 이슈용 자동화 브랜치에 이미 PR이 있으면 중복 PR을 만들지 않습니다. PR 없는 고아 브랜치는 보존하고, 재시도는 실행별 새 브랜치를 사용합니다.
- 기본 `GITHUB_TOKEN`으로 생성한 PR의 이벤트가 다른 워크플로를 다시 실행하지 않을 수 있습니다. PR 생성 후 별도 CI 실행이 꼭 필요하다면 GitHub App 또는 별도 토큰 기반 구성을 검토해야 합니다.

## License

MIT License
