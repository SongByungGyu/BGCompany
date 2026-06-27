# Agent Events API

`POST /api/agent-events`는 실제 Hermes 연결 전, 외부 Agent가 보낼 이벤트를 BG Company 내부 이벤트로 정규화하고 DB에 저장하기 위한 수신 엔드포인트입니다.

처리 흐름:

```text
Agent/Hermes event input
→ validate
→ normalize
→ DB event 저장
→ employee/task/approval side effect 적용
→ timeline 생성
→ 기존 API에서 조회 가능
```

## DTO

```ts
type AgentEventInput = {
  source: "hermes" | "mock" | "system" | "codex" | "manual";
  eventType: string;
  employeeId?: string;
  taskId?: string;
  approvalId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};
```

지원 eventType:

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

## EmployeeStatusChanged

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

확인:

```bash
curl "http://localhost:3000/api/timelines?targetType=employee&targetId=content-planner"
curl http://localhost:3000/api/employees
```

## ErrorOccurred

```bash
curl -X POST http://localhost:3000/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "hermes",
    "eventType": "ErrorOccurred",
    "employeeId": "developer",
    "taskId": "task-dev-pipeline",
    "payload": {
      "summary": "콘텐츠 생성 중 오류 발생",
      "error": "Mock error from Hermes"
    }
  }'
```

확인:

```bash
curl "http://localhost:3000/api/timelines?targetType=employee&targetId=developer"
curl "http://localhost:3000/api/timelines?targetType=task&targetId=task-dev-pipeline"
curl http://localhost:3000/api/tasks
```

## OutputGenerated

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

확인:

```bash
curl "http://localhost:3000/api/timelines?targetType=employee&targetId=content-planner"
curl "http://localhost:3000/api/timelines?targetType=task&targetId=task-content-draft"
curl http://localhost:3000/api/events
```
