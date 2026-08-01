# ============================================================
# discover-ameen-inventory-recon-fields.ps1  (READ-ONLY — لا يرفع أي شيء لـSupabase)
# بيستكشف جداول وأعمدة الأمين المرشّحة لتزويد "الجرد الشهري" ببيانات حقيقية:
# - أرقام/أسماء المستودعات (warehouse_key المستخدم بالتطبيق حالياً: jumla/markaz)
# - رصيد الصنف الحالي بكل مستودع (system_qty)
# - تكلفة الوحدة (unit_cost) لحساب settlement_value
# - GUID نوع مستند "تسوية جرد" إن وُجد أصلاً بالأمين (لا نخترعه أبداً)
# الهدف: تجميع معطيات كافية لملء tools/push-inventory-reconciliation-to-ameen.ps1
# لاحقاً بثقة، بعد مراجعة بشرية للنتائج — هذا السكريبت لا يكتب ولا يرفع شيئاً.
# ============================================================
param()
$ErrorActionPreference = "Stop"

$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING }
if (-not $connStr) { throw "No AMEEN SQL connection string found. شغّل tools\setup-ameen-sync-env.ps1 أولاً." }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open()

function Dump($title, $sql, $maxRows = 40) {
    Write-Host ""
    Write-Host ("=== " + $title + " ===")
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
        $r = $cmd.ExecuteReader(); $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
        Write-Host ("COLS: " + ($cols -join " | ")); $n = 0
        while ($r.Read() -and $n -lt $maxRows) {
            $vals = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $v = $r.GetValue($i); if ($v -is [string] -and $v.Length -gt 60) { $v = $v.Substring(0, 60) }; $vals += "$v" }
            Write-Host ("  " + ($vals -join " | ")); $n++
        }
        $r.Close()
    } catch { Write-Host ("  ERROR: " + $_.Exception.Message) }
}

# 1) بحث عام عن أعمدة تخص المستودعات/المخزون/الكميات/التكلفة عبر كل الجداول —
#    مرشحة لتزويد system_qty وunit_cost بأرقام حقيقية بدل التقدير اليدوي حالياً.
Dump "columns matching Warehouse/Store/Qty/Stock/Cost" @"
SELECT TOP 80 TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%Warehouse%' OR COLUMN_NAME LIKE '%Store%'
   OR COLUMN_NAME LIKE '%Qty%' OR COLUMN_NAME LIKE '%Stock%'
   OR COLUMN_NAME LIKE '%Cost%'
ORDER BY TABLE_NAME, COLUMN_NAME
"@ 80

# 2) قائمة المستودعات/الفروع كما مسجّلة بالأمين — لمطابقتها يدوياً مع
#    warehouse_key المستخدم بالتطبيق (jumla / markaz)
$storeTableGuesses = @("st000", "sr000", "wh000", "br000", "ms000")
foreach ($t in $storeTableGuesses) {
    Dump "lookup attempt: $t (TOP 20)" "SELECT TOP 20 * FROM $t" 20
}

# 3) بحث عن جدول أنواع مستندات فيه ما يشير إلى "جرد" أو "تسوية" —
#    لا نفترض GUID محدد، فقط نعرض المتاح لمراجعة بشرية.
Dump "bill/document types possibly related to inventory adjustment" @"
SELECT CONVERT(nvarchar(36), TypeGUID) AS type_guid,
       COUNT(*) AS bill_count,
       MIN(Date) AS min_date,
       MAX(Date) AS max_date
FROM bu000
WHERE Date >= DATEADD(day, -365, CAST(GETDATE() AS date))
GROUP BY TypeGUID
ORDER BY COUNT(*) DESC
"@ 40

$conn.Close()
Write-Host ""
Write-Host "DONE - نتائج استكشافية فقط، لا كتابة ولا رفع. راجعها يدوياً قبل أي استخدام."
