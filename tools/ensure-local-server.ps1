# يتأكد أن سيرفر الموقع المحلي شغّال على المنفذ المحدد، ويعيد تشغيله مخفياً إذا توقف.
# يُستدعى من مهمة Task Scheduler كل 5 دقائق (سجّلها عبر register-local-server-watchdog.ps1).
param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  exit 0
}

$nodePath = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodePath)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw "node.exe not found" }
  $nodePath = $nodeCommand.Source
}

Start-Process -FilePath $nodePath -ArgumentList "scripts\serve.mjs" -WorkingDirectory $projectRoot -WindowStyle Hidden

$logDirectory = Join-Path $projectRoot "tools\logs"
if (-not (Test-Path -LiteralPath $logDirectory)) {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
}
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -LiteralPath (Join-Path $logDirectory "local-server-watchdog.log") -Value "$stamp restarted local server on port $Port"
exit 0
