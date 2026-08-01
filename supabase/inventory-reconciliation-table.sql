-- ============================================================
-- OZK TOBACCO — الجرد الشهري (تسوية المخزون) — مقترح مخطط فقط
-- ملف مرجعي غير مُطبَّق على أي قاعدة إنتاج بعد. لا تُشغّله على Supabase
-- إلا بعد مراجعة صريحة من صاحب الحساب (ozk.kh@outlook.com).
--
-- "تسجيلي فقط" (registration-only): اعتماد جلسة الجرد يقفل السجل فقط
-- (status='approved') ولا يغيّر أي مخزون أو حساب في الأمين أو Supabase.
-- انظر tools/push-inventory-reconciliation-to-ameen.ps1 (stub مقفل).
-- ============================================================

create table if not exists inventory_recon_sessions (
  id             uuid          default gen_random_uuid() primary key,
  session_date   date          not null default current_date,
  session_month  date          not null,
  warehouse_key  text          not null,
  warehouse_name text          not null,
  status         text          not null default 'draft' check (status in ('draft', 'reviewed', 'approved')),
  idempotency_key text         not null unique,
  notes          text,
  created_by     uuid          references auth.users(id) on delete set null,
  created_at     timestamptz   default now(),
  updated_at     timestamptz   default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid          references auth.users(id) on delete set null,
  approved_at    timestamptz,
  approved_by    uuid          references auth.users(id) on delete set null
);

comment on table inventory_recon_sessions is 'جلسات الجرد الشهري — تسجيل داخلي فقط، لا تُزامَن مع الأمين ولا تُغيّر مخزوناً';
comment on column inventory_recon_sessions.created_by is 'مالك المسودة — يُختم تلقائياً من auth.uid() عند الإنشاء ولا يمكن تعديله لاحقاً';
comment on column inventory_recon_sessions.reviewed_by is 'من راجع الجلسة (draft → reviewed) — يُختم من الخادم فقط';
comment on column inventory_recon_sessions.approved_by is 'من اعتمد الجلسة (reviewed → approved) — يُختم من الخادم فقط، وحصراً لحساب المالك';

create table if not exists inventory_recon_lines (
  id               uuid          default gen_random_uuid() primary key,
  session_id       uuid          not null references inventory_recon_sessions(id) on delete cascade,
  item_key         text          not null,
  item_number      text,
  item_name        text          not null,
  unit_name        text,
  system_qty       numeric(18,3) not null default 0,
  actual_qty       numeric(18,3),
  diff_qty         numeric(18,3) generated always as (
                     case when actual_qty is null then null else actual_qty - system_qty end
                   ) stored,
  unit_cost        numeric(18,4),
  currency         text          default 'USD',
  settlement_value numeric(18,2) generated always as (
                     case when actual_qty is null then null else (actual_qty - system_qty) * coalesce(unit_cost, 0) end
                   ) stored,
  reason           text,
  created_at       timestamptz   default now(),
  updated_at       timestamptz   default now(),
  unique (session_id, item_key)
);

comment on table inventory_recon_lines is 'سطور الجرد لكل صنف — الفرق والقيمة تقديريان لأغراض العرض والتقرير فقط، لا يُنشأ منهما أي قيد محاسبي';

create table if not exists inventory_recon_audit_log (
  id          bigint generated always as identity primary key,
  session_id  uuid references inventory_recon_sessions(id) on delete cascade,
  line_id     uuid references inventory_recon_lines(id) on delete set null,
  actor       text,
  action      text not null,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz default now()
);

comment on table inventory_recon_audit_log is 'سجل تدقيق لتغييرات جلسات وسطور الجرد — يُملأ حصراً من triggers، لا يقبل إدخالاً مباشراً من العميل';

create index if not exists idx_inventory_recon_sessions_date
  on inventory_recon_sessions (session_date desc);

create index if not exists idx_inventory_recon_sessions_month_warehouse
  on inventory_recon_sessions (session_month, warehouse_key);

create index if not exists idx_inventory_recon_lines_session
  on inventory_recon_lines (session_id);

create index if not exists idx_inventory_recon_audit_log_session
  on inventory_recon_audit_log (session_id);

-- ============================================================
-- دالة المالك — نفس نمط purchase_invoices_is_owner() في
-- purchase-invoices-ameen-sync.sql، وتطابق OWNER_EMAILS في src/app.js
-- سطر ~498 (نفس القائمة المستعملة لبوابات واجهة أخرى مثل item_costs).
-- بلا SECURITY DEFINER: تقرأ فقط auth.jwt() الخاص بالجلسة الحالية.
-- ============================================================

create or replace function inventory_recon_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') in ('ozk.kh@outlook.com', 'ozkkhalouf@gmail.com');
$$;

-- ============================================================
-- حارس الثبات + الختم: يمنع أي تعديل بعد status='approved'، يقفل
-- created_by ضد الانتحال، يختم reviewed_by/approved_by من الخادم حصراً
-- عند الانتقال الفعلي فقط، ويمنع الاعتماد قبل اكتمال كل سطر (كمية فعلية
-- + سبب) لأي فرق غير صفري.
-- (نفس فكرة purchase_invoice_guard_immutable_and_stamp في
-- purchase-invoices-ameen-sync.sql)
-- ============================================================

create or replace function inventory_recon_guard_immutable()
returns trigger as $$
declare
  status_rank constant jsonb := '{"draft": 0, "reviewed": 1, "approved": 2}';
  old_rank int;
  new_rank int;
  incomplete_count int;
begin
  if OLD.status = 'approved' then
    raise exception 'inventory_recon_sessions: session % is approved and cannot be modified or deleted', OLD.id;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  if NEW.created_by is distinct from OLD.created_by then
    raise exception 'inventory_recon_sessions: created_by لا يمكن تعديله بعد الإنشاء';
  end if;

  if NEW.status is distinct from OLD.status then
    old_rank := (status_rank ->> OLD.status)::int;
    new_rank := (status_rank ->> NEW.status)::int;
    if new_rank is null or new_rank <> old_rank + 1 then
      raise exception 'inventory_recon_sessions: invalid status transition % -> % for session %', OLD.status, NEW.status, OLD.id;
    end if;

    if OLD.status = 'draft' and NEW.status = 'reviewed' then
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    elsif OLD.status = 'reviewed' and NEW.status = 'approved' then
      if not inventory_recon_is_owner() then
        raise exception 'inventory_recon_sessions: اعتماد الجلسة محصور بحساب المالك';
      end if;

      select count(*) into incomplete_count
      from inventory_recon_lines
      where session_id = OLD.id
        and diff_qty is distinct from 0
        and (actual_qty is null or reason is null or trim(reason) = '');
      if incomplete_count > 0 then
        raise exception 'inventory_recon_sessions: % سطر بلا كمية فعلية أو سبب لفرق غير صفري — لا يمكن الاعتماد', incomplete_count;
      end if;

      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    end if;
  else
    if NEW.reviewed_by is distinct from OLD.reviewed_by or NEW.reviewed_at is distinct from OLD.reviewed_at then
      raise exception 'inventory_recon_sessions: reviewed_by/reviewed_at لا يمكن تعديلهما إلا عند انتقال draft→reviewed نفسه';
    end if;
    if NEW.approved_by is distinct from OLD.approved_by or NEW.approved_at is distinct from OLD.approved_at then
      raise exception 'inventory_recon_sessions: approved_by/approved_at لا يمكن تعديلهما إلا عند انتقال reviewed→approved نفسه';
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_inventory_recon_guard_session on inventory_recon_sessions;
create trigger trg_inventory_recon_guard_session
  before update or delete on inventory_recon_sessions
  for each row
  execute function inventory_recon_guard_immutable();

create or replace function inventory_recon_guard_lines_immutable()
returns trigger as $$
declare
  session_status text;
begin
  select status into session_status
  from inventory_recon_sessions
  where id = coalesce(NEW.session_id, OLD.session_id);

  if session_status = 'approved' then
    raise exception 'inventory_recon_lines: parent session % is approved and its lines cannot be modified', coalesce(NEW.session_id, OLD.session_id);
  end if;

  return coalesce(NEW, OLD);
end;
$$ language plpgsql;

drop trigger if exists trg_inventory_recon_guard_lines on inventory_recon_lines;
create trigger trg_inventory_recon_guard_lines
  before insert or update or delete on inventory_recon_lines
  for each row
  execute function inventory_recon_guard_lines_immutable();

-- ============================================================
-- سجل التدقيق: يُملأ حصراً من trigger عبر دالة SECURITY DEFINER
-- (تعمل بصلاحيات مالك الدالة فتتجاوز RLS)، لا إدخال مباشر من العميل.
-- ============================================================

create or replace function inventory_recon_write_audit_log()
returns trigger as $$
begin
  insert into inventory_recon_audit_log(session_id, line_id, actor, action, before_data, after_data)
  values (
    case when TG_TABLE_NAME = 'inventory_recon_sessions' then coalesce(NEW.id, OLD.id)
         else coalesce(NEW.session_id, OLD.session_id) end,
    case when TG_TABLE_NAME = 'inventory_recon_lines' then coalesce(NEW.id, OLD.id) else null end,
    auth.uid()::text,
    TG_OP,
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_inventory_recon_audit_sessions on inventory_recon_sessions;
create trigger trg_inventory_recon_audit_sessions
  after insert or update or delete on inventory_recon_sessions
  for each row
  execute function inventory_recon_write_audit_log();

drop trigger if exists trg_inventory_recon_audit_lines on inventory_recon_lines;
create trigger trg_inventory_recon_audit_lines
  after insert or update or delete on inventory_recon_lines
  for each row
  execute function inventory_recon_write_audit_log();

-- ============================================================
-- RLS — القراءة متاحة لكل مستخدم authenticated، والتعديل/الاعتماد
-- محصوران بمنشئ الجلسة (مسودته فقط) أو حساب المالك.
-- ============================================================

alter table inventory_recon_sessions enable row level security;
alter table inventory_recon_lines enable row level security;
alter table inventory_recon_audit_log enable row level security;

create policy "inventory_recon_sessions_select"
  on inventory_recon_sessions for select
  to authenticated
  using (true);

create policy "inventory_recon_sessions_insert"
  on inventory_recon_sessions for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "inventory_recon_sessions_update"
  on inventory_recon_sessions for update
  to authenticated
  using (
    status <> 'approved'
    and (created_by = auth.uid() or inventory_recon_is_owner())
  )
  with check (
    inventory_recon_is_owner()
    or (created_by = auth.uid() and status in ('draft', 'reviewed'))
  );

create policy "inventory_recon_sessions_delete"
  on inventory_recon_sessions for delete
  to authenticated
  using (
    status <> 'approved'
    and (
      (status = 'draft' and created_by = auth.uid())
      or inventory_recon_is_owner()
    )
  );

create policy "inventory_recon_lines_select"
  on inventory_recon_lines for select
  to authenticated
  using (true);

create policy "inventory_recon_lines_write"
  on inventory_recon_lines for all
  to authenticated
  using (
    exists (
      select 1 from inventory_recon_sessions s
      where s.id = inventory_recon_lines.session_id
        and s.status <> 'approved'
        and (s.created_by = auth.uid() or inventory_recon_is_owner())
    )
  )
  with check (
    exists (
      select 1 from inventory_recon_sessions s
      where s.id = inventory_recon_lines.session_id
        and s.status <> 'approved'
        and (s.created_by = auth.uid() or inventory_recon_is_owner())
    )
  );

create policy "inventory_recon_audit_log_select"
  on inventory_recon_audit_log for select
  to authenticated
  using (true);

-- ملاحظة: لا توجد policy إدخال/تعديل/حذف لـinventory_recon_audit_log —
-- الكتابة الوحيدة المسموحة تمر عبر inventory_recon_write_audit_log()
-- (SECURITY DEFINER)، فأي محاولة إدخال مباشر من العميل تُرفض تلقائياً.
