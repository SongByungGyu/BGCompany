# BG Company Backup and Restore

## 백업 원칙

- PostgreSQL 데이터는 Docker volume에 저장됩니다.
- 백업 파일은 repository root의 `backups/` 디렉터리에 저장합니다.
- `backups/`와 `*.sql` 파일은 Git에 포함하지 않습니다.
- DB 비밀번호와 API key가 포함된 `.env` 파일은 Git에 포함하지 않습니다.
- 운영에서 `docker compose down -v`를 실행하지 않습니다. 이 명령은 DB volume을 삭제할 수 있습니다.

## PostgreSQL 백업

VPS에서 실행합니다.

```bash
cd /opt/bg-company
bash scripts/backup-postgres.sh
ls -lh backups/
```

백업 파일 예시:

```text
backups/bg_company_2026-06-27_231500.sql
```

스크립트는 `.env`의 `POSTGRES_USER`, `POSTGRES_DB` 값을 사용하며 DB 비밀번호를 하드코딩하지 않습니다.

## 수동 백업 명령

필요 시 아래 명령으로 직접 백업할 수 있습니다.

```bash
cd /opt/bg-company
set -a
. ./.env
set +a
mkdir -p backups
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "backups/${POSTGRES_DB}_$(date +%Y-%m-%d_%H%M%S).sql"
```

## 복구 전 경고

```text
복구 전 반드시 현재 DB 백업을 먼저 생성한다.
복구 작업은 기존 데이터를 덮어쓸 수 있으므로 운영 중에는 신중히 진행한다.
```

## PostgreSQL 복구 절차

1. 현재 DB를 먼저 백업합니다.

```bash
cd /opt/bg-company
bash scripts/backup-postgres.sh
```

2. 복구할 SQL 파일을 확인합니다.

```bash
ls -lh backups/
```

3. `.env` 값을 로드한 뒤 SQL을 주입합니다.

```bash
set -a
. ./.env
set +a
cat backups/<backup-file>.sql | docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

4. 앱과 API를 확인합니다.

```bash
curl https://bgcompanyoffice.cloud/api/employees
curl https://bgcompanyoffice.cloud/api/tasks
curl https://bgcompanyoffice.cloud/api/approvals
```

## 주의사항

- 복구 작업은 운영 데이터를 덮어쓸 수 있습니다.
- 복구 전후로 백업 파일 이름과 대상 DB를 반드시 확인합니다.
- `.env`, 백업 SQL, dump 파일은 외부에 공유하지 않습니다.
- 자동 복구 스크립트는 아직 제공하지 않습니다. 복구는 수동 확인 후 진행합니다.

## 자동 백업 cron

운영 VPS에서는 매일 새벽 03:00에 PostgreSQL 백업을 실행합니다.

```cron
0 3 * * * cd /opt/bg-company && bash scripts/backup-postgres.sh >> logs/backup-postgres.log 2>&1
```

백업 위치:

```text
/opt/bg-company/backups/
```

로그 위치:

```text
/opt/bg-company/logs/backup-postgres.log
```

cron 확인:

```bash
crontab -l
```

수동으로 cron과 동일한 명령을 테스트할 수 있습니다.

```bash
cd /opt/bg-company
mkdir -p logs
bash scripts/backup-postgres.sh >> logs/backup-postgres.log 2>&1
tail -n 50 logs/backup-postgres.log
ls -lh backups/
```

## 백업 보관 정책

기본 보관 기간은 14일입니다.

```bash
RETENTION_DAYS=14 bash scripts/backup-postgres.sh
```

`RETENTION_DAYS` 값을 지정하지 않으면 기본값 14일이 사용됩니다.

삭제 대상은 아래 패턴으로 제한됩니다.

```text
backups/bg_company_*.sql
backups/bg_company_*.sql.gz
```

백업 생성에 실패하면 오래된 백업 삭제 단계까지 진행되지 않습니다.

