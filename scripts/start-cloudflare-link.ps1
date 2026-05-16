$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$localPort = 5173
$toolsDir = Join-Path $projectRoot ".tools"
$cloudflared = Join-Path $toolsDir "cloudflared.exe"

Set-Location $projectRoot
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

$ipconfigText = ipconfig | Out-String
if ($ipconfigText -match "HotspotShield|WinTun|VPN") {
    Write-Host ""
    Write-Host "Warning: a VPN adapter was detected. Cloudflare Tunnel may fail while VPN/HotspotShield is active." -ForegroundColor Yellow
    Write-Host "If the tunnel times out, turn off HotspotShield/VPN and run this script again." -ForegroundColor Yellow
    Write-Host ""
}

if (-not (Test-Path -LiteralPath $cloudflared)) {
    Write-Host "Downloading Cloudflare Tunnel..." -ForegroundColor Cyan
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -Uri $url -OutFile $cloudflared
}

if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port $localPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    Write-Host "Local server is not running. Starting it first..." -ForegroundColor Yellow
    Start-Process -FilePath "node" -ArgumentList @("scripts/serve.mjs", "--port", "$localPort") -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Creating a temporary Cloudflare HTTPS link..." -ForegroundColor Cyan
Write-Host "Using HTTP/2 instead of QUIC because some VPNs and mobile networks block UDP tunnel traffic." -ForegroundColor Yellow
Write-Host "Look for a link ending with trycloudflare.com and open it on iPhone Safari." -ForegroundColor Green
Write-Host "Keep this window open while using the iPhone." -ForegroundColor Yellow
Write-Host ""

& $cloudflared tunnel --protocol http2 --url "http://localhost:$localPort"
