# ============================================================
# discover-order-limit.ps1  (يعمل على اللابتوب - قراءة فقط)
# معاينة قائمة النواقص حسب «حد الطلب» (OrderLimit) الحقيقي من الأمين
# لا يغيّر أي شيء. الاستخدام:  .\tools\discover-order-limit.ps1
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

Write-Host "===== counts ====="
Q @"
SELECT
  COUNT(*) AS total_materials,
  SUM(CASE WHEN OrderLimit > 0 THEN 1 ELSE 0 END) AS have_orderlimit,
  SUM(CASE WHEN OrderLimit > 0 AND Qty < OrderLimit AND ISNULL(bHide,0)=0 THEN 1 ELSE 0 END) AS below_limit_visible
FROM vwMaterials
"@ | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "===== proposed shortage list (Qty < OrderLimit), in cartons ====="
$rows = Q @"
SELECT TOP 80
  Name,
  CAST(Qty AS decimal(18,2)) AS qty_unit1,
  Unit2,
  CASE WHEN ISNULL(Unit2Fact,0) > 0 THEN CAST(Qty / Unit2Fact AS decimal(18,2)) ELSE NULL END AS qty_cartons,
  CAST(OrderLimit AS decimal(18,2)) AS limit_unit1,
  CASE WHEN ISNULL(Unit2Fact,0) > 0 THEN CAST(OrderLimit / Unit2Fact AS decimal(18,2)) ELSE NULL END AS limit_cartons
FROM vwMaterials
WHERE OrderLimit > 0 AND Qty < OrderLimit AND ISNULL(bHide,0)=0
ORDER BY (OrderLimit - Qty) DESC
"@
$rows | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "(عدد المعروض: $($rows.Count))"

$conn.Close()
Write-Host "===== done. انسخ المخرجات وابعتها ====="
