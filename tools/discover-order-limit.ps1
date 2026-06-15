# ============================================================
# discover-order-limit.ps1  (يعمل على اللابتوب - قراءة فقط)
# يكتشف عمود «حد الطلب» في بطاقة المادة بالأمين (MaterialCard000)
# ويطبع قيمه لأصناف معروفة حتى نطابقها مع شاشة الأمين.
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

Write-Host "===== (1) candidate LIMIT columns in MaterialCard000 ====="
$cand = Q @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME='MaterialCard000' AND (
  COLUMN_NAME LIKE '%imit%' OR COLUMN_NAME LIKE '%rder%' OR COLUMN_NAME LIKE '%afe%'
  OR COLUMN_NAME LIKE '%Min%' OR COLUMN_NAME LIKE '%Max%' OR COLUMN_NAME LIKE '%Point%'
  OR COLUMN_NAME LIKE '%Reorder%' OR COLUMN_NAME LIKE '%Req%' OR COLUMN_NAME LIKE '%Level%')
ORDER BY COLUMN_NAME
"@
$cand | Format-Table -AutoSize | Out-String | Write-Host
$cols = @($cand | ForEach-Object { $_.COLUMN_NAME })

Write-Host "===== (2) ALL columns of MaterialCard000 (reference) ====="
((Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='MaterialCard000' ORDER BY ORDINAL_POSITION") | ForEach-Object { $_.COLUMN_NAME }) -join ", " | Write-Host

Write-Host "`n===== (3) values for known items ====="
$sel = "Name, Code"
if ($cols.Count) { $sel += ", " + (($cols | ForEach-Object { "[$_]" }) -join ", ") }
$known = "N'%غلواز قصير أحمر%',N'%ماستر سليم فضي%',N'%مالبورو غولد حرة%',N'%معسل فاخر عنب%',N'%بلاتينيوم سليم فضي%',N'%1970 طويل فضي%'"
$rows = Q "SELECT TOP 30 $sel FROM MaterialCard000 WHERE $((($known -split ',') | ForEach-Object { "Name LIKE $_" }) -join ' OR ')"
$rows | Format-List | Out-String | Write-Host

$conn.Close()
Write-Host "===== done. انسخ كل المخرجات وابعتها ====="
