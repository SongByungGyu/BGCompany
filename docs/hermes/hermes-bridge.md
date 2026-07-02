# Hermes Bridge Service

## 목적

`hermes-bridge`는 BG Company Phase 1-C.7에서 `content-planner`만 실제 Hermes CLI로 실행하기 위한 내부 전용 서비스다. Hermes dashboard의 로그인 cookie를 재사용하지 않고, `hermes -z` oneshot 경로만 제한적으로 감싼다.

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
- allowlist: `agentId=content-planner`, `taskType=content_planning`
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
