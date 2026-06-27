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

```bash
curl -I https://bgcompanyoffice.cloud
curl https://bgcompanyoffice.cloud/api/employees
curl https://bgcompanyoffice.cloud/api/tasks
curl https://bgcompanyoffice.cloud/api/approvals
curl https://bgcompanyoffice.cloud/api/events
curl https://bgcompanyoffice.cloud/api/timelines
curl https://bgcompanyoffice.cloud/api/hermes/status
```

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
