$ErrorActionPreference = "Stop"

$root = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw "Git repository root was not found." }
Set-Location $root

$pattern = '(^|/)\.env($|\.)|(^|/)(secrets|credentials|\.private|\.auth|token-cache|\.tokens|\.kis-token-cache|\.fred-cache|\.naver-auth|\.openai-cache|\.naver-profile|drafts|logs)/|\.(secret|secrets|credentials|token|tokens|pem|key|p12|pfx|jks|keystore|log)$|(^|/)api-response[^/]*$'
$allowed = '(^|/)\.env(\.[^/]*)?\.example$|(^|/)\.env\.example$'
$matches = @(git ls-files | Where-Object { $_ -match $pattern -and $_ -notmatch $allowed })

if ($matches.Count -gt 0) {
  Write-Error ("Sensitive/runtime paths are tracked:`n - " + ($matches -join "`n - "))
  exit 1
}

Write-Output "Sensitive file path check: OK"
