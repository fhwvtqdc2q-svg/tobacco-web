# TOBACCO Web

منصة خدمة عملاء عربية تعمل من المتصفح على Windows وiPhone وMac. المشروع منشور على GitHub Pages ويمكن تثبيته من Safari كأنه تطبيق ويب.

الرابط العام:

```text
https://fhwvtqdc2q-svg.github.io/tobacco-web/
```

## التشغيل على Windows

```powershell
cd "C:\Users\DELL\Documents\New project\web-platform"
npm run dev
```

افتح:

```text
http://localhost:5173
```

## الفتح على iPhone

افتح الرابط العام من Safari:

```text
https://fhwvtqdc2q-svg.github.io/tobacco-web/
```

ثم اختر Share ثم Add to Home Screen.

## ربط Supabase

المشروع جاهز للربط مع Supabase بدون وضع أسرار داخل GitHub.

اقرأ:

```text
SUPABASE_SETUP.md
```

ثم أضف Project URL والمفتاح العام فقط داخل:

```text
src/config.js
```

لا تضع مفتاح `service_role` في الواجهة.

## الملفات المهمة

- `src/app.js`: الواجهة والمنطق.
- `src/supabase-client.js`: طبقة البيانات بين الحفظ المحلي وSupabase.
- `src/config.js`: إعدادات الموقع ومفاتيح Supabase العامة عند التفعيل.
- `supabase/schema.sql`: جدول الطلبات وسياسات RLS.
- `.github/workflows/pages.yml`: نشر GitHub Pages.

## الفحص

```powershell
npm run check
```
