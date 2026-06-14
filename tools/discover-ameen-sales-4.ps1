# ============================================================
# discover-ameen-sales-4.ps1  (READ-ONLY; uploads to Supabase)
# Pin down per-line quantity semantics (Qty vs Qty2 vs factor)
# for a retail (مبيعات مركز) and a wholesale (طلبيات) bill, plus
# a sample of today's USD payments for the cash-box section.
# ASCII-only code. Run on the Ameen laptop.
# ============================================================
param([string]$EnvFile = "$PSScriptRoot\.env")
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
function Line($t){[void]$sb.AppendLine($t)}
function Dump($title,$sql,$maxRows=40){
    Line ""; Line ("=== "+$title+" ===")
    try{
        $cmd=$conn.CreateCommand();$cmd.CommandText=$sql;$cmd.CommandTimeout=120
        $r=$cmd.ExecuteReader();$cols=@();for($i=0;$i -lt $r.FieldCount;$i++){$cols+=$r.GetName($i)}
        Line ("COLS: "+($cols -join " | "));$n=0
        while($r.Read() -and $n -lt $maxRows){
            $vals=@();for($i=0;$i -lt $r.FieldCount;$i++){$v=$r.GetValue($i);if($v -is [string] -and $v.Length -gt 40){$v=$v.Substring(0,40)};$vals+="$v"}
            Line ("  "+($vals -join " | "));$n++
        }
        $r.Close()
    }catch{Line ("  ERROR: "+$_.Exception.Message)}
}

# 1) per-line detail of recent مبيعات مركز bills (retail)
Dump "retail (مبيعات مركز) per-line, last 4 days" @"
SELECT TOP 25 u.Number AS bill_no, m.Name AS mat, m.Unity AS u1, m.Unit2 AS u2, m.Unit2Fact AS f2,
       bi.Qty, bi.Qty2, bi.Qty3, bi.Price
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
JOIN bt000 bt ON bt.GUID = u.TypeGUID
WHERE bt.Name = N'مبيعات مركز' AND u.Date >= DATEADD(day,-4,CAST(GETDATE() AS date))
ORDER BY u.Number DESC
"@ 25

# 2) per-line detail of recent طلبيات bills (wholesale)
Dump "wholesale (طلبيات) per-line, last 4 days" @"
SELECT TOP 25 u.Number AS bill_no, m.Name AS mat, m.Unity AS u1, m.Unit2 AS u2, m.Unit2Fact AS f2,
       bi.Qty, bi.Qty2, bi.Qty3, bi.Price
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
JOIN bt000 bt ON bt.GUID = u.TypeGUID
WHERE bt.Name = N'طلبيات' AND u.Date >= DATEADD(day,-4,CAST(GETDATE() AS date))
ORDER BY u.Number DESC
"@ 25

# 3) today's USD-currency payments (credits) by customer (for the dollar cash-box section)
Dump "USD credits (payments) last 3 days, by entry" @"
SELECT TOP 30 CAST(en.Date AS date) AS d, c.CustomerName, en.Debit, en.Credit, en.Notes
FROM en000 en
LEFT JOIN my000 cur ON cur.GUID = en.CurrencyGUID
LEFT JOIN cu000 c  ON c.AccountGUID = en.AccountGUID
WHERE cur.CurrencyISO = 'USD' AND en.Credit > 0
  AND en.Date >= DATEADD(day,-3,CAST(GETDATE() AS date))
ORDER BY en.Date DESC
"@ 30

$conn.Close()
function Need($n){$v=[Environment]::GetEnvironmentVariable($n,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"Process")};if(-not $v){throw "Missing env var: $n"};return $v}
$url=(Need "TOBACCO_SUPABASE_URL").TrimEnd("/");$key=Need "TOBACCO_SUPABASE_PUBLIC_KEY";$email=Need "TOBACCO_SYNC_EMAIL";$pass=Need "TOBACCO_SYNC_PASSWORD"
$auth=Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey=$key;Accept="application/json"} -ContentType "application/json; charset=utf-8" -Body (@{email=$email;password=$pass}|ConvertTo-Json)
$payload=@{label="ameen-sales-probe4";content=$sb.ToString()}|ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey=$key;Authorization=("Bearer "+$auth.access_token);"Accept-Profile"="public";"Content-Profile"="public";Prefer="return=minimal"} -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("PROBE4 OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: probe4 done."
