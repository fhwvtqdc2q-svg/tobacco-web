@echo off
chcp 65001 >nul
echo ══════════════════════════════════════
echo   OZK TOBACCO - Ameen Agent Setup
echo ══════════════════════════════════════
echo.

:: التحقق من Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [خطأ] Python غير مثبت.
    echo قم بتحميله من: https://www.python.org/downloads/
    echo تأكد من تفعيل "Add Python to PATH" أثناء التثبيت
    pause
    exit /b 1
)

echo [1/3] تثبيت pyodbc...
pip install pyodbc -q
if errorlevel 1 (
    echo [خطأ] فشل تثبيت pyodbc
    pause
    exit /b 1
)
echo       تم.

echo [2/3] اكتشاف جداول قاعدة البيانات...
echo       (تأكد أن config.json يحتوي server و database الصحيحين أولاً)
echo.
python discover.py
echo.

echo [3/3] لإضافة المزامنة التلقائية يومياً في Task Scheduler:
echo       شغّل: schedule.bat
echo.
echo ══ الإعداد اكتمل ══
pause
