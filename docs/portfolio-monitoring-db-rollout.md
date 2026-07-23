# Phase 2-P.1 데이터베이스 반영 절차

현재 저장소는 Prisma migration 이력을 사용하지 않고 `db push` 방식으로 운영되어 `apps/web/prisma/migrations` 기준선이 없습니다. 이번 변경만 단독 migration으로 추가하면 기존 운영 테이블을 재생성하려는 잘못된 이력이 될 수 있으므로 초기 반영은 아래 순서를 권장합니다.

1. 기능 브랜치 코드를 운영 서버에 반영하기 전에 `scripts/backup-postgres.sh`로 PostgreSQL 백업을 생성한다.
2. 백업 파일 크기가 0보다 크고 복구 가능한 위치에 있는지 확인한다.
3. `prisma migrate diff --from-config-datasource --to-schema apps/web/prisma/schema.prisma --script`로 운영 DB와 신규 schema의 SQL diff를 검토한다.
4. 기존 `Employee`, `Task`, `ApprovalRequest`, `EventLog`, `Timeline`, `AgentRun`, `NaverDraftJob`에 대한 `DROP`, `ALTER DROP`, 데이터 삭제가 없는지 확인한다.
5. 검토가 끝난 뒤에만 `npm --prefix apps/web run db:push`로 신규 Portfolio 테이블을 추가한다.
6. 기존 데이터 건수와 자동발행 관련 테이블을 다시 확인한다.
7. 기능 플래그는 `PORTFOLIO_MONITORING_ENABLED=false`로 유지한다.

사용자 데이터 초기화, 전체 seed 재실행, `docker compose down -v`, 볼륨 삭제는 금지합니다. migration 체계로 전환하려면 현재 운영 DB를 기준으로 별도 baseline migration을 먼저 생성해야 합니다.
