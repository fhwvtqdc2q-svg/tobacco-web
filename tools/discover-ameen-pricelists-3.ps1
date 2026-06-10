# ============================================================
# discover-ameen-pricelists-3.ps1  (قراءة فقط — لا يعدّل أي شيء)
# الجولة الثالثة: جدول المواد mt000 وأنواع الفواتير bt000
# وعينة أسعار من كل قائمة.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutFile = "$PSScriptRoot\logs\ameen-schema-report-3.txt"
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

    Write-Both "=== (1) أعمدة جدول المواد mt000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'mt000' ORDER BY ORDINAL_POSITION" 100 | Out-Null

    Write-Both ""
    Write-Both "=== (2) أعمدة جدول أنواع الفواتير bt000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bt000' ORDER BY ORDINAL_POSITION" 100 | Out-Null

    Write-Both ""
    Write-Both "=== (3) أنواع الفواتير وقائمة الأسعار المربوطة بكل نوع ==="
    $ok = Run-Query $conn @"
SELECT b.Name AS BillType, b.MaterialPriceListGUID, pl.Name AS PriceListName
FROM bt000 b
LEFT JOIN MaterialPriceList000 pl ON pl.GUID = b.MaterialPriceListGUID
ORDER BY b.Name
"@ 60
    if (-not $ok) {
        Write-Both "--- محاولة بديلة: كل أعمدة bt000 ---"
        Run-Query $conn "SELECT TOP 40 * FROM bt000" 40 | Out-Null
    }

    Write-Both ""
    Write-Both "=== (4) عينة أسعار من كل قائمة (مع اسم المادة من mt000) ==="
    $lists = @()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT Name, GUID FROM MaterialPriceList000"
    $r = $cmd.ExecuteReader()
    while ($r.Read()) { $lists += @{ Name = $r.GetValue(0); Guid = $r.GetValue(1) } }
    $r.Close()
    foreach ($list in $lists) {
        Write-Both ("--- قائمة: $($list.Name) ---")
        $ok = Run-Query $conn @"
SELECT TOP 12 m.Code, m.Name AS MaterialName,
       i.Unit1Price, i.Unit2Price, i.Unit3Price
FROM MaterialPriceListItem000 i
JOIN mt000 m ON m.GUID = i.MaterialGUID
WHERE i.ParentGUID = '$($list.Guid)'
ORDER BY m.Name
"@ 12
        if (-not $ok) {
            Write-Both "--- محاولة بديلة بدون أسماء ---"
            Run-Query $conn "SELECT TOP 8 MaterialGUID, Unit1Price, Unit2Price, Unit3Price FROM MaterialPriceListItem000 WHERE ParentGUID = '$($list.Guid)'" 8 | Out-Null
        }
        Write-Both ""
    }

    Write-Both ""
    Write-Both "=== (5) عينة من جدول المواد نفسه (الوحدات وعوامل التحويل) ==="
    $ok = Run-Query $conn "SELECT TOP 10 Code, Name, Unity, Unit2, Unit3, Unit2Fact, Unit3Fact FROM mt000 ORDER BY Name" 10
    if (-not $ok) {
        Write-Both "--- محاولة بديلة: أول 5 صفوف بكل الأعمدة ---"
        Run-Query $conn "SELECT TOP 5 * FROM mt000" 5 | Out-Null
    }

    $conn.Close()
    Write-Both ""
    Write-Both "تم. أرسل هذا الملف: $OutFile"
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    ("خطأ: " + $_.Exception.Message) | Add-Content -Path $OutFile -Encoding UTF8
}
