# ============================================================
# discover-stock-items.ps1  (قراءة فقط)
# يجلب أحدث تقرير مخزون (source=ameen_sql_agent) من Supabase ويطبع
# عيّنة عناصر خام — لمعرفة وحدة stockQty والحقول المتوفرة (أسماء وحدات، معامل...).
# التشغيل:  .\tools\discover-stock-items.ps1
#           .\tools\discover-stock-items.ps1 -Find "ماستر"
# ============================================================
param(
    [string]$Find = "",
    [int]$Sample = 8,
    [string]$EnvFile = "$PSScriptRoot\.env"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
function Get-Setting($Name) {
    $v = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, "User") }
    return $v
}

$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"
if (-not $apiKey -or -not $syncEmail -or -not $syncPassword) {
    Write-Host "خطأ: متغيرات Supabase غير مكتملة في tools\.env" -ForegroundColor Red; exit 1
}

try {
    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))
    $headers = @{ apikey = $apiKey; Authorization = "Bearer $($session.access_token)"; Accept = "application/json"; "Accept-Profile" = "public" }

    $reports = @(Invoke-RestMethod -Method Get -Headers $headers `
        -Uri "$supabaseUrl/rest/v1/inventory_reports?select=created_at,summary,items&source=eq.ameen_sql_agent&order=created_at.desc&limit=1")
    if (-not $reports.Count) { Write-Host "لا يوجد تقرير ameen_sql_agent." -ForegroundColor Red; exit 1 }

    $r = $reports[0]
    Write-Host ("تقرير بتاريخ: " + $r.created_at) -ForegroundColor Cyan
    Write-Host ("الملخص: " + ($r.summary | ConvertTo-Json -Compress -Depth 4))
    $items = @($r.items)
    Write-Host ("عدد العناصر: " + $items.Count)
    Write-Host ""

    Write-Host "=== حقول أول عنصر (الأسماء كما هي) ===" -ForegroundColor Yellow
    if ($items.Count) { $items[0].PSObject.Properties.Name -join ", " | Write-Host }

    Write-Host ""
    Write-Host "=== عيّنة عناصر خام (JSON) ===" -ForegroundColor Yellow
    $picked = if ($Find) { @($items | Where-Object { "$($_.name)" -like "*$Find*" } | Select-Object -First $Sample) }
              else { @($items | Select-Object -First $Sample) }
    foreach ($it in $picked) { Write-Host ($it | ConvertTo-Json -Compress -Depth 5) }
    if (-not $picked.Count) { Write-Host "(لا نتائج للبحث '$Find')" }
    exit 0
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Write-Host ("رد الخادم: " + $_.ErrorDetails.Message) }
    exit 1
}
