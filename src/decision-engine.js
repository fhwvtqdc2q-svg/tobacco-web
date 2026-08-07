(function () {
  const ROUTE = "decision";
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  let refreshBusy = false;
  let lastRefreshAt = null;
  let lastRefreshState = "idle";

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  const num = (value) => {
    const n = Number(String(value ?? 0).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(String(value).replace(/,/g, "")));
  const money = (value) => `${Math.abs(num(value)).toLocaleString("en-US", { maximumFractionDigits: 0 })} $`;

  function balanceItems() {
    try { if (typeof latestCustomerBalanceItems === "function") return latestCustomerBalanceItems() || []; } catch {}
    const reports = Array.isArray(state?.customerBalanceReports) ? state.customerBalanceReports : [];
    return Array.isArray(reports[0]?.items) ? reports[0].items : [];
  }

  const customerKey = (row) => String(row?.customerKey || row?.customer_key || row?.key || row?.guid || row?.name || "");
  const customerName = (row) => String(row?.name || row?.customerName || row?.customer_name || "زبون");
  const customerBalance = (row) => num(row?.balance ?? row?.debit ?? row?.amount ?? row?.remaining ?? 0);

  function creditLimitFor(row) {
    const key = customerKey(row);
    const name = customerName(row).trim().toLowerCase();
    const limits = Array.isArray(state?.customerCreditLimits) ? state.customerCreditLimits : [];
    const match = limits.find((x) => String(x.customerKey || "") === key)
      || limits.find((x) => String(x.customerName || "").trim().toLowerCase() === name);
    return num(match?.creditLimit || 0);
  }

  function customerRiskRows() {
    return balanceItems().map((row) => {
      const balance = Math.max(0, customerBalance(row));
      const limit = creditLimitFor(row);
      const ratio = limit > 0 ? balance / limit : 0;
      let score = balance > 0 ? Math.min(45, Math.round(Math.log10(balance + 1) * 10)) : 0;
      if (limit > 0) score += Math.min(55, Math.round(ratio * 55));
      if (ratio >= 1.25) score = Math.max(score, 95);
      else if (ratio >= 1) score = Math.max(score, 85);
      else if (ratio >= 0.9) score = Math.max(score, 70);
      const level = score >= 85 ? "red" : score >= 65 ? "orange" : score >= 40 ? "yellow" : "green";
      return { name: customerName(row), balance, limit, score, level };
    }).filter((row) => row.balance > 0).sort((a, b) => b.score - a.score || b.balance - a.balance);
  }

  function collectionTarget(risks) {
    const totalReceivables = risks.reduce((sum, row) => sum + row.balance, 0);
    const riskyReceivables = risks.filter((row) => row.level === "red" || row.level === "orange").reduce((sum, row) => sum + row.balance, 0);
    const minimum = Math.min(totalReceivables, Math.max(5000, Math.round(totalReceivables * 0.035), Math.round(riskyReceivables * 0.08)));
    return { minimum, comfortable: Math.min(totalReceivables, Math.max(minimum, Math.round(minimum * 1.25))) };
  }

  function itemSnapshotRows() {
    const candidates = [state?.ameenItemSnapshot, state?.ameenItemSnapshots, state?.itemSnapshots, state?.purchaseItemSnapshot];
    return candidates.find(Array.isArray) || [];
  }

  function velocityFor(item) {
    const direct = item.unitsSold30d ?? item.units_sold_30d ?? item.qtySold30d ?? item.qty_sold_30d;
    if (hasNumber(direct)) return num(direct);
    const key = String(item.itemKey || item.item_key || item.itemGuid || item.item_guid || "");
    const name = String(item.itemName || item.item_name || "").trim().toLowerCase();
    const snapshot = itemSnapshotRows().find((row) => String(row.itemKey || row.item_key || row.itemGuid || row.item_guid || "") === key)
      || itemSnapshotRows().find((row) => String(row.itemName || row.item_name || "").trim().toLowerCase() === name);
    const value = snapshot?.unitsSold30d ?? snapshot?.units_sold_30d ?? snapshot?.qtySold30d ?? snapshot?.qty_sold_30d;
    return hasNumber(value) ? num(value) : null;
  }

  function purchaseSignals() {
    return (Array.isArray(state?.approvedPriceItems) ? state.approvedPriceItems : []).map((item) => {
      const stock = Math.max(0, num(item.stockQty ?? item.stock_qty ?? 0));
      const sold30d = velocityFor(item);
      const status = String(item.stockStatus || item.stock_status || "").toLowerCase();
      let score = 20;
      let basis = "stock_only";
      let daysCover = null;

      if (sold30d !== null) {
        basis = "sales_velocity";
        if (sold30d > 0) daysCover = stock / (sold30d / 30);
        if (sold30d <= 0) score = stock > 0 ? 5 : 15;
        else if (stock <= 0 || /out|نفد|غير متوفر/.test(status)) score = 100;
        else if (daysCover < 3) score = 95;
        else if (daysCover < 7) score = 85;
        else if (daysCover < 14) score = 70;
        else if (daysCover < 30) score = 45;
        else score = 20;
      } else {
        if (stock <= 0 || /out|نفد|غير متوفر/.test(status)) score = 70;
        else if (stock <= 3) score = 55;
        else if (stock <= 7) score = 40;
        else score = 20;
      }
      return { name: item.itemName || item.item_name || "صنف", stock, sold30d, daysCover, score, basis };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function invoiceRemaining(invoice) {
    const explicit = invoice.remaining ?? invoice.remainingTotal ?? invoice.remaining_total;
    if (hasNumber(explicit)) return Math.max(0, num(explicit));
    const total = invoice.total ?? invoice.grandTotal ?? invoice.grand_total;
    const paid = invoice.paidAmount ?? invoice.paid_amount ?? invoice.paidTotal ?? invoice.paid_total ?? invoice.paymentAmount ?? invoice.payment_amount;
    if (hasNumber(total) && hasNumber(paid)) return Math.max(0, num(total) - num(paid));
    return null;
  }

  function supplierSignals() {
    const groups = Array.isArray(state?.poAmeenReport?.items) ? state.poAmeenReport.items : [];
    return groups.map((supplier) => {
      const invoices = Array.isArray(supplier.invoices) ? supplier.invoices : [];
      const known = invoices.map(invoiceRemaining).filter((value) => value !== null);
      return {
        name: supplier.name || "مورد",
        total: known.reduce((sum, value) => sum + value, 0),
        invoiceCount: invoices.length,
        knownCount: known.length,
        complete: invoices.length > 0 && known.length === invoices.length
      };
    }).filter((row) => row.invoiceCount > 0).sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      return b.total - a.total;
    }).slice(0, 8);
  }

  function riskBadge(level) {
    const map = { red: ["خطر مرتفع", "danger"], orange: ["يحتاج تحصيل", "warning"], yellow: ["مراقبة", "pending"], green: ["طبيعي", "success"] };
    const [label, cls] = map[level] || map.green;
    return `<span class="status-chip decision-${cls}">${label}</span>`;
  }

  function liveLabel() {
    if (!navigator.onLine) return "غير متصل — عرض آخر بيانات محفوظة";
    if (lastRefreshState === "error") return "تعذر التحديث — ستتم إعادة المحاولة تلقائياً";
    if (lastRefreshState === "partial") return "تحديث جزئي — بعض المصادر لم تستجب";
    if (lastRefreshAt) return `آخر تحديث ناجح · ${lastRefreshAt.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}`;
    return "تحديث تلقائي كل دقيقة";
  }

  function liveClass() {
    if (!navigator.onLine || lastRefreshState === "error") return "offline";
    if (lastRefreshState === "partial") return "degraded";
    return "";
  }

  function decisionPage() {
    if (!state?.session) return shell(`<section class="panel"><h2>قرار اليوم</h2><p class="muted">سجّل الدخول أولاً لعرض قرارات السيولة والتحصيل والموردين.</p></section>`);
    const risks = customerRiskRows();
    const target = collectionTarget(risks);
    const suppliers = supplierSignals();
    const purchase = purchaseSignals();
    const redCount = risks.filter((row) => row.level === "red").length;
    const urgentBuy = purchase.filter((row) => row.score >= 85).length;

    const collectionRows = risks.slice(0, 10).map((row) => `<tr><td><strong>${escape(row.name)}</strong></td><td dir="ltr">${money(row.balance)}</td><td dir="ltr">${row.limit > 0 ? money(row.limit) : "—"}</td><td>${riskBadge(row.level)}</td><td>${row.level === "red" ? "تحصيل قبل أي بيع آجل جديد" : row.level === "orange" ? "اتصال وتحديد دفعة اليوم" : "متابعة عادية"}</td></tr>`).join("");
    const supplierRows = suppliers.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escape(row.name)}</strong></td><td dir="ltr">${row.complete ? money(row.total) : "غير متاح"}</td><td>${escape(row.knownCount)}/${escape(row.invoiceCount)}</td><td>${row.complete ? (index < 2 ? '<span class="status-chip decision-danger">أولوية عالية</span>' : '<span class="status-chip decision-pending">مراجعة</span>') : '<span class="status-chip decision-warning">بيانات ناقصة</span>'}</td></tr>`).join("");
    const purchaseRows = purchase.map((row) => `<tr><td><strong>${escape(row.name)}</strong></td><td dir="ltr">${escape(row.stock)}</td><td>${row.sold30d === null ? "—" : escape(row.sold30d)}</td><td><strong>${escape(row.score)}</strong>/100</td><td>${row.basis === "sales_velocity" ? (row.score >= 85 ? '<span class="status-chip decision-danger">عاجل</span>' : row.score >= 65 ? '<span class="status-chip decision-warning">قريب</span>' : '<span class="status-chip decision-success">مستقر</span>') : '<span class="status-chip decision-pending">تقدير احتياطي</span>'}</td></tr>`).join("");

    return shell(`
      <section class="panel wide decision-page">
        <div class="panel-title-row"><div><h2 style="margin:0">📌 قرار اليوم</h2><p class="muted" style="margin:4px 0 0">ملخص تنفيذي مبني على آخر بيانات متاحة.</p></div><span class="decision-live ${liveClass()}"><i class="decision-live-dot"></i>${escape(liveLabel())}</span></div>
        <p class="decision-note"><strong>تنبيه:</strong> أرقام التحصيل والسيولة هنا نموذج أولي للمساعدة على المتابعة، وليست قرار سيولة نهائي بعد. لا تعتمدها وحدها للدفع أو الشراء قبل اكتمال ربط السيولة الفعلية والتزامات الموردين.</p>
        <div class="decision-kpis">
          <article class="decision-kpi"><small>الحد الأدنى التحليلي للتحصيل</small><strong dir="ltr">${money(target.minimum)}</strong><span>تقدير أولي لتخفيف ضغط الذمم</span></article>
          <article class="decision-kpi"><small>الهدف التحليلي المريح</small><strong dir="ltr">${money(target.comfortable)}</strong><span>تقدير أولي وليس اعتماد دفع نهائي</span></article>
          <article class="decision-kpi"><small>زبائن خطر مرتفع</small><strong>${redCount}</strong><span>يفضّل عدم زيادة الآجل</span></article>
          <article class="decision-kpi"><small>أصناف شراء عاجل</small><strong>${urgentBuy}</strong><span>عند توفر سرعة المبيع تكون هي أساس التقييم</span></article>
        </div>
      </section>
      <section class="panel wide decision-section"><div class="panel-title-row"><div><h2 style="margin:0">💵 التحصيل والخطر الائتماني</h2></div><button class="button secondary" type="button" data-route="balances">فتح أرصدة الزبائن</button></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>الزبون</th><th>الرصيد</th><th>حد الائتمان</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${collectionRows || '<tr><td colspan="5" class="muted">لا توجد أرصدة مدينة متاحة حالياً.</td></tr>'}</tbody></table></div></section>
      <section class="panel wide decision-section"><div class="panel-title-row"><div><h2 style="margin:0">🚚 أولوية الموردين</h2></div><button class="button secondary" type="button" data-route="purchases">فتح المشتريات</button></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>#</th><th>المورد</th><th>الالتزام المؤكد</th><th>بيانات الفواتير</th><th>الأولوية</th></tr></thead><tbody>${supplierRows || '<tr><td colspan="5" class="muted">لا تتوفر التزامات موردين كافية للحساب حالياً.</td></tr>'}</tbody></table></div></section>
      <section class="panel wide decision-section"><div class="panel-title-row"><div><h2 style="margin:0">📦 أولوية الأصناف</h2></div><button class="button secondary" type="button" data-route="warehouses">فتح المستودعات</button></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>الصنف</th><th>المخزون</th><th>مبيع 30 يوم</th><th>الأولوية</th><th>الحالة</th></tr></thead><tbody>${purchaseRows || '<tr><td colspan="5" class="muted">لا توجد أصناف معتمدة متاحة حالياً.</td></tr>'}</tbody></table></div><p class="decision-note">إذا لم تتوفر سرعة المبيع يظهر الصنف كـ «تقدير احتياطي» ولا يُعامل كتوصية شراء نهائية. التحديث يعمل تلقائياً كل دقيقة أثناء فتح الصفحة.</p></section>
    `);
  }

  function addDecisionNav() {
    if (document.querySelector('aside .sidebar nav [data-route="decision"], aside nav [data-route="decision"]')) return;
    const nav = document.querySelector("aside .sidebar nav, aside nav, .sidebar nav");
    if (!nav) return;
    const template = nav.querySelector("[data-route]");
    const button = document.createElement(template?.tagName === "A" ? "a" : "button");
    button.className = template?.className || "nav-link";
    button.textContent = "📌 قرار اليوم";
    button.dataset.route = ROUTE;
    if (button.tagName === "A") button.href = "?route=decision";
    button.addEventListener("click", (event) => { event.preventDefault(); setRoute(ROUTE); });
    nav.insertBefore(button, nav.firstChild);
  }

  async function refreshDecisionData() {
    if (refreshBusy || state?.route !== ROUTE || !state?.session) return;
    if (!navigator.onLine) { lastRefreshState = "offline"; if (state.route === ROUTE) render(); return; }
    refreshBusy = true;
    try {
      const jobs = [];
      if (window.tobaccoData?.listCustomerBalanceReports) jobs.push(window.tobaccoData.listCustomerBalanceReports().then((value) => { state.customerBalanceReports = value || []; }));
      if (window.tobaccoData?.listCustomerCreditLimits) jobs.push(window.tobaccoData.listCustomerCreditLimits().then((value) => { state.customerCreditLimits = value || []; }));
      if (window.tobaccoData?.listApprovedPriceItems) jobs.push(window.tobaccoData.listApprovedPriceItems().then((value) => { state.approvedPriceItems = value || []; }));
      if (window.tobaccoData?.getPurchaseInvoicesAmeenReport) jobs.push(window.tobaccoData.getPurchaseInvoicesAmeenReport().then((value) => { state.poAmeenReport = value || null; }));
      if (window.tobaccoData?.listAmeenItemSnapshot) jobs.push(window.tobaccoData.listAmeenItemSnapshot().then((value) => { state.ameenItemSnapshot = value || []; }));
      if (!jobs.length) { lastRefreshState = "error"; if (state.route === ROUTE) render(); return; }
      const results = await Promise.allSettled(jobs);
      const fulfilled = results.filter((result) => result.status === "fulfilled").length;
      const rejected = results.length - fulfilled;
      if (fulfilled > 0) lastRefreshAt = new Date();
      lastRefreshState = fulfilled === 0 ? "error" : rejected > 0 ? "partial" : "ok";
      if (state.route === ROUTE) render();
    } catch (error) {
      lastRefreshState = "error";
      console.error("[OZK Decision Refresh]", error);
      if (state.route === ROUTE) render();
    } finally { refreshBusy = false; }
  }

  function syncRefreshTimer() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (state?.route === ROUTE && state?.session) refreshTimer = setInterval(refreshDecisionData, REFRESH_MS);
  }

  try {
    allowedRoutes.add(ROUTE);
    const requestedRoute = new URLSearchParams(window.location.search).get("route");
    if (requestedRoute === ROUTE) state.route = ROUTE;
    const baseRender = render;
    render = function decisionAwareRender() {
      if (state.route === ROUTE) {
        app.innerHTML = decisionPage();
        app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); setRoute(button.dataset.route); }));
        addDecisionNav();
        syncRefreshTimer();
        return;
      }
      baseRender();
      addDecisionNav();
      syncRefreshTimer();
    };
    window.addEventListener("online", () => { lastRefreshState = "idle"; if (state?.route === ROUTE) refreshDecisionData(); });
    window.addEventListener("offline", () => { lastRefreshState = "offline"; if (state?.route === ROUTE) render(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state?.route === ROUTE) refreshDecisionData(); });
    render();
    if (state?.route === ROUTE) setTimeout(refreshDecisionData, 0);
  } catch (error) { console.error("[OZK Decision Engine]", error); }
})();
