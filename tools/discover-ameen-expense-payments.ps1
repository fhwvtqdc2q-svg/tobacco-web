# ============================================================
# discover-ameen-expense-payments.ps1  (READ-ONLY; uploads to Supabase)
# بيدوّر على نوع/جدول "دفعات الصرف" (مصاريف/دفعات صادرة) بقاعدة الأمين
# — منفصل تماماً عن دفعات القبض (تحصيل من الزبائن) اللي عنا أصلاً.
# يستخدم جدول bt000 المرجعي (اكتشفناه سابقاً) للبحث عن أسماء أنواع
# فواتير فيها كلمة "صرف" أو "مصروف" أو "دفع"، وبيدوّر كمان بجدول
# القيود en000 عن حركات Debit (صرف) بدل Credit (تحصيل).
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

# 1) أنواع فواتير/سندات فيها كلمة صرف أو مصروف أو دفع أو نقد بالاسم (من bt000)
Dump "bt000 types matching sarf/masroof/daf3/naqd" @"
SELECT CONVERT(nvarchar(36), GUID) AS type_guid, BillGroup, BillType, Name, Abbrev
FROM bt000
WHERE Name LIKE N'%صرف%' OR Name LIKE N'%مصروف%' OR Name LIKE N'%دفع%' OR Name LIKE N'%سند%' OR Name LIKE N'%نقد%'
"@ 40

# 1ب) فواتير حديثة بمبلغ إجمالي قريب من أمثلة أعطاها المستخدم (801 و99)
#     — يساعد نلاقي نوع الفاتورة "النقدية" اللي قصدها لو ما طلعت بالبحث فوق
Dump "recent bu000 bills near example totals 801/99 (last 14 days)" @"
SELECT TOP 20 u.Number, u.Date, u.Total, u.Cust_Name, CONVERT(nvarchar(36), u.TypeGUID) AS type_guid
FROM bu000 u
WHERE u.Date >= DATEADD(day,-14,CAST(GETDATE() AS date))
  AND (ABS(u.Total - 801) < 2 OR ABS(u.Total - 99) < 2)
ORDER BY u.Date DESC
"@ 20

# 2) نفس الفحص لكن على جدول nt000 (أنواع السندات — لاحظناه سابقاً فيه
#    أعمدة bPayable/bReceivable مناسبة تماماً لتمييز صرف عن قبض)
Dump "nt000 note types (payable/receivable)" @"
SELECT CONVERT(nvarchar(36), GUID) AS type_guid, Name, Abbrev, bPayable, bReceivable, bCanCollect, bCanEndorse
FROM nt000
"@ 40

# 3) قيود Debit (صرف/خرج) من en000 آخر 3 أيام — عكس فحص USD credits السابق
Dump "Debit entries (payments OUT) last 3 days, any currency" @"
SELECT TOP 30 CAST(en.Date AS date) AS d, c.CustomerName, en.Debit, en.Credit, en.Notes
FROM en000 en
LEFT JOIN cu000 c ON c.AccountGUID = en.AccountGUID
WHERE en.Debit > 0
  AND en.Date >= DATEADD(day,-3,CAST(GETDATE() AS date))
ORDER BY en.Date DESC
"@ 30

# 4) لو bt000 لقى نوع صرف، نجيب عيّنة فواتير فعلية منه آخر 7 أيام
#    (نستبدل الـ GUID يدوياً بعد ما نشوف نتيجة القسم 1 — تجربة أولية
#    بدون GUID محدد، رح تفشل بهدوء وهذا متوقع بأول تشغيلة)
Dump "sample bu000 rows for any 'sarf' TypeGUID found (manual follow-up)" @"
SELECT TOP 20 u.Number, u.Date, u.Cust_Name, CONVERT(nvarchar(36), u.TypeGUID) AS type_guid
FROM bu000 u
JOIN bt000 t ON t.GUID = u.TypeGUID
WHERE t.Name LIKE N'%صرف%' OR t.Name LIKE N'%مصروف%'
  AND u.Date >= DATEADD(day,-7,CAST(GETDATE() AS date))
ORDER BY u.Date DESC
"@ 20

$conn.Close()
function Need($n){$v=[Environment]::GetEnvironmentVariable($n,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"Process")};if(-not $v){throw "Missing env var: $n"};return $v}
$url=(Need "TOBACCO_SUPABASE_URL").TrimEnd("/");$key=Need "TOBACCO_SUPABASE_PUBLIC_KEY";$email=Need "TOBACCO_SYNC_EMAIL";$pass=Need "TOBACCO_SYNC_PASSWORD"
$auth=Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey=$key;Accept="application/json"} -ContentType "application/json; charset=utf-8" -Body (@{email=$email;password=$pass}|ConvertTo-Json)
$payload=@{label="ameen-expense-payments-probe";content=$sb.ToString()}|ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey=$key;Authorization=("Bearer "+$auth.access_token);"Accept-Profile"="public";"Content-Profile"="public";Prefer="return=minimal"} -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("EXPENSE-PAYMENTS PROBE OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: expense-payments probe done."
