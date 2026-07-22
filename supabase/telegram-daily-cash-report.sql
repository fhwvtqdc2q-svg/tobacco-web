-- Daily cashbox addendum for the 23:00 Damascus evening Telegram report.
-- Reads the latest Supabase presentation snapshot only; it never writes to
-- or connects to Al-Ameen SQL.

create or replace function public.send_evening_cash_report()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today text := to_char(current_date, 'YYYY-MM-DD');
  movement_payload jsonb;
  box jsonb;
  currency_label text;
  msg text;
begin
  select payload
  into movement_payload
  from public.daily_movement_reports
  where report_date = current_date
  order by created_at desc
  limit 1;

  if movement_payload is null
     or jsonb_typeof(coalesce(movement_payload->'cashboxes', 'null'::jsonb)) <> 'array' then
    perform public.notify_telegram(
      'evening_cash_report',
      '⚠️ لم يصل تقرير حركة الصناديق من جهاز الأمين — ' || today,
      'evening-cash-missing:' || today,
      720
    );
    return;
  end if;

  msg := '🏦 حركة الصناديق ونهاية اليوم — ' || today || chr(10);
  for box in
    select value from jsonb_array_elements(movement_payload->'cashboxes')
  loop
    currency_label := coalesce(nullif(box->>'currency', ''), '$');
    msg := msg || chr(10)
      || coalesce(nullif(box->>'name', ''), nullif(box->>'code', ''), 'صندوق') || chr(10)
      || '• بداية اليوم: ' || to_char(coalesce(nullif(box->>'opening','')::numeric, 0), 'FM999,999,999,990.##') || ' ' || currency_label || chr(10)
      || '• الوارد من العمل: ' || to_char(coalesce(nullif(box->>'externalIncoming','')::numeric, 0), 'FM999,999,999,990.##') || ' ' || currency_label || chr(10)
      || case when coalesce(nullif(box->>'transferIn','')::numeric, 0) <> 0
           then '• مناقلات داخلة: ' || to_char((box->>'transferIn')::numeric, 'FM999,999,999,990.##') || ' ' || currency_label || chr(10)
           else '' end
      || '• الصادر للعمل: ' || to_char(coalesce(nullif(box->>'externalOutgoing','')::numeric, 0), 'FM999,999,999,990.##') || ' ' || currency_label || chr(10)
      || case when coalesce(nullif(box->>'transferOut','')::numeric, 0) <> 0
           then '• مناقلات خارجة: ' || to_char((box->>'transferOut')::numeric, 'FM999,999,999,990.##') || ' ' || currency_label || chr(10)
           else '' end
      || '• نهاية الصندوق: ' || to_char(coalesce(nullif(box->>'closing','')::numeric, 0), 'FM999,999,999,990.##') || ' ' || currency_label || chr(10);
  end loop;

  msg := msg || chr(10) || 'المناقلات مفصولة حتى لا تُحتسب مرتين ضمن الوارد والصادر.';
  perform public.notify_telegram(
    'evening_cash_report',
    msg,
    'evening-cash:' || today,
    720
  );
end;
$$;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'send-evening-cash-report' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end;
$$;

select cron.schedule(
  'send-evening-cash-report',
  '2 20 * * *',
  'select public.send_evening_cash_report();'
);


