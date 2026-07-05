# ============================================================
# discover-item-stock-3.ps1  (قراءة فقط)
# يطبع باقي ameen-sync-agent.ps1 (الأسطر 1-149 وَ 300 حتى النهاية) —
# لرؤية استعلام SQL الذي يحسب المخزون وإصلاح ازدواج «بضاعة أول المدة».
# التشغيل:  .\tools\discover-item-stock-3.ps1
# ============================================================
param()

$agent = "$PSScriptRoot\ameen-sync-agent.ps1"
if (-not (Test-Path $agent)) {
    Write-Host "ameen-sync-agent.ps1 غير موجود في tools\" -ForegroundColor Red
    exit 1
}
$lines = Get-Content $agent
Write-Host ("إجمالي أسطر الملف: " + $lines.Count) -ForegroundColor Cyan

Write-Host ""
Write-Host "=== الأسطر 1 إلى 149 ===" -ForegroundColor Yellow
for ($i = 0; $i -le [Math]::Min(148, $lines.Count - 1); $i++) {
    Write-Host ("{0,4}: {1}" -f ($i + 1), $lines[$i])
}

Write-Host ""
Write-Host "=== الأسطر 300 حتى النهاية ===" -ForegroundColor Yellow
for ($i = 299; $i -le $lines.Count - 1; $i++) {
    Write-Host ("{0,4}: {1}" -f ($i + 1), $lines[$i])
}
