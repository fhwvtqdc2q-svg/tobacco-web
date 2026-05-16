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

1. افتح Supabase Dashboard.
2. من Authentication ثم Users اختر Add user.
3. أنشئ مستخدم موظف ببريد وكلمة مرور، وفعّل Auto Confirm User إن ظهر الخيار.
4. افتح الموقع ثم صفحة تسجيل الدخول.
5. سجل دخول بنفس البريد وكلمة المرور.
6. أضف طلب عميل من صفحة الطلبات.
7. تأكد أن الطلب ظهر داخل جدول `customer_requests` في Supabase.

إذا ظهر `auth session missing` فهذا يعني أن Supabase لا يرى جلسة دخول فعالة. أنشئ المستخدم من Supabase Authentication ثم سجل دخول من الموقع.

إذا ظهر `email rate exceeded` فهذا حد إرسال بريد من Supabase. انتظر قليلا أو أنشئ المستخدم يدويا من Authentication > Users بدلا من إنشاء الحساب من الواجهة.

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
