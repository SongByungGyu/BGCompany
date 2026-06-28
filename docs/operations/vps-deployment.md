# BG Company VPS Deployment

## 운영 환경

- Provider: Hostinger VPS
- OS: Ubuntu 24.04
- Runtime: Docker Compose
- Reverse proxy: Hostinger 기본 Traefik
- 공식 도메인: `https://bgcompanyoffice.cloud`
- 애플리케이션: Next.js web container
- 데이터베이스: PostgreSQL Docker container

## 배포 구조

```text
User
→ https://bgcompanyoffice.cloud
→ Traefik (:80/:443, HTTPS)
→ bg-company-web container (:3000 internal)
→ bg-company-postgres container (host 127.0.0.1:5432)
```

주요 서비스:

- `bg-company-web`: Next.js 앱 컨테이너
- `bg-company-postgres`: PostgreSQL 17 컨테이너
- `traefik-traefik-1`: Hostinger 기본 reverse proxy

## 배포 절차

VPS에서 실행합니다.

```bash
cd /opt/bg-company
git pull --ff-only origin main
docker compose build web
docker compose up -d
docker compose ps
```

DB schema 변경이 있는 배포에서만 수동으로 실행합니다.

```bash
npm --prefix apps/web run db:generate
npm --prefix apps/web run db:push
```

Seed는 최초 구축 또는 명시적으로 Mock 데이터를 초기화해야 할 때만 수동 실행합니다.

```bash
npm --prefix apps/web run db:seed
```

운영 DB에 seed를 재실행하면 기존 데이터가 변경될 수 있으므로 신중히 진행합니다.

## 배포 후 검증

관리자 API는 로그인 세션이 필요하므로 배포 자동 검증은 공개 health endpoint를 사용합니다.

```bash
docker compose ps
curl -I https://bgcompanyoffice.cloud
curl https://bgcompanyoffice.cloud/api/health
bash scripts/check-production-health.sh
```

비로그인 상태에서 보호 API가 `401`을 반환하는지도 확인합니다.

```bash
curl -i https://bgcompanyoffice.cloud/api/tasks
```

포트 상태도 확인합니다.

```bash
sudo ss -tulpn | grep -E '80|443|3000|5432'
sudo ufw status numbered
```

정상 기준:

- `80`, `443`: Traefik이 외부 요청 처리
- `3000`: 외부 직접 노출 없음
- `5432`: `127.0.0.1:5432`에만 바인딩
- UFW: SSH, 80, 443만 허용

## Rollback 기본 절차

1. 현재 상태와 로그를 먼저 확인합니다.

```bash
cd /opt/bg-company
git log -5 --oneline
docker compose ps
docker logs --tail=100 bg-company-web
```

2. 문제가 된 커밋 직전의 정상 커밋으로 되돌립니다.

```bash
git checkout <known-good-commit>
docker compose build web
docker compose up -d
```

3. 앱과 공개 health API를 다시 확인합니다.

```bash
curl -I https://bgcompanyoffice.cloud
curl https://bgcompanyoffice.cloud/api/health
```

주의:

- DB volume을 삭제하지 않습니다.
- `docker compose down -v`는 운영에서 사용하지 않습니다.
- DB schema 변경이 포함된 장애는 백업/복구 절차를 먼저 검토합니다.


## 운영 인증 설정

운영 화면은 관리자 로그인으로 보호합니다. VPS의 `/opt/bg-company/.env`에만 실제 값을 설정합니다.

```env
ADMIN_PASSWORD=<운영 관리자 비밀번호>
AUTH_SESSION_SECRET=<openssl rand -base64 48 결과>
```

API 보호 정책:

- 관리자 세션 필요: `/api/employees`, `/api/tasks`, `/api/approvals`, `/api/content-pipelines`, `/api/timelines`, `/api/events`, `/api/hermes/status`
- Agent key 필요: `/api/agent-events`
- 관리자 세션 또는 Agent key: `/api/agent-runs`
- 공개: `/api/auth/*`, `/api/health`

secret 원문은 로그나 문서에 남기지 않습니다.
