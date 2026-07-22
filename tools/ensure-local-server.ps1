# يتأكد أن سيرفر الموقع المحلي شغّال على المنفذ المحدد، ويعيد تشغيله مخفياً إذا توقف.
# يرسل تنبيه تيليغرام إذا فشلت إعادة التشغيل (مرة بالساعة كحد أقصى).
# تشغّله مهمة «TOBACCO Local Web Server» كل 5 دقائق (سجّلها عبر register-local-server-watchdog.ps1).
param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot

$logDirectory = Join-Path $projectRoot "tools\logs"
if (-not (Test-Path -LiteralPath $logDirectory)) {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
}
$logPath = Join-Path $logDirectory "local-server-watchdog.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Send-ReviveFailureAlert([string]$Reason) {
  $notifyPath = Join-Path $PSScriptRoot "send-telegram-notification.ps1"
  if (Test-Path -LiteralPath $notifyPath) {
    & $notifyPath -Message ("تعذّر إنعاش سيرفر الموقع المحلي على المنفذ " + $Port + " — " + $Reason + ". التطبيق سيفتح من الكاش، لكن افحص node على الجهاز.") -EventType "windows" -DedupeKey "local-server-revive-fail" -DedupeMinutes 60
  }
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  exit 0
}

$nodePath = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodePath)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
  } else {
    Add-Content -LiteralPath $logPath -Value "$stamp FAIL: node.exe not found"
    Send-ReviveFailureAlert "node.exe غير موجود"
    exit 1
  }
}

Start-Process -FilePath $nodePath -ArgumentList "scripts\serve.mjs" -WorkingDirectory $projectRoot -WindowStyle Hidden

# تحقق فعلي بعد المحاولة — لا نكتفي بإطلاق العملية
Start-Sleep -Seconds 3
$alive = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($alive) {
  Add-Content -LiteralPath $logPath -Value "$stamp restarted local server on port $Port"
  exit 0
}

Add-Content -LiteralPath $logPath -Value "$stamp FAIL: restart attempted but port $Port still down"
Send-ReviveFailureAlert "المحاولة جرت والمنفذ ما زال ميتاً"
exit 1
