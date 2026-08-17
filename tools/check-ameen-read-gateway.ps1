$ErrorActionPreference = "Stop"
$path = Join-Path $PSScriptRoot "ameen-read-gateway.ps1"
$text = Get-Content -Raw -LiteralPath $path
$required = @("Assert-ReadOnlySql", "CommandBehavior]::ReadOnly", "AMEEN_SQL_CONNECTION_STRING", "ValidateSet(\"health\",\"stock\",\"customers\")")
foreach ($needle in $required) { if (-not $text.Contains($needle)) { throw "Missing gateway contract: $needle" } }
$blockedPattern = "insert\|update\|delete\|merge\|drop\|alter\|create\|truncate"
if ($text -notmatch $blockedPattern) { throw "Gateway SQL deny-list is missing." }
Write-Host "Ameen Read Gateway static safety contract: OK"
