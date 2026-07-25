-- ============================================================
-- OZK TOBACCO — جدول الأسعار المعتمدة (بناء من الصفر فقط)
-- شغّل هذا الملف في Supabase → SQL Editor → New query
--
-- ⚠️ هذا الملف يبني الجدول من الصفر ويحذف الموجود. لا يُشغَّل على قاعدة فيها
-- أسعار. الحاجز أدناه يوقف التنفيذ تلقائياً إن كان الجدول يحتوي صفوفاً، لأن
-- تشغيله بالخطأ كان سيمحو أسعار كل الأصناف بلا رجعة.
--
-- لإضافة عمود أو تعديل سياسة على قاعدة عاملة: استعمل ملف ترحيل إضافي
-- (مثال: approved-prices-item-code.sql) ولا تلمس هذا الملف.
-- ============================================================

-- ── حاجز أمان: يمنع محو أسعار قائمة ────────────────────────────────────────
-- يرفع استثناءً فيُلغى السكربت كله (السكربت يُنفَّذ في معاملة واحدة)، فلا يصل
-- التنفيذ إلى drop table. أُضيف بعد أن تبيّن أن الملف كان بلا أي حاجز
-- ويحتوي 316 صفاً حياً في الإنتاج (2026-07-25).
do $$
declare
  row_count bigint;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'approved_price_items'
  ) then
    execute 'select count(*) from public.approved_price_items' into row_count;
    if row_count > 0 then
      raise exception
        'أوقفت التنفيذ: الجدول approved_price_items يحتوي % صفاً وتشغيل هذا الملف يمحوها. لبناء قاعدة جديدة من الصفر: خذ نسخة احتياطية أولاً ثم احذف كتلة الحاجز يدوياً.',
        row_count;
    end if;
  end if;
end $$;

drop table if exists approved_price_items cascade;

create table approved_price_items (
  id                uuid          primary key default gen_random_uuid(),
  item_key          text          unique not null,
  item_name         text          not null,
  -- رقمان مختلفان من بطاقة صنف الأمين — انظر approved-prices-item-code.sql:
  --   item_code   = mt000.Code   (كود البطاقة الذي يقرأه المالك: 0000، 1111، 24007)
  --   item_number = mt000.Number (الترقيم الداخلي التسلسلي)
  item_code         text,
  item_number       text,
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

-- الموظفون المسجّلون فقط. مطابقة لما في الإنتاج فعلاً (approved_price_items_staff_*):
-- السياسات القديمة في هذا الملف كانت «using (true)» بلا تحديد دور، أي تُمنح لدور
-- public فينكشف الجدول لدور anon عبر REST. الجدول يجب أن يحجب anon؛ ونشر الأسعار
-- للعامة يتم عبر واجهة price_sync_feed المخصّصة لذلك لا عبر هذا الجدول.
create policy "approved_price_items_staff_select" on approved_price_items
  for select to authenticated using (true);
create policy "approved_price_items_staff_insert" on approved_price_items
  for insert to authenticated with check (true);
create policy "approved_price_items_staff_update" on approved_price_items
  for update to authenticated using (true) with check (true);
create policy "approved_price_items_staff_delete" on approved_price_items
  for delete to authenticated using (true);

create index idx_item_key on approved_price_items(item_key);
create index idx_item_name on approved_price_items(item_name);
create index idx_item_code on approved_price_items(item_code);
