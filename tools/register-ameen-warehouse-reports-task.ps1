#requires -Version 5.1
# يسجّل مزامنة تقارير المستودعات والمناقلات. يتطلب Administrator.
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateRange(5, 1440)][int]$IntervalMinutes = 60,
  [ValidateRange(1, 365)][int]$PeriodDays = 60,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "شغّل هذا السكربت من PowerShell بصلاحيات Administrator."
}

$taskName = "TOBACCO Ameen Warehouse Reports"
$runner = Join-Path $PSScriptRoot "sync-ameen-warehouse-reports.ps1"
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "ملف التشغيل غير موجود: $runner" }
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "ملف الإعدادات غير موجود: $envFile" }

$powerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -PeriodDays $PeriodDays -EnvFile `"$envFile`""
$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, "Register or replace scheduled task")) {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -RunLevel Highest -Force | Out-Null
  Write-Host "تم تسجيل المهمة '$taskName' كل $IntervalMinutes دقيقة." -ForegroundColor Green
  Write-Host "حوّلها بعد المراجعة إلى OZKSync عبر convert-task-to-service-account.ps1." -ForegroundColor Yellow
  if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
}
