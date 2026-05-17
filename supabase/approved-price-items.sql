-- Approved sale prices entered from the phone and pulled by the accounting device.
-- Run this once in Supabase Dashboard > SQL Editor.
-- Do not put service_role keys in the browser or in Git.

create table if not exists public.approved_price_items (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  item_name text not null default '',
  sale_price numeric(18, 3) not null check (sale_price > 0),
  stock_qty numeric(18, 3) not null default 0,
  stock_status text not null default '',
  source_report_id uuid references public.inventory_reports(id) on delete set null,
  source_synced_at timestamptz,
  price_payload jsonb not null default '{}'::jsonb,
  notes text not null default '',
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.approved_price_items enable row level security;

revoke all on table public.approved_price_items from anon;
grant usage on schema public to authenticated;
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

