-- ============================================================
-- OZK TOBACCO — جدول الأسعار المعتمدة
-- شغّل هذا الملف في Supabase → SQL Editor → New query
-- ============================================================

drop table if exists approved_price_items cascade;

create table approved_price_items (
  id                uuid          primary key default gen_random_uuid(),
  item_key          text          unique not null,
  item_name         text          not null,
  sale_price        numeric       default 0,
  unit1_price       numeric       default 0,
  unit1_name        text          default '',
  unit2_name        text          default '',
  unit2_factor      numeric       default 1,
  unit2_price       numeric       default 0,
  stock_qty         numeric       default 0,
  stock_status      text          default 'active',
  source_report_id  text,
  source_synced_at  timestamptz,
  price_payload     jsonb         default '{}',
  notes             text          default '',
  approved_by       uuid,
  approved_at       timestamptz   default now(),
  updated_at        timestamptz   default now()
);

alter table approved_price_items enable row level security;

-- جميع الموظفين المسجلين يقرؤون ويعدّلون الأسعار (تظهر للأمين تلقائياً)
create policy "allow_select" on approved_price_items for select using (true);
create policy "allow_insert" on approved_price_items for insert with check (true);
create policy "allow_update" on approved_price_items for update using (true) with check (true);
create policy "allow_delete" on approved_price_items for delete using (true);

create index idx_item_key on approved_price_items(item_key);
create index idx_item_name on approved_price_items(item_name);
