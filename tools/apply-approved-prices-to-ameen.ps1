# ============================================================
# apply-approved-prices-to-ameen.ps1
# يطبّق الأسعار من CSV على قاعدة بيانات الأمين (mt000)
# - أسعار الجملة (دولار) → قائمة "جملة الجملة"
# - أسعار المفرق (دولار) → قائمة "كروزات مركز"
# المطابقة باسم المادة (mt000.Name)، والربط عبر
# MaterialPriceListItem000 (MaterialGUID + ParentGUID).
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

# قوائم الأسعار (من تقرير الاستكشاف 2026-06-10) — يمكن تجاوزها من .env
$jumlaListGuid = $env:AMEEN_JUMLA_PRICELIST_GUID
if (-not $jumlaListGuid) { $jumlaListGuid = "41459845-f84b-4146-b3ec-8299b400792e" }   # جملة الجملة
$retailListGuid = $env:AMEEN_RETAIL_PRICELIST_GUID
if (-not $retailListGuid) { $retailListGuid = "938cd3b0-75fd-4533-bad8-0fe42e6f7215" } # كروزات مركز

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$timestamp] تطبيق الأسعار على الأمين..." -ForegroundColor Cyan

# يحدّث سعر مادة في قائمة أسعار؛ وإن لم يكن لها سطر في القائمة يضيفه.
# يرجع عدد أسطر المادة في القائمة بعد التطبيق (0 = المادة غير موجودة في mt000).
function Apply-ListPrice($conn, $listGuid, $itemName, $unit1Price, $unit2Price) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = @"
UPDATE i SET i.Unit1Price = @Unit1Price, i.Unit2Price = @Unit2Price
FROM MaterialPriceListItem000 i
JOIN mt000 m ON m.GUID = i.MaterialGUID
WHERE i.ParentGUID = @ListGuid AND LTRIM(RTRIM(m.Name)) = LTRIM(RTRIM(@ItemName));
INSERT INTO MaterialPriceListItem000 (Number, GUID, MaterialGUID, Unit1Price, Unit2Price, Unit3Price, ParentGUID)
SELECT (SELECT ISNULL(MAX(Number), 0) + 1 FROM MaterialPriceListItem000),
       NEWID(), m.GUID, @Unit1Price, @Unit2Price, 0, @ListGuid
FROM mt000 m
WHERE LTRIM(RTRIM(m.Name)) = LTRIM(RTRIM(@ItemName))
  AND NOT EXISTS (
      SELECT 1 FROM MaterialPriceListItem000 x
      WHERE x.ParentGUID = @ListGuid AND x.MaterialGUID = m.GUID
  );
SELECT COUNT(*) FROM MaterialPriceListItem000 i
JOIN mt000 m ON m.GUID = i.MaterialGUID
WHERE i.ParentGUID = @ListGuid AND LTRIM(RTRIM(m.Name)) = LTRIM(RTRIM(@ItemName));
"@
    $cmd.Parameters.AddWithValue("@Unit1Price", [double]$unit1Price) | Out-Null
    $cmd.Parameters.AddWithValue("@Unit2Price", [double]$unit2Price) | Out-Null
    $cmd.Parameters.AddWithValue("@ListGuid", $listGuid) | Out-Null
    $cmd.Parameters.AddWithValue("@ItemName", $itemName) | Out-Null
    return [int]$cmd.ExecuteScalar()
}

try {
    $prices = Import-Csv -Path $CsvFile -Encoding UTF8
    Write-Host "تم قراءة $($prices.Count) سعر من CSV" -ForegroundColor Green

    # الاتصال بقاعدة بيانات الأمين
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    $jumlaApplied = 0
    $retailApplied = 0
    $skipped = 0
    $notFound = @()

    foreach ($price in $prices) {
        $itemName = $price.item_name
        if (-not $itemName) { $skipped++; continue }

        $jumlaCarton = 0.0; $jumlaUnit1 = 0.0
        if ($price.unit2_price) { $jumlaCarton = [double]$price.unit2_price }
        if ($price.sale_price)  { $jumlaUnit1  = [double]$price.sale_price }

        $retailCarton = 0.0; $retailUnit1 = 0.0
        if ($price.PSObject.Properties["retail_carton_usd"] -and $price.retail_carton_usd) { $retailCarton = [double]$price.retail_carton_usd }
        if ($price.PSObject.Properties["retail_unit1_usd"] -and $price.retail_unit1_usd)   { $retailUnit1  = [double]$price.retail_unit1_usd }

        $matched = $false

        # الجملة → قائمة "جملة الجملة"
        if ($jumlaCarton -gt 0) {
            $found = Apply-ListPrice $conn $jumlaListGuid $itemName $jumlaUnit1 $jumlaCarton
            if ($found -gt 0) { $jumlaApplied++; $matched = $true }
        }

        # المفرق → قائمة "كروزات مركز"
        if ($retailCarton -gt 0) {
            $found = Apply-ListPrice $conn $retailListGuid $itemName $retailUnit1 $retailCarton
            if ($found -gt 0) { $retailApplied++; $matched = $true }
        }

        if (-not $matched) {
            if ($jumlaCarton -gt 0 -or $retailCarton -gt 0) { $notFound += $itemName } else { $skipped++ }
        }
    }

    $conn.Close()

    $msg = "[$timestamp] Applied: jumla=$jumlaApplied, retail=$retailApplied, skipped=$skipped, not-in-ameen=$($notFound.Count)"
    Write-Host ""
    Write-Host "أسعار جملة طُبقت على قائمة (جملة الجملة): $jumlaApplied" -ForegroundColor Green
    Write-Host "أسعار مفرق طُبقت على قائمة (كروزات مركز): $retailApplied" -ForegroundColor Green
    if ($notFound.Count -gt 0) {
        Write-Host "مواد لم يُعثر عليها بالاسم في الأمين ($($notFound.Count)):" -ForegroundColor Yellow
        $notFound | Select-Object -First 20 | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    }
    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $msg | Add-Content $LogFile
    if ($notFound.Count -gt 0) { "  not found: $($notFound -join '; ')" | Add-Content $LogFile }

    exit 0

} catch {
    $errMsg = "[$timestamp] AMEEN ERROR: $($_.Exception.Message)"
    Write-Host $errMsg -ForegroundColor Red
    $errMsg | Add-Content $LogFile
    exit 1
}
