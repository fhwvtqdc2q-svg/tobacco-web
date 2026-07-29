# ============================================================
# sync-purchase-invoices-to-ameen.ps1
# عامل الكتابة: يقرأ فواتير المشتريات بحالة status='sync_pending' من Supabase
# ويكتبها كمستندات فعلية في قاعدة الأمين (bu000/bd000 حسب config)، ثم يتحقق
# من نجاح الكتابة بإعادة قراءة المستند من الأمين قبل تعليم الفاتورة synced.
#
# ⚠️ حالة هذا الملف: مسودة تصميم فقط ضمن فرع purchase-invoices-ameen-v2.
# هذا الملف لا يُشغَّل إطلاقاً في هذه المرحلة — لا DryRun ولا Apply، ولا يُسجَّل
# كمهمة مجدولة. يكتب في قاعدة محاسبية حقيقية (الأمين) وهذا يتطلب موافقة صريحة
# ومكتوبة من المالك (ozk.kh@outlook.com) على كل GUID/حساب/صندوق مستخدم، بعد
# اختبار مطوّل بوضع DryRun فقط من قبل المستخدم نفسه على جهاز LOQ.
#
# مبادئ التصميم المُلزمة عند التفعيل مستقبلاً (موثّقة هنا كي لا تُنسى):
#   - معاملة SQL واحدة (transaction) لكل فاتورة — commit كامل أو rollback كامل.
#   - فحص idempotency_key/ameen_document_guid قبل الكتابة (لا كتابة مزدوجة عند
#     إعادة تشغيل العامل بعد انقطاع).
#   - التحقق (verify) من المستند المكتوب فعلياً في الأمين قبل تعليم الفاتورة
#     "synced" في Supabase — لا "افتراض نجاح" لمجرد عدم رمي استثناء.
#   - عند الفشل: تسجيل sync_error وترقية sync_attempts وحالة failed فقط — أبداً
#     لا تراجع عن approved/sync_pending نحو draft.
#   - لا افتراض BillTypeGuid/حساب مورد/صندوق افتراضي — كلها تُقرأ من
#     ameen-purchase-config.json بعد اكتشاف فعلي موثّق.
# ============================================================
param(
    [switch]$DryRun,
    [switch]$Apply,
    [string]$ConfigFile = "$PSScriptRoot\ameen-purchase-config.json",
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$LogFile = "$PSScriptRoot\logs\purchase-invoices-sync.log"
)

$ErrorActionPreference = "Stop"

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    $dir = Split-Path $LogFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

# ---------- قفل أمان صريح: هذا العامل معطّل بالكامل خلال مرحلة التطوير ----------
Write-Log "khata: 3ml al-mzamna hatha m3atal 3md an fi marhalat al-tatwyr - la yktb fi al-amyn abdan."
Write-Log "yhtaj mwafqa sry7a wa mktuba mn al-malk qbl ay tfy3l, w-ikhtbar DryRun mtwal ydwy awlan."
exit 1

# ============================================================
# لا كود قابل للتنفيذ بعد هذه النقطة (exit 1 أعلاه غير مشروط). القسم أدناه
# مسودة تصميم فقط لتوثيق الشكل المتوقع لاحقاً — لا تُزال علامة exit 1 أعلاه
# إلا بقرار وموافقة صريحين من المالك.
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

if (-not $cfg.ameenPurchaseBillTypeGuid -or -not $cfg.defaultTreasuryAccountGuid) {
    Write-Log "khata: config naqis (BillTypeGuid aw TreasuryAccountGuid) - la tqdm."
    exit 1
}

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"

if (-not $connStr) { Write-Log "khata: AMEEN_SQL_CONNECTION_STRING ghyr mwjwd."; exit 1 }
if (-not $apiKey -or -not $syncEmail -or -not $syncPassword) { Write-Log "khata: bayanat Supabase naqisa."; exit 1 }

try {
    # 1) تسجيل الدخول وقراءة الفواتير sync_pending من Supabase
    $loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
    $session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
        -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" -TimeoutSec 30 `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))

    $authHeaders = @{
        apikey            = $apiKey
        Authorization     = "Bearer $($session.access_token)"
        "Accept-Profile"  = "public"
        "Content-Profile" = "public"
    }

    $pending = Invoke-RestMethod -Method Get `
        -Uri "$supabaseUrl/rest/v1/$($cfg.supabaseTable)?status=eq.sync_pending&select=*" `
        -Headers $authHeaders -TimeoutSec 30

    Write-Log "3dd al-fawatir sync_pending: $($pending.Count)"
    if ($pending.Count -eq 0) { exit 0 }

    Add-Type -AssemblyName "System.Data"

    foreach ($invoice in $pending) {
        Write-Log "mu3alja fatura id=$($invoice.id) idempotency_key=$($invoice.idempotency_key)"

        $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
        $conn.Open()
        $tx = $conn.BeginTransaction()
        try {
            # 2) فحص idempotency: هل كُتب هذا المستند سابقاً بنفس المفتاح؟
            #    (يتطلب عمود مخصص في bu000 أو جدول ربط — يُحدَّد بعد discover script)
            # ... منطق الكتابة الفعلي يُضاف هنا لاحقاً فقط بعد اعتماد البنية ...

            if (-not $Apply) {
                Write-Log "  [DryRun] lm yktb shy2 fi3ly - mu7akat faqat."
                $tx.Rollback()
                continue
            }

            # 3) commit فقط بعد التحقق (verify) من المستند المكتوب
            $tx.Commit()
            Write-Log "  thm al-ktaba w-al-t7qq bnja7 - t3lym al-fatura synced fi Supabase."
        } catch {
            $tx.Rollback()
            Write-Log "  fashl mu3alja al-fatura id=$($invoice.id): $($_.Exception.Message)"
        } finally {
            $conn.Close()
        }
    }

    exit 0
} catch {
    Write-Log "khata 3ama (str $($_.InvocationInfo.ScriptLineNumber)): $($_.Exception.Message)"
    if ($_.Exception.InnerException) { Write-Log ("tfsyl: " + $_.Exception.InnerException.Message) }
    exit 1
}
