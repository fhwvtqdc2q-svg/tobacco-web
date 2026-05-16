$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$localPort = 5173
$tunnelLog = Join-Path $projectRoot ".public-link.log"

Set-Location $projectRoot

if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port $localPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    Write-Host "Local server is not running. Starting it first..." -ForegroundColor Yellow
    Start-Process -FilePath "node" -ArgumentList @("scripts/serve.mjs", "--port", "$localPort") -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 2
}

Remove-Item -LiteralPath $tunnelLog -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Creating a temporary public HTTPS link..." -ForegroundColor Cyan
Write-Host "Keep this window open while using the iPhone." -ForegroundColor Yellow
Write-Host ""

npx --yes localtunnel --port $localPort
