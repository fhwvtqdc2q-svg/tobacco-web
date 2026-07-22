# دفتر تسليم العمل — OZK TOBACCO

يقرأه Claude وCodex قبل كل مهمة. أحدث سجل يكون في الأعلى. لا تحذف السجلات السابقة.

## الحالة الحالية

- الحالة: متزامن مع GitHub — لا مهمة نشطة
- المهمة المفتوحة: لا شيء
- المسؤول: —
- آخر تحديث: 2026-07-22

## 2026-07-22 - Claude - عمل بدون اتصال + تحصين Supabase + سحب نسخ الأمين + تنبيه فشل الإنعاش

- Status: completed
- Branch: main (باتفاق صريح مع المستخدم)
- Files: service-worker.js (جديد), public/service-worker.js, src/app.js, tools/pull-ameen-backup.ps1 (جديد), tools/register-ameen-backup-pull-task.ps1 (جديد), tools/ensure-local-server.ps1, CLAUDE.md, AI_WORK_SYNC.md + ترحيلان في Supabase
- Result: (1) التطبيق يفتح من الكاش حتى لو السيرفر واقف — مُختبر فعلياً بقتل السيرفر (CACHE v342، نطاق جذري). (2) تحصين Supabase مطبق ومُتحقق منه: سحب الأسعار 314 صنفاً ✓ وإشعار تيليغرام ✓ بعد التحصين؛ أُعيدت SELECT لواجهتَي الأسعار لدور anon لأنها التصميم الأصلي (كسرت السحب مؤقتاً وأُصلحت خلال دقائق). (3) مهمة «TOBACCO Ameen Backup Pull» يومياً 23:00 تنسخ أحدث نسخ الأمين إلى OneDrive — تنتظر تفعيل مشاركة \\OZK-TOBACCO\AmeenBackup على جهاز الخادم. (4) الحارس يتحقق بعد محاولة الإنعاش ويرسل تنبيه تيليغرام عند الفشل. نسخ AmnDb002 على الخادم يومية سليمة؛ AmnConfig غير منسوخة أبداً — على المستخدم إضافتها بنسخ الأمين.
- Handoff UTC: 2026-07-22T16:25:00Z

## 2026-07-22 - Claude - حارس السيرفر المحلي وسحب يومي من GitHub وتحديث قاعدة الحفظ والتوثيق

- Status: completed
- Branch: main (أدوات تشغيل Windows وتوثيق، باتفاق صريح مع المستخدم)
- Files: tools/ensure-local-server.ps1, tools/register-local-server-watchdog.ps1, tools/daily-git-pull.ps1, tools/register-daily-git-pull-task.ps1, .gitignore, AI_WORK_SYNC.md, CLAUDE.md, README_AR.md
- Result: مهمة «TOBACCO Local Web Server» كل 5 دقائق تعيد تشغيل سيرفر localhost:5173 إذا توقف (التطبيق المثبّت PWA يعتمد عليه)؛ مهمة «TOBACCO Daily Git Pull» يومياً 07:30 تسحب من GitHub فقط عند نظافة المستودع وغياب قفل نشط؛ تعديل قاعدة الحفظ في AI_WORK_SYNC (المهمة المكتملة تُحفظ فوراً بكوميت على فرعها والنشر يبقى بطلب المستخدم)؛ تجاهل tmp/ و*.bak في Git؛ تصحيح مسارات جهاز DELL القديمة إلى المسار الفعلي على جهاز LOQ.
- Handoff UTC: 2026-07-22T14:05:00Z

## 2026-07-22 - Claude - حفظ أعمال Codex غير المحفوظة ومزامنة main مع GitHub

- Status: completed
- Branch: main (عملية حفظ ومزامنة تنظيمية بطلب صريح من المستخدم، ليست مهمة كود جديدة)
- Files: كل تعديلات Codex المتراكمة 2026-07-15 → 2026-07-21 (17 ملفاً معدّلاً) + الملف الجديد supabase/telegram-daily-cash-report.sql
- Result: أعمال Codex الموثقة أدناه كمكتملة كانت كلها بلا أي commit، والنسخة المحلية متأخرة 31 كوميتاً عن origin/main. حُفظت بكوميت واحد ثم rebase على origin/main؛ التعارض الوحيد كان سطر CACHE_NAME في public/service-worker.js (v309 محلياً مقابل v339 على GitHub) وحُلّ برفعه إلى v340. نجح npm run check قبل الدفع. ملفات tmp/ و‎*.bak تُركت خارج Git عمداً.
- Handoff UTC: 2026-07-22T13:56:00Z

## 2026-07-21 - Codex - إصلاح تفاصيل الدفعات اليومية وحركة الصناديق في بوت تيليغرام

- Status: completed
- Branch: task branch pending for: إصلاح تفاصيل الدفعات اليومية وحركة الصناديق في بوت تيليغرام
- Files: supabase/functions/telegram-webhook/index.ts,tools/push-daily-movement.ps1,tools/ameen-sync-agent.ps1,supabase/telegram-notifications.sql,CLAUDE.md
- Result: نُشر telegram-webhook v40، أضيف أمر دفعات اليوم وحركة الصندوق، فُعّلت مزامنة كل 5 دقائق والتقرير المسائي 23:02، وصُحح توافق PowerShell 5.1. نجح npm check والاختبار الحي وحالة HTTP 200.
- Handoff UTC: 2026-07-21T01:13:10Z
## 2026-07-16 - Codex - تصحيح مصدر أرصدة الذمم إلى ac000 بالدولار

- Status: completed
- Branch: task branch pending for: تصحيح مصدر أرصدة الذمم إلى ac000 بالدولار
- Files: tools/ameen-customer-balances-query.sql,src/app.js,scripts/check.mjs,AI_WORK_SYNC.md,index.html,public/service-worker.js
- Result: أصبحت المزامنة تستخدم ac000 بالدولار، أزيل التحويل الثاني من الترتيب، وشُغلت مزامنة حية ناجحة لـ284 زبوناً.
- Handoff UTC: 2026-07-16T10:31:09Z
## 2026-07-16 - Codex - تصحيح ترتيب تقرير الذمم حسب قيمة الدين بعد توحيد العملة

- Status: completed
- Branch: task branch pending for: تصحيح ترتيب تقرير الذمم حسب قيمة الدين بعد توحيد العملة
- Files: src/app.js,scripts/check.mjs,index.html,public/service-worker.js
- Result: صار ترتيب أرصدة الدولار والسوري بحسب القيمة المرجعية بعد التحويل، مع بقاء العرض بالعملة الأصلية؛ نجح npm check واختبار الترتيب.
- Handoff UTC: 2026-07-16T10:00:46Z
## 2026-07-15 - Codex - إضافة تقرير الربح اليومي الحقيقي إلى بوت تيليغرام

- Status: completed
- Branch: task branch pending for: إضافة تقرير الربح اليومي الحقيقي إلى بوت تيليغرام
- Files: tools/push-daily-profit.ps1,supabase/functions/telegram-webhook/index.ts,CLAUDE.md
- Result: حساب مباشر من الأمين للمبيعات والتكلفة والحسومات والمرتجعات والمصاريف؛ نُشرت Edge Function v39؛ تحقق التشغيل التلقائي والمقارنة الفعلية.
- Handoff UTC: 2026-07-15T11:00:50Z
## 2026-07-15 - Codex - إضافة أمر حالة النظام إلى بوت تيليغرام

- Status: completed
- Branch: task branch pending for: إضافة أمر حالة النظام إلى بوت تيليغرام
- Files: supabase/functions/telegram-webhook/index.ts,CLAUDE.md
- Result: أضيف أمر وزر حالة النظام لفحص حداثة المخزون والأرصدة والفواتير والحركات والأسعار والنشرة وحركة المبيعات. نُشرت Edge Function v38، البيانات الحية ضمن الحدود، ولا توجد أخطاء 5xx حديثة.
- Handoff UTC: 2026-07-15T10:17:23Z
## 2026-07-15 - Codex - إضافة فحص مزامنة الأسعار وتنبيهاتها إلى بوت تيليغرام

- Status: completed
- Branch: task branch pending for: إضافة فحص مزامنة الأسعار وتنبيهاتها إلى بوت تيليغرام
- Files: tools/sync-approved-prices-to-ameen.ps1,tools/publish-price-sync-status.ps1,supabase/functions/telegram-webhook/index.ts,CLAUDE.md
- Result: أضيف أمر فحص الأسعار وزر بالقائمة، حفظ نتيجة فحص Windows في inventory_reports، وتنبيه تلقائي عند الفروقات أو فشل الفحص. نُشرت Edge Function v36 وتحققت المهمة المجدولة برمز 0 وصفر فروق.
- Handoff UTC: 2026-07-15T09:30:49Z
## 2026-07-15 - Codex - تصحيح والتحقق من مزامنة أسعار النشرة مع الأمين

- Status: completed
- Branch: task branch pending for: تصحيح والتحقق من مزامنة أسعار النشرة مع الأمين
- Files: tools/apply-approved-prices-to-ameen.ps1,tools/verify-prices.ps1
- Result: اعتماد أحدث سجل لكل اسم قبل التطبيق والفحص؛ مزامنة فعلية وفحص مستقل: صفر فروق، جملة 248 ومفرق 241.
- Handoff UTC: 2026-07-15T09:10:16Z
## 2026-07-15 - Codex - تصحيح سعري ماستر كوين و1970 كوين

- Status: completed
- Branch: task branch pending for: تصحيح سعري ماستر كوين و1970 كوين
- Files: scripts/generate-price-lists.mjs,scripts/check.mjs,public/downloads/*,public/service-worker.js,AI_WORK_SYNC.md
- Result: صُححت النشرة واعتمد تأكيد المستخدم: ماستر كوين أبيض 340$ و1970 كوين أبيض 275$. أُعيد توليد PDF وتحقق السعران على الموقع الحي.
- Handoff UTC: 2026-07-15T08:55:39Z
## 2026-07-15 - Codex - تصحيح مزامنة أسعار النشرة ومنع الأسعار القديمة

- Status: completed
- Branch: task branch pending for: تصحيح مزامنة أسعار النشرة ومنع الأسعار القديمة
- Files: src/app.js,scripts/generate-price-lists.mjs,scripts/check.mjs,public/downloads/*,public/service-worker.js,index.html,AI_WORK_SYNC.md
- Result: دُققت 27 مجموعة مفاتيح مكررة، ووُحّد حفظ aliases، وأضيف نشر تلقائي بعد آخر تعديل. أُعيد التوليد بصرف 13300 وتحقق الموقع الحي: ماستر كوين أبيض 350 و1970 كوين أبيض 260.
- Handoff UTC: 2026-07-15T08:51:15Z
## 2026-07-15 - Codex - السماح بتسعير نشرة السوري دون سعر جملة

- Status: completed
- Branch: task branch pending for: السماح بتسعير نشرة السوري دون سعر جملة
- Files: src/app.js,scripts/check.mjs,index.html,public/service-worker.js,AI_WORK_SYNC.md
- Result: أتيح سعر المفرق دون الجملة، أضيف سعر صرف يومي محفوظ ومُرسل للتوليد، حُذف عداد المواد، استُبدل علم سوريا، وأزيل البياض من جميع صفحات PDF الداكنة. نجحت الفحوص والنشر الحي.
- Handoff UTC: 2026-07-15T08:38:05Z
## 2026-07-15 - Codex - إصلاح نشر تحديثات أسعار النشرة تلقائياً

- Status: completed
- Branch: task branch pending for: إصلاح نشر تحديثات أسعار النشرة تلقائياً
- Files: .github/workflows/generate-price-lists.yml,scripts/check.mjs,AI_WORK_SYNC.md
- Result: ثبت أن Supabase والملف المولد يحملان 355$ لماستر طويل ورق، وأزيل skip ci من دفع المولد لتشغيل Pages تلقائياً. تحقق السعر الحي 355$ ونجح النشر والفحوص.
- Handoff UTC: 2026-07-15T08:16:23Z
## 2026-07-15 - Codex - توحيد قائمة التسعير داخل الموقع مع قواعد النشرة العامة

- Status: completed
- Branch: task branch pending for: توحيد قائمة التسعير داخل الموقع مع قواعد النشرة العامة
- Files: src/app.js,scripts/check.mjs,index.html,public/service-worker.js,AI_WORK_SYNC.md
- Result: استبعاد الوزاري من القائمة العامة، تطبيق الدمج المعتمد، شرط الوحدة الثانية الكاملة للجملة، وحفظ السعر على جميع المصادر المدمجة. نجح npm check وفحص المتصفح على الهاتف.
- Handoff UTC: 2026-07-15T07:58:42Z
## 2026-07-15 - Codex - تثبيت ودمج بوت تيليغرام وحذف المبيعات من التقرير الصباحي

- Status: completed
- Branch: task branch pending for: تثبيت ودمج بوت تيليغرام وحذف المبيعات من التقرير الصباحي
- Files: supabase/functions/telegram-webhook/index.ts,supabase/telegram-notifications.sql,tools/push-sales-line-items.ps1,tools/push-expense-entries.ps1,tools/register-sales-line-items-task.ps1,tools/register-expense-entries-task.ps1,CLAUDE.md
- Result: دُمج فرع البوت كاملاً في main، حُذفت المبيعات من التقرير الصباحي، بقيت في المسائي والأوامر، وصُححت تسميات أسعار البوت للدولار. نجح npm check وDeno check.
- Handoff UTC: 2026-07-15T07:47:12Z
## 2026-07-15 - Codex - فصل أرصدة الزبائن في تبويب مستقل

- Status: completed
- Branch: task branch pending for: فصل أرصدة الزبائن في تبويب مستقل
- Files: src/app.js,scripts/check.mjs,index.html,public/service-worker.js
- Result: فُصلت أرصدة الزبائن والحد المسموح عن الأمين إلى تبويب مستقل محمي بعد الدخول، مع ربط البحث والتحديث والتصدير، وفحوص ونشر ناجح.
- Handoff UTC: 2026-07-15T07:28:07Z
## 2026-07-15 - Codex - إضافة قيمة آخر دفعة إلى تقرير أرصدة الزبائن

- Status: completed
- Branch: task branch pending for: إضافة قيمة آخر دفعة إلى تقرير أرصدة الزبائن
- Files: src/app.js,scripts/check.mjs,index.html,public/service-worker.js
- Result: أضيف عمود قيمة آخر دفعة بجانب تاريخها في تقرير الذمم PDF من حقل مزامنة الأمين، مع فحص منع الرجوع ورفع نسخ الأصول والكاش، والنشر ناجح.
- Handoff UTC: 2026-07-15T07:20:07Z
## 2026-07-15 - Codex - إصلاح كاش تقرير المخزون القديم

- Status: completed
- Branch: task branch pending for: إصلاح كاش تقرير المخزون القديم
- Files: index.html,public/service-worker.js,scripts/check.mjs
- Result: ثبت أن الصورة تستخدم app.js القديم. رُفعت نسخة أصول index إلى tobacco-88 وكاش PWA إلى v272، وأضيف فحص منع الرجوع، وتحقق النشر من الروابط الحية.
- Handoff UTC: 2026-07-15T07:13:42Z
## 2026-07-15 - Codex - تحويل تقرير المخزون الفاتح إلى عمودين متقابلين

- Status: completed
- Branch: task branch pending for: تحويل تقرير المخزون الفاتح إلى عمودين متقابلين
- Files: src/app.js,public/service-worker.js,scripts/check.mjs
- Result: تم تقسيم التقرير إلى صفحات A4 بعمودين متقابلين، الغلواز يميناً والماستر يساراً، مع موازنة المجموعات وفحص PDF بصرياً ونشر ناجح.
- Handoff UTC: 2026-07-15T07:06:30Z
## 2026-07-15 - Codex - إعادة تصميم تقرير المخزون وترتيبه وتصحيح تصنيف الحالات

- Status: completed
- Branch: task branch pending for: إعادة تصميم تقرير المخزون وترتيبه وتصحيح تصنيف الحالات
- Files: src/app.js,scripts/check.mjs,public/service-worker.js,AI_WORK_SYNC.md
- Result: تم اعتماد تقرير مخزون فاتح مرتب حسب النشرة، مع كل صنف مستقل وتصنيف يعتمد حركة المبيع، ونجحت الفحوص والنشر.
- Handoff UTC: 2026-07-15T03:11:42Z
## 2026-07-15 - Codex - إضافة طباعة هاتف مباشرة وملفات PDF فاتحة وداكنة

- Status: completed
- Branch: task branch pending for: إضافة طباعة هاتف مباشرة وملفات PDF فاتحة وداكنة
- Files: scripts/generate-price-lists.mjs,scripts/generate-pdfs.mjs,scripts/check.mjs,src/app.js,public/downloads/*,public/service-worker.js
- Result: تم إنشاء PDF فاتح وداكن لكل نشرة، إضافة طباعة مباشرة وفتح وتنزيل متوافق مع الهاتف، وربط اللون المختار بالملف الصحيح. تم التحقق من الملفات الثمانية ومن تبديل الرابط على الموقع المنشور بواجهة هاتف دون overflow.
- Handoff UTC: 2026-07-15T01:13:49Z
## 2026-07-14 - Codex - إصلاح زر الطباعة على الهاتف ومنع حجب التبويب الجديد

- Status: completed
- Branch: task branch pending for: إصلاح زر الطباعة على الهاتف ومنع حجب التبويب الجديد
- Files: src/app.js,scripts/generate-price-lists.mjs,public/downloads/price-list-usd.html,public/downloads/price-list-syp-14050.html,public/downloads/price-list-wazari-usd.html,public/downloads/price-list-wazari-syp-14050.html,public/service-worker.js,scripts/check.mjs
- Result: تم إلغاء فتح PDF في تبويب جديد، واعتماد الفتح في الصفحة نفسها مع زر تنزيل احتياطي في النشرات الأربع، وإعادة التوليد من Supabase، وفحص الروابط المنشورة. نجحت الفحوص والنشر.
- Handoff UTC: 2026-07-14T19:53:28Z
## 2026-07-14 - Codex - إصلاح طباعة نشرات الأسعار وتوحيدها على PDF الرسمي

- Status: completed
- Branch: task branch pending for: إصلاح طباعة نشرات الأسعار وتوحيدها على PDF الرسمي
- Files: src/app.js,scripts/generate-price-lists.mjs,public/downloads/index.html,public/downloads/price-list-usd.html,public/downloads/price-list-syp-14050.html,public/downloads/price-list-wazari-usd.html,public/downloads/price-list-wazari-syp-14050.html,public/service-worker.js,scripts/check.mjs
- Result: تم استبدال التوليد القديم داخل المتصفح بروابط PDF الرسمية، وإضافة زر فتح PDF للطباعة لكل نشرة، وإعادة توليد وفحص A4 والخلفيات والصفحات، والتحقق من الروابط المنشورة. جميع الفحوص والنشر ناجحة.
- Handoff UTC: 2026-07-14T19:30:32Z
## 2026-07-14 - Codex - تحويل صفحة التسعير إلى مركز نشرة الأسعار داخل الموقع

- Status: completed
- Branch: task branch pending for: تحويل صفحة التسعير إلى مركز نشرة الأسعار داخل الموقع
- Files: index.html,src/app.js,src/styles.css,public/service-worker.js
- Result: تم دمج مركز النشرة داخل الموقع، وربط النسخ الأربع والمعاينة والنشر، وتحسين الهاتف، وإضافة فحوص منع الرجوع. نجح npm check وnode check وgit diff check، وفحص المتصفح للكمبيوتر والهاتف والفاتح والداكن والروابط والكونسول، ونجح النشر الفعلي.
- Handoff UTC: 2026-07-14T18:28:18Z
## 2026-07-14 - Codex - إكمال ملفات PDF النهائية للنشرات وإزالة الهوامش البيضاء

- Status: completed
- Branch: task branch pending for: إكمال ملفات PDF النهائية للنشرات وإزالة الهوامش البيضاء
- Files: scripts/generate-pdfs.mjs,public/service-worker.js
- Result: تم إنشاء PDF للدولار والسوري والوزاري بهوامش صفرية وخلفية داكنة كاملة، ومنع صفحة الوزاري الفارغة، وفحص كل الصفحات بصرياً. npm check وgit diff check ناجحان.
- Handoff UTC: 2026-07-14T17:18:20Z
## 2026-07-14 - Codex - Redesign price list with light and dark themes

- Status: completed
- Branch: task branch pending for: Redesign price list with light and dark themes
- Files: 'scripts/generate-price-lists.mjs','public/downloads/index.html','public/downloads/price-list-usd.html','public/service-worker.js'
- Result: تم اعتماد ودمج نشرات الدولار والسوري والوزاري، مزامنة حد الوحدة الثانية، تنسيق الطباعة، العنوان والتواصل، وتجميع السيغار. جميع الفحوص نجحت.
- Handoff UTC: 2026-07-14T15:11:42Z
## 2026-07-14 - Codex - اعتماد نشرات الأسعار والمزامنة

- Status: completed and verified
- Branch: `feat/price-list-light-dark`
- Files: `scripts/generate-price-lists.mjs`, `tools/ameen-sync-agent.ps1`, `public/downloads/*`, `public/service-worker.js`, `supabase/available-price-sync-feed.sql`, `AI_WORK_SYNC.md`
- Result: نشرتا الدولار والسوري بتنسيق فاتح/داكن وعمودين متوازنين؛ فصل الوزاري؛ صفحة مستقلة للمعسل والفحم؛ طباعة بخلفية كاملة ومسطرة ذهبية؛ تكبير أرقام التواصل وإضافة «دوما – ساحة الغنم»؛ ربط مخزون النشرة بتغيّر العدد الصحيح للكرتونة/الطرد/الشرحة.
- Inventory verification: مهمة `TOBACCO Ameen Sync` تعمل كل دقيقة، وآخر تشغيل نجح. بعد تحديث الأمين بقي في نشرة الدولار من كورسير فقط «كورسير قصير فضي» (52/50).
- Checks: `npm.cmd run check`, `git diff --check`, PowerShell parser, uniqueness checks for all four lists.
- Generated lists: general USD 125 rows, general SYP 165 rows, wazari USD 7 rows, wazari SYP 9 rows at final generation.

## 2026-07-14 - Codex - Enable Claude Codex coordination

- Status: completed
- Branch: chore/ai-work-coordination
- Files: 'AI_WORK_SYNC.md','AI_HANDOFF.md','AI_ACTIVE_TASK.json','tools/ai-work-coordination.ps1','scripts/check.mjs'
- Result: Coordination files and lock workflow implemented; project checks passed.
- Handoff UTC: 2026-07-14T12:39:33Z
## 2026-07-14 — Codex — إنشاء نظام التنسيق

- الحالة: مكتمل محلياً
- تم: إضافة قواعد التنسيق، قفل المهمة، دفتر التسليم، وأداة فتح وإغلاق المهام.
- الملفات: `AI_WORK_SYNC.md`, `AI_ACTIVE_TASK.json`, `AI_HANDOFF.md`, `tools/ai-work-coordination.ps1`, `AGENTS.md`, `CLAUDE.md`, `scripts/check.mjs`.
- التحقق: `npm.cmd run check` و`git diff --check`.
- المتبقي: لا شيء بعد رفع التغييرات إلى GitHub.
- ملاحظة للمتابع: اقرأ آخر سجل وملف القفل قبل تعديل أي ملف.
