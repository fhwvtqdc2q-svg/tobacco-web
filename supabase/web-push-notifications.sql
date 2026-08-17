-- OZK Web Push foundation
-- Reuses telegram_outbox as the business-event source so Telegram and Web Push stay consistent.

create table if not exists public.web_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text
);

alter table public.web_push_subscriptions enable row level security;

create policy "web_push_select_own" on public.web_push_subscriptions
for select to authenticated using ((select auth.uid()) = user_id);
create policy "web_push_insert_own" on public.web_push_subscriptions
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "web_push_update_own" on public.web_push_subscriptions
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "web_push_delete_own" on public.web_push_subscriptions
for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.web_push_outbox (
  id bigint generated always as identity primary key,
  event_type text not null,
  title text not null,
  body text not null,
  tag text,
  navigate text not null default '/?route=overview',
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);
create index if not exists web_push_outbox_pending_idx on public.web_push_outbox(status, created_at);
alter table public.web_push_outbox enable row level security;

-- Internal mirror from the already-audited Telegram event stream.
create or replace function public.mirror_telegram_to_web_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_line text;
  rest text;
begin
  -- Push only operational / financial / inventory events, not every Telegram message.
  if not (
    new.event_type = 'payment'
    or new.event_type like 'stock_%'
    or new.event_type like 'credit_%'
    or new.event_type like '%limit%'
    or new.event_type like 'inventory%'
    or new.event_type like 'sync_%'
    or new.event_type like 'daily_%'
  ) then
    return new;
  end if;

  first_line := split_part(new.message, chr(10), 1);
  rest := regexp_replace(new.message, '^[^' || chr(10) || ']*' || chr(10) || '?', '');
  if rest = '' then rest := first_line; end if;

  insert into public.web_push_outbox(event_type, title, body, tag)
  values (new.event_type, left(first_line, 120), left(rest, 1200), left(new.event_type, 80));
  return new;
end;
$$;
revoke all on function public.mirror_telegram_to_web_push() from public, anon, authenticated;

drop trigger if exists trg_mirror_telegram_to_web_push on public.telegram_outbox;
create trigger trg_mirror_telegram_to_web_push
after insert on public.telegram_outbox
for each row execute function public.mirror_telegram_to_web_push();

-- Scheduled dispatcher. The shared token is read server-side from app_secrets.
create or replace function public.dispatch_web_push_outbox()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  dispatch_token text;
begin
  select value into dispatch_token from public.app_secrets where name = 'web_push_dispatch_token' limit 1;
  if dispatch_token is null or dispatch_token = '' then return; end if;

  perform net.http_post(
    url := 'https://dyxbirfpxeocqffnfdeb.supabase.co/functions/v1/web-push',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-OZK-Push-Token', dispatch_token
    ),
    body := jsonb_build_object('action','dispatch')
  );
end;
$$;
revoke all on function public.dispatch_web_push_outbox() from public, anon, authenticated;

-- Idempotent cron registration.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-web-push-outbox') then
    perform cron.unschedule('dispatch-web-push-outbox');
  end if;
  perform cron.schedule('dispatch-web-push-outbox', '* * * * *', 'select public.dispatch_web_push_outbox();');
end $$;
