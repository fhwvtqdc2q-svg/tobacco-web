# ============================================================
# upload-report-to-supabase.ps1   (ASCII only - encoding safe)
# Reads the Ameen sales-schema discovery report and uploads it
# to the Supabase table public.schema_probe so it can be read
# back from the dev machine. Read-only on Ameen; only writes one
# row to Supabase. Run on the Ameen laptop after the discovery.
# ============================================================
param(
    [string]$ReportPath,
    [string]$Label = "ameen-sales-schema"
)

$ErrorActionPreference = "Stop"

# --- locate the report file if not provided ---
if (-not $ReportPath) {
    $candidates = @(
        "C:\Users\DELL\Desktop\OZK-TOBACCO-web-platform\tools\logs\ameen-sales-schema-report.txt",
        (Join-Path $env:TEMP "logs\ameen-sales-schema-report.txt"),
        (Join-Path $PSScriptRoot "logs\ameen-sales-schema-report.txt")
    )
    $ReportPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ReportPath -or -not (Test-Path $ReportPath)) {
    throw "Report file not found. Pass it with -ReportPath 'C:\path\to\ameen-sales-schema-report.txt'"
}
Write-Host ("Report file: " + $ReportPath)

# --- load tools\.env if present (some env vars live there) ---
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}

function Need($n) {
    $v = [Environment]::GetEnvironmentVariable($n, "User")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Process") }
    if (-not $v) { throw "Missing environment variable: $n" }
    return $v
}

$url   = (Need "TOBACCO_SUPABASE_URL").TrimEnd("/")
$key   = Need "TOBACCO_SUPABASE_PUBLIC_KEY"
$email = Need "TOBACCO_SYNC_EMAIL"
$pass  = Need "TOBACCO_SYNC_PASSWORD"

# --- authenticate (password grant) ---
$authBody = @{ email = $email; password = $pass } | ConvertTo-Json
$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $key; Accept = "application/json" } `
    -ContentType "application/json; charset=utf-8" -Body $authBody
$token = $auth.access_token
if (-not $token) { throw "Authentication failed (no access token)." }

# --- read report and POST one row ---
$content = [System.IO.File]::ReadAllText($ReportPath, [System.Text.Encoding]::UTF8)
$payload = @{ label = $Label; content = $content } | ConvertTo-Json -Depth 3

$headers = @{
    apikey          = $key
    Authorization   = "Bearer $token"
    "Accept-Profile"  = "public"
    "Content-Profile" = "public"
    Prefer          = "return=minimal"
}
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/schema_probe" `
    -Headers $headers -ContentType "application/json; charset=utf-8" -Body $payload | Out-Null

Write-Host ("UPLOAD OK - uploaded " + $content.Length + " characters to Supabase (label=" + $Label + ").")
Write-Host "Tell the assistant: uploaded."
