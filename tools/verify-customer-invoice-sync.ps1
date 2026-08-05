#requires -Version 5.1
# مطابقة قراءة فقط بين فواتير الزبائن في Ameen وأحدث تقرير Supabase بالـGUID.
# لا يطبع أسماء الزبائن أو تفاصيل الفواتير، ولا يكتب إلى أي قاعدة بيانات.
param(
    [Parameter(Mandatory = $true)]
    [datetime]$FromDate,

    [Parameter(Mandatory = $true)]
    [datetime]$ToDateExclusive,

    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

if ($ToDateExclusive -le $FromDate) {
    throw "ToDateExclusive يجب أن يكون بعد FromDate."
}

if ($EnvFile) {
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        throw "ملف البيئة غير موجود: $EnvFile"
    }
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

$connectionString = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connectionString) { throw "AMEEN_SQL_CONNECTION_STRING غير موجود." }
if (-not $supabaseUrl -or -not $apiKey -or -not $syncEmail -or -not $syncPassword) {
    throw "إعدادات Supabase أو حساب المزامنة ناقصة."
}
$supabaseUrl = $supabaseUrl.TrimEnd("/")

Add-Type -AssemblyName "System.Data"
$connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
$ameenRows = New-Object System.Collections.Generic.List[object]
try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 120
    $command.CommandText = @"
SELECT LOWER(CONVERT(varchar(36), u.GUID)) AS invoice_guid,
       CONVERT(varchar(10), u.Date, 23) AS invoice_date,
       bt.Name AS type_name,
       bt.BillType AS bill_class
FROM dbo.bu000 u
JOIN dbo.bt000 bt ON bt.GUID = u.TypeGUID
WHERE bt.BillType IN (1, 3)
  AND u.Date >= @fromDate
  AND u.Date < @toDate
  AND LTRIM(RTRIM(COALESCE(u.Cust_Name, ''))) <> ''
"@
    [void]$command.Parameters.Add("@fromDate", [Data.SqlDbType]::DateTime)
    [void]$command.Parameters.Add("@toDate", [Data.SqlDbType]::DateTime)
    $command.Parameters["@fromDate"].Value = $FromDate
    $command.Parameters["@toDate"].Value = $ToDateExclusive
    $reader = $command.ExecuteReader()
    while ($reader.Read()) {
        $ameenRows.Add([pscustomobject]@{
            guid  = [string]$reader["invoice_guid"]
            date  = [string]$reader["invoice_date"]
            type  = [string]$reader["type_name"]
            class = [int]$reader["bill_class"]
        })
    }
    $reader.Close()
} finally {
    if ($connection.State -ne [Data.ConnectionState]::Closed) { $connection.Close() }
}

$loginBody = @{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress
$session = Invoke-RestMethod `
    -Method Post `
    -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $apiKey } `
    -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($loginBody))

$headers = @{
    apikey           = $apiKey
    Authorization    = "Bearer $($session.access_token)"
    "Accept-Profile" = "public"
}
$uri = "$supabaseUrl/rest/v1/inventory_reports?source=eq.ameen_customer_invoices&select=summary,items,created_at&order=created_at.desc&limit=1"
$reports = @(Invoke-RestMethod -Method Get -Uri $uri -Headers $headers)
if ($reports.Count -eq 0) { throw "لا يوجد تقرير ameen_customer_invoices في Supabase." }
$report = $reports[0]

$supabaseRows = New-Object System.Collections.Generic.List[object]
foreach ($customer in @($report.items)) {
    foreach ($invoice in @($customer.invoices)) {
        $invoiceDate = [datetime]$invoice.date
        if ($invoiceDate -ge $FromDate -and $invoiceDate -lt $ToDateExclusive) {
            $supabaseRows.Add([pscustomobject]@{
                guid     = ([string]$invoice.guid).ToLowerInvariant()
                date     = [string]$invoice.date
                isReturn = [bool]$invoice.isReturn
            })
        }
    }
}

$ameenGuids = New-Object "System.Collections.Generic.HashSet[string]"
$supabaseGuids = New-Object "System.Collections.Generic.HashSet[string]"
foreach ($row in $ameenRows) { [void]$ameenGuids.Add($row.guid) }
foreach ($row in $supabaseRows) { [void]$supabaseGuids.Add($row.guid) }

$missing = @($ameenGuids | Where-Object { -not $supabaseGuids.Contains($_) })
$extra = @($supabaseGuids | Where-Object { -not $ameenGuids.Contains($_) })
$duplicateGroups = @($supabaseRows | Group-Object guid | Where-Object { $_.Count -gt 1 })

$result = [pscustomobject]@{
    fromDate               = $FromDate.ToString("yyyy-MM-dd")
    toDateExclusive        = $ToDateExclusive.ToString("yyyy-MM-dd")
    reportCreatedAt        = $report.created_at
    ameenInvoices          = $ameenRows.Count
    supabaseInvoices       = $supabaseRows.Count
    ameenUniqueGuids       = $ameenGuids.Count
    supabaseUniqueGuids    = $supabaseGuids.Count
    missingInSupabase      = $missing.Count
    extraInSupabase        = $extra.Count
    duplicateGuidsInReport = $duplicateGroups.Count
    supabaseSales          = @($supabaseRows | Where-Object { -not $_.isReturn }).Count
    supabaseReturns        = @($supabaseRows | Where-Object { $_.isReturn }).Count
    matches                = ($missing.Count -eq 0 -and $extra.Count -eq 0 -and $duplicateGroups.Count -eq 0)
}

$result | Format-List
Write-Host "Ameen counts by invoice type:" -ForegroundColor Cyan
$ameenRows | Group-Object type | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ Type = $_.Name; Count = $_.Count }
} | Format-Table -AutoSize

if (-not $result.matches) { exit 2 }
exit 0
