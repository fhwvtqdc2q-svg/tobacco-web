# ============================================================
# discover-ameen-shamcash-fund.ps1   (READ-ONLY — لا يعدّل أي شيء أبداً)
# الهدف: فهم بنية صندوق "شام كاش" بشجرة حسابات الأمين، وشو نوع الحركات
# (دفعات زبائن / سحوبات / تحويلات داخلية) اللي بتصير عليه — تمهيداً
# لإظهار السحوبات منه بالتقرير المسائي.
# الناتج: يُرفع لجدول schema_probe بـSupabase (نفس أسلوب باقي سكريبتات
# discover-ameen-*)، ما في أي كتابة أو تعديل على قاعدة الأمين.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [int]$Days = 14
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

# 1) إيجاد حساب/حسابات "شام كاش" بشجرة الحسابات
Dump "حسابات باسم شام كاش (ac000)" @"
SELECT CONVERT(nvarchar(36), GUID) AS acc_guid, Name, LatinName, Type,
       CONVERT(nvarchar(36), ParentGUID) AS parent_guid
FROM ac000
WHERE Name LIKE N'%شام كاش%' OR Name LIKE N'%شامكاش%' OR LatinName LIKE '%sham%cash%'
"@ 30

# 2) الحساب الأب (تصنيف الصندوق: صندوق نقدي؟ بنك؟ وسيط تحويل؟)
Dump "الحساب الأب لصندوق شام كاش" @"
SELECT CONVERT(nvarchar(36), a.GUID) AS acc_guid, a.Name, a.Type,
       CONVERT(nvarchar(36), a.ParentGUID) AS parent_guid, p.Name AS parent_name, p.Type AS parent_type
FROM ac000 a
LEFT JOIN ac000 p ON p.GUID = a.ParentGUID
WHERE a.Name LIKE N'%شام كاش%' OR a.Name LIKE N'%شامكاش%'
"@ 30

# 3) كل الحركات (en000) على حساب شام كاش آخر N يوم — مدين ودائن معاً،
#    مع اسم الحساب المقابل (الطرف التاني بنفس القيد) لفهم نوع كل حركة
Dump "حركات شام كاش آخر $Days يوم (مع الطرف المقابل)" @"
SELECT CAST(en.Date AS date) AS d, en.Debit, en.Credit, en.Notes,
       CONVERT(nvarchar(36), en.RelatedGUID) AS related_guid,
       other.Name AS other_side_account, other.Type AS other_side_type,
       cust.CustomerName AS other_side_customer
FROM en000 en
JOIN ac000 acc ON acc.GUID = en.AccountGUID
LEFT JOIN en000 en2 ON en2.RelatedGUID = en.RelatedGUID AND en2.GUID <> en.GUID
LEFT JOIN ac000 other ON other.GUID = en2.AccountGUID
LEFT JOIN cu000 cust ON cust.AccountGUID = en2.AccountGUID
WHERE (acc.Name LIKE N'%شام كاش%' OR acc.Name LIKE N'%شامكاش%')
  AND en.Date >= DATEADD(day, -$Days, CAST(GETDATE() AS date))
ORDER BY en.Date DESC
"@ 60

# 4) احتياط: لو RelatedGUID مش موجود بـen000 (استعلام رقم 3 بيفشل)، نجرب
#    عرض حركات شام كاش لحالها بس (بدون الطرف المقابل) للتأكد على الأقل
#    من وجود بيانات ومقدار حجمها
Dump "حركات شام كاش لحالها (احتياط بدون الطرف المقابل)" @"
SELECT CAST(en.Date AS date) AS d, en.Debit, en.Credit, en.Notes
FROM en000 en
JOIN ac000 acc ON acc.GUID = en.AccountGUID
WHERE (acc.Name LIKE N'%شام كاش%' OR acc.Name LIKE N'%شامكاش%')
  AND en.Date >= DATEADD(day, -$Days, CAST(GETDATE() AS date))
ORDER BY en.Date DESC
"@ 60

$conn.Close()
function Need($n) { $v = [Environment]::GetEnvironmentVariable($n, "User"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Process") }; if (-not $v) { throw "Missing env var: $n" }; return $v }
$url = (Need "TOBACCO_SUPABASE_URL").TrimEnd("/"); $key = Need "TOBACCO_SUPABASE_PUBLIC_KEY"; $email = Need "TOBACCO_SYNC_EMAIL"; $pass = Need "TOBACCO_SYNC_PASSWORD"
$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey = $key; Accept = "application/json" } -ContentType "application/json; charset=utf-8" -Body (@{email = $email; password = $pass } | ConvertTo-Json)
$payload = @{label = "ameen-shamcash-fund-probe"; content = $sb.ToString() } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey = $key; Authorization = ("Bearer " + $auth.access_token); "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "return=minimal" } -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("PROBE OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: shamcash-fund probe done."
