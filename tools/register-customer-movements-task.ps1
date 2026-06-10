# ============================================================
# register-customer-movements-task.ps1
# يسجّل مهمة مجدولة ترفع حركات الزبائن كل 30 دقيقة
# (شغّله كمسؤول Administrator)
# ============================================================
param(
    [int]$IntervalMinutes = 30
)

$taskName = "TOBACCO Customer Movements Push"
$scriptPath = "$PSScriptRoot\push-customer-movements.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 2)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force

Write-Host "تم تسجيل المهمة المجدولة: '$taskName' كل $IntervalMinutes دقيقة ✓" -ForegroundColor Green

# تشغيل فوري أول مرة
Start-ScheduledTask -TaskName $taskName
Write-Host "تم تشغيل الرفعة الأولى الآن — راقب السجل: tools\logs\customer-movements-push.log" -ForegroundColor Cyan
