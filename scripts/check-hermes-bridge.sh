#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

failures=0

echo "BG Company Hermes Bridge Health"

state="$(docker inspect -f '{{.State.Status}}' bg-company-hermes-bridge 2>/dev/null || true)"
if [[ "$state" == "running" ]]; then
  echo "- Docker hermes-bridge: running"
else
  echo "- Docker hermes-bridge: FAIL (${state:-not-found})"
  failures=$((failures + 1))
fi

health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' bg-company-hermes-bridge 2>/dev/null || true)"
if [[ "$health" == "healthy" ]]; then
  echo "- Hermes bridge container health: healthy"
else
  echo "- Hermes bridge container health: FAIL (${health:-not-found})"
  failures=$((failures + 1))
fi

if docker compose exec -T web node -e "fetch((process.env.HERMES_BRIDGE_BASE_URL || 'http://hermes-bridge:8787') + '/health').then(async (r) => { if (!r.ok) process.exit(1); const body = await r.json(); if (!body.ok) process.exit(1); }).catch(() => process.exit(1))" >/dev/null 2>&1; then
  echo "- Bridge health from web network: OK"
else
  echo "- Bridge health from web network: FAIL"
  failures=$((failures + 1))
fi

if [[ "${RUN_BRIDGE_SMOKE:-0}" == "1" ]]; then
  echo "- Bridge smoke run: requested"
  if docker compose exec -T web node <<'NODE'
const baseUrl = process.env.HERMES_BRIDGE_BASE_URL || 'http://hermes-bridge:8787';
const key = process.env.BRIDGE_API_KEY || process.env.HERMES_BRIDGE_API_KEY;
if (!key) process.exit(2);
const payload = {
  agentId: 'content-planner',
  role: 'content_planner',
  taskType: 'content_planning',
  input: { topic: 'BG Company bridge smoke test', title: 'Bridge smoke', channel: 'blog', language: 'ko' },
  context: { company: 'BG Company', workflow: 'content_pipeline', runnerMode: 'hermes' },
};
const response = await fetch(baseUrl + '/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-bridge-api-key': key },
  body: JSON.stringify(payload),
});
const body = await response.json().catch(() => null);
if (!response.ok || !body?.ok) process.exit(1);
NODE
  then
    echo "- Bridge smoke run: OK"
  else
    echo "- Bridge smoke run: FAIL"
    failures=$((failures + 1))
  fi
else
  echo "- Bridge smoke run: skipped (set RUN_BRIDGE_SMOKE=1 to run a real Hermes call)"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "Hermes bridge health: FAIL ($failures issue(s))"
  exit 1
fi

echo "Hermes bridge health: OK"
