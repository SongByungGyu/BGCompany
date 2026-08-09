#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ ! -f .env ]]; then echo "ERROR: .env file not found at $ROOT_DIR/.env" >&2; exit 1; fi

mkdir -p logs
CRON_SCHEDULE="${PAPER_AUTO_SCHEDULER_SYSTEM_CRON:-20,35 7 * * *}"
CRON_MARKER="BG_COMPANY_PAPER_TRADING_AUTOMATION"
CRON_COMMAND="/usr/bin/env bash \"$ROOT_DIR/scripts/run-paper-trading-scheduler-tick.sh\" # $CRON_MARKER"
CRON_LINE="$CRON_SCHEDULE $CRON_COMMAND"

(crontab -l 2>/dev/null | grep -Fv "$CRON_MARKER"; echo "CRON_TZ=Asia/Seoul"; echo "$CRON_LINE") | awk '!seen[$0]++' | crontab -
echo "Installed automatic paper trading cron:"
crontab -l | grep -F "$CRON_MARKER" || true
echo "Log file: $ROOT_DIR/logs/paper-trading-scheduler.log"

