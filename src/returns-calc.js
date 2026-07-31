// ===== حسابات مرتجعات المبيعات (جملة/مفرق) والمشتريات (retCalc) — دوال صِرفة بلا DOM =====
// يُحمَّل كسكربت عادي (بلا module) قبل app.js فيُلحق retCalc بالنافذة العامة،
// وscripts/check.mjs يشغّله بمحاكاة vm ليختبره مباشرة بلا وسيط DOM — بنفس نمط
// src/purchase-invoice-calc.js (poCalc).
//
// نطاق الملف: منع تجاوز الكمية الأصلية، احتساب المرتجعات التراكمية لكل فاتورة/صنف،
// عكس الربح والتكلفة بنسبة الكمية المرتجعة وبنفس أساس السعر الأصلي، تحديد أثر
// التسوية (تخفيض ذمم الزبون أو استرداد نقدي من نفس الصندوق لمرتجع المبيعات؛
// تخفيض ذمم المورد لمرتجع المشتريات)، ودورة حياة الحالة (مسودة→معتمد→...).
(function (root) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  function retToEnglishDigits(value) {
    return String(value ?? "")
      .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)));
  }

  // يشارك نفس منطق poNormalizeNumeric/normalizeNumericText لحقول الكمية والسعر،
  // معزول هنا كي يبقى الملف قابلاً للاختبار في Node مباشرة بلا أي DOM.
  function retNormalizeNumeric(value, options = {}) {
    const { allowNegative = false, allowDecimal = true } = options;
    let text = retToEnglishDigits(value)
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

  function retToNumber(value) {
    const text = retNormalizeNumeric(value);
    if (!text) return 0;
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function retRound2(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  // ===== منع تجاوز الكمية الأصلية + احتساب المرتجعات التراكمية =====

  // مجموع ما أُرجع فعلاً سابقاً لنفس السطر (فاتورة+صنف)، من قائمة مستندات مرتجع
  // سابقة بحالة معتمدة فأعلى فقط (المسودّات غير المعتمدة لا تحجز كمية).
  // priorReturns: [{ itemKey, qty, status }]
  function retAlreadyReturnedQty(priorReturns, itemKey) {
    const list = Array.isArray(priorReturns) ? priorReturns : [];
    return retRound2(
      list
        .filter((r) => r && r.itemKey === itemKey && r.status !== "draft" && r.status !== "cancelled")
        .reduce((sum, r) => sum + retToNumber(r.qty), 0)
    );
  }

  // الكمية القابلة للإرجاع المتبقية لسطر فاتورة أصلي = الكمية الأصلية ناقص كل ما
  // أُرجع سابقاً (بحالة معتمدة فأعلى). لا تنزل عن صفر أبداً.
  function retRemainingQty(originalQty, priorReturns, itemKey) {
    const original = Math.max(0, retToNumber(originalQty));
    const already = retAlreadyReturnedQty(priorReturns, itemKey);
    return Math.max(0, retRound2(original - already));
  }

  // يرفض صراحة (خطأ عربي) بدل الحسم الصامت: كمية مرتجعة صفر/سالبة، أو تتجاوز
  // المتبقي من الكمية الأصلية بعد خصم كل المرتجعات المعتمدة السابقة لنفس السطر.
  function retValidateReturnQty(input) {
    const requested = retToNumber(input?.qty);
    const original = Math.max(0, retToNumber(input?.originalQty));
    const already = retAlreadyReturnedQty(input?.priorReturns, input?.itemKey);
    const remaining = Math.max(0, retRound2(original - already));
    if (requested <= 0) return { ok: false, error: "أدخل كمية مرتجعة أكبر من صفر.", remaining };
    if (retRound2(requested - remaining) > 0.001) {
      return {
        ok: false,
        error: `الكمية المرتجعة (${requested}) أكبر من المتبقي القابل للإرجاع (${remaining}) لهذا الصنف.`,
        remaining
      };
    }
    return { ok: true, error: "", remaining };
  }

  // سطر مرتجع: يتجاهل الكمية/السعر إن لم يُختر صنف حقيقي (نفس قاعدة poRowComputed).
  function retLineComputed(row) {
    if (!row || !row.itemKey) return { qty: 0, price: 0, lineTotal: 0 };
    const qty = retToNumber(row.qty);
    const price = retToNumber(row.price);
    return { qty, price, lineTotal: retRound2(qty * price) };
  }

  function retTotals(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const grand = list.reduce((sum, row) => sum + retLineComputed(row).lineTotal, 0);
    return { grand: retRound2(grand) };
  }

  // ===== عكس الربح والتكلفة =====

  // بنسبة الكمية المرتجعة من الكمية الأصلية، وبنفس أساس السعر/التكلفة المستخدم
  // في سطر الفاتورة الأصلية (unitPrice/unitCost يُمرَّران كما حُسِما هناك، سواء
  // كان الأساس كرتونة أو كروز — لا إعادة حسم هنا).
  function retLineProfitReversal(input) {
    const returnQty = Math.max(0, retToNumber(input?.returnQty));
    const unitPrice = retToNumber(input?.unitPrice);
    const unitCost = retToNumber(input?.unitCost);
    const revenueReversed = retRound2(returnQty * unitPrice);
    const costReversed = retRound2(returnQty * unitCost);
    const profitReversed = retRound2(revenueReversed - costReversed);
    return { returnQty, revenueReversed, costReversed, profitReversed };
  }

  function retInvoiceProfitReversal(lines) {
    const list = Array.isArray(lines) ? lines : [];
    return list.reduce(
      (acc, line) => {
        const r = retLineProfitReversal(line);
        return {
          revenueReversed: retRound2(acc.revenueReversed + r.revenueReversed),
          costReversed: retRound2(acc.costReversed + r.costReversed),
          profitReversed: retRound2(acc.profitReversed + r.profitReversed)
        };
      },
      { revenueReversed: 0, costReversed: 0, profitReversed: 0 }
    );
  }

  // ===== أثر التسوية: ذمم الزبون/المورد أو استرداد نقدي من نفس الصندوق =====

  // kind: "sales_wholesale" | "sales_retail" | "purchase"
  // originalPayMethod: "cash" | "credit"
  // لمرتجع المبيعات الآجل: ينقص رصيد الزبون (ذمم مدينة) بقيمة المرتجع.
  // لمرتجع المبيعات النقدي: استرداد نقدي إلزامي من نفس صندوق القبض الأصلي
  // (treasuryId من الفاتورة الأصلية نفسها — لا يجوز اختيار صندوق آخر).
  // لمرتجع المشتريات: ينقص رصيد المورد (ذمم دائنة) دائماً بغضّ النظر عن طريقة الدفع
  // الأصلية، لأن رصيد المورد محاسبياً هو الذي يُعدَّل (استرداد نقدي فعلي من المورد
  // نادر ويُسجَّل يدوياً خارج هذا المسار إن حدث).
  function retSettlementImpact(input) {
    const kind = input?.kind === "purchase" ? "purchase" : "sales";
    const amount = Math.max(0, retRound2(input?.amount));
    if (amount <= 0) return { ok: false, error: "قيمة المرتجع يجب أن تكون أكبر من صفر." };

    if (kind === "purchase") {
      const supplierId = input?.supplierId;
      if (!supplierId) return { ok: false, error: "لا يمكن تسوية مرتجع المشتريات بلا مورد مرتبط بالفاتورة الأصلية." };
      return { ok: true, error: "", type: "supplier_credit", supplierId, amount };
    }

    const payMethod = input?.originalPayMethod === "cash" ? "cash" : "credit";
    if (payMethod === "credit") {
      const customerId = input?.customerId;
      if (!customerId) return { ok: false, error: "لا يمكن تسوية مرتجع آجل بلا زبون مرتبط بالفاتورة الأصلية." };
      return { ok: true, error: "", type: "customer_credit", customerId, amount };
    }

    const treasuryId = input?.treasuryId;
    if (!treasuryId) {
      return { ok: false, error: "لا يمكن استرداد مرتجع نقدي بلا صندوق القبض الأصلي." };
    }
    return { ok: true, error: "", type: "cash_refund", treasuryId, amount };
  }

  // اتجاه أثر المخزون: مرتجع المبيعات يعيد الكمية إلى المخزون (in)، ومرتجع
  // المشتريات يُخرجها من المخزون (out) — عكس اتجاه الفاتورة الأصلية بالضبط.
  function retInventoryDirection(kind) {
    return kind === "purchase" ? "out" : "in";
  }

  // ===== دورة حياة الحالة: مسودة → معتمد → بانتظار المزامنة/فشلت → مُزامَن =====
  // نفس ترتيب poCanTransitionStatus في purchase-invoice-calc.js عمداً — توحيد
  // النمط بين وحدتي المشتريات والمرتجعات. لا خروج من "synced"، ولا عودة لمسودة.
  const RET_STATUS_RANK = { draft: 0, approved: 1, sync_pending: 2, failed: 2, synced: 3 };
  const RET_STATUS_LABELS = {
    draft: "مسودة",
    approved: "معتمد",
    sync_pending: "بانتظار المزامنة",
    synced: "مُزامَن",
    failed: "فشلت المزامنة"
  };

  function retCanTransitionStatus(from, to) {
    if (!(from in RET_STATUS_RANK) || !(to in RET_STATUS_RANK)) return false;
    if (from === to) return true;
    if (from === "synced") return false;
    if (to === "draft") return false;
    if (RET_STATUS_RANK[from] === 2 && RET_STATUS_RANK[to] === 2) return true;
    return RET_STATUS_RANK[to] === RET_STATUS_RANK[from] + 1;
  }

  // ===== سلسلة ترقيم الأمين (نسخة صِرفة قابلة للاختبار من منطق peekSalesInvoiceNumber) =====

  // seriesReportItems: قائمة عناصر تقرير ameen_invoice_series (typeGuid/typeName/nextNo).
  // targetGuid/targetName: سلسلة الأمين المطلوبة (بالمعرّف أولاً ثم بالاسم بعد تطبيع بسيط).
  // localSeq: أعلى رقم محجوز محلياً بعد نجاح حفظ سابق لهذه السلسلة (طبقة أمان).
  function retNormalizeSeriesName(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[إأآا]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/[ً-ْ]/g, "");
  }

  function retFindSeries(seriesReportItems, targetGuid, targetName) {
    const items = Array.isArray(seriesReportItems) ? seriesReportItems : [];
    const guid = String(targetGuid || "").toLowerCase();
    const byGuid = guid ? items.find((s) => String(s?.typeGuid || "").toLowerCase() === guid) : null;
    if (byGuid) return byGuid;
    const wanted = retNormalizeSeriesName(targetName);
    if (!wanted) return null;
    return items.find((s) => retNormalizeSeriesName(s?.typeName || "") === wanted) || null;
  }

  // الرقم المعروض بلا حجز أبداً: أكبر بين "تالي الأمين" و"تالي العدّاد المحلي".
  // نص فارغ إن لم تصل سلسلة الأمين المطلوبة — لا تخمين لرقم قد يصطدم بمستند حقيقي.
  function retPeekNextNumber(seriesReportItems, targetGuid, targetName, localSeq) {
    const series = retFindSeries(seriesReportItems, targetGuid, targetName);
    const ameenNext = series ? Math.floor(retToNumber(series.nextNo)) : 0;
    if (!(ameenNext > 0)) return "";
    const local = Math.max(0, Math.floor(retToNumber(localSeq)));
    return String(Math.max(ameenNext, local + 1));
  }

  // ===== تنقّل السابق/التالي بين مستندات المرتجع (نفس منطق poAmeenClampNavIndex) =====
  function retClampNavIndex(count, index, direction) {
    const total = Math.max(0, Number(count) || 0);
    if (total === 0) return 0;
    const current = Number.isFinite(Number(index)) ? Number(index) : 0;
    const next = current + (Number(direction) || 0);
    if (next < 0) return 0;
    if (next > total - 1) return total - 1;
    return next;
  }

  root.retCalc = {
    retToEnglishDigits,
    retNormalizeNumeric,
    retToNumber,
    retRound2,
    retAlreadyReturnedQty,
    retRemainingQty,
    retValidateReturnQty,
    retLineComputed,
    retTotals,
    retLineProfitReversal,
    retInvoiceProfitReversal,
    retSettlementImpact,
    retInventoryDirection,
    retCanTransitionStatus,
    RET_STATUS_RANK,
    RET_STATUS_LABELS,
    retNormalizeSeriesName,
    retFindSeries,
    retPeekNextNumber,
    retClampNavIndex
  };
})(typeof window !== "undefined" ? window : globalThis);
