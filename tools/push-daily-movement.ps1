# ============================================================
# push-daily-movement.ps1   (READ-ONLY on Ameen; writes 1 row to Supabase)
# Builds the "Daily Movement Summary" for a date and uploads it to
# public.daily_movement_reports so the website report can show it.
#  - Sales quantities (cartons/parcels/slices) = SUM(Qty / Unit2Fact)
#    grouped by material Unit2, per sales/return bill type.
#  - USD cash-box: customer payments (en000 USD credits on customer
#    accounts) + USD cash sales (bills with no customer name).
# ASCII-only code (no Arabic literals -> filters by GUID).
# Usage:  .\push-daily-movement.ps1            (today)
#         .\push-daily-movement.ps1 -Date 2026-06-13
# ============================================================
param(
    [string]$Date = (Get-Date).ToString("yyyy-MM-dd"),
    [string]$EnvFile = "$PSScriptRoot\.env"
)
$ErrorActionPreference = "Stop"
if ($Date -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "Date must be yyyy-MM-dd" }

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2; [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING }
if (-not $connStr) { throw "No AMEEN SQL connection string found." }

$USD = "c06860b8-c1ed-42e8-bf94-a630aae129ac"   # US Dollar currency GUID (my000)

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open()

function Query($sql) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 180
    $r = $cmd.ExecuteReader()
    $rows = @()
    while ($r.Read()) {
        $o = [ordered]@{}
        for ($i = 0; $i -lt $r.FieldCount; $i++) {
            $name = $r.GetName($i)
            $val = if ($r.IsDBNull($i)) { $null } else { $r.GetValue($i) }
            if ($val -is [decimal]) { $val = [double]$val }
            $o[$name] = $val
        }
        $rows += [PSCustomObject]$o
    }
    $r.Close()
    return ,$rows
}

# --- Part 1: sales quantities by bill type + Unit2 (sales=1, returns=3) ---
$salesSql = @"
SELECT bt.Name AS billType, bt.BillType AS billClass, ISNULL(m.Unit2,'') AS unit,
       CAST(SUM(CASE WHEN m.Unit2Fact > 0 THEN bi.Qty / m.Unit2Fact ELSE 0 END) AS decimal(18,3)) AS units,
       COUNT(DISTINCT u.GUID) AS bills
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
JOIN bt000 bt ON bt.GUID = u.TypeGUID
WHERE u.Date >= '$Date' AND u.Date < DATEADD(day,1,'$Date')
  AND bt.BillType IN (1,3)
GROUP BY bt.Name, bt.BillType, m.Unit2
HAVING SUM(CASE WHEN m.Unit2Fact > 0 THEN bi.Qty / m.Unit2Fact ELSE 0 END) <> 0
ORDER BY bt.Name, m.Unit2
"@
$sales = Query $salesSql

# --- Part 2a: USD customer payments (credits on customer accounts) ---
$payeSql = @"
SELECT c.CustomerName AS customer, CAST(SUM(en.Credit) AS decimal(18,2)) AS paid
FROM en000 en
JOIN cu000 c ON c.AccountGUID = en.AccountGUID
WHERE en.CurrencyGUID = '$USD' AND en.Credit > 0
  AND en.Date >= '$Date' AND en.Date < DATEADD(day,1,'$Date')
  AND c.CustomerName IS NOT NULL AND LTRIM(RTRIM(c.CustomerName)) <> ''
GROUP BY c.CustomerName
HAVING SUM(en.Credit) > 0
ORDER BY SUM(en.Credit) DESC
"@
$usdPayments = Query $payeSql

# --- Part 2b: USD cash sales (sales bills with no customer name) ---
$cashSql = @"
SELECT CAST(ISNULL(SUM(u.Total),0) AS decimal(18,2)) AS total, COUNT(*) AS bills
FROM bu000 u JOIN bt000 bt ON bt.GUID = u.TypeGUID
WHERE u.CurrencyGUID = '$USD' AND bt.BillType = 1
  AND (u.Cust_Name IS NULL OR LTRIM(RTRIM(u.Cust_Name)) = '')
  AND u.Date >= '$Date' AND u.Date < DATEADD(day,1,'$Date')
"@
$cash = (Query $cashSql)[0]

$conn.Close()

# --- build payload ---
$payload = [ordered]@{
    date        = $Date
    generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    sales       = @($sales)
    usdPayments = @($usdPayments)
    usdCash     = [ordered]@{ total = [double]$cash.total; bills = [int]$cash.bills }
}

# --- upload to Supabase ---
function Need($n){$v=[Environment]::GetEnvironmentVariable($n,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"Process")};if(-not $v){throw "Missing env var: $n"};return $v}
$url=(Need "TOBACCO_SUPABASE_URL").TrimEnd("/");$key=Need "TOBACCO_SUPABASE_PUBLIC_KEY";$email=Need "TOBACCO_SYNC_EMAIL";$pass=Need "TOBACCO_SYNC_PASSWORD"
$auth=Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey=$key;Accept="application/json"} -ContentType "application/json; charset=utf-8" -Body (@{email=$email;password=$pass}|ConvertTo-Json)
$body = @{ report_date = $Date; payload = $payload } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/daily_movement_reports" -Headers @{apikey=$key;Authorization=("Bearer "+$auth.access_token);"Accept-Profile"="public";"Content-Profile"="public";Prefer="return=minimal"} -ContentType "application/json; charset=utf-8" -Body $body | Out-Null

# --- console summary so the owner sees numbers immediately ---
Write-Host ""
Write-Host ("=== Daily Movement " + $Date + " ===")
Write-Host "-- Sales (units in Unit2) --"
foreach ($s in $sales) { Write-Host ("  [" + $s.billType + "] " + $s.unit + " = " + $s.units + "  (" + $s.bills + " bills)") }
Write-Host "-- USD payments by customer --"
foreach ($p in $usdPayments) { Write-Host ("  " + $p.customer + " = $" + $p.paid) }
Write-Host ("-- USD cash (no-name) sales: $" + $cash.total + " (" + $cash.bills + " bills) --")
Write-Host ""
Write-Host "PUSH OK - daily movement uploaded to Supabase."
Write-Host "Tell the assistant: pushed."
