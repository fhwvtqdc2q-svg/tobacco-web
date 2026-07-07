# ============================================================
# discover-entry-order.ps1  (قراءة فقط)
# يكشف مفتاح الترتيب الحقيقي لقيود en000 داخل اليوم الواحد
# (لمطابقة ترتيب كشف الأمين: قبض 39 قبل قبض 41 ...إلخ).
# التشغيل:  .\tools\discover-entry-order.ps1
# ============================================================
param(
    [string]$Customer = "حسن عباس / عدرا العمالية",
    [string]$EnvFile = "$PSScriptRoot\.env"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_CONNECTION_STRING }
if (-not $connStr) { Write-Host "خطأ: connection string غير موجود." -ForegroundColor Red; exit 1 }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()

function Show($title, $sql, $params = @{}) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Yellow
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandTimeout = 120; $cmd.CommandText = $sql
        foreach ($k in $params.Keys) { $cmd.Parameters.AddWithValue($k, $params[$k]) | Out-Null }
        $rd = $cmd.ExecuteReader()
        $cols = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $cols += $rd.GetName($i) }
        Write-Host ("  " + ($cols -join " | "))
        while ($rd.Read()) {
            $vals = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $vals += "$($rd.GetValue($i))" }
            Write-Host ("  " + ($vals -join " | "))
        }
        $rd.Close()
    } catch { Write-Host ("  تعذّر: " + $_.Exception.Message) -ForegroundColor Red }
}

# (1) قيود الزبون مرتبة بالتاريخ ثم GUID — لاختبار فرضية أن GUID تسلسلي (newsequentialid)
Show "(1) القيود بترتيب (التاريخ، GUID) — قارن مع ترتيب كشف الأمين" @"
SELECT CONVERT(varchar(10), en.Date, 120) AS dt, en.Number AS num,
       CAST(COALESCE(en.Debit,0) AS decimal(18,2)) AS debit,
       CAST(COALESCE(en.Credit,0) AS decimal(18,2)) AS credit,
       LEFT(COALESCE(en.Notes,''), 25) AS notes,
       en.Type AS typ, LEFT(COALESCE(en.Class,''),15) AS cls,
       CAST(en.GUID AS varchar(36)) AS guid,
       CAST(en.ParentGUID AS varchar(36)) AS parent_guid
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = LTRIM(RTRIM(@c))
ORDER BY en.Date, en.GUID
"@ @{ "@c" = $Customer }

# (2) البحث عن جدول «رأس القيد» الذي يشير إليه ParentGUID (فيه رقم السند غالباً)
Write-Host ""
Write-Host "=== (2) البحث عن جدول رأس القيد (ParentGUID) ===" -ForegroundColor Yellow
$cmdP = $conn.CreateCommand()
$cmdP.CommandText = @"
SELECT TOP 3 CAST(en.ParentGUID AS varchar(36)) AS pg
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = LTRIM(RTRIM(@c)) AND COALESCE(en.Credit,0) > 0
ORDER BY en.Date DESC
"@
$cmdP.Parameters.AddWithValue("@c", $Customer) | Out-Null
$parents = @()
$rdP = $cmdP.ExecuteReader(); while ($rdP.Read()) { $parents += [string]$rdP.GetValue(0) }; $rdP.Close()
Write-Host ("  عيّنة ParentGUID: " + ($parents -join ", "))

$cmdT = $conn.CreateCommand()
$cmdT.CommandText = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME = 'GUID' AND DATA_TYPE = 'uniqueidentifier' AND TABLE_NAME NOT LIKE 'vw%' AND TABLE_NAME NOT LIKE 'JOC%'"
$rdT = $cmdT.ExecuteReader(); $tables = @(); while ($rdT.Read()) { $tables += [string]$rdT.GetValue(0) }; $rdT.Close()
Write-Host ("  جداول مرشحة: " + $tables.Count)

$foundTables = @{}
if ($parents.Count) {
    foreach ($t in $tables) {
        try {
            $cmdX = $conn.CreateCommand()
            $cmdX.CommandText = "SELECT COUNT(*) FROM dbo.[$t] WHERE GUID = @g"
            $cmdX.Parameters.AddWithValue("@g", [guid]$parents[0]) | Out-Null
            if ([int]$cmdX.ExecuteScalar() -gt 0) { $foundTables[$t] = $true; Write-Host ("  ✓ ParentGUID موجود في جدول: $t") -ForegroundColor Green }
        } catch {}
    }
    if (-not $foundTables.Count) { Write-Host "  (لم أجد الجدول الأب)" -ForegroundColor Red }
    foreach ($t in $foundTables.Keys) {
        $colsCmd = $conn.CreateCommand()
        $colsCmd.CommandText = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '$t' ORDER BY ORDINAL_POSITION"
        $rdC = $colsCmd.ExecuteReader(); $tCols = @(); while ($rdC.Read()) { $tCols += [string]$rdC.GetValue(0) }; $rdC.Close()
        Write-Host ("  أعمدة $t : " + ($tCols -join ", "))
        Show "(2b) صفوف $t لعينة الآباء" @"
SELECT * FROM dbo.[$t] WHERE GUID IN ('$($parents -join "','")')
"@
    }
}

$conn.Close()
Write-Host ""
Write-Host "تم — أرسل الناتج كاملاً." -ForegroundColor Cyan
