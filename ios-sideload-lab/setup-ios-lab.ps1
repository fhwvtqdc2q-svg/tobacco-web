<#
.SYNOPSIS
    يهيّئ بيئة "مختبر الـ Sideloading" على ويندوز بضغطة واحدة.

.DESCRIPTION
    - ينشئ مجلد العمل  Desktop\ios-lab\
    - يتحقق من وجود Python 3 (ويقترح تثبيته عبر winget إن غاب)
    - ينزّل سكريبت inject_dylib.py من المستودع تلقائياً
    - ينشئ ملف dylib تجريبي فارغ (لاختبار خطوات الفكّ/النسخ/التغليف)
    - يطبع الخطوات التالية بوضوح

.NOTES
    للاستخدام التعليمي على تطبيقاتك الخاصة أو المفتوحة المصدر (مثل PPSSPP) فقط.
    لا تستخدمه لتعديل تطبيقات تجارية محمية بحقوق نشر.

.EXAMPLE
    # انقر بزر الفأرة الأيمن على الملف → "Run with PowerShell"
    # أو من PowerShell:
    powershell -ExecutionPolicy Bypass -File .\setup-ios-lab.ps1
#>

$ErrorActionPreference = 'Stop'

function Write-Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)        { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg)     { Write-Host "    !!  $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Magenta
Write-Host "   تهيئة مختبر iOS Sideloading على ويندوز" -ForegroundColor Magenta
Write-Host "==================================================" -ForegroundColor Magenta
Write-Host ""

# ---------------------------------------------------------------------------
# 1) إنشاء مجلد العمل على سطح المكتب
# ---------------------------------------------------------------------------
Write-Step 1 "إنشاء مجلد العمل ios-lab على سطح المكتب"
$desktop = [Environment]::GetFolderPath('Desktop')
$lab = Join-Path $desktop 'ios-lab'
if (-not (Test-Path $lab)) {
    New-Item -ItemType Directory -Path $lab | Out-Null
    Write-Ok "أُنشئ: $lab"
} else {
    Write-Ok "موجود مسبقاً: $lab"
}

# ---------------------------------------------------------------------------
# 2) التحقق من Python 3
# ---------------------------------------------------------------------------
Write-Step 2 "التحقق من وجود Python 3"
$python = $null
foreach ($cmd in @('python', 'python3', 'py')) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        try {
            $ver = & $cmd --version 2>&1
            if ($ver -match 'Python\s+3\.') { $python = $cmd; break }
        } catch { }
    }
}

if ($python) {
    $verText = (& $python --version 2>&1)
    Write-Ok "$verText  (الأمر: $python)"
} else {
    Write-Warn2 "لم يُعثر على Python 3."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        $answer = Read-Host "    هل تريد تثبيت Python 3 الآن عبر winget؟ (y/n)"
        if ($answer -eq 'y') {
            Write-Host "    ... جارٍ التثبيت (قد يستغرق دقائق)" -ForegroundColor Yellow
            winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
            Write-Warn2 "أغلق هذه النافذة وافتحها من جديد ليُحدَّث PATH، ثم أعد تشغيل السكريبت."
            Read-Host "    اضغط Enter للخروج"
            exit 0
        }
    }
    Write-Warn2 "ثبّت Python يدوياً من https://www.python.org/downloads/"
    Write-Warn2 "مهم: فعّل خانة 'Add Python to PATH' أثناء التثبيت، ثم أعد تشغيل هذا السكريبت."
    Read-Host "    اضغط Enter للخروج"
    exit 1
}

# ---------------------------------------------------------------------------
# 3) تنزيل inject_dylib.py
# ---------------------------------------------------------------------------
Write-Step 3 "إحضار سكريبت inject_dylib.py"
$injectPath = Join-Path $lab 'inject_dylib.py'
$rawUrl = 'https://raw.githubusercontent.com/fhwvtqdc2q-svg/tobacco-web/claude/ios-sideload-windows-1V1fF/ios-sideload-lab/inject_dylib.py'

# أولاً: إن كان السكريبت بجانب هذا الملف، انسخه مباشرة (بلا إنترنت)
$localCopy = Join-Path $PSScriptRoot 'inject_dylib.py'
if (Test-Path $localCopy) {
    Copy-Item $localCopy $injectPath -Force
    Write-Ok "نُسخ من المجلد المحلي."
} else {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $rawUrl -OutFile $injectPath -UseBasicParsing
        Write-Ok "نُزّل من المستودع."
    } catch {
        Write-Warn2 "تعذّر التنزيل التلقائي: $($_.Exception.Message)"
        Write-Warn2 "نزّله يدوياً من: $rawUrl"
        Write-Warn2 "واحفظه في: $injectPath"
    }
}

# ---------------------------------------------------------------------------
# 4) ملف dylib تجريبي فارغ (لاختبار خطوات الفكّ/النسخ/التغليف فقط)
# ---------------------------------------------------------------------------
Write-Step 4 "إنشاء ملف dylib تجريبي فارغ (placeholder)"
$testDylib = Join-Path $lab 'MyTweak.dylib'
if (-not (Test-Path $testDylib)) {
    New-Item -ItemType File -Path $testDylib | Out-Null
    Write-Ok "أُنشئ placeholder: MyTweak.dylib"
    Write-Warn2 "هذا ملف فارغ للاختبار فقط — استبدله بـ dylib حقيقي (من Theos) للحقن الفعلي."
} else {
    Write-Ok "موجود مسبقاً: MyTweak.dylib"
}

# ---------------------------------------------------------------------------
# الخلاصة والخطوات التالية
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "   اكتملت التهيئة بنجاح" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "مجلد العمل:  $lab" -ForegroundColor White
Write-Host ""
Write-Host "الخطوات التالية:" -ForegroundColor White
Write-Host "  1) نزّل PPSSPP.ipa من https://www.ppsspp.org/download/ (قسم iOS)"
Write-Host "     وضعه داخل المجلد:  $lab"
Write-Host ""
Write-Host "  2) (اختياري) ابنِ MyTweak.dylib حقيقية عبر Theos على WSL،"
Write-Host "     واستبدل بها الملف الفارغ."
Write-Host ""
Write-Host "  3) شغّل الحقن من داخل المجلد:"
Write-Host "         cd `"$lab`""                              -ForegroundColor Yellow
Write-Host "         $python inject_dylib.py PPSSPP.ipa MyTweak.dylib"  -ForegroundColor Yellow
Write-Host ""
Write-Host "  4) مرّر PPSSPP-patched.ipa عبر Sideloadly/AltStore على جهازك"
Write-Host "     لإعادة توقيعه وتثبيته على الآيفون."
Write-Host ""
Write-Warn2 "تذكير: للتطبيقات الخاصة بك أو المفتوحة المصدر فقط — لا تطبيقات تجارية محمية."
Write-Host ""

# افتح المجلد في مستكشف الملفات
try { Invoke-Item $lab } catch { }

Read-Host "اضغط Enter للإغلاق"
