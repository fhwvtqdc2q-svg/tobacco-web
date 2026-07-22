# يسحب أحدث نسخة احتياطية لكل قاعدة أمين من مشاركة خادم المحل إلى OneDrive على هذا الجهاز.
# المصدر المتوقع: \\OZK-TOBACCO\AmeenBackup (مشاركة لمجلد "D:\Ameen backup" على الخادم).
# إذا لم تكن المشاركة مفعّلة بعد، ينسحب بصمت — يبدأ العمل تلقائياً فور تفعيلها.
# متوافق مع Windows PowerShell 5.1. تشغّله مهمة «TOBACCO Ameen Backup Pull» يومياً.
$ErrorActionPreference = "Continue"

$sharePath = "\\OZK-TOBACCO\AmeenBackup"
$projectRoot = Split-Path -Parent $PSScriptRoot

$logDirectory = Join-Path $projectRoot "tools\logs"
if (-not (Test-Path -LiteralPath $logDirectory)) {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
}
$logPath = Join-Path $logDirectory "ameen-backup-pull.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Send-Alert([string]$Message, [string]$Key, [int]$Minutes) {
  $notifyPath = Join-Path $PSScriptRoot "send-telegram-notification.ps1"
  if (Test-Path -LiteralPath $notifyPath) {
    & $notifyPath -Message $Message -EventType "windows" -DedupeKey $Key -DedupeMinutes $Minutes
  }
}

if (-not (Test-Path -LiteralPath $sharePath)) {
  Add-Content -LiteralPath $logPath -Value "$stamp SKIP: share not reachable ($sharePath)"
  exit 0
}

$files = Get-ChildItem -LiteralPath $sharePath -Recurse -Filter "*.dat" -File -ErrorAction SilentlyContinue
if (-not $files) {
  Add-Content -LiteralPath $logPath -Value "$stamp WARN: share reachable but no .dat files found"
  Send-Alert "لا توجد ملفات نسخ احتياطي في مشاركة الأمين رغم توفرها" "ameen-backup-empty" 1440
  exit 0
}

$newest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newest.LastWriteTime -lt (Get-Date).AddDays(-3)) {
  Send-Alert ("آخر نسخة احتياطية للأمين على الخادم قديمة (" + $newest.LastWriteTime.ToString("yyyy-MM-dd HH:mm") + ") — تأكد أن النسخ يعمل") "ameen-backup-stale" 1440
}

$destRoot = Join-Path $env:OneDrive "AmeenBackups"
if (-not $env:OneDrive) { $destRoot = "C:\Users\LOQ\Documents\AmeenBackups" }
if (-not (Test-Path -LiteralPath $destRoot)) {
  New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
}

$copied = @()
$groups = $files | Group-Object { if ($_.Name -match "_(Amn[A-Za-z0-9]+)_") { $matches[1] } else { "Other" } }
foreach ($group in $groups) {
  $latest = $group.Group | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $target = Join-Path $destRoot $latest.Name
  if (-not (Test-Path -LiteralPath $target)) {
    try {
      Copy-Item -LiteralPath $latest.FullName -Destination $target -Force
      $copied += $latest.Name
    } catch {
      Add-Content -LiteralPath $logPath -Value "$stamp FAIL copy $($latest.Name): $($_.Exception.Message)"
      Send-Alert ("فشل نسخ الاحتياطي " + $latest.Name + ": " + $_.Exception.Message) "ameen-backup-copy-fail" 360
    }
  }

  # تنظيف: احتفظ بأحدث 3 نسخ لكل قاعدة، واحذف الأقدم من 14 يوماً فيما زاد عنها
  $existing = Get-ChildItem -LiteralPath $destRoot -Filter ("*_" + $group.Name + "_*.dat") -File | Sort-Object LastWriteTime -Descending
  if ($existing.Count -gt 3) {
    $existing | Select-Object -Skip 3 | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

if ($copied.Count -gt 0) {
  Add-Content -LiteralPath $logPath -Value "$stamp OK: copied $($copied -join ', ')"
} else {
  Add-Content -LiteralPath $logPath -Value "$stamp OK: nothing new to copy"
}
exit 0
