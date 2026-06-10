# ============================================================
# setup-ameen-retail-pricelist.ps1  (يُشغَّل مرة واحدة)
# 1) يمدد صلاحية قائمة "كروزات مركز" (كانت منتهية 2026-05-10)
# 2) يربط فاتورة "مبيعات مركز" بقائمة "كروزات مركز"
#    (كانت مربوطة بـ"جملة الجملة" فيبيع المركز بأسعار الجملة)
# أغلق برنامج الأمين قبل التشغيل وافتحه بعده.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\approved-prices-sync.log"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) {
    Write-Host "خطأ: AMEEN_SQL_WRITE_CONNECTION_STRING غير موجود في tools\.env" -ForegroundColor Red
    exit 1
}

# قائمة المفرق "كروزات مركز" (من تقرير الاستكشاف 2026-06-10)
$retailListGuid = $env:AMEEN_RETAIL_PRICELIST_GUID
if (-not $retailListGuid) { $retailListGuid = "938cd3b0-75fd-4533-bad8-0fe42e6f7215" }

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # (1) تمديد صلاحية القائمة وتفعيلها
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "UPDATE MaterialPriceList000 SET EndDate = '2099-12-31', IsActive = 1 WHERE GUID = @ListGuid"
    $cmd.Parameters.AddWithValue("@ListGuid", $retailListGuid) | Out-Null
    $rows1 = $cmd.ExecuteNonQuery()
    Write-Host "تمديد صلاحية قائمة كروزات مركز: $rows1 سطر ✓" -ForegroundColor Green

    # (2) ربط فاتورة مبيعات مركز بقائمة كروزات مركز
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "UPDATE bt000 SET MaterialPriceListGUID = @ListGuid WHERE Name = N'مبيعات مركز'"
    $cmd.Parameters.AddWithValue("@ListGuid", $retailListGuid) | Out-Null
    $rows2 = $cmd.ExecuteNonQuery()
    Write-Host "ربط فاتورة مبيعات مركز بقائمة كروزات مركز: $rows2 سطر ✓" -ForegroundColor Green

    # عرض الوضع النهائي للتأكد
    Write-Host ""
    Write-Host "الربط الحالي لأنواع فواتير البيع:" -ForegroundColor Cyan
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = @"
SELECT b.Name AS BillType, pl.Name AS PriceListName
FROM bt000 b
LEFT JOIN MaterialPriceList000 pl ON pl.GUID = b.MaterialPriceListGUID
WHERE b.Name IN (N'مبيعات مركز', N'مبيعات', N'طلبيات')
"@
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        Write-Host ("  " + $reader.GetValue(0) + "  →  " + $reader.GetValue(1))
    }
    $reader.Close()
    $conn.Close()

    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    "[$timestamp] SETUP: retail list extended ($rows1), markaz bill bound to kroozat-markaz ($rows2)" | Add-Content $LogFile

    Write-Host ""
    Write-Host "تم الإعداد ✓ — أعد فتح برنامج الأمين حتى يقرأ الربط الجديد." -ForegroundColor Green
    exit 0
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
