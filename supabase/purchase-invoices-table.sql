-- ============================================================
-- OZK TOBACCO — جدول فواتير المشتريات (طلبات الشراء من الموردين)
-- تسجيل داخلي فقط — لا يُزامَن مع الأمين ولا يُصدَّر إلى أي مكان.
-- ملاحظة: طُبّق على قاعدة Supabase بتاريخ 2026-07-11 (migration: create_purchase_invoices).
-- هذا الملف نسخة مرجعية — شغّله في Supabase → SQL Editor فقط إذا أعدت إنشاء القاعدة.
-- ============================================================

create table if not exists purchase_invoices (
  id            uuid          default gen_random_uuid() primary key,
  supplier_name text          not null default '',
  order_date    date          not null default current_date,
  status        text          not null default 'open' check (status in ('open', 'received')),
  items         jsonb         not null default '[]',
  total         numeric(15,2) not null default 0 check (total >= 0),
  notes         text          default '',
  created_by    uuid          references auth.users(id) on delete set null,
  created_at    timestamptz   default now(),
  updated_at    timestamptz   default now()
);

comment on table purchase_invoices is 'فواتير طلبات المشتريات من الموردين — للتسجيل الداخلي فقط، لا تُنزَّل إلى الأمين';

create index if not exists idx_purchase_invoices_created_at
  on purchase_invoices (created_at desc);

create index if not exists idx_purchase_invoices_supplier
  on purchase_invoices (supplier_name);

alter table purchase_invoices enable row level security;

-- الموظفون المسجّلون فقط (لا وصول للزوار)
create policy "authenticated can select purchase_invoices"
  on purchase_invoices for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert purchase_invoices"
  on purchase_invoices for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated can update purchase_invoices"
  on purchase_invoices for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "authenticated can delete purchase_invoices"
  on purchase_invoices for delete
  using (auth.role() = 'authenticated');
