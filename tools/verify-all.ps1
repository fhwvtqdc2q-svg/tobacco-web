# ============================================================
# verify-all.ps1  (قراءة فقط — لا يعدّل شيئاً)
# التدقيق الشامل: يقارن
#   (A) رصيد كل زبون في استعلام المزامنة مقابل مجموع دفتر القيود en000
#   (B) مخزون كل صنف في الاستعلام الجديد مقابل عرض الأمين الرسمي (إن وُجد)
# ويطبع أي فرق أكبر من 0.01. صفر فروق = مطابقة كاملة.
# التشغيل:  .\tools\verify-all.ps1
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$StockQueryPath = "$PSScriptRoot\ameen-stock-query.sql",
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

$fails = 0

# ============ (A) الأرصدة: استعلام المزامنة مقابل دفتر القيود ============
Write-Host ""
Write-Host "========== (A) تدقيق أرصدة الزبائن ==========" -ForegroundColor Cyan
try {
    if (-not (Test-Path $BalancesQueryPath)) { throw "ملف استعلام الأرصدة غير موجود: $BalancesQueryPath" }
    $balRows = Get-Rows (Get-Content -Raw -LiteralPath $BalancesQueryPath)
    Write-Host ("زبائن استعلام المزامنة: " + $balRows.Count)

    $ledger = Get-Rows @"
SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
       CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0)) AS decimal(18,3)) AS ledger_balance
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE cu.CustomerName IS NOT NULL AND LTRIM(RTRIM(cu.CustomerName)) <> ''
GROUP BY LTRIM(RTRIM(cu.CustomerName))
"@
    $ledgerMap = @{}
    foreach ($r in $ledger) { $ledgerMap[[string]$r.name] = [double]$r.ledger_balance }

    $mismatch = 0; $checked = 0
    foreach ($r in $balRows) {
        $name = ([string]$r.customer_name).Trim()
        if (-not $name) { continue }
        $syncBal = [double]$r.balance
        if (-not $ledgerMap.ContainsKey($name)) {
            if ([math]::Abs($syncBal) -gt 0.01) {
                Write-Host ("  ✗ $name : المزامنة $syncBal لكنه غير موجود في دفتر القيود") -ForegroundColor Red
                $mismatch++
            }
            continue
        }
        $checked++
        $diff = [math]::Abs($syncBal - $ledgerMap[$name])
        if ($diff -gt 0.01) {
            $mismatch++
            if ($mismatch -le 15) {
                Write-Host ("  ✗ $name : المزامنة {0} | الدفتر {1} | الفرق {2}" -f $syncBal, $ledgerMap[$name], [math]::Round($diff, 3)) -ForegroundColor Red
            }
        }
    }
    Write-Host ("تمت مقارنة: $checked زبوناً — الفروق: $mismatch") -ForegroundColor $(if ($mismatch -eq 0) { "Green" } else { "Red" })
    if ($mismatch -eq 0) { Write-Host "✓✓ كل الأرصدة مطابقة لدفتر القيود" -ForegroundColor Green } else { $fails++ }
} catch {
    Write-Host ("تعذّر تدقيق الأرصدة: " + $_.Exception.Message) -ForegroundColor Red
    $fails++
}

# ============ (B) المخزون: الاستعلام الجديد مقابل عرض الأمين الرسمي ============
Write-Host ""
Write-Host "========== (B) تدقيق كميات المخزون ==========" -ForegroundColor Cyan
try {
    if (-not (Test-Path $StockQueryPath)) { throw "ملف استعلام المخزون غير موجود: $StockQueryPath" }
    $stockRows = Get-Rows (Get-Content -Raw -LiteralPath $StockQueryPath)
    Write-Host ("أصناف استعلام المزامنة: " + $stockRows.Count)
    $stockMap = @{}
    foreach ($r in $stockRows) { $stockMap[([string]$r.item_guid).ToUpperInvariant()] = [double]$r.stock_qty_net }

    # نبحث عن عرض رسمي للكميات: نطبع أعمدة المرشحين ثم نقارن إن أمكن
    $views = @("vwMatQtys", "vwMaterialInventory")
    $compared = $false
    foreach ($v in $views) {
        try {
            $cols = Get-Rows "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '$v'"
            if (-not $cols.Count) { continue }
            $colNames = @($cols | ForEach-Object { [string]$_.COLUMN_NAME })
            Write-Host ""
            Write-Host ("أعمدة $v : " + ($colNames -join ", ")) -ForegroundColor Yellow
            $guidCol = $colNames | Where-Object { $_ -match "Mat.*GUID|Material.*GUID" } | Select-Object -First 1
            if (-not $guidCol) { $guidCol = $colNames | Where-Object { $_ -eq "GUID" } | Select-Object -First 1 }
            $qtyCol = $colNames | Where-Object { $_ -match "^Qty$|NetQty|CurQty|TotalQty" } | Select-Object -First 1
            if (-not $guidCol -or -not $qtyCol) {
                Write-Host "  (لم أتعرف على أعمدة GUID/كمية — أطبع عيّنة للمراجعة)" -ForegroundColor Yellow
                $sample = Get-Rows "SELECT TOP 3 * FROM dbo.$v"
                foreach ($s in $sample) { Write-Host ("  " + (($s.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " | ")) }
                continue
            }
            Write-Host ("سأقارن عبر: $guidCol / $qtyCol") -ForegroundColor Yellow
            $official = Get-Rows "SELECT CAST([$guidCol] AS varchar(40)) AS g, SUM(CAST(COALESCE([$qtyCol],0) AS decimal(18,3))) AS q FROM dbo.$v GROUP BY CAST([$guidCol] AS varchar(40))"
            $mismatch2 = 0; $checked2 = 0
            foreach ($o in $official) {
                $g = ([string]$o.g).ToUpperInvariant()
                if (-not $stockMap.ContainsKey($g)) { continue }
                $checked2++
                $diff = [math]::Abs([double]$o.q - $stockMap[$g])
                if ($diff -gt 0.01) {
                    $mismatch2++
                    if ($mismatch2 -le 15) {
                        $nm = ($stockRows | Where-Object { ([string]$_.item_guid).ToUpperInvariant() -eq $g } | Select-Object -First 1).item_name
                        Write-Host ("  ✗ {0}: العرض الرسمي {1} | استعلامنا {2}" -f $nm, $o.q, $stockMap[$g]) -ForegroundColor Red
                    }
                }
            }
            Write-Host ("تمت مقارنة: $checked2 صنفاً مع $v — الفروق: $mismatch2") -ForegroundColor $(if ($mismatch2 -eq 0) { "Green" } else { "Red" })
            if ($mismatch2 -eq 0 -and $checked2 -gt 100) { Write-Host "✓✓ كل الكميات مطابقة لعرض الأمين الرسمي" -ForegroundColor Green }
            elseif ($mismatch2 -gt 0) { $fails++ }
            $compared = $true
            break
        } catch { Write-Host ("  $v : " + $_.Exception.Message) -ForegroundColor Yellow }
    }
    if (-not $compared) { Write-Host "لم أجد عرضاً رسمياً قابلاً للمقارنة — اكتفِ بالتحقق اليدوي لعيّنة أصناف." -ForegroundColor Yellow }
} catch {
    Write-Host ("تعذّر تدقيق المخزون: " + $_.Exception.Message) -ForegroundColor Red
    $fails++
}

Write-Host ""
if ($fails -eq 0) { Write-Host "================ النتيجة: التدقيق الشامل سليم ✓✓ ================" -ForegroundColor Green }
else { Write-Host "================ يوجد فروق — أرسل الناتج كاملاً ================" -ForegroundColor Red }
