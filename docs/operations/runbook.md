# BG Company Operations Runbook

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
- `hermes`: calls Hermes only for `content-planner`.

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
