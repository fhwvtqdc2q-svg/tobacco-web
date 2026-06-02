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

try {
    $prices = Import-Csv -Path $CsvFile -Encoding UTF8
    Write-Host "تم قراءة $($prices.Count) سعر من CSV" -ForegroundColor Green

    # الاتصال بقاعدة بيانات الأمين
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    $updated = 0
    $skipped = 0

    foreach ($price in $prices) {
        if (-not $price.item_name -or [double]$price.unit2_price -le 0) {
            $skipped++
            continue
        }

        $cmd = $conn.CreateCommand()
        # تحديث سعر المادة في جدول الأمين MaterialPriceListItem000
        $cmd.CommandText = @"
UPDATE MaterialPriceListItem000
SET SalePrice = @SalePrice,
    SalePrice2 = @Unit2Price,
    UpdatedAt = GETDATE()
WHERE MaterialName = @ItemName
OR MaterialCode = @ItemKey
"@
        $cmd.Parameters.AddWithValue("@SalePrice", [double]$price.sale_price) | Out-Null
        $cmd.Parameters.AddWithValue("@Unit2Price", [double]$price.unit2_price) | Out-Null
        $cmd.Parameters.AddWithValue("@ItemName", $price.item_name) | Out-Null
        $cmd.Parameters.AddWithValue("@ItemKey", $price.item_key) | Out-Null

        $rows = $cmd.ExecuteNonQuery()
        if ($rows -gt 0) { $updated++ } else { $skipped++ }
    }

    $conn.Close()

    $msg = "[$timestamp] Applied: $updated updated, $skipped skipped"
    Write-Host $msg -ForegroundColor Green
    $msg | Add-Content $LogFile

    exit 0

} catch {
    $errMsg = "[$timestamp] AMEEN ERROR: $($_.Exception.Message)"
    Write-Host $errMsg -ForegroundColor Red
    $errMsg | Add-Content $LogFile
    exit 1
}
