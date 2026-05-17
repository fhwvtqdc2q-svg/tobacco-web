param(
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\reports\prices\tobacco-daily-pricing-worklist.csv"),
  [string]$LogPath = (Join-Path $PSScriptRoot "..\logs\daily-pricing-worklist.log")
)

$ErrorActionPreference = "Stop"

function Write-PricingWorklistLog($Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $logDir = Split-Path -Parent $LogPath
  if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  }
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-ConfigValue($Text, $Pattern) {
  $match = [regex]::Match($Text, $Pattern)
  if ($match.Success) {
    return $match.Groups[1].Value
  }
  return $null
}

function Get-AppConfigValue($Pattern) {
  $configPath = Join-Path (Split-Path -Parent $PSScriptRoot) "src\config.js"
  if (-not (Test-Path -LiteralPath $configPath)) {
    return $null
  }
  $text = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
  return Get-ConfigValue -Text $text -Pattern $Pattern
}

function Optional-Env($Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  }
  return $value
}

function Require-Value($Name, $Value) {
  if (-not $Value) {
    throw "Missing required setting: $Name"
  }
  return $Value
}

function Get-SupabaseSession($Url, $ApiKey, $Email, $Password) {
  $endpoint = "$Url/auth/v1/token?grant_type=password"
  $headers = @{
    apikey = $ApiKey
    "Content-Type" = "application/json"
  }
  $body = @{
    email = $Email
    password = $Password
  } | ConvertTo-Json

  return Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $body
}

function Invoke-SupabaseGet($Url, $ApiKey, $Session, $PathAndQuery) {
  $endpoint = "$Url/rest/v1/$PathAndQuery"
  $headers = @{
    apikey = $ApiKey
    Authorization = "Bearer $($Session.access_token)"
    Accept = "application/json"
  }
  return Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers
}

function Is-Today($Value) {
  if (-not $Value) {
    return $false
  }
  try {
    return ([datetime]$Value).ToString("yyyy-MM-dd") -eq (Get-Date).ToString("yyyy-MM-dd")
  } catch {
    return ([string]$Value).Substring(0, [Math]::Min(10, ([string]$Value).Length)) -eq (Get-Date).ToString("yyyy-MM-dd")
  }
}

function Write-WorklistCsv($Rows, $Path) {
  $outDir = Split-Path -Parent $Path
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }

  if (@($Rows).Count) {
    $Rows | Export-Csv -LiteralPath $Path -NoTypeInformation -Encoding UTF8
  } else {
    "item_key,item_name,stock_qty,stock_status,current_price,last_approved_at,needs_pricing,source_synced_at" |
      Set-Content -LiteralPath $Path -Encoding UTF8
  }
}

$supabaseUrl = Optional-Env "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) {
  $supabaseUrl = Get-AppConfigValue 'url:\s*"([^"]+)"'
}
$supabaseUrl = (Require-Value "TOBACCO_SUPABASE_URL" $supabaseUrl).TrimEnd("/")

$supabaseKey = Optional-Env "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $supabaseKey) {
  $supabaseKey = Get-AppConfigValue 'publishableKey:\s*"([^"]+)"'
}
$supabaseKey = Require-Value "TOBACCO_SUPABASE_PUBLIC_KEY" $supabaseKey

$syncEmail = Require-Value "TOBACCO_SYNC_EMAIL" (Optional-Env "TOBACCO_SYNC_EMAIL")
$syncPassword = Require-Value "TOBACCO_SYNC_PASSWORD" (Optional-Env "TOBACCO_SYNC_PASSWORD")

try {
  $session = Get-SupabaseSession -Url $supabaseUrl -ApiKey $supabaseKey -Email $syncEmail -Password $syncPassword
  $inventoryReports = @(Invoke-SupabaseGet -Url $supabaseUrl -ApiKey $supabaseKey -Session $session -PathAndQuery "inventory_reports?select=id,created_at,summary,items&source=eq.ameen_sql_agent&order=created_at.desc&limit=1")
  if (-not $inventoryReports.Count) {
    throw "No live Ameen inventory report found in Supabase."
  }

  $approvedRows = @()
  try {
    $approvedRows = @(Invoke-SupabaseGet -Url $supabaseUrl -ApiKey $supabaseKey -Session $session -PathAndQuery "approved_price_items?select=item_key,item_name,sale_price,approved_at,updated_at&order=item_name.asc")
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch {}
    }
    if ($statusCode -eq 404 -or $_.Exception.Message -match "approved_price_items|Could not find the table|permission denied") {
      Write-PricingWorklistLog "Approved prices table is not ready yet; daily worklist will be generated without approved-price history."
      $approvedRows = @()
    } else {
      throw
    }
  }

  $approvedByKey = @{}
  foreach ($row in $approvedRows) {
    if ($row.item_key) {
      $approvedByKey[[string]$row.item_key] = $row
    }
  }

  $latest = $inventoryReports[0]
  $sourceSyncedAt = if ($latest.summary.syncedAt) { $latest.summary.syncedAt } else { $latest.created_at }
  $worklist = @()

  foreach ($item in @($latest.items)) {
    $qty = [double]($item.stockQty)
    if ($qty -le 0) {
      continue
    }
    $key = [string]$item.key
    $approved = $approvedByKey[$key]
    $lastApprovedAt = if ($approved) { if ($approved.approved_at) { $approved.approved_at } else { $approved.updated_at } } else { "" }
    $pricedToday = Is-Today $lastApprovedAt

    if (-not $pricedToday) {
      $worklist += [PSCustomObject]@{
        item_key = $key
        item_name = [string]$item.name
        stock_qty = [math]::Round($qty, 3)
        stock_status = [string]$item.status
        current_price = if ($approved) { [double]$approved.sale_price } else { "" }
        last_approved_at = $lastApprovedAt
        needs_pricing = "yes"
        source_synced_at = $sourceSyncedAt
      }
    }
  }

  $worklist = @($worklist | Sort-Object item_name)
  Write-WorklistCsv -Rows $worklist -Path $OutputPath
  Write-PricingWorklistLog ("Generated daily pricing worklist. Items={0}, Output={1}" -f $worklist.Count, (Resolve-Path -LiteralPath $OutputPath))
} catch {
  Write-PricingWorklistLog "Daily pricing worklist failed: $($_.Exception.Message)"
  throw
}

