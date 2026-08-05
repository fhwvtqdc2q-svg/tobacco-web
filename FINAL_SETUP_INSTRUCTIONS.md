# تعليمات الإعداد النهائي — مهمة المشتريات الدورية

**التاريخ:** 2026-08-05
**الحالة:** 6 من 7 مهام مكتملة. المتبقي: تشغيل مهمة Scheduler واحدة

---

## الملفات الجاهزة

جميع الملفات والتغييرات موجودة في المستودع:

- ✓ `src/config.js` — أرقام المركز محدثة (0994092038، 0985000771)
- ✓ `tools/register-purchase-invoices-pull-task.ps1` — سكريبت تسجيل المهمة (جديد)
- ✓ `tools/verify-customer-invoice-sync.ps1` — أداة التحقق (جديد)
- ✓ `tools/pull-purchase-invoices-from-ameen.ps1` — قراءة الفواتير
- ✓ `tools/convert-task-to-service-account.ps1` — تحويل لحساب الخدمة

---

## الخطوات التنفيذية (PowerShell Admin فقط)

### الخطوة 1: افتح PowerShell بصلاحيات Administrator

**على ويندوز:**
1. اضغط: `Windows + X`
2. اختر: `Windows PowerShell (Admin)` أو `Terminal (Admin)`
3. تأكد من ظهور `[Administrator]` في عنوان النافذة

### الخطوة 2: انتقل للمستودع

```powershell
cd 'C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web'
```

### الخطوة 3: سجّل مهمة المشتريات الدورية

```powershell
.\tools\register-purchase-invoices-pull-task.ps1 -IntervalMinutes 15 -PeriodDays 60
```

**المتوقع:**
- ✓ تم تسجيل المهمة 'TOBACCO Purchase Invoices Pull' كل 15 دقيقة.
- ⚠️ حوّلها بعد ذلك إلى حساب OZKSync...

### الخطوة 4: حوّل المهمة إلى حساب الخدمة OZKSync

```powershell
.\tools\convert-task-to-service-account.ps1 -TaskName "TOBACCO Purchase Invoices Pull" -User "OZKSync" -GrantFilesystemAccess
```

**المتوقع:**
- ✓ تم تحويل المهمة إلى حساب OZKSync
- ✓ تم تعيين الصلاحيات

### الخطوة 5: شغّل المهمة بعد تحويل الحساب

```powershell
Start-ScheduledTask -TaskName "TOBACCO Purchase Invoices Pull"
```

انتظر انتهاء التشغيل الأول قبل قراءة النتيجة:

```powershell
do {
  Start-Sleep -Seconds 2
  $task = Get-ScheduledTask -TaskName "TOBACCO Purchase Invoices Pull"
} while ($task.State -eq "Running")
```

### الخطوة 6: تحقق من النجاح

```powershell
$task = Get-ScheduledTask -TaskName "TOBACCO Purchase Invoices Pull"
$info = Get-ScheduledTaskInfo -TaskName "TOBACCO Purchase Invoices Pull"
[pscustomobject]@{
  State = $task.State
  UserId = $task.Principal.UserId
  LogonType = $task.Principal.LogonType
  LastRunTime = $info.LastRunTime
  LastTaskResult = $info.LastTaskResult
  NextRunTime = $info.NextRunTime
} | Format-List
```

**المتوقع:**
- `State`: `Ready` بعد انتهاء التشغيل
- `UserId`: `OZK2026\OZKSync`
- `LogonType`: `Password`
- `LastTaskResult`: 0 (نجاح)
- `LastRunTime`: تاريخ/وقت حديث جداً (ثوانٍ قليلة من الآن)

---

## ما الذي تفعله المهمة الدورية؟

**كل 15 دقيقة:**
1. تقرأ فواتير المشتريات من قاعدة بيانات الأمين (آخر 60 يوماً)
2. تعالج البيانات بأمان (بدون كتابة في الأمين)
3. ترفع التقرير إلى جدول `ameen_purchase_invoice_reports` في Supabase
4. تسجل النتائج (عدد الفواتير، حالة النجاح/الفشل)

---

## في حالة المشاكل

### المشكلة: "Access Denied" أو "يتطلب Administrator"
- **السبب:** تشغيل بدون صلاحيات Admin
- **الحل:** أعد فتح PowerShell من "Run as Administrator"

### المشكلة: "The term '.\tools\...' is not recognized"
- **السبب:** المجلد الحالي غير صحيح
- **الحل:** تأكد من أن المجلد الحالي هو `C:\Users\LOQ\Documents\OZK-TOBACCO\tobacco-web`
  ```powershell
  pwd  # اطبع المسار الحالي
  ```

### المشكلة: "LastTaskResult" غير صفر
- **السبب:** أول تشغيل قد يفشل إذا كانت بيانات الاتصال بـ Ameen أو Supabase غير متوفرة
- **الحل:** تحقق من الـ logs أو انتظر التشغيل الثاني (15 دقيقة)

---

## التحقق من التشغيل الدوري

بعد 15 دقيقة من النجاح الأول:
```powershell
Get-ScheduledTaskInfo -TaskName "TOBACCO Purchase Invoices Pull"
```

- يجب أن تظهر `LastRunTime` محدّثة
- يجب أن يكون `LastTaskResult` = 0 (أو قيمة نجاح أخرى)

---

## ملخص المهام (7/7)

- ✓ [1] تصميم النشرة الجديدة على الموبايل
- ✓ [2] مزامنة فواتير المبيعات (64/64)
- ✓ [3] نظام الحد الائتماني
- ✓ [4] تبسيط الصفحة الرئيسية
- ✓ [5] تبسيط تبويب أرصدة الزبائن
- ✓ [6] حذف تبويب الفواتير
- ⏳ [7] تسجيل مهمة المشتريات الدورية ← **أنت هنا** (اتبع الخطوات أعلاه)

---

**بعد الانتهاء من الخطوات:**
أخبرني بـ:
1. نتائج `Get-ScheduledTaskInfo`
2. هل `LastTaskResult` = 0؟
3. هل `User` = OZKSync؟

عندها سننهي المهمة 7/7 رسمياً!
