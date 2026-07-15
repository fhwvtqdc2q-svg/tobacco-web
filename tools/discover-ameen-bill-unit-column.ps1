# ============================================================
# discover-ameen-bill-unit-column.ps1   (READ-ONLY — لا يعدّل أي شيء أبداً)
# الهدف: إيجاد العمود اللي بجدول bi000 بيحدد وحدة البيع لكل سطر فاتورة
# (كرتونة / كروز / طرد / شرحة) — عشان نصلّح حساب line_total بشكل صحيح
# لكل سطر حسب وحدته الحقيقية، بدل افتراض واحد لكل الفاتورة.
#
# بيسحب كل أعمدة bi000 (بدون استثناء) لفاتورة معروفة (رقم 52، حسن عباس،
# بتاريخ 2026-07-08) اللي عندنا صورة حقيقية منها فيها 11 سطر بوحدات
# مختلفة (كرتونة/طرد/شرحة/كروز) — هيك منقدر نطابق كل عمود بالقيمة الحقيقية
# اللي شفناها بالصورة ونلاقي العمود الصح.
#
# الناتج: يُرفع لجدول schema_probe بـSupabase (نفس أسلوب باقي سكريبتات
# discover-ameen-*)، ما في أي كتابة أو تعديل على قاعدة الأمين.
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

# 1) كل أعمدة bi000 بدون فلترة أسماء (الفحص القديم كان يفلتر بالاسم وممكن فوّت العمود المطلوب)
Dump "bi000 - كل الأعمدة (بدون فلترة)" @"
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'bi000'
ORDER BY ORDINAL_POSITION
"@ 100

# 2) كل صفوف الفاتورة رقم $BillNo (نتوقع 11 سطر بوحدات مختلطة — كرتونة/طرد/شرحة/كروز)
#    بكل الأعمدة، عشان نطابقها يدوياً بالصورة الحقيقية من شاشة الأمين
Dump "bi000 - كل أعمدة فاتورة رقم $BillNo (بيل u.Number = $BillNo)" @"
SELECT bi.*
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
WHERE u.Number = '$BillNo'
ORDER BY bi.RowIndex
"@ 60

# احتياط: لو ما في عمود RowIndex يفشل الترتيب فقط، جرّب بدون ORDER BY
Dump "bi000 - نفس الفاتورة بدون ترتيب (احتياط لو فشل الاستعلام السابق)" @"
SELECT bi.*
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
WHERE u.Number = '$BillNo'
"@ 60

$conn.Close()
function Need($n) { $v = [Environment]::GetEnvironmentVariable($n, "User"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Process") }; if (-not $v) { throw "Missing env var: $n" }; return $v }
$url = (Need "TOBACCO_SUPABASE_URL").TrimEnd("/"); $key = Need "TOBACCO_SUPABASE_PUBLIC_KEY"; $email = Need "TOBACCO_SYNC_EMAIL"; $pass = Need "TOBACCO_SYNC_PASSWORD"
$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{apikey = $key; Accept = "application/json" } -ContentType "application/json; charset=utf-8" -Body (@{email = $email; password = $pass } | ConvertTo-Json)
$payload = @{label = "ameen-bill-unit-column-probe"; content = $sb.ToString() } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" -Headers @{apikey = $key; Authorization = ("Bearer " + $auth.access_token); "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "return=minimal" } -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null
Write-Host ("PROBE OK - uploaded " + $sb.Length + " characters.")
Write-Host "Tell the assistant: bill-unit-column probe done."
