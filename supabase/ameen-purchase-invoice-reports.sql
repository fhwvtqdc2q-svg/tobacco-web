-- مرجعي فقط — لا يُطبَّق تلقائياً على Supabase الحي. راجع تعليمات التطبيق أسفل الملف.
--
-- جدول مستقل مخصص لتقرير فواتير مشتريات الأمين (يكتبه
-- tools/pull-purchase-invoices-from-ameen.ps1 بعد فك القفل والموافقة الصريحة).
-- يستبدل الاعتماد على inventory_reports لهذا التقرير تحديداً لأن ذلك الجدول
-- مقروء لكل موظف مسجّل (authenticated) بلا تمييز، بينما هذا التقرير يحوي أسماء
-- موردين وأسعاراً وتكاليف وإجماليات ودفعات — بيانات حساسة يجب حصرها بالمالك/
-- الحسابات المخوَّلة فقط. الحماية هنا على مستوى RLS وليست إخفاء واجهة فقط.
--
-- مراجعة Codex السادسة على PR #35 هي سبب إنشاء هذا الملف.

create table if not exists ameen_purchase_invoice_reports (
  id uuid default gen_random_uuid() primary key,
  report_date date not null default current_date,
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table ameen_purchase_invoice_reports is 'تقرير فواتير مشتريات الأمين الحقيقية (مورّدون/أسعار/تكاليف/إجماليات/دفعات) — قراءة فقط للمالك، كتابة فقط لحساب المزامنة الموثوق. لا علاقة بجدول purchase_invoices اليدوي (مسودة/معتمدة/مزامنة).';
comment on column ameen_purchase_invoice_reports.summary is 'ملخص التقرير: عدد الأيام، تاريخ البداية، عدد الموردين/الفواتير، أساس السعر، وقت السحب — بلا أرقام حسابات أو مفاتيح داخلية.';
comment on column ameen_purchase_invoice_reports.items is 'مصفوفة لكل مورد: {name, invoices:[{number, date, guid, total, currency, payMethod, paidAmount, isReturn, items:[{itemNumber, itemName, qty, unit, price, lineTotal, lastPrice, avgPrice, priceBasis}]}]}.';

create index if not exists ameen_purchase_invoice_reports_created_at_idx
  on ameen_purchase_invoice_reports (created_at desc);

alter table ameen_purchase_invoice_reports enable row level security;

-- لا صلاحية افتراضية لأي دور — كل وصول يمر عبر سياسات صريحة أدناه فقط.
revoke all on ameen_purchase_invoice_reports from anon;
revoke all on ameen_purchase_invoice_reports from authenticated;
grant select, insert, delete on ameen_purchase_invoice_reports to authenticated;

-- القراءة: يعيد استخدام purchase_invoices_is_owner() المعرَّفة في
-- supabase/purchase-invoices-ameen-sync.sql (يجب تطبيق ذلك الملف أولاً) —
-- تطابق OWNER_EMAILS في src/app.js، ولا تُنشئ قائمة بريد مستقلة ثانية.
drop policy if exists "owner can select ameen_purchase_invoice_reports" on ameen_purchase_invoice_reports;
create policy "owner can select ameen_purchase_invoice_reports"
  on ameen_purchase_invoice_reports for select
  to authenticated
  using (purchase_invoices_is_owner());

-- الكتابة (سحب من الأمين): تقتصر على حساب المزامنة الموثوق فقط — نفس الحساب
-- المستعمل في TOBACCO_SYNC_EMAIL/TOBACCO_SYNC_PASSWORD داخل
-- tools/pull-purchase-invoices-from-ameen.ps1 (السكربت يسجّل دخول Supabase Auth
-- عادياً بهذا الحساب، وليس بمفتاح service-role يتجاوز RLS، فهذه السياسة ضرورية).
--
-- ⚠️ قبل تطبيق هذا الملف فعلياً: استبدل البريد أدناه ببريد حساب المزامنة
-- الحقيقي (القيمة الحالية لمتغير بيئة TOBACCO_SYNC_EMAIL على جهاز LOQ —
-- لا تُقرأ أو تُحفظ في المستودع أبداً). القيمة الحالية 'REPLACE_WITH_SYNC_ACCOUNT_EMAIL'
-- عمداً غير صالحة كي لا تعمل أي سياسة بالخطأ قبل تعديلها يدوياً.
create or replace function ameen_purchase_invoice_reports_is_sync_writer()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'REPLACE_WITH_SYNC_ACCOUNT_EMAIL';
$$;

comment on function ameen_purchase_invoice_reports_is_sync_writer() is 'يطابق TOBACCO_SYNC_EMAIL المستعمل في tools/pull-purchase-invoices-from-ameen.ps1 — يجب استبدال البريد الثابت داخل الدالة قبل تطبيق هذا الملف.';

drop policy if exists "sync writer can insert ameen_purchase_invoice_reports" on ameen_purchase_invoice_reports;
create policy "sync writer can insert ameen_purchase_invoice_reports"
  on ameen_purchase_invoice_reports for insert
  to authenticated
  with check (ameen_purchase_invoice_reports_is_sync_writer());

drop policy if exists "sync writer can delete ameen_purchase_invoice_reports" on ameen_purchase_invoice_reports;
create policy "sync writer can delete ameen_purchase_invoice_reports"
  on ameen_purchase_invoice_reports for delete
  to authenticated
  using (ameen_purchase_invoice_reports_is_sync_writer());

-- لا سياسة UPDATE: السكربت الحالي ينشئ صفاً جديداً ويحذف القديم (insert + delete)،
-- فلا حاجة لصلاحية تعديل صف موجود.

-- ---------- تعليمات التطبيق (لا تُنفَّذ هنا) ----------
-- 1. طبّق supabase/purchase-invoices-ameen-sync.sql أولاً إن لم يكن مطبَّقاً
--    (يوفر purchase_invoices_is_owner()).
-- 2. استبدل 'REPLACE_WITH_SYNC_ACCOUNT_EMAIL' أعلاه بالبريد الحقيقي لحساب
--    TOBACCO_SYNC_EMAIL يدوياً قبل التطبيق.
-- 3. طبّق هذا الملف عبر Supabase SQL editor أو psql — لم يُطبَّق تلقائياً بهذه الجلسة.
-- 4. بعد التطبيق فقط: يمكن فك قفل tools/pull-purchase-invoices-from-ameen.ps1
--    بموافقة صريحة موثّقة من ozk.kh@outlook.com.
