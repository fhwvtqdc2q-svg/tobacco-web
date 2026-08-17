# مزامنة فواتير الأمين — المسارات المعتمدة

## النتيجة المختصرة

لا يُنشأ جدول `ameen_sales_invoice_reports` ولا Migration جديد للمبيعات. المشروع يملك مسارين فعليين مستخدمين بالفعل:

- `tools/push-customer-invoices.ps1`: يرفع فواتير المبيعات والمرتجعات ذات اسم الزبون إلى `inventory_reports` بالمصدر `ameen_customer_invoices`. هذا هو المصدر الذي يقرأه الموقع.
- `tools/push-sales-line-items.ps1`: يرفع أسطر حركة المبيعات إلى `sales_line_items` لاستخدام تقارير Telegram.

فواتير المشتريات تستخدم المسار المستقل المحمي:

- `tools/pull-purchase-invoices-from-ameen.ps1`
- `tools/register-purchase-invoices-pull-task.ps1`
- `supabase/ameen-purchase-invoice-reports.sql`

## لماذا أزيلت السكربتات المسماة enhanced؟

حُذفت الملفات التالية لأنها لم تكن بديلاً آمناً أو متوافقاً مع التطبيق:

- `tools/sync-sales-invoices-enhanced.ps1`
- `tools/sync-purchase-invoices-enhanced.ps1`

كانت نسخة المبيعات تحتوي GUIDs وهمية، وتكتب إلى جدول غير موجود ولا يقرأه التطبيق. وكان السكربتان يضيّقان التقرير التالي إلى ما بعد «آخر نجاح»، مع أن واجهة الموقع تعتمد تقرير snapshot كامل للفترة؛ وهذا كان سيُسقط التاريخ الأقدم من أحدث تقرير.

## التحقق الآمن

```powershell
# قراءة من الأمين فقط، بلا رفع
.\tools\push-sales-line-items.ps1 -DryRun -Days 7

# اكتشاف بنية فواتير الزبائن، بلا رفع
.\tools\push-customer-invoices.ps1 -Discover -PeriodDays 60

# مطابقة GUIDs بين Ameen وأحدث تقرير Supabase، بلا كتابة
.\tools\verify-customer-invoice-sync.ps1 `
  -FromDate '2026-07-30' `
  -ToDateExclusive '2026-08-05'

# فحص المشروع
npm.cmd run check
git diff --check
```

## التشغيل المجدول

المهمة المعتمدة لفواتير الزبائن هي:

```text
TOBACCO Customer Invoices Push
```

يجب التحقق من `LastTaskResult = 0` وحداثة `LastRunTime` بدلاً من إنشاء مهمة ثانية لنفس البيانات.

مزامنة المشتريات تقرأ Ameen فقط وتكتب تقرير العرض إلى Supabase. لا يجوز الخلط بينها وبين `sync-purchase-invoices-to-ameen.ps1`؛ الأخير مسار كتابة محاسبية مختلف ومقفل ولا يدخل في هذه المهمة.

تسجيل مهمة المشتريات يتطلب نافذة Administrator، ثم تحويلها إلى حساب `OZKSync` كي تستمر دون تسجيل دخول:

```powershell
.\tools\register-purchase-invoices-pull-task.ps1 -IntervalMinutes 15 -PeriodDays 60
.\tools\convert-task-to-service-account.ps1 -TaskName "TOBACCO Purchase Invoices Pull" -User "OZKSync" -GrantFilesystemAccess
Start-ScheduledTask -TaskName "TOBACCO Purchase Invoices Pull"
```

لا تُنفّذ الخطوة الثانية إلا من جلسة Administrator؛ تطلب كلمة مرور `OZKSync` تفاعلياً ولا تحفظها في المستودع.

## حدود الأمان

- لا تُعرض connection strings أو كلمات المرور أو JWT في السجلات.
- لا تُخزن بيانات الفواتير الحساسة في ملفات عامة.
- لا يُطبّق SQL أو تسجيل مهمة جديدة على الإنتاج قبل مراجعة مستقلة للملفات الفعلية.
- لا يُستخدم `service_role` في المتصفح.

## تحديث ameen_item_snapshot من Supabase

المسار الجديد لا يتصل بـ Ameen مطلقاً. يقرأ `sales_line_items` و`item_costs`
و`ameen_item_snapshot` من Supabase، ثم يعيد حساب `units_sold_30d` بنافذة تاريخية
ثابتة من `D-30` إلى `D` شاملة، وهي النافذة التي طابقت اللقطة التاريخية.
في فحص 2026-08-17، أعادت نافذة اللقطة المؤرخة 2026-08-07 مطابقة 421 من 421
صنفاً بلا أي فرق، وبإجمالي 89,982 وحدة في الجانبين. نافذة `D-29` لم تطابق
العقد القديم، لذلك لا تُستخدم.

- `tools/push-purchase-item-snapshot.ps1` غلاف محلي؛ وضعه الافتراضي Dry Run.
- `scripts/refresh-ameen-item-snapshot.mjs` المنتج الفعلي، والكتابة تحتاج `--apply`.
- `supabase/ameen-item-snapshot-refresh.sql` دالة استبدال ذري يجب مراجعتها وتطبيقها
  منفصلة قبل تسجيل المهمة. تُبقي اللقطة القديمة ظاهرة حتى نجاح المعاملة الجديدة.
- `tools/register-purchase-item-snapshot-task.ps1` يقترح يومياً عند 05:05 بالتوقيت
  المحلي، ولا يبدأ المهمة بعد التسجيل.

أنواع الفواتير الحالية المدعومة هي `retail` و`wholesale`. الكمية السالبة تخصم من
الصافي إن ظهرت، وأي نوع فاتورة غير معروف أو صافي سلبي يوقف العملية قبل الكتابة.
لا تُحذف الأسطر المكررة من المصدر لأن المطابقة التاريخية أثبتت أن العقد يجمعها كلها.

لم تُسجّل المهمة ولم يُشغّل المنتج على الإنتاج ضمن PR الإنشاء.
