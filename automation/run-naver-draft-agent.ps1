$ErrorActionPreference = "Stop"

$agentDir = "C:\bg-company\naver-draft-agent-windows"
if (-not (Test-Path -LiteralPath $agentDir)) {
  throw "Windows Naver Draft Agent directory was not found."
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$logDir = Join-Path $agentDir "logs"
$logFile = Join-Path $logDir "naver-draft-agent.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location -LiteralPath $agentDir

"[$(Get-Date -Format o)] regular agent started" | Add-Content -LiteralPath $logFile
& $npm run start *>> $logFile
$exitCode = $LASTEXITCODE
"[$(Get-Date -Format o)] regular agent exited with code $exitCode" | Add-Content -LiteralPath $logFile
exit $exitCode
