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

-- ============================================================
-- Triggers — مجال: مخاطر حدود الائتمان (تجاوز/اقتراب 90%)
-- يُفحص عند وصول تقرير الأرصدة من الأمين (source=ameen_customer_balances)
-- الدالة لا ترمي استثناء أبداً كي لا تكسر إدراج تقرير المزامنة.
-- (مطبَّقة كـ migration باسم credit_limit_risk_alerts)
-- ============================================================
create or replace function public.tg_notify_credit_risk()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  r record;
  n_over int := 0;
  n_near int := 0;
begin
  if new.source is distinct from 'ameen_customer_balances'
     or jsonb_typeof(new.items) is distinct from 'array' then
    return null;
  end if;

  select
    count(*) filter (where bal >= lim) as c_over,
    count(*) filter (where bal >= lim * 0.9 and bal < lim) as c_near
  into n_over, n_near
  from (
    select coalesce(nullif(e->>'balance','')::numeric, 0) as bal,
           coalesce(nullif(e->>'creditLimit','')::numeric, 0) as lim
    from jsonb_array_elements(new.items) e
  ) t
  where lim > 0;

  if n_over > 8 then
    perform public.notify_telegram('credit_over',
      '🚫 ' || n_over || ' زبون تجاوزوا حد الائتمان — راجع تقرير الأرصدة',
      'creditover:bulk', 360);
  elsif n_over > 0 then
    for r in
      select e->>'name' as name,
             coalesce(nullif(e->>'balance','')::numeric, 0) as bal,
             coalesce(nullif(e->>'creditLimit','')::numeric, 0) as lim
      from jsonb_array_elements(new.items) e
      where coalesce(nullif(e->>'creditLimit','')::numeric, 0) > 0
        and coalesce(nullif(e->>'balance','')::numeric, 0) >= coalesce(nullif(e->>'creditLimit','')::numeric, 0)
      limit 8
    loop
      perform public.notify_telegram('credit_over',
        '🚫 تجاوز حد الائتمان' || chr(10)
        || 'الزبون: ' || coalesce(r.name, 'غير معروف') || chr(10)
        || 'الرصيد: ' || to_char(r.bal, 'FM999,999,999,990.##')
        || ' / الحد: ' || to_char(r.lim, 'FM999,999,999,990.##'),
        'creditover:' || coalesce(r.name, '?'), 360);
    end loop;
  end if;

  if n_near > 8 then
    perform public.notify_telegram('credit_near',
      '⚠️ ' || n_near || ' زبون اقتربوا من حد الائتمان (90%+)',
      'creditnear:bulk', 360);
  elsif n_near > 0 then
    for r in
      select e->>'name' as name,
             coalesce(nullif(e->>'balance','')::numeric, 0) as bal,
             coalesce(nullif(e->>'creditLimit','')::numeric, 0) as lim
      from jsonb_array_elements(new.items) e
      where coalesce(nullif(e->>'creditLimit','')::numeric, 0) > 0
        and coalesce(nullif(e->>'balance','')::numeric, 0) >= coalesce(nullif(e->>'creditLimit','')::numeric, 0) * 0.9
        and coalesce(nullif(e->>'balance','')::numeric, 0) <  coalesce(nullif(e->>'creditLimit','')::numeric, 0)
      limit 8
    loop
      perform public.notify_telegram('credit_near',
        '⚠️ اقتراب من حد الائتمان' || chr(10)
        || 'الزبون: ' || coalesce(r.name, 'غير معروف') || chr(10)
        || 'الرصيد: ' || to_char(r.bal, 'FM999,999,999,990.##')
        || ' / الحد: ' || to_char(r.lim, 'FM999,999,999,990.##'),
        'creditnear:' || coalesce(r.name, '?'), 360);
    end loop;
  end if;

  return null;
exception when others then
  -- لا نكسر إدراج التقرير أبداً بسبب خطأ في التنبيه
  return null;
end;
$$;
drop trigger if exists trg_notify_credit_risk on public.inventory_reports;
create trigger trg_notify_credit_risk
after insert on public.inventory_reports
for each row execute function public.tg_notify_credit_risk();

-- ============================================================
-- إشعارات بأزرار تفاعلية (reply_markup) — أساس أزرار تجهيز/رفض الطلبات
-- (مطبَّقة كـ migration باسم morning_report_and_order_buttons)
-- ============================================================
alter table public.telegram_outbox add column if not exists reply_markup jsonb;

-- ملاحظة: الإصدار القديم notify_telegram(text,text,text,int) بلا reply_markup
-- حُذف صراحة بعد إضافة النسخة بخمسة معاملات (وإلا يصير تعارض استدعاء غامض):
--   drop function if exists public.notify_telegram(text, text, text, int);
create or replace function public.notify_telegram(
  p_event_type     text,
  p_message        text,
  p_dedupe_key     text default null,
  p_dedupe_minutes int  default 60,
  p_reply_markup   jsonb default null
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
  insert into public.telegram_outbox (event_type, message, dedupe_key, reply_markup)
  values (p_event_type, left(p_message, 3900), p_dedupe_key, p_reply_markup);
end;
$$;
revoke execute on function public.notify_telegram(text, text, text, int, jsonb) from public;
revoke execute on function public.notify_telegram(text, text, text, int, jsonb) from anon;
grant  execute on function public.notify_telegram(text, text, text, int, jsonb) to authenticated, service_role;

create or replace function public.dispatch_telegram_outbox()
returns void
language plpgsql security definer
set search_path to 'public', 'net', 'vault', 'extensions'
as $$
declare
  r    record;
  tok  text;
  chat bigint;
  body jsonb;
begin
  select decrypted_secret into tok
  from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  if tok is null then return; end if;

  select value::bigint into chat
  from public.bot_config where key = 'owner_chat_id' limit 1;
  if chat is null then return; end if;

  for r in
    select id, message, reply_markup from public.telegram_outbox
    where status = 'pending'
    order by created_at asc
    limit 20  -- ضمن حدود تيليغرام
  loop
    body := jsonb_build_object('chat_id', chat, 'text', r.message);
    if r.reply_markup is not null then
      body := body || jsonb_build_object('reply_markup', r.reply_markup);
    end if;
    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || tok || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := body
    );
    update public.telegram_outbox
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    where id = r.id;
  end loop;
end;
$$;

-- طلب واتساب جديد: أزرار تجهيز/رفض مباشرة على الإشعار
-- (زر «✅ تجهيز» → whatsapp_orders.status='processing'، «❌ رفض» → 'rejected'،
--  المعالجة الفعلية بالبوت: supabase/functions/telegram-webhook/index.ts → handleOrderAction)
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
    null, 0,
    jsonb_build_object('inline_keyboard', jsonb_build_array(jsonb_build_array(
      jsonb_build_object('text', '✅ تجهيز', 'callback_data', 'order|accept|' || new.id::text),
      jsonb_build_object('text', '❌ رفض',   'callback_data', 'order|reject|' || new.id::text)
    )))
  );
  return null;
end;
$$;

-- ============================================================
-- التقرير الصباحي — كل يوم 8:00 صباحاً (توقيت دمشق UTC+3 = 5:00 UTC)
-- ملخص + قائمة تفصيلية كاملة بالمدينين (اسم/رصيد/تاريخ وقيمة آخر دفعة)
-- مقسّمة كل 20 زبون على رسالة كي لا تتجاوز حد تيليغرام
-- (مطبَّقة كـ migration باسم morning_report_detailed_debts)
-- ============================================================
create or replace function public.send_morning_report()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  sales record;
  line_sales record;
  bal_report record;
  total_debt numeric := 0;
  debtor_count int := 0;
  over_limit_count int := 0;
  low_count int := 0;
  out_count int := 0;
  thr numeric := 50;
  msg text;
  today text := to_char(now(), 'YYYY-MM-DD');
  r record;
  chunk_no int := 0;
  chunk_lines text := '';
  line_no int := 0;
begin
  select total_sales, total_cash, total_credit, created_at
  into sales
  from public.daily_sales_summary
  order by created_at desc limit 1;

  -- daily_sales_summary ما بينزّه أي سكريبت فعلياً — نستخدم أمس من حركة
  -- الفواتير التفصيلية (sales_line_items) كبديل موثوق لو الجدول فاضي
  select count(*) as cnt, coalesce(sum(line_total),0) as rev
  into line_sales
  from public.sales_line_items
  where sale_date = current_date - 1;

  select summary, items, created_at into bal_report
  from public.inventory_reports
  where source = 'ameen_customer_balances'
  order by created_at desc limit 1;

  if bal_report.items is not null and jsonb_typeof(bal_report.items) = 'array' then
    select
      coalesce(sum(bal) filter (where bal > 0), 0),
      count(*) filter (where bal > 0),
      count(*) filter (where lim > 0 and bal >= lim)
    into total_debt, debtor_count, over_limit_count
    from (
      select coalesce(nullif(e->>'balance','')::numeric, 0) as bal,
             coalesce(nullif(e->>'creditLimit','')::numeric, 0) as lim
      from jsonb_array_elements(bal_report.items) e
    ) t;
  end if;

  begin
    select value::numeric into thr from public.bot_config where key = 'low_stock_threshold' limit 1;
  exception when others then thr := 50;
  end;
  thr := coalesce(thr, 50);

  select count(*) filter (where coalesce(stock_qty,0) > 0 and stock_qty <= thr),
         count(*) filter (where coalesce(stock_qty,0) <= 0)
  into low_count, out_count
  from public.approved_price_items;

  -- 1) رسالة الملخص
  msg := '☀️ التقرير الصباحي — ' || today || chr(10) || chr(10);

  if sales.created_at is not null then
    msg := msg || '📊 آخر مبيعات (' || to_char(sales.created_at, 'YYYY-MM-DD') || ')' || chr(10)
        || 'الإجمالي: ' || to_char(sales.total_sales, 'FM999,999,999,990.##') || ' ل.س'
        || ' — نقدي: ' || to_char(sales.total_cash, 'FM999,999,999,990.##') || ' ل.س'
        || ' — آجل: ' || to_char(sales.total_credit, 'FM999,999,999,990.##') || ' ل.س' || chr(10) || chr(10);
  elsif line_sales.cnt > 0 then
    msg := msg || '📊 مبيعات أمس (من حركة الفواتير التفصيلية)' || chr(10)
        || 'المبيعات: ' || to_char(line_sales.rev, 'FM999,999,999,990.##') || ' ل.س'
        || ' — عدد حركات البيع: ' || line_sales.cnt || chr(10) || chr(10);
  end if;

  msg := msg || '💰 الديون: ' || debtor_count || ' زبون مدين — الإجمالي ' || to_char(total_debt, 'FM999,999,999,990.##') || ' ل.س';
  if over_limit_count > 0 then msg := msg || chr(10) || '🚫 ' || over_limit_count || ' زبون متجاوز لحد الائتمان'; end if;
  if debtor_count > 0 then msg := msg || chr(10) || '👇 قائمة المدينين التفصيلية بالرسائل التالية'; end if;
  msg := msg || chr(10) || chr(10);

  msg := msg || '📦 المخزون: ';
  if out_count = 0 and low_count = 0 then
    msg := msg || 'كل شيء تمام ✅';
  else
    msg := msg || out_count || ' نافد ⛔ — ' || low_count || ' تحت الحد ⚠️ (اكتب «شو ناقص» للتفاصيل)';
  end if;

  perform public.notify_telegram('morning_report', msg, 'morning:' || today, 720);

  -- 2) قوائم تفصيلية بالمدينين — 20 زبون بكل رسالة
  if bal_report.items is not null and jsonb_typeof(bal_report.items) = 'array' then
    for r in
      select
        row_number() over (order by bal desc) as rn,
        name, bal, last_pay_date, last_pay_amt
      from (
        select
          e->>'name' as name,
          coalesce(nullif(e->>'balance','')::numeric, 0) as bal,
          e->'recentPayments'->0->>'date' as last_pay_date,
          nullif(e->'recentPayments'->0->>'amount','')::numeric as last_pay_amt
        from jsonb_array_elements(bal_report.items) e
        where coalesce(nullif(e->>'balance','')::numeric, 0) > 0
      ) x
      order by bal desc
    loop
      if line_no = 0 then
        chunk_no := chunk_no + 1;
        chunk_lines := '💰 تفاصيل الديون (' || chunk_no || ') — ' || today || chr(10) || chr(10);
      end if;
      chunk_lines := chunk_lines || r.rn || '. ' || coalesce(r.name, 'غير معروف')
          || ' — الرصيد: ' || to_char(r.bal, 'FM999,999,999,990.##') || ' ل.س';
      if r.last_pay_date is not null then
        chunk_lines := chunk_lines || chr(10) || '   آخر دفعة: '
            || coalesce(to_char(r.last_pay_amt, 'FM999,999,999,990.##'), '—') || ' ل.س'
            || ' بتاريخ ' || left(r.last_pay_date, 10);
      else
        chunk_lines := chunk_lines || chr(10) || '   لا يوجد دفعات مسجّلة';
      end if;
      chunk_lines := chunk_lines || chr(10) || chr(10);

      line_no := line_no + 1;
      if line_no >= 20 then
        perform public.notify_telegram('morning_report_debts', chunk_lines, 'morning-debts:' || today || ':' || chunk_no, 720);
        line_no := 0;
      end if;
    end loop;

    if line_no > 0 then
      perform public.notify_telegram('morning_report_debts', chunk_lines, 'morning-debts:' || today || ':' || chunk_no, 720);
    end if;
  end if;
end;
$$;

select cron.schedule('send-morning-report', '0 5 * * *', 'select public.send_morning_report();');

-- ============================================================
-- سجل تغييرات الأسعار — يُغذّى من نفس trigger تغييرات الأسعار
-- (لازم لعرض قائمة "تغييرات الأسعار اليوم" بالتقرير المسائي)
-- (مطبَّق كـ migration باسم evening_report_and_price_log)
-- ============================================================
create table if not exists public.price_change_log (
  id         bigint generated always as identity primary key,
  item_key   text,
  item_name  text,
  old_price  numeric,
  new_price  numeric,
  changed_at timestamptz not null default now()
);
create index if not exists price_change_log_changed_at_idx on public.price_change_log (changed_at);
alter table public.price_change_log enable row level security;

-- تحديث trigger تغييرات الأسعار: يسجّل كل تغيير بالسجل دائماً
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

  -- تسجيل كل تغيير بالسجل التاريخي (دائماً، بغض النظر عن حجم الدفعة)
  for r in
    select nw.item_key, coalesce(nw.item_name, nw.item_key) as item_name,
           ow.sale_price as old_price, nw.sale_price as new_price
    from new_rows nw join old_rows ow using (id)
    where nw.sale_price  is distinct from ow.sale_price
       or nw.unit1_price is distinct from ow.unit1_price
       or nw.unit2_price is distinct from ow.unit2_price
  loop
    insert into public.price_change_log (item_key, item_name, old_price, new_price)
    values (r.item_key, r.item_name, r.old_price, r.new_price);
  end loop;

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

-- ============================================================
-- التقرير المسائي — كل يوم 11:00 مساءً (توقيت دمشق UTC+3 = 20:00 UTC)
-- ملخص شامل: المبيعات، الدفعات المستلمة، الطلبات، تغييرات الأسعار، المخزون
-- + قوائم تفصيلية (كل قسم مقسّم كل 20 صف على رسالة منفصلة)
-- ============================================================
create or replace function public.send_evening_report()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  today text := to_char(now(), 'YYYY-MM-DD');
  sales record;
  line_sales record;
  bal_report record;
  low_count int := 0;
  out_count int := 0;
  thr numeric := 50;
  msg text;
  r record;
  chunk_no int;
  chunk_lines text;
  line_no int;
  cnt int;
  total_amt numeric;
  total_cartons numeric;
  no_factor_cnt int;
begin
  -- 1) رسالة الملخص العام
  select total_sales, total_cash, total_credit, created_at
  into sales
  from public.daily_sales_summary
  where created_at::date = current_date
  order by created_at desc limit 1;

  -- ملخص daily_sales_summary ما بينزّه أي سكريبت فعلياً — نستخدم
  -- حركة الفواتير التفصيلية (sales_line_items) كبديل موثوق لإجمالي اليوم
  select count(*) as cnt, coalesce(sum(line_total),0) as rev
  into line_sales
  from public.sales_line_items
  where sale_date = current_date;

  -- إجمالي الكراتين لليوم (بس المواد اللي إلها عامل تحويل معروف)
  select coalesce(sum(qty / nullif(unit2_factor, 0)), 0),
         count(*) filter (where coalesce(unit2_factor, 0) <= 0)
  into total_cartons, no_factor_cnt
  from public.sales_line_items
  where sale_date = current_date;

  begin
    select value::numeric into thr from public.bot_config where key = 'low_stock_threshold' limit 1;
  exception when others then thr := 50;
  end;
  thr := coalesce(thr, 50);

  select count(*) filter (where coalesce(stock_qty,0) > 0 and stock_qty <= thr),
         count(*) filter (where coalesce(stock_qty,0) <= 0)
  into low_count, out_count
  from public.approved_price_items;

  msg := '🌙 التقرير المسائي — ' || today || chr(10) || chr(10);

  if sales.created_at is not null then
    msg := msg || '📊 إجمالي مبيعات اليوم' || chr(10)
        || 'الإجمالي: ' || to_char(sales.total_sales, 'FM999,999,999,990.##') || ' ل.س'
        || ' — نقدي: ' || to_char(sales.total_cash, 'FM999,999,999,990.##') || ' ل.س'
        || ' — آجل: ' || to_char(sales.total_credit, 'FM999,999,999,990.##') || ' ل.س' || chr(10);
  elsif line_sales.cnt > 0 then
    msg := msg || '📊 إجمالي مبيعات اليوم (من حركة الفواتير التفصيلية)' || chr(10)
        || 'المبيعات: ' || to_char(line_sales.rev, 'FM999,999,999,990.##') || ' ل.س'
        || ' — عدد حركات البيع: ' || line_sales.cnt || chr(10);
  else
    msg := msg || '📊 لسه ما وصلت حركة مبيعات اليوم من الأمين' || chr(10) || chr(10);
  end if;

  if line_sales.cnt > 0 then
    msg := msg || '📦 الكمية: ' || to_char(total_cartons, 'FM999,999,990.##') || ' كرتونة';
    if no_factor_cnt > 0 then msg := msg || ' (+' || no_factor_cnt || ' حركة بدون عامل تحويل معروف)'; end if;
    msg := msg || chr(10) || chr(10);
  end if;

  -- دفعات اليوم: من تقرير أرصدة الأمين (recentPayments لكل زبون) — وليس
  -- من جدول payment_records اللي هو إدخال يدوي من الموقع فقط وما بيتغذّى
  -- تلقائياً من الأمين، فبيضل شبه فاضي دايماً.
  select summary, items into bal_report
  from public.inventory_reports
  where source = 'ameen_customer_balances'
  order by created_at desc limit 1;

  cnt := 0; total_amt := 0;
  if bal_report.items is not null and jsonb_typeof(bal_report.items) = 'array' then
    select count(*), coalesce(sum(amt),0) into cnt, total_amt
    from (
      select nullif(e->'recentPayments'->0->>'amount','')::numeric as amt
      from jsonb_array_elements(bal_report.items) e
      where left(e->'recentPayments'->0->>'date', 10) = to_char(current_date, 'YYYY-MM-DD')
    ) t;
  end if;
  msg := msg || '💵 الدفعات المستلمة اليوم: ' || cnt || ' دفعة — الإجمالي ' || to_char(total_amt, 'FM999,999,999,990.##') || ' ل.س' || chr(10);

  select count(*) into cnt from public.customer_requests where created_at::date = current_date;
  msg := msg || '📩 طلبات العملاء اليوم: ' || cnt;
  select count(*) into cnt from public.whatsapp_orders where created_at::date = current_date;
  if cnt > 0 then msg := msg || ' — طلبات واتساب: ' || cnt; end if;
  msg := msg || chr(10);

  select count(*) into cnt from public.price_change_log where changed_at::date = current_date;
  msg := msg || '💰 مواد تغيّر سعرها اليوم: ' || cnt || chr(10) || chr(10);

  msg := msg || '📦 المخزون الآن: ';
  if out_count = 0 and low_count = 0 then
    msg := msg || 'كل شيء تمام ✅';
  else
    msg := msg || out_count || ' نافد ⛔ — ' || low_count || ' تحت الحد ⚠️';
  end if;

  perform public.notify_telegram('evening_report', msg, 'evening:' || today, 720);

  -- 2) قائمة الدفعات المستلمة اليوم (من تقرير أرصدة الأمين، مقسّمة كل 20)
  line_no := 0; chunk_no := 0; chunk_lines := '';
  if bal_report.items is not null and jsonb_typeof(bal_report.items) = 'array' then
    for r in
      select name, amt
      from (
        select
          e->>'name' as name,
          nullif(e->'recentPayments'->0->>'amount','')::numeric as amt
        from jsonb_array_elements(bal_report.items) e
        where left(e->'recentPayments'->0->>'date', 10) = to_char(current_date, 'YYYY-MM-DD')
      ) x
      order by amt desc nulls last
    loop
      if line_no = 0 then
        chunk_no := chunk_no + 1;
        chunk_lines := '💵 تفاصيل دفعات اليوم (' || chunk_no || ') — ' || today || chr(10) || chr(10);
      end if;
      chunk_lines := chunk_lines || '• ' || coalesce(r.name, 'غير محدد')
          || ' — ' || coalesce(to_char(r.amt, 'FM999,999,999,990.##'), '—') || ' ل.س'
          || chr(10);
      line_no := line_no + 1;
      if line_no >= 20 then
        perform public.notify_telegram('evening_report_payments', chunk_lines, 'evening-pay:' || today || ':' || chunk_no, 720);
        line_no := 0;
      end if;
    end loop;
    if line_no > 0 then
      perform public.notify_telegram('evening_report_payments', chunk_lines, 'evening-pay:' || today || ':' || chunk_no, 720);
    end if;
  end if;

  -- 3) قائمة طلبات العملاء اليوم (مقسّمة كل 20)
  line_no := 0; chunk_no := 0; chunk_lines := '';
  for r in
    select customer, request_type, channel, status
    from public.customer_requests
    where created_at::date = current_date
    order by created_at asc
  loop
    if line_no = 0 then
      chunk_no := chunk_no + 1;
      chunk_lines := '📩 تفاصيل طلبات اليوم (' || chunk_no || ') — ' || today || chr(10) || chr(10);
    end if;
    chunk_lines := chunk_lines || '• ' || coalesce(r.customer, 'غير محدد')
        || case when r.request_type is not null then ' — ' || r.request_type else '' end
        || ' — ' || case when r.status = 'closed' then 'مغلق ✅' else 'مفتوح 🟡' end
        || chr(10);
    line_no := line_no + 1;
    if line_no >= 20 then
      perform public.notify_telegram('evening_report_orders', chunk_lines, 'evening-req:' || today || ':' || chunk_no, 720);
      line_no := 0;
    end if;
  end loop;
  if line_no > 0 then
    perform public.notify_telegram('evening_report_orders', chunk_lines, 'evening-req:' || today || ':' || chunk_no, 720);
  end if;

  -- 4) قائمة تغييرات الأسعار اليوم (مقسّمة كل 20)
  line_no := 0; chunk_no := 0; chunk_lines := '';
  for r in
    select item_name, old_price, new_price
    from public.price_change_log
    where changed_at::date = current_date
    order by changed_at asc
  loop
    if line_no = 0 then
      chunk_no := chunk_no + 1;
      chunk_lines := '💰 تفاصيل تغييرات الأسعار (' || chunk_no || ') — ' || today || chr(10) || chr(10);
    end if;
    chunk_lines := chunk_lines || '• ' || coalesce(r.item_name, 'غير معروف')
        || ': ' || coalesce(to_char(r.old_price, 'FM999,999,999,990.##'), '—')
        || ' ← ' || coalesce(to_char(r.new_price, 'FM999,999,999,990.##'), '—')
        || chr(10);
    line_no := line_no + 1;
    if line_no >= 20 then
      perform public.notify_telegram('evening_report_prices', chunk_lines, 'evening-prc:' || today || ':' || chunk_no, 720);
      line_no := 0;
    end if;
  end loop;
  if line_no > 0 then
    perform public.notify_telegram('evening_report_prices', chunk_lines, 'evening-prc:' || today || ':' || chunk_no, 720);
  end if;
end;
$$;

select cron.schedule('send-evening-report', '0 20 * * *', 'select public.send_evening_report();');
