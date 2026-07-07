# ============================================================
# verify-balances-all.ps1  (قراءة فقط — لا يعدّل شيئاً)
# التدقيق الشامل للأرصدة المتحركة على كل الزبائن:
#   (1) لكل زبون: مسار الرصيد قيداً قيداً يجب أن يكون متسقاً (رصيد كل سطر
#       = رصيد السطر السابق + مدين − دائن) بترتيب الأمين المعتمد.
#   (2) الرصيد الختامي لكل زبون يجب أن يساوي مجموع دفتر القيود (مصدر مستقل).
#   (3) ويساوي رصيد استعلام مزامنة الأرصدة (مصدر ثالث).
# صفر فروق = كل الحسابات سليمة.
# التشغيل:  .\tools\verify-balances-all.ps1
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$BalancesQueryPath = "$PSScriptRoot\ameen-customer-balances-query.sql"
)

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

Add-Type -AssemblyName "System.Data"
function Get-Rows($sql) {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    $cmd = $conn.CreateCommand(); $cmd.CommandTimeout = 300; $cmd.CommandText = $sql
    $rd = $cmd.ExecuteReader()
    $rows = New-Object System.Collections.Generic.List[object]
    while ($rd.Read()) {
        $row = [ordered]@{}
        for ($i = 0; $i -lt $rd.FieldCount; $i++) {
            $row[$rd.GetName($i)] = if ($rd.IsDBNull($i)) { $null } else { $rd.GetValue($i) }
        }
        $rows.Add([PSCustomObject]$row)
    }
    $rd.Close(); $conn.Close()
    return $rows
}

Write-Host ""
Write-Host "========== التدقيق الشامل للأرصدة المتحركة (كل الزبائن) ==========" -ForegroundColor Cyan

# ===== جلب كل القيود بترتيب الأمين المعتمد مع الرصيد المتحرك =====
$rows = Get-Rows @"
WITH led AS (
    SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
           en.AccountGUID AS acc,
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
      AND cu.CustomerName IS NOT NULL AND LTRIM(RTRIM(cu.CustomerName)) <> ''
      AND (cu.bHide IS NULL OR cu.bHide = 0)
)
SELECT name, debit, credit, balance
FROM led
ORDER BY name, dt, isopen, iscredit, sortdt, cenum, num
"@
Write-Host ("إجمالي القيود: " + $rows.Count)

# ===== (1) اتساق المسار قيداً قيداً لكل زبون =====
$walkErrors = 0
$running = @{}
$lastBalance = @{}
$moveCount = @{}
foreach ($r in $rows) {
    $n = [string]$r.name
    if (-not $running.ContainsKey($n)) { $running[$n] = 0.0; $moveCount[$n] = 0 }
    $running[$n] = [math]::Round($running[$n] + [double]$r.debit - [double]$r.credit, 3)
    $moveCount[$n]++
    if ([math]::Abs($running[$n] - [double]$r.balance) -gt 0.005) {
        $walkErrors++
        if ($walkErrors -le 10) {
            Write-Host ("  ✗ {0}: قيد (مدين {1} دائن {2}) رصيده {3} والمتوقع {4}" -f $n, $r.debit, $r.credit, $r.balance, $running[$n]) -ForegroundColor Red
        }
        $running[$n] = [double]$r.balance
    }
    $lastBalance[$n] = [double]$r.balance
}
$custCount = $lastBalance.Keys.Count
Write-Host ""
Write-Host ("(1) اتساق مسار الرصيد: {0} زبوناً، {1} قيداً — أخطاء: {2}" -f $custCount, $rows.Count, $walkErrors) -ForegroundColor $(if ($walkErrors -eq 0) { "Green" } else { "Red" })

# ===== (2) الختامي مقابل مجموع دفتر القيود (مستقل) =====
$sums = Get-Rows @"
SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
       CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0)) AS decimal(18,3)) AS total
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE cu.CustomerName IS NOT NULL AND LTRIM(RTRIM(cu.CustomerName)) <> ''
  AND (cu.bHide IS NULL OR cu.bHide = 0)
GROUP BY LTRIM(RTRIM(cu.CustomerName))
"@
$sumErrors = 0
foreach ($s in $sums) {
    $n = [string]$s.name
    if (-not $lastBalance.ContainsKey($n)) { continue }
    if ([math]::Abs($lastBalance[$n] - [double]$s.total) -gt 0.005) {
        $sumErrors++
        if ($sumErrors -le 10) { Write-Host ("  ✗ {0}: ختامي المسار {1} ≠ مجموع الدفتر {2}" -f $n, $lastBalance[$n], $s.total) -ForegroundColor Red }
    }
}
Write-Host ("(2) الختامي مقابل مجموع الدفتر: فروق = $sumErrors") -ForegroundColor $(if ($sumErrors -eq 0) { "Green" } else { "Red" })

# ===== (3) الختامي مقابل استعلام مزامنة الأرصدة (مصدر ثالث) =====
if (Test-Path $BalancesQueryPath) {
    $bal = Get-Rows (Get-Content -Raw -LiteralPath $BalancesQueryPath)
    $balErrors = 0; $balChecked = 0
    foreach ($b in $bal) {
        $n = ([string]$b.customer_name).Trim()
        if (-not $lastBalance.ContainsKey($n)) { continue }
        $balChecked++
        if ([math]::Abs($lastBalance[$n] - [double]$b.balance) -gt 0.005) {
            $balErrors++
            if ($balErrors -le 10) { Write-Host ("  ✗ {0}: ختامي المسار {1} ≠ مزامنة الأرصدة {2}" -f $n, $lastBalance[$n], $b.balance) -ForegroundColor Red }
        }
    }
    Write-Host ("(3) الختامي مقابل مزامنة الأرصدة: قورن $balChecked زبوناً — فروق = $balErrors") -ForegroundColor $(if ($balErrors -eq 0) { "Green" } else { "Red" })
} else {
    $balErrors = 0
    Write-Host "(3) ملف استعلام الأرصدة غير موجود — تخطّيت المقارنة الثالثة." -ForegroundColor Yellow
}

Write-Host ""
if (($walkErrors + $sumErrors + $balErrors) -eq 0) {
    Write-Host "================ كل الحسابات سليمة: صفر فروق على $custCount زبوناً ✓✓ ================" -ForegroundColor Green
} else {
    Write-Host "================ يوجد فروق — أرسل الناتج كاملاً ================" -ForegroundColor Red
}
