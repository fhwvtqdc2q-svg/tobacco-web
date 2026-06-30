# ============================================================
# register-customer-invoices-task.ps1
# يسجّل مهمة مجدولة ترفع فواتير الزبائن كل ساعة إلى Supabase
# (نفس آلية حركات الزبائن — ليظهر "عرض فواتير الزبون" في الموقع)
# شغّله كمسؤول Administrator على اللابتوب الذي يحوي ملف tools\.env وقاعدة الأمين
# ============================================================
param(
    [int]$IntervalMinutes = 60
)

$taskName = "TOBACCO Customer Invoices Push"
$scriptPath = "$PSScriptRoot\push-customer-invoices.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 3)

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
Write-Host "تم تشغيل الرفعة الأولى الآن — راقب السجل: tools\logs\customer-invoices-push.log" -ForegroundColor Cyan
