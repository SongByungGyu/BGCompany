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

read_dotenv_value() {
  local target="$1"
  local line
  local value

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" == "$target="* ]] || continue
    value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    printf '%s' "$value"
    return 0
  done < "$ROOT_DIR/.env"

  return 1
}

AGENT_API_KEY="${AGENT_API_KEY:-$(read_dotenv_value AGENT_API_KEY || true)}"
if [[ -z "$AGENT_API_KEY" ]]; then
  echo "AGENT_API_KEY is missing." >&2
  exit 1
fi
BASE_URL="${BG_COMPANY_BASE_URL:-https://bgcompanyoffice.cloud}"

{
  printf '[%s] scheduler tick start\n' "$(date --iso-8601=seconds)"
  curl --fail --silent --show-error --max-time 900 \
    -X POST "$BASE_URL/api/stock-blog/scheduler" \
    -H "x-bg-agent-key: $AGENT_API_KEY"
  printf '\n[%s] scheduler tick complete\n' "$(date --iso-8601=seconds)"
} >>"$LOG_FILE" 2>&1
