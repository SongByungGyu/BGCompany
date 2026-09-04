param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [ValidateRange(10, 300)]
  [int]$HeartbeatSeconds = 30
)

$ErrorActionPreference = "Stop"
$resolvedAgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path.TrimEnd("\")
$packageJson = Join-Path $resolvedAgentRoot "package.json"
$envFile = Join-Path $resolvedAgentRoot ".env"
$runtimeAudit = Join-Path $resolvedAgentRoot "windows\audit-runtime-drift.ps1"
if (-not (Test-Path -LiteralPath $packageJson)) { throw "package.json not found: $packageJson" }
if (-not (Test-Path -LiteralPath $envFile)) { throw ".env not found: $envFile" }
if (-not (Test-Path -LiteralPath $runtimeAudit)) { throw "runtime audit not found: $runtimeAudit" }

function Get-DotEnvValue {
  param([string]$Path, [string]$Name)
  foreach ($line in Get-Content -LiteralPath $Path -ErrorAction Stop) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(?<value>.*)\s*$") {
      return $Matches.value.Trim().Trim('"').Trim("'")
    }
  }
  return ""
}
$configuredPort = Get-DotEnvValue -Path $envFile -Name "NAVER_AGENT_SINGLETON_PORT"
$parsedPort = 0
$agentSingletonPort = if ([int]::TryParse($configuredPort, [ref]$parsedPort) -and $parsedPort -ge 1024 -and $parsedPort -le 65535) { $parsedPort } else { 43923 }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$runtimeIdentity = & $runtimeAudit -AgentRoot $resolvedAgentRoot
$agentBuildSha = [string]$runtimeIdentity.BuildSha
$runtimeSha256 = [string]$runtimeIdentity.RuntimeSha256

$logDir = Join-Path $resolvedAgentRoot "logs"
$supervisorLog = Join-Path $logDir "naver-draft-agent-supervisor.log"
$heartbeatFile = Join-Path $logDir "naver-draft-agent-heartbeat.json"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-SupervisorLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  try {
    "[$(Get-Date -Format o)] $Message" | Add-Content -LiteralPath $supervisorLog -Encoding utf8 -ErrorAction Stop
  } catch {
    [Console]::Error.WriteLine("[naver-supervisor] log write failed: $($_.Exception.Message)")
  }
}

function Write-AgentHeartbeat {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Nullable[int]]$ChildProcessId = $null,
    [Nullable[int]]$ExitCode = $null,
    [string]$Detail = ""
  )
  try {
    $temporaryHeartbeat = "$heartbeatFile.$PID.tmp"
    $payload = [ordered]@{
      timestamp = (Get-Date).ToUniversalTime().ToString("o")
      status = $Status
      agentRoot = $resolvedAgentRoot
      singletonPort = $agentSingletonPort
      buildSha = $agentBuildSha
      runtimeSha256 = $runtimeSha256
      supervisorProcessId = $PID
      childProcessId = $ChildProcessId
      exitCode = $ExitCode
      detail = $Detail
    }
    $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporaryHeartbeat -Encoding utf8 -ErrorAction Stop
    Move-Item -LiteralPath $temporaryHeartbeat -Destination $heartbeatFile -Force -ErrorAction Stop
  } catch {
    Write-SupervisorLog "Heartbeat write warning: $($_.Exception.Message)"
  }
}

function Wait-WithHeartbeat {
  param([int]$Seconds, [string]$Status)
  $remainingSeconds = $Seconds
  while ($remainingSeconds -gt 0) {
    Write-AgentHeartbeat -Status $Status -Detail "Retrying in ${remainingSeconds}s."
    $sleepSeconds = [Math]::Min($HeartbeatSeconds, $remainingSeconds)
    Start-Sleep -Seconds $sleepSeconds
    $remainingSeconds -= $sleepSeconds
  }
}

function Get-SingletonListenerState {
  $connections = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $agentSingletonPort -State Listen -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) { return "absent" }
  foreach ($connection in $connections) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$connection.OwningProcess)" -ErrorAction SilentlyContinue
    $commandLine = [string]$owner.CommandLine
    $ownsExpectedRoot = $commandLine.IndexOf($resolvedAgentRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $isAgentEntry = $commandLine -match '(?:dist[/\\]index\.js|src[/\\]index\.ts)'
    if ($ownsExpectedRoot -and $isAgentEntry) { return "owned" }
  }
  return "foreign"
}

$rootHashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
try {
  $rootHash = ([BitConverter]::ToString($rootHashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($resolvedAgentRoot.ToLowerInvariant())))).Replace("-", "").Substring(0, 24)
} finally {
  $rootHashAlgorithm.Dispose()
}
$mutexName = "Local\BGCompany.NaverDraftAgent.$rootHash"
$supervisorMutex = [Threading.Mutex]::new($false, $mutexName)
$mutexAcquired = $false
try {
  $mutexAcquired = $supervisorMutex.WaitOne(0)
  if (-not $mutexAcquired) {
    Write-SupervisorLog "Supervisor already owns mutex $mutexName for $resolvedAgentRoot."
    exit 0
  }

  Set-Location -LiteralPath $resolvedAgentRoot
  Write-SupervisorLog "BG Company Naver Draft Agent supervisor started. root=$resolvedAgentRoot port=$agentSingletonPort build=$agentBuildSha"
  Write-AgentHeartbeat -Status "supervisor_started"
  $restartDelaySeconds = 10

  while ($true) {
    try {
      $listenerState = Get-SingletonListenerState
      if ($listenerState -eq "owned") {
        Write-AgentHeartbeat -Status "agent_already_running" -Detail "Singleton listener is healthy."
        $restartDelaySeconds = 10
        Start-Sleep -Seconds ([Math]::Min($HeartbeatSeconds, 15))
        continue
      }
      if ($listenerState -eq "foreign") {
        Write-AgentHeartbeat -Status "singleton_port_conflict" -Detail "The configured port belongs to a process outside AgentRoot."
        Write-SupervisorLog "Singleton port $agentSingletonPort is owned by an unrelated process; refusing to launch."
        Start-Sleep -Seconds ([Math]::Min($HeartbeatSeconds, 15))
        continue
      }

      $runStamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
      $stdoutLog = Join-Path $logDir "naver-draft-agent-$runStamp.stdout.log"
      $stderrLog = Join-Path $logDir "naver-draft-agent-$runStamp.stderr.log"
      $startedAt = Get-Date
      $agentProcess = Start-Process -FilePath $npm -ArgumentList @("run", "start") -WorkingDirectory $resolvedAgentRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
      Write-SupervisorLog "Agent process $($agentProcess.Id) started. stdout=$stdoutLog stderr=$stderrLog"
      while (-not $agentProcess.HasExited) {
        Write-AgentHeartbeat -Status "agent_running" -ChildProcessId $agentProcess.Id
        Start-Sleep -Seconds $HeartbeatSeconds
        $agentProcess.Refresh()
      }

      $exitCode = $agentProcess.ExitCode
      $runtimeSeconds = [Math]::Max(0, [int]((Get-Date) - $startedAt).TotalSeconds)
      if ($runtimeSeconds -ge 300) { $restartDelaySeconds = 10 }
      Write-SupervisorLog "Agent process $($agentProcess.Id) exited with code $exitCode after ${runtimeSeconds}s. Restarting in ${restartDelaySeconds}s."
      Write-AgentHeartbeat -Status "restart_wait" -ChildProcessId $agentProcess.Id -ExitCode $exitCode -Detail "Restarting in ${restartDelaySeconds}s."
    } catch {
      Write-SupervisorLog "Agent supervisor error: $($_.Exception.Message)"
      Write-AgentHeartbeat -Status "supervisor_error" -Detail $_.Exception.Message
    }
    Wait-WithHeartbeat -Seconds $restartDelaySeconds -Status "restart_wait"
    $restartDelaySeconds = [Math]::Min($restartDelaySeconds * 2, 300)
  }
} finally {
  if ($mutexAcquired) { $supervisorMutex.ReleaseMutex() }
  $supervisorMutex.Dispose()
}
