// حسابات الجرد الشهري — دوال معزولة بلا DOM، قابلة للاختبار بـ scripts/check.mjs
// كل القيم المالية هنا تقديرية لأغراض العرض والتقرير فقط — لا تُنشئ أي قيد محاسبي.
(function (root) {
  function toEnglishDigits(value) {
    if (value === null || value === undefined) return "";
    const arabic = "٠١٢٣٤٥٦٧٨٩";
    const persian = "۰۱۲۳۴۵۶۷۸۹";
    return String(value).replace(/[٠-٩۰-۹]/g, (ch) => {
      const ai = arabic.indexOf(ch);
      if (ai > -1) return String(ai);
      const pi = persian.indexOf(ch);
      if (pi > -1) return String(pi);
      return ch;
    }).replace(/٫/g, ".").replace(/،/g, ".");
  }

  function toNumber(value) {
    const normalized = toEnglishDigits(value).replace(/[^0-9.-]/g, "");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  const DIFF_EPSILON = 0.0005;

  function diffOf(systemQty, actualQty) {
    const sys = toNumber(systemQty);
    const hasActual = actualQty !== null && actualQty !== undefined && String(actualQty).trim() !== "";
    if (!hasActual) {
      return { diffQty: 0, diffType: "none" };
    }
    const actual = toNumber(actualQty);
    const diffQty = actual - sys;
    let diffType = "none";
    if (diffQty > DIFF_EPSILON) diffType = "increase";
    else if (diffQty < -DIFF_EPSILON) diffType = "decrease";
    return { diffQty, diffType };
  }

  function settlementValue(diffQty, unitCost) {
    return round2(toNumber(diffQty) * toNumber(unitCost));
  }

  function lineComputed(line) {
    const l = line || {};
    const { diffQty, diffType } = diffOf(l.systemQty, l.actualQty);
    const value = settlementValue(diffQty, l.unitCost);
    const reasonRequired = diffType !== "none";
    const reasonOk = !reasonRequired || (typeof l.reason === "string" && l.reason.trim() !== "");
    return { diffQty, diffType, settlementValue: value, reasonRequired, reasonOk };
  }

  function sessionSummary(lines) {
    const list = Array.isArray(lines) ? lines : [];
    const summary = {
      totalLines: list.length,
      matchedCount: 0,
      increaseCount: 0,
      decreaseCount: 0,
      gainValue: 0,
      lossValue: 0,
      netValue: 0
    };
    list.forEach((line) => {
      const computed = lineComputed(line);
      if (computed.diffType === "none") summary.matchedCount += 1;
      else if (computed.diffType === "increase") summary.increaseCount += 1;
      else if (computed.diffType === "decrease") summary.decreaseCount += 1;

      if (computed.settlementValue > 0) summary.gainValue = round2(summary.gainValue + computed.settlementValue);
      else if (computed.settlementValue < 0) summary.lossValue = round2(summary.lossValue + Math.abs(computed.settlementValue));
    });
    summary.netValue = round2(summary.gainValue - summary.lossValue);
    return summary;
  }

  function validateForReview(lines) {
    const list = Array.isArray(lines) ? lines : [];
    let missingReasonCount = 0;
    list.forEach((line) => {
      const computed = lineComputed(line);
      if (computed.reasonRequired && !computed.reasonOk) missingReasonCount += 1;
    });
    return { ok: missingReasonCount === 0, missingReasonCount };
  }

  const RECON_STATUS_RANK = { draft: 0, reviewed: 1, approved: 2 };

  function canTransitionStatus(from, to) {
    if (!Object.prototype.hasOwnProperty.call(RECON_STATUS_RANK, from)) return false;
    if (!Object.prototype.hasOwnProperty.call(RECON_STATUS_RANK, to)) return false;
    return RECON_STATUS_RANK[to] === RECON_STATUS_RANK[from] + 1;
  }

  function normalizeSearchText(value) {
    return toEnglishDigits(value)
      .toLowerCase()
      .replace(/[إأآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[ًٌٍَُِّْـ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function itemMatches(item, query) {
    const q = normalizeSearchText(query);
    if (!q) return true;
    const it = item || {};
    const haystacks = [it.itemName, it.itemNumber, it.name, it.number].filter(Boolean).map(normalizeSearchText);
    return haystacks.some((h) => h.includes(q));
  }

  function buildIdempotencyKey(warehouseKey, sessionMonth, nonce) {
    return `${warehouseKey}|${sessionMonth}|${nonce}`;
  }

  root.invRecCalc = {
    toEnglishDigits,
    toNumber,
    round2,
    diffOf,
    settlementValue,
    lineComputed,
    sessionSummary,
    validateForReview,
    RECON_STATUS_RANK,
    canTransitionStatus,
    normalizeSearchText,
    itemMatches,
    buildIdempotencyKey
  };
})(window);
