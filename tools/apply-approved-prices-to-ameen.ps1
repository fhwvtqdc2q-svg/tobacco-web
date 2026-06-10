# ============================================================
# apply-approved-prices-to-ameen.ps1
# يطبّق الأسعار من CSV على قاعدة بيانات الأمين (mt000)
# ============================================================

param(
    [string]$CsvFile = "$PSScriptRoot\..\reports\prices\tobacco-approved-prices.csv",
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\approved-prices-sync.log"
)

# قراءة الإعدادات
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) {
    Write-Host "خطأ: AMEEN_SQL_WRITE_CONNECTION_STRING غير موجود في .env" -ForegroundColor Red
    Write-Host "أضف هذا السطر في tools\.env:" -ForegroundColor Yellow
    Write-Host "AMEEN_SQL_WRITE_CONNECTION_STRING=Server=localhost;Database=mt000;User Id=sa;Password=YOUR_PASSWORD;" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $CsvFile)) {
    Write-Host "ملف CSV غير موجود: $CsvFile" -ForegroundColor Red
    exit 1
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$timestamp] تطبيق الأسعار على الأمين..." -ForegroundColor Cyan

# عمود سعر المفرق في جدول الأمين (مثال: AMEEN_RETAIL_PRICE_COLUMN=SalePrice3)
# يُكتب فيه سعر الكروز بالدولار (سعر المفرق ÷ عدد الكروز بالكرتونة).
# اتركه فارغاً حتى نعرف أي عمود/قائمة تستخدمها شاشة "مبيعات مركز"
# (شغّل tools\discover-ameen-pricelists.ps1 وأرسل التقرير).
$retailColumn = $env:AMEEN_RETAIL_PRICE_COLUMN
if ($retailColumn -and $retailColumn -notmatch '^[A-Za-z0-9_]+$') {
    Write-Host "خطأ: AMEEN_RETAIL_PRICE_COLUMN يحتوي رموزاً غير مسموحة: $retailColumn" -ForegroundColor Red
    exit 1
}

try {
    $prices = Import-Csv -Path $CsvFile -Encoding UTF8
    Write-Host "تم قراءة $($prices.Count) سعر من CSV" -ForegroundColor Green
    if ($retailColumn) {
        Write-Host "سعر المفرق سيُكتب في العمود: $retailColumn" -ForegroundColor Cyan
    } else {
        Write-Host "تنبيه: AMEEN_RETAIL_PRICE_COLUMN غير مضبوط في .env — أسعار المفرق لن تُطبّق على الأمين." -ForegroundColor Yellow
    }

    # الاتصال بقاعدة بيانات الأمين
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    $updated = 0
    $skipped = 0
    $retailApplied = 0

    foreach ($price in $prices) {
        if (-not $price.item_name -or [double]$price.unit2_price -le 0) {
            $skipped++
            continue
        }

        $retailUnit1 = 0.0
        if ($price.PSObject.Properties["retail_unit1_usd"] -and $price.retail_unit1_usd) {
            $retailUnit1 = [double]$price.retail_unit1_usd
        }
        $writeRetail = $retailColumn -and ($retailUnit1 -gt 0)

        $retailSet = ""
        if ($writeRetail) { $retailSet = ",`n    [$retailColumn] = @RetailUnit1Price" }

        $cmd = $conn.CreateCommand()
        # تحديث سعر المادة في جدول الأمين MaterialPriceListItem000
        $cmd.CommandText = @"
UPDATE MaterialPriceListItem000
SET SalePrice = @SalePrice,
    SalePrice2 = @Unit2Price$retailSet,
    UpdatedAt = GETDATE()
WHERE MaterialName = @ItemName
OR MaterialCode = @ItemKey
"@
        $cmd.Parameters.AddWithValue("@SalePrice", [double]$price.sale_price) | Out-Null
        $cmd.Parameters.AddWithValue("@Unit2Price", [double]$price.unit2_price) | Out-Null
        $cmd.Parameters.AddWithValue("@ItemName", $price.item_name) | Out-Null
        $cmd.Parameters.AddWithValue("@ItemKey", $price.item_key) | Out-Null
        if ($writeRetail) { $cmd.Parameters.AddWithValue("@RetailUnit1Price", $retailUnit1) | Out-Null }

        $rows = $cmd.ExecuteNonQuery()
        if ($rows -gt 0) {
            $updated++
            if ($writeRetail) { $retailApplied++ }
        } else { $skipped++ }
    }

    $conn.Close()

    $msg = "[$timestamp] Applied: $updated updated ($retailApplied with retail), $skipped skipped"
    Write-Host $msg -ForegroundColor Green
    $msg | Add-Content $LogFile

    exit 0

} catch {
    $errMsg = "[$timestamp] AMEEN ERROR: $($_.Exception.Message)"
    Write-Host $errMsg -ForegroundColor Red
    $errMsg | Add-Content $LogFile
    exit 1
}
