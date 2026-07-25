# دفتر تسليم العمل — OZK TOBACCO

يقرأه Claude وCodex قبل كل مهمة. أحدث سجل يكون في الأعلى. لا تحذف السجلات السابقة.

## الحالة الحالية

- الحالة: متزامن مع GitHub — لا مهمة نشطة
- المهمة المفتوحة: وحدة الفاتورة (متطلبات 1–23) — الدفعة الأولى نُشرت، والدفعات التالية قادمة
- المسؤول: —
- آخر تحديث: 2026-07-25

## 2026-07-25 - Codex - مراجعة سلامة إنزال دفعة ١ من وحدة الفاتورة

- Status: verified for Git/history and desktop functionality; mobile functionality passed but iPhone viewport fit did not pass. لا commit أو push أو merge من Codex.
- `main` على GitHub والجهاز:
  1. بعد `git fetch origin --prune` كان `HEAD` و`origin/main` متطابقين عند `2d3fc3d`، و`git status -sb` نظيفاً قبل إضافة هذا السجل. دمج دفعة الفاتورة موجود عبر PR #18 عند `d72c27c`.
  2. `src/app.js` على `origin/main` يحتوي route `sales` ضمن `allowedRoutes` ودالتَي `salesInvoice` و`salesSaveInvoice`.
  3. `public/service-worker.js` يحتوي `CACHE_NAME = "web-platform-tobacco-v365"`.
  4. `npm.cmd run check` ناجح (`Project check passed`) و`git diff --check` نظيف. فحص كل الملفات المتتبعة على `origin/main` والنسخة المحلية لم يجد أياً من markers التعارض `<<<<<<< / ======= / >>>>>>>`.
  5. مقارنة عناوين سجلات `AI_HANDOFF.md` مع مصدرَي الدمج وجدت: سجلات الفاتورة `4/4` محفوظة، وسجلات تصادم 273/274 `4/4` محفوظة، وصفر عناوين مفقودة.
- فرع `fix/supabase-item-number-save`:
  1. `origin/fix/supabase-item-number-save` مطابق للكوميت `814df70`، وقاعدته `695b69d`. الفرق عن القاعدة ملفان فقط: `src/supabase-client.js` و`AI_HANDOFF.md` (`74` إضافة و`2` حذف).
  2. `upsertApprovedPriceItems` يجلب `item_key,item_number` ويحافظ على الرقم عند نجاح الجلب؛ وعند فشل الجلب لا يرسل حقل `item_number` فلا يغيّره.
  3. `replaceApprovedPriceItems` يحافظ على الرقم لكل `item_key`، ويرمي خطأ قبل الحذف إذا فشل الجلب. لا تعديل في حقول السعر أو المخزون أو أي دالة أخرى.
  4. فرق `AI_HANDOFF.md` يحتوي سجلّي مراجعة Codex المطلوبين فقط: المراجعة الأولى ثم اعتماد fallback الآمن.
  5. `814df70` ليس ancestor لـ`origin/main` (`merge-base --is-ancestor` أعاد 1)، والفرع البعيد الوحيد الذي يحتويه هو `origin/fix/supabase-item-number-save`; أي أن تعديل #1 محفوظ ولم يُدمج في `main`.
- اختبار متصفح حي على كود `main` المحلي، مع جلسة Supabase ومخزن بيانات وهميين لمنع أي كتابة إنتاجية:
  1. نجح تسجيل الدخول من نموذج الدخول على سطح المكتب 1440×900 ومحاكاة iPhone 390×844، ثم فتح «فاتورة مبيعات» من القائمة.
  2. نجحت الدورة في البيئتين: بحث `123` ثم Enter نقل إلى الكمية، وEnter نقل إلى السعر ثم بحث السطر التالي. كمية `2` وسعر `125` وحسم `20` ومدفوع `100` أعطت إجمالي `$250.00` وصافي `$230.00` و«عليه `$130.00`»؛ المدفوع `230` أعطى «مسدّد `$0.00`»، و`300` أعطى «له `$70.00`».
  3. الطباعة استُدعيت في البيئتين، واحتوى قالبها الصنف و«المتبقّي (عليه)» و`$130.00`. لم تظهر أخطاء page أو console.
  4. سطح المكتب ملائم بلا overflow أفقي (`scrollWidth=clientWidth=1440`). محاكاة iPhone نجحت وظيفياً لكنها فشلت بصرياً: `clientWidth=390` مقابل `scrollWidth=608`، وبطاقة الفاتورة عرضها نحو `576px` وظهرت مقصوصة أفقياً. هذا يعيد الملاحظة السابقة؛ لا يجوز اعتماد ملاءمة iPhone قبل إصلاحها والتحقق على جهاز فعلي.
- حدود الدليل الحي: الاختبار شغّل واجهة `main` الحقيقية محلياً بمدخلات ماوس/لمس ولوحة مفاتيح، لكنه لم يستخدم حساب Supabase إنتاجياً ولا iPhone مادياً، ولم ينشئ مستنداً إنتاجياً.
- Boundaries: لم تُشغّل مزامنة فعلية، ولم تُلمس أسعار أو مخزون، ولم يحدث commit/push/merge. التغيير الوحيد هو سجل المراجعة الحالي غير المثبّت في `AI_HANDOFF.md`.
- Handoff UTC: 2026-07-25T00:25:46Z

## 2026-07-25 - Claude - إنزال دفعة ١ من وحدة الفاتورة على main + نشر + حفظ تعديل #1

- Status: completed — دُمجت دفعة ١ في main (PR #18) ونُشرت على الموقع؛ حُفظ تعديل #1 على فرعه؛ سُحبت النسخة على الجهاز
- Branch: `feat/invoice-module` → merged في main عبر PR #18 (`d72c27c`)
- ما نُفّذ:
  1. **دفعة ١ من وحدة الفاتورة**: وصل route `sales` بـ`allowedRoutes`؛ رقم فاتورة تسلسلي شهري `SAL-YYMM-0001` يُحجز بعد نجاح الحفظ فقط (لا فجوات، حارس ضد القيم التالفة)؛ منع الحفظ المكرر (`salesSaving`)؛ تركيز تلقائي واختصارات Enter؛ حالة المتبقّي (عليه/له/مسدّد) في الشاشة والمطبوعة.
  2. راجعها Codex ٤ مرات؛ أُصلحت ملاحظاته (0NaN، سباق الحفظ، الفجوات). القيد المتبقّي **P1 مؤجّل بموافقة المالك**: عدّاد الأرقام محلي لكل جهاز، قد يتكرّر رقم بين جهازين متزامنين — الحل الكامل عدّاد مركزي في Supabase يأتي مع مرحلة خصم المخزون/تقييد الذمم. الفاتورة الآن **مستند + طباعة فقط** (لا مخزون/ذمم)، محجوبة خلف تسجيل الدخول.
  3. دُمج origin/main في الفرع قبل الدمج (حُلّ تعارض AI_HANDOFF بدمج كل السجلات، وCACHE_NAME → v365، الأصول tobacco-99).
  4. **تعديل #1** (إصلاح حفظ item_number في upsert/replace، كان غير محفوظ على main worktree) حُفظ على فرع `fix/supabase-item-number-save` (`814df70`) — **ينتظر تحقّقاً حياً** (نشر أسعار ثم `pull-item-numbers.ps1 -WhatIf` واعتماد «مطابق بالاسم»=314) قبل دمجه في main.
- الفحوص: `npm check` ناجح، `git diff --check` نظيف، ٢٧ اختباراً منطقياً معزولاً ناجحاً، وDeploy TOBACCO Web على main نجح.
- التالي: تحقّق حي من تعديل #1 ودمجه؛ ثم دفعات وحدة الفاتورة التالية (معلومات الصنف/المستودعات/التكلفة/الربح، الرصيد الحي وحد الائتمان، آخر سعر للزبون، الأدوار مدير/محاسب، المرتجعات، ثم خصم المخزون/تقييد الذمم بالتوازي مع الأمين).
- Handoff UTC: 2026-07-25T00:15:00Z

## 2026-07-25 - Codex - مراجعة إصلاح ترقيم الفواتير وسباق الحفظ

- Status: partially verified — أصلح `cf02228` الأخطاء السابقة داخل التبويب الواحد، لكن بقي خلل تحقق بالقيم التالفة وسباق عابر للتبويبات؛ لا commit أو push أو merge من Codex.
- Branch/worktree: `feat/invoice-module` في `.claude/worktrees/agent-aba8cb3159c146563`، مطابق لـ`origin/feat/invoice-module`.
- commit reviewed: `cf02228` «إصلاح ملاحظات مراجعة Codex على دفعة ١ (ترقيم الفواتير وسباق الحفظ)».
- النطاق:
  1. الـcommit يغيّر ملفين فقط: `src/app.js` و`AI_HANDOFF.md`.
  2. فرق الكود محصور بحالة `salesSaving` ودوال تسلسل/حجز رقم فاتورة `sales` وحفظها. لم يتغير route/dالة `invoice` القديمة، ولا الأسعار أو المخزون أو أي مسار مزامنة.
- القيم التالفة:
  1. `seq="broken"` و`null` والسالب والكائن وJSON المكسور أعادت جميعها `SAL-2607-0001`، ولم يظهر `0NaN`.
  2. الشرط المطلوب لم يتحقق كاملاً: `seq=3.7` أعطى `SAL-2607-0004` بسبب `Math.floor`، والنص الرقمي `seq="7"` أعطى `SAL-2607-0008` بسبب التحويل بـ`Number`. إذا كانت أي قيمة غير integer number تُعد تالفة، فيجب فحص `typeof saved.seq === "number" && Number.isInteger(saved.seq) && saved.seq > 0`.
- الفجوات والفشل:
  1. بعد حذف المفتاح، أربع مرات فتح/إعادة تحميل متتالية بقيت على `SAL-2607-0001` وبقي `localStorage["sales-invoice-seq"]` غير موجود؛ العرض لم يعد يستهلك الرقم.
  2. بعد حفظ ناجح حُجز `seq=1`، و«فاتورة جديدة» أخذت `SAL-2607-0002` بلا قفزة.
  3. فشل شبكة معزول (`TypeError: Failed to fetch`) أثناء حفظ `0002` لم يضف مستنداً، ولم يغيّر `seq=1`، وبقيت الفاتورة التالية `0002` بعد reload. الزر كان معطلاً أثناء الانتظار وعاد مفعّلاً بعد الفشل.
- السباق:
  1. نقرتان سريعتان فعليتان داخل التبويب نفسه أنشأتا مستنداً واحداً فقط برقم `0001`. زر الحفظ تعطّل أثناء مهلة الحفظ وعاد بعدها، ثم ظهر الرقم التالي `0002`.
  2. تبويبان في browser context واحد يشتركان في `localStorage`: عند الحفظ المتسلسل من الأول ثم الثاني حُفظ الرقمان `0001` ثم `0002` بلا تكرار.
  3. خلل P1 استكشافي: عند بدء الحفظ من التبويبين معاً قبل اكتمال أي منهما، حُفظ مستندان كلاهما `SAL-2607-0001`. `salesSaving` محلي لكل تبويب، والرقم لا يُحجز إلا بعد `await createSharedDocument`؛ يلزم قيد uniqueness/عداد ذري في مخزن مشترك، أو حجز عابر للتبويبات قبل إنشاء المستند مع آلية تراجع آمنة.
- Checks: `npm.cmd run check` ناجح (`Project check passed`)؛ `git diff --check` و`git diff --check cf02228^ cf02228` نظيفان.
- بيئة الاختبار: متصفح محلي معزول ومخزن `createSharedDocument` وهمي مشترك بين التبويبات؛ لم تُكتب أي بيانات في Supabase أو `shared_documents` الإنتاجية.
- Boundaries: لم تُشغّل مزامنة فعلية، ولم تُلمس أسعار أو مخزون، ولم يحدث commit/push/merge. التغيير الوحيد بعد الفحوص هو سجل المراجعة الحالي غير المثبّت في `AI_HANDOFF.md`.
- Handoff UTC: 2026-07-24T23:40:15Z

## 2026-07-23 - Codex - مراجعة «وحدة الفاتورة (دفعة ١)»

- Status: reviewed — نطاق الـcommit سليم والفحوص ناجحة، لكن وُجد خللان وظيفيان يجب إصلاحهما قبل اعتماد الدفعة؛ لا commit أو push أو merge من Codex.
- Branch/worktree: `feat/invoice-module` في `.claude/worktrees/agent-aba8cb3159c146563`
- commit reviewed: `5afa28e` «وحدة الفاتورة (دفعة ١)»
- النطاق:
  1. `git show 5afa28e --stat` و`git show 5afa28e` وفرق الأسماء أكدت أن الـcommit يغيّر `src/app.js` فقط (`74` إضافة و`7` حذف).
  2. التغيير محصور بقبول route `sales` المباشر، وتسلسل رقمها، وحالة المتبقّي، وتركيز/Enter، ومنع الحفظ المكرر في وحدة المبيعات. لم يتغير route/dالة `invoice` القديمة، ولا التسعير أو المخزون أو أي دالة مزامنة.
- نتائج الرقم التسلسلي:
  1. الصيغة الصحيحة `SAL-YYMM-0001`، والانتقال إلى شهر آخر يعيد العداد إلى `0001`. JSON غير صالح نحوياً يرجع بأمان إلى `0001`.
  2. خلل: تخزين صالح نحوياً لكن `seq` تالف دلالياً، مثل `{"period":"2607","seq":"broken"}`، يولّد فعلياً `SAL-2607-0NaN`. يلزم قبول عدد صحيح غير سالب فقط وإلا البدء من `1`.
  3. الرقم يُستهلك عند رسم شاشة `sales` لا عند نجاح الحفظ: فتح `?route=sales` أعطى `0001`، وإعادة التحميل من دون أي حفظ أعطت `0002` مع صفر استدعاءات حفظ. هذا يخلق فجوات مزعجة لكل reload أو مسودة متروكة؛ الأفضل حجز/زيادة الرقم عند الحفظ الناجح أو اعتماد عداد مركزي لاحقاً.
- نتائج الحفظ:
  1. بعد اكتمال الحفظ، إعادة الضغط لا تحفظ ثانية (`1` استدعاء و`1` مستند)، وبعد «فاتورة جديدة» سُمح بالحفظ برقم جديد (`0002`) كما هو مطلوب.
  2. خلل سباق: نقرتان متزامنتان قبل انتهاء `await createSharedDocument` نفّذتا استدعاءين وحفظتا مستندين بالرقم نفسه `SAL-2607-0003`. `salesSavedNo` لا يُضبط إلا بعد انتهاء الاستدعاء؛ يلزم حارس in-flight/تعطيل الزر قبل `await`.
- اختبار حي مع مخزن وهمي معزول كلياً:
  1. الهاتف 390×844: لمسة حقيقية على اقتراح الصنف نقلت التركيز فوراً إلى `qty` داخل سياق اللمس، ثم نجح المسار بحث/Enter → كمية/Enter → سعر/Enter → بحث السطر التالي.
  2. سطح المكتب 1440×900 والهاتف: كمية `2` وسعر `125` وحسم `20` ومدفوع `100` أعطت إجمالي `$250.00` وصافي `$230.00` و«عليه `$130.00`». المدفوع `230` أعطى «مسدّد `$0.00`»، و`300` أعطى «له `$70.00`» بالقيمة المطلقة.
  3. المفرق: سعر الوحدة التلقائي `201000` ل.س وصافي `400000` ل.س؛ الحالات الثلاث ظهرت صحيحة، و«عليه/له» عرضتا `100,000 ل.س` بالقيمة المطلقة.
  4. قالب الطباعة المولّد احتوى «المتبقّي (عليه)» و`$130.00` للدولار، و«المتبقّي (له)» و`100,000 ل.س` للمفرق، بلا إشارة سالبة. الرابط `?route=sales` بقي نفسه بعد إعادة التحميل.
  5. Enter في `#inv-customer` داخل الفاتورة القديمة أبقى القيمة والتركيز كما هما، ولا توجد `data-sales-field` خارج route `sales`; لم يظهر تداخل مع الحقول القديمة.
- ملاحظة من اختبار رأس الفرع الحالي، خارج فرق `5afa28e`: محاكاة iPhone الفعلية (`isMobile + hasTouch`) أعطت `clientWidth=390` لكن layout/scroll بعرض `594`، فظهر جزء من صفحة المبيعات وقائمة الاقتراح خارج الحافة اليسرى. اختبار اللمس ظل قابلاً للتنفيذ ونجح، لكن يلزم إعادة تحقق على iPhone فعلي لأن اختبار viewport المكتبي المصغّر السابق لا يعيد هذه الحالة.
- Checks: `npm.cmd run check` ناجح (`Project check passed`)؛ `git diff --check` نظيف قبل إضافة هذا السجل؛ والفرع كان مطابقاً لـ`origin/feat/invoice-module`.
- Boundaries: لم تُشغّل مزامنة فعلية، ولم تُلمس أسعار أو مخزون، ولم يحدث commit/push/merge. التغيير الوحيد هو سجل المراجعة الحالي غير المثبّت في `AI_HANDOFF.md` حسب طلب المستخدم.
- Handoff UTC: 2026-07-23T20:42:27Z

## 2026-07-23 - Codex - مراجعة سلامة حفظ تحسين اقتراحات فاتورة المبيعات

- Status: reviewed and verified — عملية الحفظ سليمة ولا توجد ملاحظة مانعة؛ لا commit أو push أو merge من Codex.
- Branch/worktree: `feat/invoice-module` في `.claude/worktrees/agent-aba8cb3159c146563`
- commit reviewed: `564dcc4` «حفظ تحسين تموضع اقتراحات فاتورة المبيعات على iPhone»
- نطاق الحفظ:
  1. `git show 564dcc4 --stat` و`diff-tree` أكدا أن الـcommit يغيّر ملفين فقط: `src/app.js` و`AI_HANDOFF.md`.
  2. فرق `src/app.js` عبارة عن hunk واحد داخل `positionSalesSuggest` من بدايتها حتى قبل `salesPickItem`; لا سطر مضافاً أو محذوفاً في `salesPickItem` أو التسعير أو المجاميع.
  3. فرق `AI_HANDOFF.md` يضيف سجلّي التسليم السابقين فقط: مراجعة نواة الفاتورة، واعتماد تموضع اقتراحات iPhone.
- مطابقة Git بعد `git fetch origin --prune`: `HEAD` و`origin/feat/invoice-module` متطابقان تماماً عند `564dcc42c1a1ffb2d4ebb1cb6b07d52825581f26`، والتباعد `0/0`. قبل إضافة سجل المراجعة الحالي كان `git status -sb` نظيفاً ويعرض `feat/invoice-module...origin/feat/invoice-module`. بقي `origin/main` عند `695b69d`، وهو Merge PR #17.
- إعادة برهان متصفح معزول 390×844:
  1. الحافة اليمنى RTL: عرض 240px وحدود `left=142`, `right=382`.
  2. الحافة اليسرى: `left=8`, `right=248`.
  3. الحقل قرب الأسفل (`top=780`): انقلبت القائمة فوقه إلى `top=458`, `bottom=738`.
  الحالات الثلاث بقيت ضمن viewport أفقياً وعمودياً؛ الاختبار لم يفتح بيانات أو خدمات الإنتاج.
- Checks: `npm.cmd run check` ناجح (`Project check passed`)؛ `git diff --check` نظيف؛ وفحص patch الـcommit نفسه `git diff --check 564dcc4^ 564dcc4` نظيف.
- Boundaries: لم تُشغّل مزامنة فعلية، ولم تُلمس أسعار، ولم يحدث commit/push/merge. التغيير الوحيد بعد الفحوص هو سجل المراجعة الحالي غير المثبّت في `AI_HANDOFF.md` حسب طلب المستخدم.
- Handoff UTC: 2026-07-23T20:04:27Z

## 2026-07-23 - Codex - اعتماد تموضع اقتراحات فاتورة المبيعات على iPhone

- Status: reviewed and verified — تعديل `positionSalesSuggest` يحقق حدود العرض والتموضع والانقلاب العمودي المطلوبة.
- Branch/worktree: `feat/invoice-module` في `.claude/worktrees/agent-aba8cb3159c146563`؛ لا commit أو push أو merge.
- اختبار متصفح فعلي مع viewport بعرض 390 وارتفاع 844:
  1. الحالة الفعلية RTL: عرض القائمة 240px داخل عرض الشاشة، وحدودها `left=142` و`right=382` مع هامش 8px؛ لا تجاوز يميناً أو يساراً.
  2. اختبار الحافة اليسرى: ثُبّتت القائمة عند `left=8` وانتهت عند `right=248`؛ بقيت ضمن الحافتين.
  3. اختبار ضيق المساحة تحت الحقل: عند وضع الحقل قرب الأسفل (`top=780`) انقلبت القائمة فوقه (`top=458`, `bottom=739`) وبقيت كاملة ضمن viewport.
  4. فرق `src/app.js` غير المثبّت محصور بدالة `positionSalesSuggest`; لم يتغير `salesPickItem` ولا منطق التسعير أو المجاميع. اختبار التدفق اختار `item-1` بسعر 120 وكمية 2 وأظهر الإجمالي `$240.00` مع السطر الفارغ اللاحق كما كان.
- الفحوص: `npm.cmd run check` ناجح (`Project check passed`) و`git diff --check` ناجح.
- Handoff UTC: 2026-07-23T18:39:46Z

## 2026-07-23 - Codex - مراجعة مزامنة رقم الصنف ونواة وحدة الفاتورة

- Status: reviewed — الفحوص الآلية ناجحة، مع نواقص ومخاطر يجب إصلاحها قبل الدمج أو الاعتماد.
- Branch: `feat/invoice-module` عند `a055aee` (لم يُدمج، ولا commit/push من Codex).
- ما أنجزه Claude:
  1. أضاف العمود `approved_price_items.item_number` وسكربت `tools/pull-item-numbers.ps1` للقراءة من `mt000.Number` وتحديث هذا العمود وحده، مع `-WhatIf` وfallback إلى `192.168.1.200,1433`.
  2. بنى نواة route مستقلة باسم `sales`: جملة/دولار ومفرق/سوري، كرتونة/كروز، بحث بالرقم أو الاسم، سعر تلقائي قابل للتعديل، حسم ومدفوع ومتبقٍّ، حفظ في `shared_documents`، وطباعة.
- تحقق رقم الصنف الحي (قراءة فقط، 2026-07-23): `314/316` صفاً لها رقم صحيح مطابق للأمين، و`2/316` فقط بلا رقم، وصفر أرقام خاطئة. رقم `231/316` ثم «85 غير مطابق» كان مرحلة أقدم؛ عولج 83 منها وبقي الصنفان المعروفان. السكربت اجتاز PowerShell parser وتشغيل `-WhatIf` لم يكتب بيانات.
- ملاحظات السكربت:
  1. سطر ملخص `-WhatIf` يحسب خطأً «سيُحدَّث: 83» رغم أن التغييرات الفعلية صفر؛ المقارنة هناك لا تطبّع `item_key`.
  2. يوجد تصادم تطبيع فعلي في الأمين: «غلواز كوين اصفر اس سبعة» بالرقمين 273 و274 (اختلاف نقطة فقط). الخريطة الحالية تستبدل أحدهما بالآخر بلا كشف وبلا `ORDER BY`، وقد تقلب الرقم في تشغيل لاحق؛ يجب كشف التصادمات وتخطيها أو حسمها صراحة.
- نتيجة مراجعة الفرع:
  1. `npm.cmd run check` ناجح، و`git diff --check origin/main...HEAD` ناجح.
  2. حسابات الاختبار مستقلة وصحيحة: جملة كرتونة 120$، جملة كروز 12$ عند factor=10؛ مفرق كرتونة 201000 ل.س، ومفرق كروز 20100 ل.س عند retail=15$ وصرف 13400. تحويل الأرقام العربية/الفارسية إلى الإنجليزية نجح.
  3. route `invoice` الحالي بقي قابلاً للرسم والطباعة، ومسار طباعة `sales` ولّد الصنف والمجاميع بنجاح في اختبار متصفح معزول. لا يوجد تغيير في سكربتات المزامنة أو منطق الأسعار المخزنة.
  4. نطاق commit ليس محصوراً بـ`src/app.js` و`public/service-worker.js`: عدّل أيضاً `index.html` و`src/styles.css` و`src/number-normalizer.js` و`src/supabase-client.js` (6 ملفات إجمالاً). رفع `CACHE_NAME` صحيح من v353 إلى v354 ونسخة الأصول إلى tobacco-99.
- العوائق قبل الدمج:
  1. على عرض iPhone (390px) قائمة اقتراح الصنف تمتد من x=226 إلى x=466 خارج الشاشة، فلا يمكن ضغط النتيجة؛ هذا يعطل الإدخال الأساسي على الجهاز المستهدف.
  2. مسار استبدال لائحة الأسعار يفضّل `replaceApprovedPriceItems`، وهو يحذف الصفوف كلها ثم يعيد إدخال payload لا يحمل `item_number`؛ أول استخدام لاحق لهذا المسار قد يمسح الأرقام الـ314. يجب حفظ العمود أو إعادة ربطه ذرّياً قبل تشغيل الاستبدال.
  3. بعد اختيار الصنف لا ينتقل التركيز إلى الكمية (يبقى على `BODY`)، ولا توجد اختصارات Enter/Tab/Space المطلوبة؛ البحث الجزئي موجود لكن اختصارات أوائل الكلمات غير منفذة.
  4. رقم الفاتورة عشوائي `SAL-YYMM-NNNN` وليس تسلسلياً، ويمكن حفظ المستند نفسه أكثر من مرة بلا منع أو قيد uniqueness.
  5. الرابط المباشر `?route=sales` يرجع إلى `overview` لأن `sales` غير مضاف إلى `allowedRoutes`.
  6. المتبقّي السالب يظهر رقماً فقط (مثلاً `-99,000`) بلا حالة «له»، وبقية المتطلبات المؤجلة ما زالت غير منفذة: معلومات الصنف والمستودعات والتكلفة/الربح، الأدوار، المرتجعات، آخر سعر للزبون، الرصيد الحي وحد الائتمان، وخصم المخزون/تقييد الذمم.
  7. الفرع مبني على `17e6ac1` ومتأخر عن `origin/main` بكوميت توليد أسعار واحد؛ عند التحديث لاحقاً يجب الحفاظ على ملفات التوليد الأحدث وحل نسخة الكاش من دون دمج الآن.
- الخطوات القادمة: إصلاح عداد `-WhatIf` وتصادم 273/274، إغلاق القائمة القديمة التي كانت 85 بمعالجة الصنفين المتبقيين، إصلاح عوائق iPhone/التركيز/الاختصارات والتسلسل ومنع التكرار، ثم إكمال متطلبات الفاتورة 1–23 بالتدرج والتشغيل الموازي مع الأمين والمقارنة اليومية قبل أي اعتماد.
- Handoff UTC: 2026-07-23T17:54:51Z

## 2026-07-23 - Codex - مراجعة ثانية لتحصين تصادم 273/274

- Status: reviewed — التحصينان صحيحان، ولا توجد ملاحظة مانعة أو خطأ جديد؛ لا merge
- Branch: `claude/sales-invoice-normalization-issue-30bbb3` (worktree: `.claude/worktrees/sales-invoice-normalization-issue-30bbb3`)
- Scope reviewed: آخر تحصين في `tools/pull-item-numbers.ps1`، وسطر التحذير وما يلزمه من أسماء داخل `Sync-PriceListStockOnFullUnitChange` في `tools/ameen-sync-agent.ps1`
- النتيجة:
  1. مرشحو التصادم أصبحوا كائنات `num/name`، وتُبنى `candidateNums` من كل الأرقام الفعلية. لا يُطبّق override إلا مع `$candidateNums -contains $override`. اختبار كتلة الكود نفسها أكد: المرشحان 273/274 يبقيان الحسم 273؛ وإذا صارت المرشحات 274/275 يُرفض الحسم القديم ويُحذف المفتاح؛ والتصادم بلا override يُرفض أيضاً.
  2. تشغيل `tools\pull-item-numbers.ps1 -WhatIf` بقي قرائياً وأكد البيانات الحالية: التصادم الوحيد 273/274 محسوم إلى 273، مطابق بالاسم 314/316، والتحديثات المطلوبة 0.
  3. تحذير التصادم الجديد في `Sync-PriceListStockOnFullUnitChange` يضيف `Names` إلى بنية التجميع الداخلية ويستدعي `Write-AgentLog` فقط؛ لا يغيّر `Qty` أو `Rep` أو شروط المقارنة أو عنوان PATCH أو payload. محاكاة معزولة أكدت: تصادم جديد = تحذير واحد ونفس PATCH بقيمة التجميع 7؛ التصادم المعروف 273/274 = صفر تحذيرات ونفس PATCH بقيمة 136؛ وحقل `Names` لا يتسرّب إلى payload.
- Checks: PowerShell parser للملفين = 0 أخطاء؛ `npm.cmd run check` ناجح؛ `git diff --check` نظيف.
- Boundaries: لم تُشغّل مزامنة فعلية، ولم يُكتب إلى الأمين أو Supabase، ولم يتغير أي سعر، ولم يحدث commit/push/merge.
- Handoff UTC: 2026-07-23T19:13:06Z

## 2026-07-23 - Claude - تحصين حسب ملاحظتَي مراجعة Codex (تصادم 273/274)

- Status: completed — بانتظار مراجعة Codex ثانية ثم قرار الدمج من المستخدم
- Branch: `claude/sales-invoice-normalization-issue-30bbb3`؛ لا merge
- Files: tools/pull-item-numbers.ps1، tools/ameen-sync-agent.ps1 (نفس الدالة فقط)
- طبّقت ملاحظتَي التحصين اللتين رفعهما Codex بمراجعته (غير مانعتين لكن رخيصتان):
  1. **pull-item-numbers.ps1:** `$collisionOverrides` الآن يتحقق أن الرقم المحسوم (273) لا يزال أحد بطاقات التصادم الفعلية قبل اعتماده؛ إن لم يعد كذلك (تغيّرت بطاقات الأمين لاحقاً) يُستبعد المفتاح من التحديث مع تحذير مطبوع صريح بدل تطبيق حسم قديم أعمى.
  2. **ameen-sync-agent.ps1:** أي تصادم تطبيع مستقبلي غير 273/274 المعروف يُسجَّل الآن بتحذير بالسجل (`Write-AgentLog`) قبل تجميعه — لا يُرفض (فقد يكون سطراً حياً بمخزون فعلي يستحق النشر)، لكنه يصير مرئياً للمراجعة بدل أن يُدمج بصمت.
- الفحوص: PSParser صفر أخطاء للملفين؛ تشغيل حي `pull-item-numbers.ps1 -WhatIf`: نفس النتيجة السابقة (314/316 مطابق، 0 تحديثات، الحسم 273 مؤكد)؛ `npm.cmd run check` ناجح؛ `git diff --check` نظيف.
- Handoff UTC: 2026-07-23T19:20:00Z

## 2026-07-23 - Codex - مراجعة إصلاح تصادم 273/274 وتذبذب مخزون النشرة

- Status: reviewed — الإصلاح صحيح وآمن على البيانات الحالية، مع ملاحظتي تحصين مستقبليتين أدناه؛ لا merge
- Branch: `claude/sales-invoice-normalization-issue-30bbb3` (worktree: `.claude/worktrees/sales-invoice-normalization-issue-30bbb3`)
- Scope reviewed: `tools/pull-item-numbers.ps1` و`Sync-PriceListStockOnFullUnitChange` في `tools/ameen-sync-agent.ps1`
- نتيجة المراجعة:
  1. فحص قرائي مستقل من `mt000` وحركات `bi000`/`bu000`/`bt000` أكد أن 273 «غلواز كوين اصفر اس سبعة.» هي الحية: مخزون المزامنة 136، حركة واحدة وآخرها 2026-07-01؛ و274 بلا مخزون وبلا أي حركة. الوحدات متطابقة: كروز/كرتونة ومعامل 50. لذلك الحسم إلى 273 صحيح.
  2. `pull-item-numbers.ps1` صار يجمع أرقام المفتاح المطبّع، يحسم التصادم المعروف إلى 273، ويستبعد أي تصادم آخر غير محسوم بدلاً من رقم عشوائي. الـPATCH الوحيد الممكن يحتوي `item_number` فقط، فلا يمس سعراً أو مخزوناً. عدّاد `-WhatIf` يحصي الفرق الفعلي بعد تطبيع `item_key`.
  3. تشغيل `tools\pull-item-numbers.ps1 -WhatIf` كان قرائياً ونتيجته: 399 مفتاح أمين بعد التطبيع، التصادم الوحيد 273/274 محسوم إلى 273، **مطابق بالاسم 314 من 316**، وسيُحدَّث 0.
  4. دالة مزامنة مخزون النشرة تجمع داخل المفتاح المطبّع نفسه فقط، وتفحص `ContainsKey` قبل الوصول إلى صفوف النشرة، لذلك لا ترسل PATCH بمفتاح فارغ ولا تكتب إلى صنف باسم مختلف. للبيانات الحالية المجموعة الوحيدة المتصادمة هي 273+274؛ مجموعها 136 وممثلها 273، وبقية الأصناف المفردة تحافظ على السلوك السابق. الحمولة لا تحتوي أي حقل سعر أو `item_number`.
  5. محاكاة معزولة بلا شبكة: التشغيلة الأولى أرسلت تحديثين لسطرَي alias فقط بقيمة 136، والثانية صفر تحديثات؛ لم يظهر أي تحديث لصنف غير منشور أو مفتاح آخر.
- ملاحظات المخاطر:
  1. `$collisionOverrides` يفرض 273 إذا وُجد المفتاح، لكنه لا يتحقق أن 273 ما زال واحداً من مرشحي التصادم. لا يؤثر الآن، لكن الأفضل قبل الاعتماد الطويل إضافة تحقق عضوية الرقم كي لا يصبح الحسم قديماً إذا تغيرت بطاقات الأمين.
  2. مزامنة المخزون تجمع تلقائياً أي تصادم تطبيع مستقبلي، بخلاف سكربت الأرقام الذي يرفض غير المحسوم. لا أثر حالي لأن الفحص وجد تصادماً واحداً فقط ووحدتاه متطابقتان وإحداهما فارغة؛ لكن إذا ظهر لاحقاً تصادم لصنفين حيين مختلفين أو معاملي وحدة مختلفين فقد تُجمع كمياتهما تحت مفتاح واحد وتُؤخذ وحدة/حالة ممثل واحد. يوصى بتسجيل تحذير ورفض التصادم غير المعروف أو اعتماد allowlist صريحة.
  3. يوجد تغيير تنسيق نهاية سطر واحد خارج الدالة عند `customerAccountGuid`، بلا تغيير دلالي.
- Checks: PowerShell parser للملفين = 0 أخطاء؛ `npm.cmd run check` ناجح؛ `git diff --check` نظيف.
- Boundaries: لم تُشغّل مزامنة الإنتاج، ولم يُكتب إلى الأمين أو Supabase، ولم يتغير أي سعر، ولم يحدث commit/push/merge.
- Handoff UTC: 2026-07-23T19:06:15Z

## 2026-07-23 - Claude - حسم تصادم تطبيع 273/274 وإيقاف تذبذب مخزون النشرة

- Status: completed — بانتظار مراجعة Codex ثم قرار الدمج من المستخدم
- Branch: `claude/sales-invoice-normalization-issue-30bbb3` (worktree: `.claude/worktrees/sales-invoice-normalization-issue-30bbb3`)؛ لا merge
- Files: tools/pull-item-numbers.ps1 (نسخة من ملف main غير المثبّت + إصلاحان)، tools/ameen-sync-agent.ps1 (دالة Sync-PriceListStockOnFullUnitChange فقط)
- التشخيص (قراءة فقط من الأمين وSupabase):
  1. بالأمين بطاقتان: **273** «غلواز كوين اصفر اس سبعة**.**» (بنقطة آخر الاسم — الحية: مخزون 136 وحركة فواتير آخرها 07/01/2026) و**274** «غلواز كوين اصفر اس سبعة» (فارغة تماماً: صفر مخزون وصفر حركة منذ الإنشاء). فحص شامل لكل mt000: هذا هو التصادم الوحيد.
  2. اكتشاف أخطر أثناء التشخيص: حلقة مزامنة مخزون النشرة تمرّ على البطاقتين المتصادمتين فتكتبان بالتناوب 136 ثم 0 على سطرَي النشرة (سبعة/سبعه) — **تذبذب مُشاهد حياً**: 18:52 UTC صفر/«نافد» ثم 18:53 عاد 136/«low»، والسجل يظهر `BoundaryChanges=17` بكل تشغيلة (200/200 من آخر التشغيلات): منها كتابتا التذبذب و~15 PATCH وهمياً لأصناف أمين غير منشورة، لأن غياب المفتاح يعيد `@($null)` فيمرّ فحص `.Count` ويُرسل PATCH بـ`item_key=eq.` فارغ لا يطابق شيئاً.
- الإصلاحان:
  1. **pull-item-numbers.ps1:** كشف تصادمات التطبيع عند بناء خريطة الأمين؛ حسم صريح موثّق («غلواز كوين اصفر اس سبعه» → 273)؛ أي تصادم مستقبلي غير محسوم يُستبعد من التحديث مع تحذير مطبوع بكل بطاقاته؛ `order by Number` للثبات؛ إصلاح عدّاد `-WhatIf` (كان يقارن بلا تطبيع فيطبع «83» وهمياً — الآن يعدّ التغييرات الفعلية).
  2. **ameen-sync-agent.ps1:** تجميع أصناف التقرير حسب المفتاح المطبّع قبل مقارنة النشرة (جمع كميات البطاقات المتصادمة؛ الممثل = الأكبر مخزوناً لوحداته وحالته)، وشرط `ContainsKey` يوقف الكتابات الوهمية. بعد الدمج ستتغير أرقام السجل طبيعياً (Matched≈316 بدل 464، وBoundaryChanges تقارب صفراً عند الاستقرار).
- الفحوص: PSParser على PowerShell 5.1 صفر أخطاء للملفين؛ محاكاة معزولة بلا شبكة (صفر كتابات عند التطابق، كتابتا تصحيح ثم استقرار تام بالتشغيلة التالية، لا كتابات وهمية)؛ تشغيل حي `pull-item-numbers.ps1 -WhatIf` من الـworktree: «تصادم محسوم صراحة → 273»، «مطابق بالاسم: 314 من 316»، «سيُحدَّث: 0»؛ `npm.cmd run check` ناجح؛ `git diff --check` نظيف. لا رفع CACHE_NAME (لا تعديل على ملفات الموقع المنشورة).
- ملاحظات:
  1. **الجذر بطاقة 274 المكررة في الأمين** — التوصية: حذفها أو إعادة تسميتها باسم مميز من برنامج الأمين (فارغة تماماً فالإجراء آمن). بعدها يختفي التصادم نهائياً ويبقى الإصلاحان حمايةً من أي تكرار مستقبلي.
  2. الإنتاج لم يُلمس: المهمة المجدولة تشغّل نسخة main، **فالتذبذب مستمر كل دقيقة حتى دمج هذا الفرع أو تنظيف الأمين**. نسخة tools/pull-item-numbers.ps1 غير المثبّتة على main بقيت كما هي — عند الدمج تُعتمد نسخة هذا الفرع (الملف نفسه + الإصلاحان).
  3. لم أمسّ التعديلين غير المثبّتين (src/supabase-client.js على main، واقتراحات iPhone على `feat/invoice-module`) حسب الاتفاق.
- Handoff UTC: 2026-07-23T19:05:00Z

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
