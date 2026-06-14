# ============================================================
# archive-documents.ps1  (يعمل على اللابتوب)
# يراقب مستندات الموقع (shared_documents) ويحفظ كل وصل/فاتورة
# كملف PDF على سطح المكتب بمجلدين:
#   سطح المكتب\فواتير الزبائن
#   سطح المكتب\وصولات الاستلام
# اسم الملف: اسم الزبون - التاريخ.pdf
# ============================================================
# تشغيل مرة:      .\tools\archive-documents.ps1
# (يُجدوَل لاحقاً كل 5 دقائق)
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$StateFile = "$PSScriptRoot\logs\archived-docs.txt",
    [string]$LogFile = "$PSScriptRoot\logs\archive-documents.log"
)
$ErrorActionPreference = "Stop"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $p = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim())
    }
}
function Get-Setting($n) {
    $v = [Environment]::GetEnvironmentVariable($n, "Process")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "User") }
    return $v
}
function Write-Log($m) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $m
    Write-Host $line
    $d = Split-Path $LogFile -Parent
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

$SB = Get-Setting "TOBACCO_SUPABASE_URL"; if (-not $SB) { $SB = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$SB = $SB.TrimEnd("/")
$KEY = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"; if (-not $KEY) { $KEY = Get-Setting "SUPABASE_PUBLIC_KEY" }
$EMAIL = Get-Setting "TOBACCO_SYNC_EMAIL"
$PW = Get-Setting "TOBACCO_SYNC_PASSWORD"
$SITE = "https://fhwvtqdc2q-svg.github.io/tobacco-web/receipt.html?id="
if (-not $KEY -or -not $EMAIL -or -not $PW) { Write-Log "khata: nawaqis env (KEY/EMAIL/PW)."; exit 1 }

# --- ايجاد كروم ---
$chrome = $null
foreach ($p in @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)) { if (Test-Path $p) { $chrome = $p; break } }
if (-not $chrome) { Write-Log "khata: lm ajid Chrome aw Edge."; exit 1 }
Write-Log "browser: $chrome"

# --- مجلدات السطح ---
$desk = [Environment]::GetFolderPath("Desktop")
$folders = @{ invoice = (Join-Path $desk "فواتير الزبائن"); receipt = (Join-Path $desk "وصولات الاستلام") }
foreach ($f in $folders.Values) { if (-not (Test-Path $f)) { New-Item -ItemType Directory -Force -Path $f | Out-Null } }

# --- المعالَجة سابقاً ---
$done = @{}
if (Test-Path $StateFile) { Get-Content $StateFile | ForEach-Object { if ($_.Trim()) { $done[$_.Trim()] = $true } } }

# --- جلب المستندات ---
$login = (@{ email = $EMAIL; password = $PW } | ConvertTo-Json -Compress)
$sess = Invoke-RestMethod -Method Post -Uri "$SB/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $KEY } -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($login))
$hdr = @{ apikey = $KEY; Authorization = "Bearer $($sess.access_token)"; "Accept-Profile" = "public" }
$docs = Invoke-RestMethod -Method Get -Uri "$SB/rest/v1/shared_documents?select=id,doc,created_at&order=created_at.asc" -Headers $hdr
Write-Log "wasal $($docs.Count) mustanad."

function Clean-Name($s) {
    $s = "$s"
    foreach ($c in [IO.Path]::GetInvalidFileNameChars()) { $s = $s.Replace($c, ' ') }
    return ($s -replace '\s+', ' ').Trim()
}

$new = 0
foreach ($d in $docs) {
    if ($done[$d.id]) { continue }
    $doc = $d.doc
    $type = if ("$($doc.t)" -eq "invoice") { "invoice" } else { "receipt" }
    $folder = $folders[$type]
    $name = Clean-Name $doc.name; if (-not $name) { $name = "بدون اسم" }
    $date = "$($doc.date)"; if (-not $date) { $date = (Get-Date).ToString("yyyy-MM-dd") }
    $base = "$name - $date"
    $out = Join-Path $folder ("$base.pdf")
    $i = 2
    while (Test-Path $out) { $out = Join-Path $folder ("$base ($i).pdf"); $i++ }
    $url = $SITE + $d.id
    & $chrome --headless=new --disable-gpu --no-margins --virtual-time-budget=9000 "--print-to-pdf=$out" --print-to-pdf-no-header $url 2>$null
    Start-Sleep -Milliseconds 400
    if (Test-Path $out) {
        Add-Content -LiteralPath $StateFile -Value $d.id -Encoding UTF8
        $done[$d.id] = $true
        $new++
        Write-Log "hifz: [$type] $base"
    } else {
        Write-Log "fashal hifz: $($d.id)"
    }
}
Write-Log "thm hifz $new mustanad jadid. al-mojmal al-saabiq: $($done.Count - $new)."
exit 0
