-- ============================================================
-- سند القيد (Journal Entries) — مسودات محاسبية داخلية فقط
-- ممنوع منعاً باتاً: الكتابة إلى ce000, en000, أي جدول الأمين
-- ============================================================

BEGIN;

-- ======================== جدول رؤوس السندات ========================
CREATE TABLE IF NOT EXISTS public.journal_entry_headers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  reference_number varchar(60),
  operation_type varchar(30) NOT NULL DEFAULT 'general'
    CHECK (operation_type IN ('general', 'currency_transfer', 'fund_transfer')),
  description text,
  notes text,
  exchange_rate numeric(10, 2) NOT NULL DEFAULT 14500
    CHECK (exchange_rate > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ======================== جدول أسطر السندات ========================
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.journal_entry_headers(id) ON DELETE CASCADE,
  line_number smallint NOT NULL
    CHECK (line_number > 0),
  account varchar(120) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'USD'
    CHECK (currency IN ('USD', 'SYP')),
  amount numeric(15, 2) NOT NULL
    CHECK (amount > 0),
  side varchar(6) NOT NULL
    CHECK (side IN ('debit', 'credit')),
  value_in_usd numeric(15, 2) NOT NULL DEFAULT 0
    CHECK (value_in_usd >= 0),
  line_note text,
  UNIQUE (entry_id, line_number)
);

-- ======================== فهارس الأداء (بعد الجداول) ========================
CREATE INDEX IF NOT EXISTS idx_journal_headers_created_by_created_at
  ON public.journal_entry_headers(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id
  ON public.journal_entry_lines(entry_id);

-- ======================== Trigger لتحديث updated_at ========================
CREATE OR REPLACE FUNCTION public.trigger_update_journal_headers_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
 NEW.updated_at = pg_catalog.now();
 RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_update_journal_headers_timestamp()
 FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trigger_journal_headers_updated_at ON public.journal_entry_headers;
CREATE TRIGGER trigger_journal_headers_updated_at
BEFORE UPDATE ON public.journal_entry_headers
FOR EACH ROW
EXECUTE FUNCTION public.trigger_update_journal_headers_timestamp();

-- ======================== RLS على journal_entry_headers ========================
ALTER TABLE public.journal_entry_headers ENABLE ROW LEVEL SECURITY;

-- سياسة القراءة: المستخدم الموثّق يرى فقط سنداته الخاصة
DROP POLICY IF EXISTS "journal_headers_select_own" ON public.journal_entry_headers;
CREATE POLICY "journal_headers_select_own" ON public.journal_entry_headers
  FOR SELECT
  TO authenticated
  USING (created_by = (select auth.uid()));

-- سياسة الإدراج: المستخدم الموثّق يُدرج سنداً باسمه فقط
DROP POLICY IF EXISTS "journal_headers_insert_own" ON public.journal_entry_headers;
CREATE POLICY "journal_headers_insert_own" ON public.journal_entry_headers
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = (select auth.uid()));

-- سياسة التحديث: المستخدم الموثّق يحدّث سنداته فقط
DROP POLICY IF EXISTS "journal_headers_update_own" ON public.journal_entry_headers;
CREATE POLICY "journal_headers_update_own" ON public.journal_entry_headers
  FOR UPDATE
  TO authenticated
  USING (created_by = (select auth.uid()))
  WITH CHECK (created_by = (select auth.uid()));

-- سياسة الحذف: المستخدم الموثّق يحذف سنداته فقط
DROP POLICY IF EXISTS "journal_headers_delete_own" ON public.journal_entry_headers;
CREATE POLICY "journal_headers_delete_own" ON public.journal_entry_headers
  FOR DELETE
  TO authenticated
  USING (created_by = (select auth.uid()));

-- ======================== RLS على journal_entry_lines ========================
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

-- سياسة القراءة: المستخدم يرى أسطر سنداته الخاصة فقط
DROP POLICY IF EXISTS "journal_lines_select_own" ON public.journal_entry_lines;
CREATE POLICY "journal_lines_select_own" ON public.journal_entry_lines
  FOR SELECT
  TO authenticated
  USING (
    entry_id IN (
      SELECT id FROM public.journal_entry_headers WHERE created_by = (select auth.uid())
    )
  );

-- سياسة الإدراج: المستخدم يُدرج أسطراً في سنداته فقط
DROP POLICY IF EXISTS "journal_lines_insert_own" ON public.journal_entry_lines;
CREATE POLICY "journal_lines_insert_own" ON public.journal_entry_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    entry_id IN (
      SELECT id FROM public.journal_entry_headers WHERE created_by = (select auth.uid())
    )
  );

-- سياسة التحديث: المستخدم يحدّث أسطر سنداته فقط
DROP POLICY IF EXISTS "journal_lines_update_own" ON public.journal_entry_lines;
CREATE POLICY "journal_lines_update_own" ON public.journal_entry_lines
  FOR UPDATE
  TO authenticated
  USING (
    entry_id IN (
      SELECT id FROM public.journal_entry_headers WHERE created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    entry_id IN (
      SELECT id FROM public.journal_entry_headers WHERE created_by = (select auth.uid())
    )
  );

-- سياسة الحذف: المستخدم يحذف أسطر سنداته فقط
DROP POLICY IF EXISTS "journal_lines_delete_own" ON public.journal_entry_lines;
CREATE POLICY "journal_lines_delete_own" ON public.journal_entry_lines
  FOR DELETE
  TO authenticated
  USING (
    entry_id IN (
      SELECT id FROM public.journal_entry_headers WHERE created_by = (select auth.uid())
    )
  );

-- ======================== منع الوصول من PUBLIC و ANON ========================
REVOKE ALL ON public.journal_entry_headers FROM PUBLIC;
REVOKE ALL ON public.journal_entry_headers FROM ANON;
REVOKE ALL ON public.journal_entry_lines FROM PUBLIC;
REVOKE ALL ON public.journal_entry_lines FROM ANON;

-- منح الصلاحيات المطلوبة فقط للمستخدمين الموثّقين
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entry_headers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entry_lines TO authenticated;

-- ======================== RPC Atomic للحفظ الكامل للسند ========================
-- هذه الدالة توفر حفظاً ذرياً: رأس + أسطر معاً بدون فقدان البيانات
-- SECURITY INVOKER: تجري بصلاحيات المستدعي (المستخدم)، ليس صلاحيات الدالة
-- إذا فشل إدراج سطر، تُرجع كل التعديلات دون تطبيق
CREATE OR REPLACE FUNCTION public.save_journal_entry(
  p_id uuid,
  p_date date,
  p_reference_number varchar,
  p_operation_type varchar,
  p_description text,
  p_notes text,
  p_exchange_rate numeric,
  p_lines jsonb  -- مصفوفة من الأسطر: [{"account":"...", "currency":"USD", "amount":100, "side":"debit", "line_note":"", "value_in_usd":100}, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_header_id uuid;
  v_line jsonb;
  v_line_number smallint;
  v_result jsonb;
  v_uid uuid;
  v_amount numeric;
  v_exchange_rate numeric;
  v_currency text;
  v_side text;
  v_account text;
  v_line_note text;
  v_value_in_usd numeric;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_diff numeric := 0;
BEGIN
  v_uid := auth.uid();
  v_exchange_rate := p_exchange_rate;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_lines must be a JSON array';
  END IF;
  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Journal entry must contain at least two lines';
  END IF;
  IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Exchange rate must be positive';
  END IF;

  -- تحقق من الملكية إذا كان التحديث
  IF p_id IS NOT NULL THEN
    SELECT id INTO v_header_id FROM public.journal_entry_headers
      WHERE id = p_id AND created_by = v_uid;
    IF v_header_id IS NULL THEN
      RAISE EXCEPTION 'Entry not found or access denied';
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account := btrim(coalesce(v_line->>'account', ''));
    v_currency := coalesce(v_line->>'currency', '');
    v_side := coalesce(v_line->>'side', '');
    v_line_note := nullif(v_line->>'line_note', '');
    v_amount := nullif(v_line->>'amount', '')::numeric;

    IF v_account = '' THEN
      RAISE EXCEPTION 'Account is required for every line';
    END IF;
    IF v_currency NOT IN ('USD', 'SYP') THEN
      RAISE EXCEPTION 'Unsupported currency: %', v_currency;
    END IF;
    IF v_side NOT IN ('debit', 'credit') THEN
      RAISE EXCEPTION 'Unsupported side: %', v_side;
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Amounts must be positive';
    END IF;

    v_value_in_usd := CASE
      WHEN v_currency = 'USD' THEN round(v_amount::numeric, 2)
      ELSE round((v_amount / v_exchange_rate)::numeric, 2)
    END;

    IF v_side = 'debit' THEN
      v_total_debit := v_total_debit + v_value_in_usd;
    ELSE
      v_total_credit := v_total_credit + v_value_in_usd;
    END IF;
  END LOOP;

  v_total_debit := round(v_total_debit::numeric, 2);
  v_total_credit := round(v_total_credit::numeric, 2);
  v_diff := abs(v_total_debit - v_total_credit);

  IF v_total_debit = 0 AND v_total_credit = 0 THEN
    RAISE EXCEPTION 'Journal entry is empty';
  END IF;
  IF v_diff > 0.01 THEN
    RAISE EXCEPTION 'Journal entry is not balanced';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.journal_entry_headers (
      created_by, date, reference_number, operation_type, description, notes, exchange_rate
    ) VALUES (
      v_uid, p_date, p_reference_number, p_operation_type, p_description, p_notes, p_exchange_rate
    ) RETURNING id INTO v_header_id;
  ELSE
    UPDATE public.journal_entry_headers SET
      date = p_date,
      reference_number = p_reference_number,
      operation_type = p_operation_type,
      description = p_description,
      notes = p_notes,
      exchange_rate = p_exchange_rate
    WHERE id = p_id AND created_by = v_uid;
    v_header_id := p_id;
  END IF;

  DELETE FROM public.journal_entry_lines WHERE entry_id = v_header_id;

  v_line_number := 1;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_currency := coalesce(v_line->>'currency', '');
    v_amount := nullif(v_line->>'amount', '')::numeric;
    v_value_in_usd := CASE
      WHEN v_currency = 'USD' THEN round(v_amount::numeric, 2)
      ELSE round((v_amount / v_exchange_rate)::numeric, 2)
    END;

    INSERT INTO public.journal_entry_lines (
      entry_id, line_number, account, currency, amount, side, value_in_usd, line_note
    ) VALUES (
      v_header_id,
      v_line_number,
      btrim(coalesce(v_line->>'account', '')),
      v_currency,
      v_amount,
      coalesce(v_line->>'side', ''),
      v_value_in_usd,
      nullif(v_line->>'line_note', '')
    );
    v_line_number := v_line_number + 1;
  END LOOP;

  v_result := jsonb_build_object('id', v_header_id, 'success', true);
  RETURN v_result;
END;
$$;

-- حماية RPC من PUBLIC و ANON
REVOKE ALL ON FUNCTION public.save_journal_entry(uuid, date, varchar, varchar, text, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_journal_entry(uuid, date, varchar, varchar, text, text, numeric, jsonb) FROM ANON;
GRANT EXECUTE ON FUNCTION public.save_journal_entry(uuid, date, varchar, varchar, text, text, numeric, jsonb) TO authenticated;

COMMIT;
