-- OZK TOBACCO — متابعة التحصيل وسجل التدقيق الموحّد
-- ترحيل إضافي آمن: لا يحذف جداول أو بيانات قائمة.

create table if not exists public.business_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  entity_table text not null,
  entity_id text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data jsonb
);
create index if not exists business_audit_log_time_idx on public.business_audit_log(occurred_at desc);
create index if not exists business_audit_log_entity_idx on public.business_audit_log(entity_table,entity_id,occurred_at desc);
alter table public.business_audit_log enable row level security;
revoke all on public.business_audit_log from anon,authenticated;
grant select on public.business_audit_log to authenticated;
drop policy if exists business_audit_owner_select on public.business_audit_log;
create policy business_audit_owner_select on public.business_audit_log for select to authenticated
using (lower(coalesce((select auth.jwt())->>'email','')) in ('ozk.kh@outlook.com','ozkkhalouf@gmail.com'));

create or replace function public.write_business_audit_log()
returns trigger language plpgsql security definer set search_path=public
as $$
declare b jsonb; a jsonb; eid text;
begin
  b := case when tg_op='INSERT' then null else to_jsonb(old) end;
  a := case when tg_op='DELETE' then null else to_jsonb(new) end;
  -- مخزون/وقت مزامنة السعر يتغيران آلياً؛ لا نسجلهما ما لم تتغير قيمة تجارية حساسة.
  if tg_table_name='approved_price_items' and tg_op='UPDATE' and
     (a->'sale_price') is not distinct from (b->'sale_price') and
     (a->'unit1_price') is not distinct from (b->'unit1_price') and
     (a->'unit2_price') is not distinct from (b->'unit2_price') and
     (a->'price_payload') is not distinct from (b->'price_payload') and
     (a->'notes') is not distinct from (b->'notes') then
    return new;
  end if;
  eid := coalesce(a->>'id',b->>'id',a->>'customer_key',b->>'customer_key',a->>'item_key',b->>'item_key');
  insert into public.business_audit_log(actor_id,actor_email,entity_table,entity_id,action,before_data,after_data)
  values (auth.uid(),coalesce(auth.jwt()->>'email',current_user),tg_table_name,eid,tg_op,b,a);
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke execute on function public.write_business_audit_log() from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['approved_price_items','customer_credit_limits','payment_records','purchase_invoices'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_business_audit on public.%I',t);
      execute format('create trigger trg_business_audit after insert or update or delete on public.%I for each row execute function public.write_business_audit_log()',t);
    end if;
  end loop;
end $$;

create table if not exists public.collection_followups (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null unique,
  customer_name text not null default '',
  balance numeric(18,3) not null default 0,
  last_payment_date date,
  last_contacted_at timestamptz,
  last_contacted_by text,
  status text not null default 'due' check(status in ('due','contacted','resolved')),
  updated_at timestamptz not null default now()
);
create index if not exists collection_followups_due_idx on public.collection_followups(status,last_payment_date,balance desc);
alter table public.collection_followups enable row level security;
revoke all on public.collection_followups from anon,authenticated;
grant select on public.collection_followups to authenticated;
grant select,update on public.collection_followups to service_role;
drop policy if exists collection_followups_owner_select on public.collection_followups;
create policy collection_followups_owner_select on public.collection_followups for select to authenticated
using (lower(coalesce((select auth.jwt())->>'email','')) in ('ozk.kh@outlook.com','ozkkhalouf@gmail.com'));

create or replace function public.refresh_collection_followups()
returns void language plpgsql security definer set search_path=public
as $$
declare items jsonb;
begin
  select r.items into items from public.inventory_reports r
  where r.source='ameen_customer_balances' order by r.created_at desc limit 1;
  if jsonb_typeof(items) is distinct from 'array' then return; end if;
  insert into public.collection_followups(customer_key,customer_name,balance,last_payment_date,status,updated_at)
  select coalesce(nullif(e->>'key',''),e->>'name'),coalesce(e->>'name',''),coalesce(nullif(e->>'balance','')::numeric,0),
         nullif(e->>'lastPaymentDate','')::date,
         case when coalesce(nullif(e->>'balance','')::numeric,0)>0 then 'due' else 'resolved' end,now()
  from jsonb_array_elements(items) e where coalesce(e->>'key',e->>'name') is not null
  on conflict(customer_key) do update set customer_name=excluded.customer_name,balance=excluded.balance,
    last_payment_date=excluded.last_payment_date,
    status=case when excluded.balance<=0 then 'resolved'
                when collection_followups.last_contacted_at>now()-interval '3 days' then 'contacted' else 'due' end,
    updated_at=now();
end;
$$;
revoke execute on function public.refresh_collection_followups() from public,anon,authenticated;

create or replace function public.send_collection_followups()
returns void language plpgsql security definer set search_path=public
as $$
declare r record;
begin
  perform public.refresh_collection_followups();
  for r in select * from public.collection_followups
    where status='due' and balance>0
      and (last_payment_date is null or last_payment_date<=current_date-3)
      and (last_contacted_at is null or last_contacted_at<now()-interval '3 days')
    order by balance desc limit 20
  loop
    perform public.notify_telegram('collection_followup',
      '📞 متابعة تحصيل مطلوبة'||chr(10)||'الزبون: '||r.customer_name||chr(10)||
      'الرصيد: $ '||to_char(r.balance,'FM999,999,999,990.00')||chr(10)||
      'آخر دفعة: '||coalesce(to_char(r.last_payment_date,'DD-MM-YYYY'),'غير مسجلة'),
      'collection:'||r.id::text||':'||current_date::text,1200,
      jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(
        jsonb_build_object('text','✅ تم التواصل','callback_data','collect|done|'||r.id::text)
      ))));
  end loop;
end;
$$;
revoke execute on function public.send_collection_followups() from public,anon,authenticated;

do $$ declare jid bigint; begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into jid from cron.job where jobname='ozk-collection-followups' limit 1;
    if jid is not null then perform cron.unschedule(jid); end if;
    perform cron.schedule('ozk-collection-followups','15 6 * * *','select public.send_collection_followups();');
  end if;
end $$;
