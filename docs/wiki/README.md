# BG Company 운영 위키

BG Company가 같은 실수를 반복하지 않도록 역할, 결정, 실패 교훈, 예방 규칙을 연결해 관리하는 내부 지식 저장소입니다.
운영 사실은 코드와 설정에서 확인하고, 위키에는 그 사실의 의미와 다음 행동을 기록합니다.

마지막 구조 검증일: 2026-08-14

## 빠른 시작

- 실패나 차단이 발생했다면 [교훈 원장](lessons/README.md)에서 같은 `fingerprint`를 먼저 찾습니다.
- 역할과 실제 실행 방식은 [Agent 운영 지도](agent-map.md)에서 확인합니다.
- 수집한 근거가 글에 반영되는 경로는 [레퍼런스→본문 반영 흐름](reference-to-article-flow.md)에서 확인합니다.
- 위키 작성·검토 책임은 [운영 규칙](governance.md)을 따릅니다.
- 구조를 바꾸는 결정은 [결정 기록](decisions/README.md)에 남깁니다.
- 자동 fingerprint·승인·Agent 적용 흐름은 [운영 학습 시스템](operational-learning.md)에서 확인합니다.
- Obsidian에서 사용하는 방법은 [Obsidian 연결 안내](OBSIDIAN.md)를 따릅니다.
- 즉시 복구 절차는 기존 [운영 Runbook](../operations/runbook.md)을 사용합니다.

## 위키 지도

| 영역 | 목적 | 갱신 시점 |
|---|---|---|
| [Agent 운영 지도](agent-map.md) | 역할, 실행 모드, 입력·출력, 권한 충돌 확인 | Agent·파이프라인 변경 시 |
| [레퍼런스→본문 반영 흐름](reference-to-article-flow.md) | 수집 자료가 기획·본문·QA·게시 차단에 반영되는 경로 | Reference·Writer·QA 정책 변경 시 |
| [교훈 원장](lessons/README.md) | 실패 원인, 복구, 예방 규칙, 재발 횟수 관리 | 실패 확인 후 24시간 이내 |
| [결정 기록](decisions/README.md) | 중요한 구조·정책 선택과 이유 보존 | 정책·아키텍처 변경 전후 |
| [운영 규칙](governance.md) | 작성 책임, 상태 전환, 주간 회고 정의 | 운영 방식 변경 시 |
| [운영 학습 시스템](operational-learning.md) | 자동 수집, 반복 감지, 승인, Agent 주입, 검증 | 학습 정책·DB 변경 시 |
| [Obsidian 연결 안내](OBSIDIAN.md) | Vault 열기, 백링크·그래프·템플릿 사용 | 로컬 지식관리 환경 변경 시 |
| [교훈 템플릿](templates/lesson-template.md) | 새 실패 교훈의 필수 형식 | 새 교훈 작성 시 |
| [결정 템플릿](templates/decision-template.md) | 새 결정 기록의 필수 형식 | 새 결정 작성 시 |

## 사실의 우선순위

충돌이 있으면 다음 순서로 확인합니다.

1. 현재 실행 중인 코드·배포 설정·운영 이벤트
2. 자동화된 테스트와 품질 게이트
3. 이 위키의 검증된 문서
4. 기능별 설계 문서와 과거 계획서

위키와 실행 코드가 다르면 위키를 임의로 사실처럼 고치지 않습니다. `Agent 운영 지도`의 불일치 목록에 먼저 등록하고, 코드 또는 정책 수정이 승인된 뒤 함께 갱신합니다.

## 학습 순환

```text
실패 이벤트·스케줄러 차단 감지
  → fingerprint 자동 생성 및 기존 교훈 검색
  → 원인·영향·복구 기록
  → 7일 내 2회면 루나 개선안·승인 요청 생성
  → CEO 승인된 규칙만 관련 Agent 실행에 주입
  → 회귀 테스트와 검증 증거 연결
  → 운영에서 재검증
  → verified 전환
```

같은 `fingerprint`가 다시 발생하면 새 교훈을 만들지 않습니다. 기존 문서의 `last_seen`, `recurrence_count`, 재발 기록을 갱신하고 예방 규칙이 실패한 이유를 추가합니다.

## 완료 기준

교훈은 문서를 작성했다고 끝나지 않습니다. 다음 조건을 모두 만족해야 `verified`가 됩니다.

- 근본 원인이 증거와 함께 기록됨
- 즉시 복구 절차가 안전하게 재현됨
- 예방 규칙의 담당자와 적용 위치가 정해짐
- 자동 회귀 테스트 또는 수동 검증 절차가 연결됨
- 실제 운영에서 재검증됨

## 검증 명령

```bash
cd apps/web
npm run test:wiki
```

검증기는 필수 메타데이터와 섹션, 중복 `fingerprint`, 깨진 내부 링크, 비밀정보로 보이는 문자열을 확인합니다.

운영 학습 정책 회귀 테스트:

```bash
cd apps/web
npm run test:learning
```

Agent Registry와 역할 문서 동기화 검사:

```bash
cd apps/web
npm run test:agents
```

## 관련 운영 문서

- [콘텐츠 파이프라인 구조](../architecture/content-pipeline.md)
- [Agent 실행기 구조](../architecture/agent-runner.md)
- [주식 블로그 팀 운영](../stock-blog/stock-blog-team-operations.md)
- [주식 브리핑 품질 게이트](../stock-blog/stock-briefing-quality-gate.md)
- [Hermes Bridge](../hermes/hermes-bridge.md)
