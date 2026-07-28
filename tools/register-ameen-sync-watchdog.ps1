# يسجّل مهمة مجدولة تتفقد سلسلة مزامنة الأمين كل 5 دقائق وتعالج التوقف تلقائياً.
# التشغيل: .\tools\register-ameen-sync-watchdog.ps1
#
# ملاحظتان مقصودتان:
#   - المهمة تشير دائماً إلى نسخة المستودع الأساسي، لا إلى مجلد worktree مؤقت قد يُحذف.
#   - لا ملفات وسيطة في C:\tmp (قابلة للكتابة من أي مستخدم)؛ نستدعي powershell.exe مباشرة
#     كما تفعل مهمة «TOBACCO Invoice Series Push».
param(
  [string]$TaskName = "TOBACCO Sync Watchdog",
  [int]$IntervalMinutes = 5,
  [string]$SqlHost = "OZK-TOBACCO",
  [int]$SqlPort = 1433,
  [string]$WatchdogPath = "C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web\tools\ensure-ameen-sync.ps1"
)

$ErrorActionPreference = "Stop"

# ---------- التحقق من المسار ----------
# قائمة سماح صارمة بدل استبعاد أنماط: نمنع تسجيل أي شيء عدا هذا الملف بعينه.
# الاستبعاد النصي وحده لا يكفي لأن Resolve-Path لا يكشف الهدف النهائي خلف
# junction/symlink أو محرك subst أو مسار 8.3 المختصر أو مشاركة UNC باسم مستعار.
$allowedWatchdogPath = "C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web\tools\ensure-ameen-sync.ps1"

if (-not [System.IO.Path]::IsPathRooted($WatchdogPath)) {
  throw "Watchdog path must be absolute: $WatchdogPath"
}
if ($WatchdogPath.StartsWith("\\") -or $WatchdogPath.StartsWith("//")) {
  throw "Refusing a UNC watchdog path: $WatchdogPath"
}

$item = Get-Item -LiteralPath $WatchdogPath -Force -ErrorAction SilentlyContinue
if (-not $item) {
  throw "Watchdog script not found: $WatchdogPath`nادمج الفرع في main أولاً."
}
if ($item.PSProvider.Name -ne "FileSystem") {
  throw "Watchdog path is not on the FileSystem provider: $WatchdogPath"
}
if ($item.PSIsContainer) {
  throw "Watchdog path must be a file, not a directory: $WatchdogPath"
}

# FullName يحتفظ بحالة الأحرف كما كتبها المستدعي، لا كما هي على القرص فعلاً،
# فالمقارنة النصية وحدها غير كافية: مجلد مفعّل عليه case sensitivity (علم WSL)
# قد يحوي ملفين باسمين يختلفان بالحالة فقط. نبني المسار القانوني مقطعاً مقطعاً
# من الدليل نفسه، ونفحص في الطريق كل مقطع بحثاً عن نقطة ارتباط.
function Get-CanonicalWatchdogPath([string]$Path) {
  $root = [System.IO.Path]::GetPathRoot($Path)
  if (-not $root) { throw "Cannot determine path root: $Path" }
  $canonical = $root.ToUpperInvariant()
  $rest = $Path.Substring($root.Length).Trim("\")
  foreach ($segment in $rest.Split("\")) {
    if (-not $segment) { continue }
    $candidates = @(Get-ChildItem -LiteralPath $canonical -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $segment })
    if ($candidates.Count -eq 0) {
      throw "Path segment not found on disk: $segment (under $canonical)"
    }
    if ($candidates.Count -gt 1) {
      # أكثر من تطابق = المجلد حسّاس لحالة الأحرف؛ لا نقبل إلا التطابق الحرفي التام
      $exact = @($candidates | Where-Object { $_.Name.Equals($segment, [StringComparison]::Ordinal) })
      if ($exact.Count -ne 1) {
        throw "Ambiguous case-sensitive path segment: $segment (under $canonical)"
      }
      $candidates = $exact
    }
    $entry = $candidates[0]
    if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq [System.IO.FileAttributes]::ReparsePoint) {
      throw "Refusing a path that crosses a reparse point (junction/symlink): $($entry.FullName)"
    }
    $canonical = Join-Path $canonical $entry.Name
  }
  return $canonical
}

$resolvedWatchdogPath = Get-CanonicalWatchdogPath $item.FullName
# مقارنة حرفية (Ordinal) على المسار القانوني — لا OrdinalIgnoreCase
if (-not $resolvedWatchdogPath.Equals($allowedWatchdogPath, [StringComparison]::Ordinal)) {
  throw "Refusing to register a task for an unexpected path.`nالمسموح فقط: $allowedWatchdogPath`nالمُعطى: $resolvedWatchdogPath"
}

# hard link: اسم ثانٍ لنفس بيانات الملف، لا يكشفه أي فحص مسار.
# وجود أكثر من رابط يعني أن محتوى الملف المعتمد قابل للتحكم من اسم خارج المستودع.
$linkOutput = & (Join-Path $env:SystemRoot "System32\fsutil.exe") hardlink list $resolvedWatchdogPath 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Could not verify hard links for: $resolvedWatchdogPath`n$($linkOutput | Out-String)"
}
$links = @($linkOutput | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
if ($links.Count -ne 1) {
  throw ("Refusing a watchdog file with $($links.Count) hard links:" + [Environment]::NewLine + ($links -join [Environment]::NewLine))
}

# محرك الوجهة يجب أن يكون قرصاً ثابتاً محلياً — يستبعد أقراص الشبكة المربوطة.
$driveInfo = New-Object System.IO.DriveInfo ([System.IO.Path]::GetPathRoot($resolvedWatchdogPath))
if ($driveInfo.DriveType -ne [System.IO.DriveType]::Fixed) {
  throw "Refusing a watchdog path on a $($driveInfo.DriveType) drive: $resolvedWatchdogPath"
}

# ملاحظة TOCTOU: بين هذا الفحص ولحظة التسجيل تبقى نافذة نظرية لاستبدال الملف.
# تقليصها يقتضي قفل الملف، وهو غير متاح لمهمة مجدولة تنفّذه لاحقاً على أي حال —
# الحماية الفعلية هي صلاحيات مجلد tools نفسه.

$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$resolvedWatchdogPath`" -SqlHost $SqlHost -SqlPort $SqlPort"
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments

$startAt = (Get-Date).Date.AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $startAt
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $startAt `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)).Repetition
# فراغ = تكرار بلا نهاية (TimeSpan::MaxValue يرفضه Task Scheduler)
$trigger.Repetition.Duration = ""

# شرطا البطارية معطّلان صراحةً — وإلا توقف الحارس نفسه عند فصل الشاحن
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description "يتفقد سلسلة مزامنة الأمين ويعالج التوقف تلقائياً" -Force | Out-Null

Write-Host "Scheduled task registered: $TaskName"
Write-Host "Script: $resolvedWatchdogPath"
Write-Host "It will check the Ameen sync chain every $IntervalMinutes minute(s) against $SqlHost`:$SqlPort."
