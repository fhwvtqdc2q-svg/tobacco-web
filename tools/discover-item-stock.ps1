# ============================================================
# discover-item-stock.ps1  (قراءة فقط)
# يفكك حركة مادة في الأمين حسب نوع الفاتورة والمستودع، لمقارنة
# مجموعها مع رقم المزامنة ومعرفة أي الفواتير لا تُحتسب.
# التشغيل:  .\tools\discover-item-stock.ps1
#           .\tools\discover-item-stock.ps1 -Item "ماستر طويل ورق"
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
if (-not $connStr) { Write-Host "خطأ: connection string غير موجود في tools\.env" -ForegroundColor Red; exit 1 }

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
            $vals = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $v = $rd.GetValue($i); $vals += "$v" }
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

    Show-Query $conn "بيانات المادة (mt000)" @"
SELECT Number, LTRIM(RTRIM(Name)) AS name, Unity, Unit2, Unit2Fact, CAST(GUID AS varchar(40)) AS guid
FROM dbo.mt000 WHERE Name LIKE N'%' + @it + N'%'
"@ @{ "@it" = $Item }

    # أعمدة bi000 المتعلقة بالمستودع/الكمية (للاطلاع)
    Show-Query $conn "أعمدة bi000 التي فيها Store أو Qty" @"
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'bi000' AND (COLUMN_NAME LIKE '%Store%' OR COLUMN_NAME LIKE '%Qty%')
"@ @{}

    # التفكيك الحاسم: مجموع كمية المادة حسب نوع الفاتورة
    Show-Query $conn "حركة «$Item» حسب نوع الفاتورة (المجموع بالوحدة الأساسية)" @"
SELECT bt.Name AS bill_type, bt.BillType AS bill_class,
       COUNT(*) AS lines,
       CAST(SUM(COALESCE(bi.Qty,0)) AS decimal(18,3)) AS total_qty,
       CONVERT(varchar(10), MIN(u.Date), 120) AS from_date,
       CONVERT(varchar(10), MAX(u.Date), 120) AS to_date
FROM dbo.bi000 bi
JOIN dbo.bu000 u ON u.GUID = bi.ParentGUID
JOIN dbo.bt000 bt ON bt.GUID = u.TypeGUID
JOIN dbo.mt000 m ON m.GUID = bi.MatGUID
WHERE m.Name LIKE N'%' + @it + N'%'
GROUP BY bt.Name, bt.BillType
ORDER BY bt.BillType
"@ @{ "@it" = $Item }

    # كل أسطر المادة تفصيلاً (آخر 30) لمعرفة أي فاتورة أدخلت/أخرجت كم
    Show-Query $conn "آخر 30 سطراً للمادة (تفصيلي)" @"
SELECT TOP 30 CONVERT(varchar(10), u.Date, 120) AS dt, bt.Name AS bill_type,
       CAST(bi.Qty AS decimal(18,3)) AS qty,
       LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) AS customer
FROM dbo.bi000 bi
JOIN dbo.bu000 u ON u.GUID = bi.ParentGUID
JOIN dbo.bt000 bt ON bt.GUID = u.TypeGUID
JOIN dbo.mt000 m ON m.GUID = bi.MatGUID
WHERE m.Name LIKE N'%' + @it + N'%'
ORDER BY u.Date DESC
"@ @{ "@it" = $Item }

    $conn.Close()

    Write-Host ""
    Write-Host "=== استعلام حساب المخزون داخل ameen-sync-agent.ps1 (كما هو على هذا الجهاز) ===" -ForegroundColor Yellow
    $agent = "$PSScriptRoot\ameen-sync-agent.ps1"
    if (Test-Path $agent) {
        Select-String -Path $agent -Pattern "SELECT|SUM|Qty|bt\.|BillType|bi000|WHERE" | ForEach-Object { Write-Host ("  " + $_.LineNumber + ": " + $_.Line.Trim()) }
    } else {
        Write-Host "  (ameen-sync-agent.ps1 غير موجود في tools\ — أخبرني بمكانه)"
    }
    exit 0
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
