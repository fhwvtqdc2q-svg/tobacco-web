# ============================================================
# check-ameen-balances-2.ps1  (قراءة فقط — لا يعدّل أي شيء)
# الجولة الثانية: أين الرصيد الصحيح؟
# - رصيد الزبون المخزن في cu000 (Debit/Credit)
# - هل أنواع فواتير البيع تولّد قيودًا محاسبية؟ (bt000.bNoEntry)
# - مجاميع فواتير الزبون من جدول الفواتير
# - جدول العملات my000
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutFile = "$PSScriptRoot\logs\ameen-balance-check-2.txt"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) {
    Write-Host "خطأ: AMEEN_SQL_WRITE_CONNECTION_STRING غير موجود في tools\.env" -ForegroundColor Red
    exit 1
}

$logDir = Split-Path $OutFile -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
"" | Set-Content -Path $OutFile -Encoding UTF8

function Write-Both($text) {
    Write-Host $text
    $text | Add-Content -Path $OutFile -Encoding UTF8
}

function Run-Query($conn, $sql, $maxRows = 60) {
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $reader = $cmd.ExecuteReader()
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        Write-Both ("الأعمدة: " + ($cols -join " | "))
        $count = 0
        while ($reader.Read() -and $count -lt $maxRows) {
            $vals = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $v = $reader.GetValue($i)
                if ($v -is [string] -and $v.Length -gt 50) { $v = $v.Substring(0, 50) }
                $vals += "$v"
            }
            Write-Both ("  " + ($vals -join " | "))
            $count++
        }
        $reader.Close()
        return $true
    } catch {
        Write-Both ("  تعذّر: " + $_.Exception.Message)
        return $false
    }
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    Write-Both "=== (1) العملات my000 ==="
    Run-Query $conn "SELECT TOP 10 * FROM my000" 10 | Out-Null

    Write-Both ""
    Write-Both "=== (2) عدد العملات المستخدمة فعليًا في القيود en000 ==="
    Run-Query $conn "SELECT CurrencyGUID, COUNT(*) AS entries FROM en000 GROUP BY CurrencyGUID" 10 | Out-Null

    Write-Both ""
    Write-Both "=== (3) أرصدة العينة المخزنة في بطاقة الزبون cu000 (Debit/Credit/MaxDebit) ==="
    Run-Query $conn @"
SELECT CustomerName, Debit, Credit, CAST(Debit - Credit AS decimal(18,3)) AS card_balance, MaxDebit
FROM cu000
WHERE LTRIM(RTRIM(CustomerName)) IN (N'الحاج ابو ظافر', N'هادي الغميان ركن الدين', N'ابو علي اسعد / جرمانا', N'مركز شريفة / اسعد شريفة')
"@ 10 | Out-Null

    Write-Both ""
    Write-Both "=== (4) هل أنواع فواتير البيع تولّد قيودًا؟ ==="
    Run-Query $conn @"
SELECT Name, bNoEntry, bAutoEntry, bAutoEntryPost, bNoPost, bAutoPost
FROM bt000
WHERE Name IN (N'مبيعات مركز', N'مبيعات', N'طلبيات', N'مسودة', N'مرتجع مبيعات', N'مرتجع مبيعات مركز', N'مرتجع الطلبيات')
"@ 10 | Out-Null

    Write-Both ""
    Write-Both "=== (5) جدول الفواتير: أعمدة bi000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bi000' ORDER BY ORDINAL_POSITION" 80 | Out-Null

    Write-Both ""
    Write-Both "=== (6) مجاميع فواتير الحاج ابو ظافر حسب نوع الفاتورة ==="
    $ok = Run-Query $conn @"
SELECT bt.Name AS BillType, COUNT(*) AS bills,
       CAST(SUM(COALESCE(bi.TotalPrice,0)) AS decimal(18,3)) AS total,
       MIN(bi.Date) AS first_bill, MAX(bi.Date) AS last_bill
FROM bi000 bi
JOIN bt000 bt ON bt.GUID = bi.ParentGUID
JOIN cu000 cu ON cu.GUID = bi.CustomerGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = N'الحاج ابو ظافر'
GROUP BY bt.Name
"@ 15
    if (-not $ok) {
        Write-Both "--- محاولة بديلة: عينة 5 فواتير خام للزبون ---"
        Run-Query $conn @"
SELECT TOP 5 bi.* FROM bi000 bi
JOIN cu000 cu ON cu.GUID = bi.CustomerGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = N'الحاج ابو ظافر'
"@ 5 | Out-Null
    }

    Write-Both ""
    Write-Both "=== (7) قيود الحاج ابو ظافر: عينة آخر 15 قيدًا (تاريخ/مدين/دائن/بيان) ==="
    Run-Query $conn @"
SELECT TOP 15 en.Date, en.Debit, en.Credit, en.Notes, en.CurrencyVal
FROM en000 en
JOIN cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = N'الحاج ابو ظافر'
ORDER BY en.Date DESC
"@ 15 | Out-Null

    $conn.Close()
    Write-Both ""
    Write-Both "تم. أرسل هذا الملف: $OutFile"
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    ("خطأ: " + $_.Exception.Message) | Add-Content -Path $OutFile -Encoding UTF8
}
