# CLAUDE.md — OZK-TOBACCO-web-platform

## المشروع

منصة ويب عربية لـ **OZK TOBACCO** تشمل:
- تسعير المواد اليومي من الهاتف
- إدارة طلبات العملاء
- مزامنة الأسعار مع برنامج الأمين المحاسبي
- تقارير الجرد والرصيد

---

## بيئتا العمل

### 1. السيرفر السحابي (أنت هنا)
```
/home/user/tobacco-web
```
- عدّل كود الموقع: `src/app.js`, `src/styles.css`, `src/config.js`
- عدّل ملفات Supabase: `supabase/`
- عدّل سكريبتات الأدوات: `tools/`
- ادفع التغييرات إلى GitHub ← تنشر تلقائياً على GitHub Pages

### 2. جهاز Omar المحلي (Windows)
```
C:\Users\DELL\Desktop\OZK-TOBACCO-web-platform
```
- هنا يعمل SQL Server الخاص بالأمين (قاعدة بيانات `mt000`)
- هنا تعمل سكريبتات PowerShell
- هنا تعمل المهام المجدولة (Windows Task Scheduler)
- **لا يمكن الوصول إليه من السحابة مباشرة**

---

## مزامنة الأسعار مع الأمين

السلسلة الكاملة:
```
الموقع (صفحة التسعير)
    ↓ حفظ السعر
Supabase: approved_price_items (197 سعر)
    ↓ كل 5 دقائق (Windows Task Scheduler)
.\tools\sync-approved-prices-to-ameen.ps1 -Apply
    ↓
SQL Server: mt000 → MaterialPriceListItem000
    ↓
الأمين يقرأ الأسعار الجديدة
```

### أوامر مهمة (تشغّل على جهاز Windows):
```powershell
# مزامنة الأسعار للأمين
.\tools\sync-approved-prices-to-ameen.ps1 -Apply

# سحب الأسعار فقط بدون تطبيق
.\tools\pull-approved-prices.ps1

# تقرير حالة الجهاز
.\tools\report-for-claude-code.ps1

# تسجيل المهمة المجدولة (مرة واحدة)
.\tools\register-approved-prices-pull-task.ps1 -IntervalMinutes 5 -ApplyToAmeen
```

---

## Supabase

- **URL:** `https://dyxbirfpxeocqffnfdeb.supabase.co`
- **الجداول الرئيسية:**
  - `approved_price_items` — الأسعار المعتمدة
  - `inventory_reports` — تقارير جرد الأمين
  - `customer_requests` — طلبات العملاء
  - `customer_credit_limits` — حدود ائتمان العملاء

### مهم جداً — Supabase REST API
كل طلب REST يحتاج هذا الهيدر وإلا يعطي 404:
```
Accept-Profile: public
```

### مثال curl صحيح:
```bash
curl "https://dyxbirfpxeocqffnfdeb.supabase.co/rest/v1/approved_price_items?select=*" \
  -H "apikey: sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH" \
  -H "Authorization: Bearer sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH" \
  -H "Accept-Profile: public"
```

---

## مطابقة مواد الأمين

**مهم:** المطابقة بين Supabase والأمين تتم عبر **`item_guid`** وليس الاسم فقط.
- الاسم قد يختلف بين النظامين
- استخدم `item_guid` كمفتاح أساسي للمطابقة
- ملف المعاينة: `reports\prices\tobacco-ameen-price-update-preview.csv`

---

## ملفات حساسة — لا تُ commit

```
tools/.env                    ← service key + Ameen SQL password
reports/prices/*.csv          ← بيانات أسعار حساسة
tools/logs/                   ← سجلات المزامنة
```

هذه مضافة في `.gitignore` ولا يجب رفعها أبداً.

---

## هيكل المشروع

```
src/
  app.js          ← منطق الواجهة الرئيسي
  styles.css      ← التصميم
  config.js       ← إعدادات التطبيق (staffRoles, Supabase config)
  supabase-client.js ← طبقة البيانات
public/
  service-worker.js ← PWA caching (bump version عند كل تعديل CSS/JS)
tools/
  pull-approved-prices.ps1         ← سحب الأسعار من Supabase
  apply-approved-prices-to-ameen.ps1 ← تطبيق الأسعار على الأمين
  sync-approved-prices-to-ameen.ps1  ← السلسلة الكاملة
  register-approved-prices-pull-task.ps1 ← تسجيل المهمة المجدولة
  .env.example    ← نموذج الإعدادات (لا تحتوي أسراراً حقيقية)
supabase/
  approved-prices-table.sql  ← schema جدول الأسعار
  payment-tables.sql         ← schema جداول الدفع
```

---

## قواعد عامة (من AGENTS.md)

- الهدف العملي: iPhone للواجهة، Windows للتشغيل المحلي
- لا تضف macOS كهدف
- لا تعمل `git reset` أو حذف جماعي بدون موافقة صريحة
- bump رقم cache في `service-worker.js` عند كل تعديل على CSS أو JS
- شغّل `npm run check` قبل ادعاء نجاح أي تعديل
- لا تسجّل كلمات مرور أو API keys في الكود
