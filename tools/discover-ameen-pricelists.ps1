# ============================================================
# discover-ameen-pricelists.ps1  (قراءة فقط — لا يعدّل أي شيء)
# يكشف قوائم الأسعار وجداولها في قاعدة الأمين (mt000)
# ليعرف أي قائمة تستخدمها واجهة "مبيعات مركز".
# شغّله على لابتوب الأمين، وأرسل ملف الناتج.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutFile = "$PSScriptRoot\logs\ameen-schema-report.txt"
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

function Run-Query($conn, $sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $reader = $cmd.ExecuteReader()
    $cols = @()
    for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
    Write-Both ("الأعمدة: " + ($cols -join " | "))
    $count = 0
    while ($reader.Read() -and $count -lt 60) {
        $vals = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) {
            $v = $reader.GetValue($i)
            if ($v -is [string] -and $v.Length -gt 40) { $v = $v.Substring(0, 40) }
            $vals += "$v"
        }
        Write-Both ("  " + ($vals -join " | "))
        $count++
    }
    $reader.Close()
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    Write-Both "=== (1) كل الجداول التي فيها Price أو List في الاسم ==="
    Run-Query $conn "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%Price%' OR TABLE_NAME LIKE '%List%' ORDER BY TABLE_NAME"

    Write-Both ""
    Write-Both "=== (2) أعمدة جدول MaterialPriceListItem000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'MaterialPriceListItem000' ORDER BY ORDINAL_POSITION"

    Write-Both ""
    Write-Both "=== (3) محتوى جداول رؤوس قوائم الأسعار (للبحث عن 'مبيعات مركز') ==="
    $listTables = @()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE (TABLE_NAME LIKE '%PriceList%' OR TABLE_NAME LIKE '%قائمة%') AND TABLE_NAME NOT LIKE '%Item%'"
    $r = $cmd.ExecuteReader()
    while ($r.Read()) { $listTables += $r.GetString(0) }
    $r.Close()
    foreach ($t in $listTables) {
        Write-Both ("--- جدول: $t ---")
        try { Run-Query $conn "SELECT TOP 40 * FROM [$t]" } catch { Write-Both ("  تعذّر: " + $_.Exception.Message) }
        Write-Both ""
    }

    Write-Both ""
    Write-Both "=== (4) القوائم المميزة الموجودة فعليًا داخل MaterialPriceListItem000 (إن وُجد عمود رقم قائمة) ==="
    foreach ($col in @("PriceListNo","ListNo","PriceListID","PriceListNum","ListID","PLNo")) {
        try {
            Run-Query $conn "SELECT DISTINCT $col FROM MaterialPriceListItem000"
            Write-Both ("(العمود المستخدم: $col)")
            break
        } catch { }
    }

    $conn.Close()
    Write-Both ""
    Write-Both "تم. أرسل هذا الملف: $OutFile"
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
}
