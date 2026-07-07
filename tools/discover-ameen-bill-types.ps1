# ============================================================
# discover-ameen-bill-types.ps1  (READ-ONLY; uploads to Supabase)
# بيكتشف كل أنواع الفواتير (TypeGUID) الموجودة فعلياً بجدول bu000،
# مع عدد الفواتير وآخر تاريخ لكل نوع، وبيحاول يلاقي جدول مرجعي
# فيه أسماء الأنواع (لأنه bu000 نفسه ما فيه إلا الـ GUID بدون اسم).
# الهدف: تأكيد هل في نوع فاتورة اسمه "مبيعات" منفصل عن "مبيعات المركز"
# (cc1097b1) وعن النوع التاني اللي كنا نسميه "طلبيات" (4a827bee)،
# وما زلنا ما اكتشفناه.
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

# 1) كل أنواع الفواتير المستخدمة فعلياً بآخر 90 يوم، مع عدد الفواتير
#    وأول/آخر تاريخ ومثال رقم فاتورة (يساعد بمطابقتها يدوياً بواجهة الأمين)
Dump "distinct bill TypeGUIDs (last 90 days)" @"
SELECT CONVERT(nvarchar(36), TypeGUID) AS type_guid,
       COUNT(*) AS bill_count,
       MIN(Date) AS min_date,
       MAX(Date) AS max_date,
       MAX(Number) AS sample_number
FROM bu000
WHERE Date >= DATEADD(day,-90,CAST(GETDATE() AS date))
GROUP BY TypeGUID
ORDER BY COUNT(*) DESC
"@ 30

# 2) نفس الشي بس آخر 3 أيام فقط (تركيز على النشاط الحالي)
Dump "distinct bill TypeGUIDs (last 3 days)" @"
SELECT CONVERT(nvarchar(36), TypeGUID) AS type_guid,
       COUNT(*) AS bill_count,
       MAX(Number) AS sample_number,
       MAX(Cust_Name) AS sample_customer
FROM bu000
WHERE Date >= DATEADD(day,-3,CAST(GETDATE() AS date))
GROUP BY TypeGUID
ORDER BY COUNT(*) DESC
"@ 30

# 3) محاولة إيجاد جدول مرجعي لأسماء أنواع الفواتير (تخمين أسماء شائعة
#    بقواعد الأمين — كل محاولة بتفشل بهدوء وتكمل للي بعدها)
$typeTableGuesses = @("nw000","tp000","bt000","ty000","nt000","mn000","dc000")
foreach ($t in $typeTableGuesses) {
    Dump "lookup attempt: $t" "SELECT TOP 20 * FROM $t" 20
}

# 4) بحث عام بكل الجداول عن أعمدة اسمها فيها GUID و Name/Type مع بعض —
#    مرشح محتمل للجدول المرجعي
Dump "columns matching GUID/Type/Name across all tables" @"
SELECT TOP 60 TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%GUID%' OR COLUMN_NAME LIKE '%Type%' OR COLUMN_NAME LIKE '%Name%'
ORDER BY TABLE_NAME
"@ 60

$conn.Close()
function Need($n){$v=[Environment]::GetEnvironmentVariable($n,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"Process")};if(-not $v){throw "Missing env var: $n"};return $v}
$url=(Need "TOBACCO_SUPABASE_URL").TrimEnd("/");$key=Need "TOBACCO_SUPABASE_PUBLIC_KEY";$email=Need "TOBACCO_SYNC_EMAIL";$pass=Need "TOBACCO_SYNC_PASSWORD"
$auth=Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey=$key;Accept="application/json"} -ContentType "application/json; charset=utf-8" -Body (@{email=$email;password=$pass}|ConvertTo-Json)
$payload=@{label="ameen-bill-types-probe";content=$sb.ToString()}|ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey=$key;Authorization=("Bearer "+$auth.access_token);"Accept-Profile"="public";"Content-Profile"="public";Prefer="return=minimal"} -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("BILL-TYPES PROBE OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: bill-types probe done."
