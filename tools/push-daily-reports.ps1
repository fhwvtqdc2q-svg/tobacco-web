# ============================================================
# push-daily-reports.ps1  (يعمل على اللابتوب - مجدوَل)
# 9 صباحاً  (-Period morning): أرصدة + مخزون
# 9 مساءً   (-Period evening): أرصدة + مخزون + حركة اليوم
# يحفظ PDF بمجلد «التقارير اليومية» + يفتح رسالة واتساب جاهزة للرقم.
# ============================================================
param(
    [ValidateSet("morning", "evening", "")]
    [string]$Period = "",
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\daily-reports.log"
)
$ErrorActionPreference = "Stop"
if (-not $Period) { $Period = if ((Get-Date).Hour -lt 14) { "morning" } else { "evening" } }

if (Test-Path $EnvFile) { Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object { $p = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim()) } }
function GS($n) { $v = [Environment]::GetEnvironmentVariable($n, "Process"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "User") }; return $v }
function Write-Log($m) { $l = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $m; Write-Host $l; $d = Split-Path $LogFile -Parent; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }; Add-Content -LiteralPath $LogFile -Value $l -Encoding UTF8 }

$SB = GS "TOBACCO_SUPABASE_URL"; if (-not $SB) { $SB = "https://dyxbirfpxeocqffnfdeb.supabase.co" }; $SB = $SB.TrimEnd("/")
$KEY = GS "TOBACCO_SUPABASE_PUBLIC_KEY"; if (-not $KEY) { $KEY = GS "SUPABASE_PUBLIC_KEY" }
$EMAIL = GS "TOBACCO_SYNC_EMAIL"; $PW = GS "TOBACCO_SYNC_PASSWORD"
$TO = "963984000662"
$SITE = "https://fhwvtqdc2q-svg.github.io/tobacco-web/receipt.html?id="
if (-not $KEY -or -not $EMAIL -or -not $PW) { Write-Log "khata: env Supabase nawaqis."; exit 1 }

# كروم
$chrome = $null
foreach ($p in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")) { if (Test-Path $p) { $chrome = $p; break } }
if (-not $chrome) { Write-Log "khata: lm ajid Chrome/Edge."; exit 1 }

$hdrJson = @{ apikey = $KEY; "Content-Type" = "application/json" }
$login = (@{ email = $EMAIL; password = $PW } | ConvertTo-Json -Compress)
$sess = Invoke-RestMethod -Method Post -Uri "$SB/auth/v1/token?grant_type=password" -Headers $hdrJson -Body ([Text.Encoding]::UTF8.GetBytes($login))
$tok = $sess.access_token
$g = @{ apikey = $KEY; Authorization = "Bearer $tok"; "Accept-Profile" = "public" }

function GetLatestItems($source) {
    $r = Invoke-RestMethod -Method Get -Uri "$SB/rest/v1/inventory_reports?source=eq.$source&order=created_at.desc&limit=1&select=items" -Headers $g
    if ($r -and $r[0].items) { return $r[0].items } else { return @() }
}
$balItems = GetLatestItems "ameen_customer_balances"
$invItems = GetLatestItems "ameen_sql_agent"
Write-Log "balances=$($balItems.Count) inventory=$($invItems.Count)"

# تقليص الحقول
$bal = @($balItems | ForEach-Object { @{ name = $_.name; balance = $_.balance; lastPaymentDate = $_.lastPaymentDate } })
$inv = @($invItems | ForEach-Object { @{ name = $_.name; stockQty = $_.stockQty; unit2Name = $_.unit2Name } })

$daily = $null
if ($Period -eq "evening") {
    try {
        $dr = Invoke-RestMethod -Method Get -Uri "$SB/rest/v1/daily_movement_reports?order=created_at.desc&limit=1&select=summary" -Headers $g
        if ($dr -and $dr[0]) { $daily = @{ summary = $dr[0].summary } }
    } catch { Write-Log "tanbih: tazaffur jalb al-haraka al-yawmia ( tajahul )." }
}

$today = (Get-Date).ToString("yyyy-MM-dd")
$doc = @{ t = "daily"; period = $Period; no = ("D-" + (Get-Date).ToString("yyyyMMdd-HHmm")); date = $today; balances = $bal; inventory = $inv; daily = $daily }
$payload = (@{ doc = $doc }) | ConvertTo-Json -Depth 8 -Compress
$ins = Invoke-RestMethod -Method Post -Uri "$SB/rest/v1/shared_documents" -Headers @{ apikey = $KEY; Authorization = "Bearer $tok"; "Content-Type" = "application/json"; "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "return=representation" } -Body ([Text.Encoding]::UTF8.GetBytes($payload))
$id = $ins[0].id
$link = $SITE + $id
Write-Log "shared_document id=$id"

# حفظ PDF
$desk = [Environment]::GetFolderPath("Desktop")
$folder = Join-Path $desk "التقارير اليومية"
if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
$label = if ($Period -eq "evening") { "تقرير المساء" } else { "تقرير الصباح" }
$out = Join-Path $folder ("$label - $today.pdf")
$i = 2; while (Test-Path $out) { $out = Join-Path $folder ("$label - $today ($i).pdf"); $i++ }
$prof = Join-Path $env:TEMP ("ozk-rep-" + $id)
$cargs = @("--headless", "--disable-gpu", "--no-sandbox", "--user-data-dir=`"$prof`"", "--no-margins", "--virtual-time-budget=15000", "--print-to-pdf=`"$out`"", "--print-to-pdf-no-header", "`"$link`"")
Start-Process -FilePath $chrome -ArgumentList $cargs -NoNewWindow -PassThru -Wait | Out-Null
Start-Sleep -Milliseconds 400
try { Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue } catch {}
if (Test-Path $out) { Write-Log "hifz PDF: $label - $today" } else { Write-Log "tanbih: lm yutbaa al-PDF (lakin al-rabt jahiz)." }

# رسالة واتساب جاهزة للرقم (واتساب ويب - حساب المحاسب)
$msg = "تقرير $label - $today من OZK TOBACCO:`n$link"
$wa = "https://web.whatsapp.com/send?phone=$TO&text=" + [uri]::EscapeDataString($msg)
try { Start-Process $wa | Out-Null; Write-Log "fath risalat watsab lil-raqam $TO (idghat irsal)." } catch { Write-Log "tanbih: tazaffur fath watsab. al-rabt: $link" }

# حذف تقارير يومية أقدم من 4 أيام
try {
    $cut = (Get-Date).ToUniversalTime().AddDays(-4).ToString("yyyy-MM-ddTHH:mm:ssZ")
    Invoke-RestMethod -Method Delete -Uri "$SB/rest/v1/shared_documents?doc->>t=eq.daily&created_at=lt.$cut" -Headers @{ apikey = $KEY; Authorization = "Bearer $tok"; "Accept-Profile" = "public"; "Content-Profile" = "public" } | Out-Null
} catch {}
Write-Log "tamm tقرير $Period."
exit 0
