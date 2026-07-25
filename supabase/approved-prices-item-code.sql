-- ============================================================
-- OZK TOBACCO — كود صنف الأمين في جدول الأسعار المعتمدة
-- ترحيل إضافي آمن: يضيف عموداً ولا يحذف ولا يعدّل أي عمود قائم.
-- طُبّق على الإنتاج بتاريخ 2026-07-25.
-- ============================================================
--
-- لماذا عمودان لرقم الصنف؟
--   في جدول مواد الأمين (mt000) رقمان مختلفان لكل صنف:
--     Code   = كود الصنف الذي يقرأه المالك على بطاقة الصنف، ومرتّب بعائلات
--              (كل الماستر 000x، كل الغلواز 111x، كل النخلة 240xx).
--     Number = ترقيم داخلي تسلسلي حسب ترتيب إنشاء البطاقة (1..406).
--   كان الموقع يعرض Number منذ PR #20 فظهرت أرقام لا تطابق ما على البطاقة
--   (بلاغ المالك 2026-07-25: ماستر طويل ورق ظهر 134 بينما بطاقته 0000).
--   الحلّ المعتمد: عرض item_code، والبحث يقبل الرقمين كي لا يتعطّل من حفظ
--   الترقيم الداخلي القديم.
--
-- يُغذّى العمودان من tools/pull-item-numbers.ps1 على جهاز ويندوز (قراءة فقط
-- من الأمين). وحمايتهما من المسح عند حفظ الأسعار من الموقع مُنفّذة في
-- src/supabase-client.js في مساري الحفظ كليهما.

alter table public.approved_price_items
  add column if not exists item_number text;

alter table public.approved_price_items
  add column if not exists item_code text;

comment on column public.approved_price_items.item_code is
  'كود الصنف كما في الأمين (mt000.Code) — المعروض للمستخدم. يقابله item_number = mt000.Number الداخلي.';

-- تحقّق سريع بعد التشغيل: يجب أن يكون العمودان مملوءين لكل الأصناف المطابقة.
--   select count(*) as total,
--          count(*) filter (where item_code is null or item_code = '')   as missing_code,
--          count(*) filter (where item_number is null or item_number = '') as missing_number
--   from approved_price_items;
--
-- ملاحظة تحذيرية: الملف approved-prices-table.sql في هذا المجلد يبدأ بـ
-- «drop table if exists approved_price_items cascade» ولا يحتوي هذين العمودين،
-- فتشغيله على الإنتاج يمحو كل الأسعار. لا يُشغَّل إلا لبناء قاعدة جديدة من الصفر.
