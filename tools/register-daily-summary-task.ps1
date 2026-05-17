param(
  [string]$TaskName = "TOBACCO Daily Summary",
  [string]$RunAt = "21:00"
)

$ErrorActionPreference = "Stop"

$summaryPath = Join-Path $PSScriptRoot "ameen-daily-summary.ps1"
if (-not (Test-Path -LiteralPath $summaryPath)) {
  throw "Daily summary script not found: $summaryPath"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot "reports\daily"
$logPath = Join-Path $projectRoot "logs\ameen-daily-summary.log"

foreach ($path in @($outputDirectory, (Split-Path -Parent $logPath), "C:\tmp")) {
  if ($path -and -not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

$launcherPath = "C:\tmp\tobacco-daily-summary.cmd"
$launcherContent = @"
@echo off
setlocal
set "PROJECT_ROOT=$projectRoot"
set "SUMMARY_PATH=$summaryPath"
set "OUTPUT_DIR=$outputDirectory"
set "LOG_PATH=$logPath"
pushd "%PROJECT_ROOT%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%SUMMARY_PATH%" -OutputDirectory "%OUTPUT_DIR%" -LogPath "%LOG_PATH%"
set "SUMMARY_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %SUMMARY_EXIT_CODE%
"@

Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding ASCII

$result = & schtasks.exe /Create /TN $TaskName /SC DAILY /ST $RunAt /TR $launcherPath /F 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scheduled task. schtasks.exe output: $result"
}

Write-Host "Scheduled task registered: $TaskName"
Write-Host "It will run daily at $RunAt."
Write-Host "Launcher file: $launcherPath"
Write-Host "Reports folder: $outputDirectory"
Write-Host "Log file: $logPath"
Write-Host "Email is sent only when TOBACCO_SMTP_* environment variables are configured."

