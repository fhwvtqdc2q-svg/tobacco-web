(function () {
  "use strict";

  const ROUTE = "command";
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  let loading = false;
  let ameenLoading = false;
  let ameenStatus = null;
  let snapshot = null;
  let metrics = null;
  let executiveBrief = null;
  let answer = null;
  let lastError = null;
  let lastUpdatedAt = null;

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value, currency = "USD") => `${Math.round(number(value)).toLocaleString("en-US")} ${currency === "USD" ? "$" : escape(currency || "")}`;
  const liveCache = () => window.ozkAmeenLiveCache || null;
  function liveTime(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—"; }
  function friendlyAmeenError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (/auth|unauthorized|forbidden|session/.test(message)) return "انتهت جلسة الدخول أو لا تملك صلاحية القراءة. سجّل الدخول ثم حاول مجدداً.";
    if (/timed out|expired|timeout/.test(message)) return "تأخرت استجابة جهاز الأمين. تأكد أن خدمة القراءة تعمل ثم حاول مجدداً.";
    if (/fetch|network|offline/.test(message)) return "تعذر الوصول إلى خدمة القراءة حالياً. تحقق من الاتصال وحاول مجدداً.";
    return "تعذر إكمال القراءة من الأمين حالياً. حاول مجدداً بعد قليل.";
  }

  function levelLabel(level) { return ({ critical: "حرج", high: "مرتفع", watch: "مراقبة", stable: "مستقر", normal: "طبيعي", strong: "قوية", usable: "مقبولة", weak: "ضعيفة", poor: "ضعيفة جداً" }[level] || "غير محدد"); }
  function severityClass(score) { return score >= 70 ? "critical" : score >= 40 ? "high" : score >= 20 ? "watch" : "stable"; }

  function executiveCard(row, index) {
    const agent = executiveBrief?.agents?.[row.agent] || { icon: "🧠", name: "الفريق التنفيذي" };
    return `<article class="command-priority ${severityClass(row.severity)}"><div class="command-priority-rank">${index + 1}</div><div class="command-priority-body"><div class="command-priority-head"><strong>${escape(row.title)}</strong><span class="command-agent">${escape(agent.icon)} ${escape(agent.name)}</span></div><p><strong>ليش؟</strong> ${escape(row.why)}</p><p><strong>الإجراء:</strong> ${escape(row.action)}</p><div class="command-priority-actions"><span class="command-score">ضغط ${Math.round(number(row.severity))}/100</span><button class="button secondary" type="button" data-route="${escape(row.route || "overview")}">فتح القسم</button></div></div></article>`;
  }

  function answerQuestion(question) {
    if (!executiveBrief) return null;
    const items = executiveBrief.executiveOrder || [], q = String(question || "today");
    if (q === "today") return { title: "شو أعمل اليوم؟", body: executiveBrief.headline, items: items.slice(0, 3) };
    if (q === "risk") { const risky = items.filter((x) => x.severity >= 40).slice(0, 3); return { title: "وين أكبر خطر؟", body: risky.length ? `عندك ${risky.length} ملفات ضغط مرتفع تحتاج انتباه.` : "ما في ضغط مرتفع ظاهر حالياً.", items: risky }; }
    if (q === "collections") { const rows = items.filter((x) => x.agent === "collections"); return { title: "مين لازم أراجع للتحصيل؟", body: rows.length ? rows[0].action : "ما في إشارة تحصيل مرتفعة حالياً من البيانات المتاحة.", items: rows.slice(0, 2) }; }
    if (q === "buy") {
      const urgent = Array.isArray(snapshot?.inventory?.urgentItems) ? snapshot.inventory.urgentItems : [];
      const rows = urgent.slice(0, 8).map((item) => ({ agent: "inventory", action: `${item.name} · الكمية الحالية ${number(item.stock).toLocaleString("en-US")} · بحاجة مراجعة شراء` }));
      const source = snapshot?.inventory?.meta?.source === "ameen_live.stock" ? "مخزون Ameen Live الحالي" : "آخر مصدر مخزون متاح";
      return { title: "شو لازم أشتري؟", body: rows.length ? `الأولوية حسب ${source}. لا توجد قاعدة موثوقة حالياً لاختراع كمية طلب.` : `لا تظهر أصناف نافدة أو منخفضة التغطية في ${source}.`, items: rows };
    }
    return { title: "الخلاصة التنفيذية", body: executiveBrief.headline, items: items.slice(0, 3) };
  }

  function quickAnswerHtml() {
    if (!answer) return '<p class="muted">اختر سؤالاً حتى يعطيك الفريق جواباً موحداً من البيانات الحالية.</p>';
    const rows = (answer.items || []).map((row) => { const agent = executiveBrief?.agents?.[row.agent] || { icon: "🧠", name: "الفريق" }; return `<li><strong>${escape(agent.icon)} ${escape(agent.name)}:</strong> ${escape(row.action)}</li>`; }).join("");
    return `<div class="command-answer"><h3>${escape(answer.title)}</h3><p>${escape(answer.body)}</p>${rows ? `<ol>${rows}</ol>` : ""}</div>`;
  }

  function commandPage() {
    if (!state?.session) return shell(`<section class="panel"><h2>مركز القيادة</h2><p class="muted">سجّل الدخول أولاً.</p></section>`);
    if (!snapshot || !metrics || !executiveBrief) return shell(`<section class="panel wide command-center"><h2>🧠 مركز القيادة</h2><p class="muted">${loading ? "جاري تجميع صورة الشركة وتشغيل الفريق التنفيذي…" : escape(lastError || "لم تُحمّل البيانات بعد.")}</p></section>`);
    const updated = lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—";
    const receivables = number(snapshot.receivables?.total), debtors = number(snapshot.receivables?.debtorCount), collectedToday = snapshot.collections?.todayTotal ?? null, currency = snapshot.collections?.currency || "USD", urgentInventory = number(snapshot.inventory?.urgentReorderCount) + number(snapshot.inventory?.outOfStockCount), suppliers = number(snapshot.supplierObligations?.supplierCount);
    const cachedLive = liveCache(), liveConnected = snapshot.inventory?.meta?.source === "ameen_live.stock";
    const liveText = ameenLoading ? "جاري القراءة من الأمين…" : (liveConnected ? "الأمين مباشر: متصل" : (ameenStatus && !ameenStatus.startsWith("الأمين مباشر: متصل") ? escape(ameenStatus) : (cachedLive ? "انتهت حداثة القراءة الحية؛ اضغط تحديث من الأمين." : "قراءة مباشرة وآمنة من جهاز الأمين")));
    const liveUpdated = liveTime(cachedLive?.updatedAt);
    return shell(`
      <section class="panel wide command-center"><div class="command-hero"><div><span class="command-kicker">OZK BUSINESS OS · EXECUTIVE TEAM</span><h2>🧠 مركز القيادة</h2><p>${escape(executiveBrief.headline)}</p></div><div class="command-health ${escape(metrics.overall.level)}"><small>ضغط العمل</small><strong>${Math.round(number(metrics.overall.riskScore))}/100</strong><span>${levelLabel(metrics.overall.level)}</span></div></div><div class="command-meta"><span>ثقة البيانات: <strong>${Math.round(number(metrics.overall.confidenceScore))}%</strong></span><span>آخر تحديث: <strong>${escape(updated)}</strong></span><span>وضع الفريق: <strong>قراءة وتحليل فقط</strong></span>${lastError ? `<span class="command-warning">${escape(lastError)}</span>` : ""}</div><div class="command-kpis"><article><small>إجمالي الذمم</small><strong dir="ltr">${money(receivables, "USD")}</strong><span>${debtors} زبون مدين</span></article><article><small>تحصيل اليوم</small><strong dir="ltr">${collectedToday === null ? "غير متاح" : money(collectedToday, currency)}</strong><span>من تقرير الحركة اليومي</span></article><article><small>مخزون يحتاج تدخل</small><strong>${urgentInventory}</strong><span>نافد + شراء عاجل</span></article><article><small>موردون عليهم التزامات</small><strong>${suppliers}</strong><span>بدون خلط العملات</span></article></div></section>
      <section class="panel wide"><div class="panel-title-row"><div><h2 style="margin:0">🔌 الأمين مباشر</h2><p class="muted" style="margin:4px 0 0">${liveText}</p><p class="muted" style="margin:4px 0 0">آخر قراءة حية: <strong>${escape(liveUpdated)}</strong> · المواد <strong>${number(snapshot.inventory?.itemCount)}</strong> · النافد <strong>${number(snapshot.inventory?.outOfStockCount)}</strong> · منخفض التغطية <strong>${number(snapshot.inventory?.urgentReorderCount) + number(snapshot.inventory?.lowCoverCount)}</strong></p></div><button class="button" type="button" data-action="ameen-live-refresh" ${ameenLoading ? "disabled" : ""}>${ameenLoading ? "جاري التحديث…" : "تحديث من الأمين"}</button></div></section>
      <section class="panel wide command-questions"><div class="panel-title-row"><div><h2 style="margin:0">💬 اسأل فريقك التنفيذي</h2><p class="muted" style="margin:4px 0 0">أسئلة سريعة مبنية على بياناتك الحالية، بدون تخمين.</p></div><button class="button secondary" type="button" data-action="command-refresh">تحديث البيانات</button></div><div class="command-question-buttons"><button class="button secondary" data-question="today">شو أعمل اليوم؟</button><button class="button secondary" data-question="risk">وين أكبر خطر؟</button><button class="button secondary" data-question="collections">مين لازم أراجع للتحصيل؟</button><button class="button secondary" data-question="buy">شو لازم أشتري؟</button></div><div class="command-answer-wrap">${quickAnswerHtml()}</div></section>
      <section class="panel wide command-priorities"><div class="panel-title-row"><div><h2 style="margin:0">👥 رأي الفريق الموحّد</h2><p class="muted" style="margin:4px 0 0">الأقسام لا ترمي عليك تقارير منفصلة. المدير يجمعها ويرتبها هنا.</p></div></div><div class="command-priority-list">${executiveBrief.executiveOrder.map(executiveCard).join("") || '<p class="muted">الوضع مستقر ولا توجد أولوية مرتفعة حالياً.</p>'}</div></section>
      <section class="panel wide command-team"><h2>🧩 الفريق الحالي</h2><div class="command-team-grid">${Object.values(executiveBrief.agents).map((agent) => `<article><strong>${escape(agent.icon)} ${escape(agent.name)}</strong><span>${agent.id === "ceo" ? "يجمع الأولويات ويعطيك الخلاصة" : agent.id === "controller" ? "يراقب جودة وحداثة البيانات" : "يحلل نطاقه ويرفع توصية للمدير"}</span></article>`).join("")}</div></section>
      <section class="panel wide command-data-quality"><h2>🩺 صحة البيانات</h2><div class="command-quality-grid"><span>مصادر قديمة <strong>${number(snapshot.syncHealth?.staleCount)}</strong></span><span>مصادر ناقصة <strong>${number(snapshot.syncHealth?.missingCount)}</strong></span><span>الحالة <strong>${snapshot.dataQuality?.degraded ? "تحتاج انتباه" : "جيدة"}</strong></div></section>`);
  }

  async function refreshCommandCenter() {
    if (loading || state?.route !== ROUTE || !state?.session) return;
    loading = true; lastError = null;
    try { snapshot = await window.ozkBusinessOS?.getSnapshot?.(); if (!snapshot) throw new Error("Business Snapshot غير متاح."); metrics = await window.ozkBusinessMetrics?.getMetrics?.(snapshot); if (!metrics) throw new Error("Metrics Engine غير متاح."); executiveBrief = window.ozkExecutiveTeam?.buildBrief?.(snapshot, metrics) || null; if (!executiveBrief) throw new Error("Executive Team غير متاح."); answer = answerQuestion("today"); lastUpdatedAt = new Date(); }
    catch (error) { lastError = String(error?.message || error || "تعذر تحديث مركز القيادة."); console.error("[OZK Command Center]", error); }
    finally { loading = false; if (state?.route === ROUTE) render(); }
  }

  async function refreshFromAmeen() {
    if (ameenLoading || !state?.session) return;
    ameenLoading = true; ameenStatus = null; render();
    try {
      if (!window.ozkAmeenLive) throw new Error("Ameen Live Client غير متاح.");
      const [health, stock, customers] = await Promise.all([window.ozkAmeenLive.health(), window.ozkAmeenLive.stock(), window.ozkAmeenLive.customers()]);
      const stockCount = number(stock?.rowCount ?? stock?.rows?.length), customerCount = number(customers?.rowCount ?? customers?.rows?.length);
      window.ozkAmeenLiveCache = Object.freeze({ health, stock, customers, updatedAt: new Date().toISOString() });
      ameenStatus = `الأمين مباشر: متصل · مخزون ${stockCount} مادة · زبائن ${customerCount}`;
      await refreshCommandCenter();
    } catch (error) { ameenStatus = friendlyAmeenError(error); console.error("[OZK Ameen Live]", error); }
    finally { ameenLoading = false; if (state?.route === ROUTE) render(); }
  }

  function addCommandNav() { if (document.querySelector('[data-route="command"]')) return; const nav = document.querySelector("aside .sidebar nav, aside nav, .sidebar nav"); if (!nav) return; const template = nav.querySelector("[data-route]"); const button = document.createElement(template?.tagName === "A" ? "a" : "button"); button.className = template?.className || "nav-link"; button.textContent = "🧠 مركز القيادة"; button.dataset.route = ROUTE; if (button.tagName === "A") button.href = "?route=command"; button.addEventListener("click", (event) => { event.preventDefault(); setRoute(ROUTE); }); nav.insertBefore(button, nav.firstChild); }
  function bindCommandEvents() { app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); setRoute(button.dataset.route); })); app.querySelector("[data-action='command-refresh']")?.addEventListener("click", refreshCommandCenter); app.querySelector("[data-action='ameen-live-refresh']")?.addEventListener("click", refreshFromAmeen); app.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { answer = answerQuestion(button.dataset.question); render(); })); }
  function syncTimer() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = state?.route === ROUTE && state?.session ? setInterval(refreshCommandCenter, REFRESH_MS) : null; }

  try { allowedRoutes.add(ROUTE); if (new URLSearchParams(window.location.search).get("route") === ROUTE) state.route = ROUTE; const baseRender = render; render = function commandAwareRender() { if (state.route === ROUTE) { app.innerHTML = commandPage(); bindCommandEvents(); addCommandNav(); syncTimer(); return; } baseRender(); addCommandNav(); syncTimer(); }; window.ozkCommandCenter = Object.freeze({ answerQuestion, refresh: refreshCommandCenter, refreshFromAmeen }); render(); if (state?.route === ROUTE) setTimeout(refreshCommandCenter, 0); }
  catch (error) { console.error("[OZK Command Center Init]", error); }
})();

