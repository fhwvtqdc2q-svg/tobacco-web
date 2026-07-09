# ============================================================
# discover-ameen-bill-unit-column-2.ps1   (READ-ONLY — لا يعدّل أي شيء أبداً)
# نفس هدف السكريبت السابق، بس هالمرة بيربط اسم الصنف (m.Name) مباشرة
# حتى نطابق كل سطر باسمه الحقيقي من غير أي تخمين بالترتيب.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$BillNo = "52"
)
$ErrorActionPreference = "Stop"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2; [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING }
if (-not $connStr) { throw "No AMEEN SQL connection string found." }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open()
$sb = New-Object System.Text.StringBuilder
function Line($t) { [void]$sb.AppendLine($t) }
function Dump($title, $sql, $maxRows = 60) {
    Line ""; Line ("=== " + $title + " ===")
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
        $r = $cmd.ExecuteReader(); $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
        Line ("COLS: " + ($cols -join " | ")); $n = 0
        while ($r.Read() -and $n -lt $maxRows) {
            $vals = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $v = $r.GetValue($i); if ($v -is [string] -and $v.Length -gt 60) { $v = $v.Substring(0, 60) }; $vals += "$v" }
            Line ("  " + ($vals -join " | ")); $n++
        }
        $r.Close()
    } catch { Line ("  ERROR: " + $_.Exception.Message) }
}

# فاتورة الجملة رقم 52 (حسن عباس) — لازم نفلتر بنوع الفاتورة كمان لأن رقم
# الفاتورة ممكن يتكرر بين أنواع مختلفة (لاحظنا هيك بالفحص السابق).
$WHOLESALE_TYPE_GUID = "4a827bee-6ae1-4474-802b-970068872fcc"
$SALES_TYPE_GUID     = "7f5b0921-61f3-4f23-a1f4-fbfae4144bf4"

Dump "فاتورة 52 (جملة) بأسماء الأصناف والوحدات كاملة" @"
SELECT
  m.Name          AS item_name,
  bi.Qty          AS raw_qty,
  bi.Unity        AS unity_code,
  bi.Price        AS price,
  bi.Netprofit    AS line_total_field,
  bi.UnitCostPrice AS unit_cost,
  m.Unity         AS unit1_name,
  m.Unit2         AS unit2_name,
  m.Unit2Fact     AS unit2_factor
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
WHERE u.Number = '$BillNo'
  AND u.TypeGUID IN ('$WHOLESALE_TYPE_GUID', '$SALES_TYPE_GUID')
ORDER BY m.Name
"@ 60

$conn.Close()
function Need($n) { $v = [Environment]::GetEnvironmentVariable($n, "User"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Process") }; if (-not $v) { throw "Missing env var: $n" }; return $v }
$url = (Need "TOBACCO_SUPABASE_URL").TrimEnd("/"); $key = Need "TOBACCO_SUPABASE_PUBLIC_KEY"; $email = Need "TOBACCO_SYNC_EMAIL"; $pass = Need "TOBACCO_SYNC_PASSWORD"
$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey = $key; Accept = "application/json" } -ContentType "application/json; charset=utf-8" -Body (@{email = $email; password = $pass } | ConvertTo-Json)
$payload = @{label = "ameen-bill-unit-column-probe-2"; content = $sb.ToString() } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey = $key; Authorization = ("Bearer " + $auth.access_token); "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "return=minimal" } -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("PROBE OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: bill-unit-column probe 2 done."
