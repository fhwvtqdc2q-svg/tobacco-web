# ============================================================
# export-unit-factors.ps1
# يستخرج عوامل التحويل (الوحدة → الكرتونة) من قاعدة الأمين
# ويحدّث scripts/price-data.json
# ============================================================
# الاستخدام: .\tools\export-unit-factors.ps1
# ============================================================

param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"

# ── اتصال ────────────────────────────────────────────────────────────────────
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) {
    Write-Host "خطأ: متغير AMEEN_SQL_CONNECTION_STRING غير موجود." -ForegroundColor Red
    Write-Host "شغّل أولاً: .\tools\setup-ameen-sync-env.ps1" -ForegroundColor Yellow
    exit 1
}

# ── استعلام عامل التحويل ─────────────────────────────────────────────────────
# يبحث في أكثر الأعمدة شيوعاً في الأمين
$query = @"
SELECT
    m.Name        AS item_name,
    m.Code        AS item_key,
    COALESCE(
        m.UnitFactor,
        m.ConversionFactor,
        m.PackSize,
        m.UnitsPerCarton,
        10
    )             AS unit_factor
FROM MaterialCard000 m
WHERE m.IsActive = 1
   OR m.Active   = 1
   OR m.Deleted  = 0
ORDER BY m.Name
"@

Write-Host "الاتصال بقاعدة الأمين..." -ForegroundColor Cyan

$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandText = $query
$cmd.CommandTimeout = 60

$rows = @()
try {
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        $rows += [PSCustomObject]@{
            item_name   = $reader["item_name"]
            item_key    = $reader["item_key"]
            unit_factor = [int]$reader["unit_factor"]
        }
    }
    $reader.Close()
} catch {
    Write-Host "تحذير: عمود عامل التحويل غير موجود بهذا الاسم." -ForegroundColor Yellow
    Write-Host "الخطأ: $_" -ForegroundColor Gray
    Write-Host ""
    Write-Host "جارٍ البحث عن اسم العمود الصحيح في قاعدة الأمين..." -ForegroundColor Cyan

    # اكتشاف الأعمدة الموجودة
    $discoverQuery = @"
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME LIKE 'MaterialCard%'
  AND COLUMN_NAME LIKE '%unit%' OR COLUMN_NAME LIKE '%factor%'
     OR COLUMN_NAME LIKE '%pack%' OR COLUMN_NAME LIKE '%qty%'
"@
    $cmd2 = $conn.CreateCommand()
    $cmd2.CommandText = $discoverQuery
    $cols = @()
    $r2 = $cmd2.ExecuteReader()
    while ($r2.Read()) { $cols += $r2["COLUMN_NAME"] }
    $r2.Close()

    if ($cols.Count -gt 0) {
        Write-Host "أعمدة محتملة وُجدت: $($cols -join ', ')" -ForegroundColor Green
        Write-Host "عدّل هذا السكريبت واستبدل 'UnitFactor' بالعمود الصحيح." -ForegroundColor Yellow
    } else {
        Write-Host "لم يُعثر على أعمدة مطابقة. راجع schema الأمين يدوياً." -ForegroundColor Red
    }
    $conn.Close()
    exit 1
}
$conn.Close()

Write-Host "✓ استُخرج $($rows.Count) مادة من الأمين" -ForegroundColor Green

# ── تحديث price-data.json ──────────────────────────────────────────────────────
$dataPath = Join-Path $ProjectRoot "scripts\price-data.json"
if (-not (Test-Path $dataPath)) {
    Write-Host "خطأ: الملف $dataPath غير موجود." -ForegroundColor Red
    exit 1
}

$priceData = Get-Content $dataPath -Raw | ConvertFrom-Json

$factorMap = @{}
foreach ($row in $rows) {
    $factorMap[$row.item_key] = $row.unit_factor
}

$updated = 0
foreach ($item in $priceData) {
    if ($item.PSObject.Properties["item_key"] -and $factorMap.ContainsKey($item.item_key)) {
        $item.unitFactor = $factorMap[$item.item_key]
        $updated++
    }
}

$priceData | ConvertTo-Json -Depth 5 | Set-Content $dataPath -Encoding UTF8
Write-Host "✓ تم تحديث عوامل التحويل لـ $updated مادة في price-data.json" -ForegroundColor Green

Write-Host ""
Write-Host "الخطوة التالية: شغّل على السيرفر السحابي:" -ForegroundColor Yellow
Write-Host "  npm run generate" -ForegroundColor White
