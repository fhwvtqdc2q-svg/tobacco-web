# CLAUDE.md — OZK TOBACCO Web Platform

## نظرة عامة على المشروع

منصة ويب عربية لإدارة طلبات العملاء، لائحة الأسعار، ومزامنة بيانات الأمين المحاسبي.
موقع ثابت (HTML/JS/CSS) — لا يوجد React ولا Vite ولا build step.

---

## البيئتان

| البيئة | المسار | الوصول |
|---|---|---|
| **السحابة (هذه البيئة)** | `/home/user/tobacco-web` | GitHub, Supabase, تعديل الكود |
| **Windows المحلي** | `C:\Users\DELL\Desktop\OZK-TOBACCO-web-platform` | قاعدة الأمين SQL، PowerShell، Task Scheduler |

> Claude Code (cloud) لا يستطيع الوصول لجهاز Windows المحلي أبداً.
> Cursor أو PowerShell على جهاز DELL هو المسار الوحيد للتفاعل مع الأمين.

---

## بنية المشروع

```
tobacco-web/
├── index.html                   # الصفحة الرئيسية الوحيدة (SPA)
├── privacy-policy.html
├── terms-of-use.html
├── 404.html
├── src/
│   ├── config.js                # إعدادات التطبيق (Supabase URL, مفاتيح API)
│   ├── app.js                   # كل منطق التطبيق
│   ├── styles.css               # كل التصاميم
│   └── supabase-client.js       # wrapper لـ Supabase REST
├── public/
│   ├── service-worker.js        # PWA cache — يجب رفع CACHE_NAME عند كل نشر
│   ├── manifest.webmanifest
│   ├── icons/
│   └── downloads/               # نشرات الأسعار للزبائن
│       ├── index.html           # صفحة اختيار النشرة
│       ├── price-list-usd.html
│       └── price-list-syp-14050.html
├── tools/                       # سكريبتات PowerShell للتشغيل على Windows فقط
├── supabase/                    # SQL schemas
├── reports/
│   └── prices/                  # CSV مؤقتة — لا تُرفع لـ Git
└── scripts/
    └── serve.mjs                # dev server بسيط (Node.js)
```

---

## تشغيل السيرفر المحلي

```bash
npm run dev
# يشتغل على http://localhost:5173
```

لا يوجد build. التعديل على `src/` يظهر مباشرة عند تحديث الصفحة.

---

## قواعد مهمة لا تخترقها

### 1. Service Worker Cache
**بعد أي تعديل على CSS أو JS أو HTML، ارفع رقم النسخة:**
```js
// public/service-worker.js
const CACHE_NAME = "web-platform-tobacco-v18"; // ← غيّر الرقم
```
بدون هذا، المستخدمون لن يرون التغييرات (الكاش القديم يعمل).

### 2. Supabase REST API
يجب إرسال هذا الـ header في كل طلب وإلا يعطي 404:
```
Accept-Profile: public
```

### 3. ملفات لا تُرفع لـ Git أبداً
```
tools/.env                    ← service key + Ameen SQL password
tools/logs/                   ← سجلات المزامنة
reports/prices/*.csv          ← بيانات أسعار حساسة
```

### 4. قواعد عامة
- لا تضف macOS كهدف تشغيل رئيسي
- لا تعمل `git reset` أو حذف جماعي بدون موافقة صريحة
- لا تسجّل كلمات مرور أو API keys في الكود
- شغّل `npm run check` قبل ادعاء نجاح أي تعديل

### 5. قيود أمنية معروفة (GitHub Pages)
- **`frame-ancestors 'none'`** في `<meta>` CSP: المتصفحات لا تطبّقه عبر meta tag (المعيار W3C يستثنيه).
  الحل الكامل يتطلب إضافة HTTP header `Content-Security-Policy` من server أو CDN (Cloudflare Pages).
  حتى يتم ذلك، الحماية من clickjacking تعتمد على حسن نية CDN فقط.
- **CDN scripts**: إذا تم ترقية `@supabase/supabase-js` أو `xlsx`، يجب تحديث الـ pin والـ SRI hash في `index.html`.

---

## Supabase

| المعلومة | القيمة |
|---|---|
| URL | `https://dyxbirfpxeocqffnfdeb.supabase.co` |
| Publishable Key | في `src/config.js` |
| جدول الأسعار | `approved_price_items` |
| جدول الطلبات | `customer_requests` |
| جدول الجرد | `inventory_reports` |
| جدول حدود الائتمان | `customer_credit_limits` |

### اختبار الاتصال بـ Supabase (من cloud):
```bash
# اختبار وصول قاعدة البيانات — يتطلب Bearer token من جلسة مصادقة فعّالة
# (الجدول approved_price_items يحجب دور anon، لا يعمل بالمفتاح العام وحده)
# الطريقة الصحيحة للاختبار: شغّل السكريبت التالي على جهاز Windows:
#   .\tools\pull-approved-prices.ps1
# أو اختبر الاتصال بجدول عام (بدون RLS):
curl -s "https://dyxbirfpxeocqffnfdeb.supabase.co/rest/v1/" \
  -H "apikey: sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH"
```

---

## قاعدة بيانات الأمين (Windows فقط)

| المعلومة | القيمة |
|---|---|
| Server | `OZK-TOBACCO` |
| Database | `AmnDb001` |
| User | `tobacco_sync_reader` (للقراءة) |
| متغير البيئة | `AMEEN_SQL_CONNECTION_STRING` |

> لا يمكن الوصول لها من السحابة. فقط من جهاز DELL مباشرة.

**مفتاح المطابقة بين Supabase والأمين:** `item_key`

---

## سكريبتات مجلد `tools/`

### إعداد البيئة (يُشغَّل مرة واحدة)
```powershell
# يحفظ بيانات الاتصال في متغيرات بيئة Windows
.\tools\setup-ameen-sync-env.ps1
```

### سحب الأسعار من Supabase → CSV
```powershell
.\tools\pull-approved-prices.ps1
# الناتج: reports\prices\tobacco-approved-prices.csv
```

### رفع جرد الأمين → Supabase (قراءة من الأمين، كتابة على Supabase)
```powershell
# تشغيل مرة واحدة: يقرأ المخزون وأرصدة العملاء من Ameen ويرفعها لـ Supabase
.\tools\ameen-sync-agent.ps1 -Once

# مع تعديل حد التنبيه للمواد قاربت النفاد (القيمة الافتراضية 50)
.\tools\ameen-sync-agent.ps1 -Once -LowThreshold 30
```
> **ملاحظة:** هذا السكريبت يقرأ البيانات من الأمين ويرفعها إلى Supabase.
> الاتجاه: الأمين → Supabase. مزامنة الأسعار العكسية تتم عبر `sync-approved-prices-to-ameen.ps1`.

### تسجيل مهام Windows Task Scheduler
```powershell
# مهمة سحب الأسعار كل 5 دقائق
.\tools\register-approved-prices-pull-task.ps1 -IntervalMinutes 5

# مهمة مزامنة الأمين كل دقيقة
.\tools\register-ameen-sync-task.ps1 -IntervalMinutes 1
```

### أدوات أخرى
```powershell
.\tools\start-claude-code.ps1         # تشغيل Claude Code عبر WSL
.\tools\test-ameen-stock-query.ps1    # قراءة جرد الأمين مباشرة
.\tools\discover-ameen-sql.ps1        # اكتشاف قواعد بيانات الأمين
.\tools\report-for-claude-code.ps1   # تقرير حالة الجهاز
.\tools\ameen-daily-summary.ps1      # ملخص يومي للحركات
```

---

## تدفق مزامنة الأسعار (Pipeline)

```
الموقع (المتصفح)
    ↓ حفظ سعر
Supabase (approved_price_items)
    ↓ pull-approved-prices.ps1 (كل 5 دقائق)
reports\prices\tobacco-approved-prices.csv
    ↓ sync-approved-prices-to-ameen.ps1 (كل 5 دقائق، مجدوَل)
قاعدة بيانات الأمين (AmnDb001 → MaterialPriceListItem000)
```

---

## نشرات الأسعار

| الملف | الوصف |
|---|---|
| `public/downloads/index.html` | صفحة اختيار للزبائن |
| `public/downloads/price-list-usd.html` | الأسعار بالدولار |
| `public/downloads/price-list-syp-14050.html` | الأسعار بالليرة (صرف 14,050) |

لتجديد النشرات بأسعار محدّثة، شغّل سكريبت Python في `reports/` بعد سحب CSV جديد.

---

## Git

- **Remote:** `fhwvtqdc2q-svg/tobacco-web`
- **Push:** `git push -u origin <branch-name>`

---

## سياسة الخصوصية الموحدة — قواعد ثابتة

### المكانة القانونية

الملف `privacy-policy.html` هو **السياسة الموحدة الشاملة** لجميع برامج وتطبيقات
ومنصات OZK TOBACCO الحالية والمستقبلية. لا تخص موقعاً أو برنامجاً بعينه،
بل تُطبَّق على كل منتج رقمي يصدر تحت هذه العلامة التجارية.

### ممنوعات مطلقة بدون إذن صريح من صاحب الحساب

> **المقصود بالإذن الصريح:** رسالة كتابية مباشرة من ozk.kh@outlook.com
> تُحدِّد البند المراد تعديله والسبب. غياب الإذن يعني المنع التام.

لا يجوز لـ Claude أو أي مطور تعديل البنود التالية مهما كان المبرر:

| البند المحمي | الوصف |
|---|---|
| **نطاق التطبيق** | تعريف السياسة بأنها موحدة لجميع المنتجات |
| **مدد الاحتفاظ** | ٧ سنوات للمعاملات، ٥ للأسعار، ٣ لسجل النشاط |
| **شروط حذف البيانات** | لا حذف إلا بطلب كتابي صريح من ozk.kh@outlook.com |
| **تعريف القاصرين** | ١٨ عاماً فأكثر — لا تخفيض لهذا الحد |
| **مزودو الخدمة** | قائمة Supabase والأطراف الثالثة المذكورة |
| **حقوق المستخدمين** | الستة حقوق المنصوص عليها في قسم ١٠ |
| **لغة الوثيقة** | العربية الفصحى الرصينة — يُحظر إدخال العامية |

### سجل التعديلات الرسمي

| التاريخ | التعديل | السبب |
|---|---|---|
| ٢ يونيو ٢٠٢٦ | تحديث تاريخ السريان من ١٧ مايو إلى ٢ يونيو ٢٠٢٦ | مزامنة مع تاريخ النشر الفعلي |
| ٢ يونيو ٢٠٢٦ | حذف رقم الهاتف الوهمي `+000000000` من قسم التواصل | لا يوجد رقم رسمي محدد بعد |
| ٢ يونيو ٢٠٢٦ | إعادة صياغة قسمَي ٦ و٨ بالفصحى الرصينة | إزالة العامية من وثيقة قانونية رسمية |
| ٢ يونيو ٢٠٢٦ | استبدال "إلى أجل غير مسمى" بمدد محددة في جدول الاحتفاظ | الوضوح القانوني ومنع الغموض التفسيري |

### قاعدة المراجعة الدورية

يجب مراجعة `privacy-policy.html` مرة واحدة على الأقل عند:
- إضافة خدمة أو مزود خارجي جديد
- تغيير طريقة جمع البيانات أو تخزينها
- تغيير جوهري في بنية المشروع أو نطاقه

---

## تشخيص المشاكل الشائعة

| المشكلة | السبب | الحل |
|---|---|---|
| Supabase 404 | ناقص `Accept-Profile: public` | أضف الـ header |
| صفحات سوداء في PDF | CSS يستخدم خلفيات داكنة | أضف `background: #ffffff !important` لكلاسات `.price-pdf-*` |
| الكاش القديم عند الزبائن | رقم CACHE_NAME لم يُرفع | عدّل `CACHE_NAME` في service-worker.js |
| Applied=0 في مزامنة الأمين | `item_key` غير متطابق | تحقق من قيم `item_key` في Supabase مقابل الأمين |
| PowerShell لا يشغّل `claude.exe` | Claude Code يحتاج WSL | شغّل `start-claude-code.ps1` أو استخدم WSL مباشرة |
