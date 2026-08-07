(function () {
  const ROUTE = "decision";
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  let refreshBusy = false;
  let lastRefreshAt = null;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const num = (value) => { const n = Number(String(value ?? 0).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
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
    const key = customerKey(row), name = customerName(row).trim().toLowerCase();
    const limits = Array.isArray(state?.customerCreditLimits) ? state.customerCreditLimits : [];
    const match = limits.find((x) => String(x.customerKey || "") === key) || limits.find((x) => String(x.customerName || "").trim().toLowerCase() === name);
    return num(match?.creditLimit || 0);
  }
  function customerRiskRows() {
    return balanceItems().map((row) => {
      const balance = Math.max(0, customerBalance(row)), limit = creditLimitFor(row), ratio = limit > 0 ? balance / limit : 0;
      let score = balance > 0 ? Math.min(45, Math.round(Math.log10(balance + 1) * 10)) : 0;
      if (limit > 0) score += Math.min(55, Math.round(ratio * 55));
      if (ratio >= 1.25) score = Math.max(score, 95); else if (ratio >= 1) score = Math.max(score, 85); else if (ratio >= .9) score = Math.max(score, 70);
      const level = score >= 85 ? "red" : score >= 65 ? "orange" : score >= 40 ? "yellow" : "green";
      return { name: customerName(row), balance, limit, score, level };
    }).filter((x) => x.balance > 0).sort((a,b) => b.score-a.score || b.balance-a.balance);
  }
  function collectionTarget(risks) {
    const totalReceivables = risks.reduce((s,x)=>s+x.balance,0), riskyReceivables = risks.filter((x)=>x.level==="red"||x.level==="orange").reduce((s,x)=>s+x.balance,0);
    const minimum = Math.min(totalReceivables, Math.max(5000, Math.round(totalReceivables*.035), Math.round(riskyReceivables*.08)));
    return { minimum, comfortable: Math.min(totalReceivables, Math.max(minimum, Math.round(minimum*1.25))) };
  }
  function purchaseSignals() {
    return (Array.isArray(state?.approvedPriceItems) ? state.approvedPriceItems : []).map((item) => {
      const stock=num(item.stockQty??item.stock_qty??0), status=String(item.stockStatus||item.stock_status||"").toLowerCase(); let score=20;
      if(stock<=0||/out|نفد|غير متوفر/.test(status))score=100;else if(stock<=3)score=90;else if(stock<=7)score=75;else if(stock<=15)score=55;
      return{name:item.itemName||item.item_name||"صنف",stock,score};
    }).sort((a,b)=>b.score-a.score).slice(0,8);
  }
  function supplierSignals() {
    return (Array.isArray(state?.poAmeenReport?.items)?state.poAmeenReport.items:[]).map((supplier)=>{const invoices=Array.isArray(supplier.invoices)?supplier.invoices:[];return{name:supplier.name||"مورد",total:invoices.reduce((s,inv)=>s+Math.max(0,num(inv.remaining??inv.remainingTotal??inv.total??0)),0),invoiceCount:invoices.length};}).filter((x)=>x.total>0).sort((a,b)=>b.total-a.total).slice(0,8);
  }
  function riskBadge(level){const map={red:["خطر مرتفع","danger"],orange:["يحتاج تحصيل","warning"],yellow:["مراقبة","pending"],green:["طبيعي","success"]};const [label,cls]=map[level]||map.green;return `<span class="status-chip decision-${cls}">${label}</span>`;}
  function liveLabel(){return lastRefreshAt ? `تحديث تلقائي · ${lastRefreshAt.toLocaleTimeString("ar",{hour:"2-digit",minute:"2-digit"})}` : "تحديث تلقائي كل دقيقة";}

  function decisionPage(){
    if(!state?.session)return shell(`<section class="panel"><h2>قرار اليوم</h2><p class="muted">سجّل الدخول أولاً لعرض قرارات السيولة والتحصيل والموردين.</p></section>`);
    const risks=customerRiskRows(),target=collectionTarget(risks),suppliers=supplierSignals(),purchase=purchaseSignals(),redCount=risks.filter((x)=>x.level==="red").length,urgentBuy=purchase.filter((x)=>x.score>=90).length;
    const collectionRows=risks.slice(0,10).map((x)=>`<tr><td><strong>${escape(x.name)}</strong></td><td dir="ltr">${money(x.balance)}</td><td dir="ltr">${x.limit>0?money(x.limit):"—"}</td><td>${riskBadge(x.level)}</td><td>${x.level==="red"?"تحصيل قبل أي بيع آجل جديد":x.level==="orange"?"اتصال وتحديد دفعة اليوم":"متابعة عادية"}</td></tr>`).join("");
    const supplierRows=suppliers.map((x,i)=>`<tr><td>${i+1}</td><td><strong>${escape(x.name)}</strong></td><td dir="ltr">${money(x.total)}</td><td>${escape(x.invoiceCount)}</td><td>${i<2?'<span class="status-chip decision-danger">أولوية عالية</span>':'<span class="status-chip decision-pending">مراجعة</span>'}</td></tr>`).join("");
    const purchaseRows=purchase.map((x)=>`<tr><td><strong>${escape(x.name)}</strong></td><td dir="ltr">${escape(x.stock)}</td><td><strong>${escape(x.score)}</strong>/100</td><td>${x.score>=90?'<span class="status-chip decision-danger">عاجل</span>':x.score>=70?'<span class="status-chip decision-warning">قريب</span>':'<span class="status-chip decision-success">مستقر</span>'}</td></tr>`).join("");
    return shell(`<section class="panel wide decision-page"><div class="panel-title-row"><div><h2 style="margin:0">📌 قرار اليوم</h2><p class="muted" style="margin:4px 0 0">ملخص تنفيذي مبني على آخر بيانات متاحة.</p></div><span class="decision-live ${navigator.onLine?"":"offline"}"><i class="decision-live-dot"></i>${escape(liveLabel())}</span></div><div class="decision-kpis"><article class="decision-kpi"><small>الحد الأدنى للتحصيل اليوم</small><strong dir="ltr">${money(target.minimum)}</strong><span>لتخفيف ضغط السيولة</span></article><article class="decision-kpi"><small>الهدف المريح</small><strong dir="ltr">${money(target.comfortable)}</strong><span>مرونة أعلى للشراء والدفع</span></article><article class="decision-kpi"><small>زبائن خطر مرتفع</small><strong>${redCount}</strong><span>يفضّل عدم زيادة الآجل</span></article><article class="decision-kpi"><small>أصناف شراء عاجل</small><strong>${urgentBuy}</strong><span>حسب المخزون الحالي</span></article></div></section>
    <section class="panel wide decision-section"><div class="panel-title-row"><div><h2 style="margin:0">💵 التحصيل والخطر الائتماني</h2></div><button class="button secondary" type="button" data-route="balances">فتح أرصدة الزبائن</button></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>الزبون</th><th>الرصيد</th><th>حد الائتمان</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${collectionRows||'<tr><td colspan="5" class="muted">لا توجد أرصدة مدينة متاحة حالياً.</td></tr>'}</tbody></table></div></section>
    <section class="panel wide decision-section"><div class="panel-title-row"><div><h2 style="margin:0">🚚 أولوية الموردين</h2></div><button class="button secondary" type="button" data-route="purchases">فتح المشتريات</button></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>#</th><th>المورد</th><th>الالتزام الظاهر</th><th>فواتير</th><th>الأولوية</th></tr></thead><tbody>${supplierRows||'<tr><td colspan="5" class="muted">لا تتوفر التزامات موردين كافية للحساب حالياً.</td></tr>'}</tbody></table></div></section>
    <section class="panel wide decision-section"><div class="panel-title-row"><div><h2 style="margin:0">📦 أولوية الأصناف</h2></div><button class="button secondary" type="button" data-route="warehouses">فتح المستودعات</button></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>الصنف</th><th>المخزون</th><th>الأولوية</th><th>الحالة</th></tr></thead><tbody>${purchaseRows||'<tr><td colspan="4" class="muted">لا توجد أصناف معتمدة متاحة حالياً.</td></tr>'}</tbody></table></div><p class="decision-note">التحديث يعمل أثناء بقاء الصفحة مفتوحة. إذا انقطع الإنترنت تبقى آخر بيانات ظاهرة، وعند عودة الاتصال تتم إعادة المحاولة تلقائياً.</p></section>`);
  }
  function addDecisionNav(){const existing=document.querySelector('[data-route="decision"]');if(existing)return;const firstRoute=document.querySelector('[data-route]'),host=firstRoute?.parentElement;if(!host)return;const button=document.createElement(firstRoute.tagName==="A"?"a":"button");button.className=firstRoute.className;button.textContent="📌 قرار اليوم";button.dataset.route=ROUTE;if(button.tagName==="A")button.href="?route=decision";button.addEventListener("click",(e)=>{e.preventDefault();setRoute(ROUTE);});host.insertBefore(button,host.firstChild);}
  async function refreshDecisionData(){
    if(refreshBusy||state?.route!==ROUTE||!state?.session||!navigator.onLine)return;refreshBusy=true;
    try{
      const jobs=[];
      if(window.tobaccoData?.listCustomerBalanceReports)jobs.push(window.tobaccoData.listCustomerBalanceReports().then((v)=>{state.customerBalanceReports=v||[];}));
      if(window.tobaccoData?.listCustomerCreditLimits)jobs.push(window.tobaccoData.listCustomerCreditLimits().then((v)=>{state.customerCreditLimits=v||[];}));
      if(window.tobaccoData?.listApprovedPriceItems)jobs.push(window.tobaccoData.listApprovedPriceItems().then((v)=>{state.approvedPriceItems=v||[];}));
      if(window.tobaccoData?.getPurchaseInvoicesAmeenReport)jobs.push(window.tobaccoData.getPurchaseInvoicesAmeenReport().then((v)=>{state.poAmeenReport=v||null;}));
      await Promise.allSettled(jobs);lastRefreshAt=new Date();if(state.route===ROUTE)render();
    }finally{refreshBusy=false;}
  }
  function syncRefreshTimer(){if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}if(state?.route===ROUTE&&state?.session){refreshTimer=setInterval(refreshDecisionData,REFRESH_MS);}}
  try{
    allowedRoutes.add(ROUTE);const baseRender=render;
    render=function decisionAwareRender(){if(state.route===ROUTE){app.innerHTML=decisionPage();app.querySelectorAll("[data-route]").forEach((button)=>button.addEventListener("click",(e)=>{e.preventDefault();setRoute(button.dataset.route);}));addDecisionNav();syncRefreshTimer();return;}baseRender();addDecisionNav();syncRefreshTimer();};
    window.addEventListener("online",()=>{if(state?.route===ROUTE)refreshDecisionData();});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state?.route===ROUTE)refreshDecisionData();});
    render();if(state?.route===ROUTE)setTimeout(refreshDecisionData,0);
  }catch(error){console.error("[OZK Decision Engine]",error);}
})();