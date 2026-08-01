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
  created_by     text,
  created_at     timestamptz   default now(),
  updated_at     timestamptz   default now(),
  reviewed_at    timestamptz,
  reviewed_by    text,
  approved_at    timestamptz,
  approved_by    text
);

comment on table inventory_recon_sessions is 'جلسات الجرد الشهري — تسجيل داخلي فقط، لا تُزامَن مع الأمين ولا تُغيّر مخزوناً';

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

comment on table inventory_recon_audit_log is 'سجل تدقيق لتغييرات جلسات وسطور الجرد';

create index if not exists idx_inventory_recon_sessions_date
  on inventory_recon_sessions (session_date desc);

create index if not exists idx_inventory_recon_sessions_month_warehouse
  on inventory_recon_sessions (session_month, warehouse_key);

create index if not exists idx_inventory_recon_lines_session
  on inventory_recon_lines (session_id);

create index if not exists idx_inventory_recon_audit_log_session
  on inventory_recon_audit_log (session_id);

-- ============================================================
-- حارس الثبات: بعد status='approved' يُمنع أي تعديل على الجلسة أو سطورها
-- (نفس فكرة returns_guard_immutable_and_stamp في returns-table.sql)
-- ============================================================

create or replace function inventory_recon_guard_immutable()
returns trigger as $$
declare
  status_rank constant jsonb := '{"draft": 0, "reviewed": 1, "approved": 2}';
  old_rank int;
  new_rank int;
begin
  if OLD.status = 'approved' then
    raise exception 'inventory_recon_sessions: session % is approved and cannot be modified or deleted', OLD.id;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  if NEW.status is distinct from OLD.status then
    old_rank := (status_rank ->> OLD.status)::int;
    new_rank := (status_rank ->> NEW.status)::int;
    if new_rank is null or new_rank <> old_rank + 1 then
      raise exception 'inventory_recon_sessions: invalid status transition % -> % for session %', OLD.status, NEW.status, OLD.id;
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
-- RLS — نفس نمط purchase-invoices-table.sql (auth.role() = 'authenticated')
-- ============================================================

alter table inventory_recon_sessions enable row level security;
alter table inventory_recon_lines enable row level security;
alter table inventory_recon_audit_log enable row level security;

create policy "authenticated can select inventory_recon_sessions"
  on inventory_recon_sessions for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert inventory_recon_sessions"
  on inventory_recon_sessions for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated can update inventory_recon_sessions"
  on inventory_recon_sessions for update
  using (auth.role() = 'authenticated' and status <> 'approved')
  with check (auth.role() = 'authenticated');

create policy "authenticated can delete inventory_recon_sessions"
  on inventory_recon_sessions for delete
  using (auth.role() = 'authenticated' and status <> 'approved');

create policy "authenticated can select inventory_recon_lines"
  on inventory_recon_lines for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert inventory_recon_lines"
  on inventory_recon_lines for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated can update inventory_recon_lines"
  on inventory_recon_lines for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "authenticated can delete inventory_recon_lines"
  on inventory_recon_lines for delete
  using (auth.role() = 'authenticated');

create policy "authenticated can select inventory_recon_audit_log"
  on inventory_recon_audit_log for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert inventory_recon_audit_log"
  on inventory_recon_audit_log for insert
  with check (auth.role() = 'authenticated');
