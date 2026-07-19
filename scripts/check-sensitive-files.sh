#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

pattern='(^|/)\.env($|\.)|(^|/)(secrets|credentials|\.private|\.auth|token-cache|\.tokens|\.kis-token-cache|\.fred-cache|\.naver-auth|\.openai-cache|\.naver-profile|drafts|logs)/|\.(secret|secrets|credentials|token|tokens|pem|key|p12|pfx|jks|keystore|log)$|(^|/)api-response[^/]*$'
allowed='(^|/)\.env(\.[^/]*)?\.example$|(^|/)\.env\.example$'

mapfile -t matches < <(git ls-files | grep -Ei "$pattern" | grep -Eiv "$allowed" || true)
if (( ${#matches[@]} > 0 )); then
  printf '%s\n' "Sensitive/runtime paths are tracked:" >&2
  printf ' - %s\n' "${matches[@]}" >&2
  exit 1
fi

printf '%s\n' "Sensitive file path check: OK"
