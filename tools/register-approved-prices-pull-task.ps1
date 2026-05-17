param(
  [string]$TaskName = "TOBACCO Approved Prices Pull",
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes must be at least 1."
}

$pullScriptPath = Join-Path $PSScriptRoot "pull-approved-prices.ps1"
if (-not (Test-Path -LiteralPath $pullScriptPath)) {
  throw "Approved prices pull script not found: $pullScriptPath"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "reports\prices\tobacco-approved-prices.csv"
$logPath = Join-Path $projectRoot "logs\approved-prices-sync.log"

foreach ($path in @((Split-Path -Parent $outputPath), (Split-Path -Parent $logPath), "C:\tmp")) {
  if ($path -and -not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

$launcherPath = "C:\tmp\tobacco-approved-prices-pull.cmd"
$hiddenLauncherPath = "C:\tmp\tobacco-approved-prices-pull-hidden.vbs"
$launcherContent = @"
@echo off
setlocal
set "PROJECT_ROOT=$projectRoot"
set "PULL_SCRIPT=$pullScriptPath"
set "OUTPUT_PATH=$outputPath"
set "LOG_PATH=$logPath"
pushd "%PROJECT_ROOT%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%PULL_SCRIPT%" -OutputPath "%OUTPUT_PATH%" -LogPath "%LOG_PATH%"
set "PRICE_PULL_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %PRICE_PULL_EXIT_CODE%
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
Write-Host "It will pull approved prices every $IntervalMinutes minute(s)."
Write-Host "Launcher file: $launcherPath"
Write-Host "Hidden launcher file: $hiddenLauncherPath"
Write-Host "Output file: $outputPath"
Write-Host "Log file: $logPath"
Write-Host "No passwords are stored in the launcher file."
