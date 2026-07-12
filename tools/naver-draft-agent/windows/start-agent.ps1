param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$packageJson = Join-Path $AgentRoot "package.json"
$envFile = Join-Path $AgentRoot ".env"
if (-not (Test-Path -LiteralPath $packageJson)) { throw "package.json not found: $packageJson" }
if (-not (Test-Path -LiteralPath $envFile)) { throw ".env not found: $envFile" }

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$logDir = Join-Path $AgentRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir "naver-draft-agent.log"

Set-Location -LiteralPath $AgentRoot
"[$(Get-Date -Format o)] BG Company Naver Draft Agent supervisor started." | Add-Content -LiteralPath $logFile

while ($true) {
  try {
    & $npm run start *>> $logFile
    $exitCode = $LASTEXITCODE
    "[$(Get-Date -Format o)] Agent exited with code $exitCode. Restarting in 10 seconds." | Add-Content -LiteralPath $logFile
  } catch {
    "[$(Get-Date -Format o)] Agent supervisor error: $($_.Exception.Message)" | Add-Content -LiteralPath $logFile
  }
  Start-Sleep -Seconds 10
}
