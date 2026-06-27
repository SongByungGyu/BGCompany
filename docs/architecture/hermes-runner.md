# Hermes Runner Integration Preparation

## 목적

이 문서는 BG Company Agent Runner가 실제 Hermes 서버와 연결되기 전 필요한 실행 모드, payload, callback, 테스트 방법을 정리합니다.

현재 단계에서는 실제 Hermes 서버나 실제 Agent 실행을 연결하지 않습니다. 대신 `mock`, `hermes`, `hermes-dry-run` 모드를 분리해 Hermes 연동 준비 상태를 검증합니다.

## 환경 변수

```env
AGENT_RUNNER_MODE=mock
HERMES_BASE_URL=
HERMES_API_KEY=
HERMES_TIMEOUT_MS=30000
```

- `AGENT_RUNNER_MODE`: 기본 runner 모드입니다. 지원 값은 `mock`, `hermes`, `hermes-dry-run`입니다.
- `HERMES_BASE_URL`: Hermes API base URL입니다. `hermes` 모드에서는 필수입니다.
- `HERMES_API_KEY`: Hermes 인증 토큰입니다. 로그나 API 응답에 노출하지 않습니다.
- `HERMES_TIMEOUT_MS`: Hermes 요청 timeout입니다.

## runner mode

### mock

기본 모드입니다.

- 외부 네트워크 호출 없음
- AgentRunContext 기반 mock 결과 생성
- `OutputGenerated`, `ApprovalRequested` 등 기존 DB 이벤트와 timeline 생성
- 기존 업무 보드 실행 버튼에서 안정적으로 동작

### hermes

Hermes 서버에 AgentRunContext를 정리한 payload를 제출하는 모드입니다.

- `HERMES_BASE_URL`이 없으면 명확한 `HERMES_NOT_CONFIGURED` 오류를 반환합니다.
- API key는 `Authorization: Bearer ...` 헤더로만 사용하며 저장/출력하지 않습니다.
- 제출 성공 시 `AgentRun.status = running` 상태를 유지합니다.
- 응답의 `hermesJobId` 또는 유사 id를 `AgentRun.hermesJobId`에 저장할 수 있습니다.
- 이후 Hermes는 `/api/agent-events`로 상태 변경, 결과 생성, 오류 이벤트를 callback으로 보냅니다.

### hermes-dry-run

실제 네트워크 호출 없이 Hermes payload만 생성하는 테스트 모드입니다.

- Hermes 서버가 없어도 동작합니다.
- `AgentRun.metadata.hermesPayloadSummary`에 payload 요약을 저장합니다.
- 전체 role document 원문, API key, DB 내부 상세 정보는 payload summary에 포함하지 않습니다.

## Hermes 요청 payload

Hermes에 전달하는 payload는 AgentRunContext 전체 원문이 아니라 실행에 필요한 최소 정보로 정리합니다.

포함 정보:

- `runId`
- `task`
- `agent`
- `constraints`
- `eventContract`
- `callback`
- `metadata`

제외 또는 요약 정보:

- 전체 role document 원문
- API key
- DB 내부 상세 정보
- 민감 정보

## callback endpoint

Hermes는 작업 중 상태 변경, 결과 생성, 오류 발생 등을 다음 endpoint로 보냅니다.

```text
POST /api/agent-events
```

이 endpoint는 현재 Mock 이벤트와 같은 event processor를 사용합니다.

Hermes가 BG Company로 callback을 보낼 때는 다음 header를 포함해야 합니다.

```http
x-bg-agent-key: <AGENT_API_KEY>
```

## 테스트 방법

### mock mode

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-content-draft",
    "employeeId": "content-planner",
    "mode": "mock"
  }'
```

### hermes mode without config

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-content-draft",
    "employeeId": "content-planner",
    "mode": "hermes"
  }'
```

`HERMES_BASE_URL`이 없으면 crash 없이 명확한 설정 오류를 반환하고 AgentRun은 failed로 기록됩니다.

### hermes dry-run

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-content-draft",
    "employeeId": "content-planner",
    "mode": "hermes-dry-run"
  }'
```

## 아직 구현하지 않은 것

- 실제 Hermes 서버 운영 연결
- 실제 LLM 호출
- 실제 Agent 실행
- WebSocket/SSE
- 인증
- 배포
- 외부 API 연동
- 금융/주식 API 연동
- 송금/결제/매수/매도/주문 실행
- GLB 캐릭터 교체
- 3D 오피스 디자인 변경
