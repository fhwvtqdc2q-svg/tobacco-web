#requires -Version 5.1
# يسجّل تقرير فواتير المشتريات من Ameen إلى Supabase بصورة دورية.
# هذا المسار يقرأ Ameen فقط ولا يكتب أي فاتورة أو حركة محاسبية فيه.
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(5, 1440)]
    [int]$IntervalMinutes = 15,

    [ValidateRange(1, 365)]
    [int]$PeriodDays = 60,

    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "شغّل هذا السكربت من PowerShell بصلاحيات Administrator."
}

$taskName = "TOBACCO Purchase Invoices Pull"
$scriptPath = Join-Path $PSScriptRoot "pull-purchase-invoices-from-ameen.ps1"
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "سكريبت المزامنة غير موجود: $scriptPath"
}

$powerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$envFilePath = Join-Path $PSScriptRoot ".env"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -PeriodDays $PeriodDays -EnvFile `"$envFilePath`""
$action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At ((Get-Date).AddMinutes(1)) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, "Register or replace scheduled task")) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -RunLevel Highest `
        -Force | Out-Null

    Write-Host "تم تسجيل المهمة '$taskName' كل $IntervalMinutes دقيقة." -ForegroundColor Green
    Write-Host "حوّلها بعد ذلك إلى حساب OZKSync عبر convert-task-to-service-account.ps1 كي تعمل دون تسجيل دخول." -ForegroundColor Yellow

    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
        Write-Host "تم بدء التشغيل الأول." -ForegroundColor Cyan
    }
}
