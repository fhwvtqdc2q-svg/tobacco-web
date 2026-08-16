param(
    [ValidateRange(2, 60)][int]$PollSeconds = 3,
    [ValidateRange(1, 100)][double]$LargeDiscountPercent = 10,
    [ValidateRange(1.5, 20)][double]$UnusualQtyMultiplier = 3,
    [ValidateRange(5, 100)][double]$UnusualPricePercent = 25,
    [switch]$CheckLatestRisk,
    [switch]$TestLatest,
    [switch]$TestLatestPayment,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$StateFile = "$PSScriptRoot\state\customer-invoice-watcher.json",
    [string]$LogFile = "$PSScriptRoot\logs\customer-invoice-watcher.log"
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    $dir = Split-Path $LogFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Get-Setting([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, "User") }
    return $value
}

function Save-State($SeenInvoices, $SeenPayments) {
    $dir = Split-Path $StateFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $payload = @{
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        seenInvoiceGuids = @($SeenInvoices.Keys)
        seenPaymentGuids = @($SeenPayments.Keys)
    }
    $temp = "$StateFile.tmp"
    $payload | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $StateFile -Force
}

function Read-State {
    $result = @{ invoices=@{}; payments=@{} }
    if (Test-Path $StateFile) {
        try {
            $saved = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
            foreach ($guid in @($saved.seenInvoiceGuids)) { if ($guid) { $result.invoices[[string]$guid] = $true } }
            foreach ($guid in @($saved.seenPaymentGuids)) { if ($guid) { $result.payments[[string]$guid] = $true } }
        } catch { Write-Log "WARN state reset: $($_.Exception.Message)" }
    }
    return $result
}

function Open-Connection {
    $conn = New-Object System.Data.SqlClient.SqlConnection($script:ConnectionString)
    $conn.Open()
    return $conn
}

function Get-PostedSalesHeaders([switch]$LatestOnly) {
    $conn = Open-Connection
    try {
        $cmd = $conn.CreateCommand()
        $top = if ($LatestOnly) { "TOP 1" } else { "" }
        $cmd.CommandText = @"
SELECT $top LOWER(CONVERT(varchar(36),u.GUID)) AS guid,
       CONVERT(varchar(19),u.CreateDate,120) AS created_at
FROM bu000 u
JOIN bt000 bt ON bt.GUID=u.TypeGUID
WHERE bt.BillType=1 AND u.IsPosted=1
  AND NULLIF(LTRIM(RTRIM(COALESCE(u.Cust_Name,''))), '') IS NOT NULL
  -- إشعارات فواتير الجملة محصورة بالدولار الأمريكي؛ فواتير المفرق السورية لا تدخل.
  AND u.CurrencyGUID=CONVERT(uniqueidentifier,'c06860b8-c1ed-42e8-bf94-a630aae129ac')
  AND u.CreateDate >= DATEADD(day,-2,GETDATE())
ORDER BY u.CreateDate DESC, u.GUID
"@
        $rows = New-Object System.Collections.Generic.List[object]
        $reader = $cmd.ExecuteReader()
        while ($reader.Read()) { $rows.Add(@{ guid=[string]$reader["guid"]; createdAt=[string]$reader["created_at"] }) }
        $reader.Close()
        return $rows.ToArray()
    } finally { $conn.Close() }
}

function Get-Invoice([string]$Guid) {
    $conn = Open-Connection
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = @"
SELECT TOP 1 CONVERT(nvarchar(200),u.Cust_Name) AS customer,
       CONVERT(nvarchar(80),u.Number) AS bill_number,
       CONVERT(varchar(10),u.Date,120) AS bill_date,
       CAST(COALESCE(u.Total,0) AS float) AS bill_total,
       CAST(COALESCE(u.TotalDisc,0) AS float) AS discount_total
FROM bu000 u WHERE u.GUID=CONVERT(uniqueidentifier,@guid) AND u.IsPosted=1;

SELECT CONVERT(nvarchar(250),m.Name) AS material,
       CAST(CASE WHEN COALESCE(m.Unit2Fact,0)>0 THEN COALESCE(bi.Qty,0)/m.Unit2Fact ELSE COALESCE(bi.Qty,0) END AS float) AS qty,
       CONVERT(nvarchar(50),CASE WHEN COALESCE(m.Unit2Fact,0)>0 THEN m.Unit2 ELSE m.Unity END) AS unit_name,
       CAST(COALESCE(bi.Qty,0) * CASE WHEN bi.Unity=2 AND COALESCE(m.Unit2Fact,0)>0
            THEN COALESCE(bi.Price,0)/m.Unit2Fact ELSE COALESCE(bi.Price,0) END AS float) AS line_total,
       CAST(COALESCE(bi.Qty,0) AS float) AS raw_qty,
       CAST(CASE WHEN bi.Unity=2 AND COALESCE(m.Unit2Fact,0)>0
            THEN COALESCE(bi.Price,0)/m.Unit2Fact ELSE COALESCE(bi.Price,0) END AS float) AS unit_price,
       CAST(COALESCE(bi.UnitCostPrice,0) AS float) AS unit_cost,
       CAST(COALESCE(hist.avg_qty,0) AS float) AS avg_qty,
       CAST(COALESCE(hist.avg_price,0) AS float) AS avg_price
FROM bi000 bi JOIN mt000 m ON m.GUID=bi.MatGUID
OUTER APPLY (
  SELECT AVG(CAST(h.Qty AS float)) AS avg_qty,AVG(CAST(h.normalized_price AS float)) AS avg_price
  FROM (
    SELECT TOP 20 pbi.Qty,
      CASE WHEN pbi.Unity=2 AND COALESCE(pm.Unit2Fact,0)>0
           THEN pbi.Price/pm.Unit2Fact ELSE pbi.Price END AS normalized_price
    FROM bi000 pbi JOIN bu000 pu ON pu.GUID=pbi.ParentGUID JOIN bt000 pbt ON pbt.GUID=pu.TypeGUID
      JOIN mt000 pm ON pm.GUID=pbi.MatGUID
    WHERE pbi.MatGUID=bi.MatGUID AND pu.GUID<>CONVERT(uniqueidentifier,@guid)
      AND pbt.BillType=1 AND pu.IsPosted=1
      AND pu.CurrencyGUID=CONVERT(uniqueidentifier,'c06860b8-c1ed-42e8-bf94-a630aae129ac')
    ORDER BY pu.CreateDate DESC
  ) h
) hist
WHERE bi.ParentGUID=CONVERT(uniqueidentifier,@guid)
ORDER BY bi.GUID;
"@
        $cmd.Parameters.AddWithValue("@guid", $Guid) | Out-Null
        $reader = $cmd.ExecuteReader()
        if (-not $reader.Read()) { return $null }
        $invoice = @{
            guid=$Guid; customer=[string]$reader["customer"]; number=[string]$reader["bill_number"]
            date=[string]$reader["bill_date"]; total=[double]$reader["bill_total"]; discount=[double]$reader["discount_total"]
            lines=New-Object System.Collections.Generic.List[object]
        }
        $reader.NextResult() | Out-Null
        while ($reader.Read()) {
            $invoice.lines.Add(@{
                material=[string]$reader["material"]; qty=[double]$reader["qty"]; unit=[string]$reader["unit_name"]; total=[double]$reader["line_total"]
                rawQty=[double]$reader["raw_qty"]; price=[double]$reader["unit_price"]; cost=[double]$reader["unit_cost"]
                avgQty=[double]$reader["avg_qty"]; avgPrice=[double]$reader["avg_price"]
            })
        }
        $reader.Close()
        return $invoice
    } finally { $conn.Close() }
}

function Get-CashPayments([switch]$LatestOnly) {
    $conn = Open-Connection
    try {
        $cmd = $conn.CreateCommand()
        $top = if ($LatestOnly) { "TOP 1" } else { "" }
        $cmd.CommandText = @"
SELECT $top LOWER(CONVERT(varchar(36),en.GUID)) AS guid,
       CONVERT(varchar(19),en.Date,120) AS payment_date,
       CONVERT(nvarchar(200),c.CustomerName) AS customer,
       CAST(en.Credit AS float) AS amount,
       CONVERT(nvarchar(80),en.Number) AS number,
       CONVERT(nvarchar(200),LEFT(COALESCE(en.Notes,''),120)) AS notes,
       CONVERT(nvarchar(100),cash.Name) AS cashbox
FROM en000 en
JOIN cu000 c ON c.AccountGUID=en.AccountGUID
JOIN ac000 cash ON cash.GUID=en.ContraAccGUID
LEFT JOIN ac000 acc ON acc.GUID=c.AccountGUID
LEFT JOIN ac000 acp ON acp.GUID=acc.ParentGUID
WHERE en.Credit>0 AND COALESCE(en.Type,0)=0
  AND c.CustomerName IS NOT NULL AND LTRIM(RTRIM(c.CustomerName))<>''
  AND (acp.Name IS NULL OR acp.Name<>N'الموردون')
  AND en.ContraAccGUID IN (
    'aacb5a67-6a19-45e4-b0b3-9a0b61a5790f','18d12068-7b7a-45bc-855b-5a0dec084f9d',
    '007fb589-7fb3-4e9e-b289-6cfc153dacb5','b3b2ee0f-0099-4390-8920-f1099c553658')
  AND en.Date>=DATEADD(day,-2,CONVERT(date,GETDATE()))
ORDER BY en.Date DESC,en.Number DESC,en.GUID
"@
        $rows = New-Object System.Collections.Generic.List[object]
        $reader = $cmd.ExecuteReader()
        while ($reader.Read()) {
            $rows.Add(@{
                guid=[string]$reader["guid"]; date=[string]$reader["payment_date"]
                customer=[string]$reader["customer"]; amount=[double]$reader["amount"]
                number=[string]$reader["number"]; notes=[string]$reader["notes"]; cashbox=[string]$reader["cashbox"]
            })
        }
        $reader.Close(); return $rows.ToArray()
    } finally { $conn.Close() }
}

function Format-Amount([double]$Value) { return $Value.ToString("N2",[Globalization.CultureInfo]::InvariantCulture) }

function Send-Invoice($Invoice, [switch]$IsTest) {
    if (-not $Invoice -or -not $Invoice.lines.Count) { return $false }
    $prefix = if ($IsTest) { "🧪 اختبار مراقب الفواتير" } else { "🧾 تم تنزيل فاتورة جملة جديدة من الأمين" }
    $header = "$prefix`nالزبون: $($Invoice.customer)`nرقم الفاتورة: $($Invoice.number)`nالتاريخ: $($Invoice.date)`n`nالأصناف:"
    $footer = "`n💵 القيمة الكلية: `$ $(Format-Amount $Invoice.total)"
    $chunks = New-Object System.Collections.Generic.List[string]
    $current = $header
    foreach ($line in $Invoice.lines) {
        $text = "• $($line.material) — $(Format-Amount $line.qty) $($line.unit) — `$ $(Format-Amount $line.total)"
        if (($current.Length + $text.Length + $footer.Length + 2) -gt 3600) { $chunks.Add($current); $current="🧾 تابع فاتورة $($Invoice.number)`n$text" }
        else { $current += "`n$text" }
    }
    $current += $footer; $chunks.Add($current)
    for ($i=0; $i -lt $chunks.Count; $i++) {
        $keySuffix = if ($IsTest) { (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss") } else { "live" }
        & "$PSScriptRoot\send-telegram-notification.ps1" -Message $chunks[$i] -EventType "ameen_sales_invoice" -DedupeKey "ameen-sales-invoice:$($Invoice.guid):${keySuffix}:$i" -DedupeMinutes 5256000 -EnvFile $EnvFile
        if ($LASTEXITCODE -ne 0) { Write-Log "WARN telegram queue process failed"; return $false }
    }
    return $true
}

function Get-InvoiceRiskIssues($Invoice) {
    $issues = New-Object System.Collections.Generic.List[string]
    $grossBeforeDiscount = [double]$Invoice.total + [double]$Invoice.discount
    if ($grossBeforeDiscount -gt 0) {
        $discountPercent = 100 * [double]$Invoice.discount / $grossBeforeDiscount
        if ($discountPercent -ge $LargeDiscountPercent) {
            $issues.Add("• خصم كبير: $([math]::Round($discountPercent,1))% (`$ $(Format-Amount $Invoice.discount))")
        }
    }
    foreach ($line in $Invoice.lines) {
        if ($line.cost -gt 0 -and $line.price -gt 0 -and $line.price -lt $line.cost) {
            $issues.Add("• تحت التكلفة: $($line.material) — البيع `$ $(Format-Amount $line.price) / التكلفة `$ $(Format-Amount $line.cost)")
        }
        if ($line.avgQty -gt 0 -and $line.rawQty -ge $line.avgQty * $UnusualQtyMultiplier) {
            $issues.Add("• كمية غير معتادة: $($line.material) — $([math]::Round($line.rawQty/$line.avgQty,1))× المعتاد")
        }
        if ($line.avgPrice -gt 0 -and $line.price -gt 0) {
            $priceDiff = 100 * [math]::Abs($line.price-$line.avgPrice) / $line.avgPrice
            if ($priceDiff -ge $UnusualPricePercent) {
                $issues.Add("• سعر غير معتاد: $($line.material) — فرق $([math]::Round($priceDiff,1))% عن المتوسط")
            }
        }
    }
    return $issues
}

function Send-InvoiceRiskAlert($Invoice) {
    $issues = @(Get-InvoiceRiskIssues $Invoice)
    if (-not $issues.Count) { return $true }
    $message = "⚠️ تنبيه فاتورة غير طبيعية`nالزبون: $($Invoice.customer)`nرقم الفاتورة: $($Invoice.number)`nالقيمة: `$ $(Format-Amount $Invoice.total)`n`n" + ($issues -join "`n")
    & "$PSScriptRoot\send-telegram-notification.ps1" -Message $message -EventType "ameen_invoice_risk" -DedupeKey "ameen-invoice-risk:$($Invoice.guid)" -DedupeMinutes 5256000 -EnvFile $EnvFile
    return ($LASTEXITCODE -eq 0)
}

function Send-Payment($Payment, [switch]$IsTest) {
    $prefix = if ($IsTest) { "🧪 اختبار إشعار الدفعة النقدية" } else { "💵 تم دفع دفعة نقدية جديدة" }
    $message = "$prefix`nالزبون: $($Payment.customer)`nالمبلغ: `$ $(Format-Amount $Payment.amount)`nالصندوق: $($Payment.cashbox)`nرقم السند: $($Payment.number)"
    if ($Payment.notes) { $message += "`nملاحظة: $($Payment.notes)" }
    $suffix = if ($IsTest) { (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss") } else { "live" }
    & "$PSScriptRoot\send-telegram-notification.ps1" -Message $message -EventType "ameen_customer_cash_payment" -DedupeKey "ameen-cash-payment:$($Payment.guid):$suffix" -DedupeMinutes 5256000 -EnvFile $EnvFile
    if ($LASTEXITCODE -ne 0) { Write-Log "WARN payment telegram queue process failed"; return $false }
    return $true
}

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts=$_.Split('=',2); [Environment]::SetEnvironmentVariable($parts[0].Trim(),$parts[1].Trim())
    }
}
$script:ConnectionString = Get-Setting "AMEEN_SQL_WRITE_CONNECTION_STRING"
if (-not $script:ConnectionString) { $script:ConnectionString = Get-Setting "AMEEN_SQL_CONNECTION_STRING" }
if (-not $script:ConnectionString) { throw "AMEEN SQL connection string is not configured" }
Add-Type -AssemblyName System.Data

if ($TestLatest) {
    $latest = @(Get-PostedSalesHeaders -LatestOnly) | Select-Object -First 1
    if (-not $latest) { throw "No posted named sales invoice found in the last two days" }
    $invoice = Get-Invoice $latest.guid
    if (-not (Send-Invoice $invoice -IsTest)) { throw "Test invoice notification failed" }
    Write-Log "TEST OK invoice=$($invoice.number) lines=$($invoice.lines.Count)"
    exit 0
}

if ($CheckLatestRisk) {
    $latest = @(Get-PostedSalesHeaders -LatestOnly) | Select-Object -First 1
    if (-not $latest) { throw "No posted named USD sales invoice found in the last two days" }
    $invoice = Get-Invoice $latest.guid
    if (-not $invoice -or -not $invoice.lines.Count) { throw "Latest invoice could not be read" }
    $issues = @(Get-InvoiceRiskIssues $invoice)
    Write-Log "RISK CHECK OK invoice=$($invoice.number) lines=$($invoice.lines.Count) issues=$($issues.Count) (no Telegram message sent)"
    $issues | ForEach-Object { Write-Host $_ }
    exit 0
}

if ($TestLatestPayment) {
    $payment = @(Get-CashPayments -LatestOnly) | Select-Object -First 1
    if (-not $payment) { throw "No customer cash payment found in the last two days" }
    if (-not (Send-Payment $payment -IsTest)) { throw "Test payment notification failed" }
    Write-Log "PAYMENT TEST OK receipt=$($payment.number)"
    exit 0
}

$mutex = New-Object Threading.Mutex($false,"Global\OZKCustomerInvoiceWatcher")
if (-not $mutex.WaitOne(0)) { Write-Log "Watcher already running"; exit 0 }
try {
    $state = Read-State
    $seen = $state.invoices
    $seenPayments = $state.payments
    if (-not (Test-Path $StateFile)) {
        foreach ($row in @(Get-PostedSalesHeaders)) { $seen[$row.guid]=$true }
        foreach ($payment in @(Get-CashPayments)) { $seenPayments[$payment.guid]=$true }
        Save-State $seen $seenPayments
        Write-Log "Baseline initialized with $($seen.Count) invoices and $($seenPayments.Count) cash payments"
    }
    Write-Log "Watcher started (continuous, ${PollSeconds}s detection)"
    while ($true) {
        try {
            foreach ($row in @((Get-PostedSalesHeaders) | Sort-Object createdAt)) {
                if ($seen.ContainsKey($row.guid)) { continue }
                Start-Sleep -Seconds 2
                $invoice = Get-Invoice $row.guid
                if (-not $invoice -or -not $invoice.lines.Count) { continue }
                & "$PSScriptRoot\push-customer-invoices.ps1" -EnvFile $EnvFile -LogFile "$PSScriptRoot\logs\customer-invoices-push.log"
                if ($LASTEXITCODE -ne 0) { Write-Log "WARN web sync failed invoice=$($invoice.number)"; continue }
                if (Send-Invoice $invoice) {
                    Send-InvoiceRiskAlert $invoice | Out-Null
                    $seen[$row.guid]=$true; Save-State $seen $seenPayments; Write-Log "NOTIFIED invoice=$($invoice.number) lines=$($invoice.lines.Count)"
                }
            }
            foreach ($payment in @((Get-CashPayments) | Sort-Object date)) {
                if ($seenPayments.ContainsKey($payment.guid)) { continue }
                if (Send-Payment $payment) {
                    $seenPayments[$payment.guid]=$true
                    Save-State $seen $seenPayments
                    Write-Log "NOTIFIED payment=$($payment.number) amount=$($payment.amount)"
                }
            }
        } catch { Write-Log "WARN loop: $($_.Exception.Message)" }
        Start-Sleep -Seconds $PollSeconds
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
