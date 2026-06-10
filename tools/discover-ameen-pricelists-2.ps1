# ============================================================
# discover-ameen-pricelists-2.ps1  (قراءة فقط — لا يعدّل أي شيء)
# الجولة الثانية: جدول المواد، عينة أسعار من كل قائمة،
# وربط أنواع الفواتير بقوائم الأسعار.
# شغّله على لابتوب الأمين، وأرسل ملف الناتج.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutFile = "$PSScriptRoot\logs\ameen-schema-report-2.txt"
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
                if ($v -is [string] -and $v.Length -gt 45) { $v = $v.Substring(0, 45) }
                $vals += "$v"
            }
            Write-Both ("  " + ($vals -join " | "))
            $count++
        }
        $reader.Close()
    } catch {
        Write-Both ("  تعذّر: " + $_.Exception.Message)
    }
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    Write-Both "=== (1) جدول المواد: الجداول التي فيها أعمدة GUID وName وUnit1 ==="
    Run-Query $conn @"
SELECT c1.TABLE_NAME
FROM INFORMATION_SCHEMA.COLUMNS c1
JOIN INFORMATION_SCHEMA.COLUMNS c2 ON c2.TABLE_NAME = c1.TABLE_NAME AND c2.COLUMN_NAME = 'Name'
JOIN INFORMATION_SCHEMA.COLUMNS c3 ON c3.TABLE_NAME = c1.TABLE_NAME AND c3.COLUMN_NAME = 'Unit1'
WHERE c1.COLUMN_NAME = 'GUID'
GROUP BY c1.TABLE_NAME
ORDER BY c1.TABLE_NAME
"@

    Write-Both ""
    Write-Both "=== (2) أعمدة جدول Materials000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Materials000' ORDER BY ORDINAL_POSITION" 80

    Write-Both ""
    Write-Both "=== (3) عدد الأصناف في كل قائمة أسعار ==="
    Run-Query $conn @"
SELECT pl.Name AS PriceList, pl.GUID, COUNT(i.GUID) AS ItemsCount
FROM MaterialPriceList000 pl
LEFT JOIN MaterialPriceListItem000 i ON i.ParentGUID = pl.GUID
GROUP BY pl.Name, pl.GUID
"@

    Write-Both ""
    Write-Both "=== (4) عينة أسعار من كل قائمة (مع اسم المادة ووحداتها) ==="
    $lists = @()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT Name, GUID FROM MaterialPriceList000"
    $r = $cmd.ExecuteReader()
    while ($r.Read()) { $lists += @{ Name = $r.GetValue(0); Guid = $r.GetValue(1) } }
    $r.Close()
    foreach ($list in $lists) {
        Write-Both ("--- قائمة: $($list.Name) ---")
        Run-Query $conn @"
SELECT TOP 15 m.Name AS MaterialName, m.Unit1, m.Unit2, m.Unit2Fact,
       i.Unit1Price, i.Unit2Price, i.Unit3Price
FROM MaterialPriceListItem000 i
JOIN Materials000 m ON m.GUID = i.MaterialGUID
WHERE i.ParentGUID = '$($list.Guid)'
ORDER BY m.Name
"@ 15
        Write-Both ""
    }

    Write-Both ""
    Write-Both "=== (5) الجداول/الأعمدة التي تشير إلى قوائم الأسعار (لمعرفة أي شاشة تستخدم أي قائمة) ==="
    Run-Query $conn "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME LIKE '%PriceList%' AND TABLE_NAME NOT IN ('MaterialPriceList000','MaterialPriceListItem000') ORDER BY TABLE_NAME" 80

    Write-Both ""
    Write-Both "=== (6) تعريف أنواع الفواتير (نبحث عن مبيعات المركز وقائمتها) ==="
    foreach ($t in @("BillsDef000", "BillDef000", "vwBillsDef")) {
        Write-Both ("--- جدول: $t ---")
        Run-Query $conn "SELECT TOP 40 * FROM [$t]" 40
        Write-Both ""
    }

    $conn.Close()
    Write-Both ""
    Write-Both "تم. أرسل هذا الملف: $OutFile"
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    ("خطأ: " + $_.Exception.Message) | Add-Content -Path $OutFile -Encoding UTF8
}
