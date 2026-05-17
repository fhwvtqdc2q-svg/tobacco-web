const appConfig = window.appConfig;
const roadmapItems = window.roadmapItems;
const monitoringCards = window.monitoringCards;
const remoteServices = window.remoteServices;
const dataStore = window.tobaccoData;

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function formValue(form, name) {
  return String(new FormData(form).get(name) || "").trim();
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${text}"`;
}

function normalizeItemName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\d{2,}\s*[-–—]\s*/u, "")
    .replace(/[ـًٌٍَُِّْ]/gu, "")
    .replace(/[إأآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "غير معروف";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function sourceLabel(source) {
  return (
    {
      ameen_sql_agent: "مزامنة مباشرة من الأمين",
      ameen_excel: "ملف Excel من الأمين"
    }[source] || source || "غير معروف"
  );
}

function minutesSince(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function syncFreshnessLabel(value) {
  const minutes = minutesSince(value);
  if (minutes === null) return "لم يتم تحديد وقت المزامنة";
  if (minutes <= 2) return "محدث الآن";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  return `قبل ${Math.round(minutes / 60)} ساعة`;
}

const state = {
  route: "overview",
  installPrompt: null,
  completed: new Set(readJson("completed-items", [])),
  session: null,
  requests: [],
  inventoryReports: [],
  lastInventoryRefresh: null,
  priceExport: null,
  loading: true,
  notice: null
};

const app = document.querySelector("#app");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  render();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("public/service-worker.js").catch(() => {});
  });
}

function setNotice(type, text) {
  state.notice = { type, text };
}

async function boot() {
  await refreshSession();
  await loadRequests();
  await loadInventoryReports();
  state.loading = false;
  render();
}

async function refreshSession() {
  try {
    state.session = await dataStore.getSession();
  } catch (error) {
    state.session = null;
    setNotice("error", `تعذر فحص تسجيل الدخول: ${error.message}`);
  }
}

async function loadRequests() {
  try {
    if (dataStore.isConfigured() && !state.session) {
      state.requests = [];
      return;
    }
    state.requests = await dataStore.listRequests();
  } catch (error) {
    state.requests = dataStore.defaultRequests;
    setNotice("error", `تعذر تحميل الطلبات: ${error.message}`);
  }
}

async function loadInventoryReports() {
  try {
    if (dataStore.isConfigured() && !state.session) {
      state.inventoryReports = [];
      state.lastInventoryRefresh = null;
      return;
    }
    state.inventoryReports = await dataStore.listInventoryReports();
    state.lastInventoryRefresh = new Date().toISOString();
  } catch {
    state.inventoryReports = [];
  }
}

function setRoute(route, clearNotice = true) {
  state.route = route;
  if (clearNotice) state.notice = null;
  render();
}

function toggleItem(id) {
  if (state.completed.has(id)) {
    state.completed.delete(id);
  } else {
    state.completed.add(id);
  }
  writeJson("completed-items", [...state.completed]);
  render();
}

async function saveSession(form, action) {
  try {
    const input = {
      name: formValue(form, "name"),
      role: formValue(form, "role"),
      email: formValue(form, "email"),
      password: formValue(form, "password")
    };

    const result = action === "signup" ? await dataStore.signUp(input) : await dataStore.signIn(input);
    state.session = result.session || (await dataStore.getSession());

    if (result.needsEmailConfirmation) {
      setNotice("success", "تم إنشاء الحساب. إذا كان تأكيد البريد مفعلا في Supabase، افتح البريد ثم سجل الدخول.");
    } else {
      setNotice("success", dataStore.isConfigured() ? "تم تسجيل الدخول عبر Supabase." : "تم تسجيل الدخول التجريبي محليا.");
    }

    await loadRequests();
    await loadInventoryReports();
    setRoute("overview", false);
  } catch (error) {
    setNotice("error", error.message);
    render();
  }
}

async function logout() {
  try {
    await dataStore.signOut();
    state.session = null;
    state.inventoryReports = [];
    setNotice("success", "تم تسجيل الخروج.");
  } catch (error) {
    setNotice("error", error.message);
  }
  render();
}

async function addRequest(form) {
  try {
    await dataStore.createRequest({
      customer: formValue(form, "customer"),
      channel: formValue(form, "channel"),
      type: formValue(form, "type"),
      note: formValue(form, "note")
    });
    await loadRequests();
    setNotice("success", dataStore.isConfigured() ? "تم حفظ الطلب في Supabase." : "تم حفظ الطلب محليا للتجربة.");
    setRoute("requests", false);
  } catch (error) {
    setNotice("error", error.message);
    if (/سجل الدخول/i.test(error.message)) state.route = "login";
    render();
  }
}

async function updateRequest(id, status) {
  try {
    await dataStore.updateRequestStatus(id, status);
    await loadRequests();
    setNotice("success", "تم تحديث حالة الطلب.");
  } catch (error) {
    setNotice("error", error.message);
  }
  render();
}

function exportRequestsForAmeen() {
  if (!state.requests.length) {
    setNotice("error", "لا توجد طلبات لتصديرها.");
    render();
    return;
  }

  const headers = [
    "رقم الطلب",
    "اسم العميل",
    "القناة",
    "نوع الطلب",
    "الحالة",
    "الملاحظة",
    "تاريخ الإنشاء"
  ];
  const rows = state.requests.map((request) => [
    request.publicId || request.id,
    request.customer,
    request.channel,
    request.type,
    request.status,
    request.note,
    request.createdAt || ""
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tobacco-ameen-requests-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setNotice("success", "تم تصدير ملف CSV قابل للفتح في Excel وتجهيزه كخطوة أولى للتوافق مع الأمين.");
  render();
}

function assertExcelSupport() {
  if (!window.XLSX) {
    throw new Error("مكتبة قراءة Excel لم تتحمل بعد. حدث الصفحة ثم جرب مرة أخرى.");
  }
}

async function readWorkbookFile(file) {
  assertExcelSupport();
  const buffer = await file.arrayBuffer();
  return window.XLSX.read(buffer, { type: "array", cellDates: true });
}

function sheetRows(workbook, preferredNames = []) {
  const sheetName =
    workbook.SheetNames.find((name) => preferredNames.some((preferred) => name.includes(preferred))) ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return {
    sheetName,
    rows: window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
  };
}

function findHeaderRow(rows) {
  const index = rows.findIndex((row) =>
    row.some((cell) => String(cell).trim().includes("اسم المادة") || String(cell).trim() === "المادة")
  );
  if (index === -1) throw new Error("لم أجد عمود اسم المادة داخل ملف Excel.");
  return index;
}

function findColumn(header, candidates) {
  return header.findIndex((cell) => {
    const text = String(cell ?? "").trim();
    return candidates.some((candidate) => text.includes(candidate));
  });
}

function aggregateStockItems(rows, headerIndex, threshold) {
  const header = rows[headerIndex].map((cell) => String(cell ?? "").trim());
  const itemIndex = findColumn(header, ["اسم المادة", "المادة", "الصنف"]);
  const totalIndex = findColumn(header, ["الكمية الإجمالية", "الكمية الاجمالية", "إجمالي", "اجمالي"]);

  if (itemIndex < 0) throw new Error("ملف الجرد لا يحتوي على عمود اسم المادة.");
  const itemsByKey = new Map();

  rows.slice(headerIndex + 1).forEach((row) => {
    const name = String(row[itemIndex] ?? "").trim();
    const key = normalizeItemName(name);
    if (!name || !key || key === normalizeItemName("اسم المادة")) return;

    const qty =
      totalIndex >= 0
        ? toNumber(row[totalIndex])
        : row.reduce((sum, cell, index) => (index === itemIndex ? sum : sum + toNumber(cell)), 0);

    const current = itemsByKey.get(key);
    if (current) {
      current.stockQty += qty;
    } else {
      itemsByKey.set(key, {
        key,
        name,
        stockQty: qty,
        status: "active",
        priceListed: false,
        lowThreshold: threshold
      });
    }
  });

  return [...itemsByKey.values()];
}

async function parseStockWorkbook(file, threshold) {
  const workbook = await readWorkbookFile(file);
  const { sheetName, rows } = sheetRows(workbook, ["جرد", "مخزون"]);
  const headerIndex = findHeaderRow(rows);
  const items = aggregateStockItems(rows, headerIndex, threshold);
  if (!items.length) throw new Error("ملف الجرد لا يحتوي على مواد قابلة للقراءة.");
  return { sheetName, items };
}

async function parsePriceWorkbook(file) {
  const workbook = await readWorkbookFile(file);
  const { sheetName, rows } = sheetRows(workbook, ["لائحة", "اسعار", "أسعار"]);
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map((cell) => String(cell ?? "").trim());
  const itemIndex = findColumn(headers, ["اسم المادة", "المادة", "الصنف"]);
  if (itemIndex < 0) throw new Error("ملف الأسعار لا يحتوي على عمود اسم المادة.");
  const priceIndexes = headers
    .map((header, index) => (header.includes("سعر") ? index : -1))
    .filter((index) => index >= 0);

  const priceRows = rows
    .slice(headerIndex + 1)
    .filter((row) => normalizeItemName(row[itemIndex]))
    .map((row) => ({
      key: normalizeItemName(row[itemIndex]),
      name: String(row[itemIndex] ?? "").trim(),
      hasPrice: priceIndexes.some((index) => toNumber(row[index]) > 0),
      raw: headers.map((_, index) => row[index] ?? "")
    }));

  if (!priceRows.length) throw new Error("ملف الأسعار لا يحتوي على مواد قابلة للقراءة.");
  return { sheetName, headers, rows: priceRows, priceIndexes };
}

function movementSummary(currentItems, previousReport) {
  const previousItems = Array.isArray(previousReport?.items) ? previousReport.items : [];
  const previousMap = new Map(
    previousItems.map((item) => [item.key || normalizeItemName(item.name), Number(item.stockQty || 0)])
  );

  let activeMovement = 0;
  let staleMovement = 0;
  let restocked = 0;

  currentItems.forEach((item) => {
    if (!previousMap.has(item.key)) return;
    const previousQty = previousMap.get(item.key);
    const delta = Number(item.stockQty || 0) - previousQty;
    if (delta < 0) activeMovement += 1;
    if (delta === 0 && item.stockQty > 0) staleMovement += 1;
    if (delta > 0) restocked += 1;
  });

  return {
    activeMovement,
    staleMovement,
    restocked,
    previousReportDate: previousReport?.report_date || previousReport?.summary?.reportDate || ""
  };
}

function classifyInventoryItems(stockItems, priceRows, threshold) {
  const priceKeys = new Set((priceRows || []).map((row) => row.key));

  return stockItems.map((item) => {
    const priceListed = priceKeys.has(item.key);
    let status = "active";
    if (item.stockQty <= 0) status = "out";
    else if (item.stockQty <= threshold) status = "low";
    else if (priceRows && !priceListed) status = "stale";

    return {
      ...item,
      stockQty: Number(item.stockQty.toFixed(3)),
      status,
      priceListed
    };
  });
}

async function buildInventoryReport(stockFile, priceFile, threshold, previousReport) {
  const stock = await parseStockWorkbook(stockFile, threshold);
  const price = priceFile ? await parsePriceWorkbook(priceFile) : null;
  const availableKeys = new Set(stock.items.filter((item) => item.stockQty > 0).map((item) => item.key));
  const filteredPriceRows = price ? price.rows.filter((row) => availableKeys.has(row.key) && row.hasPrice) : [];
  const excludedPriceRows = price ? price.rows.filter((row) => !availableKeys.has(row.key)) : [];
  const zeroPriceRows = price ? price.rows.filter((row) => availableKeys.has(row.key) && !row.hasPrice) : [];
  const items = classifyInventoryItems(stock.items, price?.rows, threshold);
  const movement = movementSummary(items, previousReport);
  const summary = {
    reportDate: todayIsoDate(),
    stockFileName: stockFile.name,
    priceFileName: priceFile?.name || "",
    totalStockItems: items.length,
    availableItems: items.filter((item) => item.stockQty > 0).length,
    lowStockItems: items.filter((item) => item.status === "low").length,
    outOfStockItems: items.filter((item) => item.status === "out").length,
    staleItems: items.filter((item) => item.status === "stale").length,
    activeItems: items.filter((item) => item.status === "active").length,
    priceRows: price?.rows.length || 0,
    pricedRows: price?.rows.filter((row) => row.hasPrice).length || 0,
    zeroPriceRows: zeroPriceRows.length,
    exportedPriceRows: filteredPriceRows.length,
    excludedPriceRows: excludedPriceRows.length,
    threshold,
    ...movement
  };

  return {
    reportDate: summary.reportDate,
    source: "ameen_excel",
    summary,
    items,
    priceExport: price
      ? {
          sheetName: price.sheetName,
          headers: price.headers,
          rows: filteredPriceRows.map((row) => row.raw)
        }
      : null
  };
}

async function importAmeenReport(form) {
  try {
    const stockFile = form.elements.stock?.files?.[0];
    const priceFile = form.elements.price?.files?.[0] || null;
    const threshold = Math.max(0, toNumber(form.elements.lowThreshold?.value || 50));

    if (!stockFile) throw new Error("اختر ملف جرد الأمين أولا.");
    const report = await buildInventoryReport(stockFile, priceFile, threshold, state.inventoryReports[0]);
    state.priceExport = report.priceExport;
    await dataStore.createInventoryReport(report);
    await loadInventoryReports();

    setNotice(
      report.summary.zeroPriceRows ? "error" : "success",
      `تم حفظ تقرير الأمين. المواد القريبة من النفاد: ${report.summary.lowStockItems}، المستبعدة من لائحة الأسعار: ${report.summary.excludedPriceRows}، ومواد موجودة لكن بلا سعر: ${report.summary.zeroPriceRows}.`
    );
    setRoute("ameen", false);
  } catch (error) {
    setNotice("error", error.message);
    render();
  }
}

async function refreshAmeenReports() {
  try {
    await loadInventoryReports();
    setNotice("success", "تم تحديث تقارير الأمين من Supabase.");
    setRoute("ameen", false);
  } catch (error) {
    setNotice("error", error.message);
    render();
  }
}

function downloadFilteredPriceList() {
  if (!state.priceExport) {
    setNotice("error", "حلل ملف الأسعار أولا حتى أجهز نسخة المواد المتوفرة فقط.");
    render();
    return;
  }

  assertExcelSupport();
  if (!state.priceExport.rows.length) {
    setNotice("error", "لا توجد مواد بسعر صالح للتنزيل. ملف الأسعار الحالي يحتوي أسعارا صفرية أو فارغة للمواد المتوفرة.");
    render();
    return;
  }
  const worksheet = window.XLSX.utils.aoa_to_sheet([state.priceExport.headers, ...state.priceExport.rows]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "available-prices");
  window.XLSX.writeFile(workbook, `tobacco-available-prices-${todayIsoDate()}.xlsx`);
  setNotice("success", "تم تنزيل لائحة أسعار تحتوي فقط المواد الموجودة في المستودع.");
  render();
}

function downloadLatestInventoryReport() {
  const latest = state.inventoryReports[0];
  const items = reportItems(latest);
  if (!latest || !items.length) {
    setNotice("error", "لا يوجد تقرير جرد حي جاهز للتصدير.");
    render();
    return;
  }

  assertExcelSupport();
  const rows = items.map((item) => [
    item.name || "",
    Number(item.stockQty || 0),
    statusLabel(item.status),
    item.lowThreshold || latest.summary?.threshold || "",
    item.priceListed ? "نعم" : "لا"
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["المادة", "الكمية", "الحالة", "حد التنبيه", "ضمن لائحة الأسعار"],
    ...rows
  ]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "live-inventory");
  window.XLSX.writeFile(workbook, `tobacco-live-inventory-${todayIsoDate()}.xlsx`);
  setNotice("success", "تم تنزيل تقرير الجرد الحي من آخر مزامنة.");
  render();
}

async function installApp() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  render();
}

function completionPercent() {
  return Math.round((state.completed.size / roadmapItems.length) * 100);
}

function shell(content) {
  return `
    <div class="app-shell">
      <aside class="sidebar" aria-label="التنقل">
        <a class="brand" href="#" data-route="overview" aria-label="الرئيسية">
          <img src="public/icons/app-icon.svg" alt="">
          <span>${escapeHtml(appConfig.name)}</span>
        </a>
        <nav>
          ${navButton("overview", "الرئيسية")}
          ${navButton("login", "تسجيل الدخول")}
          ${navButton("requests", "طلبات العملاء")}
          ${navButton("ameen", "الأمين")}
          ${navButton("remote", "إدارة عن بعد")}
          ${navButton("monitoring", "المراقبة")}
          ${navButton("payments", "الدفع")}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <p class="eyebrow">${escapeHtml(appConfig.tagline)}</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="topbar-actions">
            ${state.installPrompt ? '<button class="button secondary" data-action="install">تثبيت</button>' : ""}
            ${state.session ? `<button class="button secondary" data-action="logout">${escapeHtml(state.session.name)}</button>` : ""}
            <a class="button primary" href="mailto:${escapeHtml(appConfig.supportEmail)}">الدعم</a>
          </div>
        </header>
        ${connectionNotice()}
        ${messagePanel()}
        ${state.loading ? loadingPanel() : content}
      </main>
    </div>
  `;
}

function connectionNotice() {
  if (location.protocol === "file:") {
    return `
      <section class="notice-panel warning">
        <strong>هذه نسخة محلية على اللابتوب.</strong>
        <span>للاستخدام من الايفون افتح رابط GitHub Pages، ولا تستخدم رابط <code>file:///C:/...</code>.</span>
      </section>
    `;
  }

  if (dataStore.isConfigured()) {
    return `
      <section class="notice-panel success">
        <strong>${escapeHtml(dataStore.statusLabel())}</strong>
        <span>الطلبات وتسجيل الدخول سيعملان من قاعدة البيانات. لا تضع مفتاح service_role داخل الواجهة أبدا.</span>
      </section>
    `;
  }

  return `
    <section class="notice-panel">
      <strong>${escapeHtml(dataStore.statusLabel())}</strong>
      <span>الموقع جاهز للربط. أضف رابط Supabase والمفتاح العام في <code>src/config.js</code> بعد إنشاء الجداول.</span>
    </section>
  `;
}

function messagePanel() {
  if (!state.notice) return "";
  return `<section class="message-panel ${state.notice.type}">${escapeHtml(state.notice.text)}</section>`;
}

function loadingPanel() {
  return `<section class="panel wide"><h2>جاري التحميل...</h2><p class="muted">نجهز بيانات التطبيق.</p></section>`;
}

function navButton(route, label) {
  const active = state.route === route ? "active" : "";
  return `<button class="nav-link ${active}" data-route="${route}">${label}</button>`;
}

function pageTitle() {
  return {
    overview: "لوحة TOBACCO",
    login: "تسجيل الدخول",
    requests: "طلبات العملاء",
    ameen: "تقارير الأمين",
    remote: "الإدارة عن بعد",
    monitoring: "المراقبة",
    payments: "الدفع"
  }[state.route];
}

function overview() {
  const done = completionPercent();
  const openRequests = state.requests.filter((request) => request.status !== "مغلق").length;

  return shell(`
    <section class="hero-panel business-hero">
      <div class="hero-copy">
        <p class="eyebrow">TOBACCO</p>
        <h2>منصة عربية لخدمة العملاء ومتابعة العمل عن بعد.</h2>
        <p>${escapeHtml(appConfig.description)}</p>
        <div class="metric-row">
          <div class="metric">
            <strong>${openRequests}</strong>
            <span>طلبات مفتوحة</span>
          </div>
          <div class="metric">
            <strong>${done}%</strong>
            <span>جاهزية الميزات</span>
          </div>
          <div class="metric">
            <strong>${dataStore.isConfigured() ? "Live" : "Demo"}</strong>
            <span>${dataStore.isConfigured() ? "قاعدة Supabase" : "حفظ محلي"}</span>
          </div>
        </div>
      </div>
      <div class="status-board">
        ${monitoringCards.map(statusCard).join("")}
      </div>
    </section>

    <section class="content-grid">
      <article class="panel">
        <h3>أولويات التشغيل</h3>
        <div class="task-list">
          ${roadmapItems.slice(0, 5).map(taskItem).join("")}
        </div>
      </article>
      <article class="panel">
        <h3>تشغيل اليوم</h3>
        <ol class="steps">
          <li>افتح صفحة تسجيل الدخول واستخدم الدخول التجريبي أو حساب Supabase بعد التفعيل.</li>
          <li>أضف طلب عميل من صفحة طلبات العملاء.</li>
          <li>راجع صفحة المراقبة لمعرفة حالة العمل.</li>
          <li>اترك الدفع كواجهة فقط إلى أن نختار مزودا مناسبا.</li>
        </ol>
      </article>
    </section>
  `);
}

function login() {
  const live = dataStore.isConfigured();
  return shell(`
    <section class="panel wide form-layout">
      <div>
        <p class="eyebrow">Access</p>
        <h2>دخول الموظفين والإدارة</h2>
        <p class="muted">
          ${live
            ? "هذا الدخول متصل بقاعدة Supabase. استخدم بريد وكلمة مرور لحساب موظف."
            : "هذا دخول تجريبي محلي الآن. بعد إضافة مفاتيح Supabase سيصبح الدخول حقيقيا."}
        </p>
      </div>
      <form class="form-card" data-form="login">
        <label>
          اسم المستخدم
          <input name="name" placeholder="مثال: أحمد من خدمة العملاء" autocomplete="name">
        </label>
        <label>
          الدور
          <select name="role">
            <option>خدمة العملاء</option>
            <option>الإدارة</option>
            <option>المراقبة</option>
            <option>الدعم الفني</option>
          </select>
        </label>
        <label class="${live ? "" : "optional-field"}">
          البريد
          <input name="email" type="email" placeholder="staff@example.com" autocomplete="email">
        </label>
        <label class="${live ? "" : "optional-field"}">
          كلمة المرور
          <input name="password" type="password" minlength="8" autocomplete="current-password">
        </label>
        <div class="button-row">
          <button class="button primary" type="submit" data-auth-action="signin">${live ? "دخول" : "دخول تجريبي"}</button>
        </div>
        ${live ? '<p class="muted">أنشئ حسابات الموظفين من Supabase Authentication لتجنب حد رسائل البريد.</p>' : ""}
        ${state.session ? `<p class="success-note">أنت داخل الآن باسم ${escapeHtml(state.session.name)} - ${escapeHtml(state.session.role)}</p>` : ""}
      </form>
    </section>
  `);
}

function requests() {
  const loginPrompt =
    dataStore.isConfigured() && !state.session
      ? '<p class="muted">سجل الدخول أولا حتى تظهر طلبات Supabase وتستطيع إضافة طلب جديد. إذا أنشأت الحساب للتو، قد تحتاج تأكيد البريد أولا.</p>'
      : "";

  return shell(`
    <section class="content-grid request-layout">
      <article class="panel">
        <h3>إضافة طلب عميل</h3>
        ${loginPrompt}
        <form class="form-card compact" data-form="request">
          <label>
            اسم العميل
            <input name="customer" maxlength="120" placeholder="اسم العميل أو رقم الطلب">
          </label>
          <label>
            القناة
            <select name="channel">
              <option>واتساب</option>
              <option>هاتف</option>
              <option>ويب</option>
              <option>زيارة فرع</option>
            </select>
          </label>
          <label>
            نوع الطلب
            <select name="type">
              <option>استفسار</option>
              <option>شكوى</option>
              <option>متابعة</option>
              <option>طلب خدمة</option>
            </select>
          </label>
          <label>
            ملاحظة
            <textarea name="note" rows="4" maxlength="1000" placeholder="اكتب ملخص الطلب"></textarea>
          </label>
          <button class="button primary" type="submit">حفظ الطلب</button>
        </form>
      </article>
      <article class="panel">
        <div class="panel-title-row">
          <h3>سجل الطلبات</h3>
          <button class="button secondary compact-button" type="button" data-action="export-ameen">تصدير للأمين</button>
        </div>
        <p class="muted">يصدر الملف بصيغة CSV تفتح في Excel. عند معرفة قالب استيراد الأمين لديك نطابق الأعمدة معه بدقة.</p>
        <div class="request-list">
          ${state.requests.length ? state.requests.map(requestCard).join("") : loginPrompt || '<p class="muted">لا توجد طلبات بعد.</p>'}
        </div>
      </article>
    </section>
  `);
}

function reportItems(report) {
  return Array.isArray(report?.items) ? report.items : [];
}

function reportSyncedAt(report) {
  return report?.summary?.syncedAt || report?.created_at || report?.summary?.reportDate || report?.report_date || "";
}

function statusLabel(status) {
  return {
    active: "فعالة",
    low: "قريبة من النفاد",
    out: "غير موجودة",
    stale: "راكدة"
  }[status] || status;
}

function inventoryMetric(label, value, detail = "") {
  return `
    <article class="inventory-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    </article>
  `;
}

function inventoryList(title, items, emptyText) {
  return `
    <article class="panel">
      <h3>${escapeHtml(title)}</h3>
      <div class="inventory-list">
        ${
          items.length
            ? items
                .slice(0, 12)
                .map(
                  (item) => `
                    <div class="inventory-row">
                      <strong>${escapeHtml(item.name)}</strong>
                      <span>${escapeHtml(statusLabel(item.status))} / الكمية: ${escapeHtml(item.stockQty)}</span>
                    </div>
                  `
                )
                .join("")
            : `<p class="muted">${escapeHtml(emptyText)}</p>`
        }
      </div>
    </article>
  `;
}

function ameen() {
  const latest = state.inventoryReports[0];
  const summary = latest?.summary || {};
  const items = reportItems(latest);
  const syncedAt = reportSyncedAt(latest);
  const negativeItems = items.filter((item) => Number(item.stockQty || 0) < 0);
  const zeroItems = items.filter((item) => Number(item.stockQty || 0) === 0);
  const lowOnlyItems = items.filter((item) => item.status === "low");
  const lowItems = [...negativeItems, ...zeroItems, ...lowOnlyItems]
    .sort((a, b) => Number(a.stockQty || 0) - Number(b.stockQty || 0));
  const staleItems = items.filter((item) => item.status === "stale");
  const activeItems = items.filter((item) => item.status === "active");
  const liveReport = latest?.source === "ameen_sql_agent" || summary.source === "ameen_sql_agent";
  const authHint =
    dataStore.isConfigured() && !state.session
      ? '<p class="muted">سجل الدخول حتى يتم حفظ التقرير في Supabase ويظهر على الآيفون عند فتح الموقع.</p>'
      : "";

  return shell(`
    <section class="content-grid request-layout">
      <article class="panel">
        <h3>رفع تقرير الأمين</h3>
        ${authHint}
        <p class="muted">اختر ملف الجرد التجميعي من الأمين، ثم اختر لائحة الأسعار اليومية. سأحفظ الملخص وأجهز نسخة أسعار تحتوي فقط المواد الموجودة في المستودع.</p>
        <form class="form-card compact" data-form="ameen-import">
          <label>
            ملف جرد الأمين
            <input name="stock" type="file" accept=".xlsx,.xls" required>
          </label>
          <label>
            ملف لائحة الأسعار اليومية
            <input name="price" type="file" accept=".xlsx,.xls">
          </label>
          <label>
            حد تنبيه قرب النفاد
            <input name="lowThreshold" type="number" min="0" step="1" value="${escapeHtml(summary.threshold || 50)}">
          </label>
          <div class="button-row">
            <button class="button primary" type="submit">تحليل وحفظ التقرير</button>
            <button class="button secondary" type="button" data-action="download-prices" ${state.priceExport ? "" : "disabled"}>تنزيل أسعار المتوفر فقط</button>
          </div>
        </form>
      </article>

      <article class="panel">
        <div class="panel-title-row">
          <h3>ملخص الهاتف</h3>
          <button class="button secondary compact-button" type="button" data-action="refresh-ameen">تحديث</button>
        </div>
        ${
          latest
            ? `<p class="muted">آخر مزامنة: ${escapeHtml(formatDateTime(syncedAt))} / ${escapeHtml(syncFreshnessLabel(syncedAt))}</p>
              <p class="muted">المصدر: ${escapeHtml(sourceLabel(latest.source || summary.source))}${liveReport ? " / مباشر من قاعدة الأمين" : ""}</p>
              <div class="button-row report-actions">
                <button class="button secondary" type="button" data-action="download-inventory">تصدير الجرد الحي</button>
              </div>
              <div class="inventory-metrics">
                ${inventoryMetric("مواد موجودة", summary.availableItems || 0, "من الجرد")}
                ${inventoryMetric("قريبة من النفاد", summary.lowStockItems || 0, `حد التنبيه: ${summary.threshold || 0}`)}
                ${inventoryMetric("غير موجودة", summary.outOfStockItems || 0, "لا تنزل في الأسعار")}
                ${inventoryMetric("مخزون سالب", negativeItems.length, "يحتاج مراجعة محاسبية")}
                ${inventoryMetric("مخزون صفر", zeroItems.length, "نفد من المستودع")}
                ${inventoryMetric("راكدة", summary.staleItems || 0, "موجودة ولا تظهر في الأسعار")}
                ${inventoryMetric("فعالة", summary.activeItems || 0, "موجودة وتظهر في الأسعار")}
                ${inventoryMetric("استبعاد أسعار", summary.excludedPriceRows || 0, "غير موجودة في المستودع")}
                ${inventoryMetric("بلا سعر", summary.zeroPriceRows || 0, "موجودة لكن سعرها صفر")}
              </div>`
            : '<p class="muted">لم تحفظ تقرير جرد بعد. ارفع ملف الجرد اليومي حتى يظهر الملخص هنا وعلى الآيفون.</p>'
        }
      </article>
    </section>

    ${
      latest
        ? `<section class="content-grid">
            ${inventoryList("تنبيهات قرب النفاد", lowItems, "لا توجد مواد قريبة من النفاد حسب الحد الحالي.")}
            ${inventoryList("مواد راكدة", staleItems, "لا توجد مواد راكدة من هذه المقارنة.")}
          </section>
          <section class="panel wide ameen-movement">
            <h3>حركة المواد والمقارنة</h3>
            <div class="inventory-metrics">
              ${inventoryMetric("تحركت", summary.activeMovement || 0, "انخفضت كميتها عن التقرير السابق")}
              ${inventoryMetric("بلا حركة", summary.staleMovement || 0, "نفس الكمية في تقريرين")}
              ${inventoryMetric("تم تزويدها", summary.restocked || 0, "زادت كميتها عن التقرير السابق")}
              ${inventoryMetric("المقارنة السابقة", summary.previousReportDate || "لا يوجد", "تحتاج تقريرين أو أكثر")}
            </div>
          </section>`
        : ""
    }
  `);
}

function remote() {
  return shell(`
    <section class="panel wide">
      <div class="section-head">
        <div>
          <p class="eyebrow">Remote Management</p>
          <h2>خدمة الإدارة عن بعد</h2>
        </div>
      </div>
      <div class="service-grid">
        ${remoteServices.map((service) => `<article><strong>${escapeHtml(service)}</strong><p>جاهزة كواجهة تشغيل، وتقرأ من قاعدة البيانات بعد ربط Supabase.</p></article>`).join("")}
      </div>
    </section>
  `);
}

function monitoring() {
  const openRequests = state.requests.filter((request) => request.status !== "مغلق").length;
  const closedRequests = state.requests.length - openRequests;
  const cards = [
    { label: "طلبات مفتوحة", value: String(openRequests), trend: "من سجل الطلبات" },
    { label: "طلبات مغلقة", value: String(closedRequests), trend: "تمت متابعتها" },
    ...monitoringCards.slice(1)
  ];

  return shell(`
    <section class="panel wide">
      <div class="section-head">
        <div>
          <p class="eyebrow">Monitoring</p>
          <h2>مراقبة خدمة العملاء</h2>
        </div>
      </div>
      <div class="status-board full">
        ${cards.map(statusCard).join("")}
      </div>
      <div class="audit-note">
        <strong>ملاحظة تشغيلية:</strong>
        <span>${dataStore.isConfigured() ? "هذه المؤشرات تقرأ من جدول الطلبات في Supabase." : "هذه المؤشرات تجريبية وتعتمد على الحفظ المحلي في هذا المتصفح."}</span>
      </div>
    </section>
  `);
}

function payments() {
  return shell(`
    <section class="panel wide form-layout">
      <div>
        <p class="eyebrow">Payments</p>
        <h2>الدفع الإلكتروني</h2>
        <p class="muted">واجهة الدفع جاهزة كتصميم، لكن التفعيل الحقيقي يحتاج حساب مزود دفع ومراجعة شروطه لنشاط الشركة وبلد التشغيل.</p>
      </div>
      <div class="payment-box">
        <strong>${escapeHtml(appConfig.paymentStatus)}</strong>
        <p>المرحلة التالية: اختيار مزود دفع مناسب، ثم وضع مفاتيح الاختبار في بيئة آمنة، وليس داخل الواجهة.</p>
        <button class="button primary" type="button" disabled>الدفع غير مفعل بعد</button>
      </div>
    </section>
  `);
}

function statusCard(item) {
  return `
    <article class="status-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.trend)}</small>
    </article>
  `;
}

function taskItem(item) {
  const checked = state.completed.has(item.id);
  return `
    <button class="task-item ${checked ? "done" : ""}" data-task="${escapeHtml(item.id)}">
      <span class="task-check">${checked ? "✓" : ""}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
        <em class="task-action">${checked ? "مفعلة" : "اضغط لتفعيل هذه الميزة"}</em>
      </span>
    </button>
  `;
}

function requestCard(request) {
  const nextStatus = request.status === "مغلق" ? "مفتوح" : "مغلق";
  return `
    <article class="request-card">
      <div>
        <strong>${escapeHtml(request.publicId || request.id)} - ${escapeHtml(request.customer)}</strong>
        <span>${escapeHtml(request.channel)} / ${escapeHtml(request.type)}</span>
      </div>
      <p>${escapeHtml(request.note)}</p>
      <div class="request-actions">
        <span class="status-chip">${escapeHtml(request.status)}</span>
        <button type="button" data-request="${escapeHtml(request.id)}" data-status="${nextStatus}">
          ${request.status === "مغلق" ? "إعادة فتح" : "إغلاق"}
        </button>
      </div>
    </article>
  `;
}

function render() {
  const pages = {
    overview,
    login,
    requests,
    ameen,
    remote,
    monitoring,
    payments
  };

  app.innerHTML = pages[state.route]();

  app.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setRoute(button.dataset.route);
    });
  });

  app.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", () => toggleItem(button.dataset.task));
  });

  app.querySelector("[data-action='install']")?.addEventListener("click", installApp);
  app.querySelector("[data-action='logout']")?.addEventListener("click", logout);
  app.querySelector("[data-action='export-ameen']")?.addEventListener("click", exportRequestsForAmeen);
  app.querySelector("[data-action='download-prices']")?.addEventListener("click", downloadFilteredPriceList);
  app.querySelector("[data-action='download-inventory']")?.addEventListener("click", downloadLatestInventoryReport);
  app.querySelector("[data-action='refresh-ameen']")?.addEventListener("click", refreshAmeenReports);

  app.querySelector("[data-form='login']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSession(event.currentTarget, event.submitter?.dataset.authAction || "signin");
  });

  app.querySelector("[data-form='request']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    addRequest(event.currentTarget);
  });

  app.querySelector("[data-form='ameen-import']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    importAmeenReport(event.currentTarget);
  });

  app.querySelectorAll("[data-request]").forEach((button) => {
    button.addEventListener("click", () => updateRequest(button.dataset.request, button.dataset.status));
  });
}

boot();

setInterval(() => {
  if (state.route === "ameen" && (!dataStore.isConfigured() || state.session)) {
    loadInventoryReports()
      .then(() => render())
      .catch(() => {});
  }
}, 60000);
