-- ============================================================
-- OZK TOBACCO — جدول الأسعار المعتمدة
-- شغّل هذا الملف في Supabase → SQL Editor → New query
-- ============================================================

-- ── جدول الأسعار المعتمدة ───────────────────────────────────
create table if not exists approved_price_items (
  id                  uuid        default gen_random_uuid() primary key,
  item_key            text        not null unique,
  item_name           text        not null,
  sale_price          numeric(15,2) not null default 0 check (sale_price >= 0),
  unit1_price         numeric(15,2) not null default 0 check (unit1_price >= 0),
  unit1_name          text        default '',
  unit2_name          text        default '',
  unit2_factor        numeric(10,2) not null default 1 check (unit2_factor > 0),
  unit2_price         numeric(15,2) not null default 0 check (unit2_price >= 0),
  stock_qty           numeric(15,2) not null default 0,
  stock_status        text        default 'active',
  source_report_id    text        default '',
  source_synced_at    timestamptz,
  price_payload       jsonb       default '{}',
  notes               text        default '',
  created_by          uuid        references auth.users(id) on delete set null,
  approved_at         timestamptz default now(),
  updated_at          timestamptz default now()
);

-- إنشء فهارس للبحث السريع
create index if not exists idx_approved_price_items_item_key
  on approved_price_items (item_key);

create index if not exists idx_approved_price_items_item_name
  on approved_price_items (item_name);

create index if not exists idx_approved_price_items_updated_at
  on approved_price_items (updated_at desc);

-- تفعيل Row Level Security
alter table approved_price_items enable row level security;

-- ── السياسات: جميع الموظفين المسجلين بقدرتهم يشوفوا الأسعار ──
-- المستخدمون المسجلون يقرؤون جميع الأسعار
create policy "authenticated can select all approved_price_items"
  on approved_price_items for select
  using (auth.role() = 'authenticated');

-- المستخدمون المسجلون بقدرتهم يضيفوا أسعار
create policy "authenticated can insert approved_price_items"
  on approved_price_items for insert
  with check (auth.role() = 'authenticated');

-- المستخدمون المسجلون بقدرتهم يعدّلوا الأسعار
create policy "authenticated can update approved_price_items"
  on approved_price_items for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- المستخدمون المسجلون بقدرتهم يحذفوا الأسعار
create policy "authenticated can delete approved_price_items"
  on approved_price_items for delete
  using (auth.role() = 'authenticated');
