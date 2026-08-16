# ============================================================
# OZK TOBACCO — مزامنة أرصدة دليل حسابات الأمين (قراءة فقط)
# يقرأ ac000 من AmnDb002 ويرفع لقطة عرض إلى الجدول المالي المحمي.
# لا توجد أي جملة كتابة على SQL Server.
# ============================================================
param(
    [switch]$NoUpload,
    [int]$MinimumIntervalMinutes = 0,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\account-balances-push.log",
    [string]$StateFile = "$PSScriptRoot\logs\account-balances-push.last-success"
)

$ErrorActionPreference = "Stop"

if (Test-Path -LiteralPath $EnvFile) {
    Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
}

function Get-Setting([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, "User") }
    return $value
}

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    $dir = Split-Path -Parent $LogFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

if (-not $NoUpload -and $MinimumIntervalMinutes -gt 0 -and (Test-Path -LiteralPath $StateFile)) {
    $lastSuccess = (Get-Item -LiteralPath $StateFile).LastWriteTime
    if ($lastSuccess -gt (Get-Date).AddMinutes(-$MinimumIntervalMinutes)) {
        Write-Log "SKIP - last successful account balance push is still fresh."
        exit 0
    }
}

$connectionString = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
if (-not $connectionString) { throw "AMEEN_SQL_CONNECTION_STRING is required (read-only account)." }

$sql = @"
SELECT
  CONVERT(nvarchar(36), a.GUID) AS account_guid,
  CONVERT(nvarchar(80), a.Code) AS account_code,
  a.Name AS account_name,
  CONVERT(nvarchar(36), a.ParentGUID) AS parent_guid,
  p.Name AS parent_name,
  CAST(COALESCE(a.Debit, 0) AS decimal(19, 4)) AS debit,
  CAST(COALESCE(a.Credit, 0) AS decimal(19, 4)) AS credit,
  CAST(COALESCE(a.Debit, 0) - COALESCE(a.Credit, 0) AS decimal(19, 4)) AS balance
FROM dbo.ac000 a
LEFT JOIN dbo.ac000 p ON p.GUID = a.ParentGUID
WHERE a.Name IS NOT NULL
  AND LTRIM(RTRIM(a.Name)) <> ''
  AND NOT EXISTS (SELECT 1 FROM dbo.ac000 child WHERE child.ParentGUID = a.GUID)
ORDER BY a.Code, a.Name;
"@

Add-Type -AssemblyName "System.Data"
$connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
$accounts = New-Object System.Collections.Generic.List[object]
try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandText = $sql
    $command.CommandTimeout = 120
    $reader = $command.ExecuteReader()
    while ($reader.Read()) {
        $accounts.Add([ordered]@{
            accountGuid = [string]$reader["account_guid"]
            accountCode = [string]$reader["account_code"]
            accountName = [string]$reader["account_name"]
            parentGuid = [string]$reader["parent_guid"]
            parentName = [string]$reader["parent_name"]
            debit = [math]::Round([double]$reader["debit"], 4)
            credit = [math]::Round([double]$reader["credit"], 4)
            balance = [math]::Round([double]$reader["balance"], 4)
            currency = "USD"
        })
    }
    $reader.Close()
} finally {
    $connection.Close()
}

$nonZero = @($accounts | Where-Object { [math]::Abs([double]$_.balance) -gt 0.0001 })
$totalDebitBalances = 0.0
$totalCreditBalances = 0.0
foreach ($account in $nonZero) {
    $accountBalance = [double]$account["balance"]
    if ($accountBalance -gt 0) { $totalDebitBalances += $accountBalance }
    elseif ($accountBalance -lt 0) { $totalCreditBalances += [math]::Abs($accountBalance) }
}
$summary = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    sourceDatabase = "AmnDb002"
    accountingBasis = "ac000 Debit - Credit; base currency USD; leaf accounts only"
    readOnly = $true
    accountCount = $accounts.Count
    nonZeroAccountCount = $nonZero.Count
    totalDebitBalances = [math]::Round($totalDebitBalances, 4)
    totalCreditBalances = [math]::Round($totalCreditBalances, 4)
}

Write-Log ("Ameen account balances read successfully: {0} leaf accounts, {1} non-zero." -f $accounts.Count, $nonZero.Count)
if ($NoUpload) {
    Write-Log "READ-ONLY CHECK OK - nothing uploaded to Supabase."
    return
}

$url = Get-Setting "TOBACCO_SUPABASE_URL"
$key = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
$email = Get-Setting "TOBACCO_SYNC_EMAIL"
$password = Get-Setting "TOBACCO_SYNC_PASSWORD"
if (-not $url -or -not $key -or -not $email -or -not $password) { throw "Supabase sync settings are incomplete." }
$url = $url.TrimEnd("/")

$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{ apikey = $key; Accept = "application/json" } -ContentType "application/json; charset=utf-8" -Body (@{ email = $email; password = $password } | ConvertTo-Json)
$body = @{
    report_date = (Get-Date -Format "yyyy-MM-dd")
    summary = $summary
    items = $accounts
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "$url/rest/v1/ameen_account_balance_reports" -Headers @{
    apikey = $key
    Authorization = "Bearer $($auth.access_token)"
    "Accept-Profile" = "public"
    "Content-Profile" = "public"
    Prefer = "return=minimal"
} -ContentType "application/json; charset=utf-8" -Body $body | Out-Null

$stateDir = Split-Path -Parent $StateFile
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir | Out-Null }
Set-Content -LiteralPath $StateFile -Value (Get-Date).ToUniversalTime().ToString("o") -Encoding ASCII
Write-Log "PUSH OK - account balance snapshot uploaded to Supabase."
