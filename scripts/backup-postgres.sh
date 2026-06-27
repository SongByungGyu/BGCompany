#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env file not found at $ROOT_DIR/.env" >&2
  exit 1
fi

set -a
. ./.env
set +a

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"

BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.sql"
TMP_FILE="$BACKUP_FILE.tmp"

mkdir -p "$BACKUP_DIR"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

echo "Creating PostgreSQL backup..."
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$TMP_FILE"
mv "$TMP_FILE" "$BACKUP_FILE"
trap - EXIT

echo "Backup completed: $ROOT_DIR/$BACKUP_FILE"

echo "Removing ${POSTGRES_DB} backups older than ${RETENTION_DAYS} day(s)..."
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name "${POSTGRES_DB}_*.sql" -o -name "${POSTGRES_DB}_*.sql.gz" \) \
  -mtime +"$RETENTION_DAYS" \
  -print \
  -delete
echo "Backup retention cleanup completed."
