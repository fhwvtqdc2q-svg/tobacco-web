# ============================================================
# discover-item-stock-4.ps1  (قراءة فقط)
# التحقق قبل تركيب الإصلاح: يطبع أنواع الفواتير (bt000) وتفصيل ms000،
# ويجرّب حساب المخزون من الفواتير على مواد معلومة — يجب أن يعطي
# «ماستر طويل ورق» = 21 قبل اعتماد الاستعلام الجديد.
# التشغيل:  .\tools\discover-item-stock-4.ps1
# ============================================================
param(
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

function Show-Query($conn, $title, $sql) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Yellow
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandTimeout = 180; $cmd.CommandText = $sql
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

    # (1) كل أنواع الفواتير وأعمدة bt000 المؤثرة على الاتجاه
    Show-Query $conn "(1) أعمدة bt000" @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bt000' ORDER BY ORDINAL_POSITION
"@
    Show-Query $conn "(1b) كل أنواع الفواتير (الاسم، الصنف، وأي عمود اتجاه)" @"
SELECT Name, BillType FROM dbo.bt000 ORDER BY BillType, Name
"@

    # (2) ms000: أعمدته وصفوف «ماستر طويل ورق» (لفهم مصدر 521)
    Show-Query $conn "(2) أعمدة ms000" @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ms000' ORDER BY ORDINAL_POSITION
"@
    Show-Query $conn "(2b) صفوف ms000 لمادة ماستر طويل ورق" @"
SELECT LTRIM(RTRIM(COALESCE(s.Name,''))) AS store, ms.Qty
FROM dbo.ms000 ms
JOIN dbo.mt000 m ON m.GUID = ms.MatGUID
LEFT JOIN dbo.st000 s ON s.GUID = ms.StoreGUID
WHERE LTRIM(RTRIM(m.Name)) = N'ماستر طويل ورق'
"@

    # (3) عروض/جداول كميات جاهزة قد تكون مصدر الأمين الرسمي
    Show-Query $conn "(3) عروض/جداول فيها Qty في الاسم" @"
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE '%Qty%' OR TABLE_NAME LIKE '%Quant%' OR TABLE_NAME LIKE 'vwMaterial%'
ORDER BY TABLE_NAME
"@

    # (4) الحساب المرشّح من الفواتير (اتجاه حسب صنف الفاتورة):
    #     + : 0 شراء، 2 مرتجع بيع، 4 أول المدة، 5 إدخال
    #     - : 1 بيع، 3 مرتجع شراء، 6 إخراج
    #     يجب أن يعطي ماستر طويل ورق = 21
    Show-Query $conn "(4) الحساب المرشّح لمواد معلومة (تحقق: ماستر طويل ورق = 21)" @"
SELECT LTRIM(RTRIM(m.Name)) AS name,
       CAST(SUM(CASE WHEN bt.BillType IN (0,2,4,5) THEN COALESCE(bi.Qty,0)
                     WHEN bt.BillType IN (1,3,6)   THEN -COALESCE(bi.Qty,0)
                     ELSE 0 END) AS decimal(18,3)) AS calc_stock,
       CAST(SUM(CASE WHEN bt.BillType NOT IN (0,1,2,3,4,5,6) THEN COALESCE(bi.Qty,0) ELSE 0 END) AS decimal(18,3)) AS unmapped_qty
FROM dbo.bi000 bi
JOIN dbo.bu000 u ON u.GUID = bi.ParentGUID
JOIN dbo.bt000 bt ON bt.GUID = u.TypeGUID
JOIN dbo.mt000 m ON m.GUID = bi.MatGUID
WHERE LTRIM(RTRIM(m.Name)) IN (N'ماستر طويل ورق', N'ماستر طويل ورق ازرق', N'ماستر سليم أزرق', N'غلواز قصير أحمر')
GROUP BY LTRIM(RTRIM(m.Name))
"@

    $conn.Close()
    Write-Host ""
    Write-Host "تم — أرسل الناتج كاملاً." -ForegroundColor Cyan
    exit 0
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
