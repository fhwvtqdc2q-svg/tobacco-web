-- ============================================================
-- OZK TOBACCO — إعداد جداول الدفعات وملفات الزبائن
-- شغّل هذا الملف في Supabase → SQL Editor → New query
-- ============================================================

-- ── 1. جدول سجلات الدفعات ──────────────────────────────────
create table if not exists payment_records (
  id            uuid        default gen_random_uuid() primary key,
  customer_key  text        not null,
  customer_name text        not null default '',
  amount        numeric(15,2) not null default 0 check (amount >= 0),
  payment_date  date        not null default current_date,
  notes         text        default '',
  created_by    uuid        references auth.users(id) on delete set null,
  created_at    timestamptz default now()
);

create index if not exists idx_payment_records_customer_key
  on payment_records (customer_key);

create index if not exists idx_payment_records_date
  on payment_records (payment_date desc);

alter table payment_records enable row level security;

-- المستخدمون المسجلون يقرؤون ويُضيفون فقط
create policy "authenticated can select payment_records"
  on payment_records for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert payment_records"
  on payment_records for insert
  with check (auth.role() = 'authenticated');


-- ── 2. جدول ملفات تعريف الزبائن ───────────────────────────
create table if not exists customer_profiles (
  id            uuid        default gen_random_uuid() primary key,
  customer_key  text        not null unique,
  customer_name text        not null default '',
  phone         text        default '',
  address       text        default '',
  notes         text        default '',
  updated_by    uuid        references auth.users(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table customer_profiles enable row level security;

create policy "authenticated can select customer_profiles"
  on customer_profiles for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert customer_profiles"
  on customer_profiles for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated can update customer_profiles"
  on customer_profiles for update
  using (auth.role() = 'authenticated');
