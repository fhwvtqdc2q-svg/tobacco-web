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

### ملاحظة: جدول approved_price_items
دور `anon` محجوب بـ RLS عن هذا الجدول. لسحب الأسعار استخدم:
```powershell
.\tools\pull-approved-prices.ps1
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

### مزامنة الأسعار مع الأمين
```powershell
# معاينة فقط (بدون تطبيق)
.\tools\ameen-sync-agent.ps1 -Once

# تطبيق فعلي على الأمين
.\tools\ameen-sync-agent.ps1 -Once -LowThreshold 0
```

> ملاحظة: `ameen-sync-agent.ps1` يقرأ بيانات الجرد والأرصدة **من** الأمين ويرفعها **إلى** Supabase.
> لا يكتب أسعاراً على الأمين. مزامنة الأسعار تتم عبر `sync-approved-prices-to-ameen.ps1`.

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

## تشخيص المشاكل الشائعة

| المشكلة | السبب | الحل |
|---|---|---|
| Supabase 404 | ناقص `Accept-Profile: public` | أضف الـ header |
| صفحات سوداء في PDF | CSS يستخدم خلفيات داكنة | أضف `background: #ffffff !important` لكلاسات `.price-pdf-*` |
| الكاش القديم عند الزبائن | رقم CACHE_NAME لم يُرفع | عدّل `CACHE_NAME` في service-worker.js |
| Applied=0 في مزامنة الأمين | `item_key` غير متطابق | تحقق من قيم `item_key` في Supabase مقابل الأمين |
| PowerShell لا يشغّل `claude.exe` | Claude Code يحتاج WSL | شغّل `start-claude-code.ps1` أو استخدم WSL مباشرة |
