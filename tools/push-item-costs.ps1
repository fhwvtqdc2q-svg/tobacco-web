# ============================================================
# push-item-costs.ps1
# يقرأ "متوسط التكلفة" لكل مادة من قاعدة الأمين (MaterialCard000)
# ويرفعها إلى Supabase (جدول item_costs المحمي — يقرأه المدير فقط).
# يطابقها الموقع داخل بطاقة كل مادة في صفحة التسعير (للمدير فقط).
# ============================================================
# تجربة بدون رفع:  .\tools\push-item-costs.ps1 -DryRun
# تشغيل فعلي:      .\tools\push-item-costs.ps1
# ============================================================
param(
    [switch]$DryRun,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\item-costs-push.log"
)

$ErrorActionPreference = "Stop"

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

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    $dir = Split-Path $LogFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "khata: AMEEN_SQL_CONNECTION_STRING ghyr mwjwd."; exit 1 }
if (-not $DryRun) {
    if (-not $apiKey) { Write-Log "khata: TOBACCO_SUPABASE_PUBLIC_KEY ghyr mwjwd."; exit 1 }
    if (-not $syncEmail -or -not $syncPassword) { Write-Log "khata: TOBACCO_SYNC_EMAIL / TOBACCO_SYNC_PASSWORD ghyr mwjwdyn."; exit 1 }
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # discover cost + guid columns in MaterialCard000
    $discover = $conn.CreateCommand()
    $discover.CommandText = @"
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'MaterialCard000'
  AND (COLUMN_NAME LIKE '%cost%' OR COLUMN_NAME LIKE '%Cost%'
       OR COLUMN_NAME LIKE '%guid%' OR COLUMN_NAME LIKE '%GUID%')
"@
    $dr = $discover.ExecuteReader()
    $cols = @()
    while ($dr.Read()) { $cols += [string]$dr["COLUMN_NAME"] }
    $dr.Close()
    Write-Log ("a3mda mrshha: " + ($cols -join ", "))

    $costCandidates = @(
        "AvgCost","AverageCost","AvgCostPrice","MeanCost","WeightedAvgCost","WACost",
        "Cost","CostPrice","AvgPrice","LastCost","LastPurchasePrice","AvgPurchasePrice"
    )
    $costCol = $costCandidates | Where-Object { $cols -contains $_ } | Select-Object -First 1

    $guidCandidates = @(
        "MaterialGUID","MaterialCardGUID","CardGUID","ItemGUID","RecordGUID","RowGUID","GUID"
    )
    $guidCol = $guidCandidates | Where-Object { $cols -contains $_ } | Select-Object -First 1

    if (-not $costCol) {
        Write-Log "khata: lm ajid 3mwd tklfa fi MaterialCard000. al-a3mda: $($cols -join ', ')"
        Write-Log "afta7 al-script wa-adif ism al-3mwd al-sa7i7 ila qaymat costCandidates."
        $conn.Close(); exit 1
    }
    Write-Log "3mwd al-tklfa: $costCol | 3mwd GUID: $(if ($guidCol) { $guidCol } else { '(la ywjd - mtabaqa bil-ism)' })"

    $guidExpr = if ($guidCol) { "CONVERT(varchar(36), m.$guidCol)" } else { "NULL" }

    $query = @"
SELECT
    $guidExpr                         AS item_guid,
    LTRIM(RTRIM(m.Name))              AS item_name,
    LTRIM(RTRIM(m.Code))              AS item_code,
    CAST(COALESCE(m.$costCol, 0) AS decimal(18,3)) AS avg_cost
FROM MaterialCard000 m
WHERE LTRIM(RTRIM(COALESCE(m.Name,''))) <> ''
"@
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $query
    $cmd.CommandTimeout = 60

    $rows = New-Object System.Collections.Generic.List[object]
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        $guid = if ($reader["item_guid"] -is [DBNull]) { $null } else { ([string]$reader["item_guid"]).Trim() }
        $name = ([string]$reader["item_name"]).Trim()
        $code = ([string]$reader["item_code"]).Trim()
        $cost = [double]$reader["avg_cost"]
        $key = if ($guid) { $guid } elseif ($code) { $code } else { $name }
        if (-not $key) { continue }
        $rows.Add(@{
            item_guid  = $key
            item_name  = $name
            avg_cost   = [math]::Round($cost, 3)
            currency   = "SYP"
            updated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        })
    }
    $reader.Close()
    $conn.Close()

    Write-Log "thm tjhyz tklfa $($rows.Count) mada."
    $rows | Select-Object -First 8 | ForEach-Object {
        Write-Host ("  {0,-34} = {1}" -f $_.item_name, $_.avg_cost)
    }

    if ($DryRun) { Write-Log "wad3 al-tjruba (DryRun): lm ytm al-raf3."; exit 0 }
    if ($rows.Count -eq 0) { Write-Log "la twjd byanat lil-raf3."; exit 0 }

    # login to Supabase as owner
    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))

    $authHeaders = @{
        apikey            = $apiKey
        Authorization     = "Bearer $($session.access_token)"
        Prefer            = "resolution=merge-duplicates,return=minimal"
        "Accept-Profile"  = "public"
        "Content-Profile" = "public"
    }

    # upsert in one batch on item_guid
    $json = $rows.ToArray() | ConvertTo-Json -Depth 4 -Compress
    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/item_costs?on_conflict=item_guid" `
        -Headers $authHeaders -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | Out-Null

    Write-Log "thm raf3 al-tklfa bnja7 ($($rows.Count) mada)"
    exit 0
} catch {
    Write-Log "khata (str $($_.InvocationInfo.ScriptLineNumber)): $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Log ("tfsyl: " + $_.Exception.InnerException.Message) }
    exit 1
}
