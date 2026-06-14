# ============================================================
# discover-ameen-sales-2.ps1   (READ-ONLY on Ameen; uploads result to Supabase)
# Second focused probe: exact structure of bill items (bi000),
# bill header (bu000), bill types (bt000), and currencies (my000),
# so the daily-movement report SQL can be written correctly.
# ASCII-only code (encoding safe). Run on the Ameen laptop.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env"
)
$ErrorActionPreference = "Stop"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}

$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING }
if (-not $connStr) { throw "No AMEEN_SQL_CONNECTION_STRING / AMEEN_SQL_WRITE_CONNECTION_STRING found." }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()

$sb = New-Object System.Text.StringBuilder
function Line($t) { [void]$sb.AppendLine($t) }

function Dump($title, $sql, $maxRows = 30) {
    Line ""
    Line ("=== " + $title + " ===")
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
        $r = $cmd.ExecuteReader()
        $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
        Line ("COLS: " + ($cols -join " | "))
        $n = 0
        while ($r.Read() -and $n -lt $maxRows) {
            $vals = @()
            for ($i = 0; $i -lt $r.FieldCount; $i++) {
                $v = $r.GetValue($i)
                if ($v -is [string] -and $v.Length -gt 60) { $v = $v.Substring(0, 60) }
                $vals += "$v"
            }
            Line ("  " + ($vals -join " | "))
            $n++
        }
        $r.Close()
    } catch { Line ("  ERROR: " + $_.Exception.Message) }
}

# 1) bill items full column list
Dump "bi000 columns" "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='bi000' ORDER BY ORDINAL_POSITION" 120
# 2) bill items sample (latest 5)
Dump "bi000 sample top 5" "SELECT TOP 5 * FROM bi000" 5
# 3) bill header full column list
Dump "bu000 columns" "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='bu000' ORDER BY ORDINAL_POSITION" 120
# 4) bill header latest 5 (most recent sales)
Dump "bu000 latest 5 by Date" "SELECT TOP 5 * FROM bu000 ORDER BY Date DESC" 5
# 5) bill types (find the sales-center type)
Dump "bt000 types" "SELECT Number, Name, GUID, BillGroup, BillType, bCashBill, bPOSBill, DefCashAccGUID, DefBillAccGUID, DefCurrencyGUID, MaterialPriceListGUID FROM bt000 ORDER BY Number" 40
# 6) currencies (my000) to identify USD vs SYP
Dump "my000 currencies (SELECT *)" "SELECT * FROM my000" 20
# 7) how many bills today and yesterday by type (sanity)
Dump "bu000 counts last 2 days by bill type" "SELECT b.Name AS bill_type, CAST(u.Date AS date) AS d, COUNT(*) AS bills, SUM(CASE WHEN u.Cust_Name IS NULL OR LTRIM(RTRIM(u.Cust_Name))='' THEN 1 ELSE 0 END) AS cash_bills FROM bu000 u LEFT JOIN bt000 b ON b.GUID = u.BillTypeGUID WHERE u.Date >= DATEADD(day,-2,CAST(GETDATE() AS date)) GROUP BY b.Name, CAST(u.Date AS date) ORDER BY d DESC, bills DESC" 60

$conn.Close()

# ---- upload to Supabase (schema_probe) ----
function Need($n) {
    $v = [Environment]::GetEnvironmentVariable($n, "User")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Process") }
    if (-not $v) { throw "Missing env var: $n" }
    return $v
}
$url   = (Need "TOBACCO_SUPABASE_URL").TrimEnd("/")
$key   = Need "TOBACCO_SUPABASE_PUBLIC_KEY"
$email = Need "TOBACCO_SYNC_EMAIL"
$pass  = Need "TOBACCO_SYNC_PASSWORD"
$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $key; Accept = "application/json" } `
    -ContentType "application/json; charset=utf-8" -Body (@{ email = $email; password = $pass } | ConvertTo-Json)
$token = $auth.access_token
$payload = @{ label = "ameen-sales-probe2"; content = $sb.ToString() } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" `
    -Headers @{ apikey = $key; Authorization = "Bearer $token"; "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "return=minimal" } `
    -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null

Write-Host ("PROBE2 OK - uploaded " + $sb.Length + " characters to Supabase.")
Write-Host "Tell the assistant: probe2 done."
