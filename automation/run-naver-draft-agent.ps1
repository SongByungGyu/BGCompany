$ErrorActionPreference = "Stop"

$agentDir = "C:\bg-company\naver-draft-agent-windows"
if (-not (Test-Path -LiteralPath $agentDir)) {
  throw "Windows Naver Draft Agent directory was not found."
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$logDir = Join-Path $agentDir "logs"
$logFile = Join-Path $logDir "naver-draft-agent-utf8.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location -LiteralPath $agentDir

"[$(Get-Date -Format o)] regular agent started" | Out-File -LiteralPath $logFile -Append -Encoding utf8
& $npm run start 2>&1 | Out-File -LiteralPath $logFile -Append -Encoding utf8
$exitCode = $LASTEXITCODE
"[$(Get-Date -Format o)] regular agent exited with code $exitCode" | Out-File -LiteralPath $logFile -Append -Encoding utf8
exit $exitCode
