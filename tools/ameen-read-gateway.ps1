param(
  [ValidateSet("health","stock","customers")]
  [string]$Resource = "health",
  [string]$StockQueryPath = ".\tools\ameen-stock-query.sql",
  [string]$CustomerQueryPath = ".\tools\ameen-customer-balances-query.sql"
)

$ErrorActionPreference = "Stop"

function Require-Env($Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, "Process") }
  if (-not $value) { throw "Missing environment variable: $Name" }
  return $value
}

function Assert-ReadOnlySql([string]$Query) {
  $normalized = [regex]::Replace($Query, "--.*?$|/\*.*?\*/", " ", [System.Text.RegularExpressions.RegexOptions]::Singleline -bor [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $blocked = "\b(insert|update|delete|merge|drop|alter|create|truncate|exec(?:ute)?|grant|revoke|deny|backup|restore|dbcc|kill|use)\b"
  if ($normalized -match $blocked) { throw "Ameen Read Gateway rejected a non-read-only SQL statement." }
  if ($normalized -notmatch "(?is)^\s*(with\b.*?\bselect\b|select\b)") { throw "Ameen Read Gateway accepts SELECT/CTE queries only." }
}

function Invoke-ReadOnlySql([string]$ConnectionString, [string]$Query) {
  Assert-ReadOnlySql $Query
  Add-Type -AssemblyName System.Data
  $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
  $rows = New-Object System.Collections.Generic.List[object]
  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 45
    $command.CommandText = $Query
    $reader = $command.ExecuteReader([System.Data.CommandBehavior]::ReadOnly)
    while ($reader.Read()) {
      $row = [ordered]@{}
      for ($i = 0; $i -lt $reader.FieldCount; $i++) {
        $row[$reader.GetName($i)] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
      }
      $rows.Add([PSCustomObject]$row)
    }
  } finally {
    if ($connection.State -eq "Open") { $connection.Close() }
  }
  return $rows
}

$connectionString = Require-Env "AMEEN_SQL_CONNECTION_STRING"
$started = Get-Date

if ($Resource -eq "health") {
  $rows = Invoke-ReadOnlySql $connectionString "select db_name() as database_name, getdate() as server_time;"
  [ordered]@{ ok=$true; resource="health"; source="ameen_sql_read_gateway"; asOf=(Get-Date).ToUniversalTime().ToString("o"); database=$rows[0].database_name; serverTime=$rows[0].server_time; elapsedMs=[math]::Round(((Get-Date)-$started).TotalMilliseconds) } | ConvertTo-Json -Depth 5
  exit 0
}

$queryPath = if ($Resource -eq "stock") { $StockQueryPath } else { $CustomerQueryPath }
if (-not (Test-Path -LiteralPath $queryPath)) { throw "Gateway query file not found: $queryPath" }
$query = Get-Content -Raw -LiteralPath $queryPath
$rows = @(Invoke-ReadOnlySql $connectionString $query)

[ordered]@{
  ok = $true
  resource = $Resource
  source = "ameen_sql_read_gateway"
  asOf = (Get-Date).ToUniversalTime().ToString("o")
  rowCount = $rows.Count
  elapsedMs = [math]::Round(((Get-Date)-$started).TotalMilliseconds)
  rows = $rows
} | ConvertTo-Json -Depth 20
