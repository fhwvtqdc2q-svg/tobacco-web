param(
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\reports\prices\tobacco-approved-prices.csv"),
  [string]$LogPath = (Join-Path $PSScriptRoot "..\logs\approved-prices-sync.log")
)

$ErrorActionPreference = "Stop"

function Write-PricePullLog($Message) {
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
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
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

function Test-ApprovedPriceRow($Row) {
  if ($null -eq $Row) {
    return $false
  }
  if (-not ($Row.PSObject.Properties.Name -contains "item_key")) {
    return $false
  }
  return -not [string]::IsNullOrWhiteSpace([string]$Row.item_key)
}

function Convert-ToNumber($Value, [double]$Default = 0) {
  if ($null -eq $Value) {
    return $Default
  }
  $text = ([string]$Value).Trim()
  if (-not $text) {
    return $Default
  }
  $number = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    return $number
  }
  if ([double]::TryParse($text, [ref]$number)) {
    return $number
  }
  return $Default
}

function Get-ComputedUnit1Price($Row) {
  $unit2Price = Convert-ToNumber $Row.unit2_price 0
  $unit2Factor = Convert-ToNumber $Row.unit2_factor 1
  if ($unit2Factor -le 0) {
    $unit2Factor = 1
  }
  if ($unit2Price -gt 0) {
    return [math]::Round(($unit2Price / $unit2Factor), 3)
  }
  $unit1Price = Convert-ToNumber $Row.unit1_price 0
  if ($unit1Price -gt 0) {
    return [math]::Round($unit1Price, 3)
  }
  return [math]::Round((Convert-ToNumber $Row.sale_price 0), 3)
}

function Write-ApprovedPricesCsv($Rows, $Path) {
  $outDir = Split-Path -Parent $Path
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }

  $validRows = @($Rows | Where-Object { Test-ApprovedPriceRow $_ })

  $objects = @($validRows | ForEach-Object {
    $computedUnit1Price = Get-ComputedUnit1Price $_
    [PSCustomObject]@{
      item_key = $_.item_key
      item_name = $_.item_name
      unit2_price = $_.unit2_price
      unit2_name = $_.unit2_name
      unit2_factor = $_.unit2_factor
      sale_price = $computedUnit1Price
      unit1_name = $_.unit1_name
      unit1_price = $computedUnit1Price
      stock_qty = $_.stock_qty
      stock_status = $_.stock_status
      approved_at = $_.approved_at
      updated_at = $_.updated_at
    }
  })

  if ($objects.Count) {
    $objects | Export-Csv -LiteralPath $Path -NoTypeInformation -Encoding UTF8
  } else {
    "item_key,item_name,unit2_price,unit2_name,unit2_factor,sale_price,unit1_name,unit1_price,stock_qty,stock_status,approved_at,updated_at" | Set-Content -LiteralPath $Path -Encoding UTF8
  }
}

$supabaseUrl = (Optional-Env "TOBACCO_SUPABASE_URL")
if (-not $supabaseUrl) {
  $supabaseUrl = Get-AppConfigValue 'url:\s*"([^"]+)"'
}
$supabaseUrl = (Require-Value "TOBACCO_SUPABASE_URL" $supabaseUrl).TrimEnd("/")

$supabaseKey = (Optional-Env "TOBACCO_SUPABASE_PUBLIC_KEY")
if (-not $supabaseKey) {
  $supabaseKey = Get-AppConfigValue 'publishableKey:\s*"([^"]+)"'
}
$supabaseKey = Require-Value "TOBACCO_SUPABASE_PUBLIC_KEY" $supabaseKey

$syncEmail = Require-Value "TOBACCO_SYNC_EMAIL" (Optional-Env "TOBACCO_SYNC_EMAIL")
$syncPassword = Require-Value "TOBACCO_SYNC_PASSWORD" (Optional-Env "TOBACCO_SYNC_PASSWORD")

try {
  $session = Get-SupabaseSession -Url $supabaseUrl -ApiKey $supabaseKey -Email $syncEmail -Password $syncPassword
  $rows = @(Invoke-SupabaseGet -Url $supabaseUrl -ApiKey $supabaseKey -Session $session -PathAndQuery "approved_price_items?select=item_key,item_name,unit2_price,unit2_name,unit2_factor,sale_price,unit1_name,unit1_price,stock_qty,stock_status,approved_at,updated_at&order=item_name.asc" | Where-Object { Test-ApprovedPriceRow $_ })
  Write-ApprovedPricesCsv -Rows $rows -Path $OutputPath
  Write-PricePullLog ("Pulled {0} approved prices to {1}" -f $rows.Count, (Resolve-Path -LiteralPath $OutputPath))
} catch {
  $message = $_.Exception.Message
  $statusCode = $null
  if ($_.Exception.Response) {
    try {
      $statusCode = [int]$_.Exception.Response.StatusCode
    } catch {}
  }
  if ($statusCode -eq 404 -or $message -match "approved_price_items|Could not find the table|permission denied") {
    Write-PricePullLog "Approved prices table is not ready yet. Run supabase\approved-price-items.sql in Supabase SQL Editor. Original error: $message"
    exit 0
  }
  Write-PricePullLog "Approved prices pull failed: $message"
  throw
}
