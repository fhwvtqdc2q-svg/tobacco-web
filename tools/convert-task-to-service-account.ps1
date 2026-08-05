# يحوّل مهمة مجدولة واحدة لتعمل بحساب خدمة مخصص بلا تسجيل دخول (LogonType=Password).
# التشغيل (كمسؤول، بعد إنشاء الحساب وضبط كلمة مروره):
#   .\tools\convert-task-to-service-account.ps1
#
# لماذا Password لا S4U: المهام تحتاج اتصالاً شبكياً بجهاز الأمين وبـSupabase،
# وS4U قد يحرم العملية من اعتماديات الشبكة.
#
# السكربت لا يُنشئ الحساب ولا يضبط كلمة مروره — يفعل ذلك المالك بنفسه.
# كلمة المرور تُطلب تفاعلياً كـSecureString، ولا تُطبع ولا تُكتب في أي ملف.
param(
  [string]$TaskName = "TOBACCO Approved Prices Pull",
  [string]$User = "OZKSync",
  [string]$RepoRoot = "C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web",
  [ValidateSet("Limited", "Highest")][string]$RunLevel = "Limited",
  [switch]$GrantFilesystemAccess,
  [switch]$SkipBatchLogonRight
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "شغّل هذا السكربت من نافذة PowerShell بصلاحيات مسؤول."
}

# ---------- 1) الحساب ----------
$localUser = Get-LocalUser -Name $User -ErrorAction SilentlyContinue
if (-not $localUser) {
  throw "الحساب المحلي «$User» غير موجود. أنشئه أولاً واضبط كلمة مروره، ثم أعد التشغيل."
}
if (-not $localUser.Enabled) {
  throw "الحساب «$User» معطّل — فعّله أولاً."
}
if ($localUser.PasswordExpires) {
  Write-Warning "كلمة مرور «$User» لها تاريخ انتهاء ($($localUser.PasswordExpires)) — عند انتهائها تتوقف المهمة صامتة."
}

$machineUser = "$env:COMPUTERNAME\$User"
$sid = $localUser.SID.Value

# ---------- 2) المهمة والحالة الحالية (للتراجع) ----------
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { throw "المهمة «$TaskName» غير مسجّلة." }

$before = [pscustomobject]@{
  TaskName  = $TaskName
  TaskPath  = $task.TaskPath
  UserId    = $task.Principal.UserId
  LogonType = "$($task.Principal.LogonType)"
  RunLevel  = "$($task.Principal.RunLevel)"
}
Write-Host "الحالة قبل التحويل:" -ForegroundColor Cyan
$before | Format-List | Out-String | Write-Host

$backupDirectory = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path -LiteralPath $backupDirectory)) {
  New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupDirectory ("task-backup-" + ($TaskName -replace '[^\w\-]', '-') + "-$stamp.xml")
Export-ScheduledTask -TaskName $TaskName | Set-Content -LiteralPath $backupPath -Encoding UTF8
Write-Host "نسخة احتياطية من تعريف المهمة: $backupPath" -ForegroundColor DarkGray

# سكربت تراجع مولّد بدل سطر مطبوع: يحفظ TaskPath، ويطلب كلمة المرور
# فقط إن كان نوع الدخول الأصلي Password (وإلا لا يحتاجها أصلاً).
# كل قيمة مضمّنة تمرّ عبر ConvertTo-PsLiteral: الفاصلة العليا داخل اسم المهمة
# أو TaskPath أو اسم الحساب تُضاعَف، وإلا خرج سكربت تراجع غير صالح نحوياً.
function ConvertTo-PsLiteral([string]$Value) {
  return "'" + ($Value -replace "'", "''") + "'"
}
# قيمة فيها سطر جديد تخرج من التعليق وتصير كوداً منفّذاً، فنطوي كل فراغ إلى مسافة.
function ConvertTo-CommentSafe([string]$Value) {
  return ($Value -replace '\s+', ' ').Trim()
}
$rollbackPath = [IO.Path]::ChangeExtension($backupPath, ".rollback.ps1")
$rollbackLines = @(
  "# تراجع مولّد تلقائياً — يعيد المهمة إلى حالتها قبل التحويل"
  ("# الحالة الأصلية: UserId=" + (ConvertTo-CommentSafe $before.UserId) +
   " LogonType=" + (ConvertTo-CommentSafe $before.LogonType) +
   " RunLevel=" + (ConvertTo-CommentSafe $before.RunLevel))
  '$ErrorActionPreference = "Stop"'
  ('$xml = Get-Content -Raw -LiteralPath ' + (ConvertTo-PsLiteral $backupPath))
  ('$taskName = ' + (ConvertTo-PsLiteral $TaskName))
  ('$taskPath = ' + (ConvertTo-PsLiteral $before.TaskPath))
  ('$user = ' + (ConvertTo-PsLiteral $before.UserId))
  ('$originalLogonType = ' + (ConvertTo-PsLiteral $before.LogonType))
  'if ($originalLogonType -eq "Password") {'
  '  $secure = Read-Host -Prompt "كلمة مرور $user" -AsSecureString'
  '  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)'
  '  try {'
  '    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)'
  '    Register-ScheduledTask -Xml $xml -TaskName $taskName -TaskPath $taskPath -User $user -Password $plain -Force | Out-Null'
  '  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $plain = $null }'
  '} else {'
  '  Register-ScheduledTask -Xml $xml -TaskName $taskName -TaskPath $taskPath -User $user -Force | Out-Null'
  '}'
  '$restored = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath'
  '[pscustomobject]@{ UserId = $restored.Principal.UserId; LogonType = "$($restored.Principal.LogonType)"; RunLevel = "$($restored.Principal.RunLevel)" } | Format-List'
)
# BOM إلزامي: powershell.exe 5.1 يقرأ الملف بلا BOM بترميز ANSI فتنكسر العربية داخل السلاسل
[IO.File]::WriteAllLines($rollbackPath, [string[]]$rollbackLines, (New-Object System.Text.UTF8Encoding $true))
Write-Host "سكربت التراجع: $rollbackPath" -ForegroundColor DarkGray

# ---------- 3) حق «Log on as a batch job» ----------
# لا يوجد cmdlet أصلي لهذا الحق — نستعمل secedit تصديراً وتعديلاً واستيراداً.
if (-not $SkipBatchLogonRight) {
  $exportPath = Join-Path $env:TEMP "secpol-$stamp.inf"
  $dbPath     = Join-Path $env:TEMP "secpol-$stamp.sdb"
  & secedit.exe /export /cfg $exportPath /areas USER_RIGHTS | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "فشل تصدير سياسة الأمان عبر secedit." }

  $policy = Get-Content -LiteralPath $exportPath
  $line = $policy | Where-Object { $_ -match '^SeBatchLogonRight\s*=' }
  if (-not $line) { $line = "SeBatchLogonRight = " }

  # لا مطابقة نصية جزئية: SID ينتهي بـ1001 يقع داخل آخر ينتهي بـ10010.
  # نفصل القيمة على الفواصل ونقارن كل مُدخَل حرفياً بعد إزالة البادئة *.
  $current = ($line -split '=', 2)[1].Trim()
  $existing = @($current -split ',' | ForEach-Object { $_.Trim().TrimStart('*') } | Where-Object { $_ })
  $alreadyGranted = @($existing | Where-Object { $_.Equals($sid, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0

  if ($alreadyGranted) {
    Write-Host "الحساب يملك «Log on as a batch job» أصلاً." -ForegroundColor Green
  } else {
    # ملف INF يستبدل قيمة SeBatchLogonRight بالكامل، فنعيد كتابة القائمة الحالية كلها مضافاً إليها الحساب
    $updated = if ($current) { "SeBatchLogonRight = $current,*$sid" } else { "SeBatchLogonRight = *$sid" }
    $body = @(
      "[Unicode]"
      "Unicode=yes"
      "[Version]"
      'signature="$CHICAGO$"'
      "Revision=1"
      "[Privilege Rights]"
      $updated
    )
    $importPath = Join-Path $env:TEMP "secpol-import-$stamp.inf"
    Set-Content -LiteralPath $importPath -Value $body -Encoding Unicode
    & secedit.exe /configure /db $dbPath /cfg $importPath /areas USER_RIGHTS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "فشل منح «Log on as a batch job» عبر secedit." }
    Remove-Item -LiteralPath $importPath -Force -ErrorAction SilentlyContinue
    Write-Host "مُنح «Log on as a batch job» للحساب $machineUser" -ForegroundColor Green
  }
  Remove-Item -LiteralPath $exportPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $dbPath -Force -ErrorAction SilentlyContinue
}

# ---------- 4) صلاحيات الملفات ----------
# مجلد المستودع تحت ملف تعريف LOQ، فلا وصول لحساب آخر افتراضياً:
# لا قراءة tools\.env ولا كتابة tools\logs و reports\prices.
# Modify على المستودع كله واسع جداً (يتيح تعديل الكود نفسه)، فنفصل:
#   قراءة وتنفيذ على الجذر — يكفي لتشغيل السكربتات وقراءة tools\.env
#   كتابة فقط على المجلدين اللذين تكتب فيهما المزامنة
if ($GrantFilesystemAccess) {
  if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "مجلد المستودع غير موجود: $RepoRoot" }

  function Grant-FolderAccess([string]$Folder, [string]$Rights) {
    if (-not (Test-Path -LiteralPath $Folder)) {
      New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    }
    $acl = Get-Acl -LiteralPath $Folder
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $machineUser, $Rights, "ContainerInherit, ObjectInherit", "None", "Allow")
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Folder -AclObject $acl
    Write-Host "مُنح $machineUser صلاحية $Rights على $Folder" -ForegroundColor Green
  }

  Grant-FolderAccess $RepoRoot "ReadAndExecute"
  # من $RepoRoot لا $PSScriptRoot: المهمة تشغّل سكربتات المستودع الأصلي،
  # فلو نُفّذ هذا السكربت من نسخة worktree لمُنحت الصلاحية لمجلد سجلّات خاطئ.
  Grant-FolderAccess (Join-Path $RepoRoot "tools\logs") "Modify"
  # مجلدا سجلّات منفصلان: معظم السكربتات تكتب في tools\logs، بينما
  # ameen-sync-agent.ps1 و ameen-daily-summary.ps1 تكتبان في ..\logs من جذر المستودع.
  Grant-FolderAccess (Join-Path $RepoRoot "logs") "Modify"
  Grant-FolderAccess (Join-Path $RepoRoot "reports\prices") "Modify"
  Write-Warning "انتبه: القراءة تشمل tools\.env (مفتاح Supabase وسلسلة الكتابة على الأمين) — لا مفر منها لأن السكربتات تقرأه."
} else {
  Write-Warning "لم تُمنح صلاحيات ملفات. إن لم يكن «$User» ضمن Administrators فستفشل المهمة بلا وصول — أعد التشغيل مع -GrantFilesystemAccess."
}

# ---------- 5) التحويل ----------
if ($RunLevel -eq "Highest") {
  Write-Warning "RunLevel=Highest يتطلب أن يكون «$User» ضمن Administrators."
}

$password = Read-Host -Prompt "كلمة مرور $machineUser" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if (-not $plain) { throw "لم تُدخل كلمة مرور." }

  # طبّق الحساب ونوع الدخول وRunLevel في عملية واحدة. كان الإصدار السابق
  # يحفظ بيانات الاعتماد أولاً، ثم يستدعي Set-ScheduledTask مرة ثانية لتعديل
  # RunLevel من دون تمرير كلمة المرور؛ فيفشل الاستدعاء الثاني بـ0x8007052e
  # رغم أن كلمة المرور الصحيحة حُفظت بالفعل.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $task.Principal.UserId = $machineUser
  $task.Principal.LogonType = "Password"
  $task.Principal.RunLevel = $RunLevel
  $task | Set-ScheduledTask -User $machineUser -Password $plain -ErrorAction Stop | Out-Null
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $plain = $null
  [GC]::Collect()
}

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "الحالة بعد التحويل:" -ForegroundColor Cyan
[pscustomobject]@{
  UserId    = $task.Principal.UserId
  LogonType = "$($task.Principal.LogonType)"
  RunLevel  = "$($task.Principal.RunLevel)"
} | Format-List | Out-String | Write-Host

if ("$($task.Principal.LogonType)" -ne "Password") {
  throw "التحويل لم ينجح: LogonType = $($task.Principal.LogonType) وليس Password."
}
if ("$($task.Principal.RunLevel)" -ne $RunLevel) {
  throw "التحويل لم ينجح: RunLevel = $($task.Principal.RunLevel) وليس $RunLevel."
}

Write-Host ""
Write-Host "التحقق المطلوب بعد ذلك:" -ForegroundColor Yellow
Write-Host ("  1) Start-ScheduledTask -TaskName " + (ConvertTo-PsLiteral $TaskName) + " ثم افحص LastTaskResult (المطلوب 0).")
Write-Host "  2) سجّل خروجاً فعلياً، انتظر دورة كاملة، ثم ارجع وافحص LastRunTime وسجل tools\logs."
Write-Host "  3) تأكد أن سحب الأسعار وكتابتها على الأمين تمّا فعلاً، لا أن المهمة انتهت بلا عمل."
Write-Host ""
Write-Host ("التراجع: powershell -NoProfile -ExecutionPolicy Bypass -File " + (ConvertTo-PsLiteral $rollbackPath)) -ForegroundColor DarkGray
