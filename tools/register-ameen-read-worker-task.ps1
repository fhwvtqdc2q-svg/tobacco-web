# Registration only. This script never starts the task or the worker.
$ErrorActionPreference = "Stop"

$taskName = "TOBACCO Ameen Read Worker"
$requiredUser = "LOQ"
$requiredEnvironmentVariables = @(
    "TOBACCO_SUPABASE_URL",
    "TOBACCO_SUPABASE_PUBLIC_KEY",
    "TOBACCO_SYNC_EMAIL",
    "TOBACCO_SYNC_PASSWORD",
    "AMEEN_SQL_CONNECTION_STRING"
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this registration script from an elevated Windows PowerShell session."
}

$currentUserId = $identity.Name
$currentUserName = ($currentUserId -split '\\')[-1]
if (-not $currentUserName.Equals($requiredUser, [StringComparison]::OrdinalIgnoreCase)) {
    throw "This task must be registered for the LOQ Windows account. Current account is not allowed."
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "Scheduled task already exists. Review the existing definition before replacing it."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "ameen-read-worker.ps1"))
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) {
    throw "Ameen Read Worker script was not found."
}
if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
    throw "Windows PowerShell 5.1 executable was not found."
}
if ($workerPath.Contains('"')) {
    throw "Worker path contains an unsupported quote character."
}

$tokens = $null
$parserErrors = $null
[Management.Automation.Language.Parser]::ParseFile(
    $workerPath,
    [ref]$tokens,
    [ref]$parserErrors
) | Out-Null
if ($parserErrors.Count -ne 0) {
    throw "Ameen Read Worker failed PowerShell parser validation."
}

$missingEnvironmentVariables = @(
    $requiredEnvironmentVariables | Where-Object {
        [string]::IsNullOrWhiteSpace(
            [Environment]::GetEnvironmentVariable($_, "User")
        )
    }
)
if ($missingEnvironmentVariables.Count -ne 0) {
    throw "Missing required LOQ user environment variables: $($missingEnvironmentVariables -join ', ')"
}

$supabaseUrl = [Environment]::GetEnvironmentVariable("TOBACCO_SUPABASE_URL", "User")
$supabaseUri = $null
if (-not [Uri]::TryCreate($supabaseUrl, [UriKind]::Absolute, [ref]$supabaseUri) -or
    $supabaseUri.Scheme -ne "https") {
    throw "TOBACCO_SUPABASE_URL must be a valid HTTPS URL."
}
$supabaseUrl = $null
$supabaseUri = $null

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$workerPath`""
$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument $arguments `
    -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId $currentUserId `
    -LogonType Password `
    -RunLevel Limited
$taskDefinition = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $taskPrincipal `
    -Description "Long-running read-only Ameen request worker."

Write-Host "The task will run as $currentUserId with LogonType Password."
Write-Host "Enter the Windows password when prompted. It is not written to disk or printed."
$securePassword = Read-Host -Prompt "Windows password for $currentUserId" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrEmpty($plainPassword)) {
        throw "A Windows password is required to register this startup task."
    }

    Register-ScheduledTask `
        -TaskName $taskName `
        -InputObject $taskDefinition `
        -User $currentUserId `
        -Password $plainPassword `
        -ErrorAction Stop | Out-Null
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $plainPassword = $null
    if ($securePassword) {
        $securePassword.Dispose()
    }
}

Write-Host "Registered scheduled task: $taskName"
Write-Host "Trigger: AtStartup"
Write-Host "The task and worker were not started by this registration script."
