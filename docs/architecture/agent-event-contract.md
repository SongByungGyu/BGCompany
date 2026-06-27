# Agent Event Contract

## 1. 목적

이 문서는 Hermes 또는 외부 Agent가 BG Company로 업무 이벤트를 보낼 때 사용하는 표준 계약입니다.

목표 흐름은 다음과 같습니다.

```text
Agent/Hermes 이벤트 수신
→ validate
→ normalize
→ event 저장
→ employee/task/approval side effect 적용
→ timeline 생성
→ polling으로 프론트 화면 반영
```

이번 단계는 실제 Hermes 서버 연결 전, API 계약과 테스트 방법을 고정하는 준비 단계입니다.

## 2. API Endpoint

```text
POST /api/agent-events
```

내부 Mock/UI 이벤트는 기존 `POST /api/events`를 사용할 수 있고, 외부 Agent/Hermes 입력은 `POST /api/agent-events`를 사용합니다.

## 3. 인증

외부 Agent/Hermes callback은 다음 header를 포함해야 합니다.

```http
x-bg-agent-key: <AGENT_API_KEY>
```

header가 없거나 값이 다르면 `401 Unauthorized`와 `UNAUTHORIZED_AGENT_REQUEST`를 반환합니다.

## 4. 공통 Payload

```ts
type AgentEventInput = {
  source: 'hermes' | 'mock' | 'system' | 'codex' | 'manual';
  eventType: string;
  employeeId?: string;
  taskId?: string;
  approvalId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};
```

## 4. 지원 이벤트 타입

- `TaskCreated`
- `TaskStarted`
- `EmployeeStatusChanged`
- `MeetingStarted`
- `MeetingEnded`
- `ApprovalRequested`
- `ApprovalResolved`
- `ErrorOccurred`
- `ErrorResolved`
- `OutputGenerated`
- `EmployeeMoved`

지원 alias 예시:

- `employee.status.changed` → `EmployeeStatusChanged`
- `task.started` → `TaskStarted`
- `meeting.started` → `MeetingStarted`
- `approval.requested` → `ApprovalRequested`
- `error.occurred` → `ErrorOccurred`
- `output.generated` → `OutputGenerated`

## 5. 이벤트별 필수 필드

### EmployeeStatusChanged

- `employeeId` required
- `payload.status` required
- `payload.summary` optional

### TaskStarted

- `taskId` required
- `employeeId` optional
- `payload.title` optional

### MeetingStarted

- `employeeId` 또는 `payload.participants` required
- `payload.meetingTitle` optional
- 참여자가 여러 명이면 `payload.participants`에 employeeId 배열을 전달합니다.

### MeetingEnded

- `employeeId` 또는 `payload.participants` required
- `payload.status` optional. 없으면 `업무 중`으로 복귀합니다.

### ApprovalRequested

- `approvalId` 또는 `taskId` required
- `employeeId` optional
- `payload.title` optional

### ApprovalResolved

- `approvalId` required
- `payload.approved` optional
- `payload.status` optional

### ErrorOccurred

- `employeeId` 또는 `taskId` required
- `payload.error` optional
- `payload.message` optional

### ErrorResolved

- `employeeId` 또는 `taskId` 권장
- `payload.status` optional. 없으면 `업무 중`으로 복귀합니다.

### OutputGenerated

- `taskId` required
- `employeeId` optional
- `payload.outputTitle` optional
- `payload.output` optional

### EmployeeMoved

- `employeeId` required
- `payload.destinationId` optional

## 6. 상태 매핑

프론트와 DB에서 사용하는 한국어 상태 기준:

- `대기 중`
- `이동 중`
- `업무 중`
- `조사 중`
- `회의 중`
- `검토 중`
- `결과 대기`
- `승인 대기`
- `수정 중`
- `보고 중`
- `오류 대응 중`
- `업무 완료`
- `휴식 중`
- `업무 종료`

주요 side effect:

- `EmployeeStatusChanged` → employee.status 업데이트, taskId가 있으면 task.status 일부 동기화
- `TaskStarted` → task.status = `진행 중`, employee.status = `업무 중`
- `MeetingStarted` → 참여 employee.status = `회의 중`
- `MeetingEnded` → 참여 employee.status = `업무 중` 또는 payload.status
- `ApprovalRequested` → approval/task/employee를 `승인 대기` 흐름으로 변경
- `ApprovalResolved` → approval 결과에 따라 task/employee 상태 업데이트
- `ErrorOccurred` → task.status = `오류`, employee.status = `오류 대응 중`
- `ErrorResolved` → task.status 복구, employee.status 복구
- `OutputGenerated` → task.recentOutput 업데이트 및 timeline 생성

## 7. 예시 curl

### EmployeeStatusChanged

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "EmployeeStatusChanged",
    "employeeId": "content-planner",
    "payload": {
      "status": "회의 중",
      "summary": "콘텐츠 회의 참석"
    }
  }'
```

### TaskStarted

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "TaskStarted",
    "employeeId": "content-planner",
    "taskId": "task-content-draft",
    "payload": {
      "title": "콘텐츠 초안 작성 시작"
    }
  }'
```

### MeetingStarted

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "MeetingStarted",
    "payload": {
      "meetingTitle": "콘텐츠 회의",
      "participants": ["content-planner", "marketing-manager", "qa-auditor"]
    }
  }'
```

### ApprovalRequested

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "ApprovalRequested",
    "employeeId": "marketing-manager",
    "approvalId": "approval-thumbnail",
    "taskId": "task-thumbnail-approval",
    "payload": {
      "title": "썸네일 최종안 승인 요청"
    }
  }'
```

### ErrorOccurred

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "ErrorOccurred",
    "employeeId": "developer",
    "taskId": "task-dev-pipeline",
    "payload": {
      "summary": "배포 파이프라인 오류",
      "error": "Mock error from Hermes"
    }
  }'
```

### OutputGenerated

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "OutputGenerated",
    "employeeId": "content-planner",
    "taskId": "task-content-draft",
    "payload": {
      "summary": "블로그 초안 생성 완료",
      "outputTitle": "6월 루틴 정리 초안"
    }
  }'
```

## 8. 처리 결과

이벤트 수신 후 시스템이 하는 일:

```text
1. validate
2. normalize
3. event 저장
4. employee/task/approval side effect 적용
5. timeline 생성
6. polling으로 프론트 화면 반영
```

정상 응답 예시:

```json
{
  "ok": true,
  "eventId": "event-...",
  "eventIds": ["event-..."],
  "normalizedType": "EmployeeStatusChanged",
  "sideEffects": {
    "employeeUpdated": true,
    "taskUpdated": false,
    "approvalUpdated": false,
    "timelineCreated": true
  }
}
```

확인 API:

```bash
curl "http://localhost:3000/api/employees"
curl "http://localhost:3000/api/tasks"
curl "http://localhost:3000/api/approvals"
curl "http://localhost:3000/api/timelines?targetType=employee&targetId=content-planner"
```
