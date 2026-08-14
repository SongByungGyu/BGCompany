# Obsidian 연결 안내

`docs/wiki`는 표준 Markdown과 YAML front matter를 사용하므로 그 자체를 Obsidian Vault로 열 수 있습니다. 별도 복사본을 만들 필요가 없어 Git 기록, 코드 링크, Agent 교훈이 같은 원본을 사용합니다.

## Vault 열기

Obsidian에서 `Open folder as vault`를 선택하고 저장소의 `docs/wiki` 디렉터리를 지정합니다.

현재 Windows에서 WSL 저장소를 직접 열 때의 경로는 다음과 같습니다.

```text
\\wsl.localhost\Ubuntu-D\home\songbyunggyu\projects\bg-company\docs\wiki
```

WSL 네트워크 경로의 파일 변경 감지가 느린 환경이라면 Windows 쪽에 별도 사본을 수동 복사하지 말고, Git 작업 위치 자체를 Windows 드라이브로 옮길지 먼저 결정합니다. 같은 위키를 두 곳에서 편집하면 충돌과 오래된 문서가 생길 수 있습니다.

## 권장 Core plugin

- Backlinks
- Graph view
- Templates
- Properties view
- Search

Community plugin은 필수가 아닙니다. 특히 외부 동기화나 REST API plugin은 위키 내용과 네트워크 권한을 제3자 코드에 제공할 수 있으므로 별도 보안 검토 없이 설치하지 않습니다.

## 기본 사용법

- `README.md`를 홈으로 사용합니다.
- 새 교훈은 `templates/lesson-template.md`를 사용합니다.
- 새 결정은 `templates/decision-template.md`를 사용합니다.
- Properties에서 `fingerprint`, `status`, `owner`, `recurrence_count`를 확인합니다.
- Backlinks로 교훈과 코드·Runbook·결정의 연결을 추적합니다.
- Graph view는 탐색에 사용하되 연결 수 자체를 성과로 평가하지 않습니다.

## Git 운영

Obsidian에서 수정한 파일도 일반 코드 변경과 동일하게 검토합니다.

```bash
cd apps/web
npm run test:wiki
```

개인 창 상태, 최근 파일, 로컬 plugin은 Git에 올리지 않습니다. 저장소에는 링크 자동 갱신과 Markdown 링크 사용 같은 공통 최소 설정만 보존합니다.

## 보안

- Vault 범위는 저장소 전체가 아니라 `docs/wiki`로 제한합니다.
- `.env`, 로그 원문, 브라우저 프로필, API key를 첨부하지 않습니다.
- Obsidian Sync나 외부 클라우드 동기화는 별도 승인 전 사용하지 않습니다.
- 운영 DB의 자동 교훈은 승인과 검증 후 중요한 내용만 버전 관리 위키에 승격합니다.

Obsidian은 검색과 연결 탐색을 개선하지만 승인·회귀 테스트·Agent 주입을 대신하지 않습니다. 재발 방지의 기준 시스템은 [운영 학습 시스템](operational-learning.md)입니다.
