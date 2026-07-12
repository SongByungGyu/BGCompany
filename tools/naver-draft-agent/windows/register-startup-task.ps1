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
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered scheduled task: $TaskName"
Write-Host "Agent root: $AgentRoot"
Write-Host "The task runs after Windows logon and never presses Naver's publish button."

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task: $TaskName"
}
