-- مرجعي فقط: لا يُطبّق تلقائياً على Supabase الحي قبل مراجعة PR #40.
-- تقرير مناقلات مستودعات Ameen للعرض والمطابقة فقط. لا يكتب أي حركة إلى Ameen.

begin;

do $$
begin
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'أوقفت التنفيذ: الدالة public.is_staff() غير موجودة. طبّق staff_allowlist ودالة is_staff() أولاً.';
  end if;
end
$$;

create table if not exists public.ameen_warehouse_transfer_reports (
  id uuid default gen_random_uuid() primary key,
  report_date date not null default current_date,
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.ameen_warehouse_transfer_reports is
  'تقارير قراءة فقط لمناقلات المستودعات من Ameen؛ كل مناقلة موثقة بمصدر ووجهة وبنود متوازنة.';
comment on column public.ameen_warehouse_transfer_reports.items is
  'مصفوفة المناقلات: transferKey, number, date, family, source/destination warehouse GUID/name, items.';

create index if not exists ameen_warehouse_transfer_reports_created_at_idx
  on public.ameen_warehouse_transfer_reports (created_at desc);

alter table public.ameen_warehouse_transfer_reports enable row level security;

revoke all on table public.ameen_warehouse_transfer_reports from public, anon, authenticated;
grant select, insert, delete on table public.ameen_warehouse_transfer_reports to authenticated;

create or replace function public.ameen_warehouse_transfer_reports_is_sync_writer()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid() = '9724dbe4-ecb0-49f7-a6b4-12f7f73c68f3'::uuid;
$$;

revoke execute on function public.ameen_warehouse_transfer_reports_is_sync_writer() from public, anon;
grant execute on function public.ameen_warehouse_transfer_reports_is_sync_writer() to authenticated;

drop policy if exists "authenticated can select ameen warehouse transfers"
  on public.ameen_warehouse_transfer_reports;
create policy "authenticated can select ameen warehouse transfers"
  on public.ameen_warehouse_transfer_reports
  for select to authenticated
  using (public.is_staff());

drop policy if exists "sync writer can insert ameen warehouse transfers"
  on public.ameen_warehouse_transfer_reports;
create policy "sync writer can insert ameen warehouse transfers"
  on public.ameen_warehouse_transfer_reports
  for insert to authenticated
  with check (
    public.ameen_warehouse_transfer_reports_is_sync_writer()
    and created_by = auth.uid()
  );

drop policy if exists "sync writer can delete old ameen warehouse transfers"
  on public.ameen_warehouse_transfer_reports;
create policy "sync writer can delete old ameen warehouse transfers"
  on public.ameen_warehouse_transfer_reports
  for delete to authenticated
  using (public.ameen_warehouse_transfer_reports_is_sync_writer());

-- لا UPDATE: التقارير لا تُعدّل. DELETE خاص بعامل المزامنة لتنظيف التقارير القديمة.
commit;
