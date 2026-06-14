# ============================================================
# push-customer-currency.ps1  (يعمل على اللابتوب)
# يقرأ عملة كل زبون من الأمين (العملة على حساب الزبون) ويحدّثها
# في customer_whatsapp.currency حتى يطلع الوصل بعملة الزبون.
# الربط: vwCuDetails(GUID,AccountGUID) -> vwExtended_AC(GUID,CurrencyGUID)
# المنطق: مجموعة العملة الأكبر = ليرة، والباقي = دولار.
# ============================================================
# تجربة:  .\tools\push-customer-currency.ps1 -DryRun
# تطبيق:  .\tools\push-customer-currency.ps1
# ============================================================
param(
    [switch]$DryRun,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\customer-currency.log"
)
$ErrorActionPreference = "Stop"
if (Test-Path $EnvFile) { Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object { $p = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim()) } }
function GS($n) { $v = [Environment]::GetEnvironmentVariable($n, "Process"); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "User") }; return $v }
function Write-Log($m) { $l = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $m; Write-Host $l; $d = Split-Path $LogFile -Parent; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }; Add-Content -LiteralPath $LogFile -Value $l -Encoding UTF8 }

$cs = GS "AMEEN_SQL_CONNECTION_STRING"
$SB = GS "TOBACCO_SUPABASE_URL"; if (-not $SB) { $SB = "https://dyxbirfpxeocqffnfdeb.supabase.co" }; $SB = $SB.TrimEnd("/")
$KEY = GS "TOBACCO_SUPABASE_PUBLIC_KEY"; if (-not $KEY) { $KEY = GS "SUPABASE_PUBLIC_KEY" }
$EMAIL = GS "TOBACCO_SYNC_EMAIL"; $PW = GS "TOBACCO_SYNC_PASSWORD"
if (-not $cs) { Write-Log "khata: AMEEN_SQL_CONNECTION_STRING nawaqis."; exit 1 }
if (-not $DryRun -and (-not $KEY -or -not $EMAIL -or -not $PW)) { Write-Log "khata: env Supabase nawaqis."; exit 1 }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($cs); $conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT CONVERT(varchar(36), c.GUID) AS g, CONVERT(varchar(36), a.CurrencyGUID) AS cur
FROM vwCuDetails c
LEFT JOIN vwExtended_AC a ON a.GUID = c.AccountGUID
WHERE c.GUID IS NOT NULL
"@
$cmd.CommandTimeout = 120
$r = $cmd.ExecuteReader()
$custCur = @{}; $counts = @{}
while ($r.Read()) {
    $g = "$($r['g'])"; if (-not $g) { continue }
    $cv = if ($r['cur'] -is [DBNull]) { "(none)" } else { "$($r['cur'])" }
    $custCur[$g] = $cv
    if ($counts.ContainsKey($cv)) { $counts[$cv]++ } else { $counts[$cv] = 1 }
}
$r.Close(); $conn.Close()
Write-Log "qara2 3umla li $($custCur.Count) zaboun min al-ameen."

$majority = ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
Write-Log "majmu3at al-3umla (al-akbar = ليرة):"
$counts.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    $tag = if ($_.Key -eq $majority) { "SYP" } else { "USD" }
    Write-Log ("  {0} : {1} -> {2}" -f $_.Key, $_.Value, $tag)
}

# جلب زبائن الواتساب
$login = (@{ email = $EMAIL; password = $PW } | ConvertTo-Json -Compress)
$sess = Invoke-RestMethod -Method Post -Uri "$SB/auth/v1/token?grant_type=password" -Headers @{ apikey = $KEY } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($login))
$hdr = @{ apikey = $KEY; Authorization = "Bearer $($sess.access_token)"; "Accept-Profile" = "public" }
$wa = Invoke-RestMethod -Method Get -Uri "$SB/rest/v1/customer_whatsapp?select=customer_guid,customer_name,phone_number" -Headers $hdr

$rows = New-Object System.Collections.Generic.List[object]; $nSyp = 0; $nUsd = 0; $nMiss = 0
foreach ($w in $wa) {
    $cg = $custCur[$w.customer_guid]
    if (-not $cg) { $nMiss++ }
    $cur = if ($cg -and $cg -ne "(none)" -and $cg -ne $majority) { "USD" } else { "SYP" }
    if ($cur -eq "USD") { $nUsd++ } else { $nSyp++ }
    $rows.Add(@{ customer_guid = $w.customer_guid; customer_name = $w.customer_name; phone_number = $w.phone_number; currency = $cur })
}
Write-Log "zabain al-watsab: SYP=$nSyp USD=$nUsd (ghyr mawjud bil-ameen=$nMiss min asl $($wa.Count))"

if ($DryRun) { Write-Log "DryRun: lm ytm al-hifz. راجع التقسيم فوق."; exit 0 }
$authH = @{ apikey = $KEY; Authorization = "Bearer $($sess.access_token)"; "Content-Type" = "application/json"; "Accept-Profile" = "public"; "Content-Profile" = "public"; Prefer = "resolution=merge-duplicates,return=minimal" }
$json = $rows.ToArray() | ConvertTo-Json -Depth 4 -Compress
Invoke-RestMethod -Method Post -Uri "$SB/rest/v1/customer_whatsapp?on_conflict=customer_guid" -Headers $authH -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
Write-Log "thm tahdith al-3umla li $($rows.Count) zaboun."
exit 0
