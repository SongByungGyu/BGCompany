#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BG_COMPANY_BASE_URL:-https://bgcompanyoffice.cloud}"

echo "BG Company Production Health"
echo "Base URL: $BASE_URL"

failures=0

check_http_head() {
  local label="$1"
  local url="$2"
  local status

  status="$(curl -k -sS -o /dev/null -w '%{http_code}' -I "$url" || true)"
  if [[ "$status" =~ ^2|3 ]]; then
    echo "- $label: OK (HTTP $status)"
  else
    echo "- $label: FAIL (HTTP ${status:-curl-error})"
    failures=$((failures + 1))
  fi
}

check_http_json() {
  local label="$1"
  local url="$2"
  local tmp
  local status
  local size

  tmp="$(mktemp)"
  status="$(curl -k -sS -o "$tmp" -w '%{http_code}' "$url" || true)"
  size="$(wc -c < "$tmp" | tr -d ' ')"
  rm -f "$tmp"

  if [[ "$status" =~ ^2 ]] && [[ "$size" -gt 0 ]]; then
    echo "- $label: OK (HTTP $status, ${size} bytes)"
  else
    echo "- $label: FAIL (HTTP ${status:-curl-error}, ${size} bytes)"
    failures=$((failures + 1))
  fi
}

check_container_running() {
  local label="$1"
  local container="$2"
  local state

  state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
  if [[ "$state" == "running" ]]; then
    echo "- $label: running"
  else
    echo "- $label: FAIL (${state:-not-found})"
    failures=$((failures + 1))
  fi
}

check_container_health() {
  local label="$1"
  local container="$2"
  local health

  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
  if [[ "$health" == "healthy" ]]; then
    echo "- $label: healthy"
  else
    echo "- $label: FAIL (${health:-not-found})"
    failures=$((failures + 1))
  fi
}

check_http_head "Web" "$BASE_URL"
check_http_json "Employees API" "$BASE_URL/api/employees"
check_http_json "Tasks API" "$BASE_URL/api/tasks"
check_http_json "Approvals API" "$BASE_URL/api/approvals"
check_http_json "Hermes Status" "$BASE_URL/api/hermes/status"

check_container_running "Docker web" "bg-company-web"
check_container_running "Docker postgres" "bg-company-postgres"
check_container_health "Postgres health" "bg-company-postgres"

if [[ "$failures" -gt 0 ]]; then
  echo "Production health: FAIL ($failures issue(s))"
  exit 1
fi

echo "Production health: OK"
