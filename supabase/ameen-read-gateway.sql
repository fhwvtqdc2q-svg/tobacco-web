-- Secure request/response channel for the Windows Ameen Read Gateway.
-- Browser and AI never receive the Al-Ameen SQL connection string.
-- All access is brokered through the authenticated ameen-read-broker Edge Function.
create table if not exists public.ameen_read_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  resource text not null check (resource in ('health','stock','customers')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','expired')),
  requested_at timestamptz not null default now(), claimed_at timestamptz, completed_at timestamptz,
  expires_at timestamptz not null default (now()+interval '2 minutes'), response jsonb, error text, agent_id text
);
create index if not exists ameen_read_requests_pending_idx on public.ameen_read_requests(status,requested_at);
alter table public.ameen_read_requests enable row level security;
revoke all on table public.ameen_read_requests from anon, authenticated;
drop policy if exists ameen_read_insert_own on public.ameen_read_requests;
drop policy if exists ameen_read_select_own on public.ameen_read_requests;
drop function if exists public.request_ameen_read(text);
-- No client policies by design. Service-role access is confined to the broker.
