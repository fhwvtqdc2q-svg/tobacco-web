# ============================================================
# discover-ameen-returns-schema.ps1  (READ-ONLY — لا كتابة إطلاقاً)
# اكتشاف سلاسل ترقيم وأنواع فواتير المرتجعات (مبيعات جملة/مركز، مشتريات)
# في قاعدة الأمين AmnDb002، لدعم ميزة مرتجعات المبيعات والمشتريات.
#
# يطبع النتائج على الشاشة فقط (وملف log اختياري)، ولا يكتب أي شيء
# في الأمين ولا في Supabase.
# ============================================================
param(
    [string]$OutFile = "$PSScriptRoot\logs\discover-returns-schema.txt"
)
$ErrorActionPreference = "Stop"

# هذا السكربت للقراءة فقط ولا يجوز له أن يقترب من أي اتصال كتابة. لا نقرأ
# tools\.env هنا إطلاقاً (يجب أن تكون AMEEN_SQL_CONNECTION_STRING قد صُدِّرت
# مسبقاً في متغيرات بيئة العملية الحالية عبر setup-ameen-sync-env.ps1 أو ما
# يعادله) — ونرفض العمل صراحة إن كان متغير الكتابة موجوداً أصلاً بالبيئة،
# حتى لو كان متغير القراءة متوفراً أيضاً، منعاً لأي خطأ بشري يستخدم هذا
# السكربت مع بيئة فيها صلاحية كتابة على الأمين.
if ($env:AMEEN_SQL_WRITE_CONNECTION_STRING) {
    throw "رُفض التشغيل: AMEEN_SQL_WRITE_CONNECTION_STRING موجود في متغيرات البيئة. هذا السكربت قراءة فقط ولا يجوز تشغيله أبداً في بيئة فيها اتصال كتابة على الأمين — أزل المتغير من هذه الجلسة أولاً."
}
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { throw "لا يوجد AMEEN_SQL_CONNECTION_STRING في متغيرات بيئة العملية الحالية. صدّره أولاً (مثلاً عبر setup-ameen-sync-env.ps1) — هذا السكربت لا يقرأ tools\.env." }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open()
$sb = New-Object System.Text.StringBuilder
function Line($t) { [void]$sb.AppendLine($t); Write-Host $t }
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

# 1) كل أنواع الفواتير في bt000 مع BillType واسم النوع، وعدد فواتيرها في bu000
Dump "bt000 all types with usage counts" @"
SELECT CAST(bt.GUID AS varchar(40)) AS type_guid,
       LTRIM(RTRIM(COALESCE(bt.Name,''))) AS type_name,
       bt.BillType AS bill_class,
       COUNT(u.GUID) AS bills,
       MAX(u.Number) AS last_number,
       MAX(u.Date) AS last_date
FROM bt000 bt
LEFT JOIN bu000 u ON u.TypeGUID = bt.GUID
GROUP BY bt.GUID, bt.Name, bt.BillType
ORDER BY bt.BillType, bt.Name
"@ 80

# 2) تركيز على الأسماء التي تحوي "مرتجع" أو "مشتريات" أو "مشتري"
Dump "types matching return/purchase keywords" @"
SELECT CAST(bt.GUID AS varchar(40)) AS type_guid,
       LTRIM(RTRIM(COALESCE(bt.Name,''))) AS type_name,
       bt.BillType AS bill_class
FROM bt000 bt
WHERE bt.Name LIKE N'%مرتجع%' OR bt.Name LIKE N'%مشتري%'
ORDER BY bt.BillType, bt.Name
"@ 40

# 3) أعمدة bi000 (تفاصيل الفاتورة) للتأكد من أسماء أعمدة الكمية/السعر/التكلفة
Dump "bi000 columns" @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bi000' ORDER BY ORDINAL_POSITION
"@ 60

# 4) أعمدة bu000 (رأس الفاتورة) — التأكد من وجود أعلام bIsInput/bIsOutput ونقدي/آجل
Dump "bu000 columns" @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bu000' ORDER BY ORDINAL_POSITION
"@ 80

$conn.Close()

$dir = Split-Path $OutFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$sb.ToString() | Out-File -LiteralPath $OutFile -Encoding UTF8
Write-Host ""
Write-Host "Saved to $OutFile"
