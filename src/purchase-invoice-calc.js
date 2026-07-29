// ===== حسابات فاتورة المشتريات (poCalc) — دوال صِرفة بلا DOM =====
// تُحمَّل كسكربت عادي (بلا module) قبل app.js فتُلحق poCalc بالنافذة العامة،
// وscripts/check.mjs يشغّلها بمحاكاة vm ليختبرها مباشرة بلا وسيط DOM.
(function (root) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  function poToEnglishDigits(value) {
    return String(value ?? "")
      .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)));
  }

  // يطبّع أرقام عربية/فارسية وفواصل عشرية عربية إلى رقم إنجليزي — يُستعمل لحقول
  // الكمية والسعر والدفعة في فاتورة المشتريات (يشارك المنطق مع normalizeNumericText
  // في app.js، لكنه هنا معزول عن أي متغير عام كي يبقى قابلاً للاختبار في Node مباشرة).
  function poNormalizeNumeric(value, options = {}) {
    const { allowNegative = false, allowDecimal = true } = options;
    let text = poToEnglishDigits(value)
      .replace(/[٫،]/g, ".")
      .replace(/\s+/g, "")
      .trim();

    const commaCount = (text.match(/,/g) || []).length;
    if (allowDecimal && !text.includes(".") && commaCount === 1) {
      const [, decimalPart = ""] = text.split(",");
      if (/^\d{1,2}$/.test(decimalPart)) text = text.replace(",", ".");
    }

    text = text.replace(/,/g, "").replace(/[^\d.-]/g, "");
    const isNegative = allowNegative && text.includes("-");
    text = text.replace(/-/g, "");

    if (!allowDecimal) {
      text = text.replace(/\./g, "");
    } else {
      const parts = text.split(".");
      text = `${parts.shift() || ""}${parts.length ? `.${parts.join("")}` : ""}`;
      if (text.startsWith(".")) text = `0${text}`;
    }

    return isNegative && text ? `-${text}` : text;
  }

  function poToNumber(value) {
    const text = poNormalizeNumeric(value);
    if (!text) return 0;
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function poRound2(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  // سطر الفاتورة: يتجاهل الكمية/السعر إن لم يُختر صنف حقيقي (row.key فارغ) —
  // نفس قاعدة salesRowComputed: سطر بلا هوية صنف لا يدخل أي مجموع.
  function poRowComputed(row) {
    if (!row || !row.key) return { qty: 0, price: 0, lineTotal: 0 };
    const qty = poToNumber(row.qty);
    const price = poToNumber(row.price);
    return { qty, price, lineTotal: poRound2(qty * price) };
  }

  function poTotals(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const grand = list.reduce((sum, row) => sum + poRowComputed(row).lineTotal, 0);
    return { grand: poRound2(grand) };
  }

  // الدفع/المتبقي: موجب = ما زال مستحقاً للمورد، صفر (ضمن هامش قرش) = مسدّد بالكامل،
  // سالب = دُفع أكثر من المطلوب (يجب ألا يحدث لأن poValidatePayment يرفضه، لكن الحساب
  // نفسه لا يفترض ذلك ويُبلغ عنه بصدق بدل حجبه).
  function poRemainingState(input) {
    const total = poRound2(input?.total);
    const paidAmount = poRound2(input?.paidAmount);
    const remaining = poRound2(total - paidAmount);
    const epsilon = 0.01;
    let status = "settled";
    if (remaining > epsilon) status = "due";
    else if (remaining < -epsilon) status = "over";
    return { total, paidAmount, remaining, status };
  }

  // يرفض صراحة (خطأ عربي) بدل الحسم الصامت: دفعة سالبة أو أكبر من الإجمالي.
  // الدفعة الجزئية مسموحة دوماً؛ صفر مسموح (فاتورة آجلة بلا دفعة أولى).
  function poValidatePayment(input) {
    const total = poRound2(input?.total);
    // فحص السالب يجب أن يسبق poToNumber: poToNumber (عبر poNormalizeNumeric بلا
    // allowNegative) يحذف إشارة السالب بصمت، فيصبح -1 قيمته 1 — هذا يُخفي الخطأ
    // بدل رفضه. نقرأ الإشارة الخام أولاً من رقم أو نص قبل أي تطبيع.
    const rawText = poToEnglishDigits(input?.amount).trim();
    const isRawNegative = typeof input?.amount === "number" ? input.amount < 0 : rawText.startsWith("-");
    if (isRawNegative) return { ok: false, error: "لا يمكن أن تكون قيمة الدفعة سالبة." };
    const amount = poToNumber(input?.amount);
    if (amount - total > 0.01) return { ok: false, error: "قيمة الدفعة أكبر من إجمالي الفاتورة." };
    return { ok: true, error: "" };
  }

  // يمنع تسجيل نفس الصنف مرتين في فاتورة واحدة (يجب دمج الكمية بدل سطر ثانٍ).
  function poDedupeLines(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const seen = new Map();
    const duplicateItemKeys = [];
    list.forEach((row) => {
      if (!row || !row.key) return;
      const count = (seen.get(row.key) || 0) + 1;
      seen.set(row.key, count);
      if (count === 2) duplicateItemKeys.push(row.key);
    });
    return { ok: duplicateItemKeys.length === 0, duplicateItemKeys };
  }

  // ترتيب الحالات: مسودة(0) → معتمدة(1) → بانتظار المزامنة/فشلت(2) → مُزامَنة(3).
  // sync_pending وfailed يتشاركان الرتبة كممر إعادة محاولة بالاتجاهين. الانتقال
  // للأمام خطوة واحدة فقط مسموح، ولا خروج من synced إطلاقاً (تصحيحها إجراء منفصل
  // مُدقَّق بسجل — وليس تحديث حالة عادي)، ولا عودة لمسودة من أي حالة لاحقة.
  const PO_STATUS_RANK = { draft: 0, approved: 1, sync_pending: 2, failed: 2, synced: 3 };
  const PO_STATUS_LABELS = {
    draft: "مسودة",
    approved: "معتمدة",
    sync_pending: "بانتظار المزامنة",
    synced: "مُزامَنة",
    failed: "فشلت المزامنة"
  };

  function poCanTransitionStatus(from, to) {
    if (!(from in PO_STATUS_RANK) || !(to in PO_STATUS_RANK)) return false;
    if (from === to) return true;
    if (from === "synced") return false;
    if (to === "draft") return false;
    if (PO_STATUS_RANK[from] === 2 && PO_STATUS_RANK[to] === 2) return true;
    return PO_STATUS_RANK[to] === PO_STATUS_RANK[from] + 1;
  }

  root.poCalc = {
    poToEnglishDigits,
    poNormalizeNumeric,
    poToNumber,
    poRound2,
    poRowComputed,
    poTotals,
    poRemainingState,
    poValidatePayment,
    poDedupeLines,
    poCanTransitionStatus,
    PO_STATUS_RANK,
    PO_STATUS_LABELS
  };
})(typeof window !== "undefined" ? window : globalThis);
