# إرشادات استخدام سكريبتات المزامنة المحسّنة

## السكريبتات الجديدة

### 1. `sync-purchase-invoices-enhanced.ps1`
سكريبت محسّن لمزامنة فواتير المشتريات من الأمين إلى Supabase.

**المميزات الجديدة:**
- تتبع آخر فاتورة تم مزامنتها بنجاح
- استئناف من حيث توقفت عند الخطأ
- إعادة محاولة تلقائية (exponential backoff)
- معالجة أخطاء شاملة

**الاستخدام:**
```powershell
# مزامنة آخر 60 يوم (الافتراضي)
.\tools\sync-purchase-invoices-enhanced.ps1

# مزامنة آخر 120 يوم
.\tools\sync-purchase-invoices-enhanced.ps1 -PeriodDays 120

# تخطي آخر نجاح محفوظ والبدء من قديم
.\tools\sync-purchase-invoices-enhanced.ps1 -SkipLastSuccessCheck

# مع ملف متغيرات بيئة مخصص
.\tools\sync-purchase-invoices-enhanced.ps1 -EnvFile "C:\path\.env"
```

**السجلات:**
- السجل الرئيسي: `tools/logs/purchase-invoices-sync.log`
- آخر نجاح: `tools/logs/purchase-sync-last-success.txt` (ملف يحتوي على التاريخ)

### 2. `sync-sales-invoices-enhanced.ps1`
سكريبت محسّن لمزامنة فواتير المبيعات من الأمين إلى Supabase.

**المميزات:**
- نفس مميزات سكريبت المشتريات
- مجموعة حسب الزبون بدلاً من المورد
- دعم مرتجعات المبيعات

**الاستخدام:**
```powershell
# مزامنة آخر 60 يوم
.\tools\sync-sales-invoices-enhanced.ps1

# مزامنة آخر 90 يوم
.\tools\sync-sales-invoices-enhanced.ps1 -PeriodDays 90
```

**السجلات:**
- السجل الرئيسي: `tools/logs/sales-invoices-sync.log`
- آخر نجاح: `tools/logs/sales-sync-last-success.txt`

## المعلومات المطلوبة لتشغيل السكريبتات

يجب أن تكون متغيرات البيئة التالية معرّفة على نظام Windows:

```powershell
# الاتصال بقاعدة الأمين (للقراءة فقط)
[System.Environment]::SetEnvironmentVariable("AMEEN_SQL_CONNECTION_STRING", 
    "Server=OZK-TOBACCO;Database=AmnDb002;User Id=tobacco_sync_reader;Password=...", 
    "User")

# إعدادات Supabase
[System.Environment]::SetEnvironmentVariable("TOBACCO_SUPABASE_URL", 
    "https://dyxbirfpxeocqffnfdeb.supabase.co", 
    "User")
    
[System.Environment]::SetEnvironmentVariable("TOBACCO_SUPABASE_PUBLIC_KEY", 
    "sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH", 
    "User")

# حساب المزامنة (يجب أن يكون موثوقاً ويملك صلاحيات الكتابة على الجداول)
[System.Environment]::SetEnvironmentVariable("TOBACCO_SYNC_EMAIL", 
    "sync@example.com", 
    "User")
    
[System.Environment]::SetEnvironmentVariable("TOBACCO_SYNC_PASSWORD", 
    "secure-password", 
    "User")
```

أو استخدم ملف `.env`:
```
AMEEN_SQL_CONNECTION_STRING=Server=OZK-TOBACCO;Database=AmnDb002;User Id=tobacco_sync_reader;Password=...
TOBACCO_SUPABASE_URL=https://dyxbirfpxeocqffnfdeb.supabase.co
TOBACCO_SUPABASE_PUBLIC_KEY=sb_publishable_...
TOBACCO_SYNC_EMAIL=sync@example.com
TOBACCO_SYNC_PASSWORD=secure-password
```

## استكشاف الأخطاء

### الخطأ: "AMEEN_SQL_CONNECTION_STRING غير موجود"
**الحل:** تأكد من أن متغير البيئة معرّف في Windows:
```powershell
$env:AMEEN_SQL_CONNECTION_STRING = "..."
```

### الخطأ: "فشل الاتصال بـ Supabase"
**المحتملة:**
1. مفتاح API غير صحيح
2. بيانات الدخول (البريد/كلمة المرور) غير صحيحة
3. انقطاع الإنترنت

**الحل:** تحقق من السجل في `tools/logs/`

### السكريبت يقول "لا توجد فواتير جديدة"
**الأسباب المحتملة:**
1. جميع الفواتير تم مزامنتها بالفعل
2. لا توجد فواتير جديدة في الفترة المحددة
3. الفواتير لم تُرسَّل بعد من الأمين

**الحل:** جرب مع `-PeriodDays 180` لفترة أطول

## تسجيل المهام في Windows Task Scheduler

### لمزامنة المشتريات كل ساعة:
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -File C:\path\tools\sync-purchase-invoices-enhanced.ps1"

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RunOnlyIfNetworkAvailable

Register-ScheduledTask -TaskName "Tobacco-Sync-Purchases" `
    -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Highest -User "SYSTEM"
```

### لمزامنة المبيعات كل ساعة:
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -File C:\path\tools\sync-sales-invoices-enhanced.ps1"

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -At (Get-Date)

Register-ScheduledTask -TaskName "Tobacco-Sync-Sales" `
    -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Highest -User "SYSTEM"
```

## حل مشكلة "توقف المزامنة بعد 30/07/2026"

### الخطوات:

1. **التحقق من آخر نجاح محفوظ:**
```powershell
Get-Content "C:\path\tools\logs\purchase-sync-last-success.txt"
Get-Content "C:\path\tools\logs\sales-sync-last-success.txt"
```

2. **فحص السجلات:**
```powershell
Get-Content "C:\path\tools\logs\purchase-invoices-sync.log" | Select-Object -Last 50
```

3. **محاولة مزامنة يدوية لمدة 4 أشهر:**
```powershell
.\sync-purchase-invoices-enhanced.ps1 -PeriodDays 120
.\sync-sales-invoices-enhanced.ps1 -PeriodDays 120
```

4. **إذا فشلت المحاولة:**
- تحقق من بيانات اعتماد Supabase
- تحقق من اتصال الأمين SQL
- تحقق من وجود ملخص الحقوق (RLS) على Supabase

## النقاط المهمة

1. **التطبيق يدوي أولاً:** جرب المزامنة يدوياً قبل تسجيلها كمهمة مجدولة
2. **السجلات:** دائماً افحص السجلات للتفاصيل الكاملة للخطأ
3. **البيانات آمنة:** السكريبتات تقرأ فقط من الأمين، لا تعديل
4. **التكرار:** السكريبتات تتحقق من GUID الفاتورة لمنع التكرار

## الملفات المرتبطة

- `src/app.js`: دوال العرض لفواتير المشتريات والمبيعات
- `supabase/ameen-purchase-invoice-reports.sql`: Schema الجدول
- `supabase/telegram-notifications.sql`: إرسال تنبيهات عند المزامنة
