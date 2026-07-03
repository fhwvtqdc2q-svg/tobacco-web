-- ============================================================
-- نظام إشعارات تيليغرام الشامل — OZK TOBACCO
-- نسخة مرجعية — طُبّقت على Supabase كـ migration باسم:
--   telegram_notifications_system (2026-07-03)
--
-- البنية:
--   telegram_outbox            قائمة انتظار الإشعارات
--   notify_telegram(...)       دالة إدراج إشعار (مع منع تكرار)
--   dispatch_telegram_outbox() المُرسِل — pg_cron كل دقيقة عبر pg_net
--   triggers                   على جداول كل المجالات
--
-- المتطلبات المسبقة (موجودة من نظام التذكيرات السابق):
--   vault.secrets: telegram_bot_token
--   bot_config: owner_chat_id
--   امتدادات pg_cron + pg_net مفعّلة
--
-- حد تنبيه انخفاض المخزون: القيمة الافتراضية 50 (تُزرع أدناه في bot_config).
-- لتغييره لاحقاً إلى قيمة أخرى (مثال: 30):
--   update bot_config set value = '30' where key = 'low_stock_threshold';
-- ============================================================

-- 1) جدول صادرات الإشعارات
create table if not exists public.telegram_outbox (
  id          bigint generated always as identity primary key,
  event_type  text not null,
  message     text not null,
  dedupe_key  text,
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts    int  not null default 0,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists telegram_outbox_pending_idx on public.telegram_outbox (status, created_at);
create index if not exists telegram_outbox_dedupe_idx  on public.telegram_outbox (dedupe_key, created_at desc) where dedupe_key is not null;
alter table public.telegram_outbox enable row level security;
comment on table public.telegram_outbox is 'قائمة انتظار إشعارات تيليغرام — يرسلها dispatch_telegram_outbox كل دقيقة';

-- 2) دالة إدراج إشعار (مع منع التكرار خلال نافذة زمنية)
create or replace function public.notify_telegram(
  p_event_type     text,
  p_message        text,
  p_dedupe_key     text default null,
  p_dedupe_minutes int  default 60
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_message is null or length(trim(p_message)) = 0 then return; end if;
  if p_dedupe_key is not null and exists (
    select 1 from public.telegram_outbox
    where dedupe_key = p_dedupe_key
      and created_at > now() - make_interval(mins => greatest(p_dedupe_minutes, 1))
  ) then
    return;
  end if;
  insert into public.telegram_outbox (event_type, message, dedupe_key)
  values (p_event_type, left(p_message, 3900), p_dedupe_key);
end;
$$;
revoke execute on function public.notify_telegram(text, text, text, int) from public;
revoke execute on function public.notify_telegram(text, text, text, int) from anon;
grant  execute on function public.notify_telegram(text, text, text, int) to authenticated, service_role;

-- 3) المُرسِل — نفس نمط dispatch_due_reminders (Vault + pg_net)
create or replace function public.dispatch_telegram_outbox()
returns void
language plpgsql security definer
set search_path to 'public', 'net', 'vault', 'extensions'
as $$
declare
  r    record;
  tok  text;
  chat bigint;
begin
  select decrypted_secret into tok
  from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  if tok is null then return; end if;

  select value::bigint into chat
  from public.bot_config where key = 'owner_chat_id' limit 1;
  if chat is null then return; end if;

  for r in
    select id, message from public.telegram_outbox
    where status = 'pending'
    order by created_at asc
    limit 20  -- ضمن حدود تيليغرام
  loop
    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || tok || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('chat_id', chat, 'text', r.message)
    );
    update public.telegram_outbox
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    where id = r.id;
  end loop;
end;
$$;

-- 4) الجدولة: إرسال كل دقيقة + تنظيف يومياً
select cron.schedule('dispatch-telegram-outbox', '* * * * *', 'select public.dispatch_telegram_outbox();');
select cron.schedule('cleanup-telegram-outbox', '30 0 * * *',
  $cron$delete from public.telegram_outbox where status <> 'pending' and created_at < now() - interval '14 days'$cron$);

-- 5) حد تنبيه انخفاض المخزون (قابل للتعديل من bot_config)
insert into public.bot_config (key, value)
values ('low_stock_threshold', '50')
on conflict (key) do nothing;

-- ============================================================
-- Triggers — مجال: طلبات واتساب
-- ============================================================
create or replace function public.tg_notify_whatsapp_order()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_telegram(
    'whatsapp_order',
    '🛒 طلب واتساب جديد' || chr(10)
    || 'الزبون: ' || coalesce(new.customer_name, new.phone_number, 'غير معروف')
    || case when new.region is not null and new.region <> '' then chr(10) || 'المنطقة: ' || new.region else '' end
    || case when new.total_amount is not null then chr(10) || 'الإجمالي: ' || to_char(new.total_amount, 'FM999,999,999,990') else '' end
    || case when new.message_text is not null and new.message_text <> '' then chr(10) || 'الرسالة: ' || left(new.message_text, 200) else '' end,
    null, 0);
  return null;
end;
$$;
drop trigger if exists trg_notify_whatsapp_order on public.whatsapp_orders;
create trigger trg_notify_whatsapp_order
after insert on public.whatsapp_orders
for each row execute function public.tg_notify_whatsapp_order();

-- ============================================================
-- Triggers — مجال: طلبات العملاء (من الموقع)
-- ============================================================
create or replace function public.tg_notify_customer_request()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_telegram(
    'customer_request',
    '📩 طلب عميل جديد' || chr(10)
    || 'العميل: ' || coalesce(new.customer, 'غير محدد')
    || case when new.request_type is not null then chr(10) || 'النوع: ' || new.request_type else '' end
    || case when new.channel is not null then chr(10) || 'القناة: ' || new.channel else '' end
    || case when new.note is not null and new.note <> '' then chr(10) || 'ملاحظة: ' || left(new.note, 200) else '' end,
    null, 0);
  return null;
end;
$$;
drop trigger if exists trg_notify_customer_request on public.customer_requests;
create trigger trg_notify_customer_request
after insert on public.customer_requests
for each row execute function public.tg_notify_customer_request();

-- ============================================================
-- Triggers — مجال: الدفعات المالية
-- ============================================================
create or replace function public.tg_notify_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_telegram(
    'payment',
    '💵 دفعة جديدة' || chr(10)
    || 'العميل: ' || coalesce(new.customer_name, new.customer_key, 'غير محدد') || chr(10)
    || 'المبلغ: ' || to_char(coalesce(new.amount, 0), 'FM999,999,999,990.##')
    || case when new.payment_date is not null then chr(10) || 'التاريخ: ' || to_char(new.payment_date, 'YYYY-MM-DD') else '' end
    || case when new.notes is not null and new.notes <> '' then chr(10) || 'ملاحظة: ' || left(new.notes, 200) else '' end,
    null, 0);
  return null;
end;
$$;
drop trigger if exists trg_notify_payment on public.payment_records;
create trigger trg_notify_payment
after insert on public.payment_records
for each row execute function public.tg_notify_payment();

-- ============================================================
-- Triggers — مجال: تغييرات الأسعار (تجميع عند التعديل الجماعي)
-- ============================================================
create or replace function public.tg_notify_price_changes()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  n int;
  r record;
  msg text;
begin
  select count(*) into n
  from new_rows nw join old_rows ow using (id)
  where nw.sale_price  is distinct from ow.sale_price
     or nw.unit1_price is distinct from ow.unit1_price
     or nw.unit2_price is distinct from ow.unit2_price;

  if n = 0 then return null; end if;

  if n > 5 then
    perform public.notify_telegram('price_change',
      '💰 تعديل أسعار جماعي: تغيّرت أسعار ' || n || ' مادة',
      'price:bulk', 30);
  else
    for r in
      select nw.item_key, coalesce(nw.item_name, nw.item_key) as item_name,
             ow.sale_price as old_price, nw.sale_price as new_price
      from new_rows nw join old_rows ow using (id)
      where nw.sale_price  is distinct from ow.sale_price
         or nw.unit1_price is distinct from ow.unit1_price
         or nw.unit2_price is distinct from ow.unit2_price
    loop
      msg := '💰 تعديل سعر: ' || r.item_name;
      if r.old_price is distinct from r.new_price then
        msg := msg || chr(10) || 'السعر: '
            || coalesce(to_char(r.old_price, 'FM999,999,999,990.##'), '—')
            || ' ← '
            || coalesce(to_char(r.new_price, 'FM999,999,999,990.##'), '—');
      end if;
      perform public.notify_telegram('price_change', msg, 'price:' || r.item_key, 10);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_notify_price_changes on public.approved_price_items;
create trigger trg_notify_price_changes
after update on public.approved_price_items
referencing old table as old_rows new table as new_rows
for each statement execute function public.tg_notify_price_changes();

-- مواد جديدة تُضاف للائحة
create or replace function public.tg_notify_new_price_items()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  n int;
  r record;
begin
  select count(*) into n from new_rows;
  if n = 0 then return null; end if;
  if n > 5 then
    perform public.notify_telegram('price_item_new',
      '🆕 أُضيفت ' || n || ' مادة جديدة إلى لائحة الأسعار',
      'price-new:bulk', 30);
  else
    for r in select coalesce(item_name, item_key) as item_name, sale_price from new_rows loop
      perform public.notify_telegram('price_item_new',
        '🆕 مادة جديدة في اللائحة: ' || r.item_name
        || case when r.sale_price is not null then chr(10) || 'السعر: ' || to_char(r.sale_price, 'FM999,999,999,990.##') else '' end,
        null, 0);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_notify_new_price_items on public.approved_price_items;
create trigger trg_notify_new_price_items
after insert on public.approved_price_items
referencing new table as new_rows
for each statement execute function public.tg_notify_new_price_items();

-- ============================================================
-- Triggers — مجال: المخزون (انخفاض/نفاد — تجميع عند الدفعات)
-- ============================================================
create or replace function public.tg_notify_stock_alerts()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  thr numeric := 50;
  n_low int;
  n_out int;
  r record;
begin
  begin
    select value::numeric into thr from public.bot_config where key = 'low_stock_threshold' limit 1;
  exception when others then thr := 50;
  end;
  thr := coalesce(thr, 50);

  -- مواد نفدت (عبرت الصفر نزولاً)
  select count(*) into n_out
  from new_rows nw join old_rows ow using (id)
  where coalesce(nw.stock_qty, 0) <= 0 and coalesce(ow.stock_qty, 0) > 0;

  -- مواد قاربت النفاد (عبرت الحد نزولاً وما زالت فوق الصفر)
  select count(*) into n_low
  from new_rows nw join old_rows ow using (id)
  where nw.stock_qty is not null and nw.stock_qty > 0 and nw.stock_qty <= thr
    and (ow.stock_qty is null or ow.stock_qty > thr);

  if n_out > 5 then
    perform public.notify_telegram('stock_out', '⛔ نفدت ' || n_out || ' مادة من المخزون', 'stock-out:bulk', 60);
  elsif n_out > 0 then
    for r in
      select coalesce(nw.item_name, nw.item_key) as item_name, nw.item_key
      from new_rows nw join old_rows ow using (id)
      where coalesce(nw.stock_qty, 0) <= 0 and coalesce(ow.stock_qty, 0) > 0
    loop
      perform public.notify_telegram('stock_out', '⛔ نفدت المادة: ' || r.item_name, 'out:' || r.item_key, 360);
    end loop;
  end if;

  if n_low > 5 then
    perform public.notify_telegram('stock_low', '⚠️ ' || n_low || ' مادة قاربت النفاد (الحد: ' || thr || ')', 'stock-low:bulk', 60);
  elsif n_low > 0 then
    for r in
      select coalesce(nw.item_name, nw.item_key) as item_name, nw.item_key, nw.stock_qty
      from new_rows nw join old_rows ow using (id)
      where nw.stock_qty is not null and nw.stock_qty > 0 and nw.stock_qty <= thr
        and (ow.stock_qty is null or ow.stock_qty > thr)
    loop
      perform public.notify_telegram('stock_low',
        '⚠️ مادة قاربت النفاد: ' || r.item_name || chr(10) || 'المتبقي: ' || to_char(r.stock_qty, 'FM999,999,990.##'),
        'low:' || r.item_key, 360);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_notify_stock_alerts on public.approved_price_items;
create trigger trg_notify_stock_alerts
after update on public.approved_price_items
referencing old table as old_rows new table as new_rows
for each statement execute function public.tg_notify_stock_alerts();

-- ============================================================
-- Triggers — مجال: حدود الائتمان
-- ============================================================
create or replace function public.tg_notify_credit_limit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.credit_limit is not distinct from old.credit_limit then
    return null;
  end if;
  perform public.notify_telegram(
    'credit_limit',
    '🧾 ' || case when tg_op = 'INSERT' then 'حد ائتمان جديد' else 'تعديل حد ائتمان' end || chr(10)
    || 'العميل: ' || coalesce(new.customer_name, new.customer_key, 'غير محدد') || chr(10)
    || case when tg_op = 'UPDATE'
        then 'الحد: ' || coalesce(to_char(old.credit_limit, 'FM999,999,999,990.##'), '—') || ' ← ' || coalesce(to_char(new.credit_limit, 'FM999,999,999,990.##'), '—')
        else 'الحد: ' || coalesce(to_char(new.credit_limit, 'FM999,999,999,990.##'), '—')
       end,
    null, 0);
  return null;
end;
$$;
drop trigger if exists trg_notify_credit_limit on public.customer_credit_limits;
create trigger trg_notify_credit_limit
after insert or update on public.customer_credit_limits
for each row execute function public.tg_notify_credit_limit();

-- ============================================================
-- Triggers — مجال: التقارير اليومية
-- ============================================================
create or replace function public.tg_notify_daily_sales()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_telegram(
    'daily_sales',
    '📊 ملخص المبيعات اليومية' || chr(10)
    || 'المبيعات: '  || to_char(coalesce(new.total_sales, 0),  'FM999,999,999,990.##') || chr(10)
    || 'النقدي: '    || to_char(coalesce(new.total_cash, 0),   'FM999,999,999,990.##') || chr(10)
    || 'الآجل: '     || to_char(coalesce(new.total_credit, 0), 'FM999,999,999,990.##'),
    'sales:' || to_char(now(), 'YYYY-MM-DD'), 120);
  return null;
end;
$$;
drop trigger if exists trg_notify_daily_sales on public.daily_sales_summary;
create trigger trg_notify_daily_sales
after insert on public.daily_sales_summary
for each row execute function public.tg_notify_daily_sales();

create or replace function public.tg_notify_daily_movement()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_telegram(
    'daily_movement',
    '📈 وصل تقرير الحركة اليومية — ' || coalesce(to_char(new.report_date, 'YYYY-MM-DD'), 'بدون تاريخ'),
    'movement:' || coalesce(new.report_date::text, to_char(now(), 'YYYY-MM-DD')), 720);
  return null;
end;
$$;
drop trigger if exists trg_notify_daily_movement on public.daily_movement_reports;
create trigger trg_notify_daily_movement
after insert on public.daily_movement_reports
for each row execute function public.tg_notify_daily_movement();

-- أول تقرير جرد في اليوم = إشارة أن مزامنة الأمين تعمل
create or replace function public.tg_notify_inventory_report()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  item_count int := null;
begin
  if jsonb_typeof(new.items) = 'array' then
    item_count := jsonb_array_length(new.items);
  end if;
  perform public.notify_telegram(
    'inventory_report',
    '📦 وصل تقرير الجرد اليومي من الأمين'
    || case when item_count is not null then chr(10) || 'عدد المواد: ' || item_count else '' end,
    'inventory:' || coalesce(new.report_date::text, to_char(now(), 'YYYY-MM-DD')), 1200);
  return null;
end;
$$;
drop trigger if exists trg_notify_inventory_report on public.inventory_reports;
create trigger trg_notify_inventory_report
after insert on public.inventory_reports
for each row execute function public.tg_notify_inventory_report();

-- ============================================================
-- Triggers — مجال: أرشفة المستندات (تجميع)
-- ============================================================
create or replace function public.tg_notify_shared_documents()
returns trigger language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  select count(*) into n from new_rows;
  if n > 0 then
    perform public.notify_telegram('documents',
      '📄 أرشفة مستندات جديدة: ' || n || ' مستند',
      'docs', 30);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_notify_shared_documents on public.shared_documents;
create trigger trg_notify_shared_documents
after insert on public.shared_documents
referencing new table as new_rows
for each statement execute function public.tg_notify_shared_documents();

-- ============================================================
-- Triggers — مجال: تكاليف المواد (تجميع بإشعار واحد كل 12 ساعة)
-- ============================================================
create or replace function public.tg_notify_item_costs()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_telegram('item_costs', '🧮 تحدّثت تكاليف المواد من الأمين', 'costs', 720);
  return null;
end;
$$;
drop trigger if exists trg_notify_item_costs on public.item_costs;
create trigger trg_notify_item_costs
after insert or update on public.item_costs
for each statement execute function public.tg_notify_item_costs();
