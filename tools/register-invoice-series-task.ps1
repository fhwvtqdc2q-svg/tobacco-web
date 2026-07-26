# ============================================================
# register-invoice-series-task.ps1
# يسجّل مهمة مجدولة ترفع آخر رقم فاتورة لكل سلسلة ترقيم في الأمين إلى Supabase
# كي يعرض الموقع رقم الفاتورة التالي متزامناً مع الأمين.
# الاستعلام خفيف جداً (تجميع على bt000/bu000 فقط) فيصلح لتكرار قصير.
# شغّله كمسؤول Administrator على اللابتوب الذي يحوي ملف tools\.env وقاعدة الأمين
# ============================================================
param(
    [int]$IntervalMinutes = 5
)

$taskName = "TOBACCO Invoice Series Push"
$scriptPath = "$PSScriptRoot\push-invoice-series.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
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
Write-Host "تم تشغيل الرفعة الأولى الآن — راقب السجل: tools\logs\invoice-series-push.log" -ForegroundColor Cyan
