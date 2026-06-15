# ============================================================
# discover-order-limit.ps1  (يعمل على اللابتوب - قراءة فقط)
# يكتشف جدول المواد وعمود «حد الطلب» في الأمين (لا يغيّر أي شيء)
# الاستخدام:  .\tools\discover-order-limit.ps1
# ============================================================
param([string]$EnvFile = "$PSScriptRoot\.env")
$ErrorActionPreference = "Stop"
if (Test-Path $EnvFile) { Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object { $p = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim()) } }
$cs = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $cs) { $cs = [Environment]::GetEnvironmentVariable("AMEEN_SQL_CONNECTION_STRING", "User") }
if (-not $cs) { Write-Host "ERROR: AMEEN_SQL_CONNECTION_STRING missing"; exit 1 }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($cs); $conn.Open()
function Q($sql) { $c = $conn.CreateCommand(); $c.CommandText = $sql; $r = $c.ExecuteReader(); $o = @(); while ($r.Read()) { $row = [ordered]@{}; for ($i = 0; $i -lt $r.FieldCount; $i++) { $row[$r.GetName($i)] = "$($r[$i])" }; $o += [pscustomobject]$row }; $r.Close(); return $o }

Write-Host "===== (1) material-like tables/views ====="
Q @"
SELECT TABLE_TYPE, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE '%aterial%' OR TABLE_NAME LIKE 'mt0%' OR TABLE_NAME LIKE '%Item%'
   OR TABLE_NAME LIKE 'vwMat%' OR TABLE_NAME LIKE '%Stock%' OR TABLE_NAME LIKE '%Goods%'
ORDER BY TABLE_NAME
"@ | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "===== (2) LIMIT-like columns across material/stock tables ====="
Q @"
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE (COLUMN_NAME LIKE '%imit%' OR COLUMN_NAME LIKE '%rder%' OR COLUMN_NAME LIKE '%afe%'
  OR COLUMN_NAME LIKE '%Min%' OR COLUMN_NAME LIKE '%Max%' OR COLUMN_NAME LIKE '%Point%'
  OR COLUMN_NAME LIKE '%Reorder%' OR COLUMN_NAME LIKE '%Req%' OR COLUMN_NAME LIKE '%Level%' OR COLUMN_NAME LIKE '%Hd%')
AND (TABLE_NAME LIKE '%aterial%' OR TABLE_NAME LIKE 'mt0%' OR TABLE_NAME LIKE '%Item%'
  OR TABLE_NAME LIKE 'vwMat%' OR TABLE_NAME LIKE '%Stock%' OR TABLE_NAME LIKE '%Goods%')
ORDER BY TABLE_NAME, COLUMN_NAME
"@ | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "===== (3) columns of vwMaterials (known view) ====="
((Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vwMaterials' ORDER BY ORDINAL_POSITION") | ForEach-Object { $_.COLUMN_NAME }) -join ", " | Write-Host

Write-Host "`n===== (4) one sample row from vwMaterials (all columns) ====="
Q "SELECT TOP 1 * FROM vwMaterials WHERE Name LIKE N'%غلواز قصير أحمر%'" | Format-List | Out-String | Write-Host

$conn.Close()
Write-Host "===== done. انسخ كل المخرجات وابعتها ====="
