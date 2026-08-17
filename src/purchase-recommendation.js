(function () {
  "use strict";

  const VERSION = 1;
  const DEFAULT_SETTINGS = Object.freeze({
    approved: false,
    targetCoverageDays: null,
    urgentCoverageDays: null,
    salesVelocityFreshnessDays: null,
    minimumOrderUnit: null,
    roundingToUnit2: false
  });

  const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const positive = (value) => { const parsed = finite(value); return parsed !== null && parsed > 0 ? parsed : null; };
  const iso = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null; };

  function normalizeSettings(input = {}) {
    return Object.freeze({
      approved: input.approved === true,
      targetCoverageDays: positive(input.targetCoverageDays),
      urgentCoverageDays: positive(input.urgentCoverageDays),
      salesVelocityFreshnessDays: positive(input.salesVelocityFreshnessDays),
      minimumOrderUnit: positive(input.minimumOrderUnit),
      roundingToUnit2: input.roundingToUnit2 === true
    });
  }

  function settingsReady(settings) {
    return settings.approved
      && settings.targetCoverageDays !== null
      && settings.urgentCoverageDays !== null
      && settings.salesVelocityFreshnessDays !== null;
  }

  function velocityTrust(item, settings, nowMs) {
    const sold30d = finite(item.sold30d);
    if (sold30d === null || sold30d < 0) return { trusted: false, state: "missing", sold30d: null, asOf: null, ageDays: null, reason: "حركة المبيعات غير متوفرة" };
    const asOf = iso(item.velocityAsOf);
    if (!asOf) return { trusted: false, state: "missing_as_of", sold30d, asOf: null, ageDays: null, reason: "تاريخ حركة المبيعات غير متوفر" };
    if (settings.salesVelocityFreshnessDays === null) return { trusted: false, state: "freshness_unapproved", sold30d, asOf, ageDays: null, reason: "مدة حداثة حركة المبيعات غير معتمدة" };
    const ageDays = Math.max(0, (nowMs - new Date(asOf).getTime()) / 86400000);
    if (ageDays > settings.salesVelocityFreshnessDays) return { trusted: false, state: "stale", sold30d, asOf, ageDays, reason: "حركة المبيعات غير حديثة" };
    return { trusted: true, state: "fresh", sold30d, asOf, ageDays, reason: null };
  }

  function roundQuantity(quantity, item, settings) {
    if (quantity <= 0) return { quantity: 0, basis: "none", unitSize: null };
    const factor = positive(item.unit2Factor);
    if (settings.roundingToUnit2 && factor !== null) return { quantity: Math.ceil(quantity / factor) * factor, basis: "unit2", unitSize: factor };
    if (settings.minimumOrderUnit !== null) return { quantity: Math.ceil(quantity / settings.minimumOrderUnit) * settings.minimumOrderUnit, basis: "minimum_order_unit", unitSize: settings.minimumOrderUnit };
    return { quantity, basis: "unit1", unitSize: 1 };
  }

  function recommendItem(item, inputSettings = DEFAULT_SETTINGS, now = new Date()) {
    const settings = normalizeSettings(inputSettings);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const stock = finite(item.stock);
    const velocity = velocityTrust(item, settings, Number.isFinite(nowMs) ? nowMs : Date.now());
    const averageDailySales = velocity.trusted ? velocity.sold30d / 30 : null;
    const coverageDays = averageDailySales !== null && averageDailySales > 0 && stock !== null ? Math.max(0, stock) / averageDailySales : null;
    let priority = "review";
    let status = "insufficient_data";
    let reason = stock === null ? "المخزون الحالي غير متوفر" : "بحاجة اعتماد قاعدة الشراء";

    if (stock !== null && stock <= 0) {
      priority = "high";
      status = "out_of_stock";
      reason = "الصنف نافد";
    } else if (stock !== null && velocity.trusted && settings.urgentCoverageDays !== null && coverageDays !== null && coverageDays < settings.urgentCoverageDays) {
      priority = "high";
      status = "urgent_low_coverage";
      reason = "التغطية أقل من الحد العاجل المعتمد";
    } else if (stock !== null && velocity.trusted && settings.targetCoverageDays !== null && coverageDays !== null && coverageDays < settings.targetCoverageDays) {
      priority = "medium";
      status = "low_coverage";
      reason = "التغطية أقل من الهدف المعتمد";
    } else if (!velocity.trusted) {
      status = velocity.state;
      reason = velocity.state === "stale" ? "بحاجة مراجعة شراء — حركة المبيعات غير حديثة" : `بحاجة مراجعة شراء — ${velocity.reason}`;
    } else if (!settingsReady(settings)) {
      status = "settings_unapproved";
      reason = "بحاجة اعتماد قاعدة الشراء";
    } else {
      priority = "normal";
      status = "adequate_coverage";
      reason = "التغطية ضمن الهدف المعتمد";
    }

    let proposal = { eligible: false, quantity: null, rawQuantity: null, basis: null, unitSize: null, reason: "بحاجة اعتماد قاعدة الشراء" };
    if (!velocity.trusted) proposal.reason = velocity.state === "stale" ? "حركة المبيعات غير حديثة" : velocity.reason;
    else if (stock === null) proposal.reason = "المخزون الحالي غير متوفر";
    else if (settingsReady(settings)) {
      const rawQuantity = Math.max(0, averageDailySales * settings.targetCoverageDays - Math.max(0, stock));
      const rounded = roundQuantity(rawQuantity, item, settings);
      proposal = { eligible: true, quantity: rounded.quantity, rawQuantity, basis: rounded.basis, unitSize: rounded.unitSize, reason: null };
    }

    return Object.freeze({
      key: String(item.key || ""), number: String(item.number || ""), name: String(item.name || "صنف"),
      stock, stockAsOf: iso(item.stockAsOf), unit1Name: String(item.unit1Name || ""), unit2Name: String(item.unit2Name || ""), unit2Factor: positive(item.unit2Factor),
      sold30d: velocity.sold30d, velocityAsOf: velocity.asOf, velocityState: velocity.state, velocityTrusted: velocity.trusted,
      averageDailySales, coverageDays, priority, status, reason, proposal
    });
  }

  function recommendInventory(items, settings = DEFAULT_SETTINGS, now = new Date()) {
    const normalizedSettings = normalizeSettings(settings);
    const recommendations = (Array.isArray(items) ? items : []).map((item) => recommendItem(item, normalizedSettings, now));
    const rank = { high: 0, medium: 1, review: 2, normal: 3 };
    recommendations.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity) || a.name.localeCompare(b.name, "ar"));
    return Object.freeze({ version: VERSION, settings: normalizedSettings, settingsApproved: settingsReady(normalizedSettings), items: recommendations });
  }

  window.ozkPurchaseRecommendation = Object.freeze({ VERSION, DEFAULT_SETTINGS, normalizeSettings, settingsReady, recommendItem, recommendInventory });
})();
