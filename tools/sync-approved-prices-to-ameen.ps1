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

# فحص مستقل بعد الكتابة، ثم نشر النتيجة للبوت. لا نكتفي بعدّ الصفوف التي حاولنا تحديثها.
$verificationFile = [IO.Path]::GetTempFileName()
& "$PSScriptRoot\verify-prices.ps1" -ResultFile $verificationFile *> $null
$verification = if (Test-Path $verificationFile) { [IO.File]::ReadAllText($verificationFile, [Text.Encoding]::ASCII) } else { "" }
Remove-Item -LiteralPath $verificationFile -Force -ErrorAction SilentlyContinue
$machineResult = [regex]::Match($verification, 'PRICE_VERIFY wholesale=(\d+) retail=(\d+) mismatches=(\d+) missing=(\d+)')
if ($machineResult.Success) {
    $wholesaleMatched = [int]$machineResult.Groups[1].Value
    $retailMatched = [int]$machineResult.Groups[2].Value
    $mismatchCount = [int]$machineResult.Groups[3].Value
    $missingCount = [int]$machineResult.Groups[4].Value
    $status = if (($mismatchCount + $missingCount) -eq 0) { "ok" } else { "mismatch" }
    & "$PSScriptRoot\publish-price-sync-status.ps1" -Status $status `
        -WholesaleMatched $wholesaleMatched -RetailMatched $retailMatched `
        -MismatchCount $mismatchCount -MissingCount $missingCount
    if ($status -ne "ok") {
        & "$PSScriptRoot\send-telegram-notification.ps1" `
            -Message "⚠️ مزامنة الأسعار ليست مكتملة`nفروقات: $mismatchCount — مواد ناقصة: $missingCount" `
            -EventType "price_sync_mismatch" -DedupeKey "price-sync:mismatch" -DedupeMinutes 30 -EnvFile $EnvFile
        exit 2
    }
} else {
    & "$PSScriptRoot\publish-price-sync-status.ps1" -Status "error" -Message "تعذر تحليل نتيجة فحص الأسعار"
    & "$PSScriptRoot\send-telegram-notification.ps1" `
        -Message "🚨 تعذر التحقق من مزامنة الأسعار مع الأمين" `
        -EventType "price_sync_failure" -DedupeKey "price-sync:verify-failed" -DedupeMinutes 60 -EnvFile $EnvFile
    exit 3
}
