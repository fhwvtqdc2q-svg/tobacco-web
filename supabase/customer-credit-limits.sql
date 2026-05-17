-- Internal customer credit limits for OZK TOBACCO.
-- Run this once in Supabase Dashboard > SQL Editor.
-- Do not put service_role keys in the browser or in Git.

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
grant usage on schema public to authenticated;
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
