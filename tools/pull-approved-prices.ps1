# ============================================================
# pull-approved-prices.ps1
# يسحب الأسعار المعتمدة من Supabase ويحفظها في CSV
# ============================================================

param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutputCsv = "$PSScriptRoot\..\reports\prices\tobacco-approved-prices.csv",
    [string]$LogFile = "$PSScriptRoot\logs\approved-prices-sync.log"
)

# قراءة الإعدادات
$envPath = $EnvFile
if (Test-Path $envPath) {
    Get-Content $envPath | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

$supabaseUrl = $env:SUPABASE_URL
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }

# استخدام المفتاح المتاح — service key أو publishable key
$apiKey = $env:SUPABASE_SERVICE_KEY
if (-not $apiKey) {
    $apiKey = "sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH"
    Write-Host "تحذير: يستخدم publishable key. للأمان أضف SUPABASE_SERVICE_KEY في .env" -ForegroundColor Yellow
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$timestamp] سحب الأسعار من Supabase..." -ForegroundColor Cyan

try {
    $headers = @{
        "apikey"          = $apiKey
        "Authorization"   = "Bearer $apiKey"
        "Accept-Profile"  = "public"
    }

    $url = "$supabaseUrl/rest/v1/approved_price_items?select=item_key,item_name,sale_price,unit1_price,unit1_name,unit2_name,unit2_factor,unit2_price,stock_qty,stock_status,updated_at&order=item_name.asc&limit=5000"

    $response = Invoke-RestMethod -Uri $url -Headers $headers -Method GET -ErrorAction Stop

    if (-not $response -or $response.Count -eq 0) {
        Write-Host "لا توجد أسعار في Supabase!" -ForegroundColor Red
        exit 1
    }

    Write-Host "تم سحب $($response.Count) سعر بنجاح ✓" -ForegroundColor Green

    # إنشاء المجلد إذا لم يكن موجوداً
    $csvDir = Split-Path $OutputCsv -Parent
    if (-not (Test-Path $csvDir)) { New-Item -ItemType Directory -Path $csvDir -Force | Out-Null }

    # حفظ CSV
    $response | Select-Object item_key, item_name, sale_price, unit1_price, unit1_name, unit2_name, unit2_factor, unit2_price, stock_qty, stock_status, updated_at |
        Export-Csv -Path $OutputCsv -NoTypeInformation -Encoding UTF8

    Write-Host "تم الحفظ في: $OutputCsv" -ForegroundColor Green

    # تسجيل في السجل
    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    "[$timestamp] Pulled $($response.Count) approved prices → $OutputCsv" | Add-Content $LogFile

    Write-Host "Pulled $($response.Count) approved prices from Supabase ✓" -ForegroundColor Green
    exit 0

} catch {
    $errMsg = "[$timestamp] ERROR: $($_.Exception.Message)"
    Write-Host $errMsg -ForegroundColor Red
    if (Test-Path (Split-Path $LogFile -Parent)) { $errMsg | Add-Content $LogFile }
    exit 1
}
