# ============================================================
# register-approved-prices-pull-task.ps1
# يسجّل مهمة Windows مجدولة لمزامنة الأسعار تلقائياً
# ============================================================

param(
    [int]$IntervalMinutes = 5,
    [switch]$ApplyToAmeen,
    [switch]$AllActivePriceList
)

$taskName = "TOBACCO Approved Prices Pull"
$scriptPath = "$PSScriptRoot\sync-approved-prices-to-ameen.ps1"
$applyFlag = if ($ApplyToAmeen) { "-Apply" } else { "" }

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $applyFlag"

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
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
