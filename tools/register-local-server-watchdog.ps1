# يسجّل مهمة مجدولة تتفقد سيرفر الموقع المحلي كل 5 دقائق وتعيد تشغيله إذا توقف.
# التشغيل: .\tools\register-local-server-watchdog.ps1
param(
  [string]$TaskName = "TOBACCO Local Web Server",
  [int]$IntervalMinutes = 5,
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

$watchdogPath = Join-Path $PSScriptRoot "ensure-local-server.ps1"
if (-not (Test-Path -LiteralPath $watchdogPath)) {
  throw "Watchdog script not found: $watchdogPath"
}

$launcherPath = "C:\tmp\tobacco-local-server.cmd"
$hiddenLauncherPath = "C:\tmp\tobacco-local-server-hidden.vbs"
$launcherDirectory = Split-Path -Parent $launcherPath
if (-not (Test-Path -LiteralPath $launcherDirectory)) {
  New-Item -ItemType Directory -Force -Path $launcherDirectory | Out-Null
}

$launcherContent = @"
@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$watchdogPath" -Port $Port
exit /b %ERRORLEVEL%
"@
Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding ASCII

$hiddenLauncherContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run """$launcherPath""", 0, True
"@
Set-Content -LiteralPath $hiddenLauncherPath -Value $hiddenLauncherContent -Encoding ASCII

$taskCommand = "wscript.exe `"$hiddenLauncherPath`""
$result = & schtasks.exe /Create /TN $TaskName /SC MINUTE /MO $IntervalMinutes /TR $taskCommand /F 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scheduled task. schtasks.exe output: $result"
}

Write-Host "Scheduled task registered: $TaskName"
Write-Host "It will check the local server every $IntervalMinutes minute(s) on port $Port."
