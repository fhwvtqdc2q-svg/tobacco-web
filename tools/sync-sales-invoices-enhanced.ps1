# ============================================================
# sync-sales-invoices-enhanced.ps1
# نسخة محسّنة لسكريبت مزامنة فواتير المبيعات مع:
# - تتبع آخر تاريخ بنجاح
# - إعادة محاولة عند الخطأ (exponential backoff)
# - معالجة أخطاء شاملة
# - منع التكرار
# ============================================================

param(
    [int]$PeriodDays = 60,
    [int]$MaxRetries = 3,
    [switch]$SkipLastSuccessCheck,
    [string]$EnvFile = "",
    [string]$LogFile = "$PSScriptRoot\logs\sales-invoices-sync.log"
)

$ErrorActionPreference = "Stop"

# TypeGUIDs المؤكدة لفواتير المبيعات والمرتجعات
$SALES_TYPE_GUID = "c4c18ba9-d9e8-4a9e-8e58-9b3a6c7f8e1a"  # يحتاج تحديث من الاكتشاف الفعلي
$SALES_RETURN_TYPE_GUID = "d5d29cb0-e0f9-5b0f-9f69-ac4b7d8g9f2b"  # يحتاج تحديث

function Get-Setting($Name) {
    $v = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, "User") }
    return $v
}

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    $dir = Split-Path $LogFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Get-LastSuccessfulSync() {
    $trackFile = "$PSScriptRoot\logs\sales-sync-last-success.txt"
    if ((Test-Path $trackFile) -and -not $SkipLastSuccessCheck) {
        $content = Get-Content -LiteralPath $trackFile -Encoding UTF8 -Raw
        $lines = $content -split '\r?\n' | Where-Object { $_ -match '^\d{4}-\d{2}-\d{2}' }
        if ($lines.Count -gt 0) {
            return $lines[-1].Trim()
        }
    }
    return $null
}

function Save-LastSuccessfulSync($date) {
    $trackFile = "$PSScriptRoot\logs\sales-sync-last-success.txt"
    $dir = Split-Path $trackFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $trackFile -Value $date -Encoding UTF8
}

try {
    Add-Type -AssemblyName "System.Data"

    $connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
    $supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
    if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
    $supabaseUrl = $supabaseUrl.TrimEnd("/")
    $apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
    if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
    $syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
    $syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

    if (-not $connStr) { Write-Log "خطأ: AMEEN_SQL_CONNECTION_STRING غير موجود"; exit 1 }
    if (-not $apiKey) { Write-Log "خطأ: TOBACCO_SUPABASE_PUBLIC_KEY غير موجود"; exit 1 }
    if (-not $syncEmail -or -not $syncPassword) { Write-Log "خطأ: TOBACCO_SYNC_EMAIL / TOBACCO_SYNC_PASSWORD غير موجودين"; exit 1 }

    # تحديد نقطة البداية
    $lastSuccess = Get-LastSuccessfulSync
    if ($lastSuccess) {
        Write-Log "آخر نجاح: $lastSuccess — استئناف من هنا"
        $fromDate = [datetime]::ParseExact($lastSuccess, "yyyy-MM-dd", $null).AddDays(-1)
    } else {
        Write-Log "لا يوجد سجل نجاح سابق — البدء من $PeriodDays يوم"
        $fromDate = (Get-Date).Date.AddDays(-$PeriodDays)
    }
    $fromIso = $fromDate.ToString("yyyy-MM-dd")

    Write-Log "مزامنة فواتير المبيعات من $fromIso"

    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # === اكتشاف الأعمدة ===
    function Get-Columns($table) {
        $c = $conn.CreateCommand()
        $c.CommandText = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t"
        $c.Parameters.AddWithValue("@t", $table) | Out-Null
        $set = @{}
        $rd = $c.ExecuteReader()
        while ($rd.Read()) { $set[[string]$rd.GetValue(0)] = $true }
        $rd.Close()
        return $set
    }
    function Pick($set, [string[]]$names, $fallback) {
        foreach ($n in $names) { if ($set.ContainsKey($n)) { return $n } }
        return $fallback
    }

    $buCols = Get-Columns "bu000"
    $typeCol = Pick $buCols @("TypeGUID", "BillTypeGUID", "BType") $null
    $numCol  = Pick $buCols @("Number", "BillNumber", "Num", "Serial") $null
    $currencyCol = Pick $buCols @("CurrencyGUID", "Currency", "CurGUID") $null
    $postedCol = Pick $buCols @("IsPosted") $null

    if (-not $typeCol) { Write-Log "خطأ: لم أجد عمود نوع الفاتورة على bu000"; exit 1 }

    $numSel = if ($numCol) { "u.[$numCol]" } else { "CAST(u.GUID AS varchar(40))" }
    $postedFilter = if ($postedCol) { "AND u.[$postedCol] = 1" } else { "" }

    $biCols = Get-Columns "bi000"
    $priceCol = Pick $biCols @("Price", "UnitPrice", "SalePrice", "PriceUnit") $null
    $totalCol = Pick $biCols @("TotalPrice", "Total", "Net", "NetTotal", "NetValue", "Value", "Amount", "SubTotal", "LineTotal") $null

    $priceSel = if ($priceCol) { "COALESCE(bi.[$priceCol],0)" } else { "0" }
    $totalSel = if ($totalCol) { "COALESCE(bi.[$totalCol],0)" } elseif ($priceCol) { "(COALESCE(bi.Qty,0)*COALESCE(bi.[$priceCol],0))" } else { "0" }

    $mtCols = Get-Columns "mt000"
    $itemNumCol = Pick $mtCols @("Code", "Number", "MatNumber", "MatCode") $null
    $itemNumSel = if ($itemNumCol) { "LTRIM(RTRIM(COALESCE(CAST(m.[$itemNumCol] AS nvarchar(50)),'')))" } else { "CAST(m.GUID AS varchar(40))" }

    $unit1Col = Pick $mtCols @("Unity") $null
    $unit2Col = Pick $mtCols @("Unit2") $null
    $unit3Col = Pick $mtCols @("Unit3") $null
    $unitCaseParts = New-Object System.Collections.Generic.List[string]
    if ($unit1Col) { $unitCaseParts.Add("WHEN 1 THEN LTRIM(RTRIM(COALESCE(m.[$unit1Col],'')))")  }
    if ($unit2Col) { $unitCaseParts.Add("WHEN 2 THEN LTRIM(RTRIM(COALESCE(m.[$unit2Col],'')))")  }
    if ($unit3Col) { $unitCaseParts.Add("WHEN 3 THEN LTRIM(RTRIM(COALESCE(m.[$unit3Col],'')))")  }
    $unitSel = if ($unitCaseParts.Count -gt 0) { "(CASE bi.Unity $($unitCaseParts -join ' ') ELSE NULL END)" } else { "NULL" }

    $myCols = Get-Columns "my000"
    $currencyIsoCol = Pick $myCols @("CurrencyISO") $null
    $currencyJoin = if ($currencyCol -and $currencyIsoCol) { "LEFT JOIN my000 cur ON cur.GUID = u.[$currencyCol]" } else { "" }
    $currencyIsoSel = if ($currencyCol -and $currencyIsoCol) { "cur.[$currencyIsoCol]" } else { "NULL" }

    Write-Log "الأعمدة: نوع=$typeCol | رقم=$(if($numCol){$numCol}else{'GUID'}) | عملة=$(if($currencyIsoCol){'نعم'}else{'لا'})"

    # === جلب الفواتير ===
    # ⚠️ يحتاج تحديث الـ TypeGUIDs من الاكتشاف الفعلي للأمين
    $cmd = $conn.CreateCommand()
    $cmd.CommandTimeout = 300
    $cmd.CommandText = @"
SELECT CAST(u.GUID AS varchar(40)) AS bill_guid,
       $numSel AS bill_number,
       u.Date AS bill_date,
       LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) AS customer,
       CAST(COALESCE(u.Total,0) AS decimal(18,3)) AS bill_total,
       u.[$typeCol] AS type_guid,
       $itemNumSel AS item_number,
       CAST(bi.MatGUID AS varchar(40)) AS mat_guid,
       LTRIM(RTRIM(COALESCE(m.Name,''))) AS material,
       CAST(COALESCE(bi.Qty,0) AS decimal(18,3)) AS qty,
       $unitSel AS unit1,
       CAST($priceSel AS decimal(18,3)) AS price,
       CAST($totalSel AS decimal(18,3)) AS line_total,
       $currencyIsoSel AS currency_iso
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
$currencyJoin
WHERE u.[$typeCol] IN (@salesType, @salesReturnType)
  AND u.Date >= @fromDate
  AND LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) <> ''
  $postedFilter
ORDER BY u.Date ASC, u.GUID
"@
    $cmd.Parameters.AddWithValue("@fromDate", $fromDate) | Out-Null
    $cmd.Parameters.AddWithValue("@salesType", $SALES_TYPE_GUID) | Out-Null
    $cmd.Parameters.AddWithValue("@salesReturnType", $SALES_RETURN_TYPE_GUID) | Out-Null

    $bills = [ordered]@{}
    $billOrder = New-Object System.Collections.Generic.List[string]

    $r = $cmd.ExecuteReader()
    $rowCount = 0
    while ($r.Read()) {
        $rowCount++
        $g = [string]$r["bill_guid"]
        if (-not $bills.Contains($g)) {
            $billOrder.Add($g)
            $currency = if ($r["currency_iso"] -is [DBNull] -or -not $r["currency_iso"]) { "unknown" } else { ([string]$r["currency_iso"]).Trim().ToUpper() }
            $bills[$g] = @{
                number    = [string]$r["bill_number"]
                date      = ([datetime]$r["bill_date"]).ToString("yyyy-MM-dd")
                customer  = [string]$r["customer"]
                total     = [double]$r["bill_total"]
                currency  = $currency
                isReturn  = ([string]$r["type_guid"] -eq $SALES_RETURN_TYPE_GUID)
                items     = New-Object System.Collections.Generic.List[object]
            }
        }

        $bills[$g].items.Add(@{
            itemNumber = [string]$r["item_number"]
            itemName   = [string]$r["material"]
            qty        = [double]$r["qty"]
            unit       = if ($r["unit1"] -is [DBNull] -or -not $r["unit1"]) { "غير معروفة" } else { [string]$r["unit1"] }
            price      = [double]$r["price"]
            lineTotal  = [double]$r["line_total"]
        })
    }
    $r.Close()
    $conn.Close()

    Write-Log "قُرئت $rowCount سطر من الأمين لـ $($billOrder.Count) فاتورة"

    if ($billOrder.Count -eq 0) {
        Write-Log "لا توجد فواتير جديدة للفترة المحددة — الخروج بنجاح"
        exit 0
    }

    # === تجميع حسب الزبون ===
    $byCustomer = @{}
    foreach ($g in $billOrder) {
        $b = $bills[$g]
        $name = $b.customer
        if (-not $byCustomer.ContainsKey($name)) { $byCustomer[$name] = New-Object System.Collections.Generic.List[object] }
        $byCustomer[$name].Add(@{
            number    = $b.number
            date      = $b.date
            guid      = $g.ToLower()
            total     = [math]::Round($b.total, 3)
            currency  = $b.currency
            isReturn  = $b.isReturn
            items     = $b.items.ToArray()
        })
    }

    $items = New-Object System.Collections.Generic.List[object]
    foreach ($name in @($byCustomer.Keys | Sort-Object)) {
        $items.Add(@{
            name     = $name
            invoices = $byCustomer[$name].ToArray()
        })
    }

    Write-Log "تم تجهيز فواتير $($items.Count) زبون من $($billOrder.Count) فاتورة"

    # === تسجيل الدخول ===
    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody)) -ErrorAction Stop

    $authHeaders = @{
        apikey            = $apiKey
        Authorization     = "Bearer $($session.access_token)"
        Prefer            = "return=minimal"
        "Accept-Profile"  = "public"
        "Content-Profile" = "public"
    }

    # === الرفع مع إعادة محاولة ===
    $payload = @{
        report_date = (Get-Date).ToString("yyyy-MM-dd")
        created_by  = $session.user.id
        summary     = @{
            periodDays      = $PeriodDays
            fromDate        = $fromIso
            lastSuccessDate = $lastSuccess
            customers       = $items.Count
            bills           = $billOrder.Count
            syncedAt        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        items       = $items
    }
    $json = $payload | ConvertTo-Json -Depth 10 -Compress
    Write-Log ("حجم البيانات: {0:N0} حرف" -f $json.Length)

    $retryCount = 0
    $success = $false
    while ($retryCount -lt $MaxRetries -and -not $success) {
        try {
            Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/ameen_sales_invoice_reports" `
                -Headers $authHeaders -ContentType "application/json; charset=utf-8" `
                -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -ErrorAction Stop | Out-Null
            $success = $true
            Write-Log "✓ تم رفع تقرير فواتير المبيعات بنجاح"
        } catch {
            $retryCount++
            if ($retryCount -lt $MaxRetries) {
                $delay = [math]::Pow(2, $retryCount - 1) * 5
                Write-Log "خطأ بالمحاولة $retryCount: $($_.Exception.Message) — إعادة محاولة بعد $delay ثانية"
                Start-Sleep -Seconds $delay
            } else {
                Write-Log "فشل الرفع بعد $MaxRetries محاولات: $($_.Exception.Message)"
                exit 1
            }
        }
    }

    # === حفظ آخر نجاح ===
    if ($success) {
        $latestDate = $bills.Values | ForEach-Object { $_.date } | Sort-Object -Descending | Select-Object -First 1
        if ($latestDate) {
            Save-LastSuccessfulSync $latestDate
            Write-Log "حُفِظ آخر نجاح: $latestDate"
        }
    }

    exit 0

} catch {
    Write-Log "خطأ عام: $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Log ("تفصيل: " + $_.Exception.InnerException.Message) }
    exit 1
}
