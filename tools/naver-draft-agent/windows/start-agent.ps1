param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$packageJson = Join-Path $AgentRoot "package.json"
$envFile = Join-Path $AgentRoot ".env"
if (-not (Test-Path -LiteralPath $packageJson)) { throw "package.json not found: $packageJson" }
if (-not (Test-Path -LiteralPath $envFile)) { throw ".env not found: $envFile" }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$compiledAgent = Join-Path $AgentRoot "dist\index.js"
if (-not (Test-Path -LiteralPath $compiledAgent)) { throw "Compiled agent not found: $compiledAgent. Run npm run build first." }
$agentSingletonPort = 43923
$logDir = Join-Path $AgentRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir "naver-draft-agent.log"

Set-Location -LiteralPath $AgentRoot
"[$(Get-Date -Format o)] BG Company Naver Draft Agent supervisor started." | Add-Content -LiteralPath $logFile

while ($true) {
  try {
    $agentAlreadyRunning = [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $agentSingletonPort -State Listen -ErrorAction SilentlyContinue)
    if ($agentAlreadyRunning) {
      Start-Sleep -Seconds 15
      continue
    }
    & $node $compiledAgent *>> $logFile
    $exitCode = $LASTEXITCODE
    "[$(Get-Date -Format o)] Agent exited with code $exitCode. Restarting in 10 seconds." | Add-Content -LiteralPath $logFile
  } catch {
    "[$(Get-Date -Format o)] Agent supervisor error: $($_.Exception.Message)" | Add-Content -LiteralPath $logFile
  }
  Start-Sleep -Seconds 10
}
