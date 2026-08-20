param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TaskName = "BGCompany-NaverDraftAgent",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$launcher = Join-Path $AgentRoot "windows\start-agent.ps1"
if (-not (Test-Path -LiteralPath $launcher)) { throw "Agent launcher not found: $launcher" }

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -AgentRoot `"$AgentRoot`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $AgentRoot
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
Write-Host "Agent root: $AgentRoot"
Write-Host "The task runs after Windows logon and at 06:00 daily, wakes the PC when supported, and follows the guarded publish policy."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task: $TaskName"
}
