# ============================================================
# pull-purchase-invoices-from-ameen.ps1
# سكربت قراءة فقط: يقرأ فواتير المشتريات الحقيقية من الأمين (بلا أي تعديل أو كتابة
# على الأمين) ويرفع تقريراً جاهزاً إلى Supabase (inventory_reports /
# source = ameen_purchase_invoices) ليعرضه تبويب «فواتير المشتريات» في الموقع
# عبر poAmeenPanelHtml() في src/app.js.
#
# ⚠️ هذا السكربت غير مُفعَّل حتى تتم مراجعته من Codex والموافقة عليه من المالك.
# لم يُشغَّل ولا مرة — راجع القسم أسفله قبل أي تشغيل فعلي.
#
# التصنيف يعتمد على bt000.TypeGUID (وليس BillType الخام، لأنه مشترك مع المناقلات
# الداخلية) — القيم المؤكدة من AI_WORK_SYNC.md / الذاكرة:
#   91377a56-ebfc-48c0-b79e-72063e1d7e3a = فاتورة مشتريات (bIsInput)
#   c9aca8fe-f50e-46eb-91ac-29ee32acbb3e = مرتجع مشتريات (bIsOutput)
#
# سكيما الأمين المستخدمة (بأسماء تُكتشف تلقائياً لاختلاف نسخ الأمين):
#   bu000 = رأس الفاتورة (GUID, Date, Cust_Name = اسم المورد هنا, Total, TypeGUID)
#   bi000 = أسطر الفاتورة (ParentGUID->الرأس, MatGUID->المادة, Qty, Price, TotalPrice)
#   mt000 = المواد (Number/Code = رقم المادة, Name, Unity, LastBuyPrice/AvgPrice)
#   bt000 = أنواع الفواتير (GUID<->TypeGUID)
#
# التشغيل (لاحقاً، بعد المراجعة والموافقة فقط):
#   .\tools\pull-purchase-invoices-from-ameen.ps1 -Discover     # طباعة الأعمدة وعيّنة بدون رفع
#   .\tools\pull-purchase-invoices-from-ameen.ps1               # الرفع الفعلي (آخر 60 يوماً)
#   .\tools\pull-purchase-invoices-from-ameen.ps1 -PeriodDays 90
# ============================================================
param(
    [int]$PeriodDays = 60,
    [int]$MaxInvoicesPerSupplier = 200,
    [switch]$Discover,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\purchase-invoices-pull.log"
)

# --- قفل أمان: هذه المرحلة قراءة وعرض فقط، ولم توافَق للتشغيل بعد ---
# لا تُزِل هذا السطر إلا بعد مراجعة Codex وموافقة صريحة من المالك (ozk.kh@outlook.com).
Write-Host "هذا السكربت مقفل عمداً — لم تتم مراجعته أو الموافقة على تشغيله بعد. راجع تعليق القفل أعلى الملف."
exit 1

$ErrorActionPreference = "Stop"

# التصنيفات المؤكدة لأنواع فواتير المشتريات في الأمين (bt000.TypeGUID)
$PURCHASE_TYPE_GUID = "91377a56-ebfc-48c0-b79e-72063e1d7e3a"
$PURCHASE_RETURN_TYPE_GUID = "c9aca8fe-f50e-46eb-91ac-29ee32acbb3e"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

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

# ملاحظة: هذا السكربت يقرأ فقط — يكفي مستخدم القراءة (tobacco_sync_reader)،
# لا حاجة لمتغيّر AMEEN_SQL_WRITE_CONNECTION_STRING إطلاقاً.
$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "خطأ: AMEEN_SQL_CONNECTION_STRING غير موجود."; exit 1 }

$fromDate = (Get-Date).Date.AddDays(-$PeriodDays)
$fromIso = $fromDate.ToString("yyyy-MM-dd")

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # --- اكتشاف أسماء الأعمدة المتغيّرة (تختلف بين نسخ الأمين) ---
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
    $payMethodCol = Pick $buCols @("PayType", "PayMethod", "IsCash", "Cash") $null
    $paidCol = Pick $buCols @("Paid", "PaidAmount", "CashAmount", "PaidValue") $null
    if (-not $typeCol) { Write-Log "خطأ: ما لقيت عمود نوع الفاتورة على bu000. شغّل -Discover وابعتلي الأعمدة."; exit 1 }
    $numSel = if ($numCol) { "u.[$numCol]" } else { "CAST(u.GUID AS varchar(40))" }
    Write-Log "اكتشاف: نوع الفاتورة = u.$typeCol | رقم الفاتورة = $(if($numCol){$numCol}else{'(GUID)'}) | عملة = $(if($currencyCol){$currencyCol}else{'(غير موجود)'}) | طريقة الدفع = $(if($payMethodCol){$payMethodCol}else{'(غير موجود)'}) | المدفوع = $(if($paidCol){$paidCol}else{'(غير موجود)'})"

    # اكتشاف أعمدة السعر/الإجمالي على bi000
    $biCols = Get-Columns "bi000"
    $priceCol = Pick $biCols @("Price", "UnitPrice", "BuyPrice", "PriceUnit") $null
    $totalCol = Pick $biCols @("TotalPrice", "Total", "Net", "NetTotal", "NetValue", "Value", "Amount", "SubTotal", "LineTotal") $null
    $priceSel = if ($priceCol) { "COALESCE(bi.[$priceCol],0)" } else { "0" }
    $totalSel = if ($totalCol) { "COALESCE(bi.[$totalCol],0)" } elseif ($priceCol) { "(COALESCE(bi.Qty,0)*COALESCE(bi.[$priceCol],0))" } else { "0" }

    # اكتشاف أعمدة رقم المادة وسعرَي الشراء الأخير/الوسطي على mt000
    $mtCols = Get-Columns "mt000"
    $itemNumCol = Pick $mtCols @("Number", "Code", "MatNumber", "MatCode") $null
    $lastPriceCol = Pick $mtCols @("LastBuyPrice", "LastPrice", "LastCost") $null
    $avgPriceCol = Pick $mtCols @("AvgPrice", "AvgCost", "AverageCost") $null
    $itemNumSel = if ($itemNumCol) { "LTRIM(RTRIM(COALESCE(CAST(m.[$itemNumCol] AS nvarchar(50)),'')))" } else { "CAST(m.GUID AS varchar(40))" }
    $lastPriceSel = if ($lastPriceCol) { "m.[$lastPriceCol]" } else { "NULL" }
    $avgPriceSel = if ($avgPriceCol) { "m.[$avgPriceCol]" } else { "NULL" }
    Write-Log "اكتشاف: رقم المادة = $(if($itemNumCol){$itemNumCol}else{'(GUID)'}) | آخر سعر شراء = $(if($lastPriceCol){$lastPriceCol}else{'(غير موجود)'}) | سعر وسطي = $(if($avgPriceCol){$avgPriceCol}else{'(غير موجود)'})"

    if ($Discover) {
        Write-Log "=== وضع الاكتشاف: عيّنة أحدث فاتورة مشتريات مع محتوياتها ==="
        Write-Log ("أعمدة bu000: " + (($buCols.Keys | Sort-Object) -join ", "))
        Write-Log ("أعمدة bi000: " + (($biCols.Keys | Sort-Object) -join ", "))
        Write-Log ("أعمدة mt000: " + (($mtCols.Keys | Sort-Object) -join ", "))
        $c = $conn.CreateCommand()
        $c.CommandTimeout = 180
        $c.CommandText = @"
SELECT TOP 15 $numSel AS bill_number, u.Date AS bill_date,
       LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) AS supplier,
       $itemNumSel AS item_number,
       LTRIM(RTRIM(COALESCE(m.Name,''))) AS material,
       bi.Qty AS qty, $priceSel AS price, $totalSel AS line_total,
       bt.Name AS bill_type_name, bt.TypeGUID AS type_guid
FROM bu000 u
JOIN bt000 bt ON bt.GUID = u.$typeCol
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
WHERE bt.TypeGUID IN (@purchaseType, @purchaseReturnType) AND u.Date >= @fromDate
ORDER BY u.Date DESC
"@
        $c.Parameters.AddWithValue("@fromDate", $fromDate) | Out-Null
        $c.Parameters.AddWithValue("@purchaseType", $PURCHASE_TYPE_GUID) | Out-Null
        $c.Parameters.AddWithValue("@purchaseReturnType", $PURCHASE_RETURN_TYPE_GUID) | Out-Null
        $rd = $c.ExecuteReader()
        $n = 0
        while ($rd.Read()) {
            $n++
            $retTag = if ([string]$rd["type_guid"] -eq $PURCHASE_RETURN_TYPE_GUID) { " [مرتجع مشتريات]" } else { "" }
            Write-Host ("  [{0}] {1} | {2} | {3} — {4} | كمية {5} × سعر {6} = {7}{8}" -f `
                $rd["bill_number"], ([datetime]$rd["bill_date"]).ToString("yyyy-MM-dd"), `
                $rd["supplier"], $rd["item_number"], $rd["material"], $rd["qty"], $rd["price"], $rd["line_total"], $retTag)
        }
        $rd.Close(); $conn.Close()
        Write-Log "الاكتشاف انتهى — $n سطر عيّنة. إذا الأسماء/القيم تبيّن صح، شغّل السكربت بدون -Discover."
        exit 0
    }

    # --- جلب كل أسطر فواتير المشتريات ومرتجعات المشتريات للفترة ---
    $cmd = $conn.CreateCommand()
    $cmd.CommandTimeout = 300
    $cmd.CommandText = @"
SELECT CAST(u.GUID AS varchar(40)) AS bill_guid,
       $numSel AS bill_number,
       u.Date AS bill_date,
       LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) AS supplier,
       CAST(COALESCE(u.Total,0) AS decimal(18,3)) AS bill_total,
       bt.TypeGUID AS type_guid,
       $itemNumSel AS item_number,
       LTRIM(RTRIM(COALESCE(m.Name,''))) AS material,
       CAST(COALESCE(bi.Qty,0) AS decimal(18,3)) AS qty,
       LTRIM(RTRIM(COALESCE(m.Unity,''))) AS unit1,
       CAST($priceSel AS decimal(18,3)) AS price,
       CAST($totalSel AS decimal(18,3)) AS line_total,
       CAST($lastPriceSel AS decimal(18,3)) AS last_price,
       CAST($avgPriceSel AS decimal(18,3)) AS avg_price
       $(if ($currencyCol) { ", u.[$currencyCol] AS currency_raw" } else { "" })
       $(if ($payMethodCol) { ", u.[$payMethodCol] AS pay_method_raw" } else { "" })
       $(if ($paidCol) { ", CAST(COALESCE(u.[$paidCol],0) AS decimal(18,3)) AS paid_amount" } else { "" })
FROM bu000 u
JOIN bt000 bt ON bt.GUID = u.$typeCol
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
WHERE bt.TypeGUID IN (@purchaseType, @purchaseReturnType)
  AND u.Date >= @fromDate
  AND LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) <> ''
ORDER BY u.Date DESC, u.GUID
"@
    $cmd.Parameters.AddWithValue("@fromDate", $fromDate) | Out-Null
    $cmd.Parameters.AddWithValue("@purchaseType", $PURCHASE_TYPE_GUID) | Out-Null
    $cmd.Parameters.AddWithValue("@purchaseReturnType", $PURCHASE_RETURN_TYPE_GUID) | Out-Null

    # bills[guid] = @{ number,date,supplier,total,currency,payMethod,paidAmount,isReturn, items = List }
    $bills = [ordered]@{}
    $billOrder = New-Object System.Collections.Generic.List[string]
    $r = $cmd.ExecuteReader()
    while ($r.Read()) {
        $g = [string]$r["bill_guid"]
        if (-not $bills.Contains($g)) {
            $billOrder.Add($g)
            $currencyRaw = if ($currencyCol) { [string]$r["currency_raw"] } else { $null }
            $currency = if ($currencyRaw -and $currencyRaw -match "(?i)syp|ليرة|SY") { "SYP" } else { "USD" }
            $payRaw = if ($payMethodCol) { [string]$r["pay_method_raw"] } else { $null }
            $payMethod = if ($payRaw -and ($payRaw -match "(?i)^(0|false|cash|نقد)")) { "cash" } elseif ($payRaw) { "credit" } else { "unknown" }
            $paidAmount = if ($paidCol) { [double]$r["paid_amount"] } else { $null }
            $bills[$g] = @{
                number     = [string]$r["bill_number"]
                date       = ([datetime]$r["bill_date"]).ToString("yyyy-MM-dd")
                supplier   = [string]$r["supplier"]
                total      = [double]$r["bill_total"]
                currency   = $currency
                payMethod  = $payMethod
                paidAmount = $paidAmount
                # مرتجع مشتريات — نميّزه عن فاتورة الشراء العادية بالاعتماد على TypeGUID
                # (وليس BillType الخام، لأنه مشترك مع المناقلات الداخلية).
                isReturn   = ([string]$r["type_guid"] -eq $PURCHASE_RETURN_TYPE_GUID)
                items      = New-Object System.Collections.Generic.List[object]
            }
        }
        $bills[$g].items.Add(@{
            itemNumber = [string]$r["item_number"]
            itemName   = [string]$r["material"]
            qty        = [double]$r["qty"]
            unit       = [string]$r["unit1"]
            price      = [double]$r["price"]
            lineTotal  = [double]$r["line_total"]
            lastPrice  = if ($r["last_price"] -is [DBNull]) { $null } else { [double]$r["last_price"] }
            avgPrice   = if ($r["avg_price"] -is [DBNull]) { $null } else { [double]$r["avg_price"] }
        })
    }
    $r.Close(); $conn.Close()

    # --- تجميع الفواتير حسب المورد ---
    $bySupplier = @{}
    foreach ($g in $billOrder) {
        $b = $bills[$g]
        $name = $b.supplier
        if (-not $bySupplier.ContainsKey($name)) { $bySupplier[$name] = New-Object System.Collections.Generic.List[object] }
        $bySupplier[$name].Add(@{
            number     = $b.number
            date       = $b.date
            guid       = $g.ToLower()
            total      = [math]::Round($b.total, 3)
            currency   = $b.currency
            payMethod  = $b.payMethod
            paidAmount = $b.paidAmount
            isReturn   = $b.isReturn
            items      = $b.items.ToArray()
        })
    }

    $items = New-Object System.Collections.Generic.List[object]
    foreach ($name in @($bySupplier.Keys)) {
        $list = $bySupplier[$name].ToArray()
        $truncated = $false
        if ($list.Count -gt $MaxInvoicesPerSupplier) {
            $list = @($list | Select-Object -First $MaxInvoicesPerSupplier)
            $truncated = $true
        }
        $items.Add(@{
            name      = $name
            invoices  = $list
            truncated = $truncated
        })
    }

    Write-Log "تم تجهيز فواتير $($items.Count) مورد / $($billOrder.Count) فاتورة (من $fromIso)"

    if (-not $apiKey) { Write-Log "خطأ: TOBACCO_SUPABASE_PUBLIC_KEY غير موجود."; exit 1 }
    if (-not $syncEmail -or -not $syncPassword) { Write-Log "خطأ: TOBACCO_SYNC_EMAIL / TOBACCO_SYNC_PASSWORD غير موجودين."; exit 1 }

    # --- تسجيل الدخول إلى Supabase ---
    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))

    $authHeaders = @{
        apikey            = $apiKey
        Authorization     = "Bearer $($session.access_token)"
        Prefer            = "return=minimal"
        "Accept-Profile"  = "public"
        "Content-Profile" = "public"
    }

    # --- رفع التقرير ---
    $payload = @{
        source      = "ameen_purchase_invoices"
        report_date = (Get-Date).ToString("yyyy-MM-dd")
        created_by  = $session.user.id
        summary     = @{
            periodDays = $PeriodDays
            fromDate   = $fromIso
            suppliers  = $items.Count
            bills      = $billOrder.Count
            syncedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        items       = $items
    }
    $json = $payload | ConvertTo-Json -Depth 10 -Compress
    Write-Log ("حجم البيانات: {0:N0} حرف" -f $json.Length)
    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/inventory_reports" `
        -Headers $authHeaders -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | Out-Null

    Write-Log "تم رفع تقرير فواتير المشتريات بنجاح ✓"

    # --- حذف التقارير القديمة (أقدم من يومين) ---
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-2).ToString("yyyy-MM-ddTHH:mm:ssZ")
    try {
        Invoke-RestMethod -Method Delete `
            -Uri "$supabaseUrl/rest/v1/inventory_reports?source=eq.ameen_purchase_invoices&created_at=lt.$cutoff" `
            -Headers $authHeaders | Out-Null
    } catch { Write-Log "تنبيه: تعذّر حذف التقارير القديمة: $($_.Exception.Message)" }

    exit 0
} catch {
    Write-Log "خطأ (سطر $($_.InvocationInfo.ScriptLineNumber)): $($_.Exception.Message)"
    try {
        $resp = $_.Exception.Response
        if ($resp) {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $bodyText = $reader.ReadToEnd()
            if ($bodyText) { Write-Log ("رد الخادم: " + $bodyText) }
        }
    } catch {}
    if ($_.Exception.InnerException) { Write-Log ("تفصيل: " + $_.Exception.InnerException.Message) }
    exit 1
}
