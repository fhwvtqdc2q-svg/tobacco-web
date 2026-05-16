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
