# Agent Runner Architecture

## 목적

Agent Runner는 BG Company의 업무 보드에서 선택한 업무를 특정 Agent에게 실행시키기 위한 내부 실행 계층입니다.

현재 단계에서는 실제 Hermes 서버나 LLM을 호출하지 않고, `mock` runner가 `POST /api/agent-events`와 동일한 이벤트 처리 계층을 사용해 업무가 실행되는 흐름을 검증합니다.

## 실행 흐름

```text
POST /api/agent-runs
→ AgentRun 생성
→ task / employee 조회
→ agents/*.md 역할 문서 로드
→ AgentRunContext 생성
→ runner provider가 mock/hermes runner 선택
→ runner 실행
→ TaskStarted / EmployeeStatusChanged / OutputGenerated / ApprovalRequested 이벤트 생성
→ AgentRun status 업데이트
→ DB polling/refetch로 화면 반영
```

## AgentRunContext 구조

AgentRunContext는 이후 Hermes에 전달할 실행 payload의 기반입니다.

포함 정보:

- runId
- task 정보
- employee 정보
- agent role document 정보
- allowedEvents
- forbiddenActions
- 승인 필요 조건
- 안전 규칙
- event contract
- outputFormat
- callback endpoint
- metadata

전체 역할 문서 본문은 외부 API 응답으로 노출하지 않고, `AgentRun.metadata.contextSummary`에는 요약 정보만 저장합니다.

## agents/*.md 사용 방식

각 Agent의 역할 문서는 `agents/{agentId}.md`에서 읽습니다.

로드 대상:

- frontmatter
  - agent_id
  - display_name
  - department
  - default_seat
  - allowed_events
  - forbidden_actions
- 본문 섹션
  - 역할
  - 승인 필요 조건
  - 결과물 형식
  - 보고 규칙

새 패키지 없이 간단한 markdown/frontmatter parser를 직접 구현했습니다.

## Mock runner와 Hermes runner

### mock runner

현재 실제로 동작하는 runner입니다.

- AgentRunContext를 입력으로 받음
- role/output/approval 조건을 반영해 mock 결과 생성
- 이벤트 processor를 통해 DB side effect와 timeline 생성

### hermes runner

Hermes 연결 준비용 runner입니다.

- `mode=hermes` 또는 `AGENT_RUNNER_MODE=hermes`에서 Hermes Client를 호출합니다.
- `HERMES_BASE_URL`이 없으면 명확한 설정 오류를 반환하고 AgentRun은 failed로 기록됩니다.
- Hermes 제출 성공 시 AgentRun은 `running` 상태를 유지하고 `hermesJobId`를 저장할 수 있습니다.
- `mode=hermes-dry-run`에서는 네트워크 호출 없이 Hermes payload summary만 생성합니다.

## AGENT_RUNNER_MODE

지원 예정 값:

```text
mock
hermes
hermes-dry-run
```

현재 기본값은 `mock`입니다.

Hermes 연결 준비 상세는 [Hermes Runner Integration Preparation](./hermes-runner.md)을 참고합니다.

## 안전 규칙

### finance-manager

- 송금 금지
- 결제 금지
- 자동이체 금지
- 투자 실행 금지
- 계좌 제어 금지
- 비용 분석은 읽기 전용

### stock-monitor

- 매수 금지
- 매도 금지
- 주문 실행 금지
- 투자 자금 이동 금지
- 보유 종목 모니터링은 읽기 전용

### content-planner / marketing-manager

- 콘텐츠 게시 전 승인 필요
- 외부 메시지 발송 전 승인 필요

### developer

- 오류 복구, 파일 변경, 배포 관련 작업은 승인 또는 사용자 지시 없이 실제 실행하지 않음

### qa-auditor

- 정책 위반, 안전 문제, 감사 로그 이슈를 보고해야 함

## 향후 Hermes 연결 계획

1. Hermes runner에서 AgentRunContext를 Hermes job payload로 변환
2. Hermes jobId를 AgentRun.hermesJobId에 저장
3. Hermes callback 또는 polling으로 job 상태 수신
4. 수신 이벤트를 `POST /api/agent-events`와 동일한 processor로 처리
5. SSE/WebSocket은 이후 단계에서 검토

## 이번 단계에서 하지 않는 것

- 실제 Hermes 서버 연결
- 실제 LLM 호출
- 실제 외부 API 연동
- 금융/주식 거래 실행
- 인증/배포
- WebSocket/SSE
- 3D 오피스 디자인 변경
