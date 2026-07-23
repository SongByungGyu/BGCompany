#!/usr/bin/env bash
set -Eeuo pipefail

AGENT_DIR="/home/songbyunggyu/projects/bg-company/tools/naver-draft-agent"
LOG_DIR="$AGENT_DIR/logs"
LOG_FILE="$LOG_DIR/naver-draft-agent.log"
LOCK_FILE="/tmp/bg-company-naver-draft-agent.lock"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cd "$AGENT_DIR"
printf '[%s] Naver Draft Agent supervisor started.\n' "$(date --iso-8601=seconds)" >>"$LOG_FILE"

while true; do
  set +e
  npm run start >>"$LOG_FILE" 2>&1
  exit_code=$?
  set -e
  printf '[%s] Agent exited with code %s; restarting in 10 seconds.\n' \
    "$(date --iso-8601=seconds)" "$exit_code" >>"$LOG_FILE"
  sleep 10
done
