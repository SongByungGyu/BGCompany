# Hermes Bridge Service

## 목적

`hermes-bridge`는 BG Company Phase 1-C에서 콘텐츠 파이프라인의 허용된 Hermes 실행 단계만 실제 Hermes CLI로 실행하기 위한 내부 전용 서비스다. Hermes dashboard의 로그인 cookie를 재사용하지 않고, `hermes -z` oneshot 경로만 제한적으로 감싼다.

## 구조

```text
BG Company web
  → POST http://hermes-bridge:8787/run
  → hermes-bridge
  → hermes -z <generated prompt>
  → normalized JSON
  → AgentRun / Task / Event / Timeline 저장
```

## 보안 정책

- public `ports` 없음
- Traefik label 없음
- Docker socket mount 없음
- web 컨테이너에서 `docker exec` 직접 실행 없음
- `/run`은 `x-bridge-api-key` 필요
- allowlist: `content-planner/content_planning`, `marketing-manager/marketing_review`, `content-writer/content_writing`, `qa-auditor/qa_review`
- shell command 문자열을 만들지 않고 argv 배열로 실행
- timeout/stdout size/concurrency 제한 적용

## 환경 변수

```env
BRIDGE_API_KEY=change_me
HERMES_BRIDGE_BASE_URL=http://hermes-bridge:8787
HERMES_BRIDGE_TIMEOUT_MS=45000
HERMES_BRIDGE_MAX_STDOUT_BYTES=200000
HERMES_BRIDGE_MAX_CONCURRENCY=1
HERMES_BRIDGE_PROVIDER=openai-api
HERMES_BRIDGE_MODEL=gpt-5.4-mini
OPENAI_API_KEY=
```

`HERMES_BRIDGE_PROVIDER`와 `HERMES_BRIDGE_MODEL`은 bridge가 `hermes -z`를 실행할 때 명시적으로 넘기는 provider/model이다. 운영 기본값은 `openai-api`와 `gpt-5.4-mini`이다.

`OPENAI_API_KEY`는 bridge 컨테이너 안의 Hermes CLI가 OpenAI provider 인증을 위해 사용한다. key 원문은 로그나 문서에 남기지 않는다.

## 운영 확인

```bash
docker compose ps hermes-bridge
bash scripts/check-hermes-bridge.sh
```

실제 Hermes 호출 smoke test는 비용이 발생할 수 있으므로 명시적으로만 실행한다.

```bash
RUN_BRIDGE_SMOKE=1 bash scripts/check-hermes-bridge.sh
```

## 실패 코드

- `HERMES_BRIDGE_NOT_CONFIGURED`
- `HERMES_BRIDGE_UNAUTHORIZED`
- `HERMES_BRIDGE_INVALID_REQUEST`
- `HERMES_BRIDGE_AGENT_NOT_ALLOWED`
- `HERMES_BRIDGE_BUSY`
- `HERMES_BRIDGE_TIMEOUT`
- `HERMES_BRIDGE_EXECUTION_FAILED`
- `HERMES_BRIDGE_STDOUT_TOO_LARGE`
- `HERMES_BRIDGE_NETWORK_ERROR`
- `HERMES_BRIDGE_HTTP_ERROR`

## 금지 사항

- bridge를 인터넷에 공개하지 않는다.
- browser login cookie를 저장하거나 재사용하지 않는다.
- 운영 DB 초기화나 seed 자동 실행과 묶지 않는다.
- 초기 단계에서는 marketing/QA를 Hermes로 실행하지 않는다.

## Phase 1-C.8 결과 처리 정책

Bridge는 `content-planner` 응답을 가능한 한 JSON 계약으로 정규화한다. Hermes CLI가 순수 JSON만 반환하지 않더라도 brace-balanced 방식으로 첫 JSON object를 추출하고, 그래도 실패하면 `fallback_text` 상태로 원문을 저장한다.

정규화 필드:

```text
title
summary
outline
content
draftDirection
seoKeywords
targetAudience
tone
thumbnailIdea
cta
parseStatus
rawText
durationMs
```

`parseStatus` 의미:

- `json`: stdout 전체가 정상 JSON이다.
- `json_extracted`: stdout 안에서 JSON object를 추출해 사용했다.
- `fallback_text`: JSON 파싱은 실패했지만 원문을 결과로 저장했다.

운영 화면에서는 Hermes 실제 실행 선택 시 OpenAI API 비용 경고와 확인 창을 표시한다. smoke test는 비용이 발생할 수 있으므로 `RUN_BRIDGE_SMOKE=1`을 명시한 경우에만 실행한다.


## Hermes daily run guardrail

BG Company counts only real `runnerMode=hermes` Bridge attempts as paid Hermes usage. `mock`, `hermes-dry-run`, validation failures before the Bridge call, and user-cancelled confirmation dialogs are excluded.

Environment defaults:

```env
HERMES_DAILY_RUN_LIMIT=5
HERMES_DAILY_RUN_TZ=Asia/Seoul
```

The dashboard checks `GET /api/hermes/usage` before starting a real Hermes run. When the daily limit is exhausted, the content pipeline returns `HERMES_DAILY_LIMIT_EXCEEDED` and does not call Hermes/OpenAI.

Manual Bridge smoke tests are intentionally not part of health checks or deploy scripts because they can trigger paid model calls.


## Phase 1-C.10 production display policy

Hermes Bridge real execution duration is read from `agentRun.metadata.plannerResult.durationMs` first. The AgentRun `startedAt`/`completedAt` delta can be very small because the row is created after the external Hermes call, so it is only a fallback value.

The recent Hermes runs card displays these fields:

```text
createdAt
agentId
status
provider
actual durationMs
parseStatus
title/summary
```

Content pipeline detail timelines can contain the same event attached to multiple targets (`task`, `approval`, `employee`). The database audit rows are preserved. The detail response deduplicates only the display result by `eventId` so the same event is not repeated on one screen.


## Phase 1-C.14: four-agent Hermes content pipeline

Phase 1-C.14부터 `runnerMode=hermes` 콘텐츠 파이프라인은 최대 네 번의 Hermes Bridge 실행을 사용한다.

1. `content-planner` / `content_planning`: 콘텐츠 기획 초안 생성
2. `marketing-manager` / `marketing_review`: 기획 결과를 기반으로 제목, SEO 키워드, 홍보 문안, 리스크, 개선안을 검토
3. `content-writer` / `content_writing`: 기획/마케팅 결과를 기반으로 게시용 본문 초안 작성
4. `qa-auditor` / `qa_review`: 기획/마케팅/본문 결과를 기반으로 품질, 사실성, 리스크, 게시 준비 상태 검토

Bridge allowlist는 내부 전용 최소 범위로 유지한다.

- 허용 agent: `content-planner`, `marketing-manager`, `content-writer`, `qa-auditor`
- 허용 task type: `content_planning`, `marketing_review`, `content_writing`, `qa_review`
- 미허용: `director`, 게시/외부 발행, 임의 CLI 작업, allowlist에 없는 agent/task 조합

`content-writer` 실행 payload에는 `content-planner` 결과와 `marketing-manager` 결과가 포함된다. `qa-auditor` 실행 payload에는 planner/marketing/writer 결과가 모두 포함된다. Bridge는 Hermes CLI 응답에서 JSON object를 우선 추출하고, 파싱 실패 시 원문 fallback을 보존한다.

비용 가드레일은 파이프라인 시작 전에 남은 Hermes 실행 가능 횟수가 4회 이상인지 확인한다. `mock`과 `hermes-dry-run`은 실제 Hermes Bridge를 호출하지 않으므로 이 제한에서 제외된다.

보안 원칙은 변하지 않는다.

- Hermes dashboard cookie 재사용/우회 금지
- 외부 공개 endpoint로 Bridge 노출 금지
- Docker socket mount 금지
- 실제 Hermes smoke run은 사용자 승인 후 수동 1회만 실행


## Phase 1-C.12 Bridge regression coverage

Hermes Bridge? ?? OpenAI/Hermes ?? ?? ?? ??? Python unittest ?? ???? ???. ? ???? ??? ????? ???.

```bash
python3 -B -m unittest services/hermes-bridge/test_server.py
```

??? ??:

- JSON stdout, markdown code fence JSON, ?? ???? ?? JSON object ??
- ?? ?? ???? `fallback_text` ??
- `content-planner` ?? ??? ??
- `marketing-manager` ?? ??? ??
- `agentId`? schema ??: content ??? marketing schema?, marketing ??? content schema? ??? ??
- Bridge error response shape? secret masking
- timeout/error ??? `ok=false`, `provider=hermes-bridge`, `agentId`, `errorCode`, `errorMessage` ??
- allowlist: `content-planner/content_planning`, `marketing-manager/marketing_review`, `content-writer/content_writing`, `qa-auditor/qa_review`? ??
- usage guardrail contract: ?? `runnerMode=hermes` content pipeline AgentRun? ????? ?????? 2? ?? ?? ??? ??

??:

- `scripts/check-hermes-bridge.sh` ?? ??? health? ????.
- ?? Hermes smoke run? ??? ??? ? ???? `RUN_BRIDGE_SMOKE=1`? ???? ??? ?? ??? ????.
- ???? ?? ????? OpenAI API? ???? ???.

## Phase 1-C.13: qa-auditor Bridge execution

The content pipeline now supports a three-step Hermes Bridge sequence:

1. `content-planner` with `taskType=content_draft`
2. `marketing-manager` with `taskType=marketing_review`
3. `qa-auditor` with `taskType=qa_review`

The Bridge allowlist is intentionally strict and validates both `agentId` and `taskType`. A QA request must include the planner result and marketing result so the auditor can review factual consistency, quality, style, risk, required revisions, publish readiness, and final recommendation.

The Director step remains approval-only inside BG Company. It does not call Hermes and does not publish externally.

Real Hermes execution can cost money. Phase 1-C.13 treats one full Hermes content pipeline as up to three Bridge calls. Smoke runs are manual only and should never be part of automated lint/build/deploy checks.

