#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/stock-blog-scheduler.log"
LOCK_FILE="/tmp/bg-company-stock-blog-scheduler.lock"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cd "$ROOT_DIR"
set -a
. ./.env
set +a
BASE_URL="${BG_COMPANY_BASE_URL:-http://127.0.0.1:3000}"

{
  printf '[%s] scheduler tick start\n' "$(date --iso-8601=seconds)"
  curl --fail --silent --show-error --max-time 900 \
    -X POST "$BASE_URL/api/stock-blog/scheduler" \
    -H "x-bg-agent-key: $AGENT_API_KEY"
  printf '\n[%s] scheduler tick complete\n' "$(date --iso-8601=seconds)"
} >>"$LOG_FILE" 2>&1
