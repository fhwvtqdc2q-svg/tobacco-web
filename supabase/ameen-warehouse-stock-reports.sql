-- مرجعي فقط — لا يُطبَّق تلقائياً على Supabase الحي. راجع تعليمات التطبيق أسفل الملف.
--
-- جدول مستقل مخصص لتقارير مخزون المستودعات من الأمين (يكتبه
-- tools/push-ameen-warehouse-stock.ps1، تقرير مستقل لكل مستودع حقيقي).
-- يستبدل الاعتماد على inventory_reports لهذا المصدر تحديداً — مراجعة Codex
-- على PR #40 (الجولة الثانية): source='ameen_warehouse_stock' وحده لا يمنع
-- أي موظف مسجَّل يملك صلاحية INSERT على inventory_reports (نفس الجدول
-- المشترك مع تقارير أخرى كثيرة) من إدراج صف بنفس المصدر وcreated_by مصطنع
-- ينتحل به هوية حساب المزامنة. نفس نمط الحل المستخدم سابقاً لمشكلة مشابهة
-- في ameen-purchase-invoice-reports.sql: جدول مستقل بسياسة INSERT محصورة
-- بحساب المزامنة الموثوق فقط، لا اعتماد على قيمة source وحدها.
--
-- خلافاً لتقرير فواتير المشتريات، هذا التقرير يُقرأ من كل موظف مسجَّل
-- (يُستخدم لاختيار المستودع الفعلي وعرض أصنافه عند الجرد الفعلي) — لذلك
-- سياسة SELECT هنا مفتوحة لكل authenticated، والحصر فقط على INSERT.
--
-- هذا الملف مستقل بالكامل (self-contained) عمداً: لا يعتمد على أي ملف SQL
-- آخر في هذا المستودع ولا على أي دالة معرَّفة خارجه.

create table if not exists ameen_warehouse_stock_reports (
  id uuid default gen_random_uuid() primary key,
  report_date date not null default current_date,
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table ameen_warehouse_stock_reports is 'تقرير مخزون مستودع حقيقي واحد بالأمين (dbo.st000) — تقرير مستقل لكل مستودع، كتابة فقط لحساب المزامنة الموثوق، قراءة لكل موظف مسجَّل. لا علاقة بجدول inventory_reports العام.';
comment on column ameen_warehouse_stock_reports.summary is 'ملخص التقرير: warehouseKey (GUID المستودع بالأمين)، warehouseName، item_count، generated_at.';
comment on column ameen_warehouse_stock_reports.items is 'مصفوفة أصناف المستودع: {itemKey, itemGuid, itemNumber, itemName, unitName, qty}.';
comment on column ameen_warehouse_stock_reports.created_by is 'يُختم تلقائياً بـauth.uid() الخاص بالجلسة الكاتبة عند الإدراج، وتتحقق سياسة INSERT أن هذه القيمة تطابق auth.uid() فعلاً وأن الكاتب هو حساب المزامنة الموثوق — يمنع NULL وانتحال هوية أي حساب آخر.';

create index if not exists ameen_warehouse_stock_reports_created_at_idx
  on ameen_warehouse_stock_reports (created_at desc);

alter table ameen_warehouse_stock_reports enable row level security;

-- لا صلاحية افتراضية لأي دور — كل وصول يمر عبر سياسات صريحة أدناه فقط.
revoke all on ameen_warehouse_stock_reports from anon;
revoke all on ameen_warehouse_stock_reports from authenticated;
grant select, insert on ameen_warehouse_stock_reports to authenticated;

-- القراءة: كل موظف مسجَّل — نفس سلوك inventory_reports السابق لهذا المصدر،
-- يستخدمها التطبيق لعرض قائمة المستودعات الفعلية وأصنافها عند الجرد.
drop policy if exists "authenticated can select ameen_warehouse_stock_reports" on ameen_warehouse_stock_reports;
create policy "authenticated can select ameen_warehouse_stock_reports"
  on ameen_warehouse_stock_reports for select
  to authenticated
  using (true);

-- الكتابة (رفع من الأمين): تقتصر على حساب المزامنة الموثوق فقط — نفس
-- الحساب المستعمل في TOBACCO_SYNC_EMAIL/TOBACCO_SYNC_PASSWORD داخل
-- tools/push-ameen-warehouse-stock.ps1 (السكربت يسجّل دخول Supabase Auth
-- عادياً بهذا الحساب، وليس بمفتاح service-role يتجاوز RLS، فهذه السياسة ضرورية).
--
-- ⚠️ قبل تطبيق هذا الملف فعلياً: استبدل البريد أدناه ببريد حساب المزامنة
-- الحقيقي (القيمة الحالية لمتغير بيئة TOBACCO_SYNC_EMAIL على جهاز LOQ —
-- لا تُقرأ أو تُحفظ في المستودع أبداً). القيمة الحالية 'REPLACE_WITH_SYNC_ACCOUNT_EMAIL'
-- عمداً غير صالحة كي لا تعمل أي سياسة بالخطأ قبل تعديلها يدوياً. يجب أن يطابق
-- نفس البريد المستخدَم في inventory-reconciliation-table.sql لهذا المتغير.
create or replace function ameen_warehouse_stock_reports_is_sync_writer()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'REPLACE_WITH_SYNC_ACCOUNT_EMAIL';
$$;

comment on function ameen_warehouse_stock_reports_is_sync_writer() is 'يطابق TOBACCO_SYNC_EMAIL المستعمل في tools/push-ameen-warehouse-stock.ps1 — يجب استبدال البريد الثابت داخل الدالة قبل تطبيق هذا الملف.';

-- سياسة INSERT تشترط معاً: (1) المستعمل هو حساب المزامنة الموثوق، و(2)
-- created_by المُرسَل يطابق auth.uid() فعلياً — يمنع إدراج صف بـcreated_by
-- فارغ أو منتحِل لهوية مستخدم آخر حتى لو كان الطالب هو حساب المزامنة نفسه.
drop policy if exists "sync writer can insert ameen_warehouse_stock_reports" on ameen_warehouse_stock_reports;
create policy "sync writer can insert ameen_warehouse_stock_reports"
  on ameen_warehouse_stock_reports for insert
  to authenticated
  with check (
    ameen_warehouse_stock_reports_is_sync_writer()
    and created_by = auth.uid()
  );

-- لا سياسة UPDATE/DELETE: السكربت الحالي يُدرج تقريراً جديداً لكل تشغيل فقط
-- (لا تعديل ولا حذف لصفوف سابقة) — القراءة تعتمد أحدث صف بـorder by created_at.

-- ---------- تعليمات التطبيق (لا تُنفَّذ هنا) ----------
-- 1. استبدل 'REPLACE_WITH_SYNC_ACCOUNT_EMAIL' أعلاه بالبريد الحقيقي لحساب
--    TOBACCO_SYNC_EMAIL يدوياً قبل التطبيق (ونفس البريد داخل
--    inventory_recon_warehouse_stock_report_is_trusted في
--    inventory-reconciliation-table.sql إن أُبقيت كطبقة دفاع إضافية).
-- 2. طبّق هذا الملف عبر Supabase SQL editor أو psql — لم يُطبَّق تلقائياً بهذه الجلسة.
--    لا يتطلب أي ملف SQL آخر كشرط مسبق (self-contained).
-- 3. بعد التطبيق: يجب تحديث tools/push-ameen-warehouse-stock.ps1 ليكتب على
--    هذا الجدول بدل inventory_reports (تم تحديثه بالفعل بهذا التغيير)، وتفريغ
--    أي صفوف قديمة بمصدر ameen_warehouse_stock من inventory_reports يدوياً إن رغبت
--    (اختياري — لا تُقرأ بعد الآن من هذا المصدر بعد تطبيق هذا الملف والتغييرات المرتبطة).
