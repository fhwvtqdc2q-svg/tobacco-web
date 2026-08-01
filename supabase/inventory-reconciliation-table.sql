-- ============================================================
-- OZK TOBACCO — الجرد الشهري (تسوية المخزون) — مقترح مخطط فقط
-- ملف مرجعي غير مُطبَّق على أي قاعدة إنتاج بعد. لا تُشغّله على Supabase
-- إلا بعد مراجعة صريحة من صاحب الحساب (ozk.kh@outlook.com).
--
-- "تسجيلي فقط" (registration-only): اعتماد جلسة الجرد يقفل السجل فقط
-- (status='approved') ولا يغيّر أي مخزون أو حساب في الأمين أو Supabase.
-- انظر tools/push-inventory-reconciliation-to-ameen.ps1 (stub مقفل).
-- ============================================================

create table if not exists inventory_recon_sessions (
  id             uuid          default gen_random_uuid() primary key,
  session_date   date          not null default current_date,
  session_month  date          not null,
  warehouse_key  text          not null,
  warehouse_name text          not null,
  status         text          not null default 'draft' check (status in ('draft', 'reviewed', 'approved')),
  idempotency_key text         not null,
  source_report_id   uuid      references inventory_reports(id) on delete set null,
  source_report_date timestamptz,
  notes          text,
  created_by     uuid          references auth.users(id) on delete set null,
  created_at     timestamptz   default now(),
  updated_at     timestamptz   default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid          references auth.users(id) on delete set null,
  approved_at    timestamptz,
  approved_by    uuid          references auth.users(id) on delete set null,
  unique (created_by, idempotency_key)
);

comment on table inventory_recon_sessions is 'جلسات الجرد الشهري — تسجيل داخلي فقط، لا تُزامَن مع الأمين ولا تُغيّر مخزوناً';
comment on column inventory_recon_sessions.created_by is 'مالك المسودة — يُختم تلقائياً من auth.uid() عند الإنشاء ولا يمكن تعديله لاحقاً';
comment on column inventory_recon_sessions.reviewed_by is 'من راجع الجلسة (draft → reviewed) — يُختم من الخادم فقط';
comment on column inventory_recon_sessions.approved_by is 'من اعتمد الجلسة (reviewed → approved) — يُختم من الخادم فقط، وحصراً لحساب المالك';
comment on column inventory_recon_sessions.source_report_id is 'تقرير مخزون المستودع الموثوق (inventory_reports.source=ameen_warehouse_stock) الذي استُخرجت منه كمية النظام وهوية الأصناف داخل RPC — بلا اعتماد على أي قيمة يرسلها المتصفح مباشرة. on delete set null لأن أرشفة/حذف تقرير قديم يجب ألا يكسر جلسة جرد تاريخية';
comment on column inventory_recon_sessions.source_report_date is 'تاريخ/وقت التقرير المصدر وقت إنشاء الجلسة — يُحفظ منفصلاً كي يبقى معروفاً حتى لو حُذف صف inventory_reports لاحقاً (source_report_id يصبح NULL بـon delete set null)';
comment on constraint inventory_recon_sessions_created_by_idempotency_key_key on inventory_recon_sessions is 'التفرد على (created_by, idempotency_key) لا على idempotency_key وحده — كان تفرداً عاماً يسمح نظرياً بأن يستلم مستخدم جلسة مستخدم آخر عند تصادم نصي للمفتاح';

create table if not exists inventory_recon_lines (
  id               uuid          default gen_random_uuid() primary key,
  session_id       uuid          not null references inventory_recon_sessions(id) on delete cascade,
  item_key         text          not null check (trim(item_key) <> ''),
  item_number      text,
  item_name        text          not null check (trim(item_name) <> ''),
  unit_name        text,
  system_qty       numeric(18,3) not null default 0,
  actual_qty       numeric(18,3) check (actual_qty is null or actual_qty >= 0),
  diff_qty         numeric(18,3) generated always as (
                     case when actual_qty is null then null else actual_qty - system_qty end
                   ) stored,
  unit_cost        numeric(18,4) check (unit_cost is null or unit_cost >= 0),
  currency         text          default 'USD' check (currency in ('USD', 'SYP')),
  settlement_value numeric(18,2) generated always as (
                     case when actual_qty is null then null else (actual_qty - system_qty) * coalesce(unit_cost, 0) end
                   ) stored,
  reason           text,
  created_at       timestamptz   default now(),
  updated_at       timestamptz   default now(),
  unique (session_id, item_key)
);

comment on table inventory_recon_lines is 'سطور الجرد لكل صنف — الفرق والقيمة تقديريان لأغراض العرض والتقرير فقط، لا يُنشأ منهما أي قيد محاسبي';
comment on constraint inventory_recon_lines_item_key_check on inventory_recon_lines is 'يمنع مفتاح صنف فارغ/مسافات فقط — حماية على مستوى القاعدة بعد أن كان not null وحده يسمح بقيمة نصية فارغة';
comment on constraint inventory_recon_lines_item_name_check on inventory_recon_lines is 'يمنع اسم صنف فارغ/مسافات فقط لنفس السبب';
comment on constraint inventory_recon_lines_actual_qty_check on inventory_recon_lines is 'يمنع كمية فعلية سالبة — دفاع مستوى قاعدة بيانات مستقل عن أي تحقق في الواجهة';
comment on constraint inventory_recon_lines_unit_cost_check on inventory_recon_lines is 'يمنع تكلفة وحدة سالبة لنفس السبب';
comment on constraint inventory_recon_lines_currency_check on inventory_recon_lines is 'قائمة العملات المسموحة USD/SYP فقط — نفس نمط purchase_invoices_currency_check في purchase-invoices-ameen-sync.sql';

-- session_id/line_id بلا foreign key عمداً: سجل التدقيق يجب أن يبقى دائماً
-- حتى بعد حذف الجلسة/السطر التي يوثّقها. لو كانا مرتبطين بـFK فسيفشل DELETE
-- (الـtrigger يحاول إدخال سطر تدقيق بعد الحذف يشير لصف لم يعد موجوداً)، وأي
-- FK بـon delete cascade كان سيمحو تاريخ التدقيق نفسه عند حذف الجلسة — وهذا
-- يناقض الغرض من وجود سجل تدقيق دائم. المعرّف الكامل محفوظ أيضاً داخل
-- before_data/after_data (to_jsonb) لمن يحتاج لقراءته بعد حذف الصف الأصلي.
create table if not exists inventory_recon_audit_log (
  id          bigint generated always as identity primary key,
  session_id  uuid,
  line_id     uuid,
  actor       text,
  action      text not null,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz default now()
);

comment on table inventory_recon_audit_log is 'سجل تدقيق لتغييرات جلسات وسطور الجرد — يُملأ حصراً من triggers، لا يقبل إدخالاً مباشراً من العميل، ويبقى بعد حذف الجلسة/السطر (بلا FK) لأنه سجل تاريخي دائم';
comment on column inventory_recon_audit_log.session_id is 'معرف الجلسة وقت الحدث — بلا FK عمداً كي لا يُحذف سجل التدقيق مع الجلسة';
comment on column inventory_recon_audit_log.line_id is 'معرف السطر وقت الحدث — بلا FK عمداً لنفس السبب';

create index if not exists idx_inventory_recon_sessions_date
  on inventory_recon_sessions (session_date desc);

create index if not exists idx_inventory_recon_sessions_month_warehouse
  on inventory_recon_sessions (session_month, warehouse_key);

create index if not exists idx_inventory_recon_lines_session
  on inventory_recon_lines (session_id);

create index if not exists idx_inventory_recon_audit_log_session
  on inventory_recon_audit_log (session_id);

-- ============================================================
-- دالة المالك — نفس نمط purchase_invoices_is_owner() في
-- purchase-invoices-ameen-sync.sql، وتطابق OWNER_EMAILS في src/app.js
-- سطر ~498 (نفس القائمة المستعملة لبوابات واجهة أخرى مثل item_costs).
-- بلا SECURITY DEFINER: تقرأ فقط auth.jwt() الخاص بالجلسة الحالية.
-- ============================================================

create or replace function inventory_recon_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') in ('ozk.kh@outlook.com', 'ozkkhalouf@gmail.com');
$$;

-- ============================================================
-- حارس الثبات + الختم: يمنع أي تعديل بعد status='approved'، يقفل
-- created_by ضد الانتحال، يختم reviewed_by/approved_by من الخادم حصراً
-- عند الانتقال الفعلي فقط، ويمنع الاعتماد قبل اكتمال كل سطر (كمية فعلية
-- + سبب) لأي فرق غير صفري.
-- (نفس فكرة purchase_invoice_guard_immutable_and_stamp في
-- purchase-invoices-ameen-sync.sql)
-- ============================================================

create or replace function inventory_recon_guard_immutable()
returns trigger as $$
declare
  status_rank constant jsonb := '{"draft": 0, "reviewed": 1, "approved": 2}';
  old_rank int;
  new_rank int;
  incomplete_count int;
begin
  if OLD.status = 'approved' then
    raise exception 'inventory_recon_sessions: session % is approved and cannot be modified or deleted', OLD.id;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  if NEW.created_by is distinct from OLD.created_by then
    raise exception 'inventory_recon_sessions: created_by لا يمكن تعديله بعد الإنشاء';
  end if;

  if NEW.status is distinct from OLD.status then
    old_rank := (status_rank ->> OLD.status)::int;
    new_rank := (status_rank ->> NEW.status)::int;
    if new_rank is null or new_rank <> old_rank + 1 then
      raise exception 'inventory_recon_sessions: invalid status transition % -> % for session %', OLD.status, NEW.status, OLD.id;
    end if;

    if OLD.status = 'draft' and NEW.status = 'reviewed' then
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    elsif OLD.status = 'reviewed' and NEW.status = 'approved' then
      if not inventory_recon_is_owner() then
        raise exception 'inventory_recon_sessions: اعتماد الجلسة محصور بحساب المالك';
      end if;

      if not exists (select 1 from inventory_recon_lines where session_id = OLD.id) then
        raise exception 'inventory_recon_sessions: لا يمكن اعتماد جلسة بلا أي سطر';
      end if;

      select count(*) into incomplete_count
      from inventory_recon_lines
      where session_id = OLD.id
        and diff_qty is distinct from 0
        and (actual_qty is null or reason is null or trim(reason) = '');
      if incomplete_count > 0 then
        raise exception 'inventory_recon_sessions: % سطر بلا كمية فعلية أو سبب لفرق غير صفري — لا يمكن الاعتماد', incomplete_count;
      end if;

      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    end if;
  else
    if NEW.reviewed_by is distinct from OLD.reviewed_by or NEW.reviewed_at is distinct from OLD.reviewed_at then
      raise exception 'inventory_recon_sessions: reviewed_by/reviewed_at لا يمكن تعديلهما إلا عند انتقال draft→reviewed نفسه';
    end if;
    if NEW.approved_by is distinct from OLD.approved_by or NEW.approved_at is distinct from OLD.approved_at then
      raise exception 'inventory_recon_sessions: approved_by/approved_at لا يمكن تعديلهما إلا عند انتقال reviewed→approved نفسه';
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_inventory_recon_guard_session on inventory_recon_sessions;
create trigger trg_inventory_recon_guard_session
  before update or delete on inventory_recon_sessions
  for each row
  execute function inventory_recon_guard_immutable();

create or replace function inventory_recon_guard_lines_immutable()
returns trigger as $$
declare
  session_status text;
begin
  select status into session_status
  from inventory_recon_sessions
  where id = coalesce(NEW.session_id, OLD.session_id);

  if session_status is distinct from 'draft' then
    raise exception 'inventory_recon_lines: parent session % is not a draft (status=%) — its lines are locked', coalesce(NEW.session_id, OLD.session_id), session_status;
  end if;

  return coalesce(NEW, OLD);
end;
$$ language plpgsql;

drop trigger if exists trg_inventory_recon_guard_lines on inventory_recon_lines;
create trigger trg_inventory_recon_guard_lines
  before insert or update or delete on inventory_recon_lines
  for each row
  execute function inventory_recon_guard_lines_immutable();

-- ============================================================
-- سجل التدقيق: يُملأ حصراً من trigger عبر دالة SECURITY DEFINER
-- (تعمل بصلاحيات مالك الدالة فتتجاوز RLS)، لا إدخال مباشر من العميل.
--
-- الدالة منقولة إلى مخطط private (لا public): PostgREST/Data API لا يُعرِّض
-- إلا الدوال في الـschema المُعرَّف بـ"exposed schemas" (public افتراضياً)،
-- فوضعها خارج public يمنعها من الأساس من الظهور كـRPC قابل للاستدعاء من
-- العميل — طبقة حماية أقوى من revoke execute وحدها (وهي مُبقاة أيضاً هنا
-- كدفاع مضاعف على مستوى الدور، لأن أي اتصال SQL مباشر بصلاحيات كافية ما زال
-- يستطيع رؤية الدالة عبر تأهيل الاسم الكامل). الـtriggers تستدعيها بالاسم
-- الكامل private.inventory_recon_write_audit_log() فتستمر بالعمل بلا تغيير.
-- ============================================================

create schema if not exists private;

create or replace function private.inventory_recon_write_audit_log()
returns trigger as $$
begin
  insert into inventory_recon_audit_log(session_id, line_id, actor, action, before_data, after_data)
  values (
    case when TG_TABLE_NAME = 'inventory_recon_sessions' then coalesce(NEW.id, OLD.id)
         else coalesce(NEW.session_id, OLD.session_id) end,
    case when TG_TABLE_NAME = 'inventory_recon_lines' then coalesce(NEW.id, OLD.id) else null end,
    auth.uid()::text,
    TG_OP,
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer set search_path = public;

-- SECURITY DEFINER تعمل بصلاحيات مالكها بغض النظر عن EXECUTE — لا يحتاجها
-- العميل عبر RPC مباشر (يُستدعى فقط من الـtriggers)، فنسحب الصلاحية الافتراضية
-- من public/anon/authenticated لتضييق سطح الهجوم كدفاع إضافي رغم أنها لم تعد
-- في schema معروض أصلاً.
revoke execute on function private.inventory_recon_write_audit_log() from public;
revoke execute on function private.inventory_recon_write_audit_log() from anon, authenticated;

drop trigger if exists trg_inventory_recon_audit_sessions on inventory_recon_sessions;
create trigger trg_inventory_recon_audit_sessions
  after insert or update or delete on inventory_recon_sessions
  for each row
  execute function private.inventory_recon_write_audit_log();

drop trigger if exists trg_inventory_recon_audit_lines on inventory_recon_lines;
create trigger trg_inventory_recon_audit_lines
  after insert or update or delete on inventory_recon_lines
  for each row
  execute function private.inventory_recon_write_audit_log();

-- ============================================================
-- RLS — القراءة متاحة لكل مستخدم authenticated، والتعديل/الاعتماد
-- محصوران بمنشئ الجلسة (مسودته فقط) أو حساب المالك.
-- ============================================================

alter table inventory_recon_sessions enable row level security;
alter table inventory_recon_lines enable row level security;
alter table inventory_recon_audit_log enable row level security;

create policy "inventory_recon_sessions_select"
  on inventory_recon_sessions for select
  to authenticated
  using (true);

create policy "inventory_recon_sessions_insert"
  on inventory_recon_sessions for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "inventory_recon_sessions_update"
  on inventory_recon_sessions for update
  to authenticated
  using (
    status <> 'approved'
    and (created_by = auth.uid() or inventory_recon_is_owner())
  )
  with check (
    inventory_recon_is_owner()
    or (created_by = auth.uid() and status in ('draft', 'reviewed'))
  );

create policy "inventory_recon_sessions_delete"
  on inventory_recon_sessions for delete
  to authenticated
  using (
    status <> 'approved'
    and (
      (status = 'draft' and created_by = auth.uid())
      or inventory_recon_is_owner()
    )
  );

create policy "inventory_recon_lines_select"
  on inventory_recon_lines for select
  to authenticated
  using (true);

create policy "inventory_recon_lines_write"
  on inventory_recon_lines for all
  to authenticated
  using (
    exists (
      select 1 from inventory_recon_sessions s
      where s.id = inventory_recon_lines.session_id
        and s.status = 'draft'
        and (s.created_by = auth.uid() or inventory_recon_is_owner())
    )
  )
  with check (
    exists (
      select 1 from inventory_recon_sessions s
      where s.id = inventory_recon_lines.session_id
        and s.status = 'draft'
        and (s.created_by = auth.uid() or inventory_recon_is_owner())
    )
  );

create policy "inventory_recon_audit_log_select"
  on inventory_recon_audit_log for select
  to authenticated
  using (true);

-- ملاحظة: لا توجد policy إدخال/تعديل/حذف لـinventory_recon_audit_log —
-- الكتابة الوحيدة المسموحة تمر عبر inventory_recon_write_audit_log()
-- (SECURITY DEFINER)، فأي محاولة إدخال مباشر من العميل تُرفض تلقائياً.

-- ============================================================
-- GRANT صريحة — دفاع مستوى ثانٍ مستقل عن RLS، ونفس السبب العملي المذكور في
-- purchase-invoices-ameen-sync.sql: مشاريع Supabase الحديثة لا تُعرِّض الجداول
-- المُنشأة تلقائياً لـData API/PostgREST بدون GRANT صريحة لأي دور، حتى مع
-- RLS مفعّلة وصحيحة — فتفشل استدعاءات supabase-js بخطأ لا علاقة له بالسياسات.
-- ============================================================

grant select, insert, update, delete on inventory_recon_sessions to authenticated;
grant select, insert, update, delete on inventory_recon_lines to authenticated;
grant select on inventory_recon_audit_log to authenticated;

-- ============================================================
-- إنشاء الجلسة وسطورها في معاملة واحدة ذرية: بدون هذه الدالة، createReconSession
-- ثم saveReconLines طلبان منفصلان من العميل — فشل الثاني (انقطاع شبكة، إلخ)
-- يترك جلسة فارغة محفوظة بلا سطور تظهر في السجل. security invoker (الافتراضي)
-- عمداً: الإدخالان يمران عبر RLS بصلاحيات المستخدم الحالي نفسها كما لو استُدعيا
-- منفصلين — لا تجاوز صلاحيات، فقط ذرية على مستوى المعاملة.
--
-- ثقة البيانات: النسخة السابقة كانت تقبل system_qty وunit_cost وهوية الصنف
-- (item_number/item_name/unit_name) كما يرسلها المتصفح حرفياً — أي مستخدم
-- authenticated كان يستطيع نظرياً تمرير كمية نظام أو تكلفة مفبركة عبر RPC
-- مباشرة (تجاوز الواجهة). الآن: p_source_report_id يُحدَّد بمعرف تقرير
-- inventory_reports (source='ameen_warehouse_stock') الذي حمّلته الواجهة أصلاً،
-- والدالة تتحقق من صحته ومطابقة مستودعه محلياً هنا، ثم تشتق system_qty
-- وitem_number/item_name/unit_name من items الخاصة بالتقرير نفسه — لا من
-- p_lines. العميل يرسل فقط item_key (لتحديد أي صنف) وactual_qty وreason.
-- unit_cost يُشتق من item_costs (مطابقة اسم دقيقة على item_name الموثوق من
-- التقرير، لا مما يرسله العميل) ويبقى NULL إن لم توجد تكلفة مسجّلة — لا بديل
-- عن تكلفة يرسلها المتصفح.
-- ============================================================

create or replace function inventory_recon_create_session_with_lines(
  p_session_date date,
  p_session_month date,
  p_warehouse_key text,
  p_warehouse_name text,
  p_notes text,
  p_idempotency_key text,
  p_source_report_id uuid,
  p_lines jsonb
)
returns inventory_recon_sessions
language plpgsql
as $$
declare
  v_session inventory_recon_sessions;
  v_existing inventory_recon_sessions;
  v_report_summary jsonb;
  v_report_items jsonb;
  v_report_date timestamptz;
  v_missing_keys text;
  v_new_digest text;
  v_existing_digest text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'inventory_recon: لا يمكن إنشاء جلسة جرد بلا سطور';
  end if;

  if p_source_report_id is null then
    raise exception 'inventory_recon: يجب اختيار تقرير مخزون مستودع موثوق قبل إنشاء الجلسة';
  end if;

  select report_date::timestamptz, summary, items
    into v_report_date, v_report_summary, v_report_items
  from inventory_reports
  where id = p_source_report_id
    and source = 'ameen_warehouse_stock';

  if not found then
    raise exception 'inventory_recon: تقرير مخزون المستودع (%) غير موجود أو ليس من مصدر موثوق', p_source_report_id;
  end if;

  if coalesce(v_report_summary ->> 'warehouseKey', '') <> p_warehouse_key then
    raise exception 'inventory_recon: تقرير المخزون المحدد لا يطابق المستودع المختار (%)', p_warehouse_key;
  end if;

  if v_report_items is null or jsonb_typeof(v_report_items) <> 'array' then
    raise exception 'inventory_recon: تقرير مخزون المستودع لا يحوي بيانات أصناف صالحة';
  end if;

  -- محتوى الطلب (item_key + actual_qty + reason فقط — هذا ما يملكه العميل
  -- فعلياً) يُستخدم لبناء بصمة idempotency ولمقارنة أي تكرار لاحقاً بنفس المفتاح.
  select md5(string_agg(
           coalesce(line ->> 'item_key', '') || '|' ||
           coalesce(line ->> 'actual_qty', '') || '|' ||
           coalesce(line ->> 'reason', ''),
           E'\n' order by line ->> 'item_key'
         ))
    into v_new_digest
  from jsonb_array_elements(p_lines) as line;

  -- تحقق أن كل item_key أرسله العميل موجود فعلاً في التقرير الموثوق —
  -- وإلا يُرفض الطلب بالكامل بدل تجاهل السطر المجهول بصمت.
  select string_agg(k, ', ')
    into v_missing_keys
  from (
    select distinct line ->> 'item_key' as k
    from jsonb_array_elements(p_lines) as line
    where not exists (
      select 1
      from jsonb_array_elements(v_report_items) as it
      where coalesce(it ->> 'itemKey', it ->> 'item_key') = (line ->> 'item_key')
    )
  ) missing;

  if v_missing_keys is not null then
    raise exception 'inventory_recon: الأصناف التالية غير موجودة في تقرير المستودع الموثوق: %', v_missing_keys;
  end if;

  -- idempotency: التفرد على (created_by, idempotency_key) — لا يمكن أبداً
  -- أن نرجع جلسة مستخدم آخر. عند تكرار المفتاح لنفس المستخدم نتحقق أن
  -- المستودع/الشهر/التقرير المصدر/محتوى السطور مطابقة تماماً؛ خلاف ذلك نرفض
  -- بخطأ واضح بدل نجاح وهمي يعيد جلسة قديمة لا تطابق الطلب الجديد.
  select * into v_existing
  from inventory_recon_sessions
  where created_by = auth.uid()
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.warehouse_key is distinct from p_warehouse_key
       or v_existing.session_month is distinct from p_session_month
       or v_existing.source_report_id is distinct from p_source_report_id
    then
      raise exception 'inventory_recon: مفتاح idempotency % مستخدم مسبقاً لجلسة مختلفة (مستودع/شهر/تقرير مصدر مختلف) — أعد تحميل الصفحة وحاول من جديد', p_idempotency_key;
    end if;

    select md5(string_agg(
             coalesce(item_key, '') || '|' ||
             coalesce(actual_qty::text, '') || '|' ||
             coalesce(reason, ''),
             E'\n' order by item_key
           ))
      into v_existing_digest
    from inventory_recon_lines
    where session_id = v_existing.id;

    if v_existing_digest is distinct from v_new_digest then
      raise exception 'inventory_recon: مفتاح idempotency % مستخدم مسبقاً بمحتوى سطور مختلف — أعد تحميل الصفحة وحاول من جديد', p_idempotency_key;
    end if;

    return v_existing;
  end if;

  insert into inventory_recon_sessions
    (session_date, session_month, warehouse_key, warehouse_name, notes, idempotency_key,
     source_report_id, source_report_date, status, created_by)
  values
    (p_session_date, p_session_month, p_warehouse_key, p_warehouse_name, p_notes, p_idempotency_key,
     p_source_report_id, v_report_date, 'draft', auth.uid())
  returning * into v_session;

  insert into inventory_recon_lines
    (session_id, item_key, item_number, item_name, unit_name, system_qty, actual_qty, unit_cost, currency, reason)
  select
    v_session.id,
    it ->> 'itemKey' as item_key,
    coalesce(it ->> 'itemNumber', it ->> 'item_number') as item_number,
    coalesce(it ->> 'itemName', it ->> 'item_name') as item_name,
    coalesce(it ->> 'unitName', it ->> 'unit_name') as unit_name,
    coalesce((coalesce(it ->> 'qty', it ->> 'stockQty', it ->> 'stock_qty'))::numeric, 0) as system_qty,
    nullif(line ->> 'actual_qty', '')::numeric as actual_qty,
    (
      select ic.avg_cost
      from item_costs ic
      where lower(trim(ic.item_name)) = lower(trim(coalesce(it ->> 'itemName', it ->> 'item_name', '')))
      limit 1
    ) as unit_cost,
    coalesce(
      (select ic.currency
       from item_costs ic
       where lower(trim(ic.item_name)) = lower(trim(coalesce(it ->> 'itemName', it ->> 'item_name', '')))
       limit 1),
      'USD'
    ) as currency,
    line ->> 'reason' as reason
  from jsonb_array_elements(p_lines) as line
  join jsonb_array_elements(v_report_items) as it
    on coalesce(it ->> 'itemKey', it ->> 'item_key') = (line ->> 'item_key');

  return v_session;
end;
$$;

-- دفاع مستوى ثانٍ صريح قبل GRANT الضيق: CREATE FUNCTION يمنح EXECUTE لـPUBLIC
-- تلقائياً في PostgreSQL ما لم تُسحب صراحة — نفس النمط المطبَّق أعلاه على
-- inventory_recon_write_audit_log().
revoke execute on function inventory_recon_create_session_with_lines(date, date, text, text, text, text, uuid, jsonb) from public;
revoke execute on function inventory_recon_create_session_with_lines(date, date, text, text, text, text, uuid, jsonb) from anon;
grant execute on function inventory_recon_create_session_with_lines(date, date, text, text, text, text, uuid, jsonb) to authenticated;
