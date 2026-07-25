#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env file not found at $ROOT_DIR/.env" >&2
  exit 1
fi

mkdir -p logs

CRON_SCHEDULE="${PORTFOLIO_ACCOUNT_AUTO_SYNC_SYSTEM_CRON:-30,40 8 * * *}"
CRON_MARKER="BG_COMPANY_PORTFOLIO_DAILY_SYNC"
CRON_COMMAND="/usr/bin/env bash \"$ROOT_DIR/scripts/run-portfolio-daily-sync-tick.sh\" # $CRON_MARKER"
CRON_LINE="$CRON_SCHEDULE $CRON_COMMAND"

echo "Installing BG Company portfolio daily sync cron..."
echo "Timezone: Asia/Seoul"
echo "Schedule: $CRON_SCHEDULE (08:30 run, 08:40 retry tick)"

(crontab -l 2>/dev/null | grep -Fv "$CRON_MARKER"; echo "CRON_TZ=Asia/Seoul"; echo "$CRON_LINE") \
  | awk '!seen[$0]++' \
  | crontab -

echo "Installed cron entry:"
crontab -l | grep -F "$CRON_MARKER" || true
echo
echo "The endpoint remains a no-op while PORTFOLIO_ACCOUNT_AUTO_SYNC_ENABLED=false."
echo "Log file: $ROOT_DIR/logs/portfolio-daily-sync.log"
