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
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDate(value) {
  if (!value) return "غير متوفر";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    dateStyle: "medium"
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
  customerBalanceReports: [],
  customerCreditLimits: [],
  customerLimitError: null,
  approvedPriceItems: [],
  approvedPriceError: null,
  lastInventoryRefresh: null,
  priceExport: null,
  ameenSearch: "",
  ameenFilter: "alerts",
  ameenSort: "qtyAsc",
  pricingSearch: "",
  customerSearch: "",
  customerFilter: "debit_balance",
  customerSort: "balanceDesc",
  selectedCustomerKey: "",
  loading: true,
  notice: null,
  aiMessages: [],
  aiProvider: "claude",
  aiLoading: false,
  aiSettingsOpen: false,
  invCustomer: "",
  invNotes: "",
  invRows: [{ name: "", qty: "1", price: "" }],
  notifPermission: "default",
  seenRequestIds: new Set(),
  globalSearch: ""
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

function notifSupported() {
  return "Notification" in window;
}

async function requestNotifPermission() {
  if (!notifSupported()) return;
  const result = await Notification.requestPermission();
  state.notifPermission = result;
  render();
}

function fireRequestNotif(customerName) {
  if (!notifSupported() || Notification.permission !== "granted") return;
  const opts = { body: `طلب جديد من ${customerName}`, icon: "public/icons/app-icon.png", dir: "rtl", lang: "ar" };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification("OZK TOBACCO", opts))
      .catch(() => new Notification("OZK TOBACCO", opts));
  } else {
    new Notification("OZK TOBACCO", opts);
  }
}

function notifPermissionBanner() {
  if (!state.session || !notifSupported() || state.notifPermission !== "default") return "";
  return `
    <section class="notice-panel warning notif-banner">
      <span><strong>إشعارات الطلبات</strong> — فعّل الإشعارات لتصلك تنبيهات فورية عند وصول طلب جديد.</span>
      <button class="button primary" type="button" data-action="enable-notif">تفعيل</button>
    </section>
  `;
}

async function boot() {
  await refreshSession();
  await loadRequests();
  await loadInventoryReports();
  await loadCustomerBalanceReports();
  await loadCustomerCreditLimits();
  await loadApprovedPriceItems();
  state.seenRequestIds = new Set(state.requests.map((r) => r.id));
  state.notifPermission = notifSupported() ? Notification.permission : "denied";
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

async function loadCustomerBalanceReports() {
  try {
    if (dataStore.isConfigured() && !state.session) {
      state.customerBalanceReports = [];
      return;
    }
    state.customerBalanceReports = dataStore.listCustomerBalanceReports
      ? await dataStore.listCustomerBalanceReports()
      : [];
  } catch {
    state.customerBalanceReports = [];
  }
}

async function loadCustomerCreditLimits() {
  try {
    state.customerLimitError = null;
    if (dataStore.isConfigured() && !state.session) {
      state.customerCreditLimits = [];
      return;
    }
    state.customerCreditLimits = dataStore.listCustomerCreditLimits
      ? await dataStore.listCustomerCreditLimits()
      : [];
  } catch (error) {
    state.customerCreditLimits = [];
    state.customerLimitError = error.message || "تعذر تحميل حدود الزبائن.";
  }
}

async function loadApprovedPriceItems() {
  try {
    state.approvedPriceError = null;
    if (dataStore.isConfigured() && !state.session) {
      state.approvedPriceItems = [];
      return;
    }
    state.approvedPriceItems = dataStore.listApprovedPriceItems ? await dataStore.listApprovedPriceItems() : [];
  } catch (error) {
    state.approvedPriceItems = [];
    state.approvedPriceError = error.message || "تعذر تحميل الأسعار المعتمدة.";
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
    await loadCustomerBalanceReports();
    await loadCustomerCreditLimits();
    await loadApprovedPriceItems();
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
    state.customerBalanceReports = [];
    state.customerCreditLimits = [];
    state.customerLimitError = null;
    state.approvedPriceItems = [];
    state.approvedPriceError = null;
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
    await loadCustomerBalanceReports();
    await loadCustomerCreditLimits();
    await loadApprovedPriceItems();
    setNotice("success", "تم تحديث تقارير الأمين من Supabase.");
    setRoute("ameen", false);
  } catch (error) {
    setNotice("error", error.message);
    render();
  }
}

async function saveCustomerLimit(form) {
  try {
    const customerName = form.dataset.customerName || "";
    const customerKeyValue = form.dataset.customerKey || normalizeItemName(customerName);
    const creditLimit = Math.max(0, toNumber(formValue(form, "creditLimit")));

    if (!customerKeyValue) throw new Error("لم أستطع تحديد الزبون لحفظ الحد.");

    await dataStore.upsertCustomerCreditLimit({
      customerKey: customerKeyValue,
      customerName,
      creditLimit,
      notes: formValue(form, "notes")
    });

    await loadCustomerCreditLimits();
    setNotice("success", `تم حفظ الحد المسموح للزبون ${customerName || customerKeyValue}.`);
    render();
  } catch (error) {
    state.customerLimitError = error.message || "تعذر حفظ الحد المسموح.";
    setNotice("error", state.customerLimitError);
    render();
  }
}

function downloadFilteredPriceList() {
  if (!state.priceExport) {
    setNotice("error", "حلل ملف الأسعار أولا حتى أجهز نسخة المواد المتوفرة فقط.");
    render();
    return;
  }

  if (!state.priceExport.rows.length) {
    setNotice("error", "لا توجد مواد بسعر صالح للتنزيل. ملف الأسعار الحالي يحتوي أسعارا صفرية أو فارغة للمواد المتوفرة.");
    render();
    return;
  }
  writePriceExportWorkbook(state.priceExport, "tobacco-available-prices");
  setNotice("success", "تم تنزيل لائحة أسعار تحتوي فقط المواد الموجودة في المستودع.");
  render();
}

function liveAvailableItems() {
  return reportItems(state.inventoryReports[0]).filter((item) => itemQty(item) > 0);
}

function writePriceExportWorkbook(priceExport, filePrefix) {
  assertExcelSupport();
  const worksheet = window.XLSX.utils.aoa_to_sheet([priceExport.headers, ...priceExport.rows]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "available-prices");
  window.XLSX.writeFile(workbook, `${filePrefix}-${todayIsoDate()}.xlsx`);
}

function firstPositivePrice(rawRow, priceIndexes) {
  for (const index of priceIndexes || []) {
    const price = toNumber(rawRow[index]);
    if (price > 0) return price;
  }
  return 0;
}

function uuidOrNull(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function downloadLivePriceTemplate() {
  const latest = state.inventoryReports[0];
  const availableItems = liveAvailableItems();
  if (!latest || !availableItems.length) {
    setNotice("error", "لا يوجد جرد حي يحتوي مواد متوفرة لإنشاء قالب تسعير.");
    render();
    return;
  }

  assertExcelSupport();
  const rows = availableItems.map((item) => [
    item.name || "",
    itemQty(item),
    "",
    statusLabel(item.status),
    reportSyncedAt(latest)
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["اسم المادة", "الكمية المتوفرة", "سعر البيع", "الحالة", "آخر مزامنة"],
    ...rows
  ]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "price-template");
  window.XLSX.writeFile(workbook, `tobacco-price-template-${todayIsoDate()}.xlsx`);
  setNotice("success", `تم تنزيل قالب تسعير يحتوي ${availableItems.length} مادة متوفرة فقط.`);
  render();
}

async function importLivePriceList(form) {
  try {
    const latest = state.inventoryReports[0];
    const availableItems = liveAvailableItems();
    const priceFile = form.elements.livePrice?.files?.[0];

    if (!latest || !availableItems.length) {
      throw new Error("لا يوجد جرد حي يحتوي مواد متوفرة للمطابقة.");
    }
    if (!priceFile) {
      throw new Error("اختر ملف الأسعار بعد التسعير أولا.");
    }

    const price = await parsePriceWorkbook(priceFile);
    const availableByKey = new Map(availableItems.map((item) => [item.key || normalizeItemName(item.name), item]));
    const availableKeys = new Set(availableByKey.keys());
    const filteredRows = price.rows.filter((row) => availableKeys.has(row.key) && row.hasPrice);
    const excludedRows = price.rows.filter((row) => !availableKeys.has(row.key));
    const zeroPriceRows = price.rows.filter((row) => availableKeys.has(row.key) && !row.hasPrice);
    const approvedItems = filteredRows.map((row) => {
      const stockItem = availableByKey.get(row.key);
      return {
        itemKey: row.key,
        itemName: row.name,
        salePrice: firstPositivePrice(row.raw, price.priceIndexes),
        stockQty: itemQty(stockItem),
        stockStatus: stockItem?.status || "active",
        sourceReportId: uuidOrNull(latest.id),
        sourceSyncedAt: reportSyncedAt(latest),
        pricePayload: {
          headers: price.headers,
          row: row.raw
        }
      };
    });

    state.priceExport = {
      sheetName: price.sheetName,
      headers: price.headers,
      rows: filteredRows.map((row) => row.raw),
      source: "live_inventory",
      excludedRows: excludedRows.length,
      zeroPriceRows: zeroPriceRows.length
    };

    if (!filteredRows.length) {
      throw new Error("ملف الأسعار لا يحتوي مواد متوفرة بسعر صالح. راجع عمود سعر البيع أو آخر مزامنة جرد.");
    }

    writePriceExportWorkbook(state.priceExport, "tobacco-sale-prices");
    let savedCount = 0;
    let saveWarning = "";
    const saveApprovedPrices = dataStore.replaceApprovedPriceItems || dataStore.upsertApprovedPriceItems;
    if (saveApprovedPrices) {
      try {
        const saved = await saveApprovedPrices.call(dataStore, approvedItems);
        state.approvedPriceItems = saved;
        savedCount = saved.length;
      } catch (saveError) {
        saveWarning = ` تم تنزيل الملف، لكن تعذر حفظ الأسعار لجهاز المحاسبة: ${saveError.message}`;
      }
    }
    setNotice(
      zeroPriceRows.length || saveWarning ? "error" : "success",
      `تم تنزيل لائحة البيع النهائية: ${filteredRows.length} مادة. تم حذف ${excludedRows.length} غير موجودة في المستودع، و${zeroPriceRows.length} موجودة لكن بلا سعر. تم استبدال لائحة المحاسبة بـ ${savedCount} سعر.${saveWarning}`
    );
  } catch (error) {
    setNotice("error", error.message);
  }
  render();
}

function downloadApprovedPricesForAccounting() {
  const items = state.approvedPriceItems || [];
  if (!items.length) {
    setNotice("error", "لا توجد أسعار معتمدة محفوظة للتصدير إلى المحاسبة.");
    render();
    return;
  }

  assertExcelSupport();
  const rows = items.map((item) => [
    item.itemName || "",
    Number(item.salePrice || 0),
    Number(item.stockQty || 0),
    item.stockStatus || "",
    item.approvedAt || item.updatedAt || ""
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["اسم المادة", "سعر البيع", "الكمية", "الحالة", "وقت الاعتماد"],
    ...rows
  ]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "accounting-prices");
  window.XLSX.writeFile(workbook, `tobacco-accounting-prices-${todayIsoDate()}.xlsx`);
  setNotice("success", "تم تنزيل الأسعار المعتمدة للمحاسبة.");
  render();
}

function approvedPriceMap() {
  return new Map((state.approvedPriceItems || []).filter((item) => item.itemKey).map((item) => [item.itemKey, item]));
}

function isSameIsoDay(value, isoDay = todayIsoDate()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) === isoDay;
  return date.toISOString().slice(0, 10) === isoDay;
}

function pricingWorklistItems() {
  const prices = approvedPriceMap();
  const query = normalizeItemName(state.pricingSearch);
  return liveAvailableItems()
    .map((item) => {
      const key = item.key || normalizeItemName(item.name);
      const price = prices.get(key);
      return {
        ...item,
        key,
        approvedPrice: price,
        salePrice: Number(price?.salePrice || 0),
        pricedToday: isSameIsoDay(price?.approvedAt || price?.updatedAt)
      };
    })
    .filter((item) => {
      if (!query) return true;
      return String(item.key || "").includes(query) || normalizeItemName(item.name).includes(query);
    })
    .sort((a, b) => Number(a.pricedToday) - Number(b.pricedToday) || String(a.name || "").localeCompare(String(b.name || ""), "ar"));
}

function downloadDailyPricingWorklist() {
  const latest = state.inventoryReports[0];
  const items = pricingWorklistItems();
  if (!latest || !items.length) {
    setNotice("error", "لا توجد مواد متوفرة لإنشاء قائمة تسعير اليوم.");
    render();
    return;
  }

  assertExcelSupport();
  const rows = items.map((item) => [
    item.name || "",
    itemQty(item),
    item.salePrice > 0 ? item.salePrice : "",
    item.pricedToday ? "مسعر اليوم" : "بحاجة تسعير",
    item.approvedPrice?.approvedAt || item.approvedPrice?.updatedAt || "",
    reportSyncedAt(latest)
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["اسم المادة", "الكمية المتوفرة", "سعر البيع", "حالة التسعير", "آخر اعتماد", "آخر مزامنة جرد"],
    ...rows
  ]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "daily-pricing");
  window.XLSX.writeFile(workbook, `tobacco-daily-pricing-${todayIsoDate()}.xlsx`);
  setNotice("success", `تم تنزيل قائمة تسعير اليوم: ${items.length} مادة.`);
  render();
}

async function savePricingItem(form) {
  try {
    const latest = state.inventoryReports[0];
    const itemKey = form.dataset.itemKey || "";
    const itemName = form.dataset.itemName || "";
    const salePrice = toNumber(formValue(form, "salePrice"));
    const stockQty = toNumber(form.dataset.stockQty);
    const stockStatus = form.dataset.stockStatus || "active";

    if (!latest) throw new Error("لا يوجد جرد حي للمطابقة.");
    if (!itemKey || !itemName) throw new Error("لا يمكن حفظ السعر بدون مادة واضحة.");
    if (salePrice <= 0) throw new Error("اكتب سعر بيع أكبر من صفر.");
    if (!dataStore.upsertApprovedPriceItems) throw new Error("حفظ الأسعار غير مفعل في قاعدة البيانات.");

    const saved = await dataStore.upsertApprovedPriceItems([
      {
        itemKey,
        itemName,
        salePrice,
        stockQty,
        stockStatus,
        sourceReportId: uuidOrNull(latest.id),
        sourceSyncedAt: reportSyncedAt(latest),
        pricePayload: {
          source: "phone_pricing_page",
          pricedDate: todayIsoDate()
        }
      }
    ]);
    const priceMap = approvedPriceMap();
    saved.forEach((item) => priceMap.set(item.itemKey, item));
    state.approvedPriceItems = [...priceMap.values()].sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || ""), "ar"));
    setNotice("success", `تم حفظ سعر ${itemName} وسيسحبه جهاز المحاسبة تلقائياً.`);
  } catch (error) {
    setNotice("error", error.message);
  }
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

function downloadFilteredInventoryReport() {
  const latest = state.inventoryReports[0];
  const items = ameenFilteredItems(reportItems(latest));
  if (!latest || !items.length) {
    setNotice("error", "لا توجد مواد معروضة للتصدير حسب البحث والفلتر الحالي.");
    render();
    return;
  }

  assertExcelSupport();
  const rows = items.map((item) => [
    item.name || "",
    itemQty(item),
    statusLabel(item.status),
    item.lowThreshold || latest.summary?.threshold || "",
    item.priceListed ? "نعم" : "لا"
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["المادة", "الكمية", "الحالة", "حد التنبيه", "ضمن لائحة الأسعار"],
    ...rows
  ]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "filtered-inventory");
  window.XLSX.writeFile(workbook, `tobacco-filtered-inventory-${todayIsoDate()}.xlsx`);
  setNotice("success", "تم تنزيل المواد المعروضة حسب البحث والفلتر الحالي.");
  render();
}

function downloadFilteredCustomerBalances() {
  const latest = state.customerBalanceReports[0];
  const items = filteredCustomerItems(latestCustomerBalanceItems());
  if (!latest || !items.length) {
    setNotice("error", "لا توجد أرصدة زبائن معروضة للتصدير حسب البحث والفلتر الحالي.");
    render();
    return;
  }

  assertExcelSupport();
  const rows = items.map((item) => [
    item.name || "",
    customerBalance(item),
    customerLimit(item) > 0 ? customerLimit(item) : "",
    customerLimit(item) > 0 ? customerRemainingLimit(item) : "",
    customerLastPaymentAmount(item) > 0 ? customerLastPaymentAmount(item) : "",
    customerLastPaymentDate(item) || "",
    customerStatusLabel(item.status)
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["الزبون", "الرصيد", "الحد المسموح", "المتبقي من الحد", "آخر دفعة", "تاريخ آخر دفعة", "الحالة"],
    ...rows
  ]);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "customer-balances");
  window.XLSX.writeFile(workbook, `tobacco-customer-balances-${todayIsoDate()}.xlsx`);
  setNotice("success", "تم تنزيل أرصدة الزبائن المعروضة حسب البحث والفلتر الحالي.");
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
          <img src="public/icons/ozk-logo.png" alt="">
          <span>${escapeHtml(appConfig.name)}</span>
        </a>
        <nav>
          ${navButton("overview", "الرئيسية")}
          ${state.session ? navButton("dashboard", "📊 الإحصائيات") : ""}
          ${navButton("login", "تسجيل الدخول")}
          ${navButton("requests", "طلبات العملاء")}
          ${navButton("ameen", "الأمين")}
          ${navButton("pricing", "التسعير")}
          ${navButton("remote", "إدارة عن بعد")}
          ${navButton("monitoring", "المراقبة")}
          ${navButton("payments", "الدفع")}
          ${state.session ? navButton("invoice", "📄 الفواتير") : ""}
          ${state.session ? navButton("staff", "👥 الموظفون") : ""}
          ${state.session?.email === appConfig.ai.ownerEmail ? navButton("ai", "🤖 المساعد الذكي") : ""}
        </nav>
        <div style="margin-top:auto;padding-top:20px;border-top:1px solid #2f2415">
          <a href="privacy-policy.html" style="display:block;font-size:0.78rem;color:#7a6040;text-align:center;text-decoration:none;padding:6px 0;" target="_blank">سياسة الخصوصية</a>
          <a href="terms-of-use.html" style="display:block;font-size:0.78rem;color:#7a6040;text-align:center;text-decoration:none;padding:6px 0;" target="_blank">شروط الاستخدام</a>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <p class="eyebrow">${escapeHtml(appConfig.tagline)}</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="topbar-actions">
            ${state.session ? `
              <form class="search-wrap" data-form="global-search">
                <input class="search-input" name="q" placeholder="🔍 بحث…" value="${escapeHtml(state.globalSearch)}" autocomplete="off" dir="auto">
              </form>
            ` : ""}
            ${state.installPrompt ? '<button class="button secondary" data-action="install">تثبيت</button>' : ""}
            ${state.session ? `<button class="button secondary" data-action="logout">${escapeHtml(state.session.name)}</button>` : ""}
            <a class="button primary" href="mailto:${escapeHtml(appConfig.supportEmail)}">الدعم</a>
          </div>
        </header>
        ${connectionNotice()}
        ${notifPermissionBanner()}
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
    overview: "لوحة OZK",
    login: "تسجيل الدخول",
    requests: "طلبات العملاء",
    ameen: "تقارير الأمين",
    pricing: "التسعير",
    remote: "الإدارة عن بعد",
    monitoring: "المراقبة",
    payments: "الدفع",
    ai: "المساعد الذكي",
    invoice: "الفواتير بالدولار",
    dashboard: "الإحصائيات والتحليلات",
    staff: "إدارة الموظفين",
    search: `نتائج: ${escapeHtml(state.globalSearch)}`
  }[state.route];
}

function overview() {
  const done = completionPercent();
  const openRequests = state.requests.filter((request) => request.status !== "مغلق").length;

  return shell(`
    <section class="hero-panel business-hero">
      <div class="hero-copy">
        <p class="eyebrow">OZK TOBACCO</p>
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
          <div style="display:flex;gap:8px">
            <button class="button secondary compact-button" type="button" data-action="export-monthly">📥 Excel شهري</button>
            <button class="button secondary compact-button" type="button" data-action="export-ameen">تصدير للأمين</button>
          </div>
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

const ameenFilters = [
  { id: "alerts", label: "تنبيهات" },
  { id: "all", label: "الكل" },
  { id: "low", label: "قريب النفاد" },
  { id: "zero", label: "صفر" },
  { id: "negative", label: "سالب" },
  { id: "available", label: "موجود" }
];

function itemQty(item) {
  return Number(item?.stockQty || 0);
}

function isNegativeItem(item) {
  return itemQty(item) < 0;
}

function isZeroItem(item) {
  return itemQty(item) === 0;
}

function isLowPositiveItem(item) {
  return item.status === "low" && itemQty(item) > 0;
}

function isAlertItem(item) {
  return isNegativeItem(item) || isZeroItem(item) || isLowPositiveItem(item);
}

function ameenFilterCounts(items) {
  return {
    all: items.length,
    alerts: items.filter(isAlertItem).length,
    low: items.filter(isLowPositiveItem).length,
    zero: items.filter(isZeroItem).length,
    negative: items.filter(isNegativeItem).length,
    available: items.filter((item) => itemQty(item) > 0).length
  };
}

function matchesAmeenSearch(item, query) {
  const text = query.trim();
  if (!text) return true;
  const normalizedQuery = normalizeItemName(text);
  const normalizedName = normalizeItemName(item.name || "");
  return (
    String(item.name || "").includes(text) ||
    String(item.key || "").includes(normalizedQuery) ||
    normalizedName.includes(normalizedQuery)
  );
}

function filterAmeenItems(items, filter, query) {
  return items.filter((item) => {
    if (!matchesAmeenSearch(item, query)) return false;
    if (filter === "low") return isLowPositiveItem(item);
    if (filter === "zero") return isZeroItem(item);
    if (filter === "negative") return isNegativeItem(item);
    if (filter === "available") return itemQty(item) > 0;
    if (filter === "alerts") return isAlertItem(item);
    return true;
  });
}

function sortAmeenItems(items, sort) {
  const sorted = [...items];
  if (sort === "qtyDesc") {
    sorted.sort((a, b) => itemQty(b) - itemQty(a));
  } else if (sort === "nameAsc") {
    sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  } else {
    sorted.sort((a, b) => itemQty(a) - itemQty(b));
  }
  return sorted;
}

function ameenFilteredItems(items) {
  return sortAmeenItems(filterAmeenItems(items, state.ameenFilter, state.ameenSearch), state.ameenSort);
}

function ameenSyncState(syncedAt) {
  const minutes = minutesSince(syncedAt);
  if (minutes === null) {
    return { type: "warning", label: "وقت المزامنة غير معروف" };
  }
  if (minutes > 5) {
    return { type: "warning", label: `المزامنة متأخرة: قبل ${minutes} دقيقة` };
  }
  return { type: "success", label: "المزامنة تعمل" };
}

const customerFilters = [
  { id: "debit_balance", label: "عليه رصيد" },
  { id: "credit_balance", label: "له رصيد" },
  { id: "clear", label: "بلا رصيد" },
  { id: "no_limit", label: "بلا حد" },
  { id: "over_limit", label: "تجاوز الحد" },
  { id: "near_limit", label: "قريب من الحد" },
  { id: "all", label: "الكل" }
];

function customerBalance(item) {
  return Number(item?.balance || 0);
}

function customerKey(item) {
  return String(item?.key || normalizeItemName(item?.name || "")).trim();
}

function customerLimit(item) {
  return Number(item?.creditLimit || 0);
}

function customerRemainingLimit(item) {
  return Number(item?.remainingLimit || 0);
}

function customerLastPaymentAmount(item) {
  return Number(item?.lastPaymentAmount || 0);
}

function customerLastPaymentDate(item) {
  return item?.lastPaymentDate || "";
}

function customerLimitSourceLabel(source) {
  return {
    internal: "حد داخلي",
    ameen: "حد من الأمين",
    none: "بلا حد"
  }[source] || "بلا حد";
}

function customerLimitMap() {
  return new Map(
    state.customerCreditLimits
      .filter((limit) => limit.customerKey)
      .map((limit) => [String(limit.customerKey), limit])
  );
}

function deriveCustomerStatus(balance, limit) {
  if (limit > 0 && balance > limit) return "over_limit";
  if (limit > 0 && balance > 0 && balance >= limit * 0.8) return "near_limit";
  if (balance > 0) return "open_balance";
  if (balance < 0) return "credit_balance";
  return "clear";
}

function applyCustomerLimits(items) {
  const limits = customerLimitMap();
  return items.map((item) => {
    const key = customerKey(item);
    const savedLimit = limits.get(key);
    const ameenLimit = Number(item?.creditLimit || 0);
    const internalLimit = Number(savedLimit?.creditLimit || 0);
    const effectiveLimit = internalLimit > 0 ? internalLimit : ameenLimit;
    const balance = customerBalance(item);

    return {
      ...item,
      key,
      ameenCreditLimit: ameenLimit,
      internalCreditLimit: internalLimit,
      creditLimit: effectiveLimit,
      creditLimitNotes: savedLimit?.notes || "",
      limitSource: internalLimit > 0 ? "internal" : ameenLimit > 0 ? "ameen" : "none",
      remainingLimit: effectiveLimit > 0 ? effectiveLimit - Math.max(0, balance) : 0,
      lastPaymentAmount: Number(item?.lastPaymentAmount || 0),
      lastPaymentDate: item?.lastPaymentDate || "",
      lastPaymentNotes: item?.lastPaymentNotes || "",
      recentPayments: Array.isArray(item?.recentPayments) ? item.recentPayments : [],
      recentMovements: Array.isArray(item?.recentMovements) ? item.recentMovements : [],
      status: deriveCustomerStatus(balance, effectiveLimit)
    };
  });
}

function latestCustomerBalanceItems() {
  const latest = state.customerBalanceReports[0];
  return applyCustomerLimits(Array.isArray(latest?.items) ? latest.items : []);
}

function customerBalanceTotals(items) {
  const debitItems = items.filter((item) => customerBalance(item) > 0);
  const creditItems = items.filter((item) => customerBalance(item) < 0);
  return {
    debitCustomers: debitItems.length,
    creditCustomers: creditItems.length,
    totalDebitBalance: debitItems.reduce((sum, item) => sum + customerBalance(item), 0),
    totalCreditBalance: creditItems.reduce((sum, item) => sum + customerBalance(item), 0),
    customersWithLimit: items.filter((item) => customerLimit(item) > 0).length,
    customersWithPayment: items.filter((item) => customerLastPaymentAmount(item) > 0).length
  };
}

function selectedCustomer(items) {
  if (!state.selectedCustomerKey && items.length) {
    return null;
  }
  return items.find((item) => customerKey(item) === state.selectedCustomerKey) || null;
}

function movementLabel(movement) {
  const debit = Number(movement?.debit || 0);
  const credit = Number(movement?.credit || 0);
  if (credit > 0 && debit <= 0) return "دفعة";
  if (debit > 0 && credit <= 0) return "فاتورة / دين";
  return "قيد";
}

function movementAmount(movement) {
  const debit = Number(movement?.debit || 0);
  const credit = Number(movement?.credit || 0);
  if (credit > 0 && debit <= 0) return credit;
  if (debit > 0 && credit <= 0) return debit;
  return Math.max(debit, credit);
}

function customerStatusLabel(status) {
  return {
    over_limit: "تجاوز الحد",
    near_limit: "قريب من الحد",
    open_balance: "عليه رصيد",
    credit_balance: "له رصيد",
    clear: "صافي"
  }[status] || status;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3
  }).format(Number(value || 0));
}

function customerFilterCounts(items) {
  return {
    all: items.length,
    debit_balance: items.filter((item) => customerBalance(item) > 0).length,
    credit_balance: items.filter((item) => customerBalance(item) < 0).length,
    clear: items.filter((item) => customerBalance(item) === 0).length,
    over_limit: items.filter((item) => item.status === "over_limit").length,
    near_limit: items.filter((item) => item.status === "near_limit").length,
    no_limit: items.filter((item) => customerLimit(item) <= 0).length
  };
}

function matchesCustomerSearch(item, query) {
  const text = query.trim();
  if (!text) return true;
  const normalizedQuery = normalizeItemName(text);
  return (
    String(item.name || "").includes(text) ||
    String(item.key || "").includes(normalizedQuery) ||
    normalizeItemName(item.name || "").includes(normalizedQuery)
  );
}

function filterCustomerItems(items, filter, query) {
  return items.filter((item) => {
    if (!matchesCustomerSearch(item, query)) return false;
    if (filter === "debit_balance") return customerBalance(item) > 0;
    if (filter === "credit_balance") return customerBalance(item) < 0;
    if (filter === "clear") return customerBalance(item) === 0;
    if (filter === "over_limit") return item.status === "over_limit";
    if (filter === "near_limit") return item.status === "near_limit";
    if (filter === "no_limit") return customerLimit(item) <= 0;
    return true;
  });
}

function sortCustomerItems(items, sort) {
  const sorted = [...items];
  if (sort === "remainingAsc") {
    sorted.sort((a, b) => customerRemainingLimit(a) - customerRemainingLimit(b));
  } else if (sort === "nameAsc") {
    sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  } else {
    sorted.sort((a, b) => customerBalance(b) - customerBalance(a));
  }
  return sorted;
}

function filteredCustomerItems(items) {
  return sortCustomerItems(filterCustomerItems(items, state.customerFilter, state.customerSearch), state.customerSort);
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

function inventoryRow(item) {
  const qty = itemQty(item);
  const rowState = qty < 0 ? "negative" : qty === 0 ? "zero" : item.status;
  return `
    <div class="inventory-row inventory-row-${escapeHtml(rowState)}">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(statusLabel(item.status))} / الكمية: ${escapeHtml(qty)}</span>
    </div>
  `;
}

function ameenBrowser(items) {
  const counts = ameenFilterCounts(items);
  const filtered = ameenFilteredItems(items);
  const activeFilter = ameenFilters.some((filter) => filter.id === state.ameenFilter) ? state.ameenFilter : "alerts";

  return `
    <section class="panel wide inventory-browser">
      <div class="panel-title-row inventory-browser-head">
        <div>
          <h3>مواد الأمين</h3>
          <p class="muted">ابحث، صفّ، ورتّب المواد من آخر مزامنة مباشرة.</p>
        </div>
        <span class="status-chip" data-ameen-count>يعرض ${escapeHtml(filtered.length)} من ${escapeHtml(items.length)}</span>
      </div>
      <div class="inventory-controls">
        <label>
          بحث باسم المادة
          <input data-ameen-search value="${escapeHtml(state.ameenSearch)}" placeholder="مثال: 1970 أو اسم المادة">
        </label>
        <label>
          الترتيب
          <select data-ameen-sort>
            <option value="qtyAsc" ${state.ameenSort === "qtyAsc" ? "selected" : ""}>الكمية من الأقل للأعلى</option>
            <option value="qtyDesc" ${state.ameenSort === "qtyDesc" ? "selected" : ""}>الكمية من الأعلى للأقل</option>
            <option value="nameAsc" ${state.ameenSort === "nameAsc" ? "selected" : ""}>الاسم أبجدياً</option>
          </select>
        </label>
      </div>
      <div class="filter-pills">
        ${ameenFilters
          .map(
            (filter) => `
              <button class="filter-pill ${activeFilter === filter.id ? "active" : ""}" type="button" data-ameen-filter="${escapeHtml(filter.id)}">
                <span>${escapeHtml(filter.label)}</span>
                <strong>${escapeHtml(counts[filter.id] || 0)}</strong>
              </button>
            `
          )
          .join("")}
      </div>
      <div class="button-row report-actions">
        <button class="button secondary" type="button" data-action="download-filtered-inventory" ${filtered.length ? "" : "disabled"}>تصدير المعروض</button>
      </div>
      <div class="inventory-list inventory-list-dense" data-ameen-results>
        ${filtered.length ? filtered.slice(0, 80).map(inventoryRow).join("") : '<p class="muted">لا توجد مواد تطابق البحث والفلتر الحالي.</p>'}
      </div>
      ${filtered.length > 80 ? '<p class="muted">تم عرض أول 80 مادة فقط. استخدم البحث أو الفلاتر لتضييق القائمة.</p>' : ""}
    </section>
  `;
}

function pricingRow(item) {
  const qty = itemQty(item);
  const price = Number(item.salePrice || 0);
  const rowState = item.pricedToday ? "active" : item.status;
  return `
    <div class="inventory-row inventory-row-${escapeHtml(rowState)}">
      <div class="customer-row-title">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="status-chip">${escapeHtml(item.pricedToday ? "مسعر اليوم" : "بحاجة تسعير")}</span>
      </div>
      <span>الكمية: ${escapeHtml(qty)} / الحالة: ${escapeHtml(statusLabel(item.status))} / آخر سعر: ${escapeHtml(price > 0 ? formatMoney(price) : "غير مسعر")}</span>
      <form class="customer-limit-editor" data-form="pricing-item" data-item-key="${escapeHtml(item.key)}" data-item-name="${escapeHtml(item.name || "")}" data-stock-qty="${escapeHtml(qty)}" data-stock-status="${escapeHtml(item.status || "")}">
        <label>
          سعر البيع
          <input name="salePrice" type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(price > 0 ? price : "")}" placeholder="0">
        </label>
        <button class="button secondary mini-button" type="submit">حفظ السعر</button>
      </form>
    </div>
  `;
}

function pricing() {
  const latest = state.inventoryReports[0];
  const items = pricingWorklistItems();
  const allAvailable = liveAvailableItems();
  const pricedToday = allAvailable.filter((item) => {
    const price = approvedPriceMap().get(item.key || normalizeItemName(item.name));
    return isSameIsoDay(price?.approvedAt || price?.updatedAt);
  }).length;
  const waiting = Math.max(0, allAvailable.length - pricedToday);
  const syncedAt = reportSyncedAt(latest);
  const authHint =
    dataStore.isConfigured() && !state.session
      ? '<p class="muted">سجل الدخول حتى تحفظ الأسعار في Supabase وتصل إلى جهاز المحاسبة.</p>'
      : "";

  return shell(`
    <section class="panel wide inventory-browser">
      <div class="panel-title-row inventory-browser-head">
        <div>
          <h3>تسعير اليوم</h3>
          <p class="muted">كل يوم تظهر هنا المواد الموجودة في المستودع لتسعيرها من الهاتف. جهاز المحاسبة يسحب الأسعار المعتمدة تلقائياً.</p>
        </div>
        <span class="status-chip">آخر جرد: ${escapeHtml(formatDateTime(syncedAt))}</span>
      </div>
      ${authHint}
      ${state.approvedPriceError ? `<p class="muted">تنبيه الأسعار: ${escapeHtml(state.approvedPriceError)}</p>` : ""}
      <div class="inventory-metrics">
        ${inventoryMetric("مواد للتسعير", allAvailable.length, "من آخر جرد حي")}
        ${inventoryMetric("مسعرة اليوم", pricedToday, "تم حفظها من الهاتف")}
        ${inventoryMetric("بانتظار التسعير", waiting, "ستظهر في قائمة اليوم")}
        ${inventoryMetric("أسعار المحاسبة", state.approvedPriceItems.length, "جاهزة للسحب الآلي")}
      </div>
      <div class="inventory-controls">
        <label>
          بحث باسم المادة
          <input data-pricing-search value="${escapeHtml(state.pricingSearch)}" placeholder="اكتب اسم المادة">
        </label>
      </div>
      <div class="button-row report-actions">
        <button class="button secondary" type="button" data-action="download-daily-pricing" ${items.length ? "" : "disabled"}>تنزيل قائمة تسعير اليوم</button>
        <button class="button secondary" type="button" data-action="download-price-template" ${allAvailable.length ? "" : "disabled"}>تنزيل قالب Excel</button>
        <button class="button secondary" type="button" data-action="download-approved-prices" ${state.approvedPriceItems.length ? "" : "disabled"}>تصدير أسعار المحاسبة</button>
      </div>
      <form class="form-card compact" data-form="live-price-import">
        <label>
          رفع ملف تسعير كامل
          <input name="livePrice" type="file" accept=".xlsx,.xls">
        </label>
        <button class="button primary" type="submit" ${allAvailable.length ? "" : "disabled"}>اعتماد ملف الأسعار</button>
      </form>
      <div class="inventory-list inventory-list-dense" data-pricing-results>
        ${items.length ? items.slice(0, 100).map(pricingRow).join("") : '<p class="muted">لا توجد مواد متوفرة أو مطابقة للبحث الحالي.</p>'}
      </div>
      ${items.length > 100 ? '<p class="muted">تم عرض أول 100 مادة فقط. استخدم البحث لتضييق القائمة.</p>' : ""}
    </section>
  `);
}

function customerBalanceRow(item) {
  const limit = customerLimit(item);
  const remaining = customerRemainingLimit(item);
  const rowState = item.status === "over_limit" ? "negative" : item.status === "near_limit" ? "low" : "active";
  const key = customerKey(item);
  return `
    <div class="inventory-row inventory-row-${escapeHtml(rowState)}">
      <div class="customer-row-title">
        <strong>${escapeHtml(item.name)}</strong>
        <button class="button secondary mini-button" type="button" data-customer-details="${escapeHtml(key)}">تفاصيل</button>
      </div>
      <span>الرصيد: ${escapeHtml(formatMoney(customerBalance(item)))} / الحد: ${escapeHtml(limit > 0 ? formatMoney(limit) : "غير محدد")}</span>
      <span>المتبقي من الحد: ${escapeHtml(limit > 0 ? formatMoney(remaining) : "غير محدد")} / الحالة: ${escapeHtml(customerStatusLabel(item.status))} / المصدر: ${escapeHtml(customerLimitSourceLabel(item.limitSource))}</span>
      <span>آخر دفعة: ${escapeHtml(customerLastPaymentAmount(item) > 0 ? formatMoney(customerLastPaymentAmount(item)) : "غير متوفر")} / التاريخ: ${escapeHtml(customerLastPaymentDate(item) ? formatDate(customerLastPaymentDate(item)) : "غير متوفر")}</span>
      <form class="customer-limit-editor" data-form="customer-limit" data-customer-key="${escapeHtml(key)}" data-customer-name="${escapeHtml(item.name || "")}">
        <label>
          الحد الداخلي
          <input name="creditLimit" type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(item.internalCreditLimit > 0 ? item.internalCreditLimit : "")}" placeholder="${escapeHtml(limit > 0 ? formatMoney(limit) : "0")}">
        </label>
        <label>
          ملاحظة
          <input name="notes" maxlength="500" value="${escapeHtml(item.creditLimitNotes || "")}" placeholder="اختياري">
        </label>
        <button class="button secondary mini-button" type="submit">حفظ</button>
      </form>
    </div>
  `;
}

function customerPaymentRow(payment) {
  return `
    <div class="detail-row">
      <strong>${escapeHtml(formatMoney(payment?.amount || 0))}</strong>
      <span>${escapeHtml(payment?.date ? formatDate(payment.date) : "غير متوفر")}</span>
      <small>${escapeHtml(payment?.notes || "بلا ملاحظة")}</small>
    </div>
  `;
}

function customerMovementRow(movement) {
  return `
    <div class="detail-row">
      <strong>${escapeHtml(movementLabel(movement))}: ${escapeHtml(formatMoney(movementAmount(movement)))}</strong>
      <span>${escapeHtml(movement?.date ? formatDate(movement.date) : "غير متوفر")}</span>
      <small>${escapeHtml(movement?.notes || "بلا ملاحظة")}</small>
    </div>
  `;
}

function customerDetailsPanel(item) {
  if (!item) {
    return `
      <section class="customer-detail-panel" data-customer-detail-panel>
        <p class="muted">اضغط زر تفاصيل بجانب أي زبون لعرض آخر الدفعات وكشف الحركة المختصر.</p>
      </section>
    `;
  }

  const payments = Array.isArray(item.recentPayments) ? item.recentPayments : [];
  const movements = Array.isArray(item.recentMovements) ? item.recentMovements : [];

  return `
    <section class="customer-detail-panel" data-customer-detail-panel>
      <div class="panel-title-row inventory-browser-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="muted">تفاصيل الرصيد، الحد، آخر الدفعات، وكشف حركة مختصر من الأمين.</p>
        </div>
        <button class="button secondary compact-button" type="button" data-action="clear-customer-details">إغلاق التفاصيل</button>
      </div>
      <div class="inventory-metrics customer-detail-metrics">
        ${inventoryMetric("الرصيد", formatMoney(customerBalance(item)), customerStatusLabel(item.status))}
        ${inventoryMetric("الحد المسموح", customerLimit(item) > 0 ? formatMoney(customerLimit(item)) : "غير محدد", customerLimitSourceLabel(item.limitSource))}
        ${inventoryMetric("المتبقي", customerLimit(item) > 0 ? formatMoney(customerRemainingLimit(item)) : "غير محدد", "من الحد الفعال")}
        ${inventoryMetric("آخر دفعة", customerLastPaymentAmount(item) > 0 ? formatMoney(customerLastPaymentAmount(item)) : "غير متوفر", customerLastPaymentDate(item) ? formatDate(customerLastPaymentDate(item)) : "لا يوجد تاريخ")}
      </div>
      <div class="customer-detail-grid">
        <article>
          <h4>آخر الدفعات</h4>
          <div class="detail-list">
            ${payments.length ? payments.map(customerPaymentRow).join("") : '<p class="muted">لا توجد دفعات مسجلة لهذا الزبون.</p>'}
          </div>
        </article>
        <article>
          <h4>كشف حركة مختصر</h4>
          <div class="detail-list">
            ${movements.length ? movements.map(customerMovementRow).join("") : '<p class="muted">لا توجد حركة مختصرة لهذا الزبون.</p>'}
          </div>
        </article>
      </div>
    </section>
  `;
}

function customerBalanceSection(report) {
  if (!report) {
    return `
      <section class="panel wide customer-balances">
        <h3>أرصدة الزبائن</h3>
        <p class="muted">لم تصل مزامنة أرصدة الزبائن بعد. سيتم عرضها هنا بعد تشغيل مزامنة الأمين الجديدة.</p>
      </section>
    `;
  }

  const items = applyCustomerLimits(Array.isArray(report.items) ? report.items : []);
  const summary = report.summary || {};
  const counts = customerFilterCounts(items);
  const filtered = filteredCustomerItems(items);
  const totals = customerBalanceTotals(items);
  const detailItem = selectedCustomer(items);

  return `
    <section class="panel wide customer-balances">
      <div class="panel-title-row inventory-browser-head">
        <div>
          <h3>أرصدة الزبائن والحد المسموح</h3>
          <p class="muted">الرصيد من الأمين. الحد المسموح يعتمد على الحد الداخلي عند حفظه هنا، وإلا يبقى حد الأمين إن وجد.</p>
        </div>
        <span class="status-chip" data-customer-count>يعرض ${escapeHtml(filtered.length)} من ${escapeHtml(items.length)}</span>
      </div>
      ${
        state.customerLimitError
          ? `<div class="inline-warning">تعذر تحميل أو حفظ الحدود الداخلية. شغل ملف <code>supabase/customer-credit-limits.sql</code> في Supabase SQL Editor ثم حدث الصفحة. الخطأ: ${escapeHtml(state.customerLimitError)}</div>`
          : ""
      }
      <div class="inventory-metrics">
        ${inventoryMetric("عدد الزبائن", summary.totalCustomers || items.length, "من cu000")}
        ${inventoryMetric("عليهم رصيد", totals.debitCustomers, "رصيد موجب")}
        ${inventoryMetric("إجمالي الديون", formatMoney(totals.totalDebitBalance), "مجموع الأرصدة الموجبة")}
        ${inventoryMetric("لهم رصيد", totals.creditCustomers, "رصيد سالب")}
        ${inventoryMetric("إجمالي لصالحهم", formatMoney(totals.totalCreditBalance), "مجموع الأرصدة السالبة")}
        ${inventoryMetric("تجاوزوا الحد", counts.over_limit, "حسب الحد الفعال")}
        ${inventoryMetric("حدود مسجلة", totals.customersWithLimit, "داخلي أو من الأمين")}
        ${inventoryMetric("لهم آخر دفعة", totals.customersWithPayment, "من حركات حساب الزبون")}
        ${inventoryMetric("بلا حد", counts.no_limit, "لا يوجد حد مسجل")}
      </div>
      <div class="inventory-controls">
        <label>
          بحث باسم الزبون
          <input data-customer-search value="${escapeHtml(state.customerSearch)}" placeholder="اكتب اسم الزبون">
        </label>
        <label>
          الترتيب
          <select data-customer-sort>
            <option value="balanceDesc" ${state.customerSort === "balanceDesc" ? "selected" : ""}>أعلى رصيد أولاً</option>
            <option value="remainingAsc" ${state.customerSort === "remainingAsc" ? "selected" : ""}>الأقرب للحد أولاً</option>
            <option value="nameAsc" ${state.customerSort === "nameAsc" ? "selected" : ""}>الاسم أبجدياً</option>
          </select>
        </label>
      </div>
      <div class="filter-pills">
        ${customerFilters
          .map(
            (filter) => `
              <button class="filter-pill ${state.customerFilter === filter.id ? "active" : ""}" type="button" data-customer-filter="${escapeHtml(filter.id)}">
                <span>${escapeHtml(filter.label)}</span>
                <strong>${escapeHtml(counts[filter.id] || 0)}</strong>
              </button>
            `
          )
          .join("")}
      </div>
      <div class="button-row report-actions">
        <button class="button secondary" type="button" data-action="download-customer-balances" ${filtered.length ? "" : "disabled"}>تصدير أرصدة الزبائن</button>
      </div>
      ${customerDetailsPanel(detailItem)}
      <div class="inventory-list inventory-list-dense customer-results" data-customer-results>
        ${filtered.length ? filtered.slice(0, 80).map(customerBalanceRow).join("") : '<p class="muted">لا توجد زبائن تطابق البحث والفلتر الحالي.</p>'}
      </div>
      ${filtered.length > 80 ? '<p class="muted">تم عرض أول 80 زبون فقط. استخدم البحث لتضييق القائمة.</p>' : ""}
    </section>
  `;
}

function ameen() {
  const latest = state.inventoryReports[0];
  const customerReport = state.customerBalanceReports[0];
  const summary = latest?.summary || {};
  const items = reportItems(latest);
  const approvedPrices = state.approvedPriceItems || [];
  const syncedAt = reportSyncedAt(latest);
  const negativeItems = items.filter((item) => Number(item.stockQty || 0) < 0);
  const zeroItems = items.filter((item) => Number(item.stockQty || 0) === 0);
  const syncState = ameenSyncState(syncedAt);
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
        <form class="form-card compact" data-form="live-price-import">
          <label>
            ملف الأسعار بعد التسعير
            <input name="livePrice" type="file" accept=".xlsx,.xls">
          </label>
          ${state.approvedPriceError ? `<p class="muted">تنبيه الأسعار: ${escapeHtml(state.approvedPriceError)}</p>` : ""}
          <div class="button-row">
            <button class="button secondary" type="button" data-action="download-price-template" ${liveReport && summary.availableItems ? "" : "disabled"}>تنزيل قالب تسعير من الموقع</button>
            <button class="button primary" type="submit" ${liveReport && summary.availableItems ? "" : "disabled"}>استيراد الأسعار وحذف غير الموجود</button>
            <button class="button secondary" type="button" data-action="download-approved-prices" ${approvedPrices.length ? "" : "disabled"}>تصدير أسعار المحاسبة</button>
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
            ? `<p class="sync-chip ${escapeHtml(syncState.type)}">${escapeHtml(syncState.label)}</p>
              <p class="muted">آخر مزامنة: ${escapeHtml(formatDateTime(syncedAt))} / ${escapeHtml(syncFreshnessLabel(syncedAt))}</p>
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
                ${inventoryMetric("أسعار الهاتف", approvedPrices.length, "محفوظة لجهاز المحاسبة")}
              </div>`
            : '<p class="muted">لم تحفظ تقرير جرد بعد. ارفع ملف الجرد اليومي حتى يظهر الملخص هنا وعلى الآيفون.</p>'
        }
      </article>
    </section>

    ${
      latest
        ? `${ameenBrowser(items)}
          ${customerBalanceSection(customerReport)}
          <section class="panel wide ameen-movement">
            <h3>حركة المواد والمقارنة</h3>
            <div class="inventory-metrics">
              ${inventoryMetric("تحركت", summary.activeMovement || 0, "انخفضت كميتها عن التقرير السابق")}
              ${inventoryMetric("بلا حركة", summary.staleMovement || 0, "نفس الكمية في تقريرين")}
              ${inventoryMetric("تم تزويدها", summary.restocked || 0, "زادت كميتها عن التقرير السابق")}
              ${inventoryMetric("المقارنة السابقة", summary.previousReportDate || "لا يوجد", "تحتاج تقريرين أو أكثر")}
            </div>
          </section>`
        : customerBalanceSection(customerReport)
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

function dashboardStats() {
  const requests = state.requests || [];
  const total = requests.length;
  const open = requests.filter((r) => r.status !== "مغلق").length;

  const channelCounts = {};
  for (const r of requests) channelCounts[r.channel] = (channelCounts[r.channel] || 0) + 1;
  const topChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0] || ["—", 0];
  const allChannels = ["واتساب", "هاتف", "ويب", "زيارة فرع"].map((ch) => ({ label: ch, count: channelCounts[ch] || 0 }));

  const typeCounts = {};
  for (const r of requests) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
  const allTypes = ["استفسار", "شكوى", "متابعة", "طلب خدمة"].map((t) => ({ label: t, count: typeCounts[t] || 0 }));

  const invItems = Array.isArray(state.inventoryReports[0]?.items) ? state.inventoryReports[0].items : [];
  const inventoryAlerts = invItems.filter((i) => i.status === "low" || i.status === "out").length;

  const balItems = Array.isArray(state.customerBalanceReports?.[0]?.items) ? state.customerBalanceReports[0].items : [];
  const debitCustomers = balItems.filter((i) => Number(i.balance || 0) > 0).length;

  const today = new Date();
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const iso = d.toISOString().slice(0, 10);
    const day = requests.filter((r) => { try { return new Date(r.createdAt).toISOString().slice(0, 10) === iso; } catch { return false; } });
    return { date: iso, open: day.filter((r) => r.status !== "مغلق").length, closed: day.filter((r) => r.status === "مغلق").length };
  });

  const custCounts = {};
  for (const r of requests) if (r.customer) custCounts[r.customer] = (custCounts[r.customer] || 0) + 1;
  const topCustomers = Object.entries(custCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  return { total, open, topChannel, allChannels, allTypes, inventoryAlerts, debitCustomers, trend, topCustomers };
}

function dashboard() {
  const s = dashboardStats();
  const maxCh = Math.max(...s.allChannels.map((c) => c.count), 1);
  const maxTy = Math.max(...s.allTypes.map((t) => t.count), 1);
  const maxCust = Math.max(...s.topCustomers.map((c) => c.count), 1);
  const maxTrend = Math.max(...s.trend.map((d) => d.open + d.closed), 1);

  function bar(items, max, cls = "") {
    return items.map((item) => {
      const pct = Math.round((item.count / max) * 100);
      return `<div class="dash-bar-row">
        <span class="dash-bar-label">${escapeHtml(item.label)}</span>
        <div class="dash-bar-track"><div class="dash-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="dash-bar-val">${item.count}</span>
      </div>`;
    }).join("");
  }

  const trendRows = s.trend.map((d) => {
    let lbl = d.date.slice(5);
    try { lbl = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { weekday: "short", day: "numeric", month: "numeric" }).format(new Date(d.date)); } catch {}
    const op = Math.round((d.open / maxTrend) * 100);
    const cl = Math.round((d.closed / maxTrend) * 100);
    return `<div class="dash-trend-row">
      <span class="dash-bar-label" style="width:80px">${escapeHtml(lbl)}</span>
      <div class="dash-bar-track" style="flex:1"><div class="dash-bar-fill dash-bar-open" style="width:${op}%"></div><div class="dash-bar-fill dash-bar-closed" style="width:${cl}%"></div></div>
      <span class="dash-bar-val"><span style="color:var(--primary)">${d.open}</span>/<span style="color:var(--muted)">${d.closed}</span></span>
    </div>`;
  }).join("");

  const custRows = s.topCustomers.length
    ? bar(s.topCustomers.map((c) => ({ label: c.name, count: c.count })), maxCust, "dash-bar-cust")
    : '<p class="muted">لا يوجد طلبات بعد.</p>';

  return shell(`
    <div class="status-board full">
      <article class="status-card">
        <span>إجمالي الطلبات</span>
        <strong>${s.total}</strong>
        <small>${s.open} مفتوحة / ${s.total - s.open} مغلقة</small>
      </article>
      <article class="status-card">
        <span>القناة الأكثر</span>
        <strong>${escapeHtml(s.topChannel[0])}</strong>
        <small>${s.topChannel[1]} طلب</small>
      </article>
      <article class="status-card" style="${s.inventoryAlerts > 0 ? "border-color:var(--danger)" : ""}">
        <span>تنبيهات المخزون</span>
        <strong style="${s.inventoryAlerts > 0 ? "color:var(--danger)" : ""}">${s.inventoryAlerts}</strong>
        <small>مادة منخفضة أو نافدة</small>
      </article>
      <article class="status-card">
        <span>زبائن برصيد مدين</span>
        <strong>${s.debitCustomers}</strong>
        <small>رصيد موجب</small>
      </article>
    </div>

    <div class="content-grid" style="margin-top:20px">
      <article class="panel">
        <h3>الطلبات حسب القناة</h3>
        <div class="dash-chart">${bar(s.allChannels, maxCh)}</div>
      </article>
      <article class="panel">
        <h3>الطلبات حسب النوع</h3>
        <div class="dash-chart">${bar(s.allTypes, maxTy)}</div>
      </article>
    </div>

    <div class="content-grid">
      <article class="panel">
        <h3>نشاط آخر 7 أيام</h3>
        <div class="dash-legend">
          <span class="dash-legend-dot" style="background:var(--primary)"></span><span style="font-size:.82rem;color:var(--muted)">مفتوح</span>
          <span class="dash-legend-dot" style="background:var(--line)"></span><span style="font-size:.82rem;color:var(--muted)">مغلق</span>
        </div>
        <div class="dash-chart">${trendRows}</div>
      </article>
      <article class="panel">
        <h3>أكثر 5 عملاء طلباً</h3>
        <div class="dash-chart">${custRows}</div>
      </article>
    </div>
  `);
}

function exportMonthlyReport() {
  if (!window.XLSX) { setNotice("error", "مكتبة Excel غير محملة."); render(); return; }
  const now = new Date();
  const mo = now.getMonth();
  const yr = now.getFullYear();
  const monthly = state.requests.filter((r) => {
    try { const d = new Date(r.createdAt); return d.getMonth() === mo && d.getFullYear() === yr; }
    catch { return false; }
  });
  if (!monthly.length) { setNotice("error", "لا يوجد طلبات لهذا الشهر."); render(); return; }

  const wb = window.XLSX.utils.book_new();
  const reqWs = window.XLSX.utils.aoa_to_sheet([
    ["رقم الطلب", "العميل", "القناة", "النوع", "الحالة", "الملاحظة", "التاريخ"],
    ...monthly.map((r) => [r.publicId || r.id, r.customer, r.channel, r.type, r.status, r.note, r.createdAt || ""])
  ]);
  window.XLSX.utils.book_append_sheet(wb, reqWs, "الطلبات");

  const stageCounts = REQUEST_STAGES.map((s) => [s, monthly.filter((r) => (r.status || "جديد") === s).length]);
  const sumWs = window.XLSX.utils.aoa_to_sheet([
    ["الحالة", "العدد"], ...stageCounts, ["الإجمالي", monthly.length]
  ]);
  window.XLSX.utils.book_append_sheet(wb, sumWs, "ملخص");

  window.XLSX.writeFile(wb, `tobacco-${yr}-${String(mo + 1).padStart(2, "0")}.xlsx`);
  setNotice("success", "تم تصدير التقرير الشهري.");
  render();
}

function staffPage() {
  if (!state.session) {
    return shell(`<section class="panel"><p class="muted">سجّل الدخول للوصول لهذه الصفحة.</p></section>`);
  }
  const isOwner = state.session.email === appConfig.ai.ownerEmail;
  const roles = [
    { name: "الإدارة", desc: "صلاحيات كاملة لجميع الصفحات", pages: ["الطلبات", "الأمين", "التسعير", "الإحصائيات", "الفواتير", "المراقبة", "الدفع"] },
    { name: "خدمة العملاء", desc: "إدارة الطلبات والتواصل مع العملاء", pages: ["الطلبات", "المراقبة"] },
    { name: "المراقبة", desc: "عرض التقارير والإحصائيات فقط", pages: ["الإحصائيات", "المراقبة", "الأمين"] },
    { name: "الدعم الفني", desc: "إدارة المخزون والتسعير", pages: ["الأمين", "التسعير", "الطلبات"] }
  ];
  const rolesHtml = roles.map((r) => `
    <article class="staff-role-card ${state.session.role === r.name ? "active" : ""}">
      <div class="staff-role-head">
        <strong>${escapeHtml(r.name)}</strong>
        ${state.session.role === r.name ? '<span class="staff-badge">دورك الحالي</span>' : ""}
      </div>
      <p class="muted" style="font-size:.85rem;margin:4px 0 8px">${escapeHtml(r.desc)}</p>
      <div class="staff-chips">${r.pages.map((p) => `<span class="staff-chip">${p}</span>`).join("")}</div>
    </article>`).join("");

  return shell(`
    <section class="panel">
      <h3>الموظف الحالي</h3>
      <div class="staff-current">
        <div class="staff-avatar">${escapeHtml((state.session.name || "؟")[0].toUpperCase())}</div>
        <div>
          <strong>${escapeHtml(state.session.name)}</strong>
          <p class="muted" style="font-size:.88rem">${escapeHtml(state.session.role)}</p>
          ${state.session.email ? `<p class="muted" style="font-size:.82rem">${escapeHtml(state.session.email)}</p>` : ""}
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h3>الأدوار الوظيفية</h3>
      <div class="staff-roles-grid">${rolesHtml}</div>
    </section>
    ${isOwner ? `
    <section class="panel" style="margin-top:16px">
      <h3>إضافة موظف جديد</h3>
      <p class="muted" style="margin-bottom:12px">أضف حسابات الموظفين من Supabase ثم شارك بيانات الدخول معهم.</p>
      <ol class="staff-steps">
        <li>افتح <strong>Supabase Dashboard</strong> → Authentication → Users</li>
        <li>اضغط <strong>Add User</strong> وأدخل البريد وكلمة المرور</li>
        <li>شارك بيانات الدخول مع الموظف بشكل آمن</li>
        <li>الموظف يختار دوره عند تسجيل الدخول</li>
      </ol>
    </section>` : ""}
  `);
}

function searchPage() {
  const q = state.globalSearch.trim().toLowerCase();
  if (!q) return shell(`<section class="panel"><p class="muted">اكتب كلمة بحث في شريط الأعلى.</p></section>`);

  const results = [];
  state.requests.forEach((r) => {
    if ((r.customer || "").toLowerCase().includes(q) || (r.note || "").toLowerCase().includes(q)) {
      results.push({ type: "طلب", label: `${r.publicId || r.id} — ${r.customer}`, sub: (r.note || "").slice(0, 50), route: "requests" });
    }
  });
  const invItems = Array.isArray(state.inventoryReports[0]?.items) ? state.inventoryReports[0].items : [];
  invItems.forEach((i) => {
    if ((i.name || "").toLowerCase().includes(q)) {
      results.push({ type: "مخزون", label: i.name, sub: `الكمية: ${i.qty ?? "—"}`, route: "ameen" });
    }
  });
  const balItems = Array.isArray(state.customerBalanceReports?.[0]?.items) ? state.customerBalanceReports[0].items : [];
  balItems.forEach((c) => {
    const name = c.customer_name || c.name || "";
    if (name.toLowerCase().includes(q)) {
      results.push({ type: "عميل", label: name, sub: `الرصيد: ${c.balance ?? "—"}`, route: "ameen" });
    }
  });

  const rows = results.slice(0, 20).map((r) => `
    <button class="search-result-row" data-route="${escapeHtml(r.route)}" data-search-nav>
      <span class="search-result-type">${escapeHtml(r.type)}</span>
      <span class="search-result-label">${escapeHtml(r.label)}</span>
      <small class="muted">${escapeHtml(r.sub)}</small>
    </button>`).join("");

  return shell(`
    <section class="panel">
      <p class="muted" style="margin-bottom:16px">${results.length} نتيجة لـ "<strong>${escapeHtml(state.globalSearch)}</strong>"</p>
      ${rows || '<p class="muted">لا توجد نتائج.</p>'}
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

function renderMarkdown(text) {
  const safe = escapeHtml(String(text ?? ""));
  return safe
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^#{1,3} (.+)$/gm, (_, t) => `<strong style="display:block;margin:8px 0 4px">${t}</strong>`)
    .replace(/^[-•] (.+)$/gm, (_, t) => `<span style="display:block;padding-right:8px">• ${t}</span>`)
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

function getAiKey(provider) {
  return localStorage.getItem(`ozk_ai_key_${provider}`) || appConfig.ai?.[provider]?.apiKey || "";
}

function setAiKey(provider, value) {
  const trimmed = value.trim();
  if (trimmed) localStorage.setItem(`ozk_ai_key_${provider}`, trimmed);
  else localStorage.removeItem(`ozk_ai_key_${provider}`);
}

async function sendAiMessage(input) {
  const message = input.trim();
  if (!message || state.aiLoading) return;

  const aiConfig = appConfig.ai;
  const providerKey = getAiKey(state.aiProvider);
  if (!providerKey) {
    state.aiMessages.push({
      role: "assistant",
      content: `⚠️ مفتاح API غير مضاف. افتح إعدادات المساعد الذكي وأدخل مفتاح ${state.aiProvider === "claude" ? "Anthropic" : "OpenAI"}.`
    });
    state.aiSettingsOpen = true;
    render();
    return;
  }

  state.aiMessages.push({ role: "user", content: message });
  state.aiLoading = true;
  render();

  const scrollBottom = () => {
    const el = document.getElementById("ai-messages");
    if (el) el.scrollTop = el.scrollHeight;
  };
  setTimeout(scrollBottom, 30);

  try {
    let reply = "";

    if (state.aiProvider === "claude") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": providerKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: aiConfig.claude.model || "claude-opus-4-8",
          max_tokens: 4096,
          messages: state.aiMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content }))
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Claude API ${response.status}`);
      reply = data.content?.[0]?.text || "";
    } else {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${providerKey}`
        },
        body: JSON.stringify({
          model: aiConfig.chatgpt.model || "gpt-4o",
          messages: state.aiMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content }))
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `OpenAI API ${response.status}`);
      reply = data.choices?.[0]?.message?.content || "";
    }

    state.aiMessages.push({ role: "assistant", content: reply });
  } catch (err) {
    state.aiMessages.push({ role: "assistant", content: `⚠️ خطأ: ${err.message}` });
  } finally {
    state.aiLoading = false;
    render();
    setTimeout(scrollBottom, 50);
  }
}

function aiAssistant() {
  const ownerEmail = appConfig.ai?.ownerEmail;
  if (state.session?.email !== ownerEmail) {
    return shell(`
      <section class="panel">
        <h2>غير مصرح</h2>
        <p class="muted">المساعد الذكي متاح فقط لحساب مسؤول النظام. سجّل الدخول بالحساب الرئيسي للوصول.</p>
      </section>
    `);
  }

  const msgs = state.aiMessages;
  const claudeKey = getAiKey("claude");
  const chatgptKey = getAiKey("chatgpt");
  const hasKey = Boolean(state.aiProvider === "claude" ? claudeKey : chatgptKey);

  const messagesHtml = msgs.length === 0
    ? `<div class="ai-welcome">
         <p class="ai-welcome-title">مرحباً في المساعد الذكي</p>
         <p class="muted">اكتب أي سؤال أو مهمة. لا يوجد حد للرسائل.</p>
       </div>`
    : msgs.map((m) => `
        <div class="ai-message ${m.role === "user" ? "ai-user" : "ai-bot"}">
          <div class="ai-bubble">${m.role === "assistant" ? renderMarkdown(m.content) : escapeHtml(m.content)}</div>
        </div>`).join("") +
      (state.aiLoading
        ? `<div class="ai-message ai-bot"><div class="ai-bubble ai-thinking"><span></span><span></span><span></span></div></div>`
        : "");

  const settingsPanel = `
    <div class="ai-settings-panel" id="ai-settings-panel">
      <form class="ai-keys-form" data-form="ai-keys">
        <div class="ai-key-row">
          <label class="ai-key-label">
            <span>مفتاح Anthropic (Claude)</span>
            <a class="ai-key-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">احصل على مفتاح ←</a>
          </label>
          <div class="ai-key-input-wrap">
            <input
              type="password"
              class="ai-key-input"
              name="claude_key"
              placeholder="sk-ant-api03-…"
              value="${escapeHtml(claudeKey)}"
              autocomplete="off"
              spellcheck="false"
            />
            <button type="button" class="ai-key-toggle" data-toggle-key="claude_key" title="إظهار/إخفاء">👁</button>
          </div>
        </div>
        <div class="ai-key-row">
          <label class="ai-key-label">
            <span>مفتاح OpenAI (ChatGPT)</span>
            <a class="ai-key-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">احصل على مفتاح ←</a>
          </label>
          <div class="ai-key-input-wrap">
            <input
              type="password"
              class="ai-key-input"
              name="chatgpt_key"
              placeholder="sk-proj-…"
              value="${escapeHtml(chatgptKey)}"
              autocomplete="off"
              spellcheck="false"
            />
            <button type="button" class="ai-key-toggle" data-toggle-key="chatgpt_key" title="إظهار/إخفاء">👁</button>
          </div>
        </div>
        <div class="ai-key-actions">
          <button class="button primary" type="submit">حفظ المفاتيح</button>
          ${claudeKey || chatgptKey ? `<button class="button secondary" type="button" data-action="ai-keys-clear">حذف المفاتيح</button>` : ""}
        </div>
        <p class="ai-key-note">تُحفظ المفاتيح في متصفحك فقط ولا تُرسل لأي خادم آخر.</p>
      </form>
    </div>
  `;

  return shell(`
    <section class="panel wide ai-panel">
      <div class="ai-toolbar">
        <div class="ai-provider-tabs">
          <button class="ai-tab ${state.aiProvider === "claude" ? "active" : ""}" data-ai-provider="claude">Claude</button>
          <button class="ai-tab ${state.aiProvider === "chatgpt" ? "active" : ""}" data-ai-provider="chatgpt">ChatGPT</button>
        </div>
        <div class="ai-toolbar-end">
          ${msgs.length > 0 ? `<button class="button secondary" style="font-size:0.8rem;padding:4px 12px" data-action="ai-clear">مسح</button>` : ""}
          <button class="button secondary ai-settings-btn ${state.aiSettingsOpen ? "active" : ""}" data-action="ai-settings-toggle" title="إعدادات المفاتيح">
            ⚙ إعدادات
          </button>
        </div>
      </div>

      ${state.aiSettingsOpen ? settingsPanel : ""}

      ${!hasKey && !state.aiSettingsOpen ? `
        <div class="notice-panel warning" style="margin-bottom:12px;cursor:pointer" data-action="ai-settings-toggle">
          <strong>مفتاح API مفقود.</strong>
          <span>اضغط هنا أو على "⚙ إعدادات" لإضافة مفتاح ${state.aiProvider === "claude" ? "Anthropic" : "OpenAI"}.</span>
        </div>
      ` : ""}

      <div class="ai-messages" id="ai-messages">${messagesHtml}</div>

      <form class="ai-input-row" data-form="ai-chat">
        <textarea
          class="ai-textarea"
          name="message"
          placeholder="اكتب رسالتك… (Shift+Enter لسطر جديد، Enter للإرسال)"
          rows="2"
          dir="auto"
          ${state.aiLoading ? "disabled" : ""}
        ></textarea>
        <button class="button primary ai-send" type="submit" ${state.aiLoading ? "disabled" : ""}>إرسال</button>
      </form>
    </section>
  `);
}

function invoice() {
  if (!state.session) {
    return shell(`
      <section class="panel">
        <h2>الفواتير بالدولار</h2>
        <p class="muted">سجّل الدخول أولاً للوصول إلى نظام الفواتير.</p>
      </section>
    `);
  }

  const rows = state.invRows;
  const grandTotal = rows.reduce((sum, r) => {
    const qty = toNumber(r.qty);
    const price = toNumber(r.price);
    return sum + qty * price;
  }, 0);

  const rowsHtml = rows.map((r, i) => `
    <tr class="inv-row">
      <td><input class="inv-input" data-inv-field="name" data-inv-index="${i}" value="${escapeHtml(r.name)}" placeholder="اسم المادة" dir="auto"></td>
      <td><input class="inv-input inv-num" data-inv-field="qty" data-inv-index="${i}" value="${escapeHtml(r.qty)}" placeholder="0" type="number" min="0" step="any"></td>
      <td><input class="inv-input inv-num" data-inv-field="price" data-inv-index="${i}" value="${escapeHtml(r.price)}" placeholder="0.00" type="number" min="0" step="any"></td>
      <td class="inv-line-total">$${(toNumber(r.qty) * toNumber(r.price)).toFixed(2)}</td>
      <td>${rows.length > 1 ? `<button class="inv-remove" data-inv-remove="${i}" title="حذف">✕</button>` : ""}</td>
    </tr>
  `).join("");

  return shell(`
    <section class="panel wide inv-panel">
      <div class="inv-form-area">
        <div class="inv-header-fields">
          <label class="inv-label">
            اسم العميل
            <input class="inv-input-main" id="inv-customer" value="${escapeHtml(state.invCustomer)}" placeholder="اسم العميل أو الشركة" maxlength="120">
          </label>
          <label class="inv-label">
            ملاحظة (اختياري)
            <input class="inv-input-main" id="inv-notes" value="${escapeHtml(state.invNotes)}" placeholder="شروط الدفع، الاستحقاق، إلخ…" maxlength="300">
          </label>
        </div>

        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>المادة</th>
                <th style="width:90px">الكمية</th>
                <th style="width:110px">سعر الوحدة $</th>
                <th style="width:100px">المجموع $</th>
                <th style="width:36px"></th>
              </tr>
            </thead>
            <tbody id="inv-body">${rowsHtml}</tbody>
          </table>
        </div>

        <div class="inv-footer">
          <button class="button secondary" data-action="inv-add-row">+ إضافة مادة</button>
          <div class="inv-total-box">
            <span>الإجمالي</span>
            <strong class="inv-grand-total">$${grandTotal.toFixed(2)}</strong>
          </div>
        </div>

        <div class="inv-actions">
          <button class="button primary" data-action="inv-print" ${!state.invCustomer.trim() ? "disabled title='أدخل اسم العميل أولاً'" : ""}>
            🖨 طباعة / حفظ PDF
          </button>
          <button class="button secondary" data-action="inv-reset">مسح</button>
        </div>
      </div>
    </section>
  `);
}

function generateInvoiceNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `INV-${yy}${mm}-${rand}`;
}

function printInvoice() {
  const customer = state.invCustomer.trim();
  const notes = state.invNotes.trim();
  const rows = state.invRows.filter((r) => r.name.trim() && toNumber(r.qty) > 0 && toNumber(r.price) > 0);
  if (!customer || !rows.length) {
    setNotice("error", "أدخل اسم العميل وصف واحد على الأقل بكمية وسعر.");
    render();
    return;
  }

  const invNum = generateInvoiceNumber();
  const today = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "long" }).format(new Date());
  const grandTotal = rows.reduce((s, r) => s + toNumber(r.qty) * toNumber(r.price), 0);

  const rowsHtml = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${toNumber(r.qty)}</td>
      <td>$${toNumber(r.price).toFixed(2)}</td>
      <td>$${(toNumber(r.qty) * toNumber(r.price)).toFixed(2)}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة ${invNum}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 40px; direction: rtl; }
  .inv-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 3px solid #b8860b; padding-bottom: 20px; }
  .inv-company { font-size: 22px; font-weight: 700; color: #5c3d00; letter-spacing: 1px; }
  .inv-company small { display: block; font-size: 12px; font-weight: 400; color: #888; margin-top: 4px; }
  .inv-meta { text-align: left; direction: ltr; }
  .inv-meta p { margin: 3px 0; font-size: 12px; color: #555; }
  .inv-meta strong { color: #1a1a1a; }
  .inv-num { font-size: 16px; font-weight: 700; color: #b8860b; }
  .inv-customer { background: #faf7f0; border: 1px solid #e8dfc8; border-radius: 6px; padding: 14px 18px; margin-bottom: 28px; }
  .inv-customer p { font-size: 12px; color: #888; margin-bottom: 4px; }
  .inv-customer strong { font-size: 15px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #5c3d00; color: #fff; padding: 10px 12px; text-align: right; font-size: 12px; }
  td { padding: 9px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
  tr:nth-child(even) td { background: #fdf9f3; }
  .col-num { width: 36px; text-align: center; color: #aaa; }
  .col-price, .col-total { text-align: left; direction: ltr; font-family: monospace; }
  .total-row td { border-top: 2px solid #b8860b; font-weight: 700; font-size: 14px; background: #faf7f0; }
  .notes { font-size: 12px; color: #666; margin-bottom: 28px; padding: 10px 14px; border-right: 3px solid #b8860b; background: #fdfaf5; }
  .inv-foot { text-align: center; font-size: 11px; color: #aaa; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px; }
  @media print { body { padding: 24px; } @page { margin: 1.5cm; } }
</style>
</head>
<body>
<div class="inv-head">
  <div>
    <div class="inv-company">${escapeHtml(appConfig.name)}<small>${escapeHtml(appConfig.tagline)}</small></div>
  </div>
  <div class="inv-meta">
    <p class="inv-num">${invNum}</p>
    <p><strong>التاريخ:</strong> ${today}</p>
    <p><strong>العملة:</strong> دولار أمريكي (USD)</p>
  </div>
</div>

<div class="inv-customer">
  <p>فاتورة إلى</p>
  <strong>${escapeHtml(customer)}</strong>
</div>

<table>
  <thead>
    <tr>
      <th class="col-num">#</th>
      <th>المادة</th>
      <th style="width:70px">الكمية</th>
      <th style="width:110px" class="col-price">سعر الوحدة</th>
      <th style="width:110px" class="col-total">المجموع</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="3"></td>
      <td>الإجمالي</td>
      <td class="col-total">$${grandTotal.toFixed(2)}</td>
    </tr>
  </tfoot>
</table>

${notes ? `<div class="notes"><strong>ملاحظة:</strong> ${escapeHtml(notes)}</div>` : ""}

<div class="inv-foot">${escapeHtml(appConfig.name)} &mdash; ${escapeHtml(appConfig.supportEmail)}</div>

<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

  const win = window.open("", "_blank", "width=850,height=1100");
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    setNotice("error", "يرجى السماح بالنوافذ المنبثقة لطباعة الفاتورة.");
    render();
  }
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

const REQUEST_STAGES = ["جديد", "قيد التجهيز", "جاهز للتسليم", "مغلق"];
const STAGE_CLASS = { "جديد": "chip-new", "قيد التجهيز": "chip-progress", "جاهز للتسليم": "chip-ready", "مغلق": "chip-closed" };

function requestCard(request) {
  const status = REQUEST_STAGES.includes(request.status) ? request.status : "جديد";
  const idx = REQUEST_STAGES.indexOf(status);
  const next = REQUEST_STAGES[idx + 1] || null;
  return `
    <article class="request-card">
      <div>
        <strong>${escapeHtml(request.publicId || request.id)} - ${escapeHtml(request.customer)}</strong>
        <span>${escapeHtml(request.channel)} / ${escapeHtml(request.type)}</span>
      </div>
      <p>${escapeHtml(request.note)}</p>
      <div class="request-actions">
        <span class="status-chip ${STAGE_CLASS[status] || ""}">${escapeHtml(status)}</span>
        ${next ? `<button class="button secondary compact-button" type="button" data-request="${escapeHtml(request.id)}" data-status="${next}">→ ${next}</button>` : ""}
        ${status !== "مغلق" ? `<button class="button secondary compact-button" type="button" data-request="${escapeHtml(request.id)}" data-status="مغلق">إغلاق</button>` : `<button class="button secondary compact-button" type="button" data-request="${escapeHtml(request.id)}" data-status="جديد">إعادة فتح</button>`}
      </div>
    </article>
  `;
}

function updateAmeenBrowserResults() {
  const latest = state.inventoryReports[0];
  const items = reportItems(latest);
  const filtered = ameenFilteredItems(items);
  const results = app.querySelector("[data-ameen-results]");
  const count = app.querySelector("[data-ameen-count]");
  const exportButton = app.querySelector("[data-action='download-filtered-inventory']");

  if (results) {
    results.innerHTML = filtered.length
      ? filtered.slice(0, 80).map(inventoryRow).join("")
      : '<p class="muted">لا توجد مواد تطابق البحث والفلتر الحالي.</p>';
  }

  if (count) {
    count.textContent = `يعرض ${filtered.length} من ${items.length}`;
  }

  if (exportButton) {
    exportButton.disabled = filtered.length === 0;
  }

  app.querySelectorAll("[data-ameen-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.ameenFilter === state.ameenFilter);
  });
}

function updateCustomerBalanceResults() {
  const latest = state.customerBalanceReports[0];
  const items = latest ? latestCustomerBalanceItems() : [];
  const filtered = filteredCustomerItems(items);
  const results = app.querySelector("[data-customer-results]");
  const count = app.querySelector("[data-customer-count]");
  const exportButton = app.querySelector("[data-action='download-customer-balances']");

  if (results) {
    results.innerHTML = filtered.length
      ? filtered.slice(0, 80).map(customerBalanceRow).join("")
      : '<p class="muted">لا توجد زبائن تطابق البحث والفلتر الحالي.</p>';
    bindCustomerLimitForms(results);
    bindCustomerDetailButtons(results);
  }

  if (count) {
    count.textContent = `يعرض ${filtered.length} من ${items.length}`;
  }

  if (exportButton) {
    exportButton.disabled = filtered.length === 0;
  }

  app.querySelectorAll("[data-customer-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.customerFilter === state.customerFilter);
  });
}

function bindCustomerLimitForms(root = app) {
  root.querySelectorAll("[data-form='customer-limit']").forEach((form) => {
    if (form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveCustomerLimit(event.currentTarget);
    });
  });
}

function bindCustomerDetailButtons(root = app) {
  root.querySelectorAll("[data-customer-details]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      state.selectedCustomerKey = button.dataset.customerDetails;
      render();
    });
  });
}

function bindPricingForms(root = app) {
  root.querySelectorAll("[data-form='pricing-item']").forEach((form) => {
    if (form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      savePricingItem(event.currentTarget);
    });
  });
}

function render() {
  const pages = {
    overview,
    login,
    requests,
    ameen,
    pricing,
    remote,
    monitoring,
    payments,
    invoice,
    dashboard,
    staff: staffPage,
    search: searchPage,
    ai: aiAssistant
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
  app.querySelector("[data-action='enable-notif']")?.addEventListener("click", requestNotifPermission);
  app.querySelector("[data-action='export-monthly']")?.addEventListener("click", exportMonthlyReport);

  app.querySelector("[data-form='global-search']")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = e.currentTarget.elements.q.value.trim();
    state.globalSearch = q;
    if (q) setRoute("search");
  });

  app.querySelectorAll("[data-search-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.globalSearch = "";
      setRoute(btn.dataset.route);
    });
  });

  // Invoice handlers
  app.querySelector("#inv-customer")?.addEventListener("input", (e) => {
    state.invCustomer = e.currentTarget.value;
    render();
  });
  app.querySelector("#inv-notes")?.addEventListener("input", (e) => {
    state.invNotes = e.currentTarget.value;
  });
  app.querySelectorAll("[data-inv-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const i = Number(e.currentTarget.dataset.invIndex);
      const field = e.currentTarget.dataset.invField;
      state.invRows[i][field] = e.currentTarget.value;
      const tbody = document.getElementById("inv-body");
      if (tbody) {
        const cells = tbody.querySelectorAll("tr")[i]?.querySelectorAll(".inv-line-total");
        if (cells?.[0]) {
          const qty = toNumber(state.invRows[i].qty);
          const price = toNumber(state.invRows[i].price);
          cells[0].textContent = `$${(qty * price).toFixed(2)}`;
        }
        const grandEl = document.querySelector(".inv-grand-total");
        if (grandEl) {
          const total = state.invRows.reduce((s, r) => s + toNumber(r.qty) * toNumber(r.price), 0);
          grandEl.textContent = `$${total.toFixed(2)}`;
        }
      }
    });
  });
  app.querySelectorAll("[data-inv-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.invRemove);
      state.invRows.splice(i, 1);
      render();
    });
  });
  app.querySelector("[data-action='inv-add-row']")?.addEventListener("click", () => {
    state.invRows.push({ name: "", qty: "1", price: "" });
    render();
  });
  app.querySelector("[data-action='inv-print']")?.addEventListener("click", printInvoice);
  app.querySelector("[data-action='inv-reset']")?.addEventListener("click", () => {
    state.invCustomer = "";
    state.invNotes = "";
    state.invRows = [{ name: "", qty: "1", price: "" }];
    render();
  });
  app.querySelector("[data-action='ai-clear']")?.addEventListener("click", () => {
    state.aiMessages = [];
    render();
  });

  app.querySelector("[data-action='ai-settings-toggle']")?.addEventListener("click", () => {
    state.aiSettingsOpen = !state.aiSettingsOpen;
    render();
  });

  app.querySelector("[data-action='ai-keys-clear']")?.addEventListener("click", () => {
    if (confirm("هل تريد حذف جميع مفاتيح API المحفوظة؟")) {
      setAiKey("claude", "");
      setAiKey("chatgpt", "");
      render();
    }
  });

  app.querySelectorAll("[data-toggle-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".ai-key-input-wrap")?.querySelector("input");
      if (input) input.type = input.type === "password" ? "text" : "password";
    });
  });

  app.querySelector("[data-form='ai-keys']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setAiKey("claude", form.elements.claude_key.value);
    setAiKey("chatgpt", form.elements.chatgpt_key.value);
    state.aiSettingsOpen = false;
    render();
  });

  app.querySelectorAll("[data-ai-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.aiProvider = btn.dataset.aiProvider;
      render();
    });
  });

  const aiForm = app.querySelector("[data-form='ai-chat']");
  if (aiForm) {
    const aiTextarea = aiForm.querySelector("textarea");
    aiTextarea?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!state.aiLoading) {
          sendAiMessage(aiTextarea.value);
          aiTextarea.value = "";
        }
      }
    });
    aiForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.aiLoading && aiTextarea) {
        sendAiMessage(aiTextarea.value);
        aiTextarea.value = "";
      }
    });
  }
  app.querySelector("[data-action='export-ameen']")?.addEventListener("click", exportRequestsForAmeen);
  app.querySelector("[data-action='download-prices']")?.addEventListener("click", downloadFilteredPriceList);
  app.querySelector("[data-action='download-price-template']")?.addEventListener("click", downloadLivePriceTemplate);
  app.querySelector("[data-action='download-daily-pricing']")?.addEventListener("click", downloadDailyPricingWorklist);
  app.querySelector("[data-action='download-approved-prices']")?.addEventListener("click", downloadApprovedPricesForAccounting);
  app.querySelector("[data-action='download-inventory']")?.addEventListener("click", downloadLatestInventoryReport);
  app.querySelector("[data-action='download-filtered-inventory']")?.addEventListener("click", downloadFilteredInventoryReport);
  app.querySelector("[data-action='download-customer-balances']")?.addEventListener("click", downloadFilteredCustomerBalances);
  app.querySelector("[data-action='refresh-ameen']")?.addEventListener("click", refreshAmeenReports);
  app.querySelector("[data-action='clear-customer-details']")?.addEventListener("click", () => {
    state.selectedCustomerKey = "";
    render();
  });

  app.querySelector("[data-ameen-search]")?.addEventListener("input", (event) => {
    state.ameenSearch = event.currentTarget.value;
    updateAmeenBrowserResults();
  });

  app.querySelector("[data-ameen-sort]")?.addEventListener("change", (event) => {
    state.ameenSort = event.currentTarget.value;
    updateAmeenBrowserResults();
  });

  app.querySelector("[data-pricing-search]")?.addEventListener("input", (event) => {
    state.pricingSearch = event.currentTarget.value;
    render();
  });

  app.querySelectorAll("[data-ameen-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ameenFilter = button.dataset.ameenFilter;
      updateAmeenBrowserResults();
    });
  });

  app.querySelector("[data-customer-search]")?.addEventListener("input", (event) => {
    state.customerSearch = event.currentTarget.value;
    updateCustomerBalanceResults();
  });

  app.querySelector("[data-customer-sort]")?.addEventListener("change", (event) => {
    state.customerSort = event.currentTarget.value;
    updateCustomerBalanceResults();
  });

  app.querySelectorAll("[data-customer-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.customerFilter = button.dataset.customerFilter;
      updateCustomerBalanceResults();
    });
  });

  bindCustomerLimitForms();
  bindCustomerDetailButtons();
  bindPricingForms();

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

  app.querySelector("[data-form='live-price-import']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    importLivePriceList(event.currentTarget);
  });

  app.querySelectorAll("[data-request]").forEach((button) => {
    button.addEventListener("click", () => updateRequest(button.dataset.request, button.dataset.status));
  });
}

boot();

setInterval(() => {
  if (state.route === "ameen" && (!dataStore.isConfigured() || state.session)) {
    Promise.all([loadInventoryReports(), loadCustomerBalanceReports(), loadCustomerCreditLimits(), loadApprovedPriceItems()])
      .then(() => render())
      .catch(() => {});
  }
}, 60000);

setInterval(async () => {
  if (!state.session && dataStore.isConfigured()) return;
  try {
    const fresh = await dataStore.listRequests();
    const newOnes = fresh.filter((r) => !state.seenRequestIds.has(r.id));
    newOnes.forEach((r) => {
      fireRequestNotif(r.customer);
      state.seenRequestIds.add(r.id);
    });
    if (newOnes.length) {
      state.requests = fresh;
      render();
    }
  } catch {}
}, 30000);
