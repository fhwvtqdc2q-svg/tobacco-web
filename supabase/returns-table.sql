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
  correction_log         jsonb         not null default '[]',

  -- أثر الاعتماد الفعلي (تُملأ عند الانتقال draft → approved من الكود، لا يدوياً):
  -- الربح/التكلفة/الإيراد المعكوس فعلياً لهذا المستند (retCalc.retInvoiceProfitReversal)،
  -- ونوع/هدف/قيمة التسوية المالية (retCalc.retSettlementImpact)، وعَلَم/توقيت تطبيق
  -- أثر المخزون فعلياً على approved_price_items.stock_qty (قد يبقى false إن تعذّر
  -- تحديد الوحدة بثقة لأحد الأصناف — انظر AI_HANDOFF.md لتوثيق أي حالة كهذه).
  reversed_revenue       numeric(15,2) not null default 0,
  reversed_cost          numeric(15,2) not null default 0,
  reversed_profit        numeric(15,2) not null default 0,
  settlement_type        text          default null check (settlement_type in ('customer_credit', 'supplier_credit', 'cash_refund')),
  settlement_target_id   text          default null,
  settlement_amount      numeric(15,2) not null default 0,
  stock_applied          boolean       not null default false,
  stock_applied_at       timestamptz   default null,

  -- سبب المرتجع إلزامي بمجرد مغادرة حالة المسودة (طبقة دفاع ثانية عن التحقق
  -- بالواجهة في app.js — لا اعتماد على الواجهة وحدها).
  constraint returns_reason_required_after_draft
    check (status = 'draft' or coalesce(trim(reason), '') <> '')
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
  item jsonb;
  other_item jsonb;
  other_row record;
  item_line_key text;
  item_qty numeric;
  already_qty numeric;
  original_qty numeric;
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

  if not (new.status = 'draft' or coalesce(trim(new.reason), '') <> '') then
    raise exception 'لا يمكن اعتماد مرتجع بلا سبب مكتوب';
  end if;

  if from_rank = 2 and to_rank = 2 then
    return new; -- sync_pending <-> failed مسموح بالاتجاهين
  end if;

  if to_rank <> from_rank + 1 then
    raise exception 'انتقال حالة غير مسموح: % → %', old.status, new.status;
  end if;

  -- ===== حارس ذري ضد تجاوز الكمية المرتجعة (عند الاعتماد فقط) =====
  -- حجّة الذرّية: pg_advisory_xact_lock مأخوذ هنا بمعرّف مشتق من original_invoice_guid
  -- قبل قراءة أي مجاميع مُلتزَمة (committed) من صفوف returns الأخرى لنفس الفاتورة
  -- الأصلية. القفل معاملي (xact) ويُحرَّر تلقائياً عند commit/rollback. لأن كل
  -- معاملة تحاول اعتماد مرتجع لنفس original_invoice_guid يجب أن تحصل على نفس
  -- القفل قبل قراءة المجموع، تُسلسَل (serialize) المعاملات المتزامنة على نفس
  -- الفاتورة الأصلية بعضها خلف بعض — فلا يمكن لمعاملتين متزامنتين أن تريا نفس
  -- "المجموع القديم" وتوافقا معاً على تجاوز original_qty (سباق read-then-write
  -- كلاسيكي). هذا يعادل "SELECT ... FOR UPDATE" لكن دون الحاجة لصف قفل حقيقي
  -- بجدول آخر، لأن original_invoice_guid ثابت ومعروف قبل الالتزام.
  if new.status = 'approved' and new.original_invoice_guid is not null then
    perform pg_advisory_xact_lock(hashtext(new.original_invoice_guid));

    for item in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
    loop
      item_line_key := coalesce(item ->> 'line_key', item ->> 'item_key', item ->> 'name');
      item_qty := coalesce((item ->> 'qty')::numeric, 0);
      original_qty := coalesce((item ->> 'original_qty')::numeric, 0);
      already_qty := 0;

      for other_row in
        select items
        from returns
        where id <> new.id
          and original_invoice_guid = new.original_invoice_guid
          and status in ('approved', 'sync_pending', 'synced', 'failed')
      loop
        for other_item in select * from jsonb_array_elements(coalesce(other_row.items, '[]'::jsonb))
        loop
          if coalesce(other_item ->> 'line_key', other_item ->> 'item_key', other_item ->> 'name') = item_line_key then
            already_qty := already_qty + coalesce((other_item ->> 'qty')::numeric, 0);
          end if;
        end loop;
      end loop;

      if already_qty + item_qty > original_qty then
        raise exception 'الكمية المرتجعة لهذا الصنف (%) تتجاوز المتبقي من الفاتورة الأصلية', item_line_key;
      end if;
    end loop;
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

-- ===== محفّز: منع تعديل created_by، وتوقيع approved_by/approved_at تلقائياً،
--       وتجميد الحقول المالية بمجرد اعتماد المستند (draft) =====
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

  -- بمجرد مغادرة حالة المسودة (approved أو أعلى)، تُقفَل الحقول المالية
  -- الجوهرية للمستند: النوع، الجهة، مرجع الفاتورة الأصلية، طريقة الدفع،
  -- الصندوق، بنود الأصناف والكميات والأسعار والتكلفة، والإجمالي. لا يجوز
  -- تعديل أي منها بعد الاعتماد إطلاقاً — فقط عبر آلية correctReturnDocument
  -- (سجل تصحيحي موثّق) وليس تعديلاً حراً. حقول المزامنة (sync_*، synced_at،
  -- ameen_document_*) وحقول أثر الاعتماد (reversed_*، settlement_*،
  -- stock_applied*) وحقول التصحيح (correction_*) تبقى قابلة للتعديل بعد الاعتماد.
  if old.status <> 'draft' then
    if new.kind is distinct from old.kind
      or new.party_name is distinct from old.party_name
      or new.party_ameen_guid is distinct from old.party_ameen_guid
      or new.party_ameen_code is distinct from old.party_ameen_code
      or new.original_invoice_number is distinct from old.original_invoice_number
      or new.original_invoice_guid is distinct from old.original_invoice_guid
      or new.original_invoice_date is distinct from old.original_invoice_date
      or new.original_pay_method is distinct from old.original_pay_method
      or new.treasury_name is distinct from old.treasury_name
      or new.items is distinct from old.items
      or new.total is distinct from old.total
    then
      raise exception 'لا يمكن تعديل المحتوى المالي لمرتجع بعد اعتماده — استخدم إجراء تصحيحي موثّق بدلاً من ذلك';
    end if;
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
