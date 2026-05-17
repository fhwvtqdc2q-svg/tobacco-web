-- TOBACCO customer-service schema for Supabase.
-- Run this in Supabase SQL Editor after creating the project.
-- Do not run it with a service_role key from the browser.

create table if not exists public.customer_requests (
  id uuid primary key default gen_random_uuid(),
  customer text not null check (char_length(customer) between 1 and 120),
  channel text not null check (char_length(channel) between 1 and 40),
  request_type text not null check (char_length(request_type) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'closed')),
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_requests enable row level security;

revoke all on table public.customer_requests from anon;
grant usage on schema public to authenticated;
grant select, insert, update on table public.customer_requests to authenticated;

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

create index if not exists customer_requests_created_at_idx
on public.customer_requests (created_at desc);

create index if not exists customer_requests_status_idx
on public.customer_requests (status);

create table if not exists public.inventory_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null default current_date,
  source text not null default 'ameen_excel' check (char_length(source) between 1 and 60),
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.inventory_reports enable row level security;

grant select, insert, delete on table public.inventory_reports to authenticated;

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

alter table public.customer_credit_limits enable row level security;

revoke all on table public.customer_credit_limits from anon;
grant select, insert, update, delete on table public.customer_credit_limits to authenticated;

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

create table if not exists public.approved_price_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  item_name text not null default '',
  sale_price numeric(18, 3) not null check (sale_price > 0),
  stock_qty numeric(18, 3) not null default 0,
  stock_status text not null default '',
  unit1_name text not null default '',
  unit2_name text not null default '',
  unit2_factor numeric(18, 3) not null default 1,
  unit2_price numeric(18, 3) not null default 0,
  unit1_price numeric(18, 3) not null default 0,
  source_report_id uuid references public.inventory_reports(id) on delete set null,
  source_synced_at timestamptz,
  price_payload jsonb not null default '{}'::jsonb,
  notes text not null default '',
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.approved_price_items
  add column if not exists unit1_name text not null default '',
  add column if not exists unit2_name text not null default '',
  add column if not exists unit2_factor numeric(18, 3) not null default 1,
  add column if not exists unit2_price numeric(18, 3) not null default 0,
  add column if not exists unit1_price numeric(18, 3) not null default 0;

update public.approved_price_items
set unit2_factor = 1
where unit2_factor is null or unit2_factor <= 0;

update public.approved_price_items
set unit1_price = sale_price
where unit1_price = 0 and sale_price > 0;

update public.approved_price_items
set unit2_price = sale_price * unit2_factor
where unit2_price = 0 and sale_price > 0;

update public.approved_price_items
set
  sale_price = round(unit2_price / unit2_factor, 3),
  unit1_price = round(unit2_price / unit2_factor, 3)
where unit2_price > 0 and unit2_factor > 0;

create or replace function public.normalize_approved_price_units()
returns trigger
language plpgsql
as $$
begin
  if new.unit2_factor is null or new.unit2_factor <= 0 then
    new.unit2_factor := 1;
  end if;

  if new.unit2_price is not null and new.unit2_price > 0 then
    new.sale_price := round(new.unit2_price / new.unit2_factor, 3);
    new.unit1_price := new.sale_price;
  elsif new.sale_price is not null and new.sale_price > 0 then
    new.unit1_price := new.sale_price;
    if coalesce(new.unit2_price, 0) = 0 then
      new.unit2_price := round(new.sale_price * new.unit2_factor, 3);
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists normalize_approved_price_units_trigger on public.approved_price_items;
create trigger normalize_approved_price_units_trigger
before insert or update of sale_price, unit2_price, unit2_factor, unit1_price
on public.approved_price_items
for each row
execute function public.normalize_approved_price_units();

alter table public.approved_price_items enable row level security;

revoke all on table public.approved_price_items from anon;
grant select, insert, update, delete on table public.approved_price_items to authenticated;

drop policy if exists "staff can read approved prices" on public.approved_price_items;
create policy "staff can read approved prices"
on public.approved_price_items
for select
to authenticated
using (auth.uid() is not null);

drop policy if exists "staff can create approved prices" on public.approved_price_items;
create policy "staff can create approved prices"
on public.approved_price_items
for insert
to authenticated
with check (auth.uid() is not null and approved_by = auth.uid());

drop policy if exists "staff can update approved prices" on public.approved_price_items;
create policy "staff can update approved prices"
on public.approved_price_items
for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null and approved_by = auth.uid());

drop policy if exists "staff can delete approved prices" on public.approved_price_items;
create policy "staff can delete approved prices"
on public.approved_price_items
for delete
to authenticated
using (auth.uid() is not null);

create index if not exists approved_price_items_item_key_idx
on public.approved_price_items (item_key);

create index if not exists approved_price_items_updated_at_idx
on public.approved_price_items (updated_at desc);
