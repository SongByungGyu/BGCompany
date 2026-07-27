# BG Company Operations Runbook

## Stock reference preflight

Before enabling the production stock scheduler, verify only the presence of the variables below. Do not print their values.

```bash
for key in REFERENCE_SEARCH_ENABLE_REAL_API NAVER_SEARCH_CLIENT_ID NAVER_SEARCH_CLIENT_SECRET STOCK_MARKET_DATA_PROVIDER; do
  if grep -q "^${key}=..*" .env; then echo "${key}=set"; else echo "${key}=missing"; fi
done
```

Keep these safety settings until a manual end-to-end review is complete:

```text
STOCK_BLOG_SCHEDULER_ENABLED=false
STOCK_BLOG_SCHEDULER_AUTO_APPROVE=false
STOCK_BLOG_SCHEDULER_AUTO_CREATE_DRAFT=false
STOCK_BLOG_SCHEDULER_AUTO_PUBLISH=false
NAVER_ALLOW_DRAFT_SAVE=false
NAVER_ALLOW_IMAGE_UPLOAD=false
NAVER_ALLOW_PUBLISH=false
```

`needs_credentials`, `needs_reference`, and `needs_data` are expected safe-stop states. Do not bypass them by raising the Hermes limit or inserting fabricated references. Generated SVG assets are stored in the `bg_company_generated_stock_blog` Docker volume. A local Naver agent `readability_failed` result means the pasted editor text must be inspected before retrying.

## Naver thumbnail upload and Windows auto-start

The Local Naver Draft Agent can attach generated BG Market Note images and save a draft. Publishing is disabled by default and requires both `NAVER_ALLOW_PUBLISH=true` in the Windows agent and `allowPublish=true` in the claimed job.

Safety boundaries:

- Only image URLs on `BG_COMPANY_BASE_URL` are accepted.
- Only `/generated/stock-blog/` paths are accepted.
- Allowed formats are SVG, PNG, JPEG, and WebP with a 12 MB limit.
- SVG is rendered to a local `1200x675` PNG by Playwright before upload.
- If download, conversion, editor attachment, or attachment verification fails, draft saving stops with `NAVER_THUMBNAIL_UPLOAD_FAILED`.
- The server performs a final duplicate/canary check immediately before a publish click.
- Login, security verification, CAPTCHA, image, draft-save, or publish failures activate the runtime publish circuit breaker for the first canary and are never retried automatically.

After updating and browser-testing the Windows agent, enable image metadata on the VPS:

```text
NAVER_ALLOW_IMAGE_UPLOAD=true
```

Register the local agent for the current Windows user at logon:

```powershell
Set-Location "C:\bg-company\naver-draft-agent-windows"
powershell -ExecutionPolicy Bypass -File ".\windows\register-startup-task.ps1"
Get-ScheduledTask -TaskName "BGCompany-NaverDraftAgent"
```

The task runs hidden after interactive Windows logon. The persistent Naver browser profile remains local. Login, CAPTCHA, and security verification are never bypassed. Agent logs are written to `logs/naver-draft-agent.log`; `.env`, `.naver-profile`, `logs`, `drafts`, and downloaded image files must not be committed.

## 서비스 상태 확인

```bash
cd /opt/bg-company
docker compose ps
docker ps
```

정상 기준:

- `bg-company-web`: `Up`, `healthy`
- `bg-company-postgres`: `Up`, `healthy`
- `traefik-traefik-1`: `Up`

## 포트와 방화벽 확인

```bash
sudo ss -tulpn | grep -E '80|443|3000|5432'
sudo ufw status numbered
```

정상 기준:

- `80`, `443`: Traefik이 listen
- `5432`: `127.0.0.1:5432`만 listen
- `3000`: 외부 직접 listen 없음
- UFW: OpenSSH, 80/tcp, 443/tcp만 허용

## 로그 확인

```bash
cd /opt/bg-company
docker logs --tail=100 bg-company-web
docker logs --tail=100 bg-company-postgres
docker logs --tail=100 traefik-traefik-1
```

실시간 로그:

```bash
docker logs -f bg-company-web
```

## 컨테이너 재시작

```bash
cd /opt/bg-company
docker compose restart web
docker compose restart postgres
```

전체 compose 재적용:

```bash
docker compose up -d
```

운영 DB volume 삭제 위험이 있으므로 `docker compose down -v`는 사용하지 않습니다.

## DB 상태 확인

```bash
cd /opt/bg-company
docker compose ps postgres
docker inspect bg-company-postgres --format '{{json .State.Health}}'
```

DB 접속 확인:

```bash
set -a
. ./.env
set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c 'select now();'
```

## API 상태 확인

운영 헬스체크는 공개 API인 `/api/health`를 우선 사용합니다. 관리자 데이터 API는 로그인 세션이 없으면 `401`이 정상입니다.

```bash
curl -I https://bgcompanyoffice.cloud
curl https://bgcompanyoffice.cloud/api/health
```

관리자 세션이 필요한 API:

- `/api/employees`
- `/api/tasks`
- `/api/approvals`
- `/api/content-pipelines`
- `/api/content-pipelines/[pipelineId]`
- `/api/timelines`
- `/api/events`
- `/api/hermes/status`

비로그인 상태에서 보호 API를 직접 호출하면 JSON `401 Unauthorized`가 정상입니다.

```bash
curl -i https://bgcompanyoffice.cloud/api/tasks
```

공개 API:

- `/api/auth/login`
- `/api/auth/logout`
- `/api/auth/session`
- `/api/health`

## Agent API 인증 확인

인증 없는 요청은 `401 Unauthorized`가 정상입니다.

```bash
curl -i -X POST https://bgcompanyoffice.cloud/api/agent-events \
  -H "Content-Type: application/json" \
  -d '{
    "source": "manual",
    "eventType": "EmployeeStatusChanged",
    "employeeId": "content-planner",
    "payload": {
      "status": "회의 중",
      "summary": "인증 없는 요청 테스트"
    }
  }'
```

인증 포함 테스트는 서버의 `.env` 값을 사용하되 key 원문을 출력하지 않습니다.

```bash
set -a
. ./.env
set +a
curl -i -X POST https://bgcompanyoffice.cloud/api/agent-events \
  -H "Content-Type: application/json" \
  -H "x-bg-agent-key: $AGENT_API_KEY" \
  -d '{
    "source": "manual",
    "eventType": "EmployeeStatusChanged",
    "employeeId": "content-planner",
    "payload": {
      "status": "회의 중",
      "summary": "운영 인증 요청 테스트"
    }
  }'
```

## Hermes 상태 확인

```bash
curl https://bgcompanyoffice.cloud/api/hermes/status
```

현재 Hermes가 실제 연결되지 않은 경우 `runnerMode: mock`, `available: false`가 정상입니다.


## 관리자 로그인/API 보호 정책

BG Company 운영 화면은 관리자 로그인 후 접근합니다.

- 페이지 접근: 비로그인 사용자는 `/login`으로 이동
- 관리자 API: 로그인 세션 cookie 필요, 실패 시 JSON `401`
- Agent API: `x-bg-agent-key` 필요
- AgentRun API: 관리자 세션 또는 `x-bg-agent-key` 허용

Agent key 전용 API:

- `/api/agent-events`

관리자 세션 또는 Agent key 허용 API:

- `/api/agent-runs`
- `/api/agent-runs/[runId]`

secret 관리 주의:

- `ADMIN_PASSWORD`, `AUTH_SESSION_SECRET`, `AGENT_API_KEY`는 VPS `.env`에만 둡니다.
- secret 원문은 로그, 문서, 커밋에 남기지 않습니다.
- `.env`는 Git 추적 대상이 아니어야 합니다.



## Hermes Bridge 확인

콘텐츠 파이프라인의 `runner=hermes`는 `hermes-bridge` 내부 서비스가 Hermes CLI를 oneshot으로 실행합니다.

```bash
cd /opt/bg-company
docker compose ps hermes-bridge
bash scripts/check-hermes-bridge.sh
curl -s http://127.0.0.1:8787/health || true
```

운영 기본값:

- `HERMES_BRIDGE_PROVIDER=openai-api`
- `HERMES_BRIDGE_MODEL=gpt-5.4-mini`
- `OPENAI_API_KEY`는 VPS `.env`에만 저장

`HERMES_BRIDGE_EXECUTION_FAILED`가 발생하면 다음을 확인합니다.

1. bridge 컨테이너에 `OPENAI_API_KEY`가 주입되어 있는지 확인합니다. key 원문은 출력하지 않습니다.
2. bridge health의 provider/model 값이 의도와 맞는지 확인합니다.
3. Hermes dashboard에서 OpenAI 모델이 정상 응답하는지 확인합니다.
4. 비용이 발생할 수 있으므로 smoke test는 명시적으로만 실행합니다.

```bash
RUN_BRIDGE_SMOKE=1 bash scripts/check-hermes-bridge.sh
```

## 자주 발생하는 장애와 대응

### HTTPS 접속이 실패함

1. DNS가 VPS IP를 가리키는지 확인합니다.
2. Traefik 컨테이너가 실행 중인지 확인합니다.
3. 80/443 UFW 규칙이 열려 있는지 확인합니다.

```bash
dig +short bgcompanyoffice.cloud
docker ps | grep traefik
sudo ufw status numbered
```

### 앱은 뜨지만 API가 실패함

1. web 로그를 확인합니다.
2. postgres health를 확인합니다.
3. `.env`의 `DATABASE_URL` host/port가 올바른지 확인합니다. secret 값은 출력하지 않습니다.

```bash
docker logs --tail=100 bg-company-web
docker compose ps postgres
```

### DB 연결이 실패함

1. Postgres 컨테이너 health 확인
2. 5432가 localhost에만 바인딩되어 있는지 확인
3. Prisma schema 변경 여부 확인

```bash
docker compose ps
sudo ss -tulpn | grep 5432
```

### 배포 후 화면이 이전 버전처럼 보임

1. web 이미지 재빌드
2. web 컨테이너 재생성
3. 브라우저 캐시 새로고침

```bash
docker compose build web
docker compose up -d web
```

## 정기 백업 cron 확인

BG Company 운영 VPS는 매일 새벽 03:00에 PostgreSQL 백업을 실행하도록 구성합니다.

```bash
crontab -l
```

정상 cron:

```cron
0 3 * * * cd /opt/bg-company && bash scripts/backup-postgres.sh >> logs/backup-postgres.log 2>&1
```

백업 로그 확인:

```bash
cd /opt/bg-company
tail -n 50 logs/backup-postgres.log
```

백업 파일 확인:

```bash
ls -lh backups/
```

수동 백업:

```bash
bash scripts/backup-postgres.sh
```

보관 정책:

- 기본값: 최근 14일 백업 보관
- 삭제 대상: `backups/bg_company_*.sql`, `backups/bg_company_*.sql.gz`
- 보관 일수 조정: `RETENTION_DAYS=<days> bash scripts/backup-postgres.sh`

복구 전에는 반드시 현재 DB 백업을 먼저 생성합니다.



## Hermes content-planner staged integration

Phase 1-C supports three content pipeline runner modes:

- `mock`: existing mock content result.
- `hermes-dry-run`: generates and stores the Hermes request payload without calling Hermes.
- `hermes`: calls Hermes Bridge only for allowed content pipeline agents (`content-planner`, `marketing-manager`, `content-writer`, `qa-auditor`).

Required production variables:

```env
HERMES_BASE_URL=
HERMES_API_KEY=
HERMES_HEALTH_PATH=/health
HERMES_RUN_PATH=/api/runs
HERMES_TIMEOUT_MS=30000
```

Check status after login:

```bash
curl -i https://bgcompanyoffice.cloud/api/health
```

`/api/hermes/status` is protected by the admin session. Use the browser dashboard after login to inspect Hermes status, or test locally with an authenticated cookie.

If a Hermes content-planner run fails:

1. Open the content pipeline detail panel.
2. Check the `content-planner 실행 결과` card.
3. Review the AgentRun error and stored request payload.
4. Confirm the timeline includes an `ErrorOccurred` entry.
5. Fix `.env` or Hermes availability and retry with `hermes-dry-run` before `hermes`.


## Hermes Bridge 운영

Phase 1-C.7부터 `runnerMode=hermes`는 내부 `hermes-bridge` 서비스를 통해 `content-planner`만 Hermes CLI로 실행한다.

상태 확인:

```bash
docker compose ps hermes-bridge
bash scripts/check-hermes-bridge.sh
```

실제 호출 smoke test는 비용이 발생할 수 있으므로 필요할 때만 실행한다.

```bash
RUN_BRIDGE_SMOKE=1 bash scripts/check-hermes-bridge.sh
```

운영 반영:

```bash
docker compose build hermes-bridge web
docker compose up -d hermes-bridge web
bash scripts/check-production-health.sh
bash scripts/check-hermes-bridge.sh
```

주의:

- `hermes-bridge`에 public port나 Traefik route를 추가하지 않는다.
- `BRIDGE_API_KEY`는 `.env`에만 둔다.
- bridge 장애가 있어도 `mock`/`hermes-dry-run`으로 우회 가능하다.
- `docker compose down -v`는 절대 실행하지 않는다.

## Hermes Bridge 콘텐츠 실행 점검

콘텐츠 파이프라인 Runner 선택 기준:

- `mock`: 비용 없음. DB task/approval/timeline 흐름 검증용.
- `hermes-dry-run`: 비용 없음. Hermes 요청 payload 검증용.
- `hermes`: 실제 Hermes Bridge 호출. OpenAI API 비용이 발생할 수 있음.

운영에서 실제 Hermes 실행 전 확인:

```bash
bash scripts/check-hermes-bridge.sh
```

비용이 발생할 수 있는 smoke test는 명시적으로만 실행한다.

```bash
RUN_BRIDGE_SMOKE=1 bash scripts/check-hermes-bridge.sh
```

실패 결과 확인 순서:

1. 콘텐츠 파이프라인 상세의 `content-planner 실행 결과`에서 `errorCode`, `errorMessage`, `parseStatus` 확인
2. `Hermes Bridge request payload 보기` 확인
3. `raw/fallback text`가 있으면 원문 응답 확인
4. Bridge 컨테이너 로그 확인
5. OpenAI/Hermes provider 설정과 API key 상태 확인

보안 원칙:

- Bridge는 외부 공개하지 않는다.
- Browser login cookie를 재사용하지 않는다.
- API key 원문을 로그/문서/보고서에 출력하지 않는다.


## Hermes usage limit runbook

- Usage endpoint: `GET /api/hermes/usage` (admin session required)
- Default limit: 5 real Hermes content-planner attempts per KST day
- Counted: real `runnerMode=hermes` Bridge attempts, including success, failure, timeout, unauthorized, fallback text, and parse failures
- Not counted: `mock`, `hermes-dry-run`, user-cancelled confirmations, and validation failures before Hermes is called

If the UI shows `HERMES_DAILY_LIMIT_EXCEEDED`, wait for the next KST day or temporarily raise `HERMES_DAILY_RUN_LIMIT` in the server `.env`, then restart the web container. Do not run Bridge smoke tests automatically during deploy.


## Hermes production display troubleshooting

If a recent Hermes run appears as `10ms` or similarly tiny, check `agentRun.metadata.plannerResult.durationMs`. The UI/API uses that value first and falls back to AgentRun timestamp deltas only when metadata duration is unavailable.

If a content pipeline detail timeline shows repeated `ApprovalRequested` or `ApprovalResolved` items, do not delete database rows. The same event can legitimately be linked to task, approval, and employee timeline targets for audit purposes. The content pipeline detail view deduplicates the response by `eventId`.


## Hermes content pipeline runbook update

Phase 1-C.11 운영 기준에서 `runnerMode=hermes`는 콘텐츠 파이프라인당 최대 두 번 Hermes Bridge를 호출한다.

- 1차: `content-planner` 콘텐츠 기획
- 2차: `marketing-manager` 마케팅 검토
- QA/Director/게시 단계: Hermes 미사용

운영 확인 순서:

1. `/api/health`와 production health script가 정상인지 확인한다.
2. `scripts/check-hermes-bridge.sh`로 Bridge health를 확인한다.
3. UI에서 `runnerMode=mock` 또는 `hermes-dry-run`으로 회귀 테스트를 먼저 수행한다.
4. 실제 Hermes 실행은 비용이 발생하므로 사용자 승인 후 1회만 수동 실행한다.

문제 발생 시:

- `HERMES_DAILY_LIMIT_EXCEEDED`: 일일 Hermes 실행 제한 또는 남은 횟수 부족
- `HERMES_BRIDGE_EXECUTION_FAILED`: Bridge는 호출됐지만 Hermes CLI 실행/응답 처리 실패
- `HERMES_NOT_CONFIGURED`: BG Company web 컨테이너에 Hermes Bridge 환경변수 누락

Bridge allowlist는 `content-planner/content_planning`, `marketing-manager/marketing_review`, `content-writer/content_writing`, `qa-auditor/qa_review`만 허용한다. 임의 agent 실행, cookie 기반 dashboard 우회, Docker socket 접근은 허용하지 않는다.


## Hermes Bridge regression test runbook

Phase 1-C.12?? Bridge ??? ??? ?? ?? unittest? ?? ????.

```bash
python3 -B -m unittest services/hermes-bridge/test_server.py
```

? ???? ?? Hermes/OpenAI? ???? ?? ?? ??? ????.

- JSON/code fence/embedded JSON/fallback text parser
- content-planner? marketing-manager ??? schema ??
- error response shape? secret masking
- content-planner/content_planning, marketing-manager/marketing_review, content-writer/content_writing, qa-auditor/qa_review allowlist
- ?? `runnerMode=hermes` ??? usage? ?????, content pipeline?? ?? ?? ?? ?? 2?? ????? ??

?? health ??? ?? ?? ???? ??. ? ??? ????? smoke run? ?? ???.

```bash
bash scripts/check-hermes-bridge.sh
```

?? Bridge smoke run? ??? ??? ? ???? ??? ?? ? ????? ????.

```bash
RUN_BRIDGE_SMOKE=1 bash scripts/check-hermes-bridge.sh
```

## Phase 1-C.14 Hermes writer + QA run notes

A real Hermes content pipeline can now execute up to four paid Bridge calls: planner, marketing, writer, and QA. Before running `runnerMode=hermes`, confirm the daily Hermes usage guardrail has enough remaining allowance for all four calls.

Operational checks:

- `content-planner/content_planning`, `marketing-manager/marketing_review`, `content-writer/content_writing`, and `qa-auditor/qa_review` must be allowed by the Bridge.
- Writer failures should stop the QA Hermes call and remain visible in the content pipeline detail, related task, AgentRun result, and timeline.
- QA failures should be visible in the content pipeline detail, related task, AgentRun result, and timeline.
- `hermes-dry-run` remains the preferred no-cost validation path.
- Do not run Bridge smoke tests automatically during deploys.
- Do not expose Bridge keys, OpenAI keys, or `.env` contents in logs or reports.



## Naver Blog Publish Prep

Phase 1-C.15부터 승인 완료된 콘텐츠 파이프라인 상세 화면에서 `네이버 블로그 게시 준비` 패널을 확인한다.

운영 절차:

1. 콘텐츠 파이프라인을 `mock`, `hermes-dry-run`, 또는 승인된 경우에만 `hermes`로 실행한다.
2. Director 승인 요청을 승인한다.
3. 콘텐츠 상세의 `네이버 블로그 게시 준비` 패널에서 제목, 본문, 태그, 썸네일 문구, 이미지 프롬프트를 복사한다.
4. 네이버 블로그에 수동으로 붙여넣고 미리보기를 확인한다.
5. 투자 유의문구가 포함되어 있는지 확인한다.
6. 게시 후 URL을 화면에 임시 기록한다.

주의:

- 네이버 자동 로그인/자동 게시/쿠키 우회는 금지한다.
- 실제 시장 데이터 API가 연결되기 전까지 임의의 지수 수치나 종목 수익률을 생성하지 않는다.
- Hermes 실제 실행은 비용 가드레일과 사용자 승인 후 1회씩만 진행한다.

## Stock briefing publish prep check

Phase 1-C.16 adds stock-market briefing structure to the Naver Blog Publish Prep panel.

Check in the browser:

1. Log in as admin.
2. Open `콘텐츠`.
3. Select an approved pipeline or a pipeline with writer output.
4. Confirm the `네이버 블로그 게시 준비` panel shows:
   - title
   - intro
   - market summary
   - major index/sector flow
   - key points
   - investor checklist
   - closing comment
   - paste-ready body
   - Markdown
   - HTML
   - tags
   - category
   - thumbnail copy
   - image prompts
   - disclaimer
   - manual checklist
   - published URL input

Operational rules:

- Do not run `runnerMode=hermes` only to verify the UI.
- Use existing approved data, mock, or hermes-dry-run for UI checks.
- Do not call live stock APIs.
- Do not automate Naver login or publishing.
- Do not commit `.env` or print secrets.

## Naver Draft Agent 운영 메모

- 서버는 승인 완료 콘텐츠에서 `NaverDraftJob`을 생성한다.
- 로컬 PC의 `tools/naver-draft-agent`가 `x-naver-draft-agent-key`로 job을 polling/claim/status report 한다.
- 기본값은 dry-run이며, 네이버 자동 발행은 구현하지 않는다.
- 네이버 로그인, 2FA, captcha, 보안 확인은 반드시 사용자가 로컬 브라우저에서 직접 처리한다.
- 운영 DB 반영 전 백업 후 `npm --prefix apps/web run db:push`를 수동 실행한다.
- `docker compose down -v`, seed 재실행, `.env` 커밋은 금지한다.

## Phase 1-S.5 Reference Module Checks

Use these checks when validating stock briefing reference preparation.

```bash
npm --prefix apps/web run lint
npm --prefix apps/web run build
python3 -B -m py_compile services/hermes-bridge/server.py
python3 -B -m unittest services/hermes-bridge/test_server.py
docker compose config
docker compose ps
bash scripts/check-production-health.sh
bash scripts/check-hermes-bridge.sh
```

Do not run Hermes, OpenAI, Naver Search, stock APIs, Playwright/Selenium, or Naver automation for this verification unless the operator explicitly approves the specific paid/external action.


## Dashboard Summary / Stock Blog Team Operations

- 대표실의 오늘의 운영 브리핑은 `/api/dashboard-summary`에서 제공한다.
- 이 API는 관리자 세션이 필요하며, LLM/Hermes/OpenAI를 호출하지 않는다.
- 주식 블로그 운영은 주식 분석팀, 블로그 운영팀, QA/감사팀, 게시 운영팀 역할로 나뉜다.
- Hermes 일일 실행 기본 제안값은 20회이며, 4-Agent 파이프라인 1회는 최대 4회 실행을 사용한다.
- 네이버 블로그는 자동 발행하지 않고, Local Draft Agent로 임시저장 준비 후 사용자가 직접 발행한다.


## Stock Blog Scheduler 운영 메모

- `/api/stock-blog/scheduler`는 주식 블로그 자동 생성 tick endpoint다.
- `GET`은 관리자 세션이 필요하고, `POST`는 `x-bg-agent-key` 또는 관리자 세션이 필요하다.
- 기본값은 `STOCK_BLOG_SCHEDULER_ENABLED=false`이며, 자동 실행 전 반드시 운영자가 `.env`에서 명시적으로 켠다.
- `runnerMode=hermes`는 4-Agent 기준 콘텐츠 1건당 최대 4회 Hermes/OpenAI 호출을 사용할 수 있다.
- 스케줄러는 같은 스케줄 슬롯을 `EventLog` ID로 중복 방지한다.
- 자동 승인 후 `NaverDraftJob`만 생성하며, 네이버 자동 발행은 하지 않는다.
- Local Naver Draft Agent는 운영 PC에서 별도로 실행되어야 한다.
- 권장 cron은 10분마다 tick을 호출하는 방식이며, 실제 due 여부는 서버가 판단한다.
- cron 로그 예: `/opt/bg-company/logs/stock-blog-scheduler.log`

주의:

- `docker compose down -v`, DB 초기화, seed 재실행 금지.
- `.env`, `AGENT_API_KEY`, OpenAI key, Naver login 정보 출력 금지.
- Hermes/OpenAI 비용 확인 없이 `runnerMode=hermes` 자동화 금지.


### Stock Blog Scheduler cron 시작/확인

운영 서버에서 자동 tick cron을 설치한다.

```bash
cd /opt/bg-company
bash scripts/install-stock-blog-scheduler-cron.sh
crontab -l
```

상태 확인:

```bash
bash scripts/check-stock-blog-scheduler.sh
tail -n 80 logs/stock-blog-scheduler.log
```

실제 자동 실행은 `.env`에서 `STOCK_BLOG_SCHEDULER_ENABLED=true`일 때만 수행된다.
비용을 막아야 하면 `STOCK_BLOG_SCHEDULER_RUNNER_MODE=mock` 또는 `hermes-dry-run`을 사용한다.

## Stock Blog Thumbnail Automation

- 콘텐츠 파이프라인 승인 전/후 게시 준비 패널에서 썸네일 자동화 정보를 확인한다.
- 기본 검증은 mock 또는 hermes-dry-run으로 수행하며, 실제 이미지 생성이나 OpenAI/Hermes 추가 호출은 자동 실행하지 않는다.
- 네이버 자동 발행, 로그인 우회, VPS Playwright 실행은 금지한다.
- 썸네일 상태가 `copy_ready`이면 문구와 프롬프트가 수동 작업 가능한 상태다.
- `thumbnailImageUrl`은 실제 이미지 생성/저장 기능이 별도 승인되어 붙기 전까지 비어 있을 수 있다.
- 운영 중 문제가 있으면 콘텐츠 상세 화면의 썸네일 프롬프트를 복사해 수동 이미지 생성 도구에서 사용한다.

## Stock Blog Quality Gate

주식 블로그 자동 스케줄러는 `runnerMode=hermes`에서도 실참조/본문 품질 게이트를 통과해야 자동 승인과 네이버 임시저장 작업을 생성한다.

- mock 또는 real-disabled 참고자료는 운영 참고자료로 인정하지 않는다.
- 실제 URL 3개 이상, 발행처 2곳 이상, publishedAt/summary가 필요하다.
- 최종 본문에는 이미지 프롬프트를 섞지 않는다.
- 실패 시 `needs_reference`, `needs_data`, `readability_failed`, `duplicate_content_failed`, `image_pending`, `quality_failed` 중 하나로 차단한다.
- 운영 기본값은 `STOCK_BLOG_SCHEDULER_AUTO_APPROVE=false`, `STOCK_BLOG_SCHEDULER_AUTO_CREATE_DRAFT=false`를 권장한다.


## Stock Reference Provider

Hermes 주식 블로그 운영은 `STOCK_REFERENCE_PROVIDER=manual`을 권장한다. `mock` 또는 `real-disabled` 참고자료는 실제 Hermes 운영 결과로 인정하지 않으며, 품질 게이트가 `needs_reference`로 차단한다.

확인 항목:

- `.env`에 `STOCK_REFERENCE_PROVIDER=manual` 설정
- `STOCK_REFERENCE_MANUAL_PATH` 또는 `STOCK_REFERENCE_MANUAL_JSON` 설정
- 참고자료 3개 이상, URL 3개 이상, 발행처 2곳 이상
- `market_data` 또는 `reliability=official` 참고자료 1개 이상

문제 발생 시:

- 콘텐츠 상세의 `관련 기사 / 참고자료` 패널에서 품질 게이트 사유 확인
- 부족한 참고자료 항목(`missingItems`) 확인
- mock/dry-run으로 UI만 확인하고 실제 Hermes 반복 실행은 금지
# Automatic MarketSnapshot 점검

운영 주식 브리핑은 KIS 조회 API를 필수로 사용한다. FRED가 정상이면 FRED 데이터를 우선 사용하고, FRED만 실패한 경우에는 아래 제한 운영 정책에 따라 공식 미국 데이터 제공처로 보완한다.

```bash
docker compose exec -T web sh -lc '
for key in KIS_APP_KEY KIS_APP_SECRET FRED_API_KEY; do
  if [ -n "$(printenv "$key")" ]; then echo "$key=set"; else echo "$key=missing"; fi
done
echo "STOCK_MARKET_DATA_PROVIDER=$(printenv STOCK_MARKET_DATA_PROVIDER)"
echo "STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK=$(printenv STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK)"
echo "STOCK_MARKET_DATA_ALLOW_FRED_DEGRADED=$(printenv STOCK_MARKET_DATA_ALLOW_FRED_DEGRADED)"
echo "STOCK_MARKET_DATA_ALLOW_KIS_SECTOR_DEGRADED=$(printenv STOCK_MARKET_DATA_ALLOW_KIS_SECTOR_DEGRADED)"
echo "STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES=$(printenv STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES)"
'
```

secret 원문, 요청 header, provider 전체 응답은 출력하지 않는다. 정상 운영값은 다음과 같다.

```text
STOCK_MARKET_DATA_PROVIDER=kis-fred
STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK=false
STOCK_MARKET_DATA_ALLOW_FRED_DEGRADED=true
STOCK_MARKET_DATA_ALLOW_KIS_SECTOR_DEGRADED=true
STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES=false
```

KIS 업종 순위만 비어 있고 나머지 KIS 핵심 지표와 FRED 자료가 모두 최신·정상인 경우에는 강세·약세 업종 항목을 제외하고 제한 운영한다. 본문에는 KIS 업종 자료 누락 사실을 자동으로 고지하며, 업종 데이터는 추정하거나 다른 수치로 채우지 않는다. 이 제한 운영은 `STOCK_MARKET_DATA_ALLOW_KIS_SECTOR_DEGRADED=false`로 비활성화할 수 있다.

그 외 `needs_credentials`, `needs_data`, `error`, stale/expired가 발생하면 mock 또는 Manual로 자동 대체하지 않는다. scheduler와 실제 Hermes를 중지한 상태에서 자격증명, provider 상태, 기준 시각을 확인한다. KIS 주문·잔고·계좌 API는 점검 목적으로도 호출하지 않는다.

KIS 읽기 전용 조회의 일시적 `429`, `500`, `502`, `503`, `504` 응답은 `KIS_MAX_RETRIES`(기본 2회)와 `KIS_RETRY_BASE_DELAY_MS`(기본 500ms)에 따라 제한적으로 재시도한다. 재시도 횟수를 2보다 높이지 말고, 반복 실패 시 scheduler와 Hermes를 계속 중지한 채 provider 상태를 확인한다.
## FRED 장애 시 주식 브리핑 제한 운영

FRED 조회가 실패하면 먼저 기존 공식 미국 데이터 제공처(Treasury, BLS, BEA, Federal Reserve)로 보완합니다. 보완 후에도 미국 국채금리 또는 경제지표 일정이 일부 누락된 경우에는 아래 조건을 모두 만족할 때만 제한 운영을 허용할 수 있습니다.

- `STOCK_MARKET_DATA_ALLOW_FRED_DEGRADED`가 `false`가 아님(미설정 또는 `true`가 기본 허용)
- KIS 조회 상태가 `ready`이고 freshness가 `fresh`
- 오래되거나 누락된 KIS 항목이 없음
- Treasury/BLS 등 공식 미국 보완 출처가 최소 1개 이상 확보됨
- 실제 Naver 뉴스와 경쟁 블로그 참고자료 품질 게이트 통과
- FRED 실패 원인이 인증, timeout, network, rate limit, HTTP 5xx 또는 BLS 캘린더의 서버 요청 제한(HTTP 403)

FRED 인증 실패는 공식 미국 보완 출처가 실제로 확보된 경우에만 제한 운영으로 전환합니다. 공식 보완 출처가 하나도 없거나 파싱 오류, 잘못된 요청, 알 수 없는 오류가 발생하면 계속 차단합니다. 누락된 미국 수치는 추정하거나 mock으로 채우지 않고 본문에서 제외합니다. 제한 운영 본문과 네이버 임시저장 원고에는 다음 문구가 정확히 포함되어야 합니다.

```text
FRED 거시지표 조회 지연으로 미국 국채금리 또는 경제지표 일정 일부를 이번 브리핑에서 제외했습니다.
```

QA 품질 게이트까지 통과한 경우에만 기존 스케줄러가 자동 승인과 Naver Draft Job 생성을 진행합니다. 로컬 Naver Draft Agent는 큐를 가져와 임시저장까지만 수행하며 최종 발행은 사용자가 직접 진행합니다.
