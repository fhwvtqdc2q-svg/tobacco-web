#requires -Version 5.1
# Registration only. This script never starts the scheduled task or producer.
[CmdletBinding()]
param(
    [ValidateRange(5, 1440)][int]$IntervalMinutes = 30,
    [Switch]$ReplaceExisting
)

$ErrorActionPreference = "Stop"
$taskName = "TOBACCO Sales Line Items Push"
$requiredUserId = "OZK2026\LOQ"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$adminPrincipal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $adminPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this registration script from an elevated Windows PowerShell session."
}
if (-not $identity.Name.Equals($requiredUserId, [StringComparison]::OrdinalIgnoreCase)) {
    throw "This task must be registered from the OZK2026\LOQ Windows account."
}

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    if (-not $ReplaceExisting) {
        throw "Scheduled task '$taskName' already exists. No changes were made. Re-run with -ReplaceExisting to explicitly replace it."
    }

    Write-Warning "ReplaceExisting was explicitly requested. The existing scheduled task '$taskName' will be replaced; it will not be started or stopped."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "push-sales-line-items.ps1"))
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "Sales line items producer was not found."
}
if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
    throw "Windows PowerShell 5.1 executable was not found."
}
if ($scriptPath.Contains('"')) {
    throw "Producer path contains an unsupported quote character."
}

$tokens = $null
$parserErrors = $null
[Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$parserErrors
) | Out-Null
if ($parserErrors.Count -ne 0) {
    throw "Sales line items producer failed PowerShell parser validation."
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Days 30"
$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument $arguments `
    -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At ((Get-Date).AddMinutes($IntervalMinutes)) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId $requiredUserId `
    -LogonType Password `
    -RunLevel Highest
$taskDefinition = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $taskPrincipal `
    -Description "Atomic read-only Ameen sales line extraction to Supabase."

Write-Host "The task will run as $requiredUserId with LogonType Password."
Write-Host "Enter the Windows password when prompted. It is not written to disk or printed."
$securePassword = Read-Host -Prompt "Windows password for $requiredUserId" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrEmpty($plainPassword)) {
        throw "A Windows password is required to register this scheduled task."
    }

    $registrationParameters = @{
        TaskName    = $taskName
        InputObject = $taskDefinition
        User        = $requiredUserId
        Password    = $plainPassword
        ErrorAction = "Stop"
    }
    if (($null -ne $existingTask) -and $ReplaceExisting) {
        $registrationParameters["Force"] = $true
    }

    Register-ScheduledTask @registrationParameters | Out-Null
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $plainPassword = $null
    if ($securePassword) {
        $securePassword.Dispose()
    }
}

Write-Host "Registered scheduled task: $taskName"
Write-Host "First scheduled run is after one full interval; the task was not started."
