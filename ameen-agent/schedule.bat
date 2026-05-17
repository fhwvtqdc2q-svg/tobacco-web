@echo off
chcp 65001 >nul
echo إضافة مهمة يومية تلقائية في Windows Task Scheduler...

set SCRIPT_PATH=%~dp0ameen_agent.py
set PYTHON_PATH=python

:: جدولة تشغيل كل يوم الساعة 8 صباحاً
schtasks /create /tn "OZK-Ameen-Sync" /tr "%PYTHON_PATH% \"%SCRIPT_PATH%\"" /sc daily /st 08:00 /f

if errorlevel 1 (
    echo [خطأ] فشل إنشاء المهمة. جرب تشغيل الملف كـ Administrator
) else (
    echo [تم] ستعمل المزامنة تلقائياً كل يوم الساعة 8:00 صباحاً
    echo.
    echo لتغيير الوقت: افتح Task Scheduler وعدّل مهمة OZK-Ameen-Sync
    echo لتشغيل يدوي الآن: python ameen_agent.py
)
pause
