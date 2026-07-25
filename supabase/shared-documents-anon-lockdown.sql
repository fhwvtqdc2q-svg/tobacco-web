-- ============================================================
-- OZK TOBACCO — إغلاق تسريب أرشيف المستندات (shared_documents)
-- تاريخ التنفيذ الحي: 2026-07-25
--
-- الثغرة: السياسة القديمة كانت
--     create policy "shared_docs_read" on shared_documents
--       for select to anon, authenticated using (true);
--   أي أن أي حامل للمفتاح العام (وهو منشور في src/config.js ويصل لكل زائر)
--   يسرد الأرشيف كاملاً بطلب واحد. أُثبت عملياً قبل الإصلاح: 194 مستنداً
--   بأسماء زبائن ومبالغ فواتير وأرصدة، بلا أي تسجيل دخول.
--
-- سبب وجودها: receipt.html يفتح وصل الزبون برابط بلا تسجيل دخول، فاحتاج قراءة
--   بدور anon — لكن الشرط كُتب true («اقرأ كل شيء») بدل «اقرأ المطلوب بمعرّفه».
--
-- الحل: قراءة الجدول للموظفين فقط، ووصول الزبون عبر دالة تُرجع مستنداً واحداً
--   برمز public_token ولا تسرد ولا تبحث.
--
-- الملف idempotent: يُعاد تطبيقه بأمان على قاعدة نُفِّذ عليها أصلاً.
-- ============================================================

-- ── 1) إغلاق القراءة المباشرة أمام anon ─────────────────────────────────────
drop policy if exists "shared_docs_read" on public.shared_documents;

drop policy if exists "shared_documents_staff_select" on public.shared_documents;
create policy "shared_documents_staff_select" on public.shared_documents
  for select to authenticated using (public.is_staff());

-- ── 1-ب) سحب امتيازات الجدول — دفاع بالعمق ──────────────────────────────────
-- حذف السياسة وحده لا يكفي: anon كان يملك من منح Supabase الافتراضي امتيازات
-- الجدول كاملة (SELECT, INSERT, UPDATE, DELETE, TRUNCATE). RLS يحجبها ما دامت
-- لا سياسة له، لكن أي تعطيل عارض لـRLS أو أي سياسة متساهلة لاحقاً تعيد
-- الانكشاف فوراً. لذلك يُسحب الامتياز نفسه لا السياسة فقط.
revoke all privileges on table public.shared_documents from anon;
-- وسحب من PUBLIC أيضاً: منح PUBLIC يورَّث لكل الأدوار بما فيها anon، فلا يكفي
-- سحب الامتياز من anon وحده.
revoke all privileges on table public.shared_documents from public;

-- authenticated: القراءة والإدراج فقط — وهما ما تسمح به السياسات فعلاً.
-- UPDATE/DELETE/TRUNCATE محجوبة بالسياسات أصلاً فسحبها لا يغيّر سلوكاً.
revoke all privileges on table public.shared_documents from authenticated;
grant select, insert on table public.shared_documents to authenticated;

-- RLS يجب أن يبقى مفعّلاً: بدونه يتجاوز منح authenticated سياسة is_staff().
alter table public.shared_documents enable row level security;

-- عمداً بلا FORCE ROW LEVEL SECURITY: FORCE يُخضع مالك الجدول (postgres) للسياسات
-- أيضاً، وهو الدور الذي تُنفَّذ به الهجرات وكتلة التحقّق أدناه — فيصبح فحص
-- «صفوف بلا رمز» يقرأ صفراً دائماً ويعطي نجاحاً كاذباً، وقد تتعطّل صيانة أخرى.
-- ولا يضيف حماية أمام anon/authenticated: كلاهما ليس المالك، فالسياسات تسري
-- عليهما أصلاً. المالك وservice_role موثوقان بحكم التصميم.

-- ── 2) رمز مشاركة قوي يُولَّد في القاعدة ────────────────────────────────────
-- id الحالي نصّي: substr(gen_random_uuid(),1,10) = 10 خانات hex = 40 بت فقط،
-- دون معيار الرمز السرّي. public_token رمز UUID كامل (122 بت)، فريد وNOT NULL.
-- id يبقى مفتاحاً داخلياً ولا يُستعمل رمز مشاركة بعد اليوم.
alter table public.shared_documents
  add column if not exists public_token uuid not null default gen_random_uuid();

alter table public.shared_documents
  drop constraint if exists shared_documents_public_token_key;
alter table public.shared_documents
  add constraint shared_documents_public_token_key unique (public_token);

-- ── 3) الدالة: مستند واحد بالرمز — لا سرد ولا بحث ──────────────────────────
-- SECURITY DEFINER لتتجاوز RLS بعد إقفال الجدول.
-- search_path = pg_catalog, pg_temp عمداً (لا public): الجدول مؤهَّل صراحةً وكل
-- الأنواع والدوال المستعملة من pg_catalog، فلا يمكن تظليل أي اسم داخل دالة
-- تعمل بصلاحية المالك.
-- ترجع doc وحده — لا public_token ولا id ولا created_by ولا أي صف آخر.
-- بلا SQL ديناميكي وبلا limit/order/like، فالتعداد والحقن مستحيلان عبرها.
create or replace function public.get_shared_document(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_doc  jsonb;
  v_uuid uuid;
  -- مسار التوافق: للمستندات المنشأة قبل هذا التاريخ فقط…
  c_legacy_docs_before constant timestamptz := timestamptz '2026-07-26 00:00:00+00';
  -- …ويُغلق قطعياً بعد 30 يوماً. بعدها تُعاد مشاركة أي وصل قديم برابط جديد.
  c_legacy_expires_at  constant timestamptz := timestamptz '2026-08-24 00:00:00+00';
begin
  if p_token is null or length(btrim(p_token)) < 10 then
    return null;
  end if;

  -- المسار المعتمد: رمز UUID. إن كان النص UUID صالحاً فلا يُجرَّب المسار القديم
  -- إطلاقاً — فلا خلط بين الرمزين ولا رجوع من أحدهما إلى الآخر.
  begin
    v_uuid := btrim(p_token)::uuid;
  exception when others then
    v_uuid := null;
  end;

  if v_uuid is not null then
    select d.doc into v_doc
      from public.shared_documents d
     where d.public_token = v_uuid;
    return v_doc;
  end if;

  if now() >= c_legacy_expires_at then
    return null;
  end if;

  select d.doc into v_doc
    from public.shared_documents d
   where d.id = btrim(p_token)
     and d.created_at < c_legacy_docs_before;

  return v_doc;
end;
$function$;

-- ── 4) الصلاحيات: anon وحده ─────────────────────────────────────────────────
revoke all on function public.get_shared_document(text) from public;
revoke all on function public.get_shared_document(text) from anon;
revoke all on function public.get_shared_document(text) from authenticated;
grant execute on function public.get_shared_document(text) to anon;

comment on function public.get_shared_document(text) is
  'ترجع مستند مشاركة واحداً بـpublic_token (أو id قديم حتى 2026-08-24 للمستندات المنشأة قبل 2026-07-26). لا تسرد ولا تبحث. EXECUTE لـanon فقط.';

-- ── 5) تحقّق ذاتي بعد التطبيق ───────────────────────────────────────────────
-- يعتمد التحقّق has_table_privilege / has_function_privilege لا الفهارس الوصفية:
-- هذه الدوال تحسم الامتياز الفعّال بما فيه الموروث عبر PUBLIC أو عضوية الأدوار،
-- بينما information_schema.role_table_grants قد لا يُظهره فيعطي نجاحاً كاذباً.
do $$
declare
  n_anon_policy int;
  n_null_tok    int;
  v_fn          oid;
  p             text;
begin
  -- (أ) لا سياسة تمنح anon أو PUBLIC على الجدول
  select count(*) into n_anon_policy from pg_policies
   where schemaname = 'public' and tablename = 'shared_documents'
     and ('anon' = any (roles) or 'public' = any (roles));
  if n_anon_policy > 0 then
    raise exception 'ما زالت هناك سياسة تمنح anon/public على shared_documents.';
  end if;

  -- (ب) RLS مفعّل — بدونه تتجاوز المنوحُ السياساتِ كلها
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'shared_documents'
                    and c.relrowsecurity) then
    raise exception 'RLS غير مفعّل على shared_documents — المنوح تتجاوز السياسات.';
  end if;

  -- (ج) anon بلا أي امتياز فعّال على الجدول.
  -- has_table_privilege تحسم الامتياز الفعّال بما فيه الموروث عبر PUBLIC أو عضوية
  -- الأدوار، فلا حاجة لتعداد مصادر المنح. ويُفحص مستوى العمود مستقلاً لأن منح
  -- الأعمدة لا يسقط بالضرورة مع revoke على مستوى الجدول.
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('anon', 'public.shared_documents', p) then
      raise exception 'anon ما زال يملك امتياز % على shared_documents.', p;
    end if;
  end loop;
  foreach p in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
    if has_any_column_privilege('anon', 'public.shared_documents', p) then
      raise exception 'anon يملك امتياز % على مستوى عمود في shared_documents.', p;
    end if;
  end loop;

  -- (د) authenticated محصور فعلياً بـSELECT وINSERT
  foreach p in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.shared_documents', p) then
      raise exception 'authenticated يملك امتياز % الزائد على shared_documents.', p;
    end if;
  end loop;
  if not (has_table_privilege('authenticated', 'public.shared_documents', 'SELECT')
      and has_table_privilege('authenticated', 'public.shared_documents', 'INSERT')) then
    raise exception 'authenticated فقد SELECT/INSERT — الموظفون لن يروا الأرشيف.';
  end if;

  -- (هـ) كل الصفوف لها رمز، والعمود ما زال NOT NULL وبقيمة افتراضية من القاعدة
  select count(*) into n_null_tok from public.shared_documents where public_token is null;
  if n_null_tok > 0 then
    raise exception 'يوجد % صفاً بلا public_token.', n_null_tok;
  end if;
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.shared_documents'::regclass
       and a.attname = 'public_token' and a.attnotnull
  ) then
    raise exception 'العمود public_token لم يعد NOT NULL.';
  end if;
  if not exists (
    select 1 from pg_attrdef ad join pg_attribute a
      on a.attrelid = ad.adrelid and a.attnum = ad.adnum
     where ad.adrelid = 'public.shared_documents'::regclass
       and a.attname = 'public_token'
       and pg_get_expr(ad.adbin, ad.adrelid) like '%gen_random_uuid%'
  ) then
    raise exception 'العمود public_token بلا قيمة افتراضية تولّد UUID.';
  end if;

  -- (و) الدالة بتوقيعها الكامل، ولا نسخة أخرى بالاسم نفسه قد تُمنح بغير قصد
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_shared_document') <> 1 then
    raise exception 'يوجد أكثر من نسخة من public.get_shared_document — راجع الصلاحيات لكلٍّ منها.';
  end if;
  v_fn := to_regprocedure('public.get_shared_document(text)');
  if v_fn is null then
    raise exception 'الدالة public.get_shared_document(text) غير موجودة.';
  end if;
  if not has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon لا يملك EXECUTE على get_shared_document(text).';
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'authenticated ما زال يملك EXECUTE على get_shared_document(text).';
  end if;

  raise notice 'تحقّق ناجح: لا سياسة ولا امتياز لـanon، وكل الصفوف لها public_token، والدالة ممنوحة لـanon.';
end $$;

-- ============================================================
-- ما بعد 2026-08-24: مسار ?id= القديم يُغلق تلقائياً بالتاريخ داخل الدالة.
-- يُستحسن عندها حذف الفرع القديم من الدالة نهائياً لتبسيطها.
-- ============================================================
