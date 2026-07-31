-- ============================================================
-- OZK TOBACCO — جدول مستندات المرتجعات (مبيعات جملة/مركز، مشتريات)
-- تسجيل داخلي في Supabase فقط — لا يُزامَن تلقائياً مع الأمين (المزامنة
-- المستقبلية عبر tools/sync-returns-to-ameen.ps1 مقفلة بـ exit 1 حالياً).
--
-- ⚠️ ملف مرجعي فقط — لم يُطبَّق بعد على مشروع Supabase الإنتاجي.
-- يُطبَّق يدوياً عبر Supabase → SQL Editor بعد مراجعة بشرية صريحة.
-- ============================================================

create table if not exists returns (
  id                     uuid          default gen_random_uuid() primary key,

  -- نوع المرتجع يحدد سلسلة ترقيم الأمين والجهة المرتبطة (زبون/مورد):
  --   sales_wholesale → سلسلة "مرتجع مبيعات"        (زبون جملة)
  --   sales_retail    → سلسلة "مرتجع مبيعات مركز"   (زبون مركز/مفرق)
  --   purchase        → سلسلة "مرتجع مشتريات"        (مورد)
  kind                   text          not null check (kind in ('sales_wholesale', 'sales_retail', 'purchase')),

  -- الجهة (اسم الزبون لمرتجع المبيعات، اسم المورد لمرتجع المشتريات) —
  -- نص حر مطابق لاسم الأمين كما يظهر بتقارير القراءة الحالية (ameen_customer_invoices /
  -- ameen_purchase_invoice_reports)، لأن الربط بمعرّف GUID فعلي غير متاح بعد
  -- (السلاسل الثلاث لم تُكتشف من الأمين حتى الآن — انظر AI_HANDOFF.md).
  party_name             text          not null default '',
  party_ameen_guid       text          default null,
  party_ameen_code       text          default null,

  -- الفاتورة الأصلية المرتبطة بهذا المرتجع (رقم/معرّف الأمين وتاريخها) —
  -- تُقرأ فقط من تقارير الأمين الموجودة أصلاً، لا تُنشأ ولا تُعدَّل هنا.
  original_invoice_number text         not null default '',
  original_invoice_guid   text         default null,
  original_invoice_date   date         default null,

  -- طريقة الدفع الأصلية: تُدخَل يدوياً لأن تقرير ameen_customer_invoices
  -- الحالي لا يحمل حقل طريقة الدفع لكل فاتورة (قيد بيانات موثّق، ليس تخميناً).
  original_pay_method    text          not null default 'credit' check (original_pay_method in ('cash', 'credit')),

  -- صندوق الاسترداد النقدي: يجب أن يكون نفس صندوق الفاتورة الأصلية (نص حر
  -- بانتظار ربط حقيقي بصناديق الأمين)؛ إلزامي فقط عند original_pay_method = 'cash'.
  treasury_name           text         default null,

  reason                 text          not null default '',

  -- بنود المرتجع: [{ itemKey, name, unit, originalQty, qty, price, unitCost }]
  -- originalQty هي كمية السطر بالفاتورة الأصلية كما قُرئت من تقرير الأمين،
  -- qty هي الكمية المرتجعة فعلياً (يجب ألا تتجاوز المتبقي بعد خصم كل مرتجع
  -- سابق معتمد لنفس itemKey — يُتحقق منه في التطبيق عبر retCalc.retValidateReturnQty
  -- قبل الحفظ، وليس عبر قيد قاعدة بيانات لأن التحقق يحتاج مقارنة مع مستندات أخرى).
  items                  jsonb         not null default '[]',

  total                  numeric(15,2) not null default 0 check (total >= 0),

  -- دورة حياة الحالة: مسودة → معتمد → بانتظار المزامنة/فشلت → مُزامَن
  -- (نفس رتبة الانتقال أحادي الاتجاه في purchase_invoices، انظر retCalc.retCanTransitionStatus)
  status                 text          not null default 'draft'
                                        check (status in ('draft', 'approved', 'sync_pending', 'synced', 'failed')),

  idempotency_key        text          default null,
  sync_attempts          integer       not null default 0,
  sync_error             text          default null,
  ameen_document_guid    text          default null,
  ameen_document_number  text          default null,
  synced_at              timestamptz   default null,

  created_by             uuid          references auth.users(id) on delete set null,
  created_at             timestamptz   default now(),
  updated_at             timestamptz   default now(),
  approved_by            uuid          references auth.users(id) on delete set null,
  approved_at            timestamptz   default null,

  correction_count       integer       not null default 0,
  correction_log         jsonb         not null default '[]'
);

comment on table returns is 'مستندات مرتجعات المبيعات (جملة/مركز) والمشتريات — تسجيل داخلي، لم تُفعَّل مزامنة الأمين بعد';
comment on column returns.original_pay_method is 'يُدخَل يدوياً: تقرير ameen_customer_invoices الحالي لا يحمل طريقة الدفع لكل فاتورة';
comment on column returns.treasury_name is 'يجب أن يطابق صندوق الفاتورة الأصلية — نص حر بانتظار ربط حقيقي بصناديق الأمين';
comment on column returns.party_ameen_guid is 'فارغ حالياً: سلاسل الأمين الثلاث (مرتجع مبيعات/مرتجع مبيعات مركز/مرتجع مشتريات) لم تُكتشف بعد (SQL Server كان متوقفاً وقت التنفيذ)';

create index if not exists idx_returns_created_at on returns (created_at desc);
create index if not exists idx_returns_kind on returns (kind);
create index if not exists idx_returns_party_name on returns (party_name);
create index if not exists idx_returns_original_invoice on returns (original_invoice_guid, original_invoice_number);

create unique index if not exists idx_returns_idempotency_key
  on returns (idempotency_key) where idempotency_key is not null;

alter table returns enable row level security;

-- ===== دالة تحقق ملكية/صلاحية مالك (نفس نمط purchase_invoices_is_owner) =====
create or replace function returns_is_owner()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in ('ozk.kh@outlook.com', 'ozkkhalouf@gmail.com');
$$;

-- ===== دالة/محفّز: انتقال حالة أحادي الاتجاه فقط (نفس رتبة retCanTransitionStatus) =====
create or replace function returns_guard_status_transition()
returns trigger
language plpgsql
as $$
declare
  rank_map jsonb := '{"draft":0,"approved":1,"sync_pending":2,"failed":2,"synced":3}'::jsonb;
  from_rank int;
  to_rank int;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  from_rank := (rank_map ->> old.status)::int;
  to_rank := (rank_map ->> new.status)::int;

  if old.status = 'synced' then
    raise exception 'لا يمكن تعديل حالة مستند مرتجع مُزامَن بالفعل';
  end if;

  if new.status = 'draft' then
    raise exception 'لا يمكن الرجوع إلى حالة مسودة بعد الاعتماد';
  end if;

  if from_rank = 2 and to_rank = 2 then
    return new; -- sync_pending <-> failed مسموح بالاتجاهين
  end if;

  if to_rank <> from_rank + 1 then
    raise exception 'انتقال حالة غير مسموح: % → %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_returns_status_guard on returns;
create trigger trg_returns_status_guard
  before update on returns
  for each row
  when (new.status is distinct from old.status)
  execute function returns_guard_status_transition();

-- ===== محفّز: منع تعديل created_by، وتوقيع approved_by/approved_at تلقائياً =====
create or replace function returns_guard_immutable_and_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'لا يمكن تعديل created_by';
  end if;

  if old.status = 'draft' and new.status = 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    raise exception 'حقول approved_by/approved_at محجوزة للنظام فقط';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_returns_immutable_and_stamp on returns;
create trigger trg_returns_immutable_and_stamp
  before update on returns
  for each row
  execute function returns_guard_immutable_and_stamp();

-- ===== سياسات RLS =====

create policy returns_select_authenticated
  on returns for select
  using (auth.role() = 'authenticated');

create policy returns_insert_creator
  on returns for insert
  with check (
    auth.role() = 'authenticated'
    and status = 'draft'
    and created_by = auth.uid()
    and approved_by is null
    and approved_at is null
    and synced_at is null
    and ameen_document_guid is null
    and ameen_document_number is null
  );

create policy returns_update_client
  on returns for update
  using (
    auth.role() = 'authenticated'
    and (created_by = auth.uid() or returns_is_owner())
  )
  with check (
    auth.role() = 'authenticated'
    and (
      (created_by = auth.uid() and status in ('draft', 'approved'))
      or returns_is_owner()
    )
    and synced_at is null
    and ameen_document_guid is null
    and ameen_document_number is null
    and status <> 'synced'
  );

create policy returns_delete_client
  on returns for delete
  using (
    auth.role() = 'authenticated'
    and (
      (created_by = auth.uid() and status = 'draft')
      or (returns_is_owner() and status <> 'synced')
    )
  );

revoke all on returns from anon;
grant select, insert, update, delete on returns to authenticated;
