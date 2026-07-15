# ============================================================
# register-sales-line-items-task.ps1
# يسجّل مهمة Windows مجدولة لمزامنة حركة المبيعات التفصيلية تلقائياً
# ============================================================

param(
    [int]$IntervalMinutes = 30
)

$ErrorActionPreference = "Stop"

# تسجيل مهمة مجدولة بصلاحية Highest يتطلب PowerShell كمسؤول (Administrator)
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "خطأ: لازم تشغّل هالسكريبت من PowerShell كمسؤول (Administrator)." -ForegroundColor Red
    Write-Host "دوس بزر الفأرة اليمين على PowerShell واختر 'Run as administrator'، وأعد المحاولة." -ForegroundColor Yellow
    exit 1
}

$taskName = "TOBACCO Sales Line Items Push"
$scriptPath = "$PSScriptRoot\push-sales-line-items.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 1)

try {
    # حذف المهمة القديمة إذا كانت موجودة
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    # تسجيل المهمة الجديدة
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -RunLevel Highest `
        -Force | Out-Null

    Write-Host "تم تسجيل المهمة المجدولة: '$taskName' كل $IntervalMinutes دقيقة ✓" -ForegroundColor Green
    Write-Host "المسار: $scriptPath" -ForegroundColor Cyan
} catch {
    Write-Host "فشل تسجيل المهمة: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
