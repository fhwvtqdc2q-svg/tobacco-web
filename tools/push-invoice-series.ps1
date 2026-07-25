# ============================================================
# push-invoice-series.ps1
# يرفع آخر رقم فاتورة لكل سلسلة ترقيم في الأمين إلى Supabase
# (inventory_reports / source = ameen_invoice_series)
# كي يعرض الموقع رقم الفاتورة التالي متزامناً مع الأمين بدل ترقيم محلي مستقل.
#
# لماذا سكربت منفصل عن push-customer-invoices.ps1:
#   تقرير الفواتير يُسقِط كل فاتورة بلا اسم زبون (شرط Cust_Name <> '')، ومعظم
#   فواتير «مبيعات مركز» بلا اسم — فأكبر رقم فيه ليس آخر رقم فعلي. كما أنه لا
#   يحمل نوع الفاتورة أصلاً، والأمين يستعمل سلسلة ترقيم مستقلة لكل نوع.
#
# سكيما الأمين المستخدمة (قراءة فقط — لا كتابة إطلاقاً):
#   bu000 = رأس الفاتورة (Number, Date, نوع الفاتورة)
#   bt000 = أنواع الفواتير (Name, BillType: 1 = مبيعات، 3 = مرتجع مبيعات)
#
# ملاحظة على تدوير السنة: الترقيم يبدأ من ١ مع كل قاعدة سنة جديدة، ولذلك
# نأخذ أكبر رقم في القاعدة الحالية كاملةً بلا نافذة زمنية.
#
# التشغيل:
#   .\tools\push-invoice-series.ps1 -Discover   # يطبع النتيجة بلا رفع
#   .\tools\push-invoice-series.ps1             # الرفع الفعلي
# ============================================================
param(
    [switch]$Discover,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\invoice-series-push.log"
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

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
if (-not $connStr) { $connStr = Get-Setting "AMEEN_SQL_WRITE_CONNECTION_STRING" }
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "خطأ: AMEEN_SQL_CONNECTION_STRING غير موجود."; exit 1 }

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # اسم عمود نوع الفاتورة يختلف بين نسخ الأمين — نكتشفه كما يفعل سكربت الفواتير.
    $cols = New-Object System.Collections.Generic.List[string]
    $c = $conn.CreateCommand()
    $c.CommandText = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bu000'"
    $rc = $c.ExecuteReader()
    while ($rc.Read()) { $cols.Add([string]$rc["COLUMN_NAME"]) }
    $rc.Close()

    $typeCol = $null
    foreach ($cand in @("TypeGUID", "BillTypeGUID", "BType")) {
        if ($cols -contains $cand) { $typeCol = $cand; break }
    }
    $numCol = $null
    foreach ($cand in @("Number", "BillNumber", "Num", "Serial")) {
        if ($cols -contains $cand) { $numCol = $cand; break }
    }
    if (-not $typeCol) { Write-Log "خطأ: لم يُعثر على عمود نوع الفاتورة في bu000."; exit 1 }
    if (-not $numCol)  { Write-Log "خطأ: لم يُعثر على عمود رقم الفاتورة في bu000."; exit 1 }

    # TRY_CAST يحمي لو كان العمود نصياً في نسخة أمين أخرى (فيُرتَّب رقمياً لا أبجدياً).
    $cmd = $conn.CreateCommand()
    $cmd.CommandTimeout = 120
    $cmd.CommandText = @"
SELECT CAST(bt.GUID AS varchar(40))            AS type_guid,
       LTRIM(RTRIM(COALESCE(bt.Name,'')))      AS type_name,
       bt.BillType                             AS bill_class,
       COALESCE(MAX(TRY_CAST(u.$numCol AS int)), 0) AS last_no,
       COUNT(u.GUID)                           AS bills,
       MAX(u.Date)                             AS last_date
FROM bt000 bt
LEFT JOIN bu000 u ON u.$typeCol = bt.GUID
WHERE bt.BillType IN (1, 3)
GROUP BY bt.GUID, bt.Name, bt.BillType
ORDER BY bt.BillType, bt.Name
"@

    $series = New-Object System.Collections.Generic.List[object]
    $r = $cmd.ExecuteReader()
    while ($r.Read()) {
        $lastDate = ""
        if ($r["last_date"] -isnot [DBNull]) { $lastDate = ([datetime]$r["last_date"]).ToString("yyyy-MM-dd") }
        $series.Add(@{
            typeGuid = ([string]$r["type_guid"]).ToLower()
            typeName = [string]$r["type_name"]
            billType = [int]$r["bill_class"]   # 1 = مبيعات، 3 = مرتجع مبيعات
            lastNo   = [int]$r["last_no"]
            nextNo   = ([int]$r["last_no"]) + 1
            bills    = [int]$r["bills"]
            lastDate = $lastDate
        })
    }
    $r.Close(); $conn.Close()

    Write-Log "تم قراءة $($series.Count) سلسلة ترقيم من الأمين"
    foreach ($s in $series) {
        Write-Log ("  {0} (BillType={1}) — آخر رقم {2}، التالي {3}، {4} فاتورة، آخر تاريخ {5}" -f `
            $s.typeName, $s.billType, $s.lastNo, $s.nextNo, $s.bills, $s.lastDate)
    }

    if ($Discover) { Write-Log "وضع الاكتشاف — لم يُرفع شيء."; exit 0 }

    if (-not $apiKey) { Write-Log "خطأ: TOBACCO_SUPABASE_PUBLIC_KEY غير موجود."; exit 1 }
    if (-not $syncEmail -or -not $syncPassword) { Write-Log "خطأ: TOBACCO_SYNC_EMAIL / TOBACCO_SYNC_PASSWORD غير موجودين."; exit 1 }

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

    $payload = @{
        source      = "ameen_invoice_series"
        report_date = (Get-Date).ToString("yyyy-MM-dd")
        created_by  = $session.user.id
        summary     = @{
            seriesCount = $series.Count
            syncedAt    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        items       = $series
    }
    $json = $payload | ConvertTo-Json -Depth 6 -Compress
    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/inventory_reports" `
        -Headers $authHeaders -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | Out-Null

    Write-Log "تم رفع سلاسل الترقيم بنجاح ✓"

    # حذف التقارير القديمة (أقدم من يوم) — يكفي أحدث تقرير دائماً.
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-1).ToString("yyyy-MM-ddTHH:mm:ssZ")
    try {
        Invoke-RestMethod -Method Delete `
            -Uri "$supabaseUrl/rest/v1/inventory_reports?source=eq.ameen_invoice_series&created_at=lt.$cutoff" `
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
    } catch { }
    exit 1
}
