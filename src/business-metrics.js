(function () {
  "use strict";

  const VERSION = 1;
  const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
  const pct = (part, whole) => whole > 0 ? part / whole : 0;
  const text = (value) => String(value ?? "").trim();

  function scoreCredit(snapshot) {
    const r = snapshot.receivables || {};
    const debtors = Number(r.debtorCount || 0);
    const over = Number(r.overLimitCount || 0);
    const near = Number(r.nearLimitCount || 0);
    const score = clamp((pct(over, Math.max(1, debtors)) * 70) + (pct(near, Math.max(1, debtors)) * 30));
    return {
      score: Math.round(score),
      level: score >= 70 ? "critical" : score >= 40 ? "high" : score >= 20 ? "watch" : "normal",
      facts: { debtorCount: debtors, overLimitCount: over, nearLimitCount: near, totalReceivables: Number(r.total || 0) },
      source: r.meta?.source || "unknown"
    };
  }

  function scoreCollections(snapshot) {
    const receivables = Number(snapshot.receivables?.total || 0);
    const collected = Number(snapshot.collections?.todayTotal || 0);
    const collectionRatio = receivables > 0 ? collected / receivables : 0;
    const targetRatio = 0.035;
    const target = receivables > 0 ? Math.min(receivables, Math.max(5000, receivables * targetRatio)) : 0;
    const gap = Math.max(0, target - collected);
    const gapRatio = target > 0 ? gap / target : 0;
    const credit = scoreCredit(snapshot).score;
    const score = clamp((gapRatio * 70) + (credit * 0.3));
    return {
      score: Math.round(score),
      level: score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "watch" : "normal",
      facts: { collectedToday: collected, currency: snapshot.collections?.currency || null, analyticalTarget: Math.round(target), gap: Math.round(gap), collectionRatio },
      source: snapshot.collections?.meta?.source || "unknown",
      note: "Operational collection signal only; not a cash forecast."
    };
  }

  function scoreInventory(snapshot) {
    const i = snapshot.inventory || {};
    const count = Math.max(1, Number(i.itemCount || 0));
    const out = Number(i.outOfStockCount || 0);
    const urgent = Number(i.urgentReorderCount || 0);
    const low = Number(i.lowCoverCount || 0);
    const score = clamp((pct(out, count) * 100) + (pct(urgent, count) * 70) + (pct(low, count) * 35));
    return {
      score: Math.round(score),
      level: score >= 60 ? "critical" : score >= 30 ? "high" : score >= 12 ? "watch" : "normal",
      facts: { itemCount: Number(i.itemCount || 0), outOfStockCount: out, urgentReorderCount: urgent, lowCoverCount: low },
      source: i.meta?.source || "unknown"
    };
  }

  function scoreSuppliers(snapshot) {
    const rows = Array.isArray(snapshot.supplierObligations?.top) ? snapshot.supplierObligations.top : [];
    const now = new Date();
    const seven = new Date(now.getTime() + 7 * 86400000);
    let overdue = 0;
    let dueSoon = 0;
    for (const row of rows) {
      if (!row?.dueDate) continue;
      const due = new Date(row.dueDate);
      if (Number.isNaN(due.getTime())) continue;
      if (due < now) overdue += 1;
      else if (due <= seven) dueSoon += 1;
    }
    const supplierCount = Number(snapshot.supplierObligations?.supplierCount || rows.length || 0);
    const denominator = Math.max(1, supplierCount);
    const score = clamp((pct(overdue, denominator) * 80) + (pct(dueSoon, denominator) * 45));
    return {
      score: Math.round(score),
      level: score >= 55 ? "critical" : score >= 30 ? "high" : score >= 10 ? "watch" : "normal",
      facts: { supplierCount, overdueCount: overdue, dueWithin7DaysCount: dueSoon, totalsByCurrency: snapshot.supplierObligations?.totalsByCurrency || {} },
      source: snapshot.supplierObligations?.meta?.source || "unknown"
    };
  }

  function scorePurchasingWorkflow(snapshot) {
    const p = snapshot.purchasing || {};
    const pending = Number(p.pendingSyncCount || 0);
    const drafts = Number(p.draftCount || 0);
    const score = clamp(Math.min(70, pending * 18) + Math.min(30, drafts * 6));
    return {
      score: Math.round(score),
      level: score >= 60 ? "high" : score >= 25 ? "watch" : "normal",
      facts: { pendingSyncCount: pending, draftCount: drafts, openTotalsByCurrency: p.openTotalsByCurrency || {} },
      source: p.meta?.source || "unknown"
    };
  }

  function scoreDataConfidence(snapshot) {
    const health = snapshot.syncHealth || {};
    const sources = Array.isArray(health.sources) ? health.sources : [];
    const total = Math.max(1, sources.length);
    const missing = Number(health.missingCount || 0);
    const stale = Number(health.staleCount || 0);
    const confidence = clamp(100 - (pct(missing, total) * 70) - (pct(stale, total) * 35));
    return {
      score: Math.round(confidence),
      level: confidence >= 80 ? "strong" : confidence >= 60 ? "usable" : confidence >= 40 ? "weak" : "poor",
      facts: { sourceCount: sources.length, missingCount: missing, staleCount: stale, degraded: Boolean(snapshot.dataQuality?.degraded) }
    };
  }

  function priority(domain, metric, title, action, route, extra = {}) {
    return {
      domain,
      score: metric.score,
      level: metric.level,
      title,
      action,
      route,
      ...extra
    };
  }

  function buildPriorities(snapshot, metrics) {
    const list = [];
    if (metrics.creditRisk.score >= 20) list.push(priority("receivables", metrics.creditRisk, "مراجعة أخطر الذمم", "ابدأ بالزبائن المتجاوزين أو القريبين من حد الائتمان قبل زيادة البيع الآجل.", "balances"));
    if (metrics.collectionPressure.score >= 20) list.push(priority("collections", metrics.collectionPressure, "رفع التحصيل اليوم", `الفجوة التحليلية الحالية نحو ${Math.round(metrics.collectionPressure.facts.gap).toLocaleString("en-US")} ${snapshot.collections?.currency || ""}.`, "balances"));
    if (metrics.inventoryPressure.score >= 12) list.push(priority("inventory", metrics.inventoryPressure, "معالجة خطر المخزون", `يوجد ${metrics.inventoryPressure.facts.outOfStockCount} نافد و${metrics.inventoryPressure.facts.urgentReorderCount} بحاجة شراء عاجل.`, "ameen"));
    if (metrics.supplierPressure.score >= 10) list.push(priority("suppliers", metrics.supplierPressure, "مراجعة التزامات الموردين", `متأخر: ${metrics.supplierPressure.facts.overdueCount}، خلال 7 أيام: ${metrics.supplierPressure.facts.dueWithin7DaysCount}.`, "purchases"));
    if (metrics.purchasingWorkflow.score >= 25) list.push(priority("purchasing", metrics.purchasingWorkflow, "تنظيف مسار المشتريات", `هناك ${metrics.purchasingWorkflow.facts.pendingSyncCount} فاتورة تحتاج متابعة مزامنة.`, "purchases"));
    if (metrics.dataConfidence.score < 60) list.push({ domain: "data", score: 100 - metrics.dataConfidence.score, level: "high", title: "لا تعتمد قراراً حساساً قبل تحديث البيانات", action: `مصادر ناقصة: ${metrics.dataConfidence.facts.missingCount}، قديمة: ${metrics.dataConfidence.facts.staleCount}.`, route: "monitoring" });
    return list.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  function calculate(snapshot) {
    if (!snapshot || Number(snapshot.schemaVersion) < 1) throw new Error("Business Snapshot v1 or newer is required.");
    const metrics = {
      creditRisk: scoreCredit(snapshot),
      collectionPressure: scoreCollections(snapshot),
      inventoryPressure: scoreInventory(snapshot),
      supplierPressure: scoreSuppliers(snapshot),
      purchasingWorkflow: scorePurchasingWorkflow(snapshot),
      dataConfidence: scoreDataConfidence(snapshot)
    };
    const riskScores = [metrics.creditRisk.score, metrics.collectionPressure.score, metrics.inventoryPressure.score, metrics.supplierPressure.score, metrics.purchasingWorkflow.score];
    const weightedRisk = Math.round(riskScores.reduce((sum, value) => sum + value, 0) / riskScores.length);
    const overall = {
      riskScore: weightedRisk,
      confidenceScore: metrics.dataConfidence.score,
      level: weightedRisk >= 60 ? "critical" : weightedRisk >= 35 ? "high" : weightedRisk >= 15 ? "watch" : "stable"
    };
    return {
      schemaVersion: VERSION,
      generatedAt: new Date().toISOString(),
      snapshotGeneratedAt: snapshot.generatedAt || null,
      overall,
      metrics,
      priorities: buildPriorities(snapshot, metrics),
      guardrails: {
        autonomousFinancialWrites: false,
        currencyConversion: false,
        accountingSourceOfTruth: snapshot.identity?.accountingSourceOfTruth || "Ameen"
      }
    };
  }

  async function getMetrics(snapshot) {
    const source = snapshot || await window.ozkBusinessOS?.getSnapshot?.();
    if (!source) throw new Error("OZK Business Snapshot is unavailable.");
    return calculate(source);
  }

  window.ozkBusinessMetrics = Object.freeze({ schemaVersion: VERSION, calculate, getMetrics });
})();
