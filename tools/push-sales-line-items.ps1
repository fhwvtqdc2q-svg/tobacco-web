# ============================================================
# push-sales-line-items.ps1
# يقرأ حركة الفواتير التفصيلية (مبيعات مركز + طلبيات جملة) من
# قاعدة الأمين آخر N يوم، ويرفعها لجدول sales_line_items بـSupabase.
# هاد الجدول هو مصدر البيانات لأوامر البوت "حركة مادة" و"ربح اليوم".
#
# كل تشغيلة: تمسح صفوف نفس نافذة الأيام وترفعها من جديد (idempotent) —
# فما في تكرار ولا حاجة لمعرفة مفتاح فريد داخل الأمين.
#
# تجربة بدون رفع:  .\tools\push-sales-line-items.ps1 -DryRun
# تشغيل فعلي:      .\tools\push-sales-line-items.ps1
# نافذة أطول:      .\tools\push-sales-line-items.ps1 -Days 14
# ============================================================
param(
    [switch]$DryRun,
    [int]$Days = 7,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\sales-line-items-push.log"
)

$ErrorActionPreference = "Stop"

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

function Notify-Failure($Message) {
    try {
        & "$PSScriptRoot\send-telegram-notification.ps1" `
            -Message $Message -EventType "sync_failure" -DedupeKey "winfail:push-sales-line-items" -DedupeMinutes 60 `
            -EnvFile $EnvFile
    } catch { }
}

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "khata: AMEEN_SQL_CONNECTION_STRING ghyr mwjwd."; exit 1 }
if (-not $supabaseUrl -or -not $apiKey -or -not $syncEmail -or -not $syncPassword) {
    Write-Log "khata: e3dadat Supabase (URL/KEY/SYNC_EMAIL/SYNC_PASSWORD) na2sa."
    exit 1
}

# GUID نوع الفاتورة — مؤكّدين عبر discover-ameen-sales-4.ps1 و
# discover-ameen-bill-types.ps1 (استعلام مباشر لجدول bt000 المرجعي
# بالأمين، اللي فيه الاسم الحقيقي لكل نوع فاتورة):
#   cc1097b1 = "مبيعات مركز"  (تجزئة)                → retail
#   4a827bee = "مبيعات ل.س"   (نادر، حجم قليل)        → wholesale
#   7f5b0921 = "مبيعات"       (نشيط جداً، كان ناقص كلياً من المزامنة) → wholesale
$RETAIL_TYPE_GUID    = "cc1097b1-662d-4d80-8e4e-3b493249591c"
$WHOLESALE_TYPE_GUID = "4a827bee-6ae1-4474-802b-970068872fcc"
$SALES_TYPE_GUID     = "7f5b0921-61f3-4f23-a1f4-fbfae4144bf4"

$sql = @"
SELECT
  u.Number                                                    AS bill_no,
  CASE WHEN u.TypeGUID = '$RETAIL_TYPE_GUID' THEN 'retail'
       ELSE 'wholesale' END                                   AS bill_type,
  CAST(u.Date AS date)                                        AS sale_date,
  CONVERT(nvarchar(36), bi.MatGUID)                           AS item_key,
  m.Name                                                      AS item_name,
  bi.Qty                                                      AS qty,
  -- عمود bi.Unity (1 أو 2) بيحدد وحدة تسعير هالسطر بالضبط — تأكّدنا بمطابقة
  -- 11 سطر حقيقيين من فاتورة رقم 52 (حسن عباس) مع صورة شاشة الأمين نفسها:
  --   Unity = 1 → السطر مسعّر بالوحدة الأولى (كروز/علبة) — bi.Price أصلاً
  --               سعر القطعة، ما بحتاج أي تعديل.
  --   Unity = 2 → السطر مسعّر بالوحدة الثانية (كرتونة/طرد/شرحة حسب الصنف) —
  --               bi.Price سعر الوحدة كاملة، فلازم نقسمها على Unit2Fact
  --               (يختلف حسب الصنف: 50 للكرتونة، 20 للطرد، 12 للشرحة...)
  --               لنحوّلها لسعر القطعة الواحدة، فتبقى متوافقة مع bi.Qty
  --               اللي دايماً بعدد القطع. النتيجة طابقت bi.Netprofit
  --               (الإجمالي الحقيقي) تماماً بكل الأسطر الـ11 بدون استثناء.
  -- ينطبق على التجزئة والجملة معاً (الوحدة خاصية كل سطر، مو نوع الفاتورة).
  CASE WHEN bi.Unity = 2 THEN bi.Price / NULLIF(m.Unit2Fact, 0)
       ELSE bi.Price END                                      AS unit_price,
  bi.Qty * (CASE WHEN bi.Unity = 2 THEN bi.Price / NULLIF(m.Unit2Fact, 0)
                 ELSE bi.Price END)                            AS line_total,
  bi.UnitCostPrice                                            AS unit_cost,
  bi.Netprofit                                                AS net_profit,
  u.Cust_Name                                                 AS customer_name,
  m.Unit2                                                     AS unit2_name,
  m.Unit2Fact                                                 AS unit2_factor
FROM bu000 u
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m  ON m.GUID = bi.MatGUID
WHERE u.TypeGUID IN ('$RETAIL_TYPE_GUID', '$WHOLESALE_TYPE_GUID', '$SALES_TYPE_GUID')
  AND u.Date >= DATEADD(day, -$Days, CAST(GETDATE() AS date))
ORDER BY u.Date DESC, u.Number DESC
"@

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Log "bd2 sahb harakat al-fawater akher $Days yom..."

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 120
    $reader = $cmd.ExecuteReader()

    $rows = @()
    while ($reader.Read()) {
        $rows += [PSCustomObject]@{
            bill_no       = "$($reader['bill_no'])"
            bill_type     = "$($reader['bill_type'])"
            sale_date     = ([datetime]$reader['sale_date']).ToString("yyyy-MM-dd")
            item_key      = "$($reader['item_key'])"
            item_name     = "$($reader['item_name'])"
            qty           = [double]$reader['qty']
            unit_price    = [double]$reader['unit_price']
            line_total    = [double]$reader['line_total']
            unit_cost     = if ($reader['unit_cost'] -is [DBNull]) { $null } else { [double]$reader['unit_cost'] }
            net_profit    = if ($reader['net_profit'] -is [DBNull]) { $null } else { [double]$reader['net_profit'] }
            customer_name = "$($reader['customer_name'])"
            unit2_name    = "$($reader['unit2_name'])"
            unit2_factor  = if ($reader['unit2_factor'] -is [DBNull]) { $null } else { [double]$reader['unit2_factor'] }
        }
    }
    $reader.Close()
    $conn.Close()

    Write-Log "t2ra2 $($rows.Count) satr harakat."

    if ($rows.Count -eq 0) {
        Write-Log "ma fi satr — khoroj bidoon rafe3."
        exit 0
    }

    if ($DryRun) {
        Write-Host "=== DRY RUN — awal 10 sotoor ===" -ForegroundColor Yellow
        $rows | Select-Object -First 10 | Format-Table -AutoSize
        Write-Log "DryRun: ma tem raf3 shi (test faqat)."
        exit 0
    }

    # مصادقة كمستخدم مزامنة (نفس نمط باقي سكريبتات الرفع بالمشروع)
    $authBody = @{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json
    $auth = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey; Accept = "application/json" } `
        -ContentType "application/json; charset=utf-8" -Body $authBody
    $token = $auth.access_token
    $hdr = @{ apikey = $apiKey; Authorization = "Bearer $token"; "Accept-Profile" = "public"; "Content-Profile" = "public" }

    # مسح نافذة نفس الأيام قبل إعادة الرفع (idempotent — يتفادى التكرار والفواتير المعدَّلة/الملغاة)
    $cutoff = (Get-Date).AddDays(-$Days).ToString("yyyy-MM-dd")
    Invoke-RestMethod -Method Delete -Uri "$supabaseUrl/rest/v1/sales_line_items?sale_date=gte.$cutoff" `
        -Headers ($hdr + @{ Prefer = "return=minimal" }) | Out-Null
    Write-Log "tem masah al-sofoof al-qadima (>= $cutoff)."

    # رفع بدفعات 500 صف لتفادي حجم طلب كبير
    $batchSize = 500
    for ($i = 0; $i -lt $rows.Count; $i += $batchSize) {
        $batch = $rows[$i..([Math]::Min($i + $batchSize - 1, $rows.Count - 1))]
        $body = $batch | ConvertTo-Json -Depth 3
        Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/sales_line_items" `
            -Headers ($hdr + @{ Prefer = "return=minimal" }) `
            -ContentType "application/json; charset=utf-8" -Body $body | Out-Null
    }

    Write-Log "tem raf3 $($rows.Count) satr b-najah ✓"

    # نفس المهمة المجدولة تحدّث تقرير الربح بعد تحديث حركة المبيعات، حتى
    # يبقى أمر «ربح اليوم» قريباً من الأمين من دون مهمة Windows إضافية.
    & "$PSScriptRoot\push-daily-profit.ps1" -EnvFile $EnvFile
    if ($LASTEXITCODE -ne 0) { throw "daily_profit_sync_failed_after_sales_upload" }
    exit 0

} catch {
    $errMsg = "[$timestamp] ERROR: $($_.Exception.Message)"
    Write-Log $errMsg
    Notify-Failure "🚨 فشل رفع حركة المبيعات التفصيلية (push-sales-line-items)`n$($_.Exception.Message)"
    exit 1
}
