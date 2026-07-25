# ============================================================
# register-item-details-task.ps1
# يسجّل مهمة Windows مجدولة ترفع توزيع مخزون الأصناف على المستودعات
# (يعرضه زر معلومات الصنف "i" داخل فاتورة المبيعات).
#
# السكربت المُشغَّل يقرأ من الأمين فقط ويكتب في inventory_reports بمصدر
# ameen_item_details وحده — لا يمسّ الأسعار ولا المخزون ولا مزامنة الإنتاج.
#
# الفاصل الافتراضي 60 دقيقة: التوزيع على المستودعات لا يتغيّر بسرعة، والاستعلام
# يمرّ على كل حركات الفواتير فيأخذ دقيقة تقريباً — فلا داعي لتكرار أكثر.
#
# التشغيل:  .\tools\register-item-details-task.ps1
#           .\tools\register-item-details-task.ps1 -IntervalMinutes 120
# الإلغاء:  Unregister-ScheduledTask -TaskName "TOBACCO Item Details Push" -Confirm:$false
# ============================================================

param(
    [int]$IntervalMinutes = 60
)

$taskName = "TOBACCO Item Details Push"
$scriptPath = "$PSScriptRoot\push-item-details.ps1"

if (-not (Test-Path $scriptPath)) {
    throw "لم أجد السكربت: $scriptPath"
}

# حارس: المهمة تُسجَّل بالمسار المطلق. تسجيلها من worktree مؤقّت ينتج مهمة تشير
# إلى مجلد يُحذف لاحقاً فتفشل بصمت. شغّل هذا من نسخة المستودع الأساسية فقط.
if ($scriptPath -like "*\.claude\worktrees\*") {
    throw "أنت داخل worktree مؤقّت. شغّل هذا السكربت من نسخة المستودع الأساسية: C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web"
}

# التسجيل بـRunLevel Highest يتطلب صلاحية مدير — نوضّحها برسالة مفهومة بدل "Access is denied".
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "هذا السكربت يحتاج تشغيل PowerShell كمسؤول (Run as administrator)."
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -Once -At (Get-Date)

# مهلة 10 دقائق: الاستعلام يمرّ على كل حركات الفواتير وقد يبطئ عند انشغال الخادم.
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "تم تسجيل المهمة المجدولة: '$taskName' كل $IntervalMinutes دقيقة" -ForegroundColor Green
Write-Host "المسار: $scriptPath" -ForegroundColor Cyan
Write-Host "للإلغاء: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor DarkGray
