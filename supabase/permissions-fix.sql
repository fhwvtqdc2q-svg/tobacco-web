-- Run this only if the app shows:
-- permission denied for table customer_requests

create table if not exists public.inventory_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null default current_date,
  source text not null default 'ameen_excel' check (char_length(source) between 1 and 60),
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

grant usage on schema public to authenticated;
grant select, insert, update on table public.customer_requests to authenticated;
grant select, insert, delete on table public.inventory_reports to authenticated;

alter table public.customer_requests enable row level security;

drop policy if exists "staff can read customer requests" on public.customer_requests;
create policy "staff can read customer requests"
on public.customer_requests
for select
to authenticated
using (true);

drop policy if exists "staff can create customer requests" on public.customer_requests;
create policy "staff can create customer requests"
on public.customer_requests
for insert
to authenticated
with check (auth.uid() = created_by);

drop policy if exists "staff can update customer requests" on public.customer_requests;
create policy "staff can update customer requests"
on public.customer_requests
for update
to authenticated
using (true)
with check (true);

alter table public.inventory_reports enable row level security;

drop policy if exists "staff can read inventory reports" on public.inventory_reports;
create policy "staff can read inventory reports"
on public.inventory_reports
for select
to authenticated
using (true);

drop policy if exists "staff can create inventory reports" on public.inventory_reports;
create policy "staff can create inventory reports"
on public.inventory_reports
for insert
to authenticated
with check (auth.uid() = created_by);

drop policy if exists "staff can delete own inventory reports" on public.inventory_reports;
create policy "staff can delete own inventory reports"
on public.inventory_reports
for delete
to authenticated
using (auth.uid() = created_by);

create index if not exists inventory_reports_created_at_idx
on public.inventory_reports (created_at desc);

create index if not exists inventory_reports_report_date_idx
on public.inventory_reports (report_date desc);

create table if not exists public.customer_credit_limits (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null unique,
  customer_name text not null default '',
  credit_limit numeric(18, 3) not null default 0 check (credit_limit >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

grant select, insert, update, delete on table public.customer_credit_limits to authenticated;

alter table public.customer_credit_limits enable row level security;

drop policy if exists "staff can read customer credit limits" on public.customer_credit_limits;
create policy "staff can read customer credit limits"
on public.customer_credit_limits
for select
to authenticated
using (auth.uid() is not null);

drop policy if exists "staff can create customer credit limits" on public.customer_credit_limits;
create policy "staff can create customer credit limits"
on public.customer_credit_limits
for insert
to authenticated
with check (auth.uid() is not null and updated_by = auth.uid());

drop policy if exists "staff can update customer credit limits" on public.customer_credit_limits;
create policy "staff can update customer credit limits"
on public.customer_credit_limits
for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null and updated_by = auth.uid());

drop policy if exists "staff can delete customer credit limits" on public.customer_credit_limits;
create policy "staff can delete customer credit limits"
on public.customer_credit_limits
for delete
to authenticated
using (auth.uid() is not null);

create index if not exists customer_credit_limits_customer_key_idx
on public.customer_credit_limits (customer_key);

create index if not exists customer_credit_limits_updated_at_idx
on public.customer_credit_limits (updated_at desc);
