# ============================================================
# discover-ameen-expense-accounts.ps1  (READ-ONLY; uploads to Supabase)
# مبني على صورة سند قيد أرسلها المستخدم فيها حسابات مصاريف حقيقية
# (مصاريف الحرس، كهرباء وماء، ...). دفعات الصرف بالأمين مسجّلة كقيود
# محاسبية (en000) على حسابات مصاريف (ac000) — مو كنوع فاتورة منفصل.
# هالسكريبت بيجيب كل حسابات المصاريف الموجودة فعلياً + حركاتها الأخيرة.
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
            $vals=@();for($i=0;$i -lt $r.FieldCount;$i++){$v=$r.GetValue($i);if($v -is [string] -and $v.Length -gt 60){$v=$v.Substring(0,60)};$vals+="$v"}
            Line ("  "+($vals -join " | "));$n++
        }
        $r.Close()
    }catch{Line ("  ERROR: "+$_.Exception.Message)}
}

# 1) كل حسابات المصاريف الموجودة فعلاً بشجرة الحسابات (ac000)
Dump "expense accounts (ac000) matching masroof/masareef" @"
SELECT CONVERT(nvarchar(36), GUID) AS acc_guid, Name, LatinName, Type,
       CONVERT(nvarchar(36), ParentGUID) AS parent_guid
FROM ac000
WHERE Name LIKE N'%مصروف%' OR Name LIKE N'%مصاريف%'
"@ 60

# 2) القيد الأب (الحساب الرئيسي "مصاريف") لو موجود — يفيد نعرف الشجرة
Dump "parent account name for expense accounts found above" @"
SELECT CONVERT(nvarchar(36), a.GUID) AS acc_guid, a.Name, CONVERT(nvarchar(36), a.ParentGUID) AS parent_guid,
       p.Name AS parent_name
FROM ac000 a
LEFT JOIN ac000 p ON p.GUID = a.ParentGUID
WHERE a.Name LIKE N'%مصروف%' OR a.Name LIKE N'%مصاريف%'
"@ 60

# 3) حركات الصرف الفعلية آخر 7 أيام: قيود en000 على حسابات مصاريف،
#    عمود Debit هو مبلغ الصرف (خارج من الصندوق/البنك، داخل لحساب المصروف)
Dump "expense entries (en000 + ac000) last 7 days" @"
SELECT TOP 40 CAST(en.Date AS date) AS d, a.Name AS expense_account, en.Debit, en.Credit, en.Notes,
       CONVERT(nvarchar(36), en.CurrencyGUID) AS currency_guid
FROM en000 en
JOIN ac000 a ON a.GUID = en.AccountGUID
WHERE (a.Name LIKE N'%مصروف%' OR a.Name LIKE N'%مصاريف%')
  AND en.Date >= DATEADD(day,-7,CAST(GETDATE() AS date))
ORDER BY en.Date DESC
"@ 40

$conn.Close()
function Need($n){$v=[Environment]::GetEnvironmentVariable($n,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"Process")};if(-not $v){throw "Missing env var: $n"};return $v}
$url=(Need "TOBACCO_SUPABASE_URL").TrimEnd("/");$key=Need "TOBACCO_SUPABASE_PUBLIC_KEY";$email=Need "TOBACCO_SYNC_EMAIL";$pass=Need "TOBACCO_SYNC_PASSWORD"
$auth=Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey=$key;Accept="application/json"} -ContentType "application/json; charset=utf-8" -Body (@{email=$email;password=$pass}|ConvertTo-Json)
$payload=@{label="ameen-expense-accounts-probe";content=$sb.ToString()}|ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey=$key;Authorization=("Bearer "+$auth.access_token);"Accept-Profile"="public";"Content-Profile"="public";Prefer="return=minimal"} -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("EXPENSE-ACCOUNTS PROBE OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: expense-accounts probe done."
