# ============================================================
# install-order-fix.ps1
# تركيب آمن لإصلاح ترتيب قيود اليوم الواحد (وقت إنشاء السند ce000.CreateDate):
#   1) يتحقق أولاً: 13 رصيداً مرجعياً من كشفَي «حسن عباس» و«مركز شريفة» يجب أن تطابق
#   2) عند النجاح فقط: يحفظ نسخة احتياطية، ينزّل مزامنة الحركات المحدّثة، ويشغّلها
#   3) عند الفشل: لا يغيّر شيئاً إطلاقاً
# التشغيل:  .\tools\install-order-fix.ps1 -Sha <commit>
# ============================================================
param(
    [string]$Sha = "main",
    [string]$EnvFile = "$PSScriptRoot\.env"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$scriptPath = "$PSScriptRoot\push-customer-movements.ps1"
$backupPath = "$PSScriptRoot\push-customer-movements.backup.ps1"
$rawUrl = "https://raw.githubusercontent.com/fhwvtqdc2q-svg/tobacco-web/$Sha/tools/push-customer-movements.ps1"

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

# ===== (1) التحقق من الترتيب الجديد على أرصدة مرجعية من كشوف الأمين المصوّرة =====
Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandTimeout = 180
$cmd.CommandText = @"
WITH led AS (
    SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
           COALESCE(CASE WHEN ce.Date >= '2000-01-01' THEN ce.Date END, en.Date) AS dt,
           CASE WHEN COALESCE(en.Notes,'') LIKE N'%افتتاح%' THEN 0 ELSE 1 END AS isopen,
           CASE WHEN COALESCE(en.Credit,0) > 0 THEN 1 ELSE 0 END AS iscredit,
           COALESCE(ce.CreateDate, en.Date) AS sortdt,
           COALESCE(ce.Number, 0) AS cenum,
           en.Number AS num,
           CAST(COALESCE(en.Debit,0)  AS decimal(18,3)) AS debit,
           CAST(COALESCE(en.Credit,0) AS decimal(18,3)) AS credit,
           CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0))
                OVER (PARTITION BY en.AccountGUID
                      ORDER BY COALESCE(CASE WHEN ce.Date >= '2000-01-01' THEN ce.Date END, en.Date),
                               CASE WHEN COALESCE(en.Notes,'') LIKE N'%افتتاح%' THEN 0 ELSE 1 END,
                               CASE WHEN COALESCE(en.Credit,0) > 0 THEN 1 ELSE 0 END,
                               COALESCE(ce.CreateDate, en.Date),
                               COALESCE(ce.Number, 0),
                               en.Number
                      ROWS UNBOUNDED PRECEDING) AS decimal(18,3)) AS balance
    FROM dbo.en000 en
    JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
    LEFT JOIN dbo.ce000 ce ON ce.GUID = en.ParentGUID
    WHERE (COALESCE(en.Debit,0) > 0 OR COALESCE(en.Credit,0) > 0)
)
SELECT name, CONVERT(varchar(10), dt, 120) AS d, debit, credit, balance
FROM led
WHERE name IN (N'حسن عباس / عدرا العمالية', N'مركز شريفة / اسعد شريفة')
ORDER BY name, dt, isopen, iscredit, sortdt, cenum, num
"@
$rows = New-Object System.Collections.Generic.List[object]
$rd = $cmd.ExecuteReader()
while ($rd.Read()) {
    $rows.Add([PSCustomObject]@{
        name = ([string]$rd.GetValue(0)).Trim()
        d = [string]$rd.GetValue(1)
        debit = [double]$rd.GetValue(2)
        credit = [double]$rd.GetValue(3)
        balance = [double]$rd.GetValue(4)
    })
}
$rd.Close(); $conn.Close()

Write-Host ""
Write-Host "=== القيود بالترتيب الجديد (قارنها بكشوف الأمين) ===" -ForegroundColor Yellow
foreach ($r in $rows) {
    Write-Host ("  {0} | {1} | مدين {2} | دائن {3} | رصيد {4}" -f $r.name, $r.d, $r.debit, $r.credit, $r.balance)
}

# المراجع: (اسم، مدين، دائن، الرصيد المتوقع من كشف الأمين) — سماحية 0.02
$refs = @(
    @("حسن عباس", 14419.47, 0, 14419.47),
    @("حسن عباس", 2323.70, 0, 16743.17),
    @("حسن عباس", 0, 2285.00, 14458.17),
    @("حسن عباس", 0, 1400.00, 13058.17),
    @("حسن عباس", 0, 500.00, 14388.67),
    @("حسن عباس", 4830.50, 0, 17888.67),
    @("حسن عباس", 0, 3000.00, 14888.67),
    @("حسن عباس", 6007.00, 0, 20395.67),
    @("حسن عباس", 0, 2750.00, 17645.67),
    @("حسن عباس", 0, 450.00, 17195.67),
    @("مركز شريفة", 4894.52, 0, 11875.70),
    @("مركز شريفة", 2734.80, 0, 12610.50),
    @("مركز شريفة", 0, 2500.00, 10110.50)
)

Write-Host ""
Write-Host "=== التحقق من الأرصدة المرجعية (13 رصيداً من كشفَي الأمين) ===" -ForegroundColor Yellow
$allOk = $true
foreach ($ref in $refs) {
    $who = $ref[0]; $wd = [double]$ref[1]; $wc = [double]$ref[2]; $want = [double]$ref[3]
    $match = $rows | Where-Object {
        $_.name -like "*$who*" -and
        [math]::Abs($_.debit - $wd) -lt 0.02 -and
        [math]::Abs($_.credit - $wc) -lt 0.02
    } | Select-Object -First 1
    $got = if ($match) { $match.balance } else { $null }
    $ok = ($null -ne $got) -and ([math]::Abs($got - $want) -lt 0.02)
    if (-not $ok) { $allOk = $false }
    $side = if ($wd -gt 0) { "مدين $wd" } else { "دائن $wc" }
    Write-Host ("  {0} ({1}): الناتج {2} | كشف الأمين {3} {4}" -f $who, $side, $got, $want, $(if ($ok) { "✓" } else { "✗" }))
}

if (-not $allOk) {
    Write-Host ""
    Write-Host "✗ الترتيب الجديد لا يطابق كشف الأمين — لم أغيّر شيئاً. أرسل الناتج." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✓✓ كل الأرصدة المرجعية مطابقة — أركّب مزامنة الحركات المحدّثة..." -ForegroundColor Green

# ===== (2) نسخة احتياطية + تنزيل + تشغيل =====
if (Test-Path $scriptPath) {
    Copy-Item -LiteralPath $scriptPath -Destination $backupPath -Force
    Write-Host "✓ نسخة احتياطية: push-customer-movements.backup.ps1" -ForegroundColor Cyan
}
Invoke-WebRequest -Uri $rawUrl -OutFile $scriptPath
Write-Host "✓ نزّلت مزامنة الحركات المحدّثة" -ForegroundColor Cyan

& $scriptPath
Write-Host ""
Write-Host "تم! حدّث الموقع وأعد طباعة سند 450 لحسن عباس — يجب أن يظهر 17,195.67." -ForegroundColor Green
