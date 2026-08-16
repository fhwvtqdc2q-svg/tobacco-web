-- OZK TOBACCO — تقارير أرصدة دليل حسابات الأمين (قراءة فقط من الأمين)
-- ملف مرجعي: يطبّق على Supabase قبل تشغيل push-ameen-account-balances.ps1.

do $$
begin
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'أوقفت التنفيذ: public.is_staff() غير موجودة. طبّق staff_allowlist أولاً.';
  end if;
end
$$;

create table if not exists public.ameen_account_balance_reports (
  id uuid default gen_random_uuid() primary key,
  report_date date not null default current_date,
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.ameen_account_balance_reports is
  'لقطات قراءة فقط لأرصدة الحسابات الورقية في AmnDb002؛ لا تنفذ أي كتابة على الأمين.';
comment on column public.ameen_account_balance_reports.items is
  'حسابات ac000 الورقية: GUID، رمز، اسم، أب، مدين، دائن، رصيد Debit-Credit بعملة الأساس USD.';

create index if not exists ameen_account_balance_reports_created_at_idx
  on public.ameen_account_balance_reports (created_at desc);

alter table public.ameen_account_balance_reports enable row level security;
revoke all on table public.ameen_account_balance_reports from public, anon, authenticated;
grant select, insert, delete on table public.ameen_account_balance_reports to authenticated;

drop policy if exists "staff can select ameen account balances" on public.ameen_account_balance_reports;
create policy "staff can select ameen account balances"
  on public.ameen_account_balance_reports for select
  to authenticated
  using ((select public.is_staff()));

create or replace function public.ameen_account_balance_reports_is_sync_writer()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select auth.uid()) = '9724dbe4-ecb0-49f7-a6b4-12f7f73c68f3'::uuid;
$$;

revoke execute on function public.ameen_account_balance_reports_is_sync_writer() from public, anon;
grant execute on function public.ameen_account_balance_reports_is_sync_writer() to authenticated;

drop policy if exists "sync writer can insert ameen account balances" on public.ameen_account_balance_reports;
create policy "sync writer can insert ameen account balances"
  on public.ameen_account_balance_reports for insert
  to authenticated
  with check (
    public.ameen_account_balance_reports_is_sync_writer()
    and created_by = (select auth.uid())
  );

drop policy if exists "sync writer can delete ameen account balances" on public.ameen_account_balance_reports;
create policy "sync writer can delete ameen account balances"
  on public.ameen_account_balance_reports for delete
  to authenticated
  using (public.ameen_account_balance_reports_is_sync_writer());

-- لا توجد سياسة UPDATE: كل تشغيل ينشئ لقطة جديدة، ولا يعدّل لقطة سابقة.
