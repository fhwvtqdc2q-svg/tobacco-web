-- Secure request/response channel for the Windows Ameen Read Gateway.
-- Browser/AI never receives the Al-Ameen SQL connection string.
-- The Windows agent authenticates with the existing dedicated Supabase sync user.

create table if not exists public.ameen_read_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  resource text not null check (resource in ('health','stock','customers')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','expired')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  response jsonb,
  error text,
  agent_id text
);
create index if not exists ameen_read_requests_pending_idx on public.ameen_read_requests(status, requested_at);
alter table public.ameen_read_requests enable row level security;
revoke all on table public.ameen_read_requests from anon;
grant select, insert on table public.ameen_read_requests to authenticated;

drop policy if exists ameen_read_insert_own on public.ameen_read_requests;
create policy ameen_read_insert_own on public.ameen_read_requests for insert to authenticated
with check ((select auth.uid()) = requested_by and status = 'pending' and resource in ('health','stock','customers'));
drop policy if exists ameen_read_select_own on public.ameen_read_requests;
create policy ameen_read_select_own on public.ameen_read_requests for select to authenticated
using ((select auth.uid()) = requested_by);

create or replace function public.request_ameen_read(p_resource text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_resource not in ('health','stock','customers') then raise exception 'Unsupported Ameen resource'; end if;
  insert into public.ameen_read_requests(requested_by,resource)
  values ((select auth.uid()),p_resource) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.request_ameen_read(text) from public, anon;
grant execute on function public.request_ameen_read(text) to authenticated;
