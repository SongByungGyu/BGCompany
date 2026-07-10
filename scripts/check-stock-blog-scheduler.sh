#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BG_COMPANY_BASE_URL:-https://bgcompanyoffice.cloud}"

echo "BG Company Stock Blog Scheduler"
echo "Base URL: $BASE_URL"

STATUS_CODE="$(curl -sS -o /tmp/bg-stock-blog-scheduler.json -w "%{http_code}" "$BASE_URL/api/stock-blog/scheduler" || true)"
if [[ "$STATUS_CODE" == "200" ]]; then
  echo "- Scheduler API: OK (HTTP 200)"
  cat /tmp/bg-stock-blog-scheduler.json
  echo
else
  echo "- Scheduler API: HTTP $STATUS_CODE"
  echo "  Admin login cookie may be required for GET. Cron POST uses x-bg-agent-key."
fi

if crontab -l 2>/dev/null | grep -q "BG_COMPANY_STOCK_BLOG_SCHEDULER"; then
  echo "- Cron: installed"
  crontab -l | grep "BG_COMPANY_STOCK_BLOG_SCHEDULER"
else
  echo "- Cron: not installed"
fi
