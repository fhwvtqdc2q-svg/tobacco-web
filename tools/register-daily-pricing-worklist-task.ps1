param(
  [string]$TaskName = "TOBACCO Daily Pricing Worklist",
  [string]$RunAt = "08:00"
)

$ErrorActionPreference = "Stop"

$worklistScriptPath = Join-Path $PSScriptRoot "pull-daily-pricing-worklist.ps1"
if (-not (Test-Path -LiteralPath $worklistScriptPath)) {
  throw "Daily pricing worklist script not found: $worklistScriptPath"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "reports\prices\tobacco-daily-pricing-worklist.csv"
$logPath = Join-Path $projectRoot "logs\daily-pricing-worklist.log"

foreach ($path in @((Split-Path -Parent $outputPath), (Split-Path -Parent $logPath), "C:\tmp")) {
  if ($path -and -not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

$launcherPath = "C:\tmp\tobacco-daily-pricing-worklist.cmd"
$launcherContent = @"
@echo off
setlocal
set "PROJECT_ROOT=$projectRoot"
set "WORKLIST_SCRIPT=$worklistScriptPath"
set "OUTPUT_PATH=$outputPath"
set "LOG_PATH=$logPath"
pushd "%PROJECT_ROOT%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%WORKLIST_SCRIPT%" -OutputPath "%OUTPUT_PATH%" -LogPath "%LOG_PATH%"
set "WORKLIST_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %WORKLIST_EXIT_CODE%
"@

Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding ASCII

$result = & schtasks.exe /Create /TN $TaskName /SC DAILY /ST $RunAt /TR $launcherPath /F 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scheduled task. schtasks.exe output: $result"
}

Write-Host "Scheduled task registered: $TaskName"
Write-Host "It will generate the pricing worklist daily at $RunAt."
Write-Host "Launcher file: $launcherPath"
Write-Host "Output file: $outputPath"
Write-Host "Log file: $logPath"
Write-Host "No passwords are stored in the launcher file."

