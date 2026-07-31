exit 1
# ============================================================
# sync-returns-to-ameen.ps1
# LOCKED FILE - DO NOT REMOVE THE "exit 1" ABOVE.
# The unconditional exit above is intentional and mandatory: this script must
# never write to the Ameen accounting database (AmnDb002) until a human owner
# (ozk.kh@outlook.com) explicitly approves every GUID/series/account used
# below, after real discovery via discover-ameen-returns-schema.ps1 has been
# run successfully on this machine and reviewed. Do not delete, comment out,
# or bypass the exit line for any reason, including test runs.
#
# ============================================================
# ARABIC (design intent, kept ASCII-safe in this comment block on purpose so
# the "exit 1" guard above stays the unmistakable first executable line):
#
# عامل الكتابة المستقبلي لمزامنة مستندات المرتجعات (مبيعات جملة/مركز،
# مشتريات) من Supabase (جدول returns، الحالة sync_pending) إلى قاعدة الأمين
# AmnDb002 كمستندات فعلية (bu000/bd000 حسب ameen-returns-config.json)، ثم
# التحقق من نجاح الكتابة بإعادة قراءة المستند من الأمين قبل تعليم المرتجع
# synced في Supabase.
#
# مبادئ التصميم المُلزمة عند التفعيل مستقبلاً (موثّقة هنا كي لا تُنسى):
#   - معاملة SQL واحدة (transaction) لكل مرتجع - commit كامل أو rollback كامل.
#   - فحص idempotency_key/ameen_document_guid قبل الكتابة (لا كتابة مزدوجة عند
#     إعادة تشغيل العامل بعد انقطاع).
#   - التحقق (verify) من المستند المكتوب فعلياً في الأمين قبل تعليم المرتجع
#     "synced" في Supabase - لا "افتراض نجاح" لمجرد عدم رمي استثناء.
#   - عند الفشل: تسجيل sync_error وترقية sync_attempts وحالة failed فقط - أبداً
#     لا تراجع عن approved/sync_pending نحو draft.
#   - لا افتراض GUID سلسلة/حساب زبون أو مورد/صندوق افتراضي - كلها تُقرأ من
#     ameen-returns-config.json بعد اكتشاف فعلي موثّق عبر discover-ameen-returns-schema.ps1.
#   - كل نوع مرتجع (sales_wholesale/sales_retail/purchase) يجب أن يُكتب على
#     سلسلة ترقيم الأمين الصحيحة الخاصة به فقط (لا خلط بين السلاسل الثلاث).
#   - مرتجع المبيعات: إعادة الكمية للمخزون (اتجاه in)، تخفيض ذمم الزبون إن كانت
#     الفاتورة الأصلية آجلة، أو استرداد نقدي من نفس صندوق الفاتورة الأصلية فقط
#     إن كانت نقدية (لا يجوز اختيار صندوق آخر).
#   - مرتجع المشتريات: إخراج الكمية من المخزون (اتجاه out)، تخفيض ذمم المورد
#     دائماً بغض النظر عن طريقة الدفع الأصلية.
#   - عكس الربح/التكلفة يقتصر على نسبة الكمية المرتجعة فقط، وبنفس أساس السعر/
#     التكلفة المستخدم في السطر الأصلي - لا إعادة تسعير.
#
# لا تُفعِّل هذا السكربت، ولا تُزل exit 1 أعلاه، إلا بموافقة كتابية صريحة من
# ozk.kh@outlook.com بعد مراجعة تفصيلية لكل قيمة بـameen-returns-config.json.
# ============================================================
