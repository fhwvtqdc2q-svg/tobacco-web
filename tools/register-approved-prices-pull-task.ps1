param(
  [string]$TaskName = "TOBACCO Approved Prices Pull",
  [int]$IntervalMinutes = 5,
  [int]$ExecutionTimeLimitMinutes = 10,
  [switch]$ApplyToAmeen = $true,
  [switch]$AllActivePriceLists = $true,
  [switch]$AttachedOutputPriceListsOnly,
  [switch]$CreateMissingPriceListItems
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes must be at least 1."
}
if ($ExecutionTimeLimitMinutes -lt 1) {
  throw "ExecutionTimeLimitMinutes must be at least 1."
}

$syncScriptPath = Join-Path $PSScriptRoot "sync-approved-prices-to-ameen.ps1"
if (-not (Test-Path -LiteralPath $syncScriptPath)) {
  throw "Approved prices sync script not found: $syncScriptPath"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "reports\prices\tobacco-approved-prices.csv"
$previewPath = Join-Path $projectRoot "reports\prices\tobacco-ameen-price-update-preview.csv"
$logPath = Join-Path $projectRoot "logs\approved-prices-sync.log"
$applyLogPath = Join-Path $projectRoot "logs\ameen-price-apply.log"
$taskRunLogPath = Join-Path $projectRoot "logs\approved-prices-task-run.log"

if ($AttachedOutputPriceListsOnly) {
  $AllActivePriceLists = $false
}

foreach ($path in @((Split-Path -Parent $outputPath), (Split-Path -Parent $logPath), (Split-Path -Parent $applyLogPath), (Split-Path -Parent $taskRunLogPath), "C:\tmp")) {
  if ($path -and -not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
  }
}

$launcherPsPath = "C:\tmp\tobacco-approved-prices-pull.ps1"

function Convert-ToPowerShellLiteral([string]$Value) {
  return "'$($Value -replace "'", "''")'"
}

$launcherContent = @"
`$ErrorActionPreference = "Stop"
`$projectRoot = $(Convert-ToPowerShellLiteral $projectRoot)
`$syncScript = $(Convert-ToPowerShellLiteral $syncScriptPath)
`$outputPath = $(Convert-ToPowerShellLiteral $outputPath)
`$previewPath = $(Convert-ToPowerShellLiteral $previewPath)
`$logPath = $(Convert-ToPowerShellLiteral $logPath)
`$applyLogPath = $(Convert-ToPowerShellLiteral $applyLogPath)
`$taskRunLogPath = $(Convert-ToPowerShellLiteral $taskRunLogPath)
`$arguments = @{
  ApprovedPricesPath = `$outputPath
  PreviewPath = `$previewPath
  PullLogPath = `$logPath
  ApplyLogPath = `$applyLogPath
}
"@
if ($ApplyToAmeen) {
  $launcherContent += "`r`n`$arguments['Apply'] = `$true"
}
if ($AllActivePriceLists) {
  $launcherContent += "`r`n`$arguments['AllActivePriceLists'] = `$true"
}
if ($AttachedOutputPriceListsOnly) {
  $launcherContent += "`r`n`$arguments['AttachedOutputPriceListsOnly'] = `$true"
}
if ($CreateMissingPriceListItems) {
  $launcherContent += "`r`n`$arguments['CreateMissingPriceListItems'] = `$true"
}
$launcherContent += @"

function Write-RunLog([string]`$Message) {
  `$line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$Message
  Add-Content -LiteralPath `$taskRunLogPath -Value `$line -Encoding UTF8
}

try {
  Write-RunLog "Starting approved-price pull and Ameen apply."
  Push-Location -LiteralPath `$projectRoot
  & `$syncScript @arguments
  Write-RunLog "Finished approved-price pull and Ameen apply."
  exit 0
} catch {
  Write-RunLog ("Failed approved-price pull/apply: {0}" -f `$_.Exception.Message)
  Write-Error `$_.Exception.Message
  exit 1
} finally {
  Pop-Location
}
"@

Set-Content -LiteralPath $launcherPsPath -Value $launcherContent -Encoding UTF8

$powerShellPath = Join-Path $PSHOME "powershell.exe"

$taskCommand = "`"$powerShellPath`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$launcherPsPath`""
$result = & schtasks.exe /Create /TN $TaskName /SC MINUTE /MO $IntervalMinutes /TR $taskCommand /F 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scheduled task. schtasks.exe output: $result"
}

if (Get-Command New-ScheduledTaskSettingsSet -ErrorAction SilentlyContinue) {
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $ExecutionTimeLimitMinutes) `
    -MultipleInstances Queue
  Set-ScheduledTask -TaskName $TaskName -Settings $settings | Out-Null
}

Write-Host "Scheduled task registered: $TaskName"
if ($ApplyToAmeen) {
  Write-Host "It will pull approved prices and apply them to Ameen every $IntervalMinutes minute(s)."
} else {
  Write-Host "It will pull approved prices and create an Ameen preview every $IntervalMinutes minute(s)."
}
Write-Host "Each run is limited to $ExecutionTimeLimitMinutes minute(s); overlapping runs are queued."
if ($AllActivePriceLists) {
  Write-Host "It will update every active Ameen price list, not only lists attached to output books."
}
if ($AttachedOutputPriceListsOnly) {
  Write-Host "It will only update active Ameen price lists attached to output books."
}
Write-Host "PowerShell launcher file: $launcherPsPath"
Write-Host "Output file: $outputPath"
Write-Host "Ameen preview file: $previewPath"
Write-Host "Log file: $logPath"
Write-Host "Ameen apply log file: $applyLogPath"
Write-Host "Task run log file: $taskRunLogPath"
Write-Host "No passwords are stored in the launcher file."
