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
$browserProfileDir = [System.IO.Path]::GetFullPath((Join-Path $AgentRoot ".naver-profile")).TrimEnd("\")

function Write-AgentLog {
  param([string]$Message)
  $Message | Out-File -LiteralPath $logFile -Encoding utf8 -Append
}

function Stop-StaleNaverProfileBrowsers {
  param([string]$ProfileDir)
  try {
    $targets = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction Stop |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine.IndexOf("--user-data-dir", [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine.IndexOf($ProfileDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      }
    if (-not $targets) { return }
    $targetIds = @($targets | Select-Object -ExpandProperty ProcessId -Unique)
    Write-AgentLog "[$(Get-Date -Format o)] Closing stale Naver profile browser processes: $($targetIds -join ',')."
    foreach ($targetId in $targetIds) {
      Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
  } catch {
    Write-AgentLog "[$(Get-Date -Format o)] Stale Naver profile browser cleanup warning: $($_.Exception.Message)"
  }
}

Set-Location -LiteralPath $AgentRoot
Write-AgentLog "[$(Get-Date -Format o)] BG Company Naver Draft Agent supervisor started."

while ($true) {
  try {
    $agentAlreadyRunning = [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $agentSingletonPort -State Listen -ErrorAction SilentlyContinue)
    if ($agentAlreadyRunning) {
      Start-Sleep -Seconds 15
      continue
    }
    Stop-StaleNaverProfileBrowsers -ProfileDir $browserProfileDir
    & $node $compiledAgent 2>&1 | Out-File -LiteralPath $logFile -Encoding utf8 -Append
    $exitCode = $LASTEXITCODE
    Write-AgentLog "[$(Get-Date -Format o)] Agent exited with code $exitCode. Restarting in 10 seconds."
  } catch {
    Write-AgentLog "[$(Get-Date -Format o)] Agent supervisor error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 10
}
