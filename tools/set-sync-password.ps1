# ============================================================
# set-sync-password.ps1
# Asks for the correct password of the Supabase sync account
# (ozkkhalouf@gmail.com), tests it, and only saves it if it works.
# ============================================================
# Usage: .\tools\set-sync-password.ps1
# ============================================================

$envFile = "$PSScriptRoot\.env"
$email = "ozkkhalouf@gmail.com"
$supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co"
$apiKey = "sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH"

Write-Host "=== Setting password for sync account: $email ===" -ForegroundColor Cyan
Write-Host ""

$securePassword = Read-Host "Password for $email (will not be shown as you type)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    Write-Host "Error: empty password, nothing saved." -ForegroundColor Red
    exit 1
}

Write-Host "Testing login against Supabase..." -ForegroundColor Cyan
$headers = @{ apikey = $apiKey; "Content-Type" = "application/json" }
$body = @{ email = $email; password = $plainPassword } | ConvertTo-Json

try {
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" -Headers $headers -Body $body -ErrorAction Stop
    if (-not $session.access_token) { throw "No access token returned." }
} catch {
    Write-Host ""
    Write-Host "FAILED: login did not work with this password." -ForegroundColor Red
    Write-Host "Nothing was saved. Try again with the correct password," -ForegroundColor Yellow
    Write-Host "or reset it from the Supabase dashboard (Authentication > Users)." -ForegroundColor Yellow
    exit 1
}

Write-Host "Login OK." -ForegroundColor Green

$lines = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
$lines = $lines | Where-Object { $_ -notmatch '^\s*TOBACCO_SYNC_PASSWORD\s*=' }
$lines += "TOBACCO_SYNC_PASSWORD=$plainPassword"
Set-Content -Path $envFile -Value $lines -Encoding UTF8

[Environment]::SetEnvironmentVariable("TOBACCO_SYNC_PASSWORD", $plainPassword, "User")
[Environment]::SetEnvironmentVariable("TOBACCO_SYNC_PASSWORD", $plainPassword, "Process")

Write-Host ""
Write-Host "Saved successfully to tools\.env and to your Windows user environment." -ForegroundColor Green
