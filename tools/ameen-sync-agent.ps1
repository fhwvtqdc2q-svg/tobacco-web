param(
  [Alias("nce")]
  [switch]$Once,
  [int]$IntervalSeconds = 60,
  [Alias("owhreshold", "Threshold")]
  [int]$LowThreshold = 50,
  [string]$StockQueryPath = ".\tools\ameen-stock-query.sql",
  [string]$CustomerBalancesQueryPath = ".\tools\ameen-customer-balances-query.sql",
  [switch]$SkipCustomerBalances,
  [string]$LogPath = (Join-Path $PSScriptRoot "..\logs\ameen-sync.log")
)

$ErrorActionPreference = "Stop"

function Require-Env($Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  }
  if (-not $value) {
    throw "Missing environment variable: $Name"
  }
  return $value
}

function Write-AgentLog($Message) {
  $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line

  if ($LogPath) {
    $logDirectory = Split-Path -Parent $LogPath
    if ($logDirectory -and -not (Test-Path -LiteralPath $logDirectory)) {
      New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    }

    Add-Content -LiteralPath $LogPath -Value $line
  }
}

function Normalize-ItemName($Value) {
  $text = ""
  if ($null -ne $Value) {
    $text = [string]$Value
  }
  $text = $text.Trim()
  $text = [regex]::Replace($text, '^\d{2,}\s*-\s*', "")
  $text = $text.Replace("أ", "ا").Replace("إ", "ا").Replace("آ", "ا").Replace("ى", "ي").Replace("ة", "ه")
  $text = [regex]::Replace($text, "[^\p{L}\p{N}]+", " ")
  $text = [regex]::Replace($text, "\s+", " ")
  return $text.Trim().ToLowerInvariant()
}

function To-Number($Value) {
  if ($null -eq $Value -or $Value -eq "") {
    return 0
  }
  $text = ([string]$Value).Replace(",", "").Trim()
  $number = 0.0
  if ([double]::TryParse($text, [ref]$number)) {
    return $number
  }
  return 0
}

function ConvertTo-JsonText($Value, $Depth = 10) {
  return ($Value | ConvertTo-Json -Depth $Depth)
}

function Get-SupabaseSession($Url, $ApiKey, $Email, $Password) {
  $endpoint = "$Url/auth/v1/token?grant_type=password"
  $headers = @{
    apikey = $ApiKey
    Accept = "application/json"
  }
  $body = ConvertTo-JsonText -Value @{
    email = $Email
    password = $Password
  }

  try {
    return Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body
  } catch {
    throw "Supabase login failed for TOBACCO_SYNC_EMAIL. Rerun tools\setup-ameen-sync-env.ps1 with a valid Supabase Auth user. Original error: $($_.Exception.Message)"
  }
}

function Invoke-SqlRows($ConnectionString, $Query) {
  Add-Type -AssemblyName System.Data
  $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
  $rows = New-Object System.Collections.Generic.List[object]

  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 60
    $command.CommandText = $Query
    $reader = $command.ExecuteReader()

    while ($reader.Read()) {
      $row = [ordered]@{}
      for ($index = 0; $index -lt $reader.FieldCount; $index++) {
        $name = $reader.GetName($index)
        $row[$name] = if ($reader.IsDBNull($index)) { $null } else { $reader.GetValue($index) }
      }
      $rows.Add([PSCustomObject]$row)
    }
  } finally {
    if ($connection.State -eq "Open") {
      $connection.Close()
    }
  }

  return $rows
}

function Build-InventoryReport($Rows, $LowThreshold) {
  $items = @()

  foreach ($row in $Rows) {
    $name = [string]$row.item_name
    $key = Normalize-ItemName $name
    if (-not $key) {
      continue
    }

    $qty = To-Number $row.stock_qty
    $status = "active"
    if ($qty -le 0) {
      $status = "out"
    } elseif ($qty -le $LowThreshold) {
      $status = "low"
    }

    $items += [ordered]@{
      key = $key
      name = $name
      stockQty = [math]::Round($qty, 3)
      status = $status
      priceListed = $false
      lowThreshold = $LowThreshold
    }
  }

  if (-not $items.Count) {
    throw "Ameen stock query returned no items. Edit tools\\ameen-stock-query.sql after identifying the real Ameen tables."
  }

  $summary = [ordered]@{
    reportDate = (Get-Date).ToString("yyyy-MM-dd")
    source = "ameen_sql_agent"
    totalStockItems = $items.Count
    availableItems = @($items | Where-Object { $_.stockQty -gt 0 }).Count
    lowStockItems = @($items | Where-Object { $_.status -eq "low" }).Count
    outOfStockItems = @($items | Where-Object { $_.status -eq "out" }).Count
    staleItems = 0
    activeItems = @($items | Where-Object { $_.status -eq "active" }).Count
    threshold = $LowThreshold
    syncedAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  return @{
    Summary = $summary
    Items = $items
  }
}

function Build-CustomerBalanceReport($Rows) {
  $items = @()

  foreach ($row in $Rows) {
    $name = [string]$row.customer_name
    $key = Normalize-ItemName $name
    if (-not $key) {
      continue
    }

    $balance = To-Number $row.balance
    $creditLimit = To-Number $row.credit_limit
    $remainingLimit = To-Number $row.remaining_limit
    $lastPaymentAmount = To-Number $row.last_payment_amount
    $lastPaymentDate = ""
    if ($null -ne $row.last_payment_date -and $row.last_payment_date -ne "") {
      $lastPaymentDate = ([datetime]$row.last_payment_date).ToString("o")
    }
    $status = "clear"

    if ($creditLimit -gt 0 -and $balance -gt $creditLimit) {
      $status = "over_limit"
    } elseif ($creditLimit -gt 0 -and $balance -gt 0 -and (($balance / $creditLimit) -ge 0.9)) {
      $status = "near_limit"
    } elseif ($balance -gt 0) {
      $status = "open_balance"
    } elseif ($balance -lt 0) {
      $status = "credit_balance"
    }

    $items += [ordered]@{
      key = $key
      name = $name
      balance = [math]::Round($balance, 3)
      creditLimit = [math]::Round($creditLimit, 3)
      remainingLimit = [math]::Round($remainingLimit, 3)
      lastPaymentAmount = [math]::Round($lastPaymentAmount, 3)
      lastPaymentDate = $lastPaymentDate
      lastPaymentNotes = [string]$row.last_payment_notes
      status = $status
      customerGuid = [string]$row.customer_guid
    }
  }

  if (-not $items.Count) {
    throw "Ameen customer balances query returned no customers. Edit tools\\ameen-customer-balances-query.sql after identifying the real Ameen customer table."
  }

  $totalBalance = 0.0
  $totalCreditLimit = 0.0
  $totalDebitBalance = 0.0
  $totalCreditBalance = 0.0
  foreach ($item in $items) {
    $totalBalance += [double]$item.balance
    $totalCreditLimit += [double]$item.creditLimit
    if ([double]$item.balance -gt 0) {
      $totalDebitBalance += [double]$item.balance
    } elseif ([double]$item.balance -lt 0) {
      $totalCreditBalance += [double]$item.balance
    }
  }

  $summary = [ordered]@{
    reportDate = (Get-Date).ToString("yyyy-MM-dd")
    source = "ameen_customer_balances"
    totalCustomers = $items.Count
    customersWithBalance = @($items | Where-Object { $_.balance -ne 0 }).Count
    customersWithDebitBalance = @($items | Where-Object { $_.balance -gt 0 }).Count
    customersWithCreditBalance = @($items | Where-Object { $_.balance -lt 0 }).Count
    customersWithLimit = @($items | Where-Object { $_.creditLimit -gt 0 }).Count
    overLimitCustomers = @($items | Where-Object { $_.status -eq "over_limit" }).Count
    nearLimitCustomers = @($items | Where-Object { $_.status -eq "near_limit" }).Count
    totalBalance = [math]::Round($totalBalance, 3)
    totalDebitBalance = [math]::Round($totalDebitBalance, 3)
    totalCreditBalance = [math]::Round($totalCreditBalance, 3)
    totalCreditLimit = [math]::Round($totalCreditLimit, 3)
    syncedAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  return @{
    Summary = $summary
    Items = $items
  }
}

function Send-Report($SupabaseUrl, $ApiKey, $Session, $Report, $Source) {
  $endpoint = "$SupabaseUrl/rest/v1/inventory_reports"
  $headers = @{
    apikey = $ApiKey
    Authorization = "Bearer $($Session.access_token)"
    Accept = "application/json"
    Prefer = "return=minimal"
  }
  $body = ConvertTo-JsonText -Value @{
    report_date = $Report.Summary.reportDate
    source = $Source
    summary = $Report.Summary
    items = $Report.Items
    created_by = $Session.user.id
  } -Depth 20

  Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body | Out-Null
}

function Send-InventoryReport($SupabaseUrl, $ApiKey, $Session, $Report) {
  Send-Report -SupabaseUrl $SupabaseUrl -ApiKey $ApiKey -Session $Session -Report $Report -Source "ameen_sql_agent"
}

function Send-CustomerBalanceReport($SupabaseUrl, $ApiKey, $Session, $Report) {
  Send-Report -SupabaseUrl $SupabaseUrl -ApiKey $ApiKey -Session $Session -Report $Report -Source "ameen_customer_balances"
}

function Sync-Once {
  $connectionString = Require-Env "AMEEN_SQL_CONNECTION_STRING"
  $supabaseUrl = (Require-Env "TOBACCO_SUPABASE_URL").TrimEnd("/")
  $supabaseKey = Require-Env "TOBACCO_SUPABASE_PUBLIC_KEY"
  $syncEmail = Require-Env "TOBACCO_SYNC_EMAIL"
  $syncPassword = Require-Env "TOBACCO_SYNC_PASSWORD"

  if (-not (Test-Path -LiteralPath $StockQueryPath)) {
    throw "Stock query file not found: $StockQueryPath"
  }

  $query = Get-Content -Raw -LiteralPath $StockQueryPath
  $rows = Invoke-SqlRows -ConnectionString $connectionString -Query $query
  $report = Build-InventoryReport -Rows $rows -LowThreshold $LowThreshold
  $session = Get-SupabaseSession -Url $supabaseUrl -ApiKey $supabaseKey -Email $syncEmail -Password $syncPassword
  Send-InventoryReport -SupabaseUrl $supabaseUrl -ApiKey $supabaseKey -Session $session -Report $report

  $customerCount = 0
  if (-not $SkipCustomerBalances) {
    if (-not (Test-Path -LiteralPath $CustomerBalancesQueryPath)) {
      throw "Customer balances query file not found: $CustomerBalancesQueryPath"
    }

    $customerQuery = Get-Content -Raw -LiteralPath $CustomerBalancesQueryPath
    $customerRows = Invoke-SqlRows -ConnectionString $connectionString -Query $customerQuery
    $customerReport = Build-CustomerBalanceReport -Rows $customerRows
    Send-CustomerBalanceReport -SupabaseUrl $supabaseUrl -ApiKey $supabaseKey -Session $session -Report $customerReport
    $customerCount = $customerReport.Items.Count
  }

  Write-AgentLog ("Synced {0} items. Low={1}, Out={2}, Customers={3}" -f $report.Items.Count, $report.Summary.lowStockItems, $report.Summary.outOfStockItems, $customerCount)
}

do {
  try {
    Sync-Once
  } catch {
    Write-AgentLog ("Sync failed: {0}" -f $_.Exception.Message)
    if ($Once) {
      throw
    }
  }

  if ($Once) {
    break
  }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)
