# ============================================================
# discover-ameen-sales-schema.ps1   (قراءة فقط — لا يعدّل أي شيء أبداً)
# الهدف: اكتشاف جداول فواتير المبيعات (الكميات المباعة: كرتونة/طرد/شرحة)
#        + حساب «زبون الكاش» + صندوق الدولار، تمهيداً لتقرير «ملخص الحركة اليومية».
# يشتغل على لابتوب الأمين (حيث متغيّر AMEEN_SQL_CONNECTION_STRING موجود).
# الناتج: ملف نصّي واحد ترسله لي:  tools\logs\ameen-sales-schema-report.txt
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutFile = "$PSScriptRoot\logs\ameen-sales-schema-report.txt"
)

$ErrorActionPreference = "Stop"

# ── تحميل tools\.env إن وُجد (لا يطبع أي سر) ──────────────────────────────────
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

# قراءة فقط: نفضّل سلسلة القراءة، ونرجع لسلسلة الكتابة فقط للاتصال (الاستعلامات كلها SELECT)
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING }
if (-not $connStr) {
    Write-Host "خطأ: لا AMEEN_SQL_CONNECTION_STRING ولا AMEEN_SQL_WRITE_CONNECTION_STRING موجود." -ForegroundColor Red
    Write-Host "شغّل أولاً سكربت إعداد البيئة على لابتوب الأمين." -ForegroundColor Yellow
    exit 1
}

$logDir = Split-Path $OutFile -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
"تقرير اكتشاف جداول المبيعات — $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Set-Content -Path $OutFile -Encoding UTF8

function Write-Both($text) {
    Write-Host $text
    $text | Add-Content -Path $OutFile -Encoding UTF8
}

# منفّذ استعلامات SELECT فقط — يطبع الأعمدة ثم الصفوف (يقصّ النصوص الطويلة)
function Run-Query($conn, $sql, $maxRows = 50) {
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $cmd.CommandTimeout = 90
        $reader = $cmd.ExecuteReader()
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        Write-Both ("الأعمدة: " + ($cols -join " | "))
        $count = 0
        while ($reader.Read() -and $count -lt $maxRows) {
            $vals = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $v = $reader.GetValue($i)
                if ($v -is [string] -and $v.Length -gt 50) { $v = $v.Substring(0, 50) }
                $vals += "$v"
            }
            Write-Both ("  " + ($vals -join " | "))
            $count++
        }
        $reader.Close()
        return $true
    } catch {
        Write-Both ("  تعذّر: " + $_.Exception.Message)
        return $false
    }
}

# يرجّع قائمة قيم عمود واحد (لاكتشاف أسماء الجداول ثم المرور عليها)
function Get-Column($conn, $sql) {
    $out = @()
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 90
        $r = $cmd.ExecuteReader()
        while ($r.Read()) { if (-not $r.IsDBNull(0)) { $out += "$($r.GetValue(0))".Trim() } }
        $r.Close()
    } catch { Write-Both ("  تعذّر جلب القائمة: " + $_.Exception.Message) }
    return $out
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    Write-Both "=== (1) كل الجداول وعدد صفوفها (الأكبر أولاً — جداول الفواتير عادةً الأكبر) ==="
    Run-Query $conn @"
SELECT TOP 80 t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY t.name
ORDER BY SUM(p.rows) DESC
"@ 80 | Out-Null

    Write-Both ""
    Write-Both "=== (2) أعمدة تخص الفواتير/الكميات/الوحدات/العملة/الكاش (لتحديد الجداول) ==="
    Run-Query $conn @"
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%Bill%' OR COLUMN_NAME LIKE '%Qty%' OR COLUMN_NAME LIKE '%Quan%'
   OR COLUMN_NAME LIKE '%Unit%' OR COLUMN_NAME LIKE '%Curr%' OR COLUMN_NAME LIKE '%Cash%'
   OR COLUMN_NAME LIKE '%Box%'  OR COLUMN_NAME LIKE '%Cust%' OR COLUMN_NAME LIKE '%Net%'
   OR COLUMN_NAME LIKE '%Total%' OR COLUMN_NAME LIKE '%Date%'
ORDER BY TABLE_NAME, ORDINAL_POSITION
"@ 400 | Out-Null

    Write-Both ""
    Write-Both "=== (3) أنواع الفواتير bt000 (لإيجاد «مبيعات مركز» ورقمه/GUID واتجاهه) ==="
    if (-not (Run-Query $conn "SELECT * FROM bt000" 60)) {
        Write-Both "  (تعذّر SELECT * — جرّب الأعمدة)"
        Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='bt000' ORDER BY ORDINAL_POSITION" 60 | Out-Null
    }

    Write-Both ""
    Write-Both "=== (4) المواد ووحداتها mt000 (هنا كرتونة/طرد/شرحة/كروز + عوامل التحويل) ==="
    Run-Query $conn "SELECT TOP 25 Code, Name, Unity, Unit2, Unit3, Unit2Fact, Unit3Fact FROM mt000 ORDER BY Name" 25 | Out-Null
    Write-Both "--- قيم الوحدة الأولى الموجودة فعلاً (Unity) ---"
    Run-Query $conn "SELECT Unity AS unit_name, COUNT(*) AS cnt FROM mt000 GROUP BY Unity ORDER BY cnt DESC" 40 | Out-Null
    Write-Both "--- قيم الوحدة الثانية (Unit2) ---"
    Run-Query $conn "SELECT Unit2 AS unit_name, COUNT(*) AS cnt FROM mt000 GROUP BY Unit2 ORDER BY cnt DESC" 40 | Out-Null
    Write-Both "--- قيم الوحدة الثالثة (Unit3) ---"
    Run-Query $conn "SELECT Unit3 AS unit_name, COUNT(*) AS cnt FROM mt000 GROUP BY Unit3 ORDER BY cnt DESC" 40 | Out-Null

    Write-Both ""
    Write-Both "=== (5) البحث عن «زبون الكاش» وصندوق الدولار في الحسابات cu000 ==="
    Run-Query $conn @"
SELECT TOP 60 CustomerName, GUID, AccountGUID
FROM cu000
WHERE CustomerName LIKE N'%كاش%' OR CustomerName LIKE N'%صندوق%'
   OR CustomerName LIKE N'%دولار%' OR CustomerName LIKE N'%نقد%'
   OR CustomerName LIKE N'%زبون%' OR CustomerName LIKE N'%cash%'
ORDER BY CustomerName
"@ 60 | Out-Null

    Write-Both ""
    Write-Both "=== (6) جداول العملات (لتمييز صندوق الدولار) ==="
    $curTables = Get-Column $conn "SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND (TABLE_NAME LIKE '%cur%' OR TABLE_NAME LIKE '%Cur%')"
    foreach ($t in $curTables) {
        Write-Both ("--- جدول: $t ---")
        Run-Query $conn "SELECT TOP 20 * FROM [$t]" 20 | Out-Null
    }

    Write-Both ""
    Write-Both "=== (7) اكتشاف جداول تفاصيل الفواتير تلقائياً (تحوي MaterialGUID، عدا قوائم الأسعار) ==="
    $detailTables = Get-Column $conn @"
SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME = 'MaterialGUID'
  AND TABLE_NAME NOT LIKE '%PriceList%'
"@
    Write-Both ("جداول مرشّحة للتفاصيل: " + ($detailTables -join ", "))
    foreach ($t in $detailTables) {
        Write-Both ("--- أعمدة $t ---")
        Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='$t' ORDER BY ORDINAL_POSITION" 60 | Out-Null
        Write-Both ("--- عينة من $t (آخر 5 صفوف بكل الأعمدة) ---")
        Run-Query $conn "SELECT TOP 5 * FROM [$t]" 5 | Out-Null
        Write-Both ""
    }

    Write-Both ""
    Write-Both "=== (8) اكتشاف جداول رؤوس الفواتير (تحوي BillTypeGUID أو CustomerGUID) ==="
    $headerTables = Get-Column $conn @"
SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME IN ('BillTypeGUID','BillType','CustomerGUID','BillNo','BillNumber','BillGUID')
"@
    Write-Both ("جداول مرشّحة للرؤوس: " + ($headerTables -join ", "))
    foreach ($t in $headerTables) {
        Write-Both ("--- أعمدة $t ---")
        Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='$t' ORDER BY ORDINAL_POSITION" 60 | Out-Null
        Write-Both ("--- عينة من $t (آخر 5 صفوف) ---")
        Run-Query $conn "SELECT TOP 5 * FROM [$t]" 5 | Out-Null
        Write-Both ""
    }

    $conn.Close()
    Write-Both ""
    Write-Both "تم بنجاح. أرسل لي محتوى هذا الملف:"
    Write-Both $OutFile
} catch {
    $msg = "خطأ: " + $_.Exception.Message
    Write-Host $msg -ForegroundColor Red
    $msg | Add-Content -Path $OutFile -Encoding UTF8
}
