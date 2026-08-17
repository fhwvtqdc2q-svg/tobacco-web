# OZK Business OS — Foundation v1

هذا الملف يعرّف عقد المرحلة الأولى من نظام التشغيل التجاري داخل مشروع `tobacco-web`.

## المبدأ

`window.ozkBusinessOS.getSnapshot()` هو المدخل الموحد لقراءة حالة العمل. لا يجوز لأي طبقة AI مستقبلية أن تجمع أرقامها مباشرة من واجهات متفرقة إذا كانت المعلومة متوفرة في الـSnapshot.

## قواعد الثقة

- الأمين هو المصدر المحاسبي الموثوق.
- Supabase هو طبقة التشغيل المتزامنة للويب.
- لا يتم اختراع قيمة عند غياب المصدر؛ تبقى `null` أو `missing`.
- لا تجمع مبالغ بعملات مختلفة؛ التجميع المالي يكون حسب العملة.
- لا تجمع كميات مخزون مختلفة الوحدات في رقم مالي/كمي واحد مضلل.
- كل قسم يحمل `meta.source`, `meta.asOf`, `meta.completeness`, و`meta.freshness`.
- الذكاء الاصطناعي يفسر ويرتب الأولويات، لكنه لا يستبدل قواعد الحساب والمصادر الموثوقة.

## أقسام Snapshot v1

- `sales`
- `receivables`
- `collections`
- `inventory`
- `purchasing`
- `supplierObligations`
- `expenses`
- `requests`
- `syncHealth`
- `alerts`
- `dataQuality`

## النواقص المقصودة في v1

`collections.todayTotal` و`expenses.totalsByCurrency` لا يتم تعبئتهما بتخمين. يلزم إضافة مصدر مجمّع موثوق ومصادق عليه لهما في مرحلة تالية.

كذلك لا يعرض `sales.todayTotal` قيمة إلا إذا وجد حقل إجمالي واضح في تقرير الحركة اليومية. غياب حقل موثوق يؤدي إلى `null` مع ملاحظة في `meta.note`.

## المرحلة التالية

بعد تثبيت العقد والتحقق منه على البيانات الحقيقية:

1. إضافة مصادر التحصيل والمصاريف المجمعة.
2. توصيل `decision-engine` إلى Snapshot بدل قراءة `state` المتفرقة تدريجياً.
3. إضافة Metrics Engine فوق Snapshot.
4. بناء Command Center والـAI Team فوق نفس المصدر الموحد.
