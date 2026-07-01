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
OPENAI_API_KEY=
```

`OPENAI_API_KEY`는 bridge 컨테이너 안의 Hermes CLI가 provider 인증을 필요로 할 때만 설정한다. 이미 Hermes image 내부 config가 provider를 인식하는 환경이면 별도 설정 없이 동작할 수 있다.

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
