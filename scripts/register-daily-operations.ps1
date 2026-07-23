param(
  [string]$Distribution = "Ubuntu-D",
  [string]$WindowsAgentRoot = "C:\Users\Song ByungGyu\Documents\BG Company\automation\naver-agent",
  [switch]$StartSchedulerNow,
  [switch]$EnableAgent,
  [switch]$StartAgentNow
)

$ErrorActionPreference = "Stop"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$wsl = Join-Path $env:SystemRoot "System32\wsl.exe"

function New-BGWslAction([string]$scriptPath) {
  New-ScheduledTaskAction `
    -Execute $wsl `
    -Argument "-d $Distribution -- bash $scriptPath"
}

$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited

$commonSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)

$schedulerTaskName = "BGCompany-StockBlogScheduler"
$schedulerAction = New-BGWslAction "/home/songbyunggyu/projects/bg-company/scripts/run-stock-blog-scheduler-tick.sh"
$schedulerNow = Get-Date
$nextSchedulerBoundary = $schedulerNow.Date.AddHours($schedulerNow.Hour).AddMinutes(([Math]::Floor($schedulerNow.Minute / 10) + 1) * 10)
$schedulerTriggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $userId),
  (New-ScheduledTaskTrigger `
    -Once `
    -At $nextSchedulerBoundary `
    -RepetitionInterval (New-TimeSpan -Minutes 10) `
    -RepetitionDuration (New-TimeSpan -Days 3650))
)
Register-ScheduledTask `
  -TaskName $schedulerTaskName `
  -Action $schedulerAction `
  -Trigger $schedulerTriggers `
  -Principal $principal `
  -Settings $commonSettings `
  -Description "BG Company stock blog schedule tick every 10 minutes." `
  -Force | Out-Null

$agentTaskName = "BGCompany-NaverDraftAgent"
$agentLauncher = Join-Path $WindowsAgentRoot "start-agent.ps1"
if (-not (Test-Path -LiteralPath $agentLauncher)) { throw "Windows Naver Agent launcher not found: $agentLauncher" }
$agentArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentLauncher`""
$agentAction = New-ScheduledTaskAction `
  -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument $agentArguments `
  -WorkingDirectory $WindowsAgentRoot
$agentTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
Register-ScheduledTask `
  -TaskName $agentTaskName `
  -Action $agentAction `
  -Trigger $agentTrigger `
  -Principal $principal `
  -Settings $commonSettings `
  -Description "BG Company Naver Draft Agent supervisor; requires a valid persistent Naver session." `
  -Force | Out-Null

if ($EnableAgent -or $StartAgentNow) {
  Enable-ScheduledTask -TaskName $agentTaskName | Out-Null
} else {
  Disable-ScheduledTask -TaskName $agentTaskName | Out-Null
}

if ($StartSchedulerNow) { Start-ScheduledTask -TaskName $schedulerTaskName }
if ($StartAgentNow) { Start-ScheduledTask -TaskName $agentTaskName }

foreach ($taskName in @($schedulerTaskName, $agentTaskName)) {
  $task = Get-ScheduledTask -TaskName $taskName
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  [pscustomobject]@{
    TaskName = $taskName
    State = $task.State
    LastRunTime = $info.LastRunTime
    LastTaskResult = $info.LastTaskResult
    NextRunTime = $info.NextRunTime
  }
}
