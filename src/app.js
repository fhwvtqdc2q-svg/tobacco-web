const appConfig = window.appConfig;
const roadmapItems = window.roadmapItems;
const monitoringCards = window.monitoringCards;
const remoteServices = window.remoteServices;
const dataStore = window.tobaccoData;

function safeErrorMessage(error) {
  const msg = String(error?.message ?? "");
  console.error("[OZK Error]", msg);
  if (/لا توجد جلسة|سجل الدخول|كلمة المرور|البريد|تأكيد|مصادقة/.test(msg)) return msg;
  if (/لا يمكن حفظ|لا توجد أسعار|لا توجد طلبات|لا يوجد جرد/.test(msg)) return msg;
  if (/fetch|ECONNREFUSED|ENOTFOUND|network|Failed to fetch/i.test(msg))
    return "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.";
  if (/401|403|unauthorized|permission|denied/i.test(msg))
    return "ليس لديك صلاحية لتنفيذ هذه العملية.";
  if (/pgrst|postgres|supabase|relation|column|database|sql/i.test(msg))
    return "حدث خطأ في قاعدة البيانات. حاول مجدداً أو تواصل مع الدعم.";
  if (msg.length > 120 || /Error:|\.js:\d+|at \w+\s/i.test(msg))
    return "حدث خطأ غير متوقع. حاول مجدداً.";
  return msg || "حدث خطأ غير متوقع.";
}

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
  customerMovementsReport: null,
  customerCreditLimits: [],
  customerLimitError: null,
  approvedPriceItems: [],
  approvedPriceError: null,
  itemCosts: [],
  lastInventoryRefresh: null,
  priceExport: null,
  ameenSearch: "",
  ameenFilter: "alerts",
  ameenSort: "qtyAsc",
  pricingSearch: "",
  bulletinStatus: null,
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
  globalSearch: "",
  syriaCurrency: "USD",
  syriaExchangeRate: readJson("syria-exchange-rate", 1),
  syriaRateConfirmed: false,
  openSections: {},
  priceMode: readJson("price-mode", "jumla"),
  showExchangeModal: false,
  pricePreview: null
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

function applyTheme() {
  document.documentElement.dataset.theme = state.darkMode ? "dark" : "light";
  writeJson("dark-mode", state.darkMode);
}

let shortcutsInitialized = false;
function initKeyboardShortcuts() {
  if (shortcutsInitialized) return;
  shortcutsInitialized = true;
  document.addEventListener("keydown", (event) => {
    const typing = document.activeElement?.matches("input, textarea, select, [contenteditable]");
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const routeMap = { "1": "overview", "2": "dashboard", "3": "requests", "4": "ameen", "5": "pricing", "6": "invoice" };
      const target = routeMap[event.key];
      if (target) {
        event.preventDefault();
        if ((target === "dashboard" || target === "invoice") && !state.session) return;
        setRoute(target);
        render();
        return;
      }
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        state.darkMode = !state.darkMode;
        applyTheme();
        render();
        return;
      }
    }
    if (!typing) {
      if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        app.querySelector(".search-input")?.focus();
      }
      if (event.key === "Escape") {
        if (state.aiSettingsOpen) { state.aiSettingsOpen = false; render(); }
        else if (state.selectedCustomerKey) { state.selectedCustomerKey = ""; render(); }
      }
    }
  });
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
  applyTheme();
  initKeyboardShortcuts();
  await refreshSession();
  await loadRequests();
  await loadInventoryReports();
  await loadCustomerBalanceReports();
  await loadCustomerCreditLimits();
  await loadApprovedPriceItems();
  await loadCustomerProfiles();
  state.seenRequestIds = new Set(state.requests.map((r) => r.id));
  state.notifPermission = notifSupported() ? Notification.permission : "denied";
  state.loading = false;
  render();
  const overdue = overdueCustomers();
  if (overdue.length > 0) fireOverdueNotif(overdue.length);
}

async function refreshSession() {
  try {
    state.session = await dataStore.getSession();
  } catch (error) {
    state.session = null;
    setNotice("error", safeErrorMessage(error));
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
    setNotice("error", safeErrorMessage(error));
  }
}

async function loadInventoryReports() {
  try {
    if (dataStore.isConfigured() && !state.session) {
      state.inventoryReports = [];
      state.lastInventoryRefresh = null;
      state.itemCosts = [];
      return;
    }
    state.inventoryReports = await dataStore.listInventoryReports();
    state.lastInventoryRefresh = new Date().toISOString();
    await loadItemCosts();
  } catch {
    state.inventoryReports = [];
  }
}

// التكلفة للمدير فقط — تُجلب من جدول item_costs المحمي (RLS = is_owner)
const OWNER_EMAILS = ["ozk.kh@outlook.com", "ozkkhalouf@gmail.com"];
function isOwner() {
  const email = String(state.session?.email || "").trim().toLowerCase();
  return OWNER_EMAILS.includes(email);
}

async function loadItemCosts() {
  try {
    if (!isOwner() || !dataStore.listItemCosts) {
      state.itemCosts = [];
      return;
    }
    state.itemCosts = await dataStore.listItemCosts();
  } catch {
    state.itemCosts = [];
  }
}

let _costIndexRef = null;
let _costIndex = new Map();
function itemCostIndex() {
  if (_costIndexRef === state.itemCosts) return _costIndex;
  const map = new Map();
  (state.itemCosts || []).forEach((row) => {
    if (!row) return;
    if (row.item_guid) map.set("g:" + String(row.item_guid).toUpperCase(), row);
    if (row.item_name) map.set("n:" + normalizeItemName(row.item_name), row);
  });
  _costIndexRef = state.itemCosts;
  _costIndex = map;
  return map;
}
function itemCostFor(item) {
  if (!isOwner() || !item) return null;
  const idx = itemCostIndex();
  if (item.itemGuid) {
    const byGuid = idx.get("g:" + String(item.itemGuid).toUpperCase());
    if (byGuid) return byGuid;
  }
  const byName = idx.get("n:" + normalizeItemName(item.name || item.key || ""));
  return byName || null;
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
  try {
    state.customerMovementsReport = dataStore.getCustomerMovementsReport
      ? await dataStore.getCustomerMovementsReport()
      : null;
  } catch {
    state.customerMovementsReport = null;
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
    state.customerLimitError = safeErrorMessage(error);
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
    state.approvedPriceError = safeErrorMessage(error);
  }
}

async function loadPaymentRecords(customerKey) {
  if (!customerKey || !state.session) return;
  try {
    state.paymentLoading = true;
    const records = await dataStore.listPaymentRecords(customerKey);
    state.paymentRecords = { ...state.paymentRecords, [customerKey]: records };
    state.paymentLoading = false;
    state.paymentError = null;
    render();
  } catch (error) {
    state.paymentLoading = false;
    state.paymentError = error.message;
    render();
  }
}

async function loadCustomerProfiles() {
  try {
    state.customerProfiles = await dataStore.listCustomerProfiles();
  } catch {}
}

function customerProfile(key) {
  return state.customerProfiles.find((p) => p.customerKey === key) || null;
}

function printOverdueReport() {
  const overdue = overdueCustomers();
  if (!overdue.length) {
    setNotice("error", "لا يوجد زبائن متأخرون حالياً.");
    render();
    return;
  }
  const now = new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" });
  const rows = overdue.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fdf8ee"}">
      <td style="padding:8px 10px;border:1px solid #d8c890;text-align:center">${i + 1}</td>
      <td style="padding:8px 10px;border:1px solid #d8c890">${escapeHtml(item.customer_name || item.name || "—")}</td>
      <td style="padding:8px 10px;border:1px solid #d8c890;direction:ltr;text-align:left;font-family:monospace">${formatMoney(customerBalance(item))}</td>
      <td style="padding:8px 10px;border:1px solid #d8c890;text-align:center;color:${item.daysSince === null ? "#888" : item.daysSince >= 7 ? "#b00" : "#9a6000"};font-weight:bold">${item.daysSince === null ? "—" : item.daysSince + " يوم"}</td>
    </tr>`).join("");
  const html = `
    <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;color:#221808;padding:20px">
      <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid #d7a83f;padding-bottom:16px">
        <h2 style="margin:0 0 4px;font-size:1.4rem">OZK TOBACCO</h2>
        <h3 style="margin:0;font-size:1.1rem;color:#6b4e10">تقرير الزبائن المتأخرين عن الدفع</h3>
        <p style="margin:8px 0 0;font-size:0.85rem;color:#888">التاريخ: ${now}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
        <thead>
          <tr style="background:#d7a83f;color:#1a1000">
            <th style="padding:9px 10px;border:1px solid #b8892a;width:40px">#</th>
            <th style="padding:9px 10px;border:1px solid #b8892a;text-align:right">اسم الزبون</th>
            <th style="padding:9px 10px;border:1px solid #b8892a;text-align:right">الرصيد</th>
            <th style="padding:9px 10px;border:1px solid #b8892a;text-align:center">أيام بلا دفعة</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;font-size:0.82rem;color:#888">المجموع: ${overdue.length} زبون / أكثر من 7 أيام: ${overdue.filter((x) => x.daysSince !== null && x.daysSince >= 7).length}</p>
    </div>`;
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  window.html2pdf().set({
    margin: [10, 15, 10, 15],
    filename: `ozk-overdue-${new Date().toISOString().slice(0, 10)}.pdf`,
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
  }).from(container).save().finally(() => container.remove());
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
    setNotice("error", safeErrorMessage(error));
    render();
  }
}

async function logout() {
  try {
    await dataStore.signOut();
    state.session = null;
    state.inventoryReports = [];
    state.customerBalanceReports = [];
    state.customerMovementsReport = null;
    state.customerCreditLimits = [];
    state.customerLimitError = null;
    state.approvedPriceItems = [];
    state.approvedPriceError = null;
    setNotice("success", "تم تسجيل الخروج.");
  } catch (error) {
    setNotice("error", safeErrorMessage(error));
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
    setNotice("error", safeErrorMessage(error));
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
    setNotice("error", safeErrorMessage(error));
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
    setNotice("error", safeErrorMessage(error));
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
    setNotice("error", safeErrorMessage(error));
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
    state.customerLimitError = safeErrorMessage(error);
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
    setNotice("error", safeErrorMessage(error));
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
  const items = liveAvailableItems()
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
  return mergeBulletinNamedGroups(mergeOstoraPriceItems(mergeMazayaPriceItems(items)));
}

function isMazayaPriceItem(item) {
  const groupName = normalizeItemName(item.groupName || "");
  const itemName = normalizeItemName(item.name || item.itemName || "");
  return groupName.includes("مزايا") || itemName.includes("مزايا");
}

// دمج أصناف متشابهة في النشرة بسطر واحد (طلب الإدارة) — أضف الاسم القانوني هنا لدمج أي صنف يبدأ به
const BULLETIN_MERGE_NAMES = ["ماستر طويل ورق", "ماستر قصير أزرق", "اليغانس طويل فضي"];

function mergeBulletinNamedGroups(items) {
  let result = [...items];
  BULLETIN_MERGE_NAMES.forEach((display) => {
    const baseN = normalizeItemName(display);
    const matches = result.filter((it) => {
      const n = normalizeItemName(it.name || it.itemName || "");
      return n === baseN || n.startsWith(baseN + " ");
    });
    if (matches.length < 2) return;
    const rep = matches.find((it) => normalizeItemName(it.name || it.itemName || "") === baseN) || matches[0];
    const merged = { ...rep, name: display, itemName: display };
    result = result.filter((it) => !matches.includes(it));
    result.push(merged);
  });
  return result.sort(
    (a, b) =>
      String(a.groupName || "").localeCompare(String(b.groupName || ""), "ar") ||
      String(a.name || "").localeCompare(String(b.name || ""), "ar")
  );
}

// أسعار سطري المزايا في النشرة (طلب الإدارة) — عدّلهما هنا عند تغيّر السعر
const MAZAYA_MIX_PRICE = 145;       // مزايا مشكل (شرحة)
const MAZAYA_BAHRAINI_PRICE = 150;  // مزايا بحريني (شرحة)

function mergeMazayaPriceItems(items) {
  const mazayaItems = items.filter(isMazayaPriceItem);
  if (!mazayaItems.length) return items;

  const base = mazayaItems[0];
  const makeMazayaLine = (name, key, price) => ({
    ...base,
    key,
    name,
    itemName: name,
    groupName: "مزايا",
    unit1Name: "",
    unit1Price: 0,
    unit2Name: "شرحة",
    unit2Factor: 1,
    unit2Price: price,
    salePrice: price
  });

  const mazayaLines = [
    makeMazayaLine("مزايا مشكل", "mazaya-mix", MAZAYA_MIX_PRICE),
    makeMazayaLine("مزايا بحريني", "mazaya-bahraini", MAZAYA_BAHRAINI_PRICE)
  ];

  return [...items.filter((item) => !isMazayaPriceItem(item)), ...mazayaLines].sort(
    (a, b) =>
      String(a.groupName || "").localeCompare(String(b.groupName || ""), "ar") ||
      String(a.name || "").localeCompare(String(b.name || ""), "ar")
  );
}

// صنف الأسطورة: سطر واحد بدل كل البنود (طلب الإدارة) — السعر يتبع البيانات تلقائيًا
function isOstoraPriceItem(item) {
  const groupName = normalizeItemName(item.groupName || "");
  const itemName = normalizeItemName(item.name || item.itemName || "");
  return groupName.includes("اسطوره") || itemName.includes("اسطوره");
}

function mergeOstoraPriceItems(items) {
  const ostora = items.filter(isOstoraPriceItem);
  if (!ostora.length) return items;

  const first = ostora.find((it) => it.unit2Price > 0) || ostora[0];
  const ostoraItem = {
    ...first,
    key: "ostora-all",
    name: "معسل الأسطورة",
    itemName: "معسل الأسطورة",
    groupName: "معسل الاسطورة",
    unit1Name: "",
    unit1Price: 0,
    unit2Name: first.unit2Name || "شرحة",
    unit2Factor: first.unit2Factor || 1,
    unit2Price: first.unit2Price > 0 ? first.unit2Price : 0,
    salePrice: first.unit2Price > 0 ? first.unit2Price : first.salePrice
  };

  return [...items.filter((item) => !isOstoraPriceItem(item)), ostoraItem].sort(
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

function pricePdfItemUnits(item) {
  const nameLength = String(item.name || "").length;
  // الارتفاع الحقيقي ثابت تقريبًا لكل صنف؛ الإضافة فقط عند التفاف الاسم الطويل لسطرين
  return 1 + (nameLength > 42 ? 0.45 : 0);
}

function pricePdfRow(row) {
  if (row.type === "group") {
    return `<h2 class="price-pdf-group-title">${escapeHtml(row.name)}</h2>`;
  }
  return pricePdfItem(row.item);
}

function pricePdfPages(groups) {
  const maxUnits = 39;
  const groupUnits = 1.4;
  const pages = [{ columns: [[], [], []] }];
  let pageIndex = 0;
  let columnIndex = 0;
  let usedUnits = 0;

  function currentColumn() {
    return pages[pageIndex].columns[columnIndex];
  }

  function nextColumn() {
    columnIndex += 1;
    usedUnits = 0;
    if (columnIndex >= 3) {
      pages.push({ columns: [[], [], []] });
      pageIndex += 1;
      columnIndex = 0;
    }
  }

  function addRow(row, units) {
    if (usedUnits > 0 && usedUnits + units > maxUnits) nextColumn();
    currentColumn().push(row);
    usedUnits += units;
  }

  groups.forEach((group) => {
    let hasGroupTitle = false;
    group.items.forEach((item) => {
      const itemUnits = pricePdfItemUnits(item);
      if (!hasGroupTitle) {
        if (usedUnits > 0 && usedUnits + groupUnits + itemUnits > maxUnits) nextColumn();
        addRow({ type: "group", name: group.name }, groupUnits);
        hasGroupTitle = true;
      } else if (usedUnits > 0 && usedUnits + itemUnits > maxUnits) {
        nextColumn();
        addRow({ type: "group", name: group.name }, groupUnits);
      }
      addRow({ type: "item", item }, itemUnits);
    });
  });

  return pages.filter((page) => page.columns.some((column) => column.length));
}

function pricePdfPage(page, index, totalPages, pdfTitle = "قائمة أسعار OZK TOBACCO") {
  const logoSrc = `${window.location.origin}/public/icons/ozk-logo.png`;
  return `
    <section class="price-pdf-page">
      <header class="price-pdf-header">
        <img class="price-pdf-logo" src="${logoSrc}" alt="OZK TOBACCO" />
        <div class="price-pdf-title-block">
          <h1>${escapeHtml(pdfTitle)}</h1>
          <p>نشرة أسعار الأصناف المتوفرة للزبائن</p>
          <p class="price-pdf-cash">البيع حصراً نقدي</p>
        </div>
        <div class="price-pdf-date">
          <span>تاريخ النشرة</span>
          <b>${escapeHtml(todayIsoDate())}</b>
        </div>
      </header>
      <div class="price-pdf-meta">
        ${customerPriceContactMarkup()}
      </div>
      <main class="price-pdf-groups">
        ${page.columns
          .map(
            (column) => `
              <div class="price-pdf-column">
                ${column.map(pricePdfRow).join("")}
              </div>
            `
          )
          .join("")}
      </main>
      <footer class="price-pdf-footer">
        <b>صفحة ${escapeHtml(index + 1)} من ${escapeHtml(totalPages)}</b>
      </footer>
    </section>
  `;
}

function pricePdfBook(groups, pdfTitle = "قائمة أسعار OZK TOBACCO") {
  const pages = pricePdfPages(groups);
  return pages
    .map((page, index) => pricePdfPage(page, index, pages.length, pdfTitle))
    .join("");
}

// أهم مجموعتين تظهران أول النشرة دائمًا (طلب الإدارة)
const PRIORITY_PRICE_GROUPS = ["غلواز", "ماستر"];

function orderPriorityGroups(groups) {
  const rank = (name) => {
    const n = normalizeItemName(name || "");
    const i = PRIORITY_PRICE_GROUPS.findIndex((g) => n.includes(normalizeItemName(g)));
    return i === -1 ? PRIORITY_PRICE_GROUPS.length : i;
  };
  return [...groups].sort(
    (a, b) => rank(a.name) - rank(b.name) || String(a.name || "").localeCompare(String(b.name || ""), "ar")
  );
}

function bulletinDisplayGroups(items, useSyria = false) {
  return orderPriorityGroups(groupCustomerPriceItems(items));
}

function customerPricePdfMarkup(items, latest, useSyria = false) {
  const groups = bulletinDisplayGroups(items, useSyria);
  const pdfTitle = useSyria ? `نشرة المفرّق (بالليرة السورية) — صرف ${state.syriaExchangeRate}` : "نشرة الجملة (بالدولار)";
  return `
    <div class="price-pdf-book" dir="rtl" style="background:#fff;color:#000">
      ${pricePdfBook(groups, pdfTitle)}
    </div>
  `;
}

async function publishBulletin() {
  const REPO = "fhwvtqdc2q-svg/tobacco-web";
  const WORKFLOW = "generate-price-lists.yml";

  let token = localStorage.getItem("gh_publish_token");
  if (!token) {
    token = prompt("أدخل GitHub Token لنشر النشرة (يُحفظ مرة واحدة على هذا الجهاز):");
    if (!token) return;
    localStorage.setItem("gh_publish_token", token.trim());
  }

  state.bulletinStatus = { type: "muted", msg: "⏳ جارٍ إرسال طلب التوليد..." };
  render();

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (resp.status === 204) {
      state.bulletinStatus = {
        type: "success",
        msg: "✅ تم الطلب — النشرة ستكون جاهزة للزبائن خلال دقيقتين على الرابط الثابت.",
      };
    } else if (resp.status === 401 || resp.status === 403) {
      localStorage.removeItem("gh_publish_token");
      state.bulletinStatus = { type: "error", msg: "❌ Token غير صحيح أو منتهي — أعد المحاولة وأدخل token جديد." };
    } else {
      state.bulletinStatus = { type: "error", msg: `❌ خطأ ${resp.status} — تحقق من صلاحيات Token.` };
    }
  } catch {
    state.bulletinStatus = { type: "error", msg: "❌ تعذر الاتصال بـ GitHub. تحقق من الإنترنت." };
  }
  render();
}

// يجهّز عناصر النشرة (مع التحقق وتحويل العملة) — يرجع null إذا تعذّر المتابعة
function prepareBulletinItems(useSyria = false) {
  const latest = state.inventoryReports[0];
  let items = customerPriceListItems();

  if (useSyria) {
    // نشرة المفرّق: سعر المفرق يُدخل بسعر الكرتونة بالدولار → يقسم على عدد الكروز ثم × سعر الصرف
    const rate = Number(state.syriaExchangeRate) || 1;
    items = items
      .map((item) => {
        const retail = itemRetailPrice(item);
        const factor = itemUnit2Factor(item);
        return { ...item, unit2Price: Math.round((retail / factor) * rate), unit2Name: item.unit1Name || "كروز", unit2Factor: 1, unit1Price: 0, unit1Name: "" };
      })
      .filter((item) => item.unit2Price > 0);
  } else {
    // نشرة الجملة: سعر الكرتونة (الوحدة الثانية) بالدولار
    items = items
      .map((item) => {
        const whole = item.unit2Price > 0 ? item.unit2Price : item.unit1Price;
        const wholeName = item.unit2Price > 0 ? (item.unit2Name || "كرتونة") : (item.unit1Name || "وحدة");
        return { ...item, unit2Price: whole, unit2Name: wholeName, unit2Factor: 1, unit1Price: 0, unit1Name: "" };
      })
      .filter((item) => item.unit2Price > 0);
  }

  if (!latest || !items.length) {
    setNotice("error", "لا توجد مواد متوفرة ومُسعّرة لإنشاء نشرة PDF.");
    render();
    return null;
  }
  if (!window.html2pdf) {
    setNotice("error", "مكتبة PDF لم تتحمل. حدث الصفحة وجرب مرة أخرى.");
    render();
    return null;
  }
  return { items, latest };
}

// يفتح معاينة النشرة قبل التصدير
function openPricePreview(useSyria = false) {
  if (useSyria && !state.syriaRateConfirmed) {
    state.showExchangeModal = true;
    render();
    return;
  }
  const prepared = prepareBulletinItems(useSyria);
  state.syriaRateConfirmed = false;
  if (!prepared) return;
  state.pricePreview = { open: true, useSyria, items: prepared.items, latest: prepared.latest };
  render();
}

function closePricePreview() {
  state.pricePreview = null;
  render();
}

// يولّد ويحفظ ملف PDF من عناصر جاهزة
async function exportBulletinPdf(items, latest, useSyria = false) {
  if (!items || !items.length || !window.html2pdf) return;
  const container = document.createElement("div");
  container.style.width = "760px";
  container.style.backgroundColor = "#fff";
  container.innerHTML = customerPricePdfMarkup(items, latest, useSyria);
  document.body.appendChild(container);

  try {
    await window
      .html2pdf()
      .set({
        filename: `ozk-${useSyria ? "mufrak-syp" : "jumla-usd"}-${todayIsoDate()}.pdf`,
        margin: [4, 4, 4, 4],
        image: { type: "png", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", allowTaint: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css"] }
      })
      .from(container)
      .save();
    setNotice("success", `تم تجهيز ${useSyria ? "نشرة المفرّق (ليرة)" : "نشرة الجملة (دولار)"}: ${items.length} صنف.`);
  } catch (error) {
    setNotice("error", error.message || "تعذر إنشاء ملف PDF.");
  } finally {
    container.remove();
  }
}

// تصدير من شاشة المعاينة
async function exportPricePreview() {
  const preview = state.pricePreview;
  if (!preview) return;
  await exportBulletinPdf(preview.items, preview.latest, preview.useSyria);
  state.pricePreview = null;
  render();
}

// تصدير مباشر بدون معاينة (للتوافق)
async function downloadCustomerPricePdf(useSyria = false) {
  const prepared = prepareBulletinItems(useSyria);
  if (!prepared) return;
  await exportBulletinPdf(prepared.items, prepared.latest, useSyria);
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
    const entered = toPositivePrice(formValue(form, "salePrice"));
    const stockQty = toNumber(form.dataset.stockQty);
    const stockStatus = form.dataset.stockStatus || "active";
    const mode = state.priceMode === "mufrak" ? "mufrak" : "jumla";

    if (entered <= 0) throw new Error("اكتب سعرًا أكبر من صفر.");
    if (!latest) throw new Error("لا يوجد جرد حي للمطابقة.");
    if (!itemKey || !itemName) throw new Error("لا يمكن حفظ السعر بدون مادة واضحة.");
    if (!dataStore.upsertApprovedPriceItems) throw new Error("حفظ الأسعار غير مفعل في قاعدة البيانات.");

    const existing = approvedPriceMap().get(itemKey);
    const basePayload = (existing && existing.pricePayload) || {};
    let unit2Price, salePrice, payloadObj, savedLabel;

    if (mode === "mufrak") {
      unit2Price = Number((existing && existing.unit2Price) || 0);
      if (unit2Price <= 0) throw new Error("سعّر الجملة أولاً، ثم بدّل لوضع المفرق وأضف سعره.");
      salePrice = Number((existing && existing.salePrice) || roundPrice(unit2Price / unit2Factor));
      payloadObj = { ...basePayload, retail: { price: entered }, source: "phone_pricing_page", pricedDate: todayIsoDate() };
      savedLabel = `سعر المفرق ${formatMoney(entered)}$ لل${unit2Name || "كرتونة"} (≈ ${formatMoney(roundPrice(entered / unit2Factor))}$ لل${unit1Name || "كروز"})`;
    } else {
      unit2Price = entered;
      salePrice = roundPrice(entered / unit2Factor);
      payloadObj = { ...basePayload, source: "phone_pricing_page", pricedUnit: "unit2", pricedDate: todayIsoDate() };
      savedLabel = `سعر الجملة ${formatMoney(entered)}$`;
    }

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
        pricePayload: payloadObj
      }
    ]);

    if (!saved || !Array.isArray(saved)) {
      throw new Error("لم يتم استقبال تأكيد الحفظ من قاعدة البيانات. تأكد من الاتصال والصلاحيات.");
    }

    const priceMap = approvedPriceMap();
    saved.forEach((item) => priceMap.set(item.itemKey, item));
    state.approvedPriceItems = [...priceMap.values()].sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || ""), "ar"));
    setNotice("success", `✓ تم حفظ ${savedLabel}: ${itemName}`);
    render();
    return true;
  } catch (error) {
    setNotice("error", safeErrorMessage(error));
    render();
    return false;
  }
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
          ${navButton("overview", "🏠 الرئيسية")}
          ${state.session ? navButton("dashboard", "📊 الإحصائيات") : ""}
          ${navButton("login", "🔑 تسجيل الدخول")}
          ${navButton("requests", "📋 طلبات العملاء")}
          ${navButton("ameen", "📦 الأمين")}
          ${navButton("pricing", "💰 التسعير")}
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
            <h1>${pageTitle()}</h1>
          </div>
          <div class="topbar-actions">
            ${state.session ? `
              <form class="search-wrap" data-form="global-search">
                <input class="search-input" name="q" placeholder="🔍 بحث…" value="${escapeHtml(state.globalSearch)}" autocomplete="off" dir="auto">
              </form>
            ` : ""}
            <button class="button secondary theme-toggle" data-action="toggle-theme" title="${state.darkMode ? "وضع النهار" : "وضع الليل"}">${state.darkMode ? "☀️" : "🌙"}</button>
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
  return "";
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
        <img class="hero-logo" src="public/icons/ozk-logo.png" alt="OZK TOBACCO" />
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

  `);
}

function login() {
  const live = dataStore.isConfigured();
  return shell(`
    <section class="panel wide form-layout">
      <div>
        <h2>دخول الموظفين والإدارة</h2>
        <p class="muted">${live ? "أدخل بريدك الإلكتروني وكلمة المرور للدخول، أو أنشئ حساباً جديداً." : "هذا دخول تجريبي محلي."}</p>
      </div>
      ${state.session ? `
        <div class="notice-panel success">
          <strong>أنت داخل الآن</strong>
          <span>${escapeHtml(state.session.name)} — ${escapeHtml(state.session.role)}</span>
        </div>
      ` : ""}
      <form class="form-card" data-form="login">
        ${live ? "" : `
          <label>
            الاسم
            <input name="name" placeholder="مثال: أحمد" autocomplete="name">
          </label>
        `}
        <label>
          البريد الإلكتروني
          <input name="email" type="email" placeholder="example@gmail.com" autocomplete="email" ${live ? "required" : ""}>
        </label>
        <label>
          كلمة المرور
          <input name="password" type="password" placeholder="8 أحرف على الأقل" minlength="8" autocomplete="current-password" ${live ? "required" : ""}>
        </label>
        <div class="button-row">
          <button class="button primary" type="submit" data-auth-action="signin">دخول</button>
          ${live ? '<button class="button secondary" type="submit" data-auth-action="signup">إنشاء حساب جديد</button>' : ""}
        </div>
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

function overdueCustomers(thresholdDays = 3) {
  const items = latestCustomerBalanceItems();
  const now = new Date();
  return items
    .filter((item) => customerBalance(item) > 0)
    .map((item) => {
      const dateStr = item.lastPaymentDate || "";
      let daysSince = null;
      if (dateStr) {
        try {
          const d = new Date(dateStr);
          if (!isNaN(d)) daysSince = Math.floor((now - d) / 86400000);
        } catch {}
      }
      return { ...item, daysSince };
    })
    .filter((item) => item.daysSince === null || item.daysSince >= thresholdDays)
    .sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
}

function fireOverdueNotif(count) {
  if (!notifSupported() || Notification.permission !== "granted") return;
  const opts = {
    body: `${count} زبون بدون دفعة منذ أكثر من 3 أيام`,
    icon: "public/icons/app-icon.png",
    dir: "rtl",
    lang: "ar",
    tag: "overdue-customers"
  };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification("OZK — تنبيه ديون", opts)).catch(() => new Notification("OZK — تنبيه ديون", opts));
  } else {
    new Notification("OZK — تنبيه ديون", opts);
  }
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
        ${filtered.length ? groupedAccordion("ameen", filtered, { groupOf: (i) => i.groupName, rowOf: inventoryRow, query: state.ameenSearch }) : '<p class="muted">لا توجد مواد تطابق البحث والفلتر الحالي.</p>'}
      </div>
      
    </section>
  `;
}

function itemRetailPrice(item) {
  const r = item && item.approvedPrice && item.approvedPrice.pricePayload && item.approvedPrice.pricePayload.retail;
  return Number((r && r.price) || 0);
}

function pricingRow(item) {
  const qty = itemQty(item);
  const unit1Name = itemUnit1Name(item);
  const unit2Name = itemUnit2Name(item);
  const unit2Factor = itemUnit2Factor(item);
  const mode = state.priceMode === "mufrak" ? "mufrak" : "jumla";
  const wholesale = itemUnit2Price(item);
  const retail = itemRetailPrice(item);
  const shown = mode === "mufrak" ? retail : wholesale;
  const unitLabel = unit2Name || "كرتونة";
  const modeLabel = mode === "mufrak" ? "سعر المفرق" : "سعر الجملة";
  const priced = shown > 0;
  const retailPerUnit1 = retail > 0 ? roundPrice(retail / unit2Factor) : 0;
  const retailHint = mode === "mufrak" && retailPerUnit1 > 0 ? `<small class="muted">≈ ${escapeHtml(formatMoney(retailPerUnit1))} $ لكل ${escapeHtml(unit1Name || "كروز")}</small>` : "";
  const rowState = (wholesale > 0 || retail > 0) ? "active" : item.status;
  const costRow = itemCostFor(item);
  // التكلفة في الأمين لكل كروز — نضربها بعدد الكروزات بالكرتونة لتطابق تسعير الكرتونة
  const cartonFactor = unit2Factor > 0 ? unit2Factor : 1;
  const costPerCarton = costRow && Number(costRow.avg_cost) > 0 ? Number(costRow.avg_cost) * cartonFactor : 0;
  const costLine = costPerCarton > 0
    ? `<div class="cost-line" title="متوسط تكلفة ${escapeHtml(unitLabel)} (التكلفة لكل ${escapeHtml(unit1Name || "كروز")} × ${escapeHtml(unit2Factor)}) — يظهر لك أنت فقط (المدير)">🔒 تكلفة ${escapeHtml(unitLabel)}: <b>${escapeHtml(formatMoney(costPerCarton))}</b> $</div>`
    : "";
  return `
    <div class="pricing-card inventory-row-${escapeHtml(rowState)}">
      <div class="pricing-card-head">
        <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(qty)}</span>
      </div>
      <small>${escapeHtml(unit2Name)} / ${escapeHtml(unit2Factor)} ${escapeHtml(unit1Name)}</small>
      <b>${priced ? escapeHtml(formatMoney(shown)) + " $" : "غير مسعر"}</b>
      ${costLine}
      ${retailHint}
      <span>${escapeHtml(priced ? (mode === "mufrak" ? "مفرق ✓" : "جملة ✓") : statusLabel(item.status))}</span>
      <form class="pricing-editor" data-form="pricing-item" data-item-key="${escapeHtml(item.key)}" data-item-name="${escapeHtml(item.name || "")}" data-stock-qty="${escapeHtml(qty)}" data-stock-status="${escapeHtml(item.status || "")}" data-unit1-name="${escapeHtml(unit1Name)}" data-unit2-name="${escapeHtml(unit2Name)}" data-unit2-factor="${escapeHtml(unit2Factor)}">
        <label>
          <span>${escapeHtml(modeLabel)} (${escapeHtml(unitLabel)} $)</span>
          <input name="salePrice" type="text" inputmode="decimal" dir="ltr" value="${escapeHtml(priced ? shown : "")}" placeholder="0">
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
      <div class="currency-toggle" role="group">
        <button type="button" class="ctgl ${state.priceMode === "mufrak" ? "" : "active"}" data-mode="jumla">🧾 تسعير جملة</button>
        <button type="button" class="ctgl ${state.priceMode === "mufrak" ? "active" : ""}" data-mode="mufrak">🛒 تسعير مفرق</button>
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
        <button class="button primary" type="button" data-action="report-inventory">📦 تقرير المخزون PDF</button>
        <button class="button secondary" type="button" data-action="download-price-template" ${allAvailable.length ? "" : "disabled"}>تنزيل قالب Excel</button>
        <button class="button primary" type="button" data-action="download-customer-price-pdf" ${customerPriceListItems().length ? "" : "disabled"}>🧾 نشرة جملة (دولار)</button>
        <button class="button primary" type="button" data-action="download-customer-price-syria" ${customerPriceListItems().length ? "" : "disabled"}>🛒 نشرة مفرق (سوري)</button>
        <button class="button secondary" type="button" data-action="download-approved-prices" ${state.approvedPriceItems.length ? "" : "disabled"}>تصدير أسعار المحاسبة</button>
        <button class="button success" type="button" data-action="publish-bulletin" ${state.session ? "" : "disabled"} title="ينشر النشرتين على رابط الزبائن">🚀 نشر النشرة للزبائن</button>
      </div>
      ${state.bulletinStatus ? `<p class="bulletin-status ${state.bulletinStatus.type}">${escapeHtml(state.bulletinStatus.msg)}</p>` : ""}
      <form class="form-card compact" data-form="live-price-import">
        <label>
          رفع ملف تسعير كامل
          <input name="livePrice" type="file" accept=".xlsx,.xls,.csv">
        </label>
        <button class="button primary" type="submit" ${allAvailable.length ? "" : "disabled"}>اعتماد ملف الأسعار</button>
      </form>
      <div class="inventory-list inventory-list-dense pricing-list" data-pricing-results>
        ${items.length ? groupedAccordion("pricing", items, { groupOf: (i) => i.groupName, rowOf: pricingRow, query: state.pricingSearch }) : `<p class="muted">${escapeHtml(emptyText)}</p>`}
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
        <button class="customer-name-btn" type="button" data-customer-details="${escapeHtml(key)}">${escapeHtml(item.name)}</button>
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

// ====== تقارير PDF (محرّك مشترك) ======
const REPORT_STYLE = `<style>
.ozk-rpt{font-family:Tahoma,Arial,sans-serif;color:#221808;background:#fff;direction:rtl;padding:6px 10px}
.ozk-rpt .rhead{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #b8892a;padding-bottom:8px;margin-bottom:12px}
.ozk-rpt .brand{font-weight:900;font-size:19px}.ozk-rpt .brand small{display:block;font-weight:400;font-size:10px;color:#6b5535}
.ozk-rpt .rtitle{text-align:left}.ozk-rpt .rtitle h2{margin:0;font-size:16px;color:#b8892a}.ozk-rpt .rtitle span{font-size:10px;color:#6b5535}
.ozk-rpt .balbox{background:#f6ead0;border:1px solid #b8892a;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ozk-rpt .balbox .nm{font-weight:900;font-size:15px}.ozk-rpt .balbox .big{font-size:24px;font-weight:900;color:#c0271f}
.ozk-rpt .muted{color:#6b5535;font-size:10.5px}
.ozk-rpt .sec{font-weight:800;font-size:12.5px;margin:12px 0 4px}
.ozk-rpt table{width:100%;border-collapse:collapse;font-size:12px}
.ozk-rpt th{background:#ece6d4;padding:6px 8px;text-align:right;border:1px solid #c8b890;font-size:11px}
.ozk-rpt td{padding:5px 8px;border:1px solid #c8b890}
.ozk-rpt tr{page-break-inside:avoid}
.ozk-rpt tr:nth-child(even) td{background:#faf6ec}
.ozk-rpt .deb{color:#c0271f;font-weight:700}.ozk-rpt .cred{color:#16794f;font-weight:700}
.ozk-rpt .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
.ozk-rpt .rcard{background:#ece6d4;border:1px solid #c8b890;border-radius:8px;padding:10px 12px;text-align:center}
.ozk-rpt .rcard .v{font-size:21px;font-weight:900}.ozk-rpt .rcard .l{font-size:10.5px;color:#6b5535}
.ozk-rpt .rcard .v.gold{color:#b8892a}.ozk-rpt .rcard .v.red{color:#c0271f}
.ozk-rpt .rlogo{height:46px;width:auto}
.ozk-rpt tr.open td{background:#ece6d4;font-weight:800}
.ozk-rpt .rfoot{margin-top:16px;border-top:1.5px solid #b8892a;padding-top:7px;font-size:10px;color:#6b5535;display:flex;justify-content:space-between}
</style>`;

async function exportReportPdf(bodyHtml, filename) {
  if (!window.html2pdf) {
    setNotice("error", "مكتبة PDF لم تتحمل. حدّث الصفحة وجرّب مجددًا.");
    render();
    return;
  }
  const container = document.createElement("div");
  container.style.width = "780px";
  container.style.backgroundColor = "#fff";
  container.innerHTML = bodyHtml;
  document.body.appendChild(container);
  try {
    await window
      .html2pdf()
      .set({
        filename,
        margin: [8, 8, 8, 8],
        image: { type: "png", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] }
      })
      .from(container)
      .save();
  } catch (error) {
    setNotice("error", error.message || "تعذر إنشاء ملف PDF.");
  } finally {
    container.remove();
  }
}

// يجلب حركات الزبون الكاملة (من تقرير ameen_customer_movements) بمطابقة الاسم
function customerFullMovements(item) {
  const report = state.customerMovementsReport;
  const items = Array.isArray(report?.items) ? report.items : [];
  const name = String(item?.name || "").trim();
  if (!name) return null;
  return items.find((x) => String(x.name || "").trim() === name) || null;
}

// الكشف الرسمي الكامل: رصيد أول المدة + كل حركات الفترة برصيد متحرك + الرصيد النهائي
function customerStatementPdfMarkup(item) {
  const key = customerKey(item);
  const profile = customerProfile(key);
  const phone = profile?.phone ? ` — هاتف: ${escapeHtml(profile.phone)}` : "";
  const lastD = customerLastPaymentDate(item);
  const full = customerFullMovements(item);
  const report = state.customerMovementsReport;

  const header = `
    <div class="rhead">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="public/icons/ozk-logo.png" class="rlogo" alt="OZK">
        <div class="brand">OZK TOBACCO<small>كشف حساب زبون رسمي</small></div>
      </div>
      <div class="rtitle"><h2>كشف حساب</h2><span>تاريخ الإصدار: ${escapeHtml(todayIsoDate())}</span></div>
    </div>
    <div class="balbox"><div><div class="nm">${escapeHtml(item.name || "")}</div>
      <div class="muted">آخر دفعة: ${lastD ? escapeHtml(String(lastD).slice(0, 10)) : "لا يوجد"}${phone}</div></div>
      <div style="text-align:left"><div class="muted">الرصيد المستحق</div><div class="big">${escapeHtml(formatMoney(customerBalance(item)))}</div></div></div>`;

  const footer = `
    <div class="rfoot">
      <span>هذا الكشف صادر آليًا عن نظام OZK TOBACCO</span>
      <span dir="ltr">0985000771 — 0984000662</span>
    </div>`;

  if (full && Array.isArray(full.movements)) {
    const fromDate = report?.summary?.fromDate || "";
    const rows = [];
    let running = Number(full.openingBalance || 0);
    rows.push(`<tr class="open"><td>${escapeHtml(fromDate || "—")}</td><td colspan="2">رصيد أول المدة</td><td></td><td>${escapeHtml(formatMoney(running))}</td></tr>`);
    full.movements.forEach((m) => {
      const d = Number(m.debit || 0), c = Number(m.credit || 0);
      running += d - c;
      rows.push(`<tr><td>${m.date ? escapeHtml(String(m.date).slice(0, 10)) : "—"}</td><td class="deb">${d > 0 ? escapeHtml(formatMoney(d)) : "—"}</td><td class="cred">${c > 0 ? escapeHtml(formatMoney(c)) : "—"}</td><td>${escapeHtml(m.notes || "—")}</td><td>${escapeHtml(formatMoney(running))}</td></tr>`);
    });
    const closing = Number(full.closingBalance || running);
    const truncNote = full.truncated ? `<p class="muted">ملاحظة: الكشف يعرض آخر الحركات ضمن الفترة لكثرتها.</p>` : "";
    const liveBalance = customerBalance(item);
    const liveNote = Math.abs(liveBalance - closing) > 0.01
      ? `<p class="muted">الرصيد الحالي بعد آخر مزامنة: ${escapeHtml(formatMoney(liveBalance))}</p>`
      : "";
    return `${REPORT_STYLE}<div class="ozk-rpt">
      ${header}
      <div class="sec">حركة الحساب من ${escapeHtml(fromDate || "بداية الفترة")} حتى ${escapeHtml(todayIsoDate())}</div>
      <table>
        <tr><th>التاريخ</th><th>مدين (بضاعة)</th><th>دائن (دفع)</th><th>البيان</th><th>الرصيد</th></tr>
        ${rows.join("")}
        <tr class="open"><td></td><td colspan="2">الرصيد في نهاية الفترة</td><td></td><td><b>${escapeHtml(formatMoney(closing))}</b></td></tr>
      </table>
      ${truncNote}${liveNote}
      ${footer}
    </div>`;
  }

  // احتياط: النسخة المختصرة (آخر الحركات والدفعات فقط) إذا لم يتوفر تقرير الحركات الكاملة
  const ameenP = (Array.isArray(item.recentPayments) ? item.recentPayments : []).map((p) => ({ amount: p.amount, date: p.date || "", notes: p.notes }));
  const manualP = ((state.paymentRecords && state.paymentRecords[key]) || []).map((p) => ({ amount: p.amount, date: p.paymentDate || "", notes: p.notes }));
  const payments = [...ameenP, ...manualP].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 25);
  const movements = (Array.isArray(item.recentMovements) ? [...item.recentMovements] : []).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 25);
  const pr = payments.length
    ? payments.map((p) => `<tr><td>${p.date ? escapeHtml(String(p.date).slice(0, 10)) : "—"}</td><td class="cred">${escapeHtml(formatMoney(p.amount || 0))}</td><td>${escapeHtml(p.notes || "—")}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">لا توجد دفعات مسجّلة</td></tr>`;
  const mv = movements.length
    ? movements.map((m) => {
        const d = Number(m.debit || 0), c = Number(m.credit || 0);
        return `<tr><td>${m.date ? escapeHtml(String(m.date).slice(0, 10)) : "—"}</td><td class="deb">${d > 0 ? escapeHtml(formatMoney(d)) : "—"}</td><td class="cred">${c > 0 ? escapeHtml(formatMoney(c)) : "—"}</td><td>${escapeHtml(m.notes || "—")}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">لا توجد حركة مسجّلة</td></tr>`;
  return `${REPORT_STYLE}<div class="ozk-rpt">
    ${header}
    <div class="sec">سجل الدفعات (الأحدث)</div>
    <table><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr>${pr}</table>
    <div class="sec">كشف الحركة (الأحدث)</div>
    <table><tr><th>التاريخ</th><th>مدين (بضاعة)</th><th>دائن (دفع)</th><th>ملاحظات</th></tr>${mv}</table>
    ${footer}
  </div>`;
}

async function exportCustomerStatementPdf() {
  const item = selectedCustomer(latestCustomerBalanceItems());
  if (!item) {
    setNotice("error", "اختر زبونًا أولاً.");
    render();
    return;
  }
  const safe = String(item.name || "customer").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  await exportReportPdf(customerStatementPdfMarkup(item), `كشف-حساب-${safe}-${todayIsoDate()}.pdf`);
  setNotice("success", "تم تجهيز كشف الحساب PDF.");
  render();
}

function receivablesPdfMarkup() {
  const items = latestCustomerBalanceItems();
  const debtors = items.filter((i) => customerBalance(i) > 0).sort((a, b) => customerBalance(b) - customerBalance(a));
  const totals = customerBalanceTotals(items);
  const maxBal = debtors.length ? customerBalance(debtors[0]) : 0;
  const top = debtors.slice(0, 40);
  const rows = top.length
    ? top.map((it, idx) => {
        const ld = customerLastPaymentDate(it);
        return `<tr><td>${idx + 1}</td><td>${escapeHtml(it.name || "")}</td><td class="deb">${escapeHtml(formatMoney(customerBalance(it)))}</td><td>${ld ? escapeHtml(String(ld).slice(0, 10)) : "—"}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">لا يوجد زبائن مدينون</td></tr>`;
  return `${REPORT_STYLE}<div class="ozk-rpt">
    <div class="rhead"><div class="brand">OZK TOBACCO<small>تقرير الذمم الإجمالي</small></div>
      <div class="rtitle"><h2>الذمم</h2><span>بتاريخ ${escapeHtml(todayIsoDate())}</span></div></div>
    <div class="cards">
      <div class="rcard"><div class="v gold">${escapeHtml(formatMoney(totals.totalDebitBalance))}</div><div class="l">إجمالي المستحق على الزبائن</div></div>
      <div class="rcard"><div class="v">${escapeHtml(totals.debitCustomers)}</div><div class="l">زبون مدين (من أصل ${escapeHtml(items.length)})</div></div>
      <div class="rcard"><div class="v red">${escapeHtml(formatMoney(maxBal))}</div><div class="l">أعلى رصيد فردي</div></div>
    </div>
    <div class="sec">أعلى الزبائن مديونية</div>
    <table><tr><th>#</th><th>الزبون</th><th>الرصيد</th><th>آخر دفعة</th></tr>${rows}</table>
  </div>`;
}

async function exportReceivablesPdf() {
  const items = latestCustomerBalanceItems();
  if (!items.length) {
    setNotice("error", "لا توجد أرصدة زبائن لإنشاء التقرير.");
    render();
    return;
  }
  await exportReportPdf(receivablesPdfMarkup(), `تقرير-الذمم-${todayIsoDate()}.pdf`);
  setNotice("success", "تم تجهيز تقرير الذمم PDF.");
  render();
}

function inventoryReportPdfMarkup() {
  const priced = pricingWorklistItems().filter((i) => i.hasApprovedPrice);
  const out = priced.filter((i) => itemQty(i) <= 0);
  const low = priced.filter((i) => itemQty(i) > 0 && itemQty(i) < 10).sort((a, b) => itemQty(a) - itemQty(b));
  const list = [...out, ...low].slice(0, 60);
  const rows = list.length
    ? list.map((it) => {
        const q = itemQty(it);
        const st = q <= 0
          ? '<span class="deb">نافد</span>'
          : (q < 5 ? '<span class="deb">شبه نافد</span>' : '<span style="color:#8a5a00;font-weight:700">منخفض</span>');
        return `<tr><td>${escapeHtml(it.name || "")}</td><td>${escapeHtml(formatMoney(q))} ${escapeHtml(itemUnit2Name(it))}</td><td>${it.unit2Price > 0 ? escapeHtml(formatMoney(it.unit2Price)) : "—"}</td><td>${st}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">لا توجد مواد منخفضة أو نافدة</td></tr>`;
  return `${REPORT_STYLE}<div class="ozk-rpt">
    <div class="rhead"><div class="brand">OZK TOBACCO<small>تقرير المخزون</small></div>
      <div class="rtitle"><h2>المخزون</h2><span>بتاريخ ${escapeHtml(todayIsoDate())}</span></div></div>
    <div class="cards">
      <div class="rcard"><div class="v gold">${escapeHtml(priced.length)}</div><div class="l">صنف مسعّر</div></div>
      <div class="rcard"><div class="v red">${escapeHtml(low.length)}</div><div class="l">قارب على النفاد (أقل من 10)</div></div>
      <div class="rcard"><div class="v red">${escapeHtml(out.length)}</div><div class="l">نافد</div></div>
    </div>
    <div class="sec">مواد قاربت على النفاد أو نافدة</div>
    <table><tr><th>الصنف</th><th>المتبقّي</th><th>السعر</th><th>الحالة</th></tr>${rows}</table>
  </div>`;
}

async function exportInventoryReportPdf() {
  const items = pricingWorklistItems();
  if (!items.length) {
    setNotice("error", "لا توجد مواد لإنشاء تقرير المخزون.");
    render();
    return;
  }
  await exportReportPdf(inventoryReportPdfMarkup(), `تقرير-المخزون-${todayIsoDate()}.pdf`);
  setNotice("success", "تم تجهيز تقرير المخزون PDF.");
  render();
}

function customerDetailsPanel(item) {
  if (!item) {
    return `
      <section class="customer-detail-panel customer-detail-empty" data-customer-detail-panel>
        <span class="customer-detail-hint">👆 اضغط على اسم أي زبون لعرض سجل دفعاته الكامل</span>
      </section>
    `;
  }

  const key = customerKey(item);
  const profile = customerProfile(key);
  const ameenPayments = (Array.isArray(item.recentPayments) ? item.recentPayments : [])
    .map((p) => ({ amount: p.amount, date: p.date || "", notes: p.notes, source: "ameen" }));
  const manualPayments = (state.paymentRecords[key] || [])
    .map((p) => ({ amount: p.amount, date: p.paymentDate || "", notes: p.notes, source: "manual" }));
  const allPayments = [...ameenPayments, ...manualPayments]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const movements = Array.isArray(item.recentMovements)
    ? [...item.recentMovements].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    : [];

  return `
    <section class="customer-detail-panel" data-customer-detail-panel>
      <div class="panel-title-row inventory-browser-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="muted">الرصيد، تسجيل الدفعات، معلومات التواصل.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="button primary compact-button" type="button" data-action="export-statement">📄 كشف حساب PDF</button>
          <button class="button secondary compact-button" type="button" data-action="clear-customer-details">✕ إغلاق</button>
        </div>
      </div>

      <div class="inventory-metrics customer-detail-metrics">
        ${inventoryMetric("الرصيد الحالي", formatMoney(customerBalance(item)), customerStatusLabel(item.status))}
        ${inventoryMetric("الحد المسموح", customerLimit(item) > 0 ? formatMoney(customerLimit(item)) : "غير محدد", customerLimitSourceLabel(item.limitSource))}
        ${inventoryMetric("المتبقي من الحد", customerLimit(item) > 0 ? formatMoney(customerRemainingLimit(item)) : "غير محدد", "من الحد الفعال")}
        ${inventoryMetric("آخر دفعة", customerLastPaymentAmount(item) > 0 ? formatMoney(customerLastPaymentAmount(item)) : "غير متوفر", customerLastPaymentDate(item) ? formatDate(customerLastPaymentDate(item)) : "لا يوجد تاريخ")}
      </div>

      ${state.session ? `
        <div class="payment-record-section">
          <h4>تسجيل دفعة جديدة</h4>
          <form class="payment-record-form" data-form="record-payment" data-customer-key="${escapeHtml(key)}" data-customer-name="${escapeHtml(item.name || "")}">
            <div class="payment-form-row">
              <label>المبلغ<input name="amount" type="text" inputmode="decimal" dir="ltr" placeholder="0.00" required></label>
              <label>التاريخ<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
            </div>
            <label>ملاحظة<input name="notes" maxlength="500" placeholder="مثال: دفعة نقدية"></label>
            <button class="button primary mini-button" type="submit" ${state.paymentLoading ? "disabled" : ""}>${state.paymentLoading ? "جاري الحفظ..." : "✓ حفظ الدفعة"}</button>
          </form>
          ${state.paymentError ? `<p style="color:var(--danger);font-size:0.82rem;margin:6px 0 0">${escapeHtml(state.paymentError)}</p>` : ""}
        </div>
      ` : ""}

      <details class="customer-profile-details">
        <summary>معلومات التواصل ${profile ? "✓" : ""}</summary>
        <form class="form-card compact" data-form="customer-profile" data-customer-key="${escapeHtml(key)}" data-customer-name="${escapeHtml(item.name || "")}">
          <div class="profile-form-row">
            <label>رقم الهاتف<input name="phone" type="tel" dir="ltr" value="${escapeHtml(profile?.phone || "")}" placeholder="+963..."></label>
            <label>العنوان<input name="address" value="${escapeHtml(profile?.address || "")}" placeholder="حي، مدينة..."></label>
          </div>
          <label>ملاحظات<input name="notes" value="${escapeHtml(profile?.notes || "")}" placeholder="أي معلومات إضافية..."></label>
          <button class="button secondary mini-button" type="submit">حفظ</button>
        </form>
      </details>

      <div class="customer-detail-grid">
        <article>
          <div class="detail-section-head">
            <h4>سجل الدفعات</h4>
            <span class="status-chip">${allPayments.length} دفعة</span>
          </div>
          <div class="detail-list payment-timeline">
            ${allPayments.length
              ? allPayments.map((p) => `
                <div class="payment-entry">
                  <div class="payment-entry-dot ${p.source === "manual" ? "manual-dot" : ""}"></div>
                  <div class="payment-entry-body">
                    <strong class="payment-amount">${escapeHtml(formatMoney(p.amount || 0))}</strong>
                    <span class="payment-date">${escapeHtml(p.date ? formatDate(p.date) : "بلا تاريخ")}</span>
                    <span class="payment-source-badge ${p.source === "manual" ? "badge-manual" : "badge-ameen"}">${p.source === "manual" ? "يدوي" : "الأمين"}</span>
                    ${p.notes ? `<small class="payment-note">${escapeHtml(p.notes)}</small>` : ""}
                  </div>
                </div>`).join("")
              : `<p class="muted" style="padding:12px 0">${state.paymentLoading ? "جاري التحميل..." : "لا توجد دفعات مسجلة."}</p>`}
          </div>
        </article>
        <article>
          <div class="detail-section-head">
            <h4>كشف الحركة</h4>
            <span class="status-chip">${movements.length} حركة</span>
          </div>
          <div class="detail-list payment-timeline">
            ${movements.length
              ? movements.map((m) => `
                <div class="payment-entry">
                  <div class="payment-entry-dot movement-dot"></div>
                  <div class="payment-entry-body">
                    <strong class="payment-amount">${escapeHtml(movementLabel(m))}: ${escapeHtml(formatMoney(movementAmount(m)))}</strong>
                    <span class="payment-date">${escapeHtml(m?.date ? formatDate(m.date) : "بلا تاريخ")}</span>
                    ${m?.notes ? `<small class="payment-note">${escapeHtml(m.notes)}</small>` : ""}
                  </div>
                </div>`).join("")
              : '<p class="muted" style="padding:12px 0">لا توجد حركة مسجلة.</p>'}
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

  const overdue = overdueCustomers();
  const overdueHtml = overdue.length > 0 ? `
    <section class="panel overdue-panel" style="margin-bottom:16px">
      <div class="overdue-header">
        <span class="overdue-icon">⚠️</span>
        <div style="flex:1">
          <strong>${overdue.length} زبون بدون دفعة منذ أكثر من 3 أيام</strong>
          <p class="muted" style="font-size:.85rem;margin:2px 0 0">هؤلاء الزبائن عليهم رصيد ولم يسجّل لهم أي دفعة خلال الفترة المحددة.</p>
        </div>
        <button class="button secondary compact-button" type="button" data-action="print-overdue">🖨️ PDF</button>
      </div>
      <div class="overdue-list">
        ${overdue.slice(0, 20).map((item) => `
          <div class="overdue-row">
            <span class="overdue-name">${escapeHtml(item.customer_name || item.name || "—")}</span>
            <span class="overdue-balance">${formatMoney(customerBalance(item))}</span>
            <span class="overdue-days ${item.daysSince === null ? "overdue-unknown" : item.daysSince >= 7 ? "overdue-critical" : "overdue-warn"}">
              ${item.daysSince === null ? "تاريخ دفع غير معروف" : `${item.daysSince} يوم`}
            </span>
          </div>`).join("")}
      </div>
    </section>
  ` : "";

  return `
    ${overdueHtml}
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
        <button class="button primary" type="button" data-action="report-receivables" ${items.length ? "" : "disabled"}>📊 تقرير الذمم PDF</button>
      </div>
      ${customerDetailsPanel(detailItem)}
      <div class="inventory-list inventory-list-dense customer-results" data-customer-results>
        ${filtered.length ? groupedAccordion("balances", filtered, { groupOf: (i) => customerBalance(i) > 0 ? "زبائن مدينون" : (customerBalance(i) < 0 ? "زبائن دائنون (لهم)" : "متوازنون"), rowOf: customerBalanceRow, query: state.customerSearch }) : '<p class="muted">لا توجد زبائن تطابق البحث والفلتر الحالي.</p>'}
      </div>
      
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
  return sessionStorage.getItem(`ozk_ai_key_${provider}`) || appConfig.ai?.[provider]?.apiKey || "";
}

function setAiKey(provider, value) {
  const trimmed = value.trim();
  if (trimmed) sessionStorage.setItem(`ozk_ai_key_${provider}`, trimmed);
  else sessionStorage.removeItem(`ozk_ai_key_${provider}`);
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

</body></html>`;

  const win = window.open("", "_blank", "width=850,height=1100");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
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
      ? groupedAccordion("ameen", filtered, { groupOf: (i) => i.groupName, rowOf: inventoryRow, query: state.ameenSearch })
      : '<p class="muted">لا توجد مواد تطابق البحث والفلتر الحالي.</p>';
    bindAccordions(results);
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
      ? groupedAccordion("balances", filtered, { groupOf: (i) => customerBalance(i) > 0 ? "زبائن مدينون" : (customerBalance(i) < 0 ? "زبائن دائنون (لهم)" : "متوازنون"), rowOf: customerBalanceRow, query: state.customerSearch })
      : '<p class="muted">لا توجد زبائن تطابق البحث والفلتر الحالي.</p>';
    bindAccordions(results);
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
      const key = button.dataset.customerDetails;
      state.selectedCustomerKey = key;
      state.paymentError = null;
      render();
      loadPaymentRecords(key);
    });
  });
}

function bindPricingForms(root = app) {
  root.querySelectorAll("[data-form='pricing-item']").forEach((form) => {
    if (form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const forms = [...app.querySelectorAll("[data-form='pricing-item']")];
      const idx = forms.indexOf(event.currentTarget);
      const nextKey = forms[idx + 1]?.dataset.itemKey || "";
      const ok = await savePricingItem(event.currentTarget);
      if (ok && nextKey) {
        const nextForm = [...app.querySelectorAll("[data-form='pricing-item']")].find((f) => f.dataset.itemKey === nextKey);
        const nextInput = nextForm?.querySelector("input[name='salePrice']");
        if (nextInput) {
          const det = nextForm.closest("details.acc-group");
          if (det && !det.open) {
            det.open = true;
            const set = state.openSections.pricing || (state.openSections.pricing = new Set());
            set.add(det.dataset.accKey);
          }
          nextInput.focus();
          nextInput.select?.();
          nextForm.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    });
  });
}

// تحديث قائمة نتائج التسعير فقط (دون إعادة رسم الصفحة) حتى لا يضيع التركيز أثناء البحث
function updatePricingResults() {
  const items = pricingWorklistItems();
  const results = app.querySelector("[data-pricing-results]");
  if (!results) return;
  results.innerHTML = items.length
    ? groupedAccordion("pricing", items, { groupOf: (i) => i.groupName, rowOf: pricingRow, query: state.pricingSearch })
    : '<p class="muted">لا توجد مواد تطابق البحث الحالي.</p>';
  bindAccordions(results);
  bindPricingForms(results);
}

// أكورديون: تجميع القوائم الطويلة بعناوين مطوية
function groupedAccordion(pageKey, items, opts) {
  const groupOf = opts.groupOf, rowOf = opts.rowOf;
  const hasQuery = Boolean(opts.query && String(opts.query).trim());
  const openSet = state.openSections[pageKey] || (state.openSections[pageKey] = new Set());
  const groups = new Map();
  items.forEach((it) => {
    const g = String(groupOf(it) || "أخرى");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  });
  const entries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  return entries
    .map(([g, arr]) => {
      const open = hasQuery || openSet.has(g);
      return `<details class="acc-group" data-acc="${escapeHtml(pageKey)}" data-acc-key="${escapeHtml(g)}"${open ? " open" : ""}>
        <summary class="acc-summary"><span class="acc-title">${escapeHtml(g)}</span><span class="acc-count">${arr.length}</span></summary>
        <div class="acc-body">${arr.map(rowOf).join("")}</div>
      </details>`;
    })
    .join("");
}

function bindAccordions(root = app) {
  root.querySelectorAll("details.acc-group").forEach((d) => {
    if (d.dataset.accBound === "true") return;
    d.dataset.accBound = "true";
    d.addEventListener("toggle", () => {
      const pg = d.dataset.acc, key = d.dataset.accKey;
      const set = state.openSections[pg] || (state.openSections[pg] = new Set());
      if (d.open) set.add(key); else set.delete(key);
    });
  });
}

function render() {
  if (state.showExchangeModal) {
    app.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target === this) { state.showExchangeModal = false; render(); }">
        <div class="modal" style="max-width:420px">
          <h2>🔄 سعر صرف الدولار إلى الليرة السورية</h2>
          <p class="muted" style="margin:8px 0 16px">أدخل سعر الصرف الحالي لتحويل الأسعار وتنزيل النشرة:</p>
          <form id="exchange-form">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:0.82rem;margin-bottom:14px">
              السعر (ليرة سورية مقابل دولار واحد)
              <input type="number" id="exchange-input" step="0.01" min="0" placeholder="مثال: 88000" value="${state.syriaExchangeRate}" required style="padding:8px 10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;font-family:monospace">
            </label>
            <div style="display:flex;gap:10px;justify-content:flex-end">
              <button class="btn btn-secondary" type="button" onclick="state.showExchangeModal = false; render()">إلغاء</button>
              <button class="btn btn-primary" type="submit">تطبيق ومعاينة</button>
            </div>
          </form>
        </div>
      </div>
    `;
    const form = app.querySelector("#exchange-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        state.syriaExchangeRate = Number(document.getElementById("exchange-input").value) || 1;
        writeJson("syria-exchange-rate", state.syriaExchangeRate);
        state.syriaRateConfirmed = true;
        state.showExchangeModal = false;
        openPricePreview(true);
      });
    }
    return;
  }

  if (state.pricePreview?.open) {
    const { items, latest, useSyria } = state.pricePreview;
    const pageCount = pricePdfPages(bulletinDisplayGroups(items, useSyria)).length;
    app.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target === this){ state.pricePreview = null; render(); }">
        <div class="modal" style="max-width:920px;width:96vw;max-height:94vh;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div>
              <h2 style="margin:0">👁 معاينة النشرة قبل التصدير</h2>
              <p class="muted" style="margin:4px 0 0;font-size:0.8rem">${escapeHtml(items.length)} صنف — ${escapeHtml(pageCount)} صفحة${useSyria ? " — مفرّق بالليرة" : " — جملة بالدولار"}</p>
            </div>
            <div style="display:flex;gap:8px">
              <button class="button success" type="button" data-action="export-price-preview">⬇ تصدير PDF</button>
              <button class="button secondary" type="button" data-action="close-price-preview">إغلاق</button>
            </div>
          </div>
          <div class="price-preview-scroll" style="overflow:auto;background:#9a9a9a;padding:16px;border-radius:8px;flex:1;display:flex;justify-content:center">
            ${customerPricePdfMarkup(items, latest, useSyria)}
          </div>
        </div>
      </div>
    `;
    app.querySelector("[data-action='export-price-preview']")?.addEventListener("click", exportPricePreview);
    app.querySelector("[data-action='close-price-preview']")?.addEventListener("click", closePricePreview);
    return;
  }

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

  app.querySelector("[data-action='toggle-theme']")?.addEventListener("click", () => {
    state.darkMode = !state.darkMode;
    applyTheme();
    render();
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
  app.querySelector("[data-action='download-customer-price-pdf']")?.addEventListener("click", () => openPricePreview(false));
  app.querySelector("[data-action='download-customer-price-syria']")?.addEventListener("click", () => openPricePreview(true));
  app.querySelector("[data-action='publish-bulletin']")?.addEventListener("click", publishBulletin);
  app.querySelector("[data-action='download-approved-prices']")?.addEventListener("click", downloadApprovedPricesForAccounting);
  app.querySelector("[data-action='download-inventory']")?.addEventListener("click", downloadLatestInventoryReport);
  app.querySelector("[data-action='download-filtered-inventory']")?.addEventListener("click", downloadFilteredInventoryReport);
  app.querySelector("[data-action='download-customer-balances']")?.addEventListener("click", downloadFilteredCustomerBalances);
  app.querySelector("[data-action='refresh-ameen']")?.addEventListener("click", refreshAmeenReports);
  app.querySelector("[data-action='clear-customer-details']")?.addEventListener("click", () => {
    state.selectedCustomerKey = "";
    state.paymentError = null;
    render();
  });

  app.querySelector("[data-action='export-statement']")?.addEventListener("click", exportCustomerStatementPdf);
  app.querySelector("[data-action='report-receivables']")?.addEventListener("click", exportReceivablesPdf);
  app.querySelector("[data-action='report-inventory']")?.addEventListener("click", exportInventoryReportPdf);

  app.querySelector("[data-action='print-overdue']")?.addEventListener("click", printOverdueReport);

  app.querySelectorAll("[data-form='record-payment']").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const key = form.dataset.customerKey;
      const name = form.dataset.customerName;
      const amount = formValue(form, "amount");
      const date = formValue(form, "date");
      const notes = formValue(form, "notes");
      state.paymentLoading = true;
      state.paymentError = null;
      render();
      try {
        await dataStore.createPaymentRecord({ customerKey: key, customerName: name, amount, paymentDate: date, notes });
        form.reset();
        form.querySelector("[name='date']").value = new Date().toISOString().slice(0, 10);
        setNotice("success", "تم تسجيل الدفعة بنجاح ✓");
        await loadPaymentRecords(key);
      } catch (error) {
        state.paymentLoading = false;
        state.paymentError = error.message;
        render();
      }
    });
  });

  app.querySelectorAll("[data-form='customer-profile']").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const key = form.dataset.customerKey;
      const name = form.dataset.customerName;
      try {
        await dataStore.upsertCustomerProfile({ customerKey: key, customerName: name, phone: formValue(form, "phone"), address: formValue(form, "address"), notes: formValue(form, "notes") });
        await loadCustomerProfiles();
        setNotice("success", "تم حفظ معلومات الزبون ✓");
        render();
      } catch (error) {
        setNotice("error", error.message);
        render();
      }
    });
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
    updatePricingResults();
  });

  app.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.priceMode = btn.dataset.mode === "mufrak" ? "mufrak" : "jumla";
      writeJson("price-mode", state.priceMode);
      render();
    });
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
  bindAccordions();

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
