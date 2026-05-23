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

function normalizeNumericText(value, options = {}) {
  const { allowNegative = true, allowDecimal = true } = options;
  let text = String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٫،]/g, ".")
    .replace(/\s+/g, "")
    .trim();

  const commaCount = (text.match(/,/g) || []).length;
  if (allowDecimal && !text.includes(".") && commaCount === 1) {
    const [, decimalPart = ""] = text.split(",");
    if (/^\d{1,2}$/.test(decimalPart)) {
      text = text.replace(",", ".");
    }
  }

  text = text.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const isNegative = allowNegative && text.includes("-");
  text = text.replace(/-/g, "");

  if (!allowDecimal) {
    text = text.replace(/\./g, "");
  } else {
    const parts = text.split(".");
    text = `${parts.shift() || ""}${parts.length ? `.${parts.join("")}` : ""}`;
    if (text.startsWith(".")) text = `0${text}`;
  }

  return isNegative && text ? `-${text}` : text;
}

function toNumber(value) {
  const text = normalizeNumericText(value);
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function roundPrice(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 1000) / 1000;
}

function toPositivePrice(value) {
  return Math.max(0, roundPrice(toNumber(value)));
}

function samePrice(left, right) {
  return Math.abs(roundPrice(left) - roundPrice(right)) <= 0.005;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "غير معروف";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDate(value) {
  if (!value) return "غير متوفر";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
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

const allowedRoutes = new Set(["overview", "login", "requests", "ameen", "pricing", "remote", "monitoring", "payments"]);

const customerPriceContacts = [
  { label: "هاتف المبيعات", value: "0985000771" },
  { label: "واتساب", value: "0984000662" },
  { label: "رقم المركز", value: "0994092038" }
];

function initialRoute() {
  const requestedRoute = new URLSearchParams(window.location.search).get("route");
  return allowedRoutes.has(requestedRoute) ? requestedRoute : "overview";
}

const state = {
  route: initialRoute(),
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
  await loadCustomerBalanceReports();
  await loadCustomerCreditLimits();
  await loadApprovedPriceItems();
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
    row.some((cell) => {
      const text = String(cell ?? "").trim();
      const normalized = normalizeItemName(text);
      return (
        text.includes("اسم المادة") ||
        text === "المادة" ||
        normalized === "item name" ||
        normalized === "item key" ||
        normalized === "material name"
      );
    })
  );
  if (index === -1) throw new Error("لم أجد عمود اسم المادة داخل ملف Excel.");
  return index;
}

function findColumn(header, candidates) {
  return header.findIndex((cell) => {
    const text = String(cell ?? "").trim();
    const normalizedText = normalizeItemName(text);
    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeItemName(candidate);
      return text.includes(candidate) || (normalizedCandidate && normalizedText.includes(normalizedCandidate));
    });
  });
}

function findPriceColumns(headers) {
  return headers
    .map((header, index) => {
      const text = String(header ?? "").trim();
      const normalized = normalizeItemName(text);
      const isPriceColumn = text.includes("سعر") || /\b(price|sale)\b/i.test(normalized);
      if (!isPriceColumn) return null;

      const isUnit1 =
        /\bunit\s*1\b/i.test(normalized) ||
        normalized.includes("unit1") ||
        normalized.includes("first unit") ||
        normalized.includes("sale price") ||
        normalized.includes("الوحده الاولي") ||
        normalized.includes("الوحده الاولى");
      const isUnit2 =
        /\bunit\s*2\b/i.test(normalized) ||
        normalized.includes("unit2") ||
        normalized.includes("second unit") ||
        normalized.includes("الوحده الثانيه");

      return {
        index,
        header: text,
        unit: isUnit1 && !isUnit2 ? "unit1" : "unit2"
      };
    })
    .filter(Boolean);
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
  const itemIndex = findColumn(headers, ["اسم المادة", "المادة", "الصنف", "item_name", "item name", "material_name", "material name"]);
  const itemKeyIndex = findColumn(headers, ["item_key", "item key", "مفتاح المادة"]);
  if (itemIndex < 0 && itemKeyIndex < 0) throw new Error("ملف الأسعار لا يحتوي على عمود اسم المادة.");
  const priceColumns = findPriceColumns(headers);
  if (!priceColumns.length) throw new Error("ملف الأسعار لا يحتوي على عمود سعر واضح.");
  const priceIndexes = priceColumns.map((column) => column.index);

  const priceRows = rows
    .slice(headerIndex + 1)
    .map((row) => {
      const nameValue = itemIndex >= 0 ? row[itemIndex] : row[itemKeyIndex];
      const keyValue = itemKeyIndex >= 0 ? row[itemKeyIndex] : nameValue;
      const key = normalizeItemName(keyValue || nameValue);
      const name = String(nameValue ?? keyValue ?? "").trim();
      return {
        key,
        name,
        hasPrice: priceColumns.some((column) => toPositivePrice(row[column.index]) > 0),
        raw: headers.map((_, index) => row[index] ?? "")
      };
    })
    .filter((row) => row.key && row.name && row.key !== normalizeItemName("اسم المادة"));

  if (!priceRows.length) throw new Error("ملف الأسعار لا يحتوي على مواد قابلة للقراءة.");
  return { sheetName, headers, rows: priceRows, priceIndexes, priceColumns };
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

function firstPositivePrice(rawRow, priceColumns, unit) {
  for (const column of priceColumns || []) {
    if (unit && column.unit !== unit) continue;
    const price = toPositivePrice(rawRow[column.index]);
    if (price > 0) return price;
  }
  return 0;
}

function normalizePriceForItem(rawRow, priceColumns, unit2Factor) {
  const factor = Math.max(1, toPositivePrice(unit2Factor) || 1);
  const rawUnit2Price = firstPositivePrice(rawRow, priceColumns, "unit2");
  const rawUnit1Price = firstPositivePrice(rawRow, priceColumns, "unit1");

  if (rawUnit2Price > 0) {
    const unit2Price = roundPrice(rawUnit2Price);
    const unit1Price = roundPrice(unit2Price / factor);
    return {
      unit2Price,
      unit1Price,
      salePrice: unit1Price,
      sourceUnit: "unit2",
      wasCorrected: rawUnit1Price > 0 && !samePrice(rawUnit1Price, unit1Price)
    };
  }

  if (rawUnit1Price > 0) {
    const unit1Price = roundPrice(rawUnit1Price);
    return {
      unit2Price: roundPrice(unit1Price * factor),
      unit1Price,
      salePrice: unit1Price,
      sourceUnit: "unit1",
      wasCorrected: factor > 1
    };
  }

  return { unit2Price: 0, unit1Price: 0, salePrice: 0, sourceUnit: "", wasCorrected: false };
}

function correctedPriceRow(rawRow, priceColumns, normalizedPrice) {
  const next = [...rawRow];
  const unit2Column = (priceColumns || []).find((column) => column.unit === "unit2");
  const unit1Column = (priceColumns || []).find((column) => column.unit === "unit1");
  if (unit2Column) next[unit2Column.index] = normalizedPrice.unit2Price;
  if (unit1Column) next[unit1Column.index] = normalizedPrice.unit1Price;
  return next;
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
    itemUnit2Name(item),
    itemUnit2Factor(item),
    "",
    itemUnit1Name(item),
    statusLabel(item.status),
    reportSyncedAt(latest)
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["اسم المادة", "الكمية المتوفرة", "سعر البيع", "الحالة", "آخر مزامنة"],
    ...rows
  ]);
  window.XLSX.utils.sheet_add_aoa(
    worksheet,
    [["اسم المادة", "الكمية المتوفرة", "الوحدة الثانية", "عامل التحويل", "سعر الوحدة الثانية", "الوحدة الأولى", "الحالة", "آخر مزامنة"]],
    { origin: "A1" }
  );
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
    let correctedPriceRows = 0;
    const approvedItems = filteredRows.map((row) => {
      const stockItem = availableByKey.get(row.key);
      const unit2Factor = itemUnit2Factor(stockItem);
      const normalizedPrice = normalizePriceForItem(row.raw, price.priceColumns, unit2Factor);
      if (normalizedPrice.wasCorrected) correctedPriceRows += 1;
      row.correctedRaw = correctedPriceRow(row.raw, price.priceColumns, normalizedPrice);
      return {
        itemKey: row.key,
        itemName: row.name,
        unit1Name: itemUnit1Name(stockItem),
        unit2Name: itemUnit2Name(stockItem),
        unit2Factor,
        unit2Price: normalizedPrice.unit2Price,
        unit1Price: normalizedPrice.unit1Price,
        salePrice: normalizedPrice.salePrice,
        stockQty: itemQty(stockItem),
        stockStatus: stockItem?.status || "active",
        sourceReportId: uuidOrNull(latest.id),
        sourceSyncedAt: reportSyncedAt(latest),
        pricePayload: {
          pricedUnit: normalizedPrice.sourceUnit,
          correctedAutomatically: normalizedPrice.wasCorrected,
          headers: price.headers,
          row: row.raw
        }
      };
    });

    state.priceExport = {
      sheetName: price.sheetName,
      headers: price.headers,
      rows: filteredRows.map((row) => row.correctedRaw || row.raw),
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
    const correctionText = correctedPriceRows ? ` وتم تصحيح ${correctedPriceRows} سعر تلقائياً حسب عامل التحويل.` : "";
    setNotice(
      zeroPriceRows.length || saveWarning ? "error" : "success",
      `تم تنزيل لائحة البيع النهائية: ${filteredRows.length} مادة. تم حذف ${excludedRows.length} غير موجودة في المستودع، و${zeroPriceRows.length} موجودة لكن بلا سعر. تم استبدال لائحة المحاسبة بـ ${savedCount} سعر.${correctionText}${saveWarning}`
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
    Number(item.unit2Price || 0),
    item.unit2Name || "",
    Number(item.unit2Factor || 1),
    itemUnit1PriceFromSecondUnit(item),
    item.unit1Name || "",
    Number(item.stockQty || 0),
    item.stockStatus || "",
    item.approvedAt || item.updatedAt || ""
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["اسم المادة", "سعر البيع", "الكمية", "الحالة", "وقت الاعتماد"],
    ...rows
  ]);
  window.XLSX.utils.sheet_add_aoa(
    worksheet,
    [["اسم المادة", "سعر الوحدة الثانية", "الوحدة الثانية", "عامل التحويل", "سعر الوحدة الأولى", "الوحدة الأولى", "الكمية", "الحالة", "وقت الاعتماد"]],
    { origin: "A1" }
  );
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "accounting-prices");
  window.XLSX.writeFile(workbook, `tobacco-accounting-prices-${todayIsoDate()}.xlsx`);
  setNotice("success", "تم تنزيل الأسعار المعتمدة للمحاسبة.");
  render();
}

function customerPriceListItems() {
  const prices = approvedPriceMap();
  return liveAvailableItems()
    .map((item) => {
      const key = item.key || normalizeItemName(item.name);
      const approvedPrice = prices.get(key);
      const pricedItem = { ...item, key, approvedPrice };
      const unit2Price = itemUnit2Price(pricedItem);
      const unit1Price = itemUnit1PriceFromSecondUnit(pricedItem);
      return {
        ...pricedItem,
        groupName: item.groupName || "مواد بدون مجموعة",
        unit1Name: itemUnit1Name(pricedItem),
        unit2Name: itemUnit2Name(pricedItem),
        unit2Factor: itemUnit2Factor(pricedItem),
        unit2Price,
        unit1Price,
        salePrice: unit1Price
      };
    })
    .filter((item) => itemQty(item) > 0 && (item.unit2Price > 0 || item.unit1Price > 0))
    .sort(
      (a, b) =>
        String(a.groupName || "").localeCompare(String(b.groupName || ""), "ar") ||
        String(a.name || "").localeCompare(String(b.name || ""), "ar")
    );
}

function groupCustomerPriceItems(items) {
  const groups = new Map();
  items.forEach((item) => {
    const groupName = item.groupName || "مواد بدون مجموعة";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(item);
  });
  return [...groups.entries()].map(([name, groupItems]) => ({ name, items: groupItems }));
}

function pricePdfItem(item) {
  const unit2Label = item.unit2Name || item.unit1Name || "وحدة";
  const unit1Label = item.unit1Name || "حبة";
  const unit2Price = item.unit2Price > 0 ? formatMoney(item.unit2Price) : "";
  const unit1Price = item.unit1Price > 0 ? formatMoney(item.unit1Price) : "";
  return `
    <article class="price-pdf-item">
      <strong>${escapeHtml(item.name || "")}</strong>
      <span>${escapeHtml(unit2Label)}: ${escapeHtml(unit2Price)}</span>
      <small>${escapeHtml(unit1Label)}: ${escapeHtml(unit1Price)}</small>
    </article>
  `;
}

function pricePdfGroup(group) {
  return `
    <section class="price-pdf-group">
      <h2>${escapeHtml(group.name)}</h2>
      <div class="price-pdf-grid">
        ${group.items.map(pricePdfItem).join("")}
      </div>
    </section>
  `;
}

function customerPricePdfMarkup(items, latest) {
  const groups = groupCustomerPriceItems(items);
  const syncedAt = reportSyncedAt(latest);
  return `
    <div class="price-pdf-sheet" dir="rtl">
      <header class="price-pdf-header">
        <div>
          <h1>OZK TOBACCO</h1>
          <p>نشرة أسعار الأصناف المتوفرة فقط</p>
        </div>
        <span>${escapeHtml(todayIsoDate())}</span>
      </header>
      <div class="price-pdf-meta">
        <span>عدد الأصناف: ${escapeHtml(items.length)}</span>
        <span>آخر مزامنة جرد: ${escapeHtml(formatDateTime(syncedAt))}</span>
        <span>الأسعار قابلة للتحديث حسب توفر المخزون</span>
      </div>
      ${groups.map(pricePdfGroup).join("")}
    </div>
  `;
}

function customerPriceContactMarkup() {
  return customerPriceContacts
    .map(
      (contact) => `
        <span class="price-pdf-contact">
          <b>${escapeHtml(contact.label)}</b>
          ${escapeHtml(contact.value)}
        </span>
      `
    )
    .join("");
}

function pricePdfItem(item) {
  const unit2Label = item.unit2Name || item.unit1Name || "وحدة";
  const unit1Label = item.unit1Name || "حبة";
  const unit2Price = item.unit2Price > 0 ? formatMoney(item.unit2Price) : "";
  const unit1Price = item.unit1Price > 0 ? formatMoney(item.unit1Price) : "";
  const primaryPrice = unit2Price || unit1Price;
  const primaryUnit = unit2Price ? unit2Label : unit1Label;
  const secondaryText = unit2Price && unit1Price ? `${unit1Label}: ${unit1Price}` : "";
  return `
    <div class="price-pdf-item">
      <span class="price-pdf-name">${escapeHtml(item.name || "")}</span>
      <b>${escapeHtml(primaryPrice)}</b>
      <small>${escapeHtml(primaryUnit)}${secondaryText ? ` / ${escapeHtml(secondaryText)}` : ""}</small>
    </div>
  `;
}

function pricePdfGroup(group) {
  return `
    <section class="price-pdf-group">
      <h2>${escapeHtml(group.name)}</h2>
      <div class="price-pdf-rows">
        ${group.items.map(pricePdfItem).join("")}
      </div>
    </section>
  `;
}

function pricePdfColumns(groups) {
  const columns = [[], [], []];
  groups.forEach((group, index) => {
    columns[index % columns.length].push(group);
  });
  return columns
    .map(
      (columnGroups) => `
        <div class="price-pdf-column">
          ${columnGroups.map(pricePdfGroup).join("")}
        </div>
      `
    )
    .join("");
}

function customerPricePdfMarkup(items, latest) {
  const groups = groupCustomerPriceItems(items);
  const syncedAt = reportSyncedAt(latest);
  return `
    <div class="price-pdf-sheet" dir="rtl">
      <header class="price-pdf-header">
        <div>
          <h1>قائمة أسعار OZK TOBACCO</h1>
          <p>نشرة أسعار الأصناف المتوفرة للزبائن</p>
        </div>
        <div class="price-pdf-date">
          <span>تاريخ النشرة</span>
          <b>${escapeHtml(todayIsoDate())}</b>
        </div>
      </header>
      <div class="price-pdf-meta">
        <span>عدد الأصناف: ${escapeHtml(items.length)}</span>
        <span>آخر مزامنة جرد: ${escapeHtml(formatDateTime(syncedAt))}</span>
        ${customerPriceContactMarkup()}
      </div>
      <main class="price-pdf-groups">
        ${pricePdfColumns(groups)}
      </main>
      <footer class="price-pdf-footer">
        الأسعار قابلة للتحديث حسب توفر المخزون. للاستفسار يرجى التواصل عبر الأرقام أعلاه.
      </footer>
    </div>
  `;
}

async function downloadCustomerPricePdf() {
  const latest = state.inventoryReports[0];
  const items = customerPriceListItems();
  if (!latest || !items.length) {
    setNotice("error", "لا توجد مواد متوفرة ومُسعّرة لإنشاء نشرة PDF للزبائن.");
    render();
    return;
  }
  if (!window.html2pdf) {
    setNotice("error", "مكتبة PDF لم تتحمل بعد. حدث الصفحة ثم جرب مرة أخرى.");
    render();
    return;
  }

  const container = document.createElement("div");
  container.className = "price-pdf-render";
  container.innerHTML = customerPricePdfMarkup(items, latest);
  document.body.appendChild(container);

  try {
    await window
      .html2pdf()
      .set({
        filename: `ozk-customer-prices-${todayIsoDate()}.pdf`,
        margin: [6, 6, 8, 6],
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: [".price-pdf-group", ".price-pdf-group h2"] }
      })
      .from(container.firstElementChild)
      .save();
    setNotice("success", `تم تجهيز نشرة PDF للزبائن: ${items.length} صنف متوفر ومُسعّر فقط.`);
  } catch (error) {
    setNotice("error", error.message || "تعذر إنشاء ملف PDF.");
  } finally {
    container.remove();
  }
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
        unit1Name: item.unit1Name || price?.unit1Name || "",
        unit2Name: item.unit2Name || price?.unit2Name || item.unit1Name || "",
        unit2Factor: itemUnit2Factor({ ...item, approvedPrice: price }),
        unit2Price: itemUnit2Price({ ...item, approvedPrice: price }),
        hasApprovedPrice: Boolean(price && (Number(price.salePrice || 0) > 0 || Number(price.unit2Price || 0) > 0))
      };
    })
    .filter((item) => {
      if (!query) return true;
      return String(item.key || "").includes(query) || normalizeItemName(item.name).includes(query);
    })
    .sort((a, b) => Number(a.hasApprovedPrice) - Number(b.hasApprovedPrice) || String(a.name || "").localeCompare(String(b.name || ""), "ar"));
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
    itemUnit2Name(item),
    itemUnit2Factor(item),
    item.unit2Price > 0 ? item.unit2Price : "",
    item.salePrice > 0 ? item.salePrice : "",
    itemUnit1Name(item),
    item.hasApprovedPrice ? "سعر معتمد" : "بحاجة تسعير",
    item.approvedPrice?.approvedAt || item.approvedPrice?.updatedAt || "",
    reportSyncedAt(latest)
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([
    ["اسم المادة", "الكمية المتوفرة", "سعر البيع", "حالة التسعير", "آخر اعتماد", "آخر مزامنة جرد"],
    ...rows
  ]);
  window.XLSX.utils.sheet_add_aoa(
    worksheet,
    [["اسم المادة", "الكمية المتوفرة", "الوحدة الثانية", "عامل التحويل", "سعر الوحدة الثانية", "سعر الوحدة الأولى", "الوحدة الأولى", "حالة التسعير", "آخر اعتماد", "آخر مزامنة جرد"]],
    { origin: "A1" }
  );
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
    const latestItem = reportItems(latest).find((item) => (item.key || normalizeItemName(item.name)) === itemKey);
    const unit1Name = form.dataset.unit1Name || itemUnit1Name(latestItem) || "";
    const unit2Name = form.dataset.unit2Name || itemUnit2Name(latestItem) || unit1Name;
    const formUnit2Factor = toNumber(form.dataset.unit2Factor || 0);
    const liveUnit2Factor = itemUnit2Factor(latestItem);
    const unit2Factor = Math.max(1, liveUnit2Factor > 1 ? liveUnit2Factor : formUnit2Factor || 1);
    const unit2Price = toPositivePrice(formValue(form, "salePrice"));
    const salePrice = roundPrice(unit2Price / unit2Factor);
    const stockQty = toNumber(form.dataset.stockQty);
    const stockStatus = form.dataset.stockStatus || "active";
    if (unit2Price <= 0) throw new Error("اكتب سعر الوحدة الثانية أكبر من صفر.");

    if (!latest) throw new Error("لا يوجد جرد حي للمطابقة.");
    if (!itemKey || !itemName) throw new Error("لا يمكن حفظ السعر بدون مادة واضحة.");
    if (salePrice <= 0) throw new Error("اكتب سعر بيع أكبر من صفر.");
    if (!dataStore.upsertApprovedPriceItems) throw new Error("حفظ الأسعار غير مفعل في قاعدة البيانات.");

    const saved = await dataStore.upsertApprovedPriceItems([
      {
        itemKey,
        itemName,
        unit1Name,
        unit2Name,
        unit2Factor,
        unit2Price,
        unit1Price: salePrice,
        salePrice,
        stockQty,
        stockStatus,
        sourceReportId: uuidOrNull(latest.id),
        sourceSyncedAt: reportSyncedAt(latest),
        pricePayload: {
          source: "phone_pricing_page",
          pricedUnit: "unit2",
          pricedDate: todayIsoDate()
        }
      }
    ]);
    const priceMap = approvedPriceMap();
    saved.forEach((item) => priceMap.set(item.itemKey, item));
    state.approvedPriceItems = [...priceMap.values()].sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || ""), "ar"));
    setNotice(
      "success",
      `تم حفظ سعر ${itemName}. سعر ${unit2Name}: ${formatMoney(unit2Price)} / عامل التحويل: ${formatMoney(unit2Factor)} / سعر ${unit1Name}: ${formatMoney(salePrice)}.`
    );
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
          ${navButton("login", "تسجيل الدخول")}
          ${navButton("requests", "طلبات العملاء")}
          ${navButton("ameen", "الأمين")}
          ${navButton("pricing", "التسعير")}
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
    overview: "لوحة OZK",
    login: "تسجيل الدخول",
    requests: "طلبات العملاء",
    ameen: "تقارير الأمين",
    pricing: "التسعير",
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

const ameenFilters = [
  { id: "alerts", label: "تنبيهات" },
  { id: "all", label: "الكل" },
  { id: "low", label: "قريب النفاد" },
  { id: "zero", label: "صفر" },
  { id: "negative", label: "سالب" },
  { id: "available", label: "موجود" }
];

function itemQty(item) {
  const qty = Number(item?.stockQty || 0);
  const positiveQty = Number(item?.stockQtyPositive || 0);
  return qty > 0 ? qty : positiveQty;
}

function itemUnit1Name(item) {
  return item?.unit1Name || item?.approvedPrice?.unit1Name || "الوحدة الأولى";
}

function itemUnit2Name(item) {
  return item?.unit2Name || item?.approvedPrice?.unit2Name || itemUnit1Name(item);
}

function itemUnit2Factor(item) {
  const factor = Number(item?.unit2Factor || item?.approvedPrice?.unit2Factor || 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function itemUnit2Price(item) {
  const savedUnit2Price = Number(item?.unit2Price || item?.approvedPrice?.unit2Price || 0);
  if (savedUnit2Price > 0) return roundPrice(savedUnit2Price);
  const unit1Price = Number(item?.salePrice || item?.approvedPrice?.salePrice || 0);
  return unit1Price > 0 ? roundPrice(unit1Price * itemUnit2Factor(item)) : 0;
}

function itemUnit1PriceFromSecondUnit(item) {
  const unit2Price = Number(item?.unit2Price || item?.approvedPrice?.unit2Price || 0);
  const unit2Factor = itemUnit2Factor(item);
  if (unit2Price > 0 && unit2Factor > 0) return roundPrice(unit2Price / unit2Factor);
  return roundPrice(Number(item?.salePrice || item?.approvedPrice?.salePrice || item?.unit1Price || item?.approvedPrice?.unit1Price || 0));
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
  const unit2Price = itemUnit2Price(item);
  const unit1Name = itemUnit1Name(item);
  const unit2Name = itemUnit2Name(item);
  const unit2Factor = itemUnit2Factor(item);
  const rowState = item.hasApprovedPrice ? "active" : item.status;
  return `
    <div class="pricing-card inventory-row-${escapeHtml(rowState)}">
      <div class="pricing-card-head">
        <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(qty)}</span>
      </div>
      <small>${escapeHtml(unit2Name)} / ${escapeHtml(unit2Factor)} ${escapeHtml(unit1Name)}</small>
      <b>${escapeHtml(unit2Price > 0 ? formatMoney(unit2Price) : "غير مسعر")}</b>
      <span>${escapeHtml(item.hasApprovedPrice ? "معتمد" : statusLabel(item.status))}</span>
      <form class="pricing-editor" data-form="pricing-item" data-item-key="${escapeHtml(item.key)}" data-item-name="${escapeHtml(item.name || "")}" data-stock-qty="${escapeHtml(qty)}" data-stock-status="${escapeHtml(item.status || "")}" data-unit1-name="${escapeHtml(unit1Name)}" data-unit2-name="${escapeHtml(unit2Name)}" data-unit2-factor="${escapeHtml(unit2Factor)}">
        <label>
          <span>سعر ${escapeHtml(unit2Name)}</span>
          <input name="salePrice" type="text" inputmode="decimal" dir="ltr" value="${escapeHtml(unit2Price > 0 ? unit2Price : "")}" placeholder="0">
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
  const approvedCount = allAvailable.filter((item) => {
    const price = approvedPriceMap().get(item.key || normalizeItemName(item.name));
    return price && (Number(price.salePrice || 0) > 0 || Number(price.unit2Price || 0) > 0);
  }).length;
  const waiting = Math.max(0, allAvailable.length - approvedCount);
  const syncedAt = reportSyncedAt(latest);
  const emptyText =
    dataStore.isConfigured() && !state.session
      ? "سجل الدخول أولاً حتى تظهر مواد التسعير ويتم الحفظ في Supabase."
      : "لا توجد مواد متوفرة أو مطابقة للبحث الحالي.";
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
        ${inventoryMetric("أسعار معتمدة", approvedCount, "تبقى فعالة يومياً")}
        ${inventoryMetric("بحاجة تسعير", waiting, "لا يوجد لها سعر معتمد")}
        ${inventoryMetric("أسعار المحاسبة", state.approvedPriceItems.length, "جاهزة للسحب الآلي")}
        ${inventoryMetric("تسجيل الدخول", state.session ? "نعم" : "لا", state.session?.email || "لن يتم الحفظ قبل الدخول")}
      </div>
      <div class="inventory-controls">
        <label>
          بحث باسم المادة
          <input data-pricing-search value="${escapeHtml(state.pricingSearch)}" placeholder="اكتب اسم المادة">
        </label>
      </div>
      <div class="button-row report-actions">
        <button class="button secondary" type="button" data-action="refresh-ameen">تحديث الجرد</button>
        <button class="button secondary" type="button" data-action="download-daily-pricing" ${items.length ? "" : "disabled"}>تنزيل قائمة تسعير اليوم</button>
        <button class="button secondary" type="button" data-action="download-price-template" ${allAvailable.length ? "" : "disabled"}>تنزيل قالب Excel</button>
        <button class="button primary" type="button" data-action="download-customer-price-pdf" ${customerPriceListItems().length ? "" : "disabled"}>نشرة PDF للزبائن</button>
        <button class="button secondary" type="button" data-action="download-approved-prices" ${state.approvedPriceItems.length ? "" : "disabled"}>تصدير أسعار المحاسبة</button>
      </div>
      <form class="form-card compact" data-form="live-price-import">
        <label>
          رفع ملف تسعير كامل
          <input name="livePrice" type="file" accept=".xlsx,.xls,.csv">
        </label>
        <button class="button primary" type="submit" ${allAvailable.length ? "" : "disabled"}>اعتماد ملف الأسعار</button>
      </form>
      <div class="inventory-list inventory-list-dense pricing-list" data-pricing-results>
        ${items.length ? items.map(pricingRow).join("") : `<p class="muted">${escapeHtml(emptyText)}</p>`}
      </div>
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
          <input name="creditLimit" type="text" inputmode="decimal" dir="ltr" value="${escapeHtml(item.internalCreditLimit > 0 ? item.internalCreditLimit : "")}" placeholder="${escapeHtml(limit > 0 ? formatMoney(limit) : "0")}">
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
            <input name="lowThreshold" type="text" inputmode="numeric" dir="ltr" value="${escapeHtml(summary.threshold || 50)}">
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
  app.querySelector("[data-action='download-price-template']")?.addEventListener("click", downloadLivePriceTemplate);
  app.querySelector("[data-action='download-daily-pricing']")?.addEventListener("click", downloadDailyPricingWorklist);
  app.querySelector("[data-action='download-customer-price-pdf']")?.addEventListener("click", downloadCustomerPricePdf);
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
  if ((state.route === "ameen" || state.route === "pricing") && (!dataStore.isConfigured() || state.session)) {
    Promise.all([loadInventoryReports(), loadCustomerBalanceReports(), loadCustomerCreditLimits(), loadApprovedPriceItems()])
      .then(() => render())
      .catch(() => {});
  }
}, 60000);
