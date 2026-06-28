#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BG_COMPANY_BASE_URL:-https://bgcompanyoffice.cloud}"

echo "Deploying BG Company to VPS..."
git pull --ff-only origin main

echo "Building web container..."
docker compose build web

echo "Starting containers..."
docker compose up -d
docker compose ps

echo "Checking public health API..."
curl -fsS "$BASE_URL/api/health" >/dev/null

cat <<'MESSAGE'
Deployment completed successfully.

Note:
- DB migration/db push is not run automatically.
- Seed is not run automatically.
- If schema changed, run the DB commands manually after reviewing the release notes.
MESSAGE
