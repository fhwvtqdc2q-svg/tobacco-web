(function () {
  "use strict";

  const VERSION = 1;

  const AGENTS = Object.freeze({
    ceo: { id: "ceo", name: "المدير التنفيذي", icon: "🧠" },
    collections: { id: "collections", name: "مدير التحصيل والائتمان", icon: "💳" },
    inventory: { id: "inventory", name: "مدير المخزون والمشتريات", icon: "📦" },
    suppliers: { id: "suppliers", name: "مدير الموردين والسيولة", icon: "🤝" },
    controller: { id: "controller", name: "مراقب البيانات", icon: "🛡️" }
  });

  function n(value) { return Number(value || 0); }
  function fmt(value) { return Math.round(n(value)).toLocaleString("en-US"); }

  function recommendation(agent, severity, title, why, action, route, evidence) {
    return { agent, severity, title, why, action, route, evidence: evidence || {} };
  }

  function collectionsAdvice(snapshot, metrics) {
    const m = metrics.metrics.collectionPressure;
    const c = metrics.metrics.creditRisk;
    if (Math.max(m.score, c.score) < 20) return null;
    return recommendation("collections", Math.max(m.score, c.score), "التحصيل والائتمان يحتاجان انتباه اليوم",
      `الذمم ${fmt(snapshot.receivables?.total)}، المحصل اليوم ${fmt(m.facts.collectedToday)}، وفجوة التحصيل التحليلية ${fmt(m.facts.gap)}.`,
      "ابدأ بالعملاء المتجاوزين لحد الائتمان، ثم الأعلى رصيداً، ولا توسّع البيع الآجل قبل المراجعة.", "balances",
      { overLimitCount: c.facts.overLimitCount, nearLimitCount: c.facts.nearLimitCount, gap: m.facts.gap });
  }

  function inventoryAdvice(snapshot, metrics) {
    const m = metrics.metrics.inventoryPressure;
    if (m.score < 12) return null;
    return recommendation("inventory", m.score, "المخزون يحتاج قرار شراء موجّه",
      `نافد ${m.facts.outOfStockCount} صنف، وعاجل ${m.facts.urgentReorderCount}، وتغطية منخفضة ${m.facts.lowCoverCount}.`,
      "راجع الأصناف النافدة والعاجلة أولاً واربط أي طلب شراء بالحاجة الفعلية قبل اعتماده.", "ameen", m.facts);
  }

  function supplierAdvice(snapshot, metrics) {
    const m = metrics.metrics.supplierPressure;
    if (m.score < 10) return null;
    return recommendation("suppliers", m.score, "رتّب دفعات الموردين حسب الاستحقاق",
      `متأخر ${m.facts.overdueCount} التزام، ويستحق خلال 7 أيام ${m.facts.dueWithin7DaysCount}.`,
      "ابدأ بالمتأخر ثم القريب، مع إبقاء العملات منفصلة وعدم تحويلها ضمنياً.", "purchases", m.facts);
  }

  function controllerAdvice(snapshot, metrics) {
    const m = metrics.metrics.dataConfidence;
    if (m.score >= 80) return null;
    return recommendation("controller", 100 - m.score, "جودة البيانات تحد من قوة القرار",
      `الثقة ${m.score}%، مصادر ناقصة ${m.facts.missingCount}، وقديمة ${m.facts.staleCount}.`,
      m.score < 60 ? "حدّث المصادر الناقصة أو القديمة قبل أي قرار مالي حساس." : "يمكن العمل تشغيلياً، لكن راقب حداثة المصادر قبل القرارات الكبيرة.",
      "monitoring", m.facts);
  }

  function purchasingAdvice(snapshot, metrics) {
    const m = metrics.metrics.purchasingWorkflow;
    if (m.score < 25) return null;
    return recommendation("inventory", m.score, "نظّف مسار المشتريات المفتوح",
      `معلّق للمزامنة ${m.facts.pendingSyncCount} ومسودات ${m.facts.draftCount}.`,
      "أغلق أو صحح العناصر المعلقة قبل إنشاء موجة مشتريات جديدة حتى لا تتكرر الالتزامات.", "purchases", m.facts);
  }

  function buildBrief(snapshot, metrics) {
    const advice = [controllerAdvice(snapshot, metrics), collectionsAdvice(snapshot, metrics), inventoryAdvice(snapshot, metrics), supplierAdvice(snapshot, metrics), purchasingAdvice(snapshot, metrics)]
      .filter(Boolean).sort((a, b) => b.severity - a.severity);
    const top = advice.slice(0, 5);
    const confidence = metrics.overall.confidenceScore;
    const headline = top.length
      ? `أولوية اليوم: ${top[0].title}`
      : "الوضع التشغيلي مستقر ولا توجد إشارة ضغط مرتفعة حالياً.";
    return {
      schemaVersion: VERSION,
      generatedAt: new Date().toISOString(),
      headline,
      overall: metrics.overall,
      confidence,
      executiveOrder: top,
      agents: AGENTS,
      guardrails: {
        readOnly: true,
        autonomousPurchases: false,
        autonomousPayments: false,
        autonomousCreditChanges: false,
        currencyConversion: false,
        accountingSourceOfTruth: metrics.guardrails.accountingSourceOfTruth
      }
    };
  }

  async function getBrief() {
    const snapshot = await window.ozkBusinessOS?.getSnapshot?.();
    if (!snapshot) throw new Error("OZK Business Snapshot is unavailable.");
    const metrics = await window.ozkBusinessMetrics?.getMetrics?.(snapshot);
    if (!metrics) throw new Error("OZK Business Metrics are unavailable.");
    return buildBrief(snapshot, metrics);
  }

  window.ozkExecutiveTeam = Object.freeze({ schemaVersion: VERSION, agents: AGENTS, buildBrief, getBrief });
})();
