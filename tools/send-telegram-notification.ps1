# ============================================================
# send-telegram-notification.ps1
# يرسل إشعاراً إلى تيليغرام عبر نظام الإشعارات المركزي في Supabase
# (يستدعي RPC: notify_telegram — الإرسال الفعلي يتم من قاعدة البيانات
#  عبر pg_cron خلال دقيقة كحد أقصى)
#
# الاستخدام:
#   .\tools\send-telegram-notification.ps1 -Message "نص الإشعار"
#   .\tools\send-telegram-notification.ps1 -Message "فشل المزامنة" `
#       -EventType "sync_failure" -DedupeKey "winfail:pull" -DedupeMinutes 60
#
# ملاحظة: السكريبت "best-effort" — لا يرمي استثناء أبداً حتى لا يكسر
# السكريبتات المستدعية له. فشل الإشعار لا يجب أن يفشل المزامنة.
# ============================================================

param(
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$EventType = "windows",
    [string]$DedupeKey = "",
    [int]$DedupeMinutes = 60,
    [string]$EnvFile = "$PSScriptRoot\.env"
)

try {
    # قراءة الإعدادات من tools\.env
    if (Test-Path $EnvFile) {
        Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
            $parts = $_ -split '=', 2
            [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
        }
    }

    $supabaseUrl = $env:SUPABASE_URL
    if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
    $supabaseUrl = $supabaseUrl.TrimEnd("/")

    # المفتاح: service key إن وُجد (الدالة محجوبة عن anon)
    $apiKey = $env:SUPABASE_SERVICE_KEY
    $token  = $apiKey

    if (-not $apiKey) {
        # بديل: مصادقة email/password (نفس نمط upload-report-to-supabase.ps1)
        $pubKey = $env:TOBACCO_SUPABASE_PUBLIC_KEY
        $email  = $env:TOBACCO_SYNC_EMAIL
        $pass   = $env:TOBACCO_SYNC_PASSWORD
        if (-not ($pubKey -and $email -and $pass)) {
            Write-Host "TELEGRAM-NOTIFY SKIPPED: no SUPABASE_SERVICE_KEY and no sync credentials" -ForegroundColor Yellow
            exit 0
        }
        $authBody = @{ email = $email; password = $pass } | ConvertTo-Json
        $auth = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
            -Headers @{ apikey = $pubKey; Accept = "application/json" } `
            -ContentType "application/json; charset=utf-8" -Body $authBody -TimeoutSec 20
        $apiKey = $pubKey
        $token  = $auth.access_token
        if (-not $token) {
            Write-Host "TELEGRAM-NOTIFY SKIPPED: authentication failed" -ForegroundColor Yellow
            exit 0
        }
    }

    $payload = @{
        p_event_type     = $EventType
        p_message        = $Message
        p_dedupe_minutes = $DedupeMinutes
    }
    if ($DedupeKey) { $payload["p_dedupe_key"] = $DedupeKey } else { $payload["p_dedupe_key"] = $null }
    $body = $payload | ConvertTo-Json -Depth 3

    $headers = @{
        apikey            = $apiKey
        Authorization     = "Bearer $token"
        "Content-Profile" = "public"
        Prefer            = "return=minimal"
    }

    Invoke-RestMethod -Method Post -Uri "$supabaseUrl/rest/v1/rpc/notify_telegram" `
        -Headers $headers -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20 | Out-Null

    Write-Host "TELEGRAM-NOTIFY OK ($EventType)" -ForegroundColor Green
    exit 0
} catch {
    # لا نفشل أبداً — الإشعار ثانوي، والمزامنة أهم
    Write-Host "TELEGRAM-NOTIFY FAILED: $($_.Exception.Message)" -ForegroundColor Yellow
    exit 0
}
