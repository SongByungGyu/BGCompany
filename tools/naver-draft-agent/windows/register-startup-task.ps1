param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "BGCompany-NaverDraftAgent",
  [switch]$StartNow,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$resolvedAgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path
$launcher = Join-Path $resolvedAgentRoot "windows\start-agent.ps1"
$runtimeDriftAudit = Join-Path $resolvedAgentRoot "windows\audit-runtime-drift.ps1"
$envAclScript = Join-Path $resolvedAgentRoot "windows\protect-env-acl.ps1"
$packageJson = Join-Path $resolvedAgentRoot "package.json"
$envFile = Join-Path $resolvedAgentRoot ".env"
if (-not (Test-Path -LiteralPath $launcher)) { throw "Agent launcher not found: $launcher" }
if (-not (Test-Path -LiteralPath $runtimeDriftAudit)) { throw "Runtime drift audit not found: $runtimeDriftAudit" }
if (-not (Test-Path -LiteralPath $envAclScript)) { throw "Environment ACL script not found: $envAclScript" }
if (-not (Test-Path -LiteralPath $packageJson)) { throw "package.json not found: $packageJson" }
if (-not (Test-Path -LiteralPath $envFile)) { throw ".env not found: $envFile" }

$parseTokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
  throw "Agent launcher has PowerShell syntax errors: $($parseErrors[0].Message)"
}
& $runtimeDriftAudit -AgentRoot $resolvedAgentRoot

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -AgentRoot `"$resolvedAgentRoot`""

if ($ValidateOnly) {
  Write-Host "Validated scheduled task configuration: $TaskName"
  Write-Host "Agent root: $resolvedAgentRoot"
  Write-Host "Triggers: user logon and daily at 06:00"
  Write-Host "No scheduled task was created or changed."
  return
}

& $envAclScript -AgentRoot $resolvedAgentRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $resolvedAgentRoot
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $userId),
  (New-ScheduledTaskTrigger -Daily -At "06:00")
)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $TaskName"
Write-Host "Agent root: $resolvedAgentRoot"
Write-Host "The task runs after Windows logon and at 06:00 daily, wakes the PC when supported, and processes only server-authorized jobs."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task: $TaskName"
}
