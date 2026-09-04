param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [string]$TaskName = "BGCompany-NaverDraftAgent",
  [ValidateRange(30, 300)][int]$HealthTimeoutSeconds = 120,
  [switch]$ConfirmLegacyNoPublishing,
  [switch]$Activate
)

$ErrorActionPreference = "Stop"
$resolvedSource = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd("\")
$installFull = [IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")
$installParent = Split-Path -Parent $installFull

function Assert-SafeRuntimePath {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path -eq [IO.Path]::GetPathRoot($Path)) {
    throw "Unsafe ${Label}: $Path"
  }
}

Assert-SafeRuntimePath -Path $installFull -Label "InstallRoot"
if (-not (Test-Path -LiteralPath $installParent -PathType Container)) {
  throw "Install parent not found: $installParent"
}

function Move-RuntimeDirectoryWithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [ValidateRange(5, 120)][int]$TimeoutSeconds = 45
  )
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastError = ""
  do {
    try {
      Move-Item -LiteralPath $Source -Destination $Destination -ErrorAction Stop
      return
    } catch {
      $lastError = $_.Exception.Message
      if ([DateTimeOffset]::UtcNow -ge $deadline) { break }
      Start-Sleep -Milliseconds 500
    }
  } while ($true)
  throw "Timed out moving runtime directory from $Source to $Destination. $lastError"
}

if ($resolvedSource -eq $installFull -or
    $installFull.StartsWith("$resolvedSource\", [StringComparison]::OrdinalIgnoreCase) -or
    $resolvedSource.StartsWith("$installFull\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "SourceRoot and InstallRoot must be separate, non-overlapping directories."
}
if ((Test-Path -LiteralPath $installFull) -and
    ((Get-Item -LiteralPath $installFull -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "InstallRoot must not be a reparse point: $installFull"
}

$sourceAudit = Join-Path $resolvedSource "windows\audit-runtime-drift.ps1"
$sourceAcl = Join-Path $resolvedSource "windows\protect-env-acl.ps1"
if (-not (Test-Path -LiteralPath $sourceAudit -PathType Leaf)) { throw "Runtime audit not found in source package." }
if (-not (Test-Path -LiteralPath $sourceAcl -PathType Leaf)) { throw "Runtime ACL script not found in source package." }
$sourceIdentity = & $sourceAudit -AgentRoot $resolvedSource

function Get-DotEnvValue {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Name)
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction Stop) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(?<value>.*)\s*$") {
      return $Matches.value.Trim().Trim('"').Trim("'")
    }
  }
  return ""
}

function Resolve-RuntimeFile {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value,
    [Parameter(Mandatory = $true)][string]$DefaultRelative,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $candidate = if ($Value.Trim()) { $Value.Trim() } else { $DefaultRelative }
  $fullPath = if ([IO.Path]::IsPathRooted($candidate)) {
    [IO.Path]::GetFullPath($candidate)
  } else {
    [IO.Path]::GetFullPath((Join-Path $Root $candidate))
  }
  if (-not $fullPath.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must remain inside AgentRoot: $fullPath"
  }
  return $fullPath
}

function Read-JsonRecord {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Invalid JSON record: $Path"
  }
}

function Set-DeploymentHold {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporaryPath = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporaryPath, $Message, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Assert-FreshIdentityRecord {
  param(
    [Parameter(Mandatory = $true)][object]$Record,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ExpectedRoot,
    [Parameter(Mandatory = $true)][int]$ExpectedPort,
    [string]$ExpectedBuild = "",
    [int]$MaximumAgeSeconds = 90,
    [DateTimeOffset]$NotBefore = [DateTimeOffset]::MinValue
  )
  $recordRoot = [IO.Path]::GetFullPath([string]$Record.agentRoot).TrimEnd("\")
  if (-not $recordRoot.Equals($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label AgentRoot mismatch: $recordRoot"
  }
  if ([int]$Record.singletonPort -ne $ExpectedPort) {
    throw "$Label singleton port mismatch."
  }
  if ($ExpectedBuild -and -not ([string]$Record.buildSha).Equals($ExpectedBuild, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label build SHA mismatch."
  }
  $timestamp = [DateTimeOffset]::Parse([string]$Record.timestamp).ToUniversalTime()
  $now = [DateTimeOffset]::UtcNow
  $ageSeconds = ($now - $timestamp).TotalSeconds
  if ($ageSeconds -lt -120 -or $ageSeconds -gt $MaximumAgeSeconds) {
    throw "$Label is stale or has an invalid clock: $timestamp"
  }
  if ($timestamp -lt $NotBefore.ToUniversalTime()) {
    throw "$Label predates this activation attempt: $timestamp"
  }
  return $timestamp
}

function Get-AgentPort {
  param([Parameter(Mandatory = $true)][string]$EnvFile)
  $configured = Get-DotEnvValue -Path $EnvFile -Name "NAVER_AGENT_SINGLETON_PORT"
  $parsed = 0
  if ([int]::TryParse($configured, [ref]$parsed) -and $parsed -ge 1024 -and $parsed -le 65535) {
    return $parsed
  }
  return 43923
}

function Assert-RemoteRuntimeIdle {
  param([Parameter(Mandatory = $true)][string]$EnvFile)
  $baseUrl = (Get-DotEnvValue -Path $EnvFile -Name "BG_COMPANY_BASE_URL").TrimEnd("/")
  $agentKey = Get-DotEnvValue -Path $EnvFile -Name "NAVER_DRAFT_AGENT_KEY"
  $uri = $null
  if (-not [Uri]::TryCreate($baseUrl, [UriKind]::Absolute, [ref]$uri) -or
      $uri.Scheme -notin @("http", "https") -or -not $uri.Host) {
    throw "BG_COMPANY_BASE_URL is missing or invalid in $EnvFile"
  }
  if (-not $agentKey -or $agentKey -eq "change_me") {
    throw "NAVER_DRAFT_AGENT_KEY is missing in $EnvFile"
  }
  try {
    $response = Invoke-RestMethod `
      -Method Get `
      -Uri "$baseUrl/api/local-agents/naver-drafts/runtime-status" `
      -Headers @{ "x-naver-draft-agent-key" = $agentKey } `
      -TimeoutSec 20
  } catch {
    throw "Unable to verify the server-side Naver publishing state; installation is fail-closed. $($_.Exception.Message)"
  }
  if (-not $response.ok -or $null -eq $response.runtime) {
    throw "The server did not return a valid Naver runtime status."
  }
  if ([int]$response.runtime.publishingCount -ne 0) {
    throw "The database contains a publishing job; installation was not started."
  }
  if ([int]$response.runtime.activeAgentJobCount -ne 0) {
    throw "The database contains an active agent job; installation was not started."
  }
  return $response.runtime
}

function Get-ProcessCreationStamp {
  param([Parameter(Mandatory = $true)][object]$Process)
  if ($null -eq $Process.CreationDate) { throw "Process $($Process.ProcessId) has no creation timestamp." }
  return ([DateTimeOffset]$Process.CreationDate).ToUniversalTime().ToString("o")
}

function Get-CapturedAgentProcesses {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedRoot,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$ExpectedBuild = "",
    [string]$ExpectedEntry = "",
    [switch]$AllowVerifiedLegacy,
    [switch]$IgnoreForeignListener
  )
  $processes = @(Get-CimInstance Win32_Process)
  $roleProcesses = @($processes | Where-Object {
    $commandLine = [string]$_.CommandLine
    $ownsRoot = $commandLine.IndexOf($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $matchesRole = $commandLine -match '(?:start-agent\.ps1|dist[/\\]index\.js|src[/\\]index\.ts)'
    $matchesEntry = -not $ExpectedEntry -or $commandLine.IndexOf($ExpectedEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $commandLine -match 'start-agent\.ps1'
    $ownsRoot -and $matchesRole -and $matchesEntry
  })
  $connections = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($connection in $connections) {
    $owner = $processes | Where-Object { [int]$_.ProcessId -eq [int]$connection.OwningProcess } | Select-Object -First 1
    $commandLine = [string]$owner.CommandLine
    if (-not $owner -or $commandLine.IndexOf($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      if (-not $IgnoreForeignListener) {
        throw "Singleton port $Port belongs to a process outside AgentRoot."
      }
      continue
    }
    if ($owner -notin $roleProcesses) { $roleProcesses += $owner }
  }
  if ($roleProcesses.Count -eq 0) { return @() }

  $heartbeatPath = Join-Path $ExpectedRoot "logs\naver-draft-agent-heartbeat.json"
  $envPath = Join-Path $ExpectedRoot ".env"
  $statePath = if (Test-Path -LiteralPath $envPath -PathType Leaf) {
    Resolve-RuntimeFile `
      -Root $ExpectedRoot `
      -Value (Get-DotEnvValue -Path $envPath -Name "NAVER_AGENT_STATE_FILE") `
      -DefaultRelative "logs\naver-draft-agent-state.json" `
      -Label "NAVER_AGENT_STATE_FILE"
  } else {
    Join-Path $ExpectedRoot "logs\naver-draft-agent-state.json"
  }
  $heartbeat = Read-JsonRecord -Path $heartbeatPath
  $state = Read-JsonRecord -Path $statePath
  $identityValidated = $false
  if (-not $heartbeat -or -not $state) {
    if (-not $AllowVerifiedLegacy) {
      throw "A live legacy agent has no complete identity records. It cannot be interrupted safely."
    }
  } else {
    try {
      [void](Assert-FreshIdentityRecord -Record $heartbeat -Label "Supervisor heartbeat" -ExpectedRoot $ExpectedRoot -ExpectedPort $Port -ExpectedBuild $ExpectedBuild)
      [void](Assert-FreshIdentityRecord -Record $state -Label "Agent state" -ExpectedRoot $ExpectedRoot -ExpectedPort $Port -ExpectedBuild $ExpectedBuild)
      $identityValidated = $true
    } catch {
      if (-not $AllowVerifiedLegacy) { throw }
    }
    if ($identityValidated) {
      $recordedIds = @([int]$heartbeat.supervisorProcessId, [int]$heartbeat.childProcessId, [int]$state.processId) |
        Where-Object { $_ -gt 0 } | Sort-Object -Unique
      foreach ($recordedId in $recordedIds) {
        if (-not ($processes | Where-Object { [int]$_.ProcessId -eq $recordedId })) {
          if (-not $AllowVerifiedLegacy) {
            throw "Identity record PID $recordedId is no longer running."
          }
        }
      }
    }
  }

  $selected = [Collections.Generic.HashSet[int]]::new()
  foreach ($process in $roleProcesses) { [void]$selected.Add([int]$process.ProcessId) }
  do {
    $added = $false
    foreach ($process in $processes) {
      if ($selected.Contains([int]$process.ParentProcessId) -and $selected.Add([int]$process.ProcessId)) {
        $added = $true
      }
    }
  } while ($added)

  $captured = foreach ($processId in @($selected)) {
    $process = $processes | Where-Object { [int]$_.ProcessId -eq $processId } | Select-Object -First 1
    if (-not $process) { continue }
    [pscustomobject]@{
      ProcessId = [int]$process.ProcessId
      ParentProcessId = [int]$process.ParentProcessId
      CreationStamp = Get-ProcessCreationStamp -Process $process
      CommandLine = [string]$process.CommandLine
    }
  }
  return @($captured)
}

function Test-SameProcessInstance {
  param([Parameter(Mandatory = $true)][object]$Captured)
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Captured.ProcessId)" -ErrorAction SilentlyContinue
  if (-not $current) { return $false }
  return (Get-ProcessCreationStamp -Process $current) -eq [string]$Captured.CreationStamp
}

function Stop-CapturedAgentProcesses {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Captured)
  if ($Captured.Count -eq 0) { return }
  $parentById = @{}
  foreach ($process in $Captured) { $parentById[[int]$process.ProcessId] = [int]$process.ParentProcessId }
  $ordered = foreach ($process in $Captured) {
    $depth = 0
    $cursor = [int]$process.ProcessId
    $visited = [Collections.Generic.HashSet[int]]::new()
    while ($parentById.ContainsKey($cursor) -and $parentById.ContainsKey([int]$parentById[$cursor]) -and $visited.Add($cursor)) {
      $depth += 1
      $cursor = [int]$parentById[$cursor]
    }
    [pscustomobject]@{ Process = $process; Depth = $depth }
  }
  foreach ($item in @($ordered | Sort-Object Depth)) {
    if (Test-SameProcessInstance -Captured $item.Process) {
      Stop-Process -Id ([int]$item.Process.ProcessId) -ErrorAction SilentlyContinue
    }
  }
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
  do {
    $remaining = @($Captured | Where-Object { Test-SameProcessInstance -Captured $_ })
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  foreach ($process in $remaining) {
    if (Test-SameProcessInstance -Captured $process) {
      Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
    }
  }
}

function Wait-ForDeploymentHold {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$ExpectedBuild = "",
    [Parameter(Mandatory = $true)][DateTimeOffset]$NotBefore,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $state = Read-JsonRecord -Path $StatePath
      if ($state) {
        [void](Assert-FreshIdentityRecord -Record $state -Label "Agent state" -ExpectedRoot $Root -ExpectedPort $Port -ExpectedBuild $ExpectedBuild -NotBefore $NotBefore)
        if ([string]$state.status -eq "deployment_hold" -and $state.publishing -ne $true) { return $state }
      }
    } catch {
      # The writer may be atomically replacing the file. Retry until the bounded deadline.
    }
    Start-Sleep -Seconds 1
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "The live agent did not acknowledge deployment_hold; it was not interrupted."
}

function Assert-NoRootAgentProcess {
  param([Parameter(Mandatory = $true)][string]$Root)
  $remaining = @(Get-CimInstance Win32_Process | Where-Object {
    $commandLine = [string]$_.CommandLine
    $commandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $commandLine -match '(?:start-agent\.ps1|dist[/\\]index\.js|src[/\\]index\.ts)'
  })
  if ($remaining.Count -gt 0) {
    throw "Agent processes remain for $Root; refusing to move the runtime directory."
  }
}

function Wait-ForReviewedAgentHealth {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][object]$Identity,
    [Parameter(Mandatory = $true)][DateTimeOffset]$StartedAt,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )
  $heartbeatPath = Join-Path $Root "logs\naver-draft-agent-heartbeat.json"
  $entry = Join-Path $Root ([string]$Identity.Entry).Replace("/", "\")
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastProblem = "identity records have not appeared"
  do {
    try {
      $heartbeat = Read-JsonRecord -Path $heartbeatPath
      $state = Read-JsonRecord -Path $StatePath
      if (-not $heartbeat -or -not $state) { throw "identity records have not appeared" }
      [void](Assert-FreshIdentityRecord -Record $heartbeat -Label "Supervisor heartbeat" -ExpectedRoot $Root -ExpectedPort $Port -ExpectedBuild ([string]$Identity.BuildSha) -NotBefore $StartedAt.AddSeconds(-2))
      [void](Assert-FreshIdentityRecord -Record $state -Label "Agent state" -ExpectedRoot $Root -ExpectedPort $Port -ExpectedBuild ([string]$Identity.BuildSha) -NotBefore $StartedAt.AddSeconds(-2))
      if ([string]$heartbeat.runtimeSha256 -ne [string]$Identity.RuntimeSha256) { throw "Runtime SHA heartbeat mismatch" }
      if ([string]$heartbeat.status -ne "agent_running" -or [string]$state.status -ne "deployment_hold") {
        throw "agent has not reached a held running state"
      }
      if ([int]$heartbeat.childProcessId -le 0 -or [int]$state.processId -ne [int]$heartbeat.childProcessId) {
        throw "heartbeat and agent state PIDs differ"
      }
      $connections = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
      if ($connections.Count -ne 1 -or [int]$connections[0].OwningProcess -ne [int]$heartbeat.childProcessId) {
        throw "singleton listener ownership is not healthy"
      }
      $worker = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$heartbeat.childProcessId)" -ErrorAction SilentlyContinue
      if (-not $worker) { throw "worker process is missing" }
      if (-not ([IO.Path]::GetFullPath([string]$worker.ExecutablePath)).Equals([IO.Path]::GetFullPath([string]$Identity.NodeExecutable), [StringComparison]::OrdinalIgnoreCase)) {
        throw "worker Node.js executable does not match the reviewed absolute path"
      }
      $commandLine = [string]$worker.CommandLine
      if ($commandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
          $commandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "worker command line does not identify the reviewed root and entry"
      }
      return
    } catch {
      $lastProblem = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw "Reviewed agent health timeout: $lastProblem"
}

$existing = Test-Path -LiteralPath $installFull -PathType Container
$configurationRoot = if ($existing) { $installFull } else { $resolvedSource }
$configurationEnv = Join-Path $configurationRoot ".env"
if (-not (Test-Path -LiteralPath $configurationEnv -PathType Leaf)) {
  throw ".env is required before installation: $configurationEnv"
}
if ($existing) {
  if (-not (Test-Path -LiteralPath (Join-Path $installFull "package.json") -PathType Leaf)) {
    throw "Existing InstallRoot is not a Naver agent runtime: $installFull"
  }
}

$port = Get-AgentPort -EnvFile $configurationEnv
$statePath = Resolve-RuntimeFile `
  -Root $configurationRoot `
  -Value (Get-DotEnvValue -Path $configurationEnv -Name "NAVER_AGENT_STATE_FILE") `
  -DefaultRelative "logs\naver-draft-agent-state.json" `
  -Label "NAVER_AGENT_STATE_FILE"
$holdPath = Resolve-RuntimeFile `
  -Root $configurationRoot `
  -Value (Get-DotEnvValue -Path $configurationEnv -Name "NAVER_AGENT_DEPLOY_HOLD_FILE") `
  -DefaultRelative "logs\naver-agent-deployment.hold" `
  -Label "NAVER_AGENT_DEPLOY_HOLD_FILE"

[void](Assert-RemoteRuntimeIdle -EnvFile $configurationEnv)

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskWasRunning = $task -and [string]$task.State -eq "Running"
$taskXml = if ($task) { [string](Export-ScheduledTask -TaskName $TaskName) } else { "" }
if ($task) {
  $taskDefinition = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join " ")
  if ($taskDefinition.IndexOf($installFull, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "Scheduled task $TaskName does not target InstallRoot; refusing to stop or replace it."
  }
}

$oldBuild = ""
if ($existing) {
  $oldAudit = Join-Path $installFull "windows\audit-runtime-drift.ps1"
  if ((Test-Path -LiteralPath (Join-Path $installFull "runtime-manifest.json") -PathType Leaf) -and
      (Test-Path -LiteralPath $oldAudit -PathType Leaf)) {
    try { $oldBuild = [string](& $oldAudit -AgentRoot $installFull).BuildSha } catch { $oldBuild = "" }
  }
}

$oldHoldAlreadyExisted = $existing -and (Test-Path -LiteralPath $holdPath -PathType Leaf)
$temporaryOldHoldCreated = $false
$staging = ""
$backup = ""
$failed = ""
$captured = @()
$taskStopped = $false
$taskRegistrationAttempted = $false
$activeInstalled = $false
$movedExisting = $false

$preCaptureProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $commandLine = [string]$_.CommandLine
  $commandLine.IndexOf($installFull, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine -match '(?:start-agent\.ps1|dist[/\\]index\.js|src[/\\]index\.ts)'
})
if ($preCaptureProcesses.Count -gt 0 -and -not $taskWasRunning) {
  throw "A live agent is not owned by the running managed task. Stop it explicitly before using this installer."
}

try {
  if ($existing -and -not $oldHoldAlreadyExisted) {
    Set-DeploymentHold -Path $holdPath -Message "deployment requested $(Get-Date -Format o)"
    $temporaryOldHoldCreated = $true
  }

  if ($existing -and ($taskWasRunning -or $preCaptureProcesses.Count -gt 0)) {
    try {
      [void](Wait-ForDeploymentHold -Root $installFull -StatePath $statePath -Port $port -ExpectedBuild $oldBuild -NotBefore ([DateTimeOffset]::UtcNow.AddSeconds(-5)) -TimeoutSeconds $HealthTimeoutSeconds)
    } catch {
      if ($ConfirmLegacyNoPublishing) {
        throw "Legacy confirmation cannot override a live agent that failed to acknowledge deployment_hold. Stop it outside this installer and retry."
      }
      throw
    }
  }

  [void](Assert-RemoteRuntimeIdle -EnvFile $configurationEnv)
  if ($existing) {
    $captured = @(Get-CapturedAgentProcesses -ExpectedRoot $installFull -Port $port -ExpectedBuild $oldBuild -AllowVerifiedLegacy:$ConfirmLegacyNoPublishing)
    if ($captured.Count -gt 0 -and -not $taskWasRunning) {
      throw "A live agent appeared outside the running managed task during preflight; it was not stopped."
    }
  }

  $suffix = [Guid]::NewGuid().ToString("N")
  $staging = "$installFull.next-$suffix"
  $backup = "$installFull.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$suffix"
  $failed = "$installFull.failed-$suffix"
  foreach ($path in @($staging, $backup, $failed)) {
    Assert-SafeRuntimePath -Path $path -Label "transition path"
    if ((Split-Path -Parent $path) -ne $installParent -or $path -eq $installParent) {
      throw "Unsafe transition path: $path"
    }
    if (Test-Path -LiteralPath $path) { throw "Transition path already exists: $path" }
  }

  New-Item -ItemType Directory -Path $staging | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $resolvedSource -Force) {
    $isSecretOrMutable = $item.Name -eq ".git" -or $item.Name -eq ".env" -or
      $item.Name -like ".env.*" -or $item.Name -eq ".naver-profile" -or
      $item.Name -in @("drafts", "logs")
    if ($isSecretOrMutable) { continue }
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $staging $item.Name) -Recurse
  }

  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $taskStopped = $true
  }
  Stop-CapturedAgentProcesses -Captured $captured
  if ($existing) { Assert-NoRootAgentProcess -Root $installFull }
  [void](Assert-RemoteRuntimeIdle -EnvFile $configurationEnv)

  if ($existing) {
    & $sourceAcl -AgentRoot $installFull
    foreach ($name in @(".env", ".naver-profile", "drafts", "logs")) {
      $oldPath = Join-Path $installFull $name
      if (Test-Path -LiteralPath $oldPath) {
        Copy-Item -LiteralPath $oldPath -Destination (Join-Path $staging $name) -Recurse
      }
    }
  } else {
    Copy-Item -LiteralPath $configurationEnv -Destination (Join-Path $staging ".env")
  }

  $stagingEnv = Join-Path $staging ".env"
  $stagingState = Resolve-RuntimeFile `
    -Root $staging `
    -Value (Get-DotEnvValue -Path $stagingEnv -Name "NAVER_AGENT_STATE_FILE") `
    -DefaultRelative "logs\naver-draft-agent-state.json" `
    -Label "NAVER_AGENT_STATE_FILE"
  $stagingHold = Resolve-RuntimeFile `
    -Root $staging `
    -Value (Get-DotEnvValue -Path $stagingEnv -Name "NAVER_AGENT_DEPLOY_HOLD_FILE") `
    -DefaultRelative "logs\naver-agent-deployment.hold" `
    -Label "NAVER_AGENT_DEPLOY_HOLD_FILE"
  Set-DeploymentHold -Path $stagingHold -Message "reviewed activation pending $(Get-Date -Format o)"
  & (Join-Path $staging "windows\protect-env-acl.ps1") -AgentRoot $staging
  $stagingIdentity = & (Join-Path $staging "windows\audit-runtime-drift.ps1") -AgentRoot $staging

  if ($existing) {
    Move-RuntimeDirectoryWithRetry -Source $installFull -Destination $backup
    $movedExisting = $true
    & $sourceAcl -AgentRoot $backup
  }
  Move-RuntimeDirectoryWithRetry -Source $staging -Destination $installFull
  $activeInstalled = $true
  & (Join-Path $installFull "windows\protect-env-acl.ps1") -AgentRoot $installFull
  $activeIdentity = & (Join-Path $installFull "windows\audit-runtime-drift.ps1") -AgentRoot $installFull
  if ([string]$activeIdentity.RuntimeSha256 -ne [string]$stagingIdentity.RuntimeSha256 -or
      [string]$activeIdentity.BuildSha -ne [string]$sourceIdentity.BuildSha) {
    throw "Active runtime identity changed during installation."
  }

  $activeEnv = Join-Path $installFull ".env"
  $activePort = Get-AgentPort -EnvFile $activeEnv
  if ($activePort -ne $port) { throw "Singleton port changed during installation." }
  $activeState = Resolve-RuntimeFile `
    -Root $installFull `
    -Value (Get-DotEnvValue -Path $activeEnv -Name "NAVER_AGENT_STATE_FILE") `
    -DefaultRelative "logs\naver-draft-agent-state.json" `
    -Label "NAVER_AGENT_STATE_FILE"
  $activeHold = Resolve-RuntimeFile `
    -Root $installFull `
    -Value (Get-DotEnvValue -Path $activeEnv -Name "NAVER_AGENT_DEPLOY_HOLD_FILE") `
    -DefaultRelative "logs\naver-agent-deployment.hold" `
    -Label "NAVER_AGENT_DEPLOY_HOLD_FILE"

  $shouldStart = $Activate -or $taskWasRunning
  if ($Activate) {
    $taskRegistrationAttempted = $true
    & (Join-Path $installFull "windows\register-startup-task.ps1") -AgentRoot $installFull -TaskName $TaskName -StartNow
  } elseif ($taskWasRunning) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  }

  if ($shouldStart) {
    $startedAt = [DateTimeOffset]::UtcNow
    Wait-ForReviewedAgentHealth `
      -Root $installFull `
      -StatePath $activeState `
      -Port $activePort `
      -Identity $activeIdentity `
      -StartedAt $startedAt `
      -TimeoutSeconds $HealthTimeoutSeconds
    [void](Assert-RemoteRuntimeIdle -EnvFile $activeEnv)
  }

  if ($movedExisting -and -not $oldHoldAlreadyExisted) {
    $backupHold = Resolve-RuntimeFile `
      -Root $backup `
      -Value (Get-DotEnvValue -Path (Join-Path $backup ".env") -Name "NAVER_AGENT_DEPLOY_HOLD_FILE") `
      -DefaultRelative "logs\naver-agent-deployment.hold" `
      -Label "NAVER_AGENT_DEPLOY_HOLD_FILE"
    if (Test-Path -LiteralPath $backupHold -PathType Leaf) { Remove-Item -LiteralPath $backupHold -Force }
    & $sourceAcl -AgentRoot $backup
  }

  # Releasing this hold is the commit point. Keep it as the final operation
  # that can fail so rollback never interrupts a newly claiming worker.
  if (-not $oldHoldAlreadyExisted -and (Test-Path -LiteralPath $activeHold -PathType Leaf)) {
    Remove-Item -LiteralPath $activeHold -Force
  }

  Write-Host "Installed reviewed agent: $installFull"
  if ($movedExisting) { Write-Host "ACL-protected recoverable backup retained: $backup" }
  if ($oldHoldAlreadyExisted) {
    Write-Host "The pre-existing deployment hold was preserved; the agent will not claim jobs until it is removed."
  } elseif ($shouldStart) {
    Write-Host "Verified fresh supervisor/state heartbeat, exact root, port, build/runtime SHA, absolute Node worker, and listener ownership."
  } else {
    Write-Host "The prior stopped state was preserved; static runtime identity and ACL checks passed."
  }
} catch {
  $originalError = $_
  $rollbackErrors = [Collections.Generic.List[string]]::new()
  try {
    if ($staging -and (Test-Path -LiteralPath $staging -PathType Container)) {
      $resolvedStaging = (Resolve-Path -LiteralPath $staging).Path
      if ((Split-Path -Parent $resolvedStaging) -ne $installParent -or
          -not $resolvedStaging.StartsWith("$installFull.next-", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe staging cleanup target: $resolvedStaging"
      }
      Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
  } catch {
    $rollbackErrors.Add("staging cleanup: $($_.Exception.Message)")
  }
  try {
    if ($activeInstalled -and (Test-Path -LiteralPath $installFull -PathType Container)) {
      $rollbackEnv = Join-Path $installFull ".env"
      if (-not (Test-Path -LiteralPath $rollbackEnv -PathType Leaf)) {
        throw "Active runtime .env is missing; deployment hold cannot be restored."
      }
      $rollbackHold = Resolve-RuntimeFile `
        -Root $installFull `
        -Value (Get-DotEnvValue -Path $rollbackEnv -Name "NAVER_AGENT_DEPLOY_HOLD_FILE") `
        -DefaultRelative "logs\naver-agent-deployment.hold" `
        -Label "NAVER_AGENT_DEPLOY_HOLD_FILE"
      Set-DeploymentHold -Path $rollbackHold -Message "rollback requested $(Get-Date -Format o)"
    }
  } catch {
    $rollbackErrors.Add("deployment hold restore: $($_.Exception.Message)")
  }
  try {
    if ($task -or $taskRegistrationAttempted) {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    if ($activeInstalled -and (Test-Path -LiteralPath $installFull -PathType Container)) {
      $rollbackEnv = Join-Path $installFull ".env"
      $rollbackPort = if (Test-Path -LiteralPath $rollbackEnv -PathType Leaf) { Get-AgentPort -EnvFile $rollbackEnv } else { $port }
      $newCaptured = @(Get-CapturedAgentProcesses `
        -ExpectedRoot $installFull `
        -Port $rollbackPort `
        -ExpectedBuild ([string]$sourceIdentity.BuildSha) `
        -ExpectedEntry (Join-Path $installFull ([string]$sourceIdentity.Entry).Replace("/", "\")) `
        -AllowVerifiedLegacy `
        -IgnoreForeignListener)
      Stop-CapturedAgentProcesses -Captured $newCaptured
      Assert-NoRootAgentProcess -Root $installFull
      Move-RuntimeDirectoryWithRetry -Source $installFull -Destination $failed
      $activeInstalled = $false
    }
    if ($movedExisting -and (Test-Path -LiteralPath $backup -PathType Container)) {
      Move-RuntimeDirectoryWithRetry -Source $backup -Destination $installFull
      $movedExisting = $false
      & $sourceAcl -AgentRoot $installFull
      if ($temporaryOldHoldCreated) {
        $restoredEnv = Join-Path $installFull ".env"
        $restoredHold = Resolve-RuntimeFile `
          -Root $installFull `
          -Value (Get-DotEnvValue -Path $restoredEnv -Name "NAVER_AGENT_DEPLOY_HOLD_FILE") `
          -DefaultRelative "logs\naver-agent-deployment.hold" `
          -Label "NAVER_AGENT_DEPLOY_HOLD_FILE"
        if (Test-Path -LiteralPath $restoredHold -PathType Leaf) { Remove-Item -LiteralPath $restoredHold -Force }
      }
    } elseif (-not $activeInstalled -and $temporaryOldHoldCreated -and (Test-Path -LiteralPath $holdPath -PathType Leaf)) {
      Remove-Item -LiteralPath $holdPath -Force
    }
  } catch {
    $rollbackErrors.Add("filesystem/process rollback: $($_.Exception.Message)")
  }
  try {
    if ($taskRegistrationAttempted) {
      if ($taskXml) {
        Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force | Out-Null
      } else {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
      }
    }
    if ($rollbackErrors.Count -eq 0 -and $taskWasRunning -and (Test-Path -LiteralPath $installFull -PathType Container)) {
      Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    }
  } catch {
    $rollbackErrors.Add("scheduled-task rollback: $($_.Exception.Message)")
  }
  if ($rollbackErrors.Count -gt 0) {
    throw "Installation failed: $($originalError.Exception.Message). Rollback also failed: $($rollbackErrors -join '; ')"
  }
  throw $originalError
}
