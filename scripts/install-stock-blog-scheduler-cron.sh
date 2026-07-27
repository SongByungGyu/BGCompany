#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env file not found at $ROOT_DIR/.env" >&2
  exit 1
fi

mkdir -p logs

CRON_SCHEDULE="${STOCK_BLOG_SCHEDULER_CRON:-*/10 * * * *}"
CRON_MARKER="BG_COMPANY_STOCK_BLOG_SCHEDULER"
CRON_COMMAND="/usr/bin/env bash \"$ROOT_DIR/scripts/run-stock-blog-scheduler-tick.sh\" # $CRON_MARKER"
CRON_LINE="$CRON_SCHEDULE $CRON_COMMAND"

echo "Installing BG Company stock blog scheduler cron..."
echo "Schedule: $CRON_SCHEDULE"
echo "Runner: $ROOT_DIR/scripts/run-stock-blog-scheduler-tick.sh"

(crontab -l 2>/dev/null | grep -Fv "$CRON_MARKER"; echo "$CRON_LINE") | crontab -

echo "Installed cron entry:"
crontab -l | grep -F "$CRON_MARKER" || true
echo
echo "Note: The endpoint only runs when STOCK_BLOG_SCHEDULER_ENABLED=true in .env."
echo "Log file: $ROOT_DIR/logs/stock-blog-scheduler.log"
