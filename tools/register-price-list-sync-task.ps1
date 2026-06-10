# ============================================================
# register-price-list-sync-task.ps1
# يسجّل مهمة تلقائية تزامن الأسعار وترفع النشرات كل 10 دقائق
# ============================================================
# الاستخدام: .\tools\register-price-list-sync-task.ps1
# يتطلب: تشغيل PowerShell كمسؤول (Run as Administrator)
# ============================================================

param(
    [int]$IntervalMinutes = 10
)

$taskName   = "OZK-PriceListSync"
$scriptPath = "$PSScriptRoot\auto-sync-price-lists.ps1"
$logPath    = "$PSScriptRoot\logs\task-price-list-sync.log"

# تحقق من صلاحيات المسؤول
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "خطأ: شغّل PowerShell كمسؤول (Run as Administrator)" -ForegroundColor Red
    exit 1
}

# حذف المهمة القديمة إن وُجدت
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName   $taskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -RunLevel   Highest `
    -Description "OZK TOBACCO — مزامنة أسعار الأمين ورفع نشرات الأسعار لـ GitHub تلقائياً" `
    | Out-Null

Write-Host "✓ مهمة '$taskName' مسجّلة — كل $IntervalMinutes دقائق" -ForegroundColor Green
Write-Host "  السكريبت: $scriptPath" -ForegroundColor Gray
Write-Host "  السجل:    $logPath" -ForegroundColor Gray
Write-Host ""
Write-Host "لتشغيل يدوي فوري:" -ForegroundColor Yellow
Write-Host "  .\tools\auto-sync-price-lists.ps1" -ForegroundColor White
Write-Host ""
Write-Host "لإيقاف المهمة:" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor White
