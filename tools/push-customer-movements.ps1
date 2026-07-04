# ============================================================
# push-customer-movements.ps1
# يرفع حركات حساب كل زبون (آخر 92 يومًا) + رصيد أول المدة
# إلى Supabase (inventory_reports / source=ameen_customer_movements)
# ليستخدمها كشف الحساب الرسمي في الموقع.
# ============================================================
param(
    [int]$PeriodDays = 92,
    [int]$MaxMovementsPerCustomer = 300,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\customer-movements-push.log"
)

$ErrorActionPreference = "Stop"

# قراءة الإعدادات من .env ثم من متغيرات المستخدم
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

$connStr = Get-Setting "AMEEN_SQL_WRITE_CONNECTION_STRING"
if (-not $connStr) { $connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING" }
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "خطأ: AMEEN_SQL_WRITE_CONNECTION_STRING غير موجود."; exit 1 }
if (-not $apiKey) { Write-Log "خطأ: TOBACCO_SUPABASE_PUBLIC_KEY غير موجود."; exit 1 }
if (-not $syncEmail -or -not $syncPassword) { Write-Log "خطأ: TOBACCO_SYNC_EMAIL / TOBACCO_SYNC_PASSWORD غير موجودين."; exit 1 }

$fromDate = (Get-Date).Date.AddDays(-$PeriodDays)
$fromIso = $fromDate.ToString("yyyy-MM-dd")

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # (1) رصيد أول المدة لكل زبون (مجموع القيود قبل بداية الفترة)
    $openings = @{}
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = @"
SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
       CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0)) AS decimal(18,3)) AS opening
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE en.Date < @fromDate
  AND cu.CustomerName IS NOT NULL AND LTRIM(RTRIM(cu.CustomerName)) <> ''
  AND (cu.bHide IS NULL OR cu.bHide = 0)
GROUP BY LTRIM(RTRIM(cu.CustomerName))
"@
    $cmd.Parameters.AddWithValue("@fromDate", $fromDate) | Out-Null
    $r = $cmd.ExecuteReader()
    while ($r.Read()) { $openings[[string]$r.GetValue(0)] = [double]$r.GetValue(1) }
    $r.Close()

    # (2) حركات الفترة لكل زبون
    $movements = @{}
    $cmd = $conn.CreateCommand()
    # الرصيد المتحرك يُحسب بدالة نافذة على كل قيود الحساب. الترتيب يطابق كشف الأمين:
    # التاريخ ← القيد الافتتاحي أولاً ← المدين (الفواتير) قبل الدائن (الدفعات) ← رقم القيد.
    # (en.Number ليس تسلسلياً والتاريخ بلا وقت، فلا يصلحان وحدهما للترتيب.)
    $cmd.CommandText = @"
WITH led AS (
    SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
           en.Date AS dt, en.Number AS num,
           CASE WHEN COALESCE(en.Notes,'') LIKE N'%افتتاح%' THEN 0 ELSE 1 END AS isopen,
           CASE WHEN COALESCE(en.Credit,0) > 0 THEN 1 ELSE 0 END AS iscredit,
           CAST(COALESCE(en.Debit,0)  AS decimal(18,3)) AS debit,
           CAST(COALESCE(en.Credit,0) AS decimal(18,3)) AS credit,
           LEFT(COALESCE(en.Notes,''), 70) AS notes,
           -- معرّف الفاتورة المولِّدة للقيد: BiGUID قد يشير لرأس الفاتورة مباشرة أو لسطرها
           -- (فنصعد للرأس عبر bi000.ParentGUID) — لربط قطعي بين القيد والفاتورة في الموقع.
           COALESCE(LOWER(CAST(COALESCE(bib.ParentGUID, en.BiGUID) AS varchar(40))), '') AS bill_guid,
           CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0))
                OVER (PARTITION BY en.AccountGUID
                      ORDER BY en.Date,
                               CASE WHEN COALESCE(en.Notes,'') LIKE N'%افتتاح%' THEN 0 ELSE 1 END,
                               CASE WHEN COALESCE(en.Credit,0) > 0 THEN 1 ELSE 0 END,
                               en.Number
                      ROWS UNBOUNDED PRECEDING) AS decimal(18,3)) AS balance
    FROM dbo.en000 en
    JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
    LEFT JOIN dbo.bi000 bib ON bib.GUID = en.BiGUID
    WHERE (COALESCE(en.Debit,0) > 0 OR COALESCE(en.Credit,0) > 0)
      AND cu.CustomerName IS NOT NULL AND LTRIM(RTRIM(cu.CustomerName)) <> ''
      AND (cu.bHide IS NULL OR cu.bHide = 0)
)
SELECT name, dt, debit, credit, notes, bill_guid, balance
FROM led
WHERE dt >= @fromDate
ORDER BY name, dt, isopen, iscredit, num
"@
    $cmd.Parameters.AddWithValue("@fromDate", $fromDate) | Out-Null
    $r = $cmd.ExecuteReader()
    while ($r.Read()) {
        $name = [string]$r.GetValue(0)
        if (-not $movements.ContainsKey($name)) { $movements[$name] = New-Object System.Collections.Generic.List[object] }
        $movements[$name].Add(@{
            date     = ([datetime]$r.GetValue(1)).ToString("yyyy-MM-dd")
            debit    = [double]$r.GetValue(2)
            credit   = [double]$r.GetValue(3)
            notes    = [string]$r.GetValue(4)
            billGuid = [string]$r.GetValue(5)
            balance  = [double]$r.GetValue(6)
        })
    }
    $r.Close()
    $conn.Close()

    # (3) بناء عناصر التقرير
    # ملاحظة PowerShell 5.1: لا تغلّف List بـ @() — ترمي "Argument types do not match".
    # استخدم .ToArray() بدلًا منها.
    $nameSet = @{}
    foreach ($k in @($openings.Keys)) { $nameSet[$k] = $true }
    foreach ($k in @($movements.Keys)) { $nameSet[$k] = $true }
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($name in @($nameSet.Keys)) {
        $opening = 0.0
        if ($openings.ContainsKey($name)) { $opening = $openings[$name] }
        # نجبره مصفوفة دائماً (@(...)): زبون بحركة واحدة كان يصبح كائناً مفرداً فيكسر الفهرسة والرفع.
        $list = @()
        if ($movements.ContainsKey($name)) { $list = @($movements[$name].ToArray()) }
        if ($opening -eq 0 -and $list.Count -eq 0) { continue }

        $truncated = $false
        if ($list.Count -gt $MaxMovementsPerCustomer) {
            $list = @($list | Select-Object -Last $MaxMovementsPerCustomer)
            $truncated = $true
        }
        $closing = $opening
        foreach ($m in $list) { $closing += ($m.debit - $m.credit) }
        # الرصيد المتحرك المُخزَّن هو الأدقّ: نشتقّ منه الافتتاحي (رصيد أول المعروض) والختامي،
        # فيصحّ حتى عند اقتطاع الحركات القديمة أو وجود قيود افتتاحية.
        if ($list.Count -gt 0) {
            if ($list[0].ContainsKey('balance'))  { $opening = [double]$list[0].balance - ([double]$list[0].debit - [double]$list[0].credit) }
            if ($list[-1].ContainsKey('balance')) { $closing = [double]$list[-1].balance }
        }

        $items.Add(@{
            name           = $name
            openingBalance = [math]::Round($opening, 3)
            closingBalance = [math]::Round($closing, 3)
            movements      = $list
            truncated      = $truncated
        })
    }

    Write-Log "تم تجهيز حركات $($items.Count) زبون (من $fromIso)"

    # (4) تسجيل الدخول إلى Supabase
    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))

    # معرّف المستخدم: من user.id إن وُجد، وإلا من حقل sub داخل توكن JWT (موثوق لأن الدخول نجح).
    $createdBy = $null
    if ($session.user -and $session.user.id) { $createdBy = $session.user.id }
    if (-not $createdBy -and $session.access_token) {
        $seg = $session.access_token.Split('.')[1].Replace('-','+').Replace('_','/')
        switch ($seg.Length % 4) { 2 { $seg += '==' } 3 { $seg += '=' } 1 { $seg += '===' } }
        try { $createdBy = ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($seg)) | ConvertFrom-Json).sub } catch {}
    }

    $authHeaders = @{
        apikey            = $apiKey
        Authorization     = "Bearer $($session.access_token)"
        Prefer            = "return=minimal"
        "Accept-Profile"  = "public"
        "Content-Profile" = "public"
    }

    # (5) رفع التقرير
    $payload = @{
        source      = "ameen_customer_movements"
        report_date = (Get-Date).ToString("yyyy-MM-dd")
        created_by  = $createdBy
        summary     = @{
            periodDays  = $PeriodDays
            fromDate    = $fromIso
            customers   = $items.Count
            syncedAt    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
        items       = $items
    }
    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    Write-Log ("حجم البيانات: {0:N0} حرف" -f $json.Length)
    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/inventory_reports" `
        -Headers $authHeaders -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | Out-Null

    Write-Log "تم رفع تقرير الحركات بنجاح ✓"

    # (6) حذف التقارير القديمة (أقدم من يومين) لتوفير المساحة
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-2).ToString("yyyy-MM-ddTHH:mm:ssZ")
    try {
        Invoke-RestMethod -Method Delete `
            -Uri "$supabaseUrl/rest/v1/inventory_reports?source=eq.ameen_customer_movements&created_at=lt.$cutoff" `
            -Headers $authHeaders | Out-Null
    } catch { Write-Log "تنبيه: تعذّر حذف التقارير القديمة: $($_.Exception.Message)" }

    exit 0
} catch {
    Write-Log "خطأ (سطر $($_.InvocationInfo.ScriptLineNumber)): $($_.Exception.Message)"
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Write-Log ("رد الخادم: " + $_.ErrorDetails.Message) }
    if ($_.Exception.InnerException) { Write-Log ("تفصيل: " + $_.Exception.InnerException.Message) }
    exit 1
}
