# ============================================================
# push-purchase-item-snapshot.ps1
# يقرأ من الأمين (قراءة فقط) لقطة كل مادة: المخزون المحسوب من حركة الفواتير
# (bIsInput/bIsOutput — وليس من ms000 مباشرة، بحسب قاعدة تدوير السنة 2026
# الموثّقة في الذاكرة)، آخر سعر شراء وتاريخه، متوسط التكلفة، آخر مورد، وترتيب
# حركة المبيع خلال آخر N يوم — ثم يرفعها (upsert) إلى جدول Supabase الجديد
# ameen_item_snapshot عبر REST.
#
# ⚠️ حالة هذا الملف: مسودة تطوير فقط ضمن فرع purchase-invoices-ameen-v2.
# لا يُشغَّل، لا يُسجَّل كمهمة مجدولة، ولا حتى بوضع DryRun خلال هذه المرحلة —
# الاستعلامات أدناه لم تُتحقق بعد من discover-ameen-purchase-schema.ps1 الفعلي
# (أسماء الجداول/الأعمدة قد تحتاج تعديلاً بعد المراجعة). لا تُشغِّله قبل موافقة
# صريحة من المالك (ozk.kh@outlook.com) على قائمة GUIDs/أسماء الجداول النهائية.
#
# الوضع الافتراضي: تجربة بلا كتابة (DryRun). الكتابة الفعلية إلى Supabase
# تتطلب -Apply صراحةً (بالإضافة لموافقة تشغيل السكربت نفسه أساساً).
# ============================================================
# تجربة بدون رفع (الافتراضي):  .\tools\push-purchase-item-snapshot.ps1
# رفع فعلي (ممنوع حالياً):     .\tools\push-purchase-item-snapshot.ps1 -Apply
# ============================================================
param(
    [switch]$Apply,
    [string]$ConfigFile = "$PSScriptRoot\ameen-purchase-config.json",
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\purchase-item-snapshot-push.log",
    [int]$MovementLookbackDays = 30
)

$ErrorActionPreference = "Stop"

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    $dir = Split-Path $LogFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

# ---------- قفل أمان صريح: هذا السكربت لا يُنفَّذ خلال مرحلة التطوير ----------
Write-Log "khata: hatha al-skrbt fi marhalat tatwyr faqat — lam yu'tamad tashghyluh ba3d."
Write-Log "raji3 discover-ameen-purchase-schema.ps1 wa AI_WORK_SYNC.md qabl ay tashghyl fi3li."
exit 1

# ============================================================
# الكود أدناه غير قابل للوصول (exit 1 أعلاه) — مسودة توثّق التصميم المقصود
# فقط، بانتظار اعتماد أسماء الجداول/الأعمدة الحقيقية من discover script.
# ============================================================

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

if (-not (Test-Path $ConfigFile)) { Write-Log "khata: config file ghyr mwjwd: $ConfigFile"; exit 1 }
$cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "khata: AMEEN_SQL_CONNECTION_STRING ghyr mwjwd."; exit 1 }
if (-not $cfg.ameenBillLineTable -or -not $cfg.ameenMaterialTable) {
    Write-Log "khata: ameen-purchase-config.json naqis (jadwal al-mawad aw al-fawatir) - shaghil discover-ameen-purchase-schema.ps1 awlan."
    exit 1
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    # --- المخزون المحسوب من حركة الفواتير (لا من ms000 مباشرة) ---
    # ملاحظة: الاستعلام أدناه توضيحي فقط بأسماء الأعمدة المتوقعة — يجب تعديله
    # فعلياً بعد مراجعة مخرجات discover-ameen-purchase-schema.ps1 الحقيقية.
    $stockQuery = @"
SELECT
    m.ItemKey                                              AS item_key,
    CONVERT(varchar(36), m.GUID)                           AS item_guid,
    LTRIM(RTRIM(m.ItemNumber))                              AS item_number,
    LTRIM(RTRIM(m.Name))                                    AS item_name,
    m.Unit1Name                                             AS unit1_name,
    m.Unit2Name                                             AS unit2_name,
    m.Unit2Factor                                           AS unit2_factor,
    SUM(CASE WHEN bt.bIsInput = 1 THEN bd.Qty ELSE -bd.Qty END) AS stock_unit1
FROM $($cfg.ameenBillLineTable) bd
JOIN $($cfg.ameenBillHeaderTable) bu ON bu.GUID = bd.BillGUID
JOIN dbo.bt000 bt ON bt.GUID = bu.TypeGUID
JOIN $($cfg.ameenMaterialTable) m ON m.GUID = bd.ItemGUID
GROUP BY m.ItemKey, m.GUID, m.ItemNumber, m.Name, m.Unit1Name, m.Unit2Name, m.Unit2Factor
"@

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $stockQuery
    $cmd.CommandTimeout = 120
    $reader = $cmd.ExecuteReader()
    $rows = New-Object System.Collections.Generic.List[object]
    while ($reader.Read()) {
        $rows.Add(@{
            item_key     = [string]$reader["item_key"]
            item_guid    = [string]$reader["item_guid"]
            item_number  = [string]$reader["item_number"]
            item_name    = [string]$reader["item_name"]
            unit1_name   = [string]$reader["unit1_name"]
            unit2_name   = [string]$reader["unit2_name"]
            unit2_factor = [double]$reader["unit2_factor"]
            stock_unit1  = [double]$reader["stock_unit1"]
            generated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        })
    }
    $reader.Close()
    $conn.Close()

    Write-Log "thm tjhyz lqta l- $($rows.Count) mada (DryRun oncoming: $(-not $Apply))"

    if (-not $Apply) {
        Write-Log "wad3 al-tjruba (DryRun): lm ytm al-raf3 ila Supabase."
        exit 0
    }

    if (-not $apiKey -or -not $syncEmail -or -not $syncPassword) {
        Write-Log "khata: bayanat Supabase (apiKey/email/password) ghyr mwjuda - la ymkn al-raf3 al-fi3li."
        exit 1
    }

    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" -TimeoutSec 30 `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))

    $authHeaders = @{
        apikey            = $apiKey
        Authorization     = "Bearer $($session.access_token)"
        Prefer            = "resolution=merge-duplicates,return=minimal"
        "Accept-Profile"  = "public"
        "Content-Profile" = "public"
    }

    $json = $rows.ToArray() | ConvertTo-Json -Depth 4 -Compress
    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/$($cfg.itemSnapshotTable)?on_conflict=item_key" `
        -Headers $authHeaders -ContentType "application/json; charset=utf-8" -TimeoutSec 60 `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | Out-Null

    Write-Log "thm raf3 lqtat al-asnaf bnja7 ($($rows.Count) mada)"
    exit 0
} catch {
    Write-Log "khata (str $($_.InvocationInfo.ScriptLineNumber)): $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Log ("tfsyl: " + $_.Exception.InnerException.Message) }
    exit 1
}
