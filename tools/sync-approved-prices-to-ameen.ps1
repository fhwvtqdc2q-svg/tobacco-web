# ============================================================
# sync-approved-prices-to-ameen.ps1
# يسحب الأسعار من Supabase ويطبّقها على قاعدة بيانات الأمين
# ============================================================

param(
    [switch]$Apply,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$CsvFile = "$PSScriptRoot\..\reports\prices\tobacco-approved-prices.csv",
    [string]$LogFile = "$PSScriptRoot\logs\approved-prices-sync.log"
)

# الخطوة 1: سحب الأسعار من Supabase
Write-Host "الخطوة 1: سحب الأسعار من Supabase..." -ForegroundColor Cyan
& "$PSScriptRoot\pull-approved-prices.ps1" -EnvFile $EnvFile -OutputCsv $CsvFile -LogFile $LogFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "فشل سحب الأسعار!" -ForegroundColor Red
    exit 1
}

if (-not $Apply) {
    Write-Host "وضع المعاينة — لم يتم التطبيق على الأمين. استخدم -Apply للتطبيق الفعلي." -ForegroundColor Yellow
    exit 0
}

# الخطوة 2: تطبيق الأسعار على الأمين
Write-Host "الخطوة 2: تطبيق الأسعار على الأمين..." -ForegroundColor Cyan
& "$PSScriptRoot\apply-approved-prices-to-ameen.ps1" -CsvFile $CsvFile -EnvFile $EnvFile -LogFile $LogFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "فشل تطبيق الأسعار على الأمين!" -ForegroundColor Red
    # إشعار تيليغرام عند الفشل (مرة كل ساعة كحد أقصى لنفس العطل)
    try {
        & "$PSScriptRoot\send-telegram-notification.ps1" `
            -Message "🚨 فشل تطبيق الأسعار على قاعدة الأمين (sync-approved-prices-to-ameen)" `
            -EventType "sync_failure" -DedupeKey "winfail:apply-to-ameen" -DedupeMinutes 60 `
            -EnvFile $EnvFile
    } catch { }
    exit 1
}

Write-Host "تمت المزامنة الكاملة بنجاح ✓" -ForegroundColor Green
