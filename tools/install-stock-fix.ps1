# ============================================================
# install-stock-fix.ps1
# تركيب آمن لإصلاح حساب المخزون:
#   1) ينسخ الاستعلام القديم احتياطاً (ameen-stock-query.backup.sql)
#   2) ينزّل الاستعلام الجديد (v2 من الفواتير بأعلام bIsInput/bIsOutput)
#   3) يتحقق: «ماستر طويل ورق» يجب أن تساوي 21 والأصناف المرجعية تطابق
#   4) عند النجاح: يشغّل المزامنة فوراً؛ عند الفشل: يرجع النسخة القديمة
# التشغيل:  .\tools\install-stock-fix.ps1 -Sha <commit>
# ============================================================
param(
    [string]$Sha = "main",
    [string]$EnvFile = "$PSScriptRoot\.env"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$sqlPath = "$PSScriptRoot\ameen-stock-query.sql"
$backupPath = "$PSScriptRoot\ameen-stock-query.backup.sql"
$rawUrl = "https://raw.githubusercontent.com/fhwvtqdc2q-svg/tobacco-web/$Sha/tools/ameen-stock-query.sql"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_CONNECTION_STRING }
if (-not $connStr) { $connStr = [Environment]::GetEnvironmentVariable("AMEEN_SQL_CONNECTION_STRING", "User") }
if (-not $connStr) { Write-Host "خطأ: connection string غير موجود." -ForegroundColor Red; exit 1 }

# (1) نسخة احتياطية
if (Test-Path $sqlPath) {
    Copy-Item -LiteralPath $sqlPath -Destination $backupPath -Force
    Write-Host "✓ نسخة احتياطية: ameen-stock-query.backup.sql" -ForegroundColor Cyan
}

# (2) تنزيل الجديد
Invoke-WebRequest -Uri $rawUrl -OutFile $sqlPath
Write-Host "✓ نزّلت الاستعلام الجديد (v2)" -ForegroundColor Cyan

function Restore-Old($reason) {
    Write-Host ("✗ فشل التحقق: " + $reason) -ForegroundColor Red
    if (Test-Path $backupPath) {
        Copy-Item -LiteralPath $backupPath -Destination $sqlPath -Force
        Write-Host "↩ أرجعت الاستعلام القديم — لم يتغير شيء." -ForegroundColor Yellow
    }
    exit 1
}

# (3) التحقق قبل التفعيل
try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    Write-Host ""
    Write-Host "=== أعلام اتجاه أنواع الفواتير (للاطلاع) ===" -ForegroundColor Yellow
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT Name, BillType, bIsInput, bIsOutput FROM dbo.bt000 ORDER BY BillType, Name"
    $rd = $cmd.ExecuteReader()
    while ($rd.Read()) { Write-Host ("  {0} | صنف {1} | إدخال={2} إخراج={3}" -f $rd.GetValue(0), $rd.GetValue(1), $rd.GetValue(2), $rd.GetValue(3)) }
    $rd.Close()

    $query = Get-Content -Raw -LiteralPath $sqlPath
    $cmd2 = $conn.CreateCommand(); $cmd2.CommandTimeout = 180; $cmd2.CommandText = $query
    $rd2 = $cmd2.ExecuteReader()
    $results = @{}
    $count = 0
    while ($rd2.Read()) {
        $count++
        $n = ([string]$rd2["item_name"]).Trim()
        $results[$n] = [double]$rd2["stock_qty"]
    }
    $rd2.Close(); $conn.Close()

    Write-Host ""
    Write-Host "=== التحقق من الأصناف المرجعية ===" -ForegroundColor Yellow
    $expected = @{
        "ماستر طويل ورق"      = 21.0
        "ماستر طويل ورق ازرق" = 49.0
        "ماستر سليم أزرق"     = 123.0
        "غلواز قصير أحمر"     = 209.0
    }
    $allOk = $true
    foreach ($k in $expected.Keys) {
        $got = if ($results.ContainsKey($k)) { $results[$k] } else { $null }
        $ok = ($null -ne $got) -and ([math]::Abs($got - $expected[$k]) -lt 0.01)
        if (-not $ok) { $allOk = $false }
        Write-Host ("  {0}: الناتج {1} | المتوقع {2} {3}" -f $k, $got, $expected[$k], $(if ($ok) { "✓" } else { "✗" }))
    }
    Write-Host ("  إجمالي الأصناف: " + $count)

    if (-not $allOk -or $count -lt 100) { Restore-Old "الأرقام المرجعية لا تطابق أو عدد الأصناف قليل" }

    Write-Host ""
    Write-Host "✓✓ التحقق نجح — أشغّل المزامنة الآن..." -ForegroundColor Green
} catch {
    Restore-Old $_.Exception.Message
}

# (4) تشغيل المزامنة بالاستعلام الجديد
& "$PSScriptRoot\ameen-sync-agent.ps1" -Once
if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) {
    Write-Host ""
    Write-Host "تم! حدّث الموقع وتأكد أن «ماستر طويل ورق» = 21 كروز." -ForegroundColor Green
}
