# يسجّل مهمة مجدولة تسحب آخر نسخة من GitHub يومياً (عندما يكون المستودع نظيفاً فقط).
# التشغيل: .\tools\register-daily-git-pull-task.ps1
param(
  [string]$TaskName = "TOBACCO Daily Git Pull",
  [string]$StartTime = "07:30"
)

$ErrorActionPreference = "Stop"

$pullScriptPath = Join-Path $PSScriptRoot "daily-git-pull.ps1"
if (-not (Test-Path -LiteralPath $pullScriptPath)) {
  throw "Pull script not found: $pullScriptPath"
}

$launcherPath = "C:\tmp\tobacco-daily-git-pull.cmd"
$hiddenLauncherPath = "C:\tmp\tobacco-daily-git-pull-hidden.vbs"
$launcherDirectory = Split-Path -Parent $launcherPath
if (-not (Test-Path -LiteralPath $launcherDirectory)) {
  New-Item -ItemType Directory -Force -Path $launcherDirectory | Out-Null
}

$launcherContent = @"
@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$pullScriptPath"
exit /b %ERRORLEVEL%
"@
Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding ASCII

$hiddenLauncherContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run """$launcherPath""", 0, True
"@
Set-Content -LiteralPath $hiddenLauncherPath -Value $hiddenLauncherContent -Encoding ASCII

$taskCommand = "wscript.exe `"$hiddenLauncherPath`""
$result = & schtasks.exe /Create /TN $TaskName /SC DAILY /ST $StartTime /TR $taskCommand /F 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scheduled task. schtasks.exe output: $result"
}

Write-Host "Scheduled task registered: $TaskName"
Write-Host "It will pull from GitHub daily at $StartTime (only when the repo is clean)."
