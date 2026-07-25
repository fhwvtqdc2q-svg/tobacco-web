-- ============================================================
-- OZK TOBACCO — جدول الأسعار المعتمدة
-- بناء **أول مرة فقط** على قاعدة جديدة. شغّله في Supabase → SQL Editor.
--
-- ⚠️ لا يحذف شيئاً ولا يعدّل شيئاً قائماً: إن كان الجدول موجوداً أصلاً يرفض
-- التنفيذ ويتوقف. لإضافة عمود أو تعديل سياسة على قاعدة عاملة استعمل ملف ترحيل
-- إضافي (مثال: approved-prices-item-code.sql) ولا تلمس هذا الملف.
--
-- تاريخ الحاجز: 2026-07-25. قبله كان الملف يبدأ بـ
--   drop table if exists approved_price_items cascade;
-- والجدول يحتوي 316 صفاً حياً — فتشغيله بالخطأ كان يمحو أسعار كل الأصناف،
-- ويحذف معها بـCASCADE توابعَ لا يعيد هذا الملف إنشاءها إطلاقاً:
--   واجهات:  approved_price_sync_feed · available_price_sync_feed · bot_health_alerts
--   triggers: trg_notify_price_changes · trg_notify_new_price_items · trg_notify_stock_alerts
-- أي أن نشرات أسعار الزبائن وإشعارات تيليغرام كانت ستتوقف حتى إعادة بنائها يدوياً.
-- لذلك أُزيل drop نهائياً، ويرفض الحاجز التنفيذ عند وجود الجدول **مهما كان عدد
-- صفوفه** — لأن التوابع قائمة بصرف النظر عن الصفوف.
-- ============================================================

-- ── متطلّب مسبق: دالة صلاحية الموظفين ──────────────────────────────────────
-- سياسات هذا الجدول تعتمد is_staff() التي تقرأ جدول staff_allowlist. على قاعدة
-- جديدة يجب إنشاؤهما أولاً، وإلا فشل إنشاء السياسات برسالة غامضة.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'is_staff' and n.nspname = 'public'
  ) then
    raise exception
      'أوقفت التنفيذ: الدالة public.is_staff() غير موجودة. أنشئ جدول staff_allowlist والدالة is_staff() أولاً، فسياسات هذا الجدول تعتمد عليها.';
  end if;
end $$;

-- ── حاجز أمان: يرفض التنفيذ إن كان الجدول موجوداً ──────────────────────────
do $$
declare
  row_count bigint;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'approved_price_items'
  ) then
    execute 'select count(*) from public.approved_price_items' into row_count;
    raise exception
      'أوقفت التنفيذ: الجدول approved_price_items موجود مسبقاً (% صفاً). هذا الملف للبناء الأول فقط، وتشغيله على جدول قائم يمحو الأسعار ويحذف واجهات المزامنة وtriggers الإشعارات. لتعديل قاعدة عاملة استعمل ملف ترحيل إضافي.',
      row_count;
  end if;
end $$;

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

-- الموظفون المسموحون فقط — مطابقة حرفياً لما في الإنتاج (qual = is_staff()).
-- لا تستعمل «using (true)»: فهي تسمح لأي حساب authenticated بقراءة الأسعار
-- وتعديلها وحذفها، لا للموظفين المسجّلين في staff_allowlist وحدهم.
-- ونشر الأسعار للعامة يتم عبر واجهة price_sync_feed المخصّصة لذلك لا عبر الجدول.
create policy "approved_price_items_staff_select" on approved_price_items
  for select to authenticated using (is_staff());
create policy "approved_price_items_staff_insert" on approved_price_items
  for insert to authenticated with check (is_staff());
create policy "approved_price_items_staff_update" on approved_price_items
  for update to authenticated using (is_staff()) with check (is_staff());
create policy "approved_price_items_staff_delete" on approved_price_items
  for delete to authenticated using (is_staff());

create index idx_item_key on approved_price_items(item_key);
create index idx_item_name on approved_price_items(item_name);
create index idx_item_code on approved_price_items(item_code);
