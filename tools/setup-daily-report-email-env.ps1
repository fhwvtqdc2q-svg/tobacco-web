$ErrorActionPreference = "Stop"

function Set-UserAndProcessEnv($Name, $Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function Read-Default($Prompt, $Default) {
  $value = Read-Host "$Prompt [$Default]"
  if (-not $value) {
    return $Default
  }
  return $value
}

$to = Read-Default "Daily report recipient email" "ozk.kh@outlook.com"
$server = Read-Default "SMTP server" "smtp.office365.com"
$port = Read-Default "SMTP port" "587"
$from = Read-Default "SMTP from email" $to
$user = Read-Default "SMTP username" $from
$securePassword = Read-Host "SMTP password or app password" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($passwordPtr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
}

if (-not $password -or $password.Length -lt 8) {
  throw "SMTP password looks too short. Use the real SMTP password or an app password."
}

Set-UserAndProcessEnv -Name "TOBACCO_DAILY_REPORT_TO" -Value $to
Set-UserAndProcessEnv -Name "TOBACCO_SMTP_SERVER" -Value $server
Set-UserAndProcessEnv -Name "TOBACCO_SMTP_PORT" -Value $port
Set-UserAndProcessEnv -Name "TOBACCO_SMTP_FROM" -Value $from
Set-UserAndProcessEnv -Name "TOBACCO_SMTP_USER" -Value $user
Set-UserAndProcessEnv -Name "TOBACCO_SMTP_PASSWORD" -Value $password
Set-UserAndProcessEnv -Name "TOBACCO_SMTP_SSL" -Value "true"

Write-Host "Daily report email settings were saved for this Windows user."
Write-Host "Do not send or paste any password in chat."
