# Registration only. This script never starts the task or the producer.
param(
    [string]$TaskName = "TOBACCO Ameen Item Snapshot Refresh",
    [string]$DailyAt = "05:05"
)

$ErrorActionPreference = "Stop"
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew

if ($DailyAt -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') { throw "DailyAt must use 24-hour HH:mm format." }
$scriptPath = Join-Path $PSScriptRoot "push-purchase-item-snapshot.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Producer wrapper not found: $scriptPath" }
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`" -Apply"
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $PSScriptRoot
$startAt = [datetime]::Today.Add([timespan]::ParseExact($DailyAt, 'hh\:mm', $null))
if ($startAt -le (Get-Date)) { $startAt = $startAt.AddDays(1) }
$trigger = New-ScheduledTaskTrigger -Daily -At $startAt

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Daily Supabase-only refresh of ameen_item_snapshot from sales_line_items." -Force | Out-Null
Write-Host "Registered task: $TaskName"
Write-Host "Schedule: daily at $DailyAt (local machine time)"
Write-Host "The task was not started by this registration script."
