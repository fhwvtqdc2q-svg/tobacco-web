# سحب يومي لآخر نسخة من GitHub — يعمل فقط عندما يكون المستودع نظيفاً ولا توجد مهمة ذكاء اصطناعي نشطة.
# لا يلمس أي تعديلات غير محفوظة أبداً؛ عند وجودها ينسحب بصمت ويسجّل السبب.
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$logDirectory = Join-Path $projectRoot "tools\logs"
if (-not (Test-Path -LiteralPath $logDirectory)) {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
}
$logPath = Join-Path $logDirectory "daily-git-pull.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
  $dirty = git status --porcelain
  if ($dirty) {
    Add-Content -LiteralPath $logPath -Value "$stamp SKIP: uncommitted changes present"
    exit 0
  }

  $activeTaskPath = Join-Path $projectRoot "AI_ACTIVE_TASK.json"
  if (Test-Path -LiteralPath $activeTaskPath) {
    $activeTask = Get-Content -LiteralPath $activeTaskPath -Raw | ConvertFrom-Json
    if ($activeTask.status -eq "active") {
      Add-Content -LiteralPath $logPath -Value "$stamp SKIP: active AI task lock"
      exit 0
    }
  }

  $output = git pull --rebase origin main 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git pull failed: $($output -join ' | ')" }
  Add-Content -LiteralPath $logPath -Value "$stamp OK: $($output -join ' | ')"
} catch {
  Add-Content -LiteralPath $logPath -Value "$stamp FAIL: $($_.Exception.Message)"
  $notifyPath = Join-Path $PSScriptRoot "send-telegram-notification.ps1"
  if (Test-Path -LiteralPath $notifyPath) {
    & $notifyPath -Message "🚨 فشل السحب اليومي من GitHub على جهاز Windows: $($_.Exception.Message)" -EventType "windows" -DedupeKey "daily-git-pull-fail" -DedupeMinutes 360
  }
  exit 1
}
