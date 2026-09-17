param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$WslDistribution = "Ubuntu-D",
  [string]$VpsHost = "root@72.60.108.42",
  [ValidateRange(1024, 65535)][int]$BridgePort = 43928
)

$ErrorActionPreference = "Stop"
$resolvedAgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path
$envFile = Join-Path $resolvedAgentRoot ".env"
$bridgeEntry = Join-Path $resolvedAgentRoot "dist\codex-content-index.js"
$logDir = Join-Path $resolvedAgentRoot "logs"
if (-not (Test-Path -LiteralPath $envFile)) { throw ".env not found: $envFile" }
if (-not (Test-Path -LiteralPath $bridgeEntry)) { throw "Codex bridge entry not found: $bridgeEntry" }
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Get-DotEnvValue {
  param([string]$Name)
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(?<value>.*)\s*$") {
      return $Matches.value.Trim().Trim('"').Trim("'")
    }
  }
  return ""
}

function Write-SupervisorLog {
  param([string]$Message)
  "[$(Get-Date -Format o)] $Message" | Add-Content -LiteralPath (Join-Path $logDir "codex-content-supervisor.log") -Encoding utf8
}

function Resolve-Executable {
  param(
    [string]$Name,
    [string[]]$FallbackPaths
  )
  $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }
  foreach ($candidatePath in $FallbackPaths) {
    $candidate = Get-ChildItem -Path $candidatePath -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  throw "Executable not found: $Name"
}

function Test-BridgeHealth {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BridgePort/health" -TimeoutSec 3
    return $health.ok -eq $true -and $health.model -eq "gpt-5.6-sol"
  } catch {
    return $false
  }
}

$sharedKey = Get-DotEnvValue -Name "CODEX_QA_AGENT_KEY"
if (-not $sharedKey) { $sharedKey = Get-DotEnvValue -Name "NAVER_DRAFT_AGENT_KEY" }
if (-not $sharedKey) { throw "CODEX_QA_AGENT_KEY or NAVER_DRAFT_AGENT_KEY is required." }
try {
  $nodeExecutable = Resolve-Executable -Name "node.exe" -FallbackPaths @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  )
  $codexExecutable = Resolve-Executable -Name "codex.exe" -FallbackPaths @(
    (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin\*\codex.exe")
  )
  $wslExecutable = Resolve-Executable -Name "wsl.exe" -FallbackPaths @(
    (Join-Path $env:SystemRoot "System32\wsl.exe")
  )
} catch {
  Write-SupervisorLog "Codex supervisor startup failed: $($_.Exception.Message)"
  throw
}

$env:CODEX_QA_AGENT_KEY = $sharedKey
$env:CODEX_QA_MODEL = "gpt-5.6-sol"
$env:CODEX_QA_CODEX_COMMAND = $codexExecutable
$env:CODEX_CONTENT_BRIDGE_HOST = "0.0.0.0"
$env:CODEX_CONTENT_BRIDGE_PORT = [string]$BridgePort

while ($true) {
  $bridgeProcess = $null
  $tunnelProcess = $null
  try {
    if (-not (Test-BridgeHealth)) {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $bridgeProcess = Start-Process -FilePath $nodeExecutable `
        -ArgumentList @("`"$bridgeEntry`"") `
        -WorkingDirectory $resolvedAgentRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "codex-content-$stamp.stdout.log") `
        -RedirectStandardError (Join-Path $logDir "codex-content-$stamp.stderr.log") `
        -PassThru
      for ($attempt = 0; $attempt -lt 30 -and -not (Test-BridgeHealth); $attempt += 1) {
        if ($bridgeProcess.HasExited) { throw "Codex bridge exited with code $($bridgeProcess.ExitCode)." }
        Start-Sleep -Seconds 1
      }
      if (-not (Test-BridgeHealth)) { throw "Codex bridge health check timed out." }
      Write-SupervisorLog "Codex bridge started. pid=$($bridgeProcess.Id) port=$BridgePort"
    }

    $windowsGateway = (& $wslExecutable -d $WslDistribution bash -lc "ip route show default | head -n1 | cut -d' ' -f3").Trim()
    if ($windowsGateway -notmatch '^\d{1,3}(?:\.\d{1,3}){3}$') { throw "Could not resolve the Windows gateway from WSL." }
    $reverseForward = "127.0.0.1:${BridgePort}:${windowsGateway}:${BridgePort}"
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $tunnelProcess = Start-Process -FilePath $wslExecutable `
      -ArgumentList @(
        "-d", $WslDistribution, "--", "ssh", "-N", "-T",
        "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
        "-o", "StrictHostKeyChecking=yes", "-R", $reverseForward, $VpsHost
      ) `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logDir "codex-tunnel-$stamp.stdout.log") `
      -RedirectStandardError (Join-Path $logDir "codex-tunnel-$stamp.stderr.log") `
      -PassThru
    Start-Sleep -Seconds 3
    if ($tunnelProcess.HasExited) { throw "Codex reverse tunnel exited with code $($tunnelProcess.ExitCode)." }
    Write-SupervisorLog "Codex reverse tunnel started. pid=$($tunnelProcess.Id) remote=$VpsHost"

    while (-not $tunnelProcess.HasExited -and (Test-BridgeHealth)) {
      Start-Sleep -Seconds 15
      $tunnelProcess.Refresh()
      if ($bridgeProcess) { $bridgeProcess.Refresh() }
    }
  } catch {
    Write-SupervisorLog "Codex supervisor retry: $($_.Exception.Message)"
  } finally {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) { Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Seconds 10
}
