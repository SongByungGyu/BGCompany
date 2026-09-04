param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [string]$InstallRoot = "C:\bg-company\naver-draft-agent-windows",
  [string]$TaskName = "BGCompany-NaverDraftAgent",
  [switch]$ConfirmLegacyNoPublishing,
  [switch]$Activate
)

$ErrorActionPreference = "Stop"
$resolvedSource = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd("\")
$installFull = [IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")
$installParent = Split-Path -Parent $installFull
if (-not [IO.Path]::IsPathRooted($installFull) -or $installFull -eq [IO.Path]::GetPathRoot($installFull)) { throw "Unsafe InstallRoot: $installFull" }
if (-not (Test-Path -LiteralPath $installParent -PathType Container)) { throw "Install parent not found: $installParent" }
if ($resolvedSource -eq $installFull) { throw "SourceRoot and InstallRoot must differ." }

$sourceAudit = Join-Path $resolvedSource "windows\audit-runtime-drift.ps1"
if (-not (Test-Path -LiteralPath $sourceAudit)) { throw "Runtime audit not found in source package." }
& $sourceAudit -AgentRoot $resolvedSource | Out-Null

$existingState = Join-Path $installFull "logs\naver-draft-agent-state.json"
$existingHeartbeat = Join-Path $installFull "logs\naver-draft-agent-heartbeat.json"
$state = if (Test-Path -LiteralPath $existingState) { Get-Content -LiteralPath $existingState -Raw | ConvertFrom-Json } else { $null }
if ($state -and $state.publishing -eq $true) { throw "The installed agent reports an active publish. Installation was not interrupted." }

function Stop-ExactAgentProcessTree {
  param([string]$ExpectedRoot, [string]$HeartbeatPath, [object]$AgentState, [switch]$AllowVerifiedLegacy)
  $processes = @(Get-CimInstance Win32_Process)
  if (-not (Test-Path -LiteralPath $HeartbeatPath)) {
    $legacy = @($processes | Where-Object {
      $commandLine = [string]$_.CommandLine
      $commandLine.IndexOf($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $commandLine -match '(?:dist[/\\]index\.js|start-agent\.ps1)'
    })
    if ($legacy.Count -eq 0) { return }
    if (-not $AllowVerifiedLegacy) {
      throw "Legacy agent has no heartbeat. Verify the operating database has no publishing job, then pass -ConfirmLegacyNoPublishing."
    }
    $rootProcessIds = @($legacy | Select-Object -ExpandProperty ProcessId -Unique)
  } else {
    $heartbeat = Get-Content -LiteralPath $HeartbeatPath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath([string]$heartbeat.agentRoot).TrimEnd("\") -ne $ExpectedRoot) {
      throw "Heartbeat AgentRoot mismatch; refusing process cleanup."
    }
    $heartbeatAt = [DateTimeOffset]::Parse([string]$heartbeat.timestamp)
    $candidates = @(
      [pscustomobject]@{ Id = [int]$heartbeat.supervisorProcessId; Kind = "supervisor" },
      [pscustomobject]@{ Id = [int]$heartbeat.childProcessId; Kind = "agent" },
      [pscustomobject]@{ Id = [int]$AgentState.processId; Kind = "agent" }
    ) | Where-Object { $_.Id -gt 0 } | Sort-Object Id -Unique
    $rootProcessIds = @()
    foreach ($candidate in $candidates) {
      $process = $processes | Where-Object { [int]$_.ProcessId -eq $candidate.Id } | Select-Object -First 1
      if (-not $process) { continue }
      $commandLine = [string]$process.CommandLine
      $ownsExpectedRoot = $commandLine.IndexOf($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
      $matchesRole = if ($candidate.Kind -eq "supervisor") {
        $commandLine -match 'start-agent\.ps1'
      } else {
        $commandLine -match '(?:dist[/\\]index\.js|src[/\\]index\.ts)'
      }
      $createdAt = [DateTimeOffset]$process.CreationDate
      if (-not $ownsExpectedRoot -or -not $matchesRole -or $createdAt -gt $heartbeatAt.AddMinutes(2)) {
        throw "Recorded PID $($candidate.Id) no longer belongs to the expected AgentRoot process; refusing cleanup."
      }
      $rootProcessIds += $candidate.Id
    }
  }
  $rootProcessIds = @($rootProcessIds | Sort-Object -Unique)
  if ($rootProcessIds.Count -eq 0) { return }
  $selected = [Collections.Generic.HashSet[int]]::new()
  foreach ($processId in $rootProcessIds) { [void]$selected.Add($processId) }
  do {
    $added = $false
    foreach ($process in $processes) {
      if ($selected.Contains([int]$process.ParentProcessId) -and $selected.Add([int]$process.ProcessId)) { $added = $true }
    }
  } while ($added)
  $parentById = @{}
  foreach ($process in $processes) { $parentById[[int]$process.ProcessId] = [int]$process.ParentProcessId }
  $orderedProcessIds = foreach ($processId in @($selected)) {
    $depth = 0
    $cursor = $processId
    $visited = [Collections.Generic.HashSet[int]]::new()
    while ($parentById.ContainsKey($cursor) -and $selected.Contains([int]$parentById[$cursor]) -and $visited.Add($cursor)) {
      $depth += 1
      $cursor = [int]$parentById[$cursor]
    }
    [pscustomobject]@{ ProcessId = $processId; Depth = $depth }
  }
  foreach ($processId in @($orderedProcessIds | Sort-Object Depth -Descending | Select-Object -ExpandProperty ProcessId)) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskWasRunning = $task -and [string]$task.State -eq "Running"
if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

try {
  if (Test-Path -LiteralPath $installFull) {
    Stop-ExactAgentProcessTree -ExpectedRoot $installFull -HeartbeatPath $existingHeartbeat -AgentState $state -AllowVerifiedLegacy:$ConfirmLegacyNoPublishing
  }

$suffix = [Guid]::NewGuid().ToString("N")
$staging = "$installFull.next-$suffix"
$backup = "$installFull.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
foreach ($path in @($staging, $backup)) {
  if ((Split-Path -Parent $path) -ne $installParent -or $path -eq $installParent) { throw "Unsafe transition path: $path" }
  if (Test-Path -LiteralPath $path) { throw "Transition path already exists: $path" }
}
New-Item -ItemType Directory -Path $staging | Out-Null

$excludedNames = @(".git", ".env", ".naver-profile", "drafts", "logs")
foreach ($item in Get-ChildItem -LiteralPath $resolvedSource -Force) {
  if ($item.Name -in $excludedNames) { continue }
  Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $staging $item.Name) -Recurse
}
if (Test-Path -LiteralPath $installFull) {
  foreach ($name in @(".env", ".naver-profile", "drafts", "logs")) {
    $existingPath = Join-Path $installFull $name
    if (Test-Path -LiteralPath $existingPath) { Copy-Item -LiteralPath $existingPath -Destination (Join-Path $staging $name) -Recurse }
  }
} elseif (Test-Path -LiteralPath (Join-Path $resolvedSource ".env")) {
  Copy-Item -LiteralPath (Join-Path $resolvedSource ".env") -Destination (Join-Path $staging ".env")
}

& (Join-Path $staging "windows\protect-env-acl.ps1") -AgentRoot $staging
& (Join-Path $staging "windows\audit-runtime-drift.ps1") -AgentRoot $staging | Out-Null

$movedExisting = $false
try {
  if (Test-Path -LiteralPath $installFull) {
    Move-Item -LiteralPath $installFull -Destination $backup
    $movedExisting = $true
  }
  Move-Item -LiteralPath $staging -Destination $installFull
} catch {
  if ($movedExisting -and -not (Test-Path -LiteralPath $installFull) -and (Test-Path -LiteralPath $backup)) {
    Move-Item -LiteralPath $backup -Destination $installFull
  }
  throw
}

  Write-Host "Installed reviewed agent: $installFull"
  if ($movedExisting) { Write-Host "Recoverable backup retained: $backup" }
  if ($Activate) {
    & (Join-Path $installFull "windows\register-startup-task.ps1") -AgentRoot $installFull -TaskName $TaskName -StartNow
  } elseif ($taskWasRunning) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "The previously running task was restarted with the reviewed package."
  } else {
    Write-Host "Task Scheduler registration and prior stopped state were preserved."
  }
} catch {
  if ($taskWasRunning -and (Test-Path -LiteralPath $installFull)) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  throw
}
