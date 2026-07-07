# ============================================================
# discover-500.ps1  (قراءة فقط)
# يتتبع سند الـ500 (صندوق شام كاش) لحسن عباس: أين أبوه وما تاريخه الحقيقي،
# ولماذا يعرضه كشف الأمين بتاريخ 3-7 بينما قيده 4-7.
# ============================================================
param([string]$EnvFile = "$PSScriptRoot\.env")

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

# (1) قيد الـ500 نفسه بكل حقوله
Show "(1) قيد الـ500 لحسن عباس (كل الحقول المهمة)" @"
SELECT CONVERT(varchar(19), en.Date, 120) AS en_date, en.Number AS en_num,
       CAST(en.Credit AS decimal(18,2)) AS credit, en.Notes,
       CAST(en.ParentGUID AS varchar(36)) AS parent_guid,
       CAST(en.GUID AS varchar(36)) AS guid, en.Type AS typ
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = N'حسن عباس / عدرا العمالية'
  AND COALESCE(en.Credit,0) = 500
"@

# (2) أبوه في ce000؟
Show "(2) صف ce000 لأبي قيد الـ500" @"
SELECT ce.Type, ce.Number, CONVERT(varchar(19), ce.Date, 120) AS ce_date,
       CAST(ce.Debit AS decimal(18,2)) AS debit, ce.Notes, ce.IsPosted,
       CONVERT(varchar(19), ce.CreateDate, 120) AS create_date,
       CONVERT(varchar(19), ce.LastUpdateDate, 120) AS last_update
FROM dbo.ce000 ce
WHERE ce.GUID IN (
    SELECT en.ParentGUID FROM dbo.en000 en
    JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
    WHERE LTRIM(RTRIM(cu.CustomerName)) = N'حسن عباس / عدرا العمالية'
      AND COALESCE(en.Credit,0) = 500
)
"@

# (3) سندا 162 و163 في ce000 مباشرة (بالرقم)
Show "(3) ce000 حيث Number IN (162, 163)" @"
SELECT ce.Type, ce.Number, CONVERT(varchar(19), ce.Date, 120) AS ce_date,
       CAST(ce.Debit AS decimal(18,2)) AS debit, ce.Notes, ce.IsPosted,
       CONVERT(varchar(19), ce.CreateDate, 120) AS create_date,
       CAST(ce.GUID AS varchar(36)) AS guid
FROM dbo.ce000 ce
WHERE ce.Number IN (162, 163)
ORDER BY ce.Number, ce.Date
"@

# (4) إن لم يكن الأب في ce000 — أي جدول يحويه؟
$cmdP = $conn.CreateCommand()
$cmdP.CommandText = @"
SELECT TOP 1 CAST(en.ParentGUID AS varchar(36))
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = N'حسن عباس / عدرا العمالية'
  AND COALESCE(en.Credit,0) = 500
"@
$pg = [string]$cmdP.ExecuteScalar()
Write-Host ""
Write-Host "=== (4) البحث عن أبي الـ500 ($pg) في كل الجداول ===" -ForegroundColor Yellow
$cmdT = $conn.CreateCommand()
$cmdT.CommandText = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME = 'GUID' AND DATA_TYPE = 'uniqueidentifier' AND TABLE_NAME NOT LIKE 'vw%' AND TABLE_NAME NOT LIKE 'JOC%' AND TABLE_NAME NOT LIKE 'v[bct]%'"
$rdT = $cmdT.ExecuteReader(); $tables = @(); while ($rdT.Read()) { $tables += [string]$rdT.GetValue(0) }; $rdT.Close()
foreach ($t in $tables) {
    try {
        $cmdX = $conn.CreateCommand()
        $cmdX.CommandText = "SELECT COUNT(*) FROM dbo.[$t] WHERE GUID = @g"
        $cmdX.Parameters.AddWithValue("@g", [guid]$pg) | Out-Null
        if ([int]$cmdX.ExecuteScalar() -gt 0) {
            Write-Host ("  ✓ موجود في: $t") -ForegroundColor Green
            Show "(4b) الصف داخل $t" "SELECT * FROM dbo.[$t] WHERE GUID = @g" @{ "@g" = [guid]$pg }
        }
    } catch {}
}

$conn.Close()
Write-Host ""
Write-Host "تم — أرسل الناتج كاملاً." -ForegroundColor Cyan
