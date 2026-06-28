# Hermes Integration Contract

BG Company currently supports a staged Hermes integration. The first real integration target is only `content-planner` inside the Phase 1-C content pipeline.

## Runner modes

| mode | behavior |
| --- | --- |
| `mock` | Uses the existing mock pipeline result. No Hermes payload or network call is produced. |
| `hermes-dry-run` | Builds the Hermes request payload and stores it in `AgentRun.metadata`; it does not call Hermes. |
| `hermes` | Sends the content-planner payload to Hermes. Marketing and QA remain mock in this phase. |

## Environment variables

```env
HERMES_BASE_URL=
HERMES_API_KEY=
HERMES_HEALTH_PATH=/health
HERMES_RUN_PATH=/api/runs
HERMES_TIMEOUT_MS=30000
```

Secrets must be stored only in `.env` on the target server. Do not commit real values.

## Content planner request payload

```json
{
  "agentId": "content-planner",
  "role": "content_planner",
  "taskType": "content_planning",
  "input": {
    "topic": "AI 개인회사 구축 과정 정리",
    "title": "BG Company 구축기 1편",
    "channel": "blog",
    "language": "ko"
  },
  "context": {
    "company": "BG Company",
    "workflow": "content_pipeline",
    "runnerMode": "hermes"
  }
}
```

## Normalized result

BG Company normalizes Hermes responses into:

```ts
type NormalizedHermesRunResult = {
  ok: boolean;
  provider: "hermes";
  agentId: string;
  title?: string;
  summary?: string;
  content?: string;
  draftDirection?: string;
  outline?: string[];
  raw?: unknown;
  hermesJobId?: string;
  errorCode?: string;
  errorMessage?: string;
};
```

The adapter accepts common response shapes such as top-level fields, `result`, `output`, or `data` objects.

## Failure policy

Hermes failures must not crash the content pipeline API.

- Missing config: `HERMES_NOT_CONFIGURED`
- Timeout: `HERMES_TIMEOUT`
- HTTP failure: `HERMES_HTTP_ERROR`
- Network failure: `HERMES_REQUEST_ERROR`
- Invalid response: `HERMES_INVALID_RESPONSE`

On failure:

1. The `content-planner` task is marked `오류`.
2. The `AgentRun` is marked `failed`.
3. The error is stored in AgentRun metadata/errorMessage.
4. An `ErrorOccurred` event and timeline entry are created.
5. The content pipeline detail screen shows the error reason.

## Current limits

- Only `content-planner` can call Hermes.
- `marketing-manager` and `qa-auditor` remain mock.
- No external publishing, social posting, finance, stock, SSE, or OAuth integration is included in this phase.
