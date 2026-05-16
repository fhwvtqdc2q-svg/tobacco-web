# ربط TOBACCO مع Supabase

هذه الخطوات تجعل تسجيل الدخول وطلبات العملاء تعمل من قاعدة بيانات حقيقية بدلا من الحفظ المحلي داخل المتصفح.

## 1. أنشئ مشروع Supabase

1. افتح Supabase وأنشئ مشروع جديد.
2. من Authentication تأكد أن Email/Password مفعل.
3. إذا كان النظام للموظفين فقط، عطّل التسجيل العام لاحقا وأنشئ المستخدمين من لوحة Supabase.

## 2. أنشئ جدول الطلبات

افتح SQL Editor داخل Supabase، ثم انسخ محتوى الملف:

`supabase/schema.sql`

وشغله كما هو.

الملف يفعل RLS ويمنع `anon` من قراءة الطلبات، ويسمح فقط للمستخدمين المسجلين بقراءة/إضافة/تحديث الطلبات.

## 3. أضف مفاتيح الواجهة العامة

من Project Settings ثم API انسخ:

- Project URL
- publishable key أو anon public key

ثم افتح `src/config.js` وضعها هنا:

```js
supabase: {
  url: "https://YOUR-PROJECT.supabase.co",
  publishableKey: "YOUR-PUBLIC-KEY",
  requestsTable: "customer_requests"
}
```

مهم: لا تضع `service_role` أو أي مفتاح سري داخل `src/config.js` أو GitHub Pages.

## 4. اختبر

1. شغل الموقع.
2. افتح صفحة تسجيل الدخول.
3. أنشئ حساب موظف أو سجل دخول بحساب موجود.
4. أضف طلب عميل من صفحة الطلبات.
5. تأكد أن الطلب ظهر داخل جدول `customer_requests` في Supabase.

إذا ظهر `auth session missing` بعد إنشاء الحساب، فهذا يعني أن Supabase لم ينشئ جلسة دخول بعد. افتح بريد التأكيد ثم سجل الدخول، أو من Supabase عطّل Email confirmation مؤقتا أثناء التطوير من Authentication settings.

## إذا ظهر permission denied

إذا ظهرت رسالة:

```text
permission denied for table customer_requests
```

افتح SQL Editor وشغل محتوى:

```text
supabase/permissions-fix.sql
```

هذا الملف يعيد تثبيت صلاحيات `authenticated` وسياسات RLS بدون فتح الجدول للعامة.

## حالة الأمان الحالية

- لا توجد مفاتيح سرية داخل المستودع.
- جدول الطلبات محمي بـ RLS.
- الواجهة تنظف النصوص قبل عرضها لتقليل خطر حقن HTML.
- صلاحيات الطلبات حاليا لكل مستخدم مسجل في النظام. لاحقا يمكن إضافة أدوار إدارة أكثر دقة.
