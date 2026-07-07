-- ============================================================
-- OZK TOBACCO — جدول حركة المصاريف (دفعات الصرف)
-- شغّل هذا الملف في Supabase → SQL Editor → New query
--
-- يتغذّى من tools/push-expense-entries.ps1 على جهاز Windows، اللي
-- بيقرأ قيود en000 المسجّلة على حسابات المصاريف بشجرة حسابات الأمين
-- (ac000، الحساب الأب "المصاريف" GUID 6AE0066F-D39E-4805-83D5-
-- B8DA92F7D7F1) — مو نوع فاتورة منفصل، بل قيود محاسبية عادية.
--
-- مصدر قسم "🧾 المصاريف اليوم" بالتقرير المسائي (send_evening_report).
-- ============================================================

create table if not exists public.expense_entries (
  id bigserial primary key,
  entry_date date not null,
  account_name text not null,
  amount numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.expense_entries enable row level security;

create policy "expense_entries_select_authenticated" on public.expense_entries
  for select to authenticated using (true);

create policy "expense_entries_insert_authenticated" on public.expense_entries
  for insert to authenticated with check (true);

create policy "expense_entries_delete_authenticated" on public.expense_entries
  for delete to authenticated using (true);

create index if not exists idx_expense_entries_date on public.expense_entries (entry_date desc);
