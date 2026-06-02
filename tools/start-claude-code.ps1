# ============================================================
# start-claude-code.ps1
# يشغّل Claude Code داخل WSL على مجلد المشروع
# ============================================================

$projectPath = "C:\Users\DELL\Desktop\OZK-TOBACCO-web-platform"
$wslPath = "/mnt/c/Users/DELL/Desktop/OZK-TOBACCO-web-platform"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  OZK TOBACCO — Claude Code Launcher" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# التحقق من وجود WSL
$wslCheck = wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "خطأ: WSL غير مثبت او غير مفعّل." -ForegroundColor Red
    Write-Host "شغّل هذا الأمر كـ Administrator:" -ForegroundColor Yellow
    Write-Host "  wsl --install" -ForegroundColor White
    exit 1
}

# التحقق من وجود claude في WSL
$claudeCheck = wsl which claude 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "خطأ: Claude Code غير مثبت في WSL." -ForegroundColor Red
    Write-Host "شغّل داخل WSL:" -ForegroundColor Yellow
    Write-Host "  npm install -g @anthropic-ai/claude-code" -ForegroundColor White
    exit 1
}

Write-Host "تشغيل Claude Code على المشروع..." -ForegroundColor Green
Write-Host "المسار: $wslPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "اضغط Ctrl+C لإيقاف Claude Code" -ForegroundColor Gray
Write-Host ""

# تشغيل claude في WSL داخل مجلد المشروع
wsl bash -c "cd '$wslPath' && claude"
