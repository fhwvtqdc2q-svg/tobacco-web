$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 5173

while (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) {
    $port++
}

Set-Location $projectRoot

$addresses = ipconfig | Select-String -Pattern "IPv4" | ForEach-Object {
    ($_ -split ":")[-1].Trim()
} | Where-Object {
    $_ -and $_ -notlike "127.*" -and $_ -notlike "100.*" -and $_ -notlike "172.22.*"
}

Write-Host ""
Write-Host "Web Platform server will start now." -ForegroundColor Cyan
Write-Host ""
Write-Host "Open on this Windows laptop:"
Write-Host "  http://localhost:$port" -ForegroundColor Green
Write-Host ""
Write-Host "Open on iPhone Safari using one of these:"
foreach ($address in $addresses) {
    Write-Host "  http://$address`:$port" -ForegroundColor Green
}
Write-Host ""
Write-Host "Keep this window open while using the iPhone." -ForegroundColor Yellow
Write-Host "If Windows Firewall asks, choose Allow on Private networks." -ForegroundColor Yellow
Write-Host ""

node scripts/serve.mjs --port $port
