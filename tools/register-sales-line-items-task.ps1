# ============================================================
# register-sales-line-items-task.ps1
# يسجّل مهمة Windows مجدولة لمزامنة حركة المبيعات التفصيلية تلقائياً
# ============================================================

param(
    [int]$IntervalMinutes = 30
)

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

# حذف المهمة القديمة إذا كانت موجودة
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# تسجيل المهمة الجديدة
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force

Write-Host "تم تسجيل المهمة المجدولة: '$taskName' كل $IntervalMinutes دقيقة ✓" -ForegroundColor Green
Write-Host "المسار: $scriptPath" -ForegroundColor Cyan
Write-Host "⚠️ لا تسجّل هالمهمة إلا بعد ما تجرّب السكريبت يدوياً بـ -DryRun وتتأكد إنه طالع صح." -ForegroundColor Yellow
