# ============================================================
# discover-item-stock-2.ps1  (قراءة فقط)
# الفحص الحاسم لفرق المخزون: تفكيك حركة المادة حسب المستودع ونوع الفاتورة،
# وفحص أعمدة الترحيل على bu000، وطباعة استعلام المخزون داخل ameen-sync-agent.ps1.
# التشغيل:  .\tools\discover-item-stock-2.ps1
# ============================================================
param(
    [string]$Item = "ماستر طويل ورق",
    [string]$EnvFile = "$PSScriptRoot\.env"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_CONNECTION_STRING }
if (-not $connStr) { Write-Host "خطأ: connection string غير موجود." -ForegroundColor Red; exit 1 }

function Show-Query($conn, $title, $sql, $params) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Yellow
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandTimeout = 120; $cmd.CommandText = $sql
        foreach ($k in $params.Keys) { $cmd.Parameters.AddWithValue($k, $params[$k]) | Out-Null }
        $rd = $cmd.ExecuteReader()
        $cols = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $cols += $rd.GetName($i) }
        Write-Host ("  " + ($cols -join " | "))
        $n = 0
        while ($rd.Read()) {
            $vals = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $vals += "$($rd.GetValue($i))" }
            Write-Host ("  " + ($vals -join " | ")); $n++
        }
        $rd.Close()
        if ($n -eq 0) { Write-Host "  (لا صفوف)" }
    } catch { Write-Host ("  تعذّر: " + $_.Exception.Message) -ForegroundColor Red }
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # (1) جدول المستودعات — نجرب st000 ثم أي جدول فيه Store
    Show-Query $conn "(1) جداول تحمل Store/wh في الاسم" @"
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE '%tore%' OR TABLE_NAME LIKE 'st0%' OR TABLE_NAME LIKE 'wh0%'
"@ @{}
    Show-Query $conn "(1b) محتوى st000 (المستودعات) إن وُجد" @"
SELECT TOP 10 CAST(GUID AS varchar(40)) AS guid, LTRIM(RTRIM(Name)) AS name FROM dbo.st000
"@ @{}

    # (2) التفكيك الحاسم: المادة المحددة بالضبط × المستودع × نوع الفاتورة
    Show-Query $conn "(2) حركة «$Item» (الاسم مطابق تماماً) حسب المستودع ونوع الفاتورة" @"
SELECT LTRIM(RTRIM(COALESCE(s.Name, CAST(bi.StoreGUID AS varchar(40))))) AS store,
       bt.Name AS bill_type, bt.BillType AS bill_class,
       COUNT(*) AS lines,
       CAST(SUM(COALESCE(bi.Qty,0)) AS decimal(18,3)) AS total_qty
FROM dbo.bi000 bi
JOIN dbo.bu000 u ON u.GUID = bi.ParentGUID
JOIN dbo.bt000 bt ON bt.GUID = u.TypeGUID
JOIN dbo.mt000 m ON m.GUID = bi.MatGUID
LEFT JOIN dbo.st000 s ON s.GUID = bi.StoreGUID
WHERE LTRIM(RTRIM(m.Name)) = LTRIM(RTRIM(@it))
GROUP BY LTRIM(RTRIM(COALESCE(s.Name, CAST(bi.StoreGUID AS varchar(40))))), bt.Name, bt.BillType
ORDER BY store, bt.BillType
"@ @{ "@it" = $Item }

    # (3) أعمدة الترحيل/الحالة على bu000 وقيمها لفاتورتي الشراء
    Show-Query $conn "(3) أعمدة bu000 التي قد تعني ترحيل/مسودة" @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'bu000' AND (COLUMN_NAME LIKE '%Post%' OR COLUMN_NAME LIKE '%Draft%'
   OR COLUMN_NAME LIKE '%Rec%' OR COLUMN_NAME LIKE '%Sav%' OR COLUMN_NAME LIKE '%Susp%'
   OR COLUMN_NAME LIKE '%Cancel%' OR COLUMN_NAME LIKE '%Void%' OR COLUMN_NAME LIKE 'Is%')
"@ @{}
    Show-Query $conn "(3b) فاتورتا الشراء للمادة (رؤوسها كاملة الأعمدة المهمة)" @"
SELECT CONVERT(varchar(10), u.Date, 120) AS dt, bt.Name AS bill_type,
       CAST(bi.Qty AS decimal(18,3)) AS qty,
       LTRIM(RTRIM(COALESCE(s.Name,''))) AS store,
       LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) AS customer,
       CAST(u.GUID AS varchar(40)) AS bill_guid
FROM dbo.bi000 bi
JOIN dbo.bu000 u ON u.GUID = bi.ParentGUID
JOIN dbo.bt000 bt ON bt.GUID = u.TypeGUID
JOIN dbo.mt000 m ON m.GUID = bi.MatGUID
LEFT JOIN dbo.st000 s ON s.GUID = bi.StoreGUID
WHERE LTRIM(RTRIM(m.Name)) = LTRIM(RTRIM(@it)) AND bt.BillType = 0
ORDER BY u.Date
"@ @{ "@it" = $Item }

    $conn.Close()

    # (4) استعلام المخزون داخل agent — نطبع المنطقة 150..300 كاملة (الفحص السابق لم يلتقط SQL)
    Write-Host ""
    Write-Host "=== (4) ameen-sync-agent.ps1 — الأسطر 150 إلى 300 (منطقة استعلام المخزون) ===" -ForegroundColor Yellow
    $agent = "$PSScriptRoot\ameen-sync-agent.ps1"
    if (Test-Path $agent) {
        $lines = Get-Content $agent
        $from = 149; $to = [Math]::Min(299, $lines.Count - 1)
        for ($i = $from; $i -le $to; $i++) { Write-Host ("{0,4}: {1}" -f ($i + 1), $lines[$i]) }
    } else {
        Write-Host "  ameen-sync-agent.ps1 غير موجود في tools\" -ForegroundColor Red
    }
    exit 0
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
