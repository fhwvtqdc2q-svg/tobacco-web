(function () {
  "use strict";

  const ROUTE = "command";
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  let loading = false;
  let snapshot = null;
  let metrics = null;
  let lastError = null;
  let lastUpdatedAt = null;

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value, currency = "USD") => `${Math.round(number(value)).toLocaleString("en-US")} ${currency === "USD" ? "$" : escape(currency || "")}`;

  function buildExecutiveBrief(currentSnapshot, currentMetrics) {
    const priorities = Array.isArray(currentMetrics?.priorities) ? currentMetrics.priorities : [];
    return {
      overall: currentMetrics?.overall || { riskScore: 0, confidenceScore: 0, level: "unknown" },
      receivables: number(currentSnapshot?.receivables?.total),
      debtors: number(currentSnapshot?.receivables?.debtorCount),
      collectedToday: currentSnapshot?.collections?.todayTotal ?? null,
      collectionCurrency: currentSnapshot?.collections?.currency || "USD",
      urgentInventory: number(currentSnapshot?.inventory?.urgentReorderCount) + number(currentSnapshot?.inventory?.outOfStockCount),
      supplierCount: number(currentSnapshot?.supplierObligations?.supplierCount),
      priorities: priorities.slice(0, 5),
      dataQuality: {
        stale: number(currentSnapshot?.syncHealth?.staleCount),
        missing: number(currentSnapshot?.syncHealth?.missingCount),
        degraded: Boolean(currentSnapshot?.dataQuality?.degraded)
      }
    };
  }

  function levelLabel(level) {
    return ({ critical: "حرج", high: "مرتفع", watch: "مراقبة", stable: "مستقر", normal: "طبيعي" }[level] || "غير محدد");
  }

  function priorityCard(row, index) {
    return `<article class="command-priority">
      <div class="command-priority-rank">${index + 1}</div>
      <div class="command-priority-body">
        <div class="command-priority-head"><strong>${escape(row.title)}</strong><span class="command-score">${Math.round(number(row.score))}/100</span></div>
        <p>${escape(row.action)}</p>
        <button class="button secondary" type="button" data-route="${escape(row.route || "overview")}">فتح القسم</button>
      </div>
    </article>`;
  }

  function commandPage() {
    if (!state?.session) return shell(`<section class="panel"><h2>مركز القيادة</h2><p class="muted">سجّل الدخول أولاً.</p></section>`);
    if (!snapshot || !metrics) {
      return shell(`<section class="panel wide command-center"><h2>🧠 مركز القيادة</h2><p class="muted">${loading ? "جاري تجميع صورة الشركة…" : escape(lastError || "لم تُحمّل البيانات بعد.")}</p></section>`);
    }

    const brief = buildExecutiveBrief(snapshot, metrics);
    const updated = lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—";
    return shell(`
      <section class="panel wide command-center">
        <div class="command-hero">
          <div>
            <span class="command-kicker">OZK BUSINESS OS</span>
            <h2>🧠 مركز القيادة</h2>
            <p>صورة موحّدة عن وضع العمل، مع أهم القرارات التي تستحق انتباهك الآن.</p>
          </div>
          <div class="command-health ${escape(brief.overall.level)}"><small>ضغط العمل</small><strong>${Math.round(number(brief.overall.riskScore))}/100</strong><span>${levelLabel(brief.overall.level)}</span></div>
        </div>
        <div class="command-meta"><span>ثقة البيانات: <strong>${Math.round(number(brief.overall.confidenceScore))}%</strong></span><span>آخر تحديث: <strong>${escape(updated)}</strong></span>${lastError ? `<span class="command-warning">${escape(lastError)}</span>` : ""}</div>
        <div class="command-kpis">
          <article><small>إجمالي الذمم</small><strong dir="ltr">${money(brief.receivables, "USD")}</strong><span>${brief.debtors} زبون مدين</span></article>
          <article><small>تحصيل اليوم</small><strong dir="ltr">${brief.collectedToday === null ? "غير متاح" : money(brief.collectedToday, brief.collectionCurrency)}</strong><span>من تقرير الحركة اليومي</span></article>
          <article><small>مخزون يحتاج تدخل</small><strong>${brief.urgentInventory}</strong><span>نافد + شراء عاجل</span></article>
          <article><small>موردون عليهم التزامات</small><strong>${brief.supplierCount}</strong><span>بدون خلط العملات</span></article>
        </div>
      </section>
      <section class="panel wide command-priorities">
        <div class="panel-title-row"><div><h2 style="margin:0">🎯 أهم الأولويات الآن</h2><p class="muted" style="margin:4px 0 0">حتى 5 قرارات مرتبة حسب الضغط التشغيلي.</p></div><button class="button secondary" type="button" data-action="command-refresh">تحديث</button></div>
        <div class="command-priority-list">${brief.priorities.map(priorityCard).join("") || '<p class="muted">لا توجد أولوية حرجة حالياً.</p>'}</div>
      </section>
      <section class="panel wide command-data-quality">
        <h2>🩺 صحة البيانات</h2>
        <div class="command-quality-grid"><span>مصادر قديمة <strong>${brief.dataQuality.stale}</strong></span><span>مصادر ناقصة <strong>${brief.dataQuality.missing}</strong></span><span>الحالة <strong>${brief.dataQuality.degraded ? "تحتاج انتباه" : "جيدة"}</strong></span></div>
      </section>
    `);
  }

  async function refreshCommandCenter() {
    if (loading || state?.route !== ROUTE || !state?.session) return;
    loading = true;
    lastError = null;
    try {
      snapshot = await window.ozkBusinessOS?.getSnapshot?.();
      if (!snapshot) throw new Error("Business Snapshot غير متاح.");
      metrics = await window.ozkBusinessMetrics?.getMetrics?.(snapshot);
      if (!metrics) throw new Error("Metrics Engine غير متاح.");
      lastUpdatedAt = new Date();
    } catch (error) {
      lastError = String(error?.message || error || "تعذر تحديث مركز القيادة.");
      console.error("[OZK Command Center]", error);
    } finally {
      loading = false;
      if (state?.route === ROUTE) render();
    }
  }

  function addCommandNav() {
    if (document.querySelector('[data-route="command"]')) return;
    const nav = document.querySelector("aside .sidebar nav, aside nav, .sidebar nav");
    if (!nav) return;
    const template = nav.querySelector("[data-route]");
    const button = document.createElement(template?.tagName === "A" ? "a" : "button");
    button.className = template?.className || "nav-link";
    button.textContent = "🧠 مركز القيادة";
    button.dataset.route = ROUTE;
    if (button.tagName === "A") button.href = "?route=command";
    button.addEventListener("click", (event) => { event.preventDefault(); setRoute(ROUTE); });
    nav.insertBefore(button, nav.firstChild);
  }

  function bindCommandEvents() {
    app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); setRoute(button.dataset.route); }));
    app.querySelector("[data-action='command-refresh']")?.addEventListener("click", refreshCommandCenter);
  }

  function syncTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = state?.route === ROUTE && state?.session ? setInterval(refreshCommandCenter, REFRESH_MS) : null;
  }

  try {
    allowedRoutes.add(ROUTE);
    if (new URLSearchParams(window.location.search).get("route") === ROUTE) state.route = ROUTE;
    const baseRender = render;
    render = function commandAwareRender() {
      if (state.route === ROUTE) {
        app.innerHTML = commandPage();
        bindCommandEvents();
        addCommandNav();
        syncTimer();
        return;
      }
      baseRender();
      addCommandNav();
      syncTimer();
    };
    window.ozkCommandCenter = Object.freeze({ buildExecutiveBrief, refresh: refreshCommandCenter });
    render();
    if (state?.route === ROUTE) setTimeout(refreshCommandCenter, 0);
  } catch (error) {
    console.error("[OZK Command Center Init]", error);
  }
})();
