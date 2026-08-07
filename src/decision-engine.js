(function () {
  const ROUTE = "decision";
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const num = (value) => {
    const n = Number(String(value ?? 0).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const money = (value) => `${Math.abs(num(value)).toLocaleString("en-US", { maximumFractionDigits: 0 })} $`;

  function balanceItems() {
    try {
      if (typeof latestCustomerBalanceItems === "function") return latestCustomerBalanceItems() || [];
    } catch {}
    const reports = Array.isArray(state?.customerBalanceReports) ? state.customerBalanceReports : [];
    const latest = reports[0] || null;
    return Array.isArray(latest?.items) ? latest.items : [];
  }

  function customerKey(row) {
    return String(row?.customerKey || row?.customer_key || row?.key || row?.guid || row?.name || "");
  }

  function customerName(row) {
    return String(row?.name || row?.customerName || row?.customer_name || "زبون");
  }

  function customerBalance(row) {
    return num(row?.balance ?? row?.debit ?? row?.amount ?? row?.remaining ?? 0);
  }

  function creditLimitFor(row) {
    const key = customerKey(row);
    const name = customerName(row).trim().toLowerCase();
    const limits = Array.isArray(state?.customerCreditLimits) ? state.customerCreditLimits : [];
    const match = limits.find((x) => String(x.customerKey || "") === key)
      || limits.find((x) => String(x.customerName || "").trim().toLowerCase() === name);
    return num(match?.creditLimit || 0);
  }

  function customerRiskRows() {
    return balanceItems()
      .map((row) => {
        const balance = Math.max(0, customerBalance(row));
        const limit = creditLimitFor(row);
        const ratio = limit > 0 ? balance / limit : 0;
        let score = 0;
        if (balance > 0) score += Math.min(45, Math.round(Math.log10(balance + 1) * 10));
        if (limit > 0) score += Math.min(55, Math.round(ratio * 55));
        if (ratio >= 1.25) score = Math.max(score, 95);
        else if (ratio >= 1) score = Math.max(score, 85);
        else if (ratio >= 0.9) score = Math.max(score, 70);
        const level = score >= 85 ? "red" : score >= 65 ? "orange" : score >= 40 ? "yellow" : "green";
        return { key: customerKey(row), name: customerName(row), balance, limit, ratio, score, level };
      })
      .filter((x) => x.balance > 0)
      .sort((a, b) => b.score - a.score || b.balance - a.balance);
  }

  function collectionTarget(risks) {
    const totalReceivables = risks.reduce((sum, x) => sum + x.balance, 0);
    const riskyReceivables = risks.filter((x) => x.level === "red" || x.level === "orange").reduce((sum, x) => sum + x.balance, 0);
    const base = Math.max(5000, Math.round(totalReceivables * 0.035));
    const pressure = Math.round(riskyReceivables * 0.08);
    const minimum = Math.min(totalReceivables, Math.max(base, pressure));
    const comfortable = Math.min(totalReceivables, Math.max(minimum, Math.round(minimum * 1.25)));
    return { totalReceivables, riskyReceivables, minimum, comfortable };
  }

  function purchaseSignals() {
    const items = Array.isArray(state?.approvedPriceItems) ? state.approvedPriceItems : [];
    return items.map((item) => {
      const stock = num(item.stockQty ?? item.stock_qty ?? 0);
      const status = String(item.stockStatus || item.stock_status || "").toLowerCase();
      let score = 20;
      if (stock <= 0 || /out|نفد|غير متوفر/.test(status)) score = 100;
      else if (stock <= 3) score = 90;
      else if (stock <= 7) score = 75;
      else if (stock <= 15) score = 55;
      return { name: item.itemName || item.item_name || "صنف", stock, score };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function supplierSignals() {
    const report = state?.poAmeenReport;
    const groups = Array.isArray(report?.items) ? report.items : [];
    return groups.map((supplier) => {
      const invoices = Array.isArray(supplier.invoices) ? supplier.invoices : [];
      const total = invoices.reduce((sum, inv) => sum + Math.max(0, num(inv.remaining ?? inv.remainingTotal ?? inv.total ?? 0)), 0);
      return { name: supplier.name || "مورد", total, invoiceCount: invoices.length };
    }).filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
  }

  function riskBadge(level) {
    const map = { red: ["خطر مرتفع", "danger"], orange: ["يحتاج تحصيل", "warning"], yellow: ["مراقبة", "pending"], green: ["طبيعي", "success"] };
    const [label, cls] = map[level] || map.green;
    return `<span class="status-chip decision-${cls}">${label}</span>`;
  }

  function decisionPage() {
    if (!state?.session) {
      return shell(`<section class="panel"><h2>قرار اليوم</h2><p class="muted">سجّل الدخول أولاً لعرض قرارات السيولة والتحصيل والموردين.</p></section>`);
    }
    const risks = customerRiskRows();
    const target = collectionTarget(risks);
    const suppliers = supplierSignals();
    const purchase = purchaseSignals();
    const redCount = risks.filter((x) => x.level === "red").length;
    const urgentBuy = purchase.filter((x) => x.score >= 90).length;

    const collectionRows = risks.slice(0, 10).map((x) => `<tr>
      <td><strong>${escape(x.name)}</strong></td>
      <td dir="ltr">${money(x.balance)}</td>
      <td dir="ltr">${x.limit > 0 ? money(x.limit) : "—"}</td>
      <td>${riskBadge(x.level)}</td>
      <td>${x.level === "red" ? "تحصيل قبل أي بيع آجل جديد" : x.level === "orange" ? "اتصال وتحديد دفعة اليوم" : "متابعة عادية"}</td>
    </tr>`).join("");

    const supplierRows = suppliers.map((x, i) => `<tr>
      <td>${i + 1}</td><td><strong>${escape(x.name)}</strong></td><td dir="ltr">${money(x.total)}</td><td>${escape(x.invoiceCount)}</td>
      <td>${i < 2 ? '<span class="status-chip decision-danger">أولوية عالية</span>' : '<span class="status-chip decision-pending">مراجعة</span>'}</td>
    </tr>`).join("");

    const purchaseRows = purchase.map((x) => `<tr>
      <td><strong>${escape(x.name)}</strong></td><td dir="ltr">${escape(x.stock)}</td>
      <td><strong>${escape(x.score)}</strong>/100</td><td>${x.score >= 90 ? '<span class="status-chip decision-danger">عاجل</span>' : x.score >= 70 ? '<span class="status-chip decision-warning">قريب</span>' : '<span class="status-chip decision-success">مستقر</span>'}</td>
    </tr>`).join("");

    return shell(`
      <section class="panel wide decision-page">
        <div class="panel-title-row"><div><h2 style="margin:0">📌 قرار اليوم</h2><p class="muted" style="margin:4px 0 0">ملخص تنفيذي للتحصيل، الخطر الائتماني، الموردين والمخزون — مبني على آخر بيانات متاحة حالياً.</p></div></div>
        <div class="decision-kpis">
          <article class="decision-kpi"><small>الحد الأدنى للتحصيل اليوم</small><strong dir="ltr">${money(target.minimum)}</strong><span>حتى يبقى ضغط السيولة تحت السيطرة</span></article>
          <article class="decision-kpi"><small>الهدف المريح</small><strong dir="ltr">${money(target.comfortable)}</strong><span>هدف أعلى يعطي مرونة للشراء والدفع</span></article>
          <article class="decision-kpi"><small>زبائن خطر مرتفع</small><strong>${redCount}</strong><span>يفضّل عدم زيادة الآجل قبل التحصيل</span></article>
          <article class="decision-kpi"><small>أصناف شراء عاجل</small><strong>${urgentBuy}</strong><span>حسب المخزون المتاح حالياً</span></article>
        </div>
      </section>

      <section class="panel wide decision-section">
        <div class="panel-title-row"><div><h2 style="margin:0">💵 التحصيل والخطر الائتماني</h2><p class="muted" style="margin:4px 0 0">الأولوية للرصيد المرتفع والمتجاوز أو القريب من حد الائتمان.</p></div><button class="button secondary" type="button" data-route="balances">فتح أرصدة الزبائن</button></div>
        <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>الزبون</th><th>الرصيد</th><th>حد الائتمان</th><th>الحالة</th><th>الإجراء المقترح</th></tr></thead><tbody>${collectionRows || '<tr><td colspan="5" class="muted">لا توجد أرصدة مدينة متاحة حالياً.</td></tr>'}</tbody></table></div>
      </section>

      <section class="panel wide decision-section">
        <div class="panel-title-row"><div><h2 style="margin:0">🚚 أولوية الموردين</h2><p class="muted" style="margin:4px 0 0">ترتيب مبدئي من بيانات فواتير المشتريات الحالية، وسيتطور مع تواريخ الاستحقاق وعروض الأسعار.</p></div><button class="button secondary" type="button" data-route="purchases">فتح المشتريات</button></div>
        <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>#</th><th>المورد</th><th>الرصيد/الالتزام الظاهر</th><th>فواتير</th><th>الأولوية</th></tr></thead><tbody>${supplierRows || '<tr><td colspan="5" class="muted">لا تتوفر التزامات موردين كافية للحساب حالياً.</td></tr>'}</tbody></table></div>
      </section>

      <section class="panel wide decision-section">
        <div class="panel-title-row"><div><h2 style="margin:0">📦 أولوية الأصناف</h2><p class="muted" style="margin:4px 0 0">هذه النسخة تعتمد المخزون الحالي؛ سرعة المبيع الدقيقة ستدخل تلقائياً بعد اكتمال تغذية اللقطة من Ameen.</p></div><button class="button secondary" type="button" data-route="warehouses">فتح المستودعات</button></div>
        <div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>الصنف</th><th>المخزون</th><th>درجة الأولوية</th><th>الحالة</th></tr></thead><tbody>${purchaseRows || '<tr><td colspan="4" class="muted">لا توجد أسعار/أصناف معتمدة متاحة حالياً.</td></tr>'}</tbody></table></div>
      </section>
    `);
  }

  function addDecisionNav() {
    const existing = document.querySelector('[data-route="decision"]');
    if (existing) return;
    const firstRoute = document.querySelector('[data-route]');
    const host = firstRoute?.parentElement;
    if (!host) return;
    const button = document.createElement(firstRoute.tagName === "A" ? "a" : "button");
    button.className = firstRoute.className;
    button.textContent = "📌 قرار اليوم";
    button.dataset.route = ROUTE;
    if (button.tagName === "A") button.href = "?route=decision";
    button.addEventListener("click", (event) => { event.preventDefault(); setRoute(ROUTE); });
    host.insertBefore(button, host.firstChild);
  }

  try {
    allowedRoutes.add(ROUTE);
    const baseRender = render;
    render = function decisionAwareRender() {
      if (state.route === ROUTE) {
        app.innerHTML = decisionPage();
        app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", (event) => {
          event.preventDefault();
          setRoute(button.dataset.route);
        }));
        addDecisionNav();
        return;
      }
      baseRender();
      addDecisionNav();
    };
    render();
  } catch (error) {
    console.error("[OZK Decision Engine]", error);
  }
})();