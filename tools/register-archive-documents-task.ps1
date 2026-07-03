# ============================================================
# register-archive-documents-task.ps1
# يسجّل مهمة مجدولة تشغّل archive-documents.ps1 كل 5 دقائق
# (أرشفة وصولات وفواتير الموقع كملفات PDF على سطح المكتب)
# شغّله كمسؤول Administrator على اللابتوب الذي يحوي ملف tools\.env
# ============================================================
param(
    [int]$IntervalMinutes = 5
)

$taskName = "TOBACCO Documents Archive"
$scriptPath = "$PSScriptRoot\archive-documents.ps1"

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
Write-Host "تم تشغيل الأرشفة الأولى الآن — راقب السجل: tools\logs\archive-documents.log" -ForegroundColor Cyan
