# يكتشف مكان عملة الزبون في الأمين (إخراج إنجليزي آمن)
param([string]$EnvFile = "$PSScriptRoot\.env")
$ErrorActionPreference = "Stop"
if (Test-Path $EnvFile) { Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object { $p = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim()) } }
function GS($n) { $v = [Environment]::GetEnvironmentVariable($n, "Process"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "User") }; return $v }
$cs = GS "AMEEN_SQL_CONNECTION_STRING"
Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($cs); $conn.Open()
function Q($sql) { $c = $conn.CreateCommand(); $c.CommandText = $sql; $r = $c.ExecuteReader(); $o = @(); while ($r.Read()) { $row = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $row += "$($r[$i])" }; $o += ($row -join " | ") }; $r.Close(); return $o }

Write-Host "=== (1) columns of vwCuDetails ==="
Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vwCuDetails' ORDER BY ORDINAL_POSITION" | ForEach-Object { Write-Host "  $_" }

Write-Host "=== (2) VIEWS that have a CurrencyGUID column ==="
Q "SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME='CurrencyGUID' AND TABLE_NAME LIKE 'vw%' ORDER BY TABLE_NAME" | ForEach-Object { Write-Host "  $_" }

Write-Host "=== (3) tables/views whose name looks like currency master ==="
Q "SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%urrenc%' ORDER BY TABLE_NAME" | ForEach-Object { Write-Host "  $_" }

Write-Host "=== (4) does vwCu have account/currency cols? ==="
Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='vwCu' AND (COLUMN_NAME LIKE '%urrency%' OR COLUMN_NAME LIKE '%ccount%' OR COLUMN_NAME='cuGUID' OR COLUMN_NAME='GUID') ORDER BY COLUMN_NAME" | ForEach-Object { Write-Host "  $_" }

$conn.Close()
Write-Host "=== done ==="
