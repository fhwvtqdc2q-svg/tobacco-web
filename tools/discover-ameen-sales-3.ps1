# ============================================================
# discover-ameen-sales-3.ps1   (READ-ONLY; uploads to Supabase)
# Final tiny probe: bill types (bt000 name<->guid), a real sales
# aggregation for the last 2 days (validates the Qty2-by-Unit2
# logic), and en000 columns (for the USD cash-box part later).
# ASCII-only code. Run on the Ameen laptop.
# ============================================================
param([string]$EnvFile = "$PSScriptRoot\.env")
$ErrorActionPreference = "Stop"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
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
        $r = $cmd.ExecuteReader()
        $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
        Line ("COLS: " + ($cols -join " | "))
        $n = 0
        while ($r.Read() -and $n -lt $maxRows) {
            $vals = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) {
                $v = $r.GetValue($i); if ($v -is [string] -and $v.Length -gt 70) { $v = $v.Substring(0,70) }
                $vals += "$v"
            }
            Line ("  " + ($vals -join " | ")); $n++
        }
        $r.Close()
    } catch { Line ("  ERROR: " + $_.Exception.Message) }
}

# 1) bill types (no 'Number' column on bt000)
Dump "bt000 types" "SELECT Name, GUID, BillGroup, BillType, bCashBill, bPOSBill, DefCurrencyGUID, MaterialPriceListGUID FROM bt000 ORDER BY BillGroup, BillType" 40

# 2) REAL sales for last 2 days, by bill type and Unit2 (validates Qty2-by-Unit2)
Dump "sales last 2 days by type and unit" @"
SELECT CAST(u.Date AS date) AS d, bt.Name AS bill_type, m.Unit2 AS unit2,
       COUNT(DISTINCT u.GUID) AS bills,
       CAST(SUM(bi.Qty2) AS decimal(18,3)) AS qty2_sum,
       CAST(SUM(bi.Qty)  AS decimal(18,3)) AS qty_base_sum
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
LEFT JOIN bt000 bt ON bt.GUID = u.TypeGUID
WHERE u.Date >= DATEADD(day,-1,CAST(GETDATE() AS date))
GROUP BY CAST(u.Date AS date), bt.Name, m.Unit2
ORDER BY d DESC, bill_type, unit2
"@ 100

# 3) bills last 2 days by type: named vs cash (Cust_Name empty), and currency
Dump "bills last 2 days: named vs cash by type and currency" @"
SELECT CAST(u.Date AS date) AS d, bt.Name AS bill_type, cur.CurrencyISO AS cur,
       COUNT(*) AS bills,
       SUM(CASE WHEN u.Cust_Name IS NULL OR LTRIM(RTRIM(u.Cust_Name))='' THEN 1 ELSE 0 END) AS cash_bills,
       CAST(SUM(u.Total) AS decimal(18,2)) AS total_sum
FROM bu000 u
LEFT JOIN bt000 bt ON bt.GUID = u.TypeGUID
LEFT JOIN my000 cur ON cur.GUID = u.CurrencyGUID
WHERE u.Date >= DATEADD(day,-1,CAST(GETDATE() AS date))
GROUP BY CAST(u.Date AS date), bt.Name, cur.CurrencyISO
ORDER BY d DESC, bills DESC
"@ 100

# 4) en000 columns (for the USD cash-box movement part)
Dump "en000 columns" "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='en000' ORDER BY ORDINAL_POSITION" 120

$conn.Close()

function Need($n){$v=[Environment]::GetEnvironmentVariable($n,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"Process")};if(-not $v){throw "Missing env var: $n"};return $v}
$url=(Need "TOBACCO_SUPABASE_URL").TrimEnd("/"); $key=Need "TOBACCO_SUPABASE_PUBLIC_KEY"; $email=Need "TOBACCO_SYNC_EMAIL"; $pass=Need "TOBACCO_SYNC_PASSWORD"
$auth=Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey=$key;Accept="application/json"} -ContentType "application/json; charset=utf-8" -Body (@{email=$email;password=$pass}|ConvertTo-Json)
$payload=@{label="ameen-sales-probe3";content=$sb.ToString()}|ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey=$key;Authorization=("Bearer "+$auth.access_token);"Accept-Profile"="public";"Content-Profile"="public";Prefer="return=minimal"} -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("PROBE3 OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: probe3 done."
