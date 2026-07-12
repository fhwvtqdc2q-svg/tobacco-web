# ============================================================
# set-ameen-write-connection.ps1
# يسألك اسم المستخدم وكلمة السر لحساب الكتابة على الأمين،
# ويحفظهم تلقائياً بالشكل الصحيح داخل tools\.env
# ============================================================
# الاستخدام: .\tools\set-ameen-write-connection.ps1
# ============================================================

$envFile = "$PSScriptRoot\.env"

Write-Host "=== إعداد اتصال الكتابة على الأمين ===" -ForegroundColor Cyan
Write-Host ""

$server = Read-Host "اسم السيرفر (اضغط Enter للقيمة الافتراضية: OZK-TOBACCO)"
if ([string]::IsNullOrWhiteSpace($server)) { $server = "OZK-TOBACCO" }

$database = Read-Host "اسم قاعدة البيانات (اضغط Enter للقيمة الافتراضية: AmnDb002)"
if ([string]::IsNullOrWhiteSpace($database)) { $database = "AmnDb002" }

$userId = Read-Host "اسم المستخدم (User Id) لحساب الكتابة"

$securePassword = Read-Host "كلمة السر (لن تظهر وأنت تكتبها)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($userId) -or [string]::IsNullOrWhiteSpace($plainPassword)) {
    Write-Host "خطأ: اسم المستخدم أو كلمة السر فاضيين — لم يُحفظ شي." -ForegroundColor Red
    exit 1
}

$connString = "AMEEN_SQL_WRITE_CONNECTION_STRING=Server=$server;Database=$database;User Id=$userId;Password=$plainPassword;"

# احذف أي سطر قديم بنفس الاسم، ثم أضف السطر الجديد
$lines = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
$lines = $lines | Where-Object { $_ -notmatch '^\s*AMEEN_SQL_WRITE_CONNECTION_STRING\s*=' }
$lines += $connString
Set-Content -Path $envFile -Value $lines -Encoding UTF8

Write-Host ""
Write-Host "✓ تم الحفظ بنجاح في tools\.env" -ForegroundColor Green
Write-Host "  السيرفر: $server" -ForegroundColor Gray
Write-Host "  القاعدة: $database" -ForegroundColor Gray
Write-Host "  المستخدم: $userId" -ForegroundColor Gray
Write-Host "  كلمة السر: (محفوظة، غير معروضة)" -ForegroundColor Gray
