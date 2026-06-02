# ============================================================
# auto-sync-price-lists.ps1
# يسحب من الأمين وSupabase → يحدّث price-data.json → يرفع لـ GitHub
# بعده GitHub Actions يولّد النشرات تلقائياً
# ============================================================
# الاستخدام اليدوي: .\tools\auto-sync-price-lists.ps1
# التشغيل التلقائي: سجّل بـ register-price-list-sync-task.ps1
# ============================================================

param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [string]$EnvFile     = "$PSScriptRoot\.env",
    [string]$LogFile     = "$PSScriptRoot\logs\price-list-sync.log"
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Log($msg, $color = "White") {
    $line = "[$timestamp] $msg"
    Write-Host $line -ForegroundColor $color
    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $line | Add-Content $LogFile -Encoding UTF8
}

Log "═══ بدء مزامنة نشرات الأسعار ═══" "Cyan"

# ── قراءة إعدادات .env ───────────────────────────────────────────────────────
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

# ── 1. سحب الأسعار من Supabase ───────────────────────────────────────────────
$supabaseUrl = $env:SUPABASE_URL ?? "https://dyxbirfpxeocqffnfdeb.supabase.co"
$apiKey      = $env:SUPABASE_SERVICE_KEY ?? "sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH"

Log "جارٍ سحب الأسعار من Supabase..." "Cyan"

$headers = @{
    "apikey"         = $apiKey
    "Authorization"  = "Bearer $apiKey"
    "Accept-Profile" = "public"
}
$url = "$supabaseUrl/rest/v1/approved_price_items?select=item_key,item_name,unit1_name,unit2_name,unit2_factor,unit2_price&order=item_name.asc&limit=5000"

try {
    $supaItems = Invoke-RestMethod -Uri $url -Headers $headers -Method GET -ErrorAction Stop
    Log "✓ Supabase: $($supaItems.Count) صنف" "Green"
} catch {
    Log "تحذير Supabase: $_" "Yellow"
    $supaItems = @()
}

# ── 2. سحب عوامل التحويل من الأمين ──────────────────────────────────────────
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
$ameenRows = @()

if ($connStr) {
    Log "جارٍ الاتصال بالأمين..." "Cyan"
    try {
        $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
        $conn.Open()

        # اكتشاف أعمدة الوحدة الأولى والعامل
        $discoverCmd = $conn.CreateCommand()
        $discoverCmd.CommandText = @"
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME LIKE 'MaterialCard%'
  AND (COLUMN_NAME LIKE '%unit%' OR COLUMN_NAME LIKE '%Unit%'
    OR COLUMN_NAME LIKE '%factor%' OR COLUMN_NAME LIKE '%Factor%'
    OR COLUMN_NAME LIKE '%pack%'   OR COLUMN_NAME LIKE '%small%')
"@
        $dr = $discoverCmd.ExecuteReader()
        $cols = @(); while ($dr.Read()) { $cols += $dr["COLUMN_NAME"] }
        $dr.Close()

        $factorCols = @("UnitFactor","ConversionFactor","PackSize","UnitsPerCarton","Qty")
        $unit1Cols  = @("SmallUnitName","Unit1Name","UnitSmallName","SmallUnit","Unit1","UnitName","Unit")
        $factorCol  = $factorCols | Where-Object { $cols -contains $_ } | Select-Object -First 1
        $unit1Col   = $unit1Cols  | Where-Object { $cols -contains $_ } | Select-Object -First 1

        $factorExpr = if ($factorCol) { "COALESCE(m.$factorCol, 10)" } else { "10" }
        $unit1Expr  = if ($unit1Col)  { "ISNULL(m.$unit1Col, '')"    } else { "''" }

        $cmd = $conn.CreateCommand()
        $cmd.CommandText = @"
SELECT m.Code AS item_key,
       $factorExpr AS unit_factor,
       $unit1Expr  AS unit1_name
FROM MaterialCard000 m
WHERE m.IsActive=1 OR m.Active=1 OR m.Deleted=0
"@
        $cmd.CommandTimeout = 60
        $reader = $cmd.ExecuteReader()
        while ($reader.Read()) {
            $ameenRows += [PSCustomObject]@{
                item_key    = "$($reader["item_key"])".Trim()
                unit_factor = [int]$reader["unit_factor"]
                unit1_name  = "$($reader["unit1_name"])".Trim()
            }
        }
        $reader.Close()
        $conn.Close()
        Log "✓ الأمين: $($ameenRows.Count) صنف" "Green"
    } catch {
        Log "تحذير الأمين: $_" "Yellow"
    }
} else {
    Log "AMEEN_SQL_CONNECTION_STRING غير موجود — سيتم الاعتماد على Supabase فقط" "Yellow"
}

# ── 3. بناء خرائط البحث ──────────────────────────────────────────────────────
$supaMap  = @{}; foreach ($r in $supaItems)  { $supaMap[$r.item_key]  = $r }
$ameenMap = @{}; foreach ($r in $ameenRows)  { $ameenMap[$r.item_key] = $r }

# ── 4. تحديث price-data.json ─────────────────────────────────────────────────
$dataPath = Join-Path $ProjectRoot "scripts\price-data.json"
if (-not (Test-Path $dataPath)) {
    Log "خطأ: $dataPath غير موجود" "Red"; exit 1
}

$priceData  = Get-Content $dataPath -Raw | ConvertFrom-Json
$updatedUsd = 0; $updatedFactor = 0; $updatedUnit1 = 0

foreach ($item in $priceData) {
    $key = $item.item_key
    if (-not $key) { continue }

    # سعر الدولار من Supabase
    if ($supaMap.ContainsKey($key)) {
        $s = $supaMap[$key]
        if ($s.unit2_price -and [double]$s.unit2_price -gt 0) {
            $item.usd = [Math]::Round([double]$s.unit2_price, 2)
            $updatedUsd++
        }
        # unit1 من Supabase إن وُجد
        if ($s.unit1_name) {
            $item | Add-Member -NotePropertyName "unit1" -NotePropertyValue $s.unit1_name -Force
            $updatedUnit1++
        }
        if ($s.unit2_factor -and [int]$s.unit2_factor -gt 0) {
            $item.unitFactor = [int]$s.unit2_factor
            $updatedFactor++
        }
    }

    # عوامل الأمين تأخذ الأولوية على Supabase
    if ($ameenMap.ContainsKey($key)) {
        $a = $ameenMap[$key]
        if ($a.unit_factor -gt 0) {
            $item.unitFactor = $a.unit_factor
            $updatedFactor++
        }
        if ($a.unit1_name -ne "") {
            $item | Add-Member -NotePropertyName "unit1" -NotePropertyValue $a.unit1_name -Force
            $updatedUnit1++
        }
    }
}

$newJson = $priceData | ConvertTo-Json -Depth 5
$oldJson = Get-Content $dataPath -Raw

if ($newJson.Trim() -eq $oldJson.Trim()) {
    Log "لا تغييرات في البيانات — لن يتم الرفع" "Yellow"
    exit 0
}

Set-Content $dataPath $newJson -Encoding UTF8
Log "✓ price-data.json — أسعار: $updatedUsd | عوامل: $updatedFactor | وحدات: $updatedUnit1" "Green"

# ── 5. رفع التغييرات لـ GitHub ────────────────────────────────────────────────
Log "جارٍ رفع التغييرات لـ GitHub..." "Cyan"

try {
    $gitArgs = @("-C", $ProjectRoot)
    & git @gitArgs add "scripts/price-data.json" 2>&1
    $diffOutput = & git @gitArgs diff --staged --quiet 2>&1
    if ($LASTEXITCODE -eq 0) {
        Log "لا تغييرات للرفع" "Yellow"; exit 0
    }
    $msg = "Auto-sync: price data from Ameen — $timestamp"
    & git @gitArgs commit -m $msg 2>&1
    & git @gitArgs push 2>&1
    Log "✓ تم الرفع — GitHub Actions سيولّد النشرات تلقائياً" "Green"
} catch {
    Log "خطأ git: $_" "Red"; exit 1
}

Log "═══ اكتمل ═══" "Cyan"
