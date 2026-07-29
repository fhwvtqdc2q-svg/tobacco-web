-- ============================================================
-- OZK TOBACCO — تمديد فواتير المشتريات نحو مزامنة الأمين (تطوير فقط)
-- ============================================================
-- لم يُطبّق على قاعدة الإنتاج بعد — ينتظر مراجعة Codex وموافقة المالك
-- (ozk.kh@outlook.com) الصريحة قبل التشغيل في Supabase → SQL Editor.
--
-- هذا الملف يُمدِّد الجدول القائم supabase/purchase-invoices-table.sql
-- (المطبَّق فعلياً بتاريخ 2026-07-11) — لا تُعدِّل ولا تُعِد تشغيل ذلك
-- الملف؛ كل تغيير جديد هنا فقط عبر ALTER/CREATE إضافي.
--
-- قرار التصميم: الأصناف تبقى items jsonb (لا جدول فرعي purchase_invoice_items)
-- لتفادي ترحيل بيانات جدول قائم فعلياً بلا داعٍ حقيقي؛ كل عنصر jsonb يحمل الآن
-- هوية الصنف الحقيقية (item_key/item_number/item_guid) لا الاسم المكتوب فقط،
-- كي تُطابَق أسطر الفاتورة بصنف الأمين الفعلي عند المزامنة اللاحقة. الشكل المتوقع
-- لكل عنصر: { item_key, item_number, item_guid, name, unit, qty, price }.
-- ============================================================

-- ---------- تمديد purchase_invoices ----------

alter table purchase_invoices
  add column if not exists supplier_ameen_guid text,
  add column if not exists supplier_ameen_code text,
  add column if not exists currency text not null default 'USD',
  add column if not exists payment_amount numeric(15,2) not null default 0,
  add column if not exists payment_date date,
  add column if not exists payment_account text,
  add column if not exists paid_total numeric(15,2) not null default 0,
  add column if not exists remaining_total numeric(15,2) not null default 0,
  add column if not exists pay_method text not null default 'credit',
  add column if not exists idempotency_key uuid,
  add column if not exists sync_attempts int not null default 0,
  add column if not exists sync_error text,
  add column if not exists ameen_document_guid text,
  add column if not exists ameen_document_number text,
  add column if not exists synced_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists correction_count int not null default 0,
  add column if not exists correction_log jsonb not null default '[]';

comment on column purchase_invoices.supplier_ameen_guid is 'معرّف حساب المورد في الأمين — nullable إلى حين توفر تغذية موردين من الأمين (لا تحجب الواجهة حتى تتوفر)';
comment on column purchase_invoices.supplier_ameen_code is 'كود حساب المورد في الأمين — احتياط للمطابقة إن غاب الـGUID';
comment on column purchase_invoices.currency is 'عملة الفاتورة كما أُدخلت — USD أو SYP، بلا أي تحويل ضمني';
comment on column purchase_invoices.payment_amount is 'قيمة الدفعة المسجَّلة من الفاتورة عند إنشائها (قد تُحدَّث لاحقاً بدفعات إضافية خارج نطاق هذا الملف)';
comment on column purchase_invoices.payment_account is 'صندوق/حساب استقبال الدفعة — نص حر أو مفتاح من قائمة صناديق موجودة، بحسب توفرها بالواجهة';
comment on column purchase_invoices.paid_total is 'إجمالي المدفوع فعلياً حتى الآن (محسوب ومخزَّن، لا يُعاد حسابه في كل قراءة)';
comment on column purchase_invoices.remaining_total is 'المتبقي = total - paid_total، مخزَّن لتسريع القوائم وتفادي حسابه بالواجهة فقط';
comment on column purchase_invoices.pay_method is 'نقدي (cash) أو آجل (credit) — النقدي يعبّئ payment_amount بكامل total افتراضياً وقابل للتعديل';
comment on column purchase_invoices.idempotency_key is 'مفتاح UUID يُولَّد عند إنشاء المسودة على العميل — يستعمله عامل المزامنة لضمان كتابة واحدة فقط في الأمين حتى لو أُعيد تشغيله';
comment on column purchase_invoices.sync_attempts is 'عدد محاولات المزامنة مع الأمين — يُصفَّر فقط عند إنشاء الفاتورة';
comment on column purchase_invoices.sync_error is 'آخر خطأ مزامنة (نص مُهذَّب لا يحتوي أسرار اتصال) — يُقرأ فقط، يكتبه عامل المزامنة';
comment on column purchase_invoices.ameen_document_guid is 'GUID المستند المكتوب فعلياً في الأمين بعد نجاح المزامنة — يُستعمل أيضاً كتحقق idempotency إضافي';
comment on column purchase_invoices.ameen_document_number is 'رقم المستند في الأمين بعد المزامنة الناجحة (للعرض البشري فقط)';
comment on column purchase_invoices.synced_at is 'وقت تأكيد المزامنة بعد إعادة قراءة المستند من الأمين والتحقق منه (وليس وقت الإرسال فقط)';
comment on column purchase_invoices.approved_by is 'من اعتمد الفاتورة (draft → approved) — لتمييزه عمّن أنشأها';
comment on column purchase_invoices.approved_at is 'وقت الاعتماد';
comment on column purchase_invoices.correction_count is 'عدد الإجراءات التصحيحية بعد المزامنة — الفاتورة المُزامَنة لا تُعدَّل مباشرة أبداً';
comment on column purchase_invoices.correction_log is 'سجل تصحيحات jsonb: [{ actor, at, reason }] — كل تصحيح على فاتورة مُزامَنة يُضاف هنا، لا يُستبدل';

-- القيد القديم على status (من purchase-invoices-table.sql) يسمح فقط بـ
-- 'open'/'received' — يجب إسقاطه أولاً وإلا يرفض التحديثات أدناه القيم
-- الجديدة 'draft'/'approved' قبل أن تصبح مسموحة.
alter table purchase_invoices drop constraint if exists purchase_invoices_status_check;

-- ترحيل القيم القديمة open/received — أي صف قديم status='open' يصبح 'draft'
-- (لم يُشترَ/يُستلَم بعد بمعنى الحالة الجديدة)، وstatus='received' يصبح
-- 'approved' (وصلت واعتُمدت فعلياً، أقرب حالة جديدة لمعناها القديم).
update purchase_invoices set status = 'draft' where status = 'open';
update purchase_invoices set status = 'approved' where status = 'received';

-- الحالات الجديدة تحل محل open/received القديمتين. تُطبَّق كقيد جديد منفصل
-- بعد أن أصبحت كل الصفوف القديمة مُرحَّلة إلى قيم مسموحة بالقيد الجديد.
alter table purchase_invoices
  add constraint purchase_invoices_status_check
  check (status in ('draft', 'approved', 'sync_pending', 'synced', 'failed'));

-- default العمود كان 'open' (قيمة أُلغيت للتو) — يجب تبديله كي لا يفشل أي إدراج
-- مستقبلي لا يُرسل status صراحة (العميل الحالي في createPurchaseInvoice يرسله
-- دوماً 'draft'، لكن هذا دفاع مستوى قاعدة بيانات مستقل عن ذلك).
alter table purchase_invoices alter column status set default 'draft';

-- ملاحظة: PostgreSQL لا يدعم "ADD CONSTRAINT IF NOT EXISTS" — نستعمل DO block
-- يتحقق من pg_constraint قبل الإضافة كي يبقى الملف قابلاً لإعادة التشغيل بأمان.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_currency_check') then
    alter table purchase_invoices
      add constraint purchase_invoices_currency_check
      check (currency in ('USD', 'SYP'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_pay_method_check') then
    alter table purchase_invoices
      add constraint purchase_invoices_pay_method_check
      check (pay_method in ('cash', 'credit'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_invoices_idempotency_key_unique') then
    alter table purchase_invoices
      add constraint purchase_invoices_idempotency_key_unique
      unique (idempotency_key);
  end if;
end $$;

-- ---------- قفل انتقال الحالة: تقدّم للأمام فقط، ولا خروج من synced ----------
-- منطق الرتب مطابق لـpoCalc.poCanTransitionStatus في src/purchase-invoice-calc.js:
-- draft(0) → approved(1) → sync_pending/failed(2, ممر إعادة محاولة بالاتجاهين) → synced(3).
-- هذا trigger هو التطبيق الفعلي على قاعدة البيانات؛ فحص الواجهة في app.js دفاع إضافي فقط.
create or replace function purchase_invoice_guard_status_transition()
returns trigger
language plpgsql
as $$
declare
  rank_map jsonb := '{"draft":0,"approved":1,"sync_pending":2,"failed":2,"synced":3}'::jsonb;
  from_rank int;
  to_rank int;
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status = 'synced' then
    raise exception 'لا يمكن تغيير حالة فاتورة مُزامَنة عبر تحديث عادي — استعمل إجراء التصحيح المخصص';
  end if;
  if new.status = 'draft' then
    raise exception 'لا يمكن إعادة فاتورة إلى مسودة بعد اعتمادها';
  end if;
  from_rank := (rank_map ->> old.status)::int;
  to_rank := (rank_map ->> new.status)::int;
  if from_rank = 2 and to_rank = 2 then
    return new; -- sync_pending ↔ failed مسموح بالاتجاهين (إعادة محاولة)
  end if;
  if to_rank <> from_rank + 1 then
    raise exception 'انتقال حالة غير مسموح: % → %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_invoice_status_guard on purchase_invoices;
create trigger trg_purchase_invoice_status_guard
  before update on purchase_invoices
  for each row
  when (new.status is distinct from old.status)
  execute function purchase_invoice_guard_status_transition();

comment on function purchase_invoice_guard_status_transition() is 'يمنع تحديث status عادي من كسر التسلسل draft→approved→sync_pending↔failed→synced، ويمنع أي خروج من synced';

-- ---------- منع الاستيلاء على مسودة + ختم اعتماد من طرف الخادم ----------
-- created_by ثابت على كل تحديث (لا يتعلق بتغيّر status فقط، لذا trigger منفصل
-- بلا شرط WHEN) كي لا يستطيع أي مستخدم "الاستيلاء" على مسودة غيره بتغيير من
-- أنشأها. كما يختم approved_by/approved_at من الخادم (auth.uid()/now()) عند
-- انتقال draft→approved فعلي، بدل الاعتماد على القيمة المُرسَلة من العميل —
-- هذا مصدر الحقيقة الوحيد لهذين الحقلين الآن (تجاوز أي قيمة يرسلها العميل).
create or replace function purchase_invoice_guard_immutable_and_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'لا يمكن تغيير created_by — يمنع الاستيلاء على مسودة فاتورة غير مملوكة';
  end if;
  if old.status = 'draft' and new.status = 'approved' then
    -- الختم الوحيد المسموح لهذين الحقلين: فور انتقال draft→approved فعلي.
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    -- خارج تلك اللحظة، الحقلان مقفلان تماماً — لا اعتماد ثانٍ يُعدِّلهما ولا أي
    -- تحديث آخر (بما فيها تحديثات service-role لحقول المزامنة، التي لا تلمس
    -- هذين الحقلين أصلاً فلا يمنعها هذا الشرط عملياً).
    raise exception 'approved_by/approved_at لا يمكن تعديلهما إلا عند انتقال draft→approved نفسه';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchase_invoice_immutable_and_stamp on purchase_invoices;
create trigger trg_purchase_invoice_immutable_and_stamp
  before update on purchase_invoices
  for each row
  execute function purchase_invoice_guard_immutable_and_stamp();

comment on function purchase_invoice_guard_immutable_and_stamp() is 'يمنع تغيير created_by على أي تحديث، ويختم approved_by/approved_at من الخادم عند draft→approved فقط ثم يقفلهما نهائياً — مصدر الحقيقة الوحيد لهذين الحقلين';

-- ---------- RLS حقيقية: تفصل المُنشئ عن المُعتمِد عن عامل المزامنة ----------
-- تستبدل هذه السياسات policies الأربع العامة في purchase-invoices-table.sql
-- (سطر 32-47 هناك، authenticated بلا أي تفريق أدوار) بسياسات مضبوطة فعلياً.
-- الدور "المُعتمِد" (approver) يطابق OWNER_EMAILS في src/app.js سطر 498 —
-- نفس القائمة المستعملة لبوابات الواجهة الأخرى (item_costs وغيرها)، وليست
-- قائمة جديدة مستقلة.
-- بلا SECURITY DEFINER: الدالة تقرأ فقط auth.jwt() الخاص بالجلسة الحالية، لا
-- تلمس أي جدول ذي صلاحيات مقيّدة، فلا داعي لتشغيلها بصلاحيات مالكها.
create or replace function purchase_invoices_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') in ('ozk.kh@outlook.com', 'ozkkhalouf@gmail.com');
$$;

comment on function purchase_invoices_is_owner() is 'يطابق OWNER_EMAILS في src/app.js — أساس صلاحية اعتماد/تعديل فواتير المشتريات بعد المسودة';

drop policy if exists "authenticated can select purchase_invoices" on purchase_invoices;
drop policy if exists "authenticated can insert purchase_invoices" on purchase_invoices;
drop policy if exists "authenticated can update purchase_invoices" on purchase_invoices;
drop policy if exists "authenticated can delete purchase_invoices" on purchase_invoices;

-- القراءة: كل الموظفين المسجّلين يحتاجون رؤية كل الفواتير للعمل اليومي — بلا تغيير.
create policy "purchase_invoices_select_authenticated"
  on purchase_invoices for select
  to authenticated
  using (true);

-- الإنشاء: أي موظف مسجّل (المُنشئ) — لكن حصراً كمسودة يملكها هو، بلا أي حقل
-- من حقول الاعتماد/المزامنة مُعبَّأ مسبقاً (لا يمكن لأحد أن "يُنشئ" فاتورة
-- مُعتمَدة أو مُزامَنة مباشرة، متجاوزاً تسلسل الحالة بالكامل).
create policy "purchase_invoices_insert_creator"
  on purchase_invoices for insert
  to authenticated
  with check (
    status = 'draft'
    and created_by = auth.uid()
    and approved_by is null
    and synced_at is null
    and ameen_document_guid is null
    and ameen_document_number is null
  );

-- التعديل: USING يتحقق من ملكية الصف القديم قبل قبول أي محاولة تعديل — لا
-- يكفي أن يكون الصف غير مُزامَن، بل يجب أن يكون المُستخدم إما مُنشئ الصف
-- القديم (created_by = auth.uid()) أو المُعتمِد (owner)؛ هذا ما يمنع أي مستخدم
-- مسجّل من محاولة تعديل فاتورة لا يملكها أصلاً (كانت USING السابقة تسمح بذلك
-- لأي مستخدم طالما status <> 'synced'، وتتّكل فقط على WITH CHECK لرفض النتيجة).
-- ضمن الصفوف غير المُزامَنة المملوكة:
--   - المُنشئ يعدّل سطور/بيانات فاتورته طالما بقيت مسودة (لا يستطيع اعتمادها بنفسه).
--   - أي انتقال فعلي للحالة (draft→approved أو التعديل على صف غير-مسودة أصلاً)
--     يتطلب purchase_invoices_is_owner() — هذا ما يمنع المُنشئ من اعتماد فاتورته.
--   - لا أحد (لا مُنشئ ولا مُعتمِد) يستطيع كتابة synced_at/ameen_document_guid/
--     ameen_document_number أو تحويل status إلى 'synced' من هذه السياسة إطلاقاً؛
--     تلك الحقول service-role فقط (عامل المزامنة يتجاوز RLS بمفتاح service key
--     تماماً كما تفعل بقية سكربتات tools/*.ps1 الحالية)، فلا حاجة لسياسة صريحة لها.
--   - محاولة تغيير created_by نفسه (لسرقة مسودة) يرفضها trigger منفصل
--     (purchase_invoice_guard_immutable_and_stamp) بصرف النظر عن نتيجة RLS هنا.
create policy "purchase_invoices_update_client"
  on purchase_invoices for update
  to authenticated
  using (
    status <> 'synced'
    and (created_by = auth.uid() or purchase_invoices_is_owner())
  )
  with check (
    status <> 'synced'
    and (
      (status = 'draft' and created_by = auth.uid())
      or purchase_invoices_is_owner()
    )
    and synced_at is null
    and ameen_document_guid is null
    and ameen_document_number is null
  );

-- الحذف: ممنوع نهائياً على أي فاتورة مُزامَنة (USING يُقصيها بالكامل، طبقة
-- مستقلة عن تحذير الواجهة في removePurchaseInvoice). قبل المزامنة: المُنشئ
-- يحذف مسودته فقط طالما بقيت status='draft' (لا يستطيع حذف فاتورة اعتمدها
-- هو أو غيره)، والمُعتمِد (owner) يحذف أي فاتورة غير مُزامَنة أياً كانت حالتها.
create policy "purchase_invoices_delete_client"
  on purchase_invoices for delete
  to authenticated
  using (
    status <> 'synced'
    and (
      (status = 'draft' and created_by = auth.uid())
      or purchase_invoices_is_owner()
    )
  );

-- ============================================================
-- جدول جديد: لقطة صنف من الأمين (مخزون/تكلفة/آخر مورد/حركة مبيع)
-- ============================================================
create table if not exists ameen_item_snapshot (
  id                 uuid          default gen_random_uuid() primary key,
  item_key           text          not null,
  item_guid          text,
  item_number        text,
  item_name          text          not null default '',
  unit1_name         text          default '',
  unit2_name         text          default '',
  unit2_factor       numeric(12,4) default 1,
  stock_unit1        numeric(15,3) default 0,
  stock_unit2        numeric(15,3) default 0,
  last_purchase_price   numeric(15,4),
  last_purchase_currency text,
  last_purchase_date    date,
  last_purchase_unit    text,
  average_cost          numeric(15,4),
  average_cost_currency text,
  average_cost_basis    text default '',
  last_supplier_name    text,
  last_supplier_guid    text,
  units_sold_30d        numeric(15,3),
  movement_rank         int,
  generated_at          timestamptz not null default now()
);

comment on table ameen_item_snapshot is 'لقطة يومية لكل صنف من الأمين (مخزون محسوب من حركة الفواتير لا ms000، آخر سعر شراء، متوسط تكلفة، آخر مورد، ترتيب حركة المبيع) — يرفعها tools/push-purchase-item-snapshot.ps1 فقط، قراءة عبر Supabase للموظفين';
comment on column ameen_item_snapshot.item_key is 'مفتاح المطابقة مع approved_price_items.item_key — نفس القيمة، ليست جدولاً مستقلاً بمفاتيح مختلفة';
comment on column ameen_item_snapshot.stock_unit1 is 'المخزون بوحدة الإفراد (كروز) — محسوب من حركة الفواتير bIsInput/bIsOutput، وليس من ms000 (قاعدة تدوير السنة 2026 الموثّقة في AI_WORK_SYNC.md)';
comment on column ameen_item_snapshot.stock_unit2 is 'نفس المخزون محوَّلاً لوحدة الجملة (كرتونة) عبر unit2_factor';
comment on column ameen_item_snapshot.average_cost_basis is 'شرح نصي لطريقة حساب متوسط التكلفة ومصدرها ووحدتها — إلزامي التعبئة، لا رقم بلا سياق';
comment on column ameen_item_snapshot.movement_rank is 'ترتيب الصنف بحركة المبيع خلال آخر 30 يوماً (1 = الأعلى مبيعاً) — أساس قسم «أصناف مقترحة»';
comment on column ameen_item_snapshot.generated_at is 'وقت توليد هذه اللقطة على جهاز Windows — يُعرض للمستخدم كي يعرف حداثة الأرقام';

create unique index if not exists idx_ameen_item_snapshot_item_key on ameen_item_snapshot (item_key);
create index if not exists idx_ameen_item_snapshot_movement_rank on ameen_item_snapshot (movement_rank);

alter table ameen_item_snapshot enable row level security;

-- قراءة فقط للموظفين المسجّلين، بلا anon إطلاقاً (نفس قاعدة approved_price_items
-- للجداول الحساسة) — لا سياسة insert/update/delete هنا، فالكتابة service-role فقط
-- (سكربت Windows يستعمل service key مباشرة عبر REST ويتجاوز RLS كما تفعل باقي
-- سكربتات tools/*.ps1 الحالية، وليس عبر جلسة مستخدم عادية).
-- GRANT/REVOKE صريحان هنا دفاع مستوى ثانٍ مستقل عن RLS (نفس مبدأ الجداول
-- الحساسة الأخرى) — بلا اعتماد على RLS وحدها لمنع anon.
revoke all on ameen_item_snapshot from anon;
grant select on ameen_item_snapshot to authenticated;

drop policy if exists "authenticated can select ameen_item_snapshot" on ameen_item_snapshot;
create policy "authenticated can select ameen_item_snapshot"
  on ameen_item_snapshot for select
  to authenticated
  using (true);

-- ============================================================
-- ملاحظة حول outbox/طابور مزامنة منفصل
-- ============================================================
-- لم يُنشأ جدول طابور منفصل: idempotency_key + status='sync_pending' على
-- purchase_invoices نفسه كافيان كطابور (عامل المزامنة يقرأ WHERE status =
-- 'sync_pending' ORDER BY created_at). طابور مستقل يضيف تعقيداً بلا فائدة
-- واضحة في هذا الحجم من البيانات (فواتير مشتريات يدوية، ليست معاملات فورية
-- كثيفة). إن تبيّن لاحقاً حاجة لإعادة محاولة مجدولة مستقلة عن حالة الفاتورة
-- نفسها، يُعاد النظر بهذا القرار حينها.
