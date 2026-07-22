# سحب يومي لآخر نسخة من GitHub — يعمل فقط عندما يكون المستودع نظيفاً ولا توجد مهمة ذكاء اصطناعي نشطة.
# متوافق مع Windows PowerShell 5.1 (تشغّله مهمة «TOBACCO Daily Git Pull» عبر register-daily-git-pull-task.ps1).
$ErrorActionPreference = "Continue"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$logDirectory = Join-Path $projectRoot "tools\logs"
if (-not (Test-Path -LiteralPath $logDirectory)) {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
}
$logPath = Join-Path $logDirectory "daily-git-pull.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Send-FailureAlert([string]$Reason) {
  $notifyPath = Join-Path $PSScriptRoot "send-telegram-notification.ps1"
  if (Test-Path -LiteralPath $notifyPath) {
    & $notifyPath -Message ("فشل السحب اليومي من GitHub على جهاز Windows: " + $Reason) -EventType "windows" -DedupeKey "daily-git-pull-fail" -DedupeMinutes 360
  }
}

$dirty = git status --porcelain 2>$null
if ($LASTEXITCODE -ne 0) {
  Add-Content -LiteralPath $logPath -Value "$stamp FAIL: git status failed"
  Send-FailureAlert "git status failed"
  exit 1
}
if ($dirty) {
  Add-Content -LiteralPath $logPath -Value "$stamp SKIP: uncommitted changes present"
  exit 0
}

$activeTaskPath = Join-Path $projectRoot "AI_ACTIVE_TASK.json"
if (Test-Path -LiteralPath $activeTaskPath) {
  try {
    $activeTask = Get-Content -LiteralPath $activeTaskPath -Raw | ConvertFrom-Json
    if ($activeTask.status -eq "active") {
      Add-Content -LiteralPath $logPath -Value "$stamp SKIP: active AI task lock"
      exit 0
    }
  } catch {
    Add-Content -LiteralPath $logPath -Value "$stamp WARN: could not parse AI_ACTIVE_TASK.json"
  }
}

# ملاحظة PowerShell 5.1: git يكتب رسائل عادية على stderr، ومع 2>&1 تصير كائنات خطأ —
# نحوّلها إلى نص ونحكم على النجاح برمز الخروج فقط.
$outputLines = & git pull --rebase origin main 2>&1 | ForEach-Object { "$_" }
$outputText = ($outputLines | Select-Object -Last 3) -join " | "
if ($LASTEXITCODE -ne 0) {
  Add-Content -LiteralPath $logPath -Value "$stamp FAIL: $outputText"
  Send-FailureAlert $outputText
  git rebase --abort 2>$null | Out-Null
  exit 1
}
Add-Content -LiteralPath $logPath -Value "$stamp OK: $outputText"
exit 0
