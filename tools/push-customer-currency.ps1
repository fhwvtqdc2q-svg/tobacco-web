# ============================================================
# push-customer-currency.ps1  (يعمل على اللابتوب)
# يقرأ عملة كل زبون من الأمين ويحدّثها في customer_whatsapp.currency
# حتى يطلع الوصل/الفاتورة بعملة الزبون الصحيحة.
# المنطق: مجموعة العملة الأكبر = ليرة، والباقي = دولار.
# ============================================================
# تجربة (يفرجيك التقسيم بدون حفظ):  .\tools\push-customer-currency.ps1 -DryRun
# تطبيق فعلي:                        .\tools\push-customer-currency.ps1
# ============================================================
param(
    [switch]$DryRun,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\customer-currency.log"
)
$ErrorActionPreference = "Stop"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $p = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim())
    }
}
function Get-Setting($n) { $v = [Environment]::GetEnvironmentVariable($n, "Process"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "User") }; return $v }
function Write-Log($m) { $l = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $m; Write-Host $l; $d = Split-Path $LogFile -Parent; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }; Add-Content -LiteralPath $LogFile -Value $l -Encoding UTF8 }

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$SB = Get-Setting "TOBACCO_SUPABASE_URL"; if (-not $SB) { $SB = "https://dyxbirfpxeocqffnfdeb.supabase.co" }; $SB = $SB.TrimEnd("/")
$KEY = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"; if (-not $KEY) { $KEY = Get-Setting "SUPABASE_PUBLIC_KEY" }
$EMAIL = Get-Setting "TOBACCO_SYNC_EMAIL"; $PW = Get-Setting "TOBACCO_SYNC_PASSWORD"
if (-not $connStr) { Write-Log "khata: AMEEN_SQL_CONNECTION_STRING nawaqis."; exit 1 }
if (-not $DryRun -and (-not $KEY -or -not $EMAIL -or -not $PW)) { Write-Log "khata: env Supabase nawaqis."; exit 1 }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open()

# --- اكتشاف مصدر فيه GUID الزبون + GUID العملة ---
function Cols($t) {
    $c = $conn.CreateCommand(); $c.CommandText = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='$t'"
    $r = $c.ExecuteReader(); $o = @(); while ($r.Read()) { $o += [string]$r[0] }; $r.Close(); return $o
}
$src = $null; $guidCol = $null; $curCol = $null
foreach ($t in @("vwCuDetails", "vwCu", "vwCuAc", "cu000")) {
    $cols = Cols $t
    if (-not $cols) { continue }
    $g = @("GUID", "cuGUID", "CustomerGUID") | Where-Object { $cols -contains $_ } | Select-Object -First 1
    $cu = @("CurrencyGUID", "cuCurrencyGUID", "CurGUID") | Where-Object { $cols -contains $_ } | Select-Object -First 1
    if ($g -and $cu) { $src = $t; $guidCol = $g; $curCol = $cu; break }
}
if (-not $src) { Write-Log "khata: lm ajid masdar fih GUID + CurrencyGUID. jarrib tshofli a3mda vwCuDetails."; $conn.Close(); exit 1 }
Write-Log "al-masdar: $src | guid=$guidCol | currency=$curCol"

# --- قراءة عملة كل زبون ---
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT CONVERT(varchar(36), m.$guidCol) AS g, CONVERT(varchar(36), m.$curCol) AS c FROM $src m WHERE m.$guidCol IS NOT NULL"
$r = $cmd.ExecuteReader()
$custCur = @{}; $counts = @{}
while ($r.Read()) {
    $g = "$($r['g'])"; $c = if ($r['c'] -is [DBNull]) { "" } else { "$($r['c'])" }
    if (-not $g) { continue }
    $custCur[$g] = $c
    if ($c) { if ($counts.ContainsKey($c)) { $counts[$c]++ } else { $counts[$c] = 1 } }
}
$r.Close(); $conn.Close()

# --- المجموعة الأكبر = ليرة، الباقي = دولار ---
$majority = ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
Write-Log "majmu3at al-3umla:"
$counts.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    $tag = if ($_.Key -eq $majority) { "SYP (ليرة - الاكبر)" } else { "USD (دولار)" }
    Write-Log ("  {0} : {1} zaboun -> {2}" -f $_.Key, $_.Value, $tag)
}

# --- جلب زبائن الواتساب من Supabase ---
$login = (@{ email = $EMAIL; password = $PW } | ConvertTo-Json -Compress)
$sess = Invoke-RestMethod -Method Post -Uri "$SB/auth/v1/token?grant_type=password" -Headers @{ apikey = $KEY } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($login))
$hdr = @{ apikey = $KEY; Authorization = "Bearer $($sess.access_token)"; "Accept-Profile" = "public" }
$wa = Invoke-RestMethod -Method Get -Uri "$SB/rest/v1/customer_whatsapp?select=customer_guid,customer_name,phone_number" -Headers $hdr

$rows = New-Object System.Collections.Generic.List[object]
$nSyp = 0; $nUsd = 0
foreach ($w in $wa) {
    $cg = $custCur[$w.customer_guid]
    $cur = if ($cg -and $cg -ne $majority) { "USD" } else { "SYP" }
    if ($cur -eq "USD") { $nUsd++ } else { $nSyp++ }
    $rows.Add(@{ customer_guid = $w.customer_guid; customer_name = $w.customer_name; phone_number = $w.phone_number; currency = $cur })
}
Write-Log "zabain al-watsab: SYP=$nSyp USD=$nUsd (min asl $($wa.Count))"

if ($DryRun) { Write-Log "DryRun: lm ytm al-hifz. راجع التقسيم فوق."; exit 0 }

$authH = @{ apikey = $KEY; Authorization = "Bearer $($sess.access_token)"; "Content-Type" = "application/json"; "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "resolution=merge-duplicates,return=minimal" }
$json = $rows.ToArray() | ConvertTo-Json -Depth 4 -Compress
Invoke-RestMethod -Method Post -Uri "$SB/rest/v1/customer_whatsapp?on_conflict=customer_guid" -Headers $authH -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
Write-Log "thm tahdith al-3umla li $($rows.Count) zaboun."
exit 0
