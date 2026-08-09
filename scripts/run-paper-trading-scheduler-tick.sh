#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/paper-trading-scheduler.log"
LOCK_FILE="/tmp/bg-company-paper-trading-scheduler.lock"
BASE_URL="${BG_COMPANY_BASE_URL:-https://bgcompanyoffice.cloud}"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then exit 0; fi

cd "$ROOT_DIR"
AGENT_API_KEY="$(sed -n 's/^AGENT_API_KEY=//p' .env | tail -n 1)"
AGENT_API_KEY="${AGENT_API_KEY%\"}"
AGENT_API_KEY="${AGENT_API_KEY#\"}"
if [[ -z "$AGENT_API_KEY" ]]; then
  printf '[%s] AGENT_API_KEY is missing\n' "$(date --iso-8601=seconds)" >>"$LOG_FILE"
  exit 1
fi

{
  printf '[%s] automatic paper trading tick start\n' "$(date --iso-8601=seconds)"
  curl --fail --silent --show-error --max-time 900 -X POST "$BASE_URL/api/portfolio/paper/scheduler" -H "x-bg-agent-key: $AGENT_API_KEY"
  printf '\n[%s] automatic paper trading tick complete\n' "$(date --iso-8601=seconds)"
} >>"$LOG_FILE" 2>&1

