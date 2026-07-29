# ============================================================
# discover-ameen-purchase-schema.ps1  (READ ONLY — لا يكتب ولا يعدّل شيئاً)
# الهدف: اكتشاف بنية الأمين اللازمة لاحقاً لمزامنة فواتير المشتريات ولقطة
# الأصناف (ameen_item_snapshot) — بلا أي افتراض مسبق لأسماء أعمدة/GUIDs.
#
# هذا السكربت جزء من عمل تطوير/توثيق فقط (فرع purchase-invoices-ameen-v2)؛
# لا يُشغَّل تلقائياً ولا يُسجَّل كمهمة مجدولة. يُشغَّله المستخدم يدوياً من جهاز
# LOQ فقط عندما يقرر مراجعة نتائجه، بعد موافقته على المضي بمرحلة المزامنة.
#
# لا يطبع كلمة مرور أو سلسلة اتصال أو أي محتوى من tools\.env مطلقاً — فقط
# نتائج استعلامات SELECT على بنية الجداول وعينات بيانات محدودة العدد.
# ASCII-only source لتفادي مشاكل ترميز PowerShell 5.1.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env"
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
function Get-Setting($Name) {
    $v = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, "User") }
    return $v
}

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
if (-not $connStr) { Write-Host "ERROR: AMEEN_SQL_CONNECTION_STRING not found."; exit 1 }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()

function Run($title, $sql) {
    Write-Host ""
    Write-Host "==================== $title ===================="
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $cmd.CommandTimeout = 60
        $reader = $cmd.ExecuteReader()
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        Write-Host ("[" + ($cols -join " | ") + "]")
        $n = 0
        while ($reader.Read()) {
            $vals = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) { $vals += [string]$reader.GetValue($i) }
            Write-Host ($vals -join " | ")
            $n++
        }
        $reader.Close()
        Write-Host "(rows: $n)"
    } catch {
        Write-Host ("FAILED: " + $_.Exception.Message)
    }
}

# 1) جدول أنواع الفواتير — للتأكد من TypeGUID الحقيقي لفاتورة الشراء والمرتجع
#    (لا نفترض 91377a56 / c9aca8fe هنا رغم توثيقهما سابقاً — إعادة تحقق دائماً)
Run "bt000 BILL TYPES (bIsInput/bIsOutput)" "SELECT * FROM dbo.bt000"

# 2) أعمدة رأس فاتورة الشراء
Run "bu000 COLUMNS" "SELECT c.name AS col, t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('dbo.bu000') ORDER BY c.column_id"

# 3) أعمدة سطور الفاتورة (تفاصيل الأصناف)
Run "bd000 COLUMNS (ابحث عن اسم الجدول الصحيح إن اختلف)" "SELECT c.name AS col, t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('dbo.bd000') ORDER BY c.column_id"

# 4) كل الجداول التي قد تحوي سطور الفواتير أو المخزون أو الموردين (بحث بالاسم)
Run "TABLES LIKE %bill% / %item% / %stock% / %supplier%" "SELECT name FROM sys.tables WHERE name LIKE '%bill%' OR name LIKE '%item%' OR name LIKE '%stock%' OR name LIKE '%supplier%' OR name LIKE 'bd%' OR name LIKE 'ms%' ORDER BY name"

# 5) عينة صغيرة من فواتير الشراء الأخيرة (bIsInput=1) للتحقق من الأعمدة الفعلية
Run "SAMPLE PURCHASE INVOICES (TOP 10)" "SELECT TOP 10 bu.* FROM dbo.bu000 bu JOIN dbo.bt000 bt ON bt.GUID = bu.TypeGUID WHERE bt.bIsInput = 1 ORDER BY bu.Date_ DESC"

# 6) أعمدة جدول المواد (للتحقق من الوحدة1/الوحدة2 ومعامل التحويل واسم المادة)
Run "mt000/ms000-LIKE MATERIAL TABLES" "SELECT name FROM sys.tables WHERE name LIKE 'mt%' OR name LIKE 'ms%' ORDER BY name"

Run "mt000 COLUMNS (إن وُجد)" "SELECT c.name AS col, t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('dbo.mt000') ORDER BY c.column_id"

$conn.Close()
Write-Host ""
Write-Host "==================== DONE (read only, no writes) ===================="
Write-Host "ملاحظة: هذا السكربت لا يفترض أي أسماء نهائية — راجع المخرجات فعلياً"
Write-Host "قبل كتابة أي استعلام حقيقي في push-purchase-item-snapshot.ps1 أو"
Write-Host "sync-purchase-invoices-to-ameen.ps1."
