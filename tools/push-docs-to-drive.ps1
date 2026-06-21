# ============================================================
# push-docs-to-drive.ps1   (يعمل على اللابتوب — مجدوَل)
# يحوّل كل فاتورة/إيصال جديد في shared_documents إلى PDF عبر Chrome،
# ويرفعه إلى Google Drive عبر rclone، كلٌّ في مجلده:
#   - فاتورة  -> مجلد «فواتير الزبائن»   (folder id ثابت أدناه)
#   - إيصال   -> مجلد «ايصالات دفع وقبض» (folder id ثابت أدناه)
# يتتبّع المرفوع في ملف حالة محلي حتى لا يكرّر الرفع.
#
# يتطلّب لمرة واحدة:
#   1) rclone مثبّت + remote باسم gdrive مربوط بحساب ozkkhallouf@gmail.com
#      (التهيئة:  rclone config   -> Google Drive -> اسمح بالوصول من المتصفح)
#   2) tools\.env فيه: TOBACCO_SUPABASE_URL / TOBACCO_SUPABASE_PUBLIC_KEY /
#      TOBACCO_SYNC_EMAIL / TOBACCO_SYNC_PASSWORD  (نفس بقية السكربتات)
#
# التشغيل:
#   .\tools\push-docs-to-drive.ps1 -Once      # دفعة واحدة (للتجربة)
#   .\tools\push-docs-to-drive.ps1            # نفس الشيء (دفعة واحدة)
# ============================================================
param(
    [string]$EnvFile        = "$PSScriptRoot\.env",
    [string]$StateFile      = "$PSScriptRoot\logs\drive-docs-state.json",
    [string]$LogFile        = "$PSScriptRoot\logs\push-docs-to-drive.log",
    [string]$DriveRemote    = "gdrive",
    [string]$InvoicesFolderId = "1ibns4yXtmizG6KHXQb7setQIe85qaFiJ",   # «فواتير الزبائن»
    [string]$ReceiptsFolderId = "1roJXpm4msFgoPeb2egoWXbRI3N16Hpk8",   # «ايصالات دفع وقبض»
    [string]$SiteBase       = "https://fhwvtqdc2q-svg.github.io/tobacco-web",
    [int]$MaxPerRun         = 200,
    [switch]$Once
)
$ErrorActionPreference = "Stop"

function Write-Log($m) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $m
    Write-Host $line
    $d = Split-Path $LogFile -Parent
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}
function GS($n) { $v=[Environment]::GetEnvironmentVariable($n,"Process"); if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"User")}; return $v }

# --- .env ---
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}
$SB = GS "TOBACCO_SUPABASE_URL"; if (-not $SB) { $SB = "https://dyxbirfpxeocqffnfdeb.supabase.co" }; $SB = $SB.TrimEnd("/")
$KEY = GS "TOBACCO_SUPABASE_PUBLIC_KEY"; if (-not $KEY) { $KEY = GS "SUPABASE_PUBLIC_KEY" }
$EMAIL = GS "TOBACCO_SYNC_EMAIL"; $PW = GS "TOBACCO_SYNC_PASSWORD"
if (-not $KEY -or -not $EMAIL -or -not $PW) { Write-Log "khata: env Supabase naqis."; exit 1 }

# --- أدوات ---
$rclone = (Get-Command rclone -ErrorAction SilentlyContinue).Source
if (-not $rclone) { Write-Log "khata: rclone ghayr mothabbat. shaghghil 'rclone config' awwalan."; exit 1 }
$chrome = $null
foreach ($p in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")) { if (Test-Path $p) { $chrome = $p; break } }
if (-not $chrome) { Write-Log "khata: lam ajid Chrome/Edge."; exit 1 }

# --- تسجيل الدخول إلى Supabase ---
$auth = Invoke-RestMethod -Method Post -Uri "$SB/auth/v1/token?grant_type=password" -Headers @{ apikey=$KEY } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes((@{ email=$EMAIL; password=$PW } | ConvertTo-Json -Compress)))
$g = @{ apikey=$KEY; Authorization=("Bearer " + $auth.access_token); "Accept-Profile"="public" }

# --- جلب الفواتير والإيصالات ---
$enc = [uri]::EscapeDataString("in.(invoice,receipt)")
$rows = Invoke-RestMethod -Method Get -Uri "$SB/rest/v1/shared_documents?doc->>t=$enc&order=created_at.asc&limit=$MaxPerRun&select=id,created_at,doc" -Headers $g
Write-Log ("wujida {0} fatura/isal fi al-nizam." -f @($rows).Count)

# --- الحالة (المرفوع سابقاً) ---
$done = @{}
if (Test-Path $StateFile) {
    try { (Get-Content $StateFile -Raw | ConvertFrom-Json) | ForEach-Object { if ($_) { $done[[string]$_] = $true } } } catch {}
}
function Save-State { ($done.Keys | ConvertTo-Json) | Set-Content -LiteralPath $StateFile -Encoding UTF8 }

function Clean-Name($s) {
    if (-not $s) { return "" }
    $s = $s -replace '[\\/:*?"<>|]', '-'
    $s = $s -replace '\s+', ' '
    return $s.Trim()
}

# إزالة التكرار: نحتفظ بأحدث نسخة لكل (نوع|رقم|تاريخ)؛ والمستندات بلا رقم تُميَّز بالـ id
$seen = @{}
$picked = New-Object System.Collections.Generic.List[object]
foreach ($r in (@($rows) | Sort-Object -Property created_at -Descending)) {
    $d = $r.doc; $t = [string]$d.t
    $kno = ([string]$d.no).Trim(); $kdate = ([string]$d.date).Trim()
    $key = if ($kno) { "$t|$kno|$kdate" } else { "id|" + [string]$r.id }
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    [void]$picked.Add($r)
}
Write-Log ("ba3d izalat al-tikrar: {0} mustanad farid (min {1})." -f $picked.Count, @($rows).Count)

$uploaded = 0; $failed = 0
foreach ($r in $picked) {
    $id = [string]$r.id
    if ($done.ContainsKey($id)) { continue }
    $doc = $r.doc
    $type = [string]$doc.t
    if ($type -eq "invoice") { $folderId = $InvoicesFolderId; $prefix = "فاتورة" }
    elseif ($type -eq "receipt") { $folderId = $ReceiptsFolderId; $prefix = "ايصال" }
    else { continue }

    $no = Clean-Name ([string]$doc.no)
    $name = Clean-Name ([string]$doc.name)
    $date = Clean-Name ([string]$doc.date)
    if ($no) {
        $base = ("{0} {1} - {2} - {3}" -f $prefix, $no, $name, $date).Trim()
        if ($base.Length -gt 150) { $base = $base.Substring(0,150).Trim() }
        $fname = "$base.pdf"   # الاسم برقم الفاتورة الفريد — نفس الفاتورة تكتب فوق نفسها فلا تتكرر
    } else {
        $shortId = if ($id.Length -ge 8) { $id.Substring(0,8) } else { $id }
        $base = ("{0} - {1} - {2}" -f $prefix, $name, $date).Trim()
        if ($base.Length -gt 150) { $base = $base.Substring(0,150).Trim() }
        $fname = "$base [$shortId].pdf"   # مستند بلا رقم (مفرق نقدي) — نميّزه بالـ id
    }

    $url = "$SiteBase/receipt.html?id=$id"
    $pdf = Join-Path $env:TEMP ("ozkdoc-" + $id + ".pdf")
    if (Test-Path $pdf) { Remove-Item $pdf -Force -ErrorAction SilentlyContinue }
    $prof = Join-Path $env:TEMP ("ozkdoc-prof-" + $id)
    $cargs = @("--headless=new","--disable-gpu","--no-sandbox","--user-data-dir=`"$prof`"","--no-margins","--virtual-time-budget=20000","--print-to-pdf=`"$pdf`"","--print-to-pdf-no-header","`"$url`"")
    try {
        Start-Process -FilePath $chrome -ArgumentList $cargs -NoNewWindow -Wait | Out-Null
        Start-Sleep -Milliseconds 300
    } catch {}
    try { Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue } catch {}

    if (-not (Test-Path $pdf) -or (Get-Item $pdf).Length -lt 2000) {
        Write-Log ("tanbih: fashl tahweel PDF lil-doc {0} ({1})." -f $id, $fname); $failed++; continue
    }

    # رفع إلى مجلد درايف المحدّد بالـ id (يتفادى مشاكل المسارات/المسافات)
    & $rclone copyto "$pdf" "${DriveRemote}:$fname" --drive-root-folder-id $folderId 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $done[$id] = $true; Save-State; $uploaded++
        Write-Log ("rufi3: {0}" -f $fname)
    } else {
        Write-Log ("tanbih: fashl raf3 rclone lil-doc {0} ({1})." -f $id, $fname); $failed++
    }
    Remove-Item $pdf -Force -ErrorAction SilentlyContinue
}

Write-Log ("tamm: rufi3 {0} | fashl {1} | al-mujmal al-mu3alaj {2}." -f $uploaded, $failed, $done.Count)
exit 0
