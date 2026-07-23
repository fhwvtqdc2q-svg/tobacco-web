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
  const normalized = String(value ?? "")
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

  // الاسمان القديمان في الموقع يقابلان الاسمين الجديدين في الأمين.
  // إبقاء alias هنا يمنع انقطاع المخزون أو السعر عند وجود سجل قديم في Supabase.
  const aliases = new Map([
    ["كابتن بلاك كوين ازرق", "كابتن بلاك كور ازرق جديد"],
    ["كابتن بلاك كوين اسود", "كابتن بلاك كور اسود جديد"]
  ]);
  return aliases.get(normalized) || normalized;
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
      ameen_excel: "ملف إكسل من الأمين"
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

const allowedRoutes = new Set(["overview", "login", "requests", "ameen", "balances", "pricing", "remote", "monitoring", "payments", "purchases", "sales"]);

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
  customerInvoicesReport: null,
  customerWhatsapp: [],
  broadcastType: "",
  broadcastText: "",
  customerCreditLimits: [],
  customerLimitError: null,
  approvedPriceItems: [],
  approvedPriceError: null,
  itemCosts: [],
  paymentRecords: {},
  paymentError: null,
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
  dailyMovement: null,
  dailyMovementDate: "",
  dailyMovementLoading: false,
  dailyMovementError: null,
  dmFetchedFor: null,
  loading: true,
  notice: null,
  aiMessages: [],
  aiProvider: "claude",
  aiLoading: false,
  aiSettingsOpen: false,
  invCustomer: "",
  invNotes: "",
  invRows: [{ name: "", qty: "1", price: "" }],
  // ===== فاتورة مبيعات (route: sales) — نواة MVP مستقلة تماماً عن route invoice =====
  salesMode: readJson("sales-mode", "jumla"),        // "jumla" جملة/دولار | "mufrak" مفرق/سوري
  salesCustomer: "",                                    // فارغ = زبون نقدي
  salesPayMethod: "cash",                               // "cash" نقدي | "credit" أجل
  salesDiscount: "",
  salesPaid: "",
  salesInvoiceNo: "",
  salesSavedNo: "",
  salesRows: [{ q: "", key: "", name: "", num: "", unit: "unit2", qty: "1", price: "", edited: false }],
  purchaseInvoices: [],
  poSupplier: "",
  poDate: "",
  poNotes: "",
  poRows: [{ name: "", qty: "1", price: "" }],
  poSaving: false,
  poOpenId: "",
  notifPermission: "default",
  seenRequestIds: new Set(),
  globalSearch: "",
  syriaCurrency: "USD",
  syriaExchangeRate: readJson("syria-exchange-rate", 14050),
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
    // التسجيل من الجذر ليغطي النطاق الموقع كاملاً؛ التسجيل القديم بنطاق public/ يُزال
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((reg) => { if (reg.scope.includes("/public/")) reg.unregister(); }))
      .catch(() => {});
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
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
      const routeMap = { "1": "overview", "2": "dashboard", "3": "requests", "4": "ameen", "5": "pricing", "6": "invoice", "7": "purchases", "8": "balances", "9": "sales" };
      const target = routeMap[event.key];
      if (target) {
        event.preventDefault();
        if ((target === "dashboard" || target === "invoice" || target === "purchases" || target === "sales") && !state.session) return;
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
  await loadPublishedExchangeRate();
  await refreshSession();
  await loadRequests();
  await loadInventoryReports();
  await loadCustomerBalanceReports();
  await loadCustomerCreditLimits();
  await loadApprovedPriceItems();
  await loadCustomerProfiles();
  await loadPurchaseInvoices();
  state.seenRequestIds = new Set(state.requests.map((r) => r.id));
  state.notifPermission = notifSupported() ? Notification.permission : "denied";
  state.loading = false;
  render();
  const overdue = overdueCustomers();
  if (overdue.length > 0) fireOverdueNotif(overdue.length);
}

async function loadPublishedExchangeRate() {
  try {
    const response = await fetch(`scripts/exchange-rate.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const rate = Number(payload.sypPerUsd || 0);
    if (rate > 0) {
      state.syriaExchangeRate = rate;
      writeJson("syria-exchange-rate", rate);
    }
  } catch {}
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

async function loadPurchaseInvoices() {
  try {
    if (dataStore.isConfigured() && !state.session) {
      state.purchaseInvoices = [];
      return;
    }
    state.purchaseInvoices = dataStore.listPurchaseInvoices ? await dataStore.listPurchaseInvoices() : [];
  } catch {
    state.purchaseInvoices = [];
  }
}

async function loadDailyMovement(date) {
  const target = date || state.dailyMovementDate || todayIsoDate();
  state.dailyMovementDate = target;
  state.dailyMovementLoading = true;
  state.dailyMovementError = null;
  state.dmFetchedFor = target;
  render();
  try {
    state.dailyMovement = dataStore.getDailyMovementReport
      ? await dataStore.getDailyMovementReport(target)
      : null;
  } catch (error) {
    state.dailyMovement = null;
    state.dailyMovementError = safeErrorMessage(error);
  } finally {
    state.dailyMovementLoading = false;
    render();
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

// ===== واتساب: إرسال وصل/فاتورة رسمية للزبون =====
const SITE_BASE = "https://fhwvtqdc2q-svg.github.io/tobacco-web";

async function loadCustomerWhatsapp() {
  try {
    state.customerWhatsapp = dataStore.listCustomerWhatsapp ? await dataStore.listCustomerWhatsapp() : [];
  } catch {
    state.customerWhatsapp = [];
  }
}

// مطابقة ذكية لاسم الزبون: تطابق تام أولاً، ثم "اسم بداية الآخر"، ثم "يحتوي".
// تحلّ مشكلة اختلاف الاسم المختصر عن الاسم الكامل (مثل «مركز الحرية» مقابل «مركز الحرية / حي تشرين»).
function smartNameMatch(list, getName, name) {
  const nm = normalizeItemName(name || "");
  if (!nm || !Array.isArray(list)) return null;
  const norm = (x) => normalizeItemName(getName(x) || "");
  let row = list.find((x) => norm(x) === nm);
  if (row) return row;
  const pref = list.filter((x) => { const n = norm(x); return n && (n.startsWith(nm) || nm.startsWith(n)); });
  if (pref.length) return pref[0];
  const cont = list.filter((x) => { const n = norm(x); return n && (n.includes(nm) || nm.includes(n)); });
  return cont.length ? cont[0] : null;
}

function findWhatsappByName(name) {
  return smartNameMatch(state.customerWhatsapp || [], (c) => c.customer_name, name);
}

function findBalanceCustomerByText(text) {
  return smartNameMatch(latestCustomerBalanceItems() || [], (it) => it.name, text);
}

function whatsappFor(item) {
  if (!item) return null;
  const list = state.customerWhatsapp || [];
  const guid = item.customerGuid || item.customerAccountGuid;
  let row = guid ? list.find((c) => c.customer_guid === guid) : null;
  if (!row) row = findWhatsappByName(item.name);
  return row || null;
}

function customerCurrencyOverride(item) {
  if (!item) return "";
  const map = readJson("customer-currency-overrides", {});
  const val = map ? map[customerKey(item)] : "";
  return val === "$" || val === "ل.س" ? val : "";
}

function setCustomerCurrencyOverride(item, cur) {
  if (!item) return;
  const map = readJson("customer-currency-overrides", {}) || {};
  map[customerKey(item)] = cur;
  writeJson("customer-currency-overrides", map);
}

function customerCurrency(item) {
  const ov = customerCurrencyOverride(item);
  if (ov) return ov;
  const w = whatsappFor(item);
  const c = String((w && w.currency) || "").trim().toLowerCase();
  if (c.includes("ليرة") || c.includes("ل.س") || c.includes("syp") || c.includes("pound")) return "ل.س";
  return "$";
}

// تقرير مزامنة الذمم يرسل رصيد ac000 بعملة الأساس (الدولار) لكل الزبائن.
// لا نعيد تحويله حسب عملة الفاتورة أو إعداد الوصل كي لا نصغّر حساباً دولارياً خطأً.
function customerBalanceSortValue(item) {
  return customerBalance(item);
}

function docNumber(prefix) {
  return prefix + "-" + todayIsoDate().replace(/-/g, "") + "-" + String(Math.floor(1000 + Math.random() * 9000));
}

async function sendReceiptWhatsapp(item, amount, date, notes) {
  const w = whatsappFor(item);
  const cur = customerCurrency(item);
  const amt = Number(amount) || 0;
  const balanceAfter = customerBalance(item) - amt;
  const doc = {
    t: "receipt",
    no: docNumber("R"),
    date: date || todayIsoDate(),
    name: item.name || "",
    phone: w ? w.phone_number : "",
    amount: amt,
    balance: balanceAfter,
    cur: cur,
    notes: notes || ""
  };
  try {
    await dataStore.createSharedDocument(doc);
  } catch (e) {
    setNotice("error", "تعذّر حفظ الوصل: " + (e.message || ""));
    return;
  }
  // واتساب أُلغي — الوصل يُحفظ بالنظام/الأرشيف (أساس الرفع التلقائي إلى Google Drive لاحقاً)
  setNotice("success", "تم حفظ الوصل بالنظام والأرشيف ✓");
}

async function sendInvoiceWhatsapp(customer, rows, notes, total, invNum) {
  const w = findWhatsappByName(customer);
  const items = (rows || []).map((r) => ({ name: r.name, qty: toNumber(r.qty), price: toNumber(r.price), total: toNumber(r.qty) * toNumber(r.price) }));
  const doc = { t: "invoice", no: invNum || docNumber("INV"), date: todayIsoDate(), name: customer || "", phone: w ? w.phone_number : "", items: items, total: total, cur: "$", notes: notes || "" };
  try {
    await dataStore.createSharedDocument(doc);
  } catch (e) {
    setNotice("error", "تعذّر حفظ الفاتورة: " + (e.message || ""));
    return;
  }
  // واتساب أُلغي — الفاتورة تُحفظ بالنظام/الأرشيف (أساس الرفع التلقائي إلى Google Drive لاحقاً)
  setNotice("success", "تم حفظ الفاتورة بالنظام والأرشيف ✓");
}

// لوحة الإرسال الجماعي حسب التصنيف
function whatsappBroadcastPanel() {
  // واتساب أُلغي بالكامل — لوحة الإرسال الجماعي معطّلة (التحويل إلى Google Drive)
  return "";
  const list = state.customerWhatsapp || [];
  const types = [...new Set(list.map((c) => (c.customer_type || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  if (!types.length) return "";
  const sel = state.broadcastType || "";
  const inGroup = sel ? list.filter((c) => (c.customer_type || "").trim() === sel && c.phone_number) : [];
  const rowStyle = "display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--line)";
  const rows = inGroup
    .map((c) => `<div style="${rowStyle}"><span>${escapeHtml(c.customer_name || "")}</span><span class="muted" dir="ltr" style="font-size:.8rem">${escapeHtml(c.phone_number)}</span><button class="button secondary mini-button" type="button" data-bc-send="${escapeHtml(c.phone_number)}">📲 إرسال</button></div>`)
    .join("");
  return `
    <details class="panel" style="margin:12px 0" ${sel ? "open" : ""}>
      <summary style="cursor:pointer;font-weight:800">📲 إرسال جماعي للزبائن حسب التصنيف</summary>
      <div style="margin-top:10px;display:grid;gap:10px">
        <label>التصنيف
          <select data-bc-type>
            <option value="">— اختر تصنيف —</option>
            ${types.map((t) => `<option value="${escapeHtml(t)}" ${t === sel ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
          </select>
        </label>
        <label>نص الرسالة
          <textarea data-bc-text rows="3" placeholder="اكتب الرسالة (مثلاً: رابط نشرة الأسعار، أو تنبيه)...">${escapeHtml(state.broadcastText || "")}</textarea>
        </label>
        ${sel
          ? `<p class="muted">${inGroup.length} زبون بتصنيف «${escapeHtml(sel)}». اضغط «إرسال» جنب كل زبون — بيفتح واتساب جاهز بالرسالة.</p>${rows || '<p class="muted">لا يوجد زبائن بأرقام في هذا التصنيف.</p>'}`
          : '<p class="muted">اختر تصنيف لعرض زبائنه.</p>'}
      </div>
    </details>`;
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
  try {
    state.customerInvoicesReport = dataStore.getCustomerInvoicesReport
      ? await dataStore.getCustomerInvoicesReport()
      : null;
  } catch {
    state.customerInvoicesReport = null;
  }
  await loadCustomerWhatsapp();
}

// فواتير زبون محدّد مع محتوياتها (من تقرير ameen_customer_invoices، بمطابقة ذكية للاسم)
function customerInvoicesFor(name) {
  const report = state.customerInvoicesReport;
  const items = report && Array.isArray(report.items) ? report.items : [];
  const match = smartNameMatch(items, (it) => it.name, name);
  return match && Array.isArray(match.invoices) ? match.invoices : [];
}

// مطابقة قيد دائن (دفعة محتملة) بفاتورة مرتجع فعلية بالتاريخ والمبلغ — قيود المرتجع في الأمين
// لا تحمل معرّف الفاتورة (BiGUID) كالفواتير العادية، فلا مطابقة قطعية ممكنة هنا.
function findReturnInvoiceForMovement(custName, movement) {
  const credit = Number(movement?.credit || 0);
  if (!(credit > 0)) return null;
  const invs = customerInvoicesFor(custName).filter((x) => x.isReturn);
  if (!invs.length) return null;
  const dOnly = String(movement?.date || "").slice(0, 10);
  const amtMatch = (x) => Math.abs(Number(x.total || 0) - credit) < 1;
  const dateMatch = (x) => String(x.date || "").slice(0, 10) === dOnly;
  return invs.find((x) => dateMatch(x) && amtMatch(x)) || invs.find((x) => amtMatch(x)) || null;
}

// كمية سطر الفاتورة بشكل مقروء (نفضّل الوحدة الأكبر إن وُجدت).
// لا نعرض سعر/إجمالي السطر لأن أرقام الأسطر المفردة بمصدر الأمين غير دقيقة
// (مجموعها لا يطابق إجمالي الفاتورة)؛ الموثوق هو إجمالي الفاتورة فقط.
function invoiceLineQty(line) {
  const u1 = String(line?.unit1 || "").trim();
  const u2 = String(line?.unit2 || "").trim();
  const qty = Number(line?.qty || 0);
  const qtyUnits = Number(line?.qtyUnits || 0);
  if (qtyUnits > 0 && u2) {
    const detail = qty > 0 && u1 && (qty !== qtyUnits || u1 !== u2) ? ` (${formatMoney(qty)} ${u1})` : "";
    return `${formatMoney(qtyUnits)} ${u2}${detail}`;
  }
  if (qty > 0) return `${formatMoney(qty)} ${u1}`.trim();
  return "—";
}

// الأمين يسجّل سعر السطر بحسب طريقة إدخال الفاتورة: بعض الفواتير أسعارها للكرتونة
// وبعضها للكروز (الوحدة الأساسية) — يختلف من فاتورة لأخرى. نحسم أساس السعر لكل فاتورة
// بمطابقة مجموع (السعر × الكمية) بكلا الأساسين مع إجمالي الفاتورة (الرقم الموثوق من الأمين):
// الأقرب للإجمالي هو الأساس الصحيح. يرجع "unit1" (كروز) أو "unit2" (كرتونة/شرحة/طرد).
function invoicePriceBasis(inv) {
  const lines = Array.isArray(inv?.lines) ? inv.lines : [];
  const total = Number(inv?.total || 0);
  if (!(total > 0) || !lines.length) return "unit2";
  let sumBase = 0, sumUnits = 0;
  for (const l of lines) {
    const p = Number(l?.price || 0);
    sumBase += p * Number(l?.qty || 0);
    sumUnits += p * Number(l?.qtyUnits || 0);
  }
  return Math.abs(sumBase - total) <= Math.abs(sumUnits - total) ? "unit1" : "unit2";
}

// سعر الوحدة معروضاً دائماً بالوحدة الكبرى (كرتونة/شرحة/طرد): إن كان أساس أسعار الفاتورة
// الكروز نضرب بمعامل الوحدة (كمية الكروز ÷ كمية الكراتين لنفس السطر)، وإلا نعرضه كما هو.
function invoiceLinePrice(line, inv) {
  const price = Number(line?.price || 0);
  if (!(price > 0)) return "—";
  const u1 = String(line?.unit1 || "").trim();
  const u2 = String(line?.unit2 || "").trim();
  const qty = Number(line?.qty || 0);
  const qtyUnits = Number(line?.qtyUnits || 0);
  const factor = qty > 0 && qtyUnits > 0 ? qty / qtyUnits : 0;
  if (inv && u2 && factor > 0 && invoicePriceBasis(inv) === "unit1") {
    return `${formatMoney(roundPrice(price * factor))} $ / ${u2}`;
  }
  const unit = qtyUnits > 0 && u2 ? u2 : u1;
  return `${formatMoney(price)} $${unit ? " / " + unit : ""}`;
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
    await loadPurchaseInvoices();
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
    state.purchaseInvoices = [];
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
  setNotice("success", "تم تصدير ملف CSV قابل للفتح في إكسل وتجهيزه كخطوة أولى للتوافق مع الأمين.");
  render();
}

function assertExcelSupport() {
  if (!window.XLSX) {
    throw new Error("مكتبة قراءة إكسل لم تتحمل بعد. حدث الصفحة ثم جرب مرة أخرى.");
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
  if (index === -1) throw new Error("لم أجد عمود اسم المادة داخل ملف إكسل.");
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
    const report = await buildInventoryReport(stockFile, priceFile, threshold, latestStockReport());
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

// أحدث تقرير جرد حقيقي: نتعرّف عليه بشكل عناصره (فيها stockQty) لا بترتيبه فقط،
// كي لا يُزيحه تقرير آخر (فواتير/مصاريف/حركات) خُزّن بنفس جدول inventory_reports.
function latestStockReport() {
  const reports = Array.isArray(state.inventoryReports) ? state.inventoryReports : [];
  return reports.find((r) => reportItems(r).some((it) => it && ("stockQty" in it || "stockQtyPositive" in it)))
    || null;
}

function liveAvailableItems() {
  return reportItems(latestStockReport()).filter((item) => itemQty(item) > 0);
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
  const latest = latestStockReport();
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
    const latest = latestStockReport();
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
  return consolidateGeneralPriceItems(items);
}

function isWazariPriceItem(item) {
  const name = normalizeItemName(item.name || item.itemName || "");
  if (name.includes("نخله") && (name.includes("محزر") || name.includes("وزاري"))) return true;
  if (name.includes("كينت") && !name.includes("حره")) return true;
  if (name.includes("وينستون") && !name.includes("حره")) return true;
  if (name.includes("فاخر") && name.includes("اسود") && name.includes("محزر")) return true;
  if (
    name.includes("مالبورو") &&
    (name.includes("محزر") ||
      (name.includes("ورق") && (name.includes("ابيض") || name.includes("احمر"))) ||
      (name.includes("كوين") && name.includes("ازرق")))
  ) return true;
  return false;
}

function hasFullSecondUnit(item) {
  const factor = itemUnit2Factor(item);
  return factor > 0 && itemQty(item) / factor >= 1;
}

function shishaPriceLabel(item) {
  const name = normalizeItemName(item.name || item.itemName || "");
  if (name.includes("مزايا")) return name.includes("كف") ? "مزايا كف" : "مزايا مشكل";
  if (name.includes("اسطوره")) return "أسطورة مشكل";
  if (name.includes("معسل روز")) return "روز مشكل";
  if (name.includes("صفوه")) return "صفوة جميع النكهات";
  if (name.includes("فاخر")) {
    if (name.includes("اسود") && name.includes("كف")) return "فاخر أسود كف";
    if (name.includes("اسود")) return "فاخر أسود كروز";
    if (name.includes("احمر")) return "فاخر أحمر كروز";
    return "فاخر نكهات";
  }
  return item.name || item.itemName || "";
}

function isGeneralShishaPriceItem(item) {
  const group = normalizeItemName(item.groupName || "");
  const name = normalizeItemName(item.name || item.itemName || "");
  return ["معسل", "مزايا", "نخله"].some((word) => group.includes(word)) ||
    ["معسل", "مزايا", "نخله", "فاخر", "صفوه", "اسطوره"].some((word) => name.includes(word));
}

function consolidateGeneralPriceItems(items) {
  const regular = [];
  const merged = new Map();
  items.filter((item) => !isWazariPriceItem(item)).forEach((item) => {
    const normalizedName = normalizeItemName(item.name || item.itemName || "");
    if (isGeneralShishaPriceItem(item) && /100\s*غ/u.test(normalizedName)) return;
    if (!isGeneralShishaPriceItem(item) || normalizedName.includes("نخله")) {
      regular.push(item);
      return;
    }
    const label = shishaPriceLabel(item);
    const existing = merged.get(label);
    if (existing) {
      existing.sourceKeys.push(item.key);
      return;
    }
    merged.set(label, {
      ...item,
      name: label,
      itemName: label,
      groupName: "معسل",
      sourceKeys: [item.key].filter(Boolean)
    });
  });
  return mergeBulletinNamedGroups([...regular, ...merged.values()]);
}

function isMazayaPriceItem(item) {
  const groupName = normalizeItemName(item.groupName || "");
  const itemName = normalizeItemName(item.name || item.itemName || "");
  return groupName.includes("مزايا") || itemName.includes("مزايا");
}

// المزايا 100غ مستبعدة من النشرة (طلب الإدارة): لا تظهر ولا تؤثّر على سعر المزايا
function isMazaya100g(item) {
  return String(item.name || item.itemName || "").includes("100");
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
    const merged = {
      ...rep,
      name: display,
      itemName: display,
      sourceKeys: matches.map((it) => it.key).filter(Boolean)
    };
    result = result.filter((it) => !matches.includes(it));
    result.push(merged);
  });
  return result.sort(
    (a, b) =>
      String(a.groupName || "").localeCompare(String(b.groupName || ""), "ar") ||
      String(a.name || "").localeCompare(String(b.name || ""), "ar")
  );
}

// أسعار سطري المزايا: تُؤخذ تلقائيًا من النظام (صفحة الأسعار).
// القيمتان التاليتان احتياطيتان فقط — تُستعمل إذا لم يوجد سعر مُدخَل في النظام.
const MAZAYA_MIX_PRICE = 132;       // مزايا مشكل (شرحة) — احتياطي عند غياب السعر
const MAZAYA_BAHRAINI_PRICE = 135;  // مزايا بحريني (شرحة) — احتياطي عند غياب السعر
const MAZAYA_UNIT2_FACTOR = 12;     // عدد الكروز في شرحة المزايا (لقسمة سعر المفرق على الكروز)

function mergeMazayaPriceItems(items) {
  const allMazaya = items.filter(isMazayaPriceItem);
  if (!allMazaya.length) return items;
  // نستبعد المزايا 100غ نهائيًا من النشرة (لا تظهر ولا تؤثّر على السعر)
  const mazayaItems = allMazaya.filter((it) => !isMazaya100g(it));

  // مزايا مشكل = كل النكهات (أي صنف مزايا ليس بحرينيًا)
  const isBahrainiItem = (it) => normalizeItemName(it.name || it.itemName || "").includes("بحريني");
  const bahrainiItems = mazayaItems.filter(isBahrainiItem);
  const mixItems = mazayaItems.filter((it) => !isBahrainiItem(it));

  // السعر (الجملة) تلقائي من أول صنف مُسعّر؛ والقيمة الثابتة احتياط فقط.
  // نختار صنف المصدر الذي يملك سعر مفرق (retail) حتى يظهر السطر في نشرة المفرق،
  // ونثبّت عدد الكروز بالشرحة = 12 لتُقسم نشرة المفرق على الكروز.
  const base = mazayaItems[0];
  const hasRetailPrice = (it) =>
    Number(it && it.approvedPrice && it.approvedPrice.pricePayload && it.approvedPrice.pricePayload.retail && it.approvedPrice.pricePayload.retail.price) > 0;
  const makeMazayaLine = (name, key, srcItems, fallbackPrice) => {
    const priced = srcItems.find((it) => Number(it.unit2Price) > 0);
    const price = priced ? Number(priced.unit2Price) : fallbackPrice;
    const src = srcItems.find(hasRetailPrice) || priced || srcItems[0] || base;
    return {
      ...src,
      key,
      sourceKeys: srcItems.map((it) => it.key).filter(Boolean),
      name,
      itemName: name,
      groupName: "مزايا",
      unit1Name: "كروز",
      unit1Price: 0,
      unit2Name: "شرحة",
      unit2Factor: MAZAYA_UNIT2_FACTOR,
      unit2Price: price,
      salePrice: price
    };
  };

  const mazayaLines = [];
  if (mixItems.length) mazayaLines.push(makeMazayaLine("مزايا مشكل", "mazaya-mix", mixItems, MAZAYA_MIX_PRICE));
  if (bahrainiItems.length) mazayaLines.push(makeMazayaLine("مزايا بحريني", "mazaya-bahraini", bahrainiItems, MAZAYA_BAHRAINI_PRICE));

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
    sourceKeys: ostora.map((it) => it.key).filter(Boolean),
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

// أهم المجموعات تظهر أول النشرة/التقرير دائمًا (طلب الإدارة). أضِف مجموعات هنا بالترتيب المطلوب.
const PRIORITY_PRICE_GROUPS = ["غلواز", "ماستر"];

// رتبة المجموعة حسب الأولوية: 0 لأول مجموعة أولوية، فالأكبر لغير الأولوية (تُرتَّب بعدها أبجديًا).
function priorityGroupRank(name) {
  const n = normalizeItemName(name || "");
  const i = PRIORITY_PRICE_GROUPS.findIndex((g) => n.includes(normalizeItemName(g)));
  return i === -1 ? PRIORITY_PRICE_GROUPS.length : i;
}

function orderPriorityGroups(groups) {
  return [...groups].sort(
    (a, b) => priorityGroupRank(a.name) - priorityGroupRank(b.name) || String(a.name || "").localeCompare(String(b.name || ""), "ar")
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

let bulletinPublishTimer = null;

function scheduleBulletinPublish() {
  clearTimeout(bulletinPublishTimer);
  if (!localStorage.getItem("gh_publish_token")) {
    state.bulletinStatus = { type: "muted", msg: "حُفظ السعر. اضغط «اعتماد ونشر» مرة واحدة لتفعيل النشر التلقائي على هذا الجهاز." };
    return;
  }
  state.bulletinStatus = { type: "muted", msg: "حُفظ السعر — ستُحدّث النشرة تلقائياً بعد انتهاء تعديلاتك." };
  bulletinPublishTimer = setTimeout(() => publishBulletin({ storedTokenOnly: true }), 15000);
}

async function publishBulletin(options = {}) {
  const REPO = "fhwvtqdc2q-svg/tobacco-web";
  const WORKFLOW = "generate-price-lists.yml";
  const rateInput = document.querySelector("[data-published-exchange-rate]");
  const rate = Number(rateInput?.value || state.syriaExchangeRate || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    setNotice("error", "أدخل سعر صرف صحيح قبل نشر النشرة.");
    render();
    return;
  }
  state.syriaExchangeRate = rate;
  writeJson("syria-exchange-rate", rate);

  let token = localStorage.getItem("gh_publish_token");
  if (!token) {
    if (options.storedTokenOnly) return;
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
        body: JSON.stringify({ ref: "main", inputs: { rate: String(rate) } }),
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
  const latest = latestStockReport();
  let items = customerPriceListItems();

  if (!useSyria) items = items.filter(hasFullSecondUnit);

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

function pricingWorklistItems({ ignoreSearch = false } = {}) {
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
      if (ignoreSearch || !query) return true;
      return String(item.key || "").includes(query) || normalizeItemName(item.name).includes(query);
    })
    .sort((a, b) => Number(a.hasApprovedPrice) - Number(b.hasApprovedPrice) || String(a.name || "").localeCompare(String(b.name || ""), "ar"));
}

// قائمة العمل داخل الموقع تطابق النشرة العامة: الوزاري منفصل والدمج ظاهر كما يراه الزبون.
// حد الوحدة الثانية يخص الجملة فقط؛ المفرق السوري يبقى متاحاً لأي مخزون موجب حسب القاعدة المعتمدة.
function generalPricingWorklistItems() {
  const allItems = pricingWorklistItems({ ignoreSearch: true });
  const items = pricingWorklistItems()
    .filter((item) => state.priceMode === "mufrak" ? itemQty(item) > 0 : hasFullSecondUnit(item));
  const consolidated = consolidateGeneralPriceItems(items);

  // شرط الكرتونة الكاملة يحدد ظهور الصنف في نشرة الجملة فقط، ولا يجوز أن
  // يمنع تحديث سعر بقية أصناف المجموعة المدمجة ذات المخزون الموجب.
  return consolidated.map((item) => {
    if (!Array.isArray(item.sourceKeys) || !item.sourceKeys.length) return item;
    const label = normalizeItemName(item.name || item.itemName || "");
    const groupKeys = allItems
      .filter((candidate) => {
        const candidateName = normalizeItemName(candidate.name || candidate.itemName || "");
        return !isWazariPriceItem(candidate) &&
          isGeneralShishaPriceItem(candidate) &&
          !/100\s*غ/u.test(candidateName) &&
          normalizeItemName(shishaPriceLabel(candidate)) === label;
      })
      .map((candidate) => candidate.key)
      .filter(Boolean);
    return { ...item, sourceKeys: [...new Set([...item.sourceKeys, ...groupKeys])] };
  });
}

function downloadDailyPricingWorklist() {
  const latest = latestStockReport();
  const items = generalPricingWorklistItems();
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
    const latest = latestStockReport();
    const itemKey = form.dataset.itemKey || "";
    const sourceKeys = JSON.parse(form.dataset.sourceKeys || "[]").filter(Boolean);
    const itemName = form.dataset.itemName || "";
    const latestItem = reportItems(latest).find((item) => {
      const key = item.key || normalizeItemName(item.name);
      return key === itemKey || sourceKeys.includes(key);
    });
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

    const existing = approvedPriceMap().get(itemKey) || approvedPriceMap().get(sourceKeys[0]);
    const basePayload = (existing && existing.pricePayload) || {};
    let unit2Price, salePrice, payloadObj, savedLabel;

    if (mode === "mufrak") {
      unit2Price = Number((existing && existing.unit2Price) || 0);
      // سعر المفرق مستقل عن الجملة: إن لم يوجد سعر جملة نحفظ سعراً مرجعياً للوحدة الأولى
      // كي يبقى السجل صالحاً في Supabase، بينما تعتمد نشرة السوري على retail.price حصراً.
      salePrice = Number((existing && existing.salePrice) || roundPrice((unit2Price > 0 ? unit2Price : entered) / unit2Factor));
      payloadObj = { ...basePayload, retail: { price: entered }, source: "phone_pricing_page", pricedDate: todayIsoDate() };
      savedLabel = `سعر المفرق ${formatMoney(entered)}$ لل${unit2Name || "كرتونة"} (≈ ${formatMoney(roundPrice(entered / unit2Factor))}$ لل${unit1Name || "كروز"})`;
    } else {
      unit2Price = entered;
      salePrice = roundPrice(entered / unit2Factor);
      payloadObj = { ...basePayload, source: "phone_pricing_page", pricedUnit: "unit2", pricedDate: todayIsoDate() };
      savedLabel = `سعر الجملة ${formatMoney(entered)}$`;
    }

    const requestedKeys = sourceKeys.length ? sourceKeys : [itemKey];
    const normalizedTargets = new Set(requestedKeys.map(normalizeItemName));
    // وحّد كل aliases القديمة للاسم نفسه (همزة/تاء مربوطة/نقاط) بالسعر الجديد.
    // بذلك لا تستطيع مزامنة المخزون إعادة سعر قديم إلى النشرة لاحقاً.
    const aliasKeys = (state.approvedPriceItems || [])
      .filter((price) => normalizedTargets.has(normalizeItemName(price.itemKey)) || normalizedTargets.has(normalizeItemName(price.itemName)))
      .map((price) => price.itemKey)
      .filter(Boolean);
    const targetKeys = [...new Set([...requestedKeys, ...aliasKeys])];
    const records = targetKeys.map((targetKey) => {
      const sourceItem = reportItems(latest).find((item) => (item.key || normalizeItemName(item.name)) === targetKey) || latestItem;
      const sourceExisting = approvedPriceMap().get(targetKey);
      const sourceFactor = Math.max(1, itemUnit2Factor(sourceItem));
      const sourceUnit2Price = mode === "mufrak" ? Number(sourceExisting?.unit2Price || unit2Price) : entered;
      const sourceSalePrice = Number(
        sourceExisting?.salePrice || roundPrice((sourceUnit2Price > 0 ? sourceUnit2Price : entered) / sourceFactor)
      );
      const sourcePayload = mode === "mufrak"
        ? { ...(sourceExisting?.pricePayload || {}), retail: { price: entered }, source: "phone_pricing_page", pricedDate: todayIsoDate() }
        : payloadObj;
      return {
        itemKey: targetKey,
        itemName: sourceItem?.name || itemName,
        unit1Name: itemUnit1Name(sourceItem) || unit1Name,
        unit2Name: itemUnit2Name(sourceItem) || unit2Name,
        unit2Factor: sourceFactor,
        unit2Price: sourceUnit2Price,
        unit1Price: mode === "mufrak" ? sourceSalePrice : roundPrice(entered / sourceFactor),
        salePrice: mode === "mufrak" ? sourceSalePrice : roundPrice(entered / sourceFactor),
        stockQty: itemQty(sourceItem),
        stockStatus: sourceItem?.status || stockStatus,
        sourceReportId: uuidOrNull(latest.id),
        sourceSyncedAt: reportSyncedAt(latest),
        pricePayload: sourcePayload
      };
    });
    const saved = await dataStore.upsertApprovedPriceItems(records);

    if (!saved || !Array.isArray(saved)) {
      throw new Error("لم يتم استقبال تأكيد الحفظ من قاعدة البيانات. تأكد من الاتصال والصلاحيات.");
    }

    const priceMap = approvedPriceMap();
    saved.forEach((item) => priceMap.set(item.itemKey, item));
    state.approvedPriceItems = [...priceMap.values()].sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || ""), "ar"));
    const mergedLabel = records.length > 1 ? ` على ${records.length} أصناف مدمجة` : "";
    setNotice("success", `✓ تم حفظ ${savedLabel}: ${itemName}${mergedLabel}`);
    scheduleBulletinPublish();
    render();
    return true;
  } catch (error) {
    setNotice("error", safeErrorMessage(error));
    render();
    return false;
  }
}

function downloadLatestInventoryReport() {
  const latest = latestStockReport();
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
  const latest = latestStockReport();
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
    <div class="app-shell route-${escapeHtml(state.route)}">
      <aside class="sidebar" aria-label="التنقل">
        <a class="brand" href="#" data-route="overview" aria-label="الرئيسية">
          <img src="public/icons/ozk-logo.png" alt="">
          <span>${escapeHtml(appConfig.name)}</span>
        </a>
        <nav>
          ${navButton("overview", "🏠 الرئيسية")}
          ${state.session ? navButton("dashboard", "📑 التقارير") : ""}
          ${navButton("login", "🔑 تسجيل الدخول")}
          ${navButton("ameen", "📦 الأمين")}
          ${state.session ? navButton("balances", "💳 أرصدة الزبائن") : ""}
          ${navButton("pricing", "نشرة الأسعار")}
          ${state.session ? navButton("invoice", "📄 الفواتير") : ""}
          ${state.session ? navButton("sales", "🧮 فاتورة مبيعات") : ""}
          ${state.session ? navButton("purchases", "🧾 فواتير مشتريات") : ""}
          ${state.session ? navButton("staff", "👥 الموظفون") : ""}
          ${state.session ? navButton("ai", "🤖 المساعد الذكي") : ""}
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
    balances: "أرصدة الزبائن والحد المسموح",
    pricing: "نشرة الأسعار",
    remote: "الإدارة عن بعد",
    monitoring: "المراقبة",
    payments: "الدفع",
    ai: "المساعد الذكي",
    invoice: "الفواتير بالدولار",
    sales: "فاتورة مبيعات",
    purchases: "فواتير المشتريات",
    dashboard: "التقارير",
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
            <strong>${dataStore.isConfigured() ? "مباشر" : "تجريبي"}</strong>
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
            <button class="button secondary compact-button" type="button" data-action="export-monthly">📥 التقرير الشهري (إكسل)</button>
            <button class="button secondary compact-button" type="button" data-action="export-ameen">تصدير للأمين</button>
          </div>
        </div>
        <p class="muted">يُصدر الملف بصيغة CSV قابلة للفتح في إكسل. عند معرفة قالب استيراد الأمين لديك نطابق الأعمدة معه بدقة.</p>
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
    sorted.sort((a, b) => customerBalanceSortValue(b) - customerBalanceSortValue(a));
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
      <form class="pricing-editor" data-form="pricing-item" data-item-key="${escapeHtml(item.key)}" data-source-keys="${escapeHtml(JSON.stringify(item.sourceKeys || []))}" data-item-name="${escapeHtml(item.name || "")}" data-stock-qty="${escapeHtml(qty)}" data-stock-status="${escapeHtml(item.status || "")}" data-unit1-name="${escapeHtml(unit1Name)}" data-unit2-name="${escapeHtml(unit2Name)}" data-unit2-factor="${escapeHtml(unit2Factor)}">
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
  const latest = latestStockReport();
  const items = generalPricingWorklistItems();
  const allAvailable = liveAvailableItems();
  const approvedCount = items.filter((item) => item.hasApprovedPrice || item.unit2Price > 0 || item.salePrice > 0).length;
  const waiting = Math.max(0, items.length - approvedCount);
  const syncedAt = reportSyncedAt(latest);
  const emptyText =
    dataStore.isConfigured() && !state.session
      ? "سجل الدخول أولاً حتى تظهر مواد التسعير ويتم الحفظ في Supabase."
      : "لا توجد مواد متوفرة أو مطابقة للبحث الحالي.";
  const authHint =
    dataStore.isConfigured() && !state.session
      ? '<p class="muted">سجل الدخول حتى تحفظ الأسعار في Supabase وتصل إلى جهاز المحاسبة.</p>'
      : "";
  const generalCount = customerPriceListItems().length;
  const publishState = state.bulletinStatus?.type === "error" ? "تحتاج مراجعة" : "جاهزة للنشر";

  return shell(`
    <section class="newsletter-hub">
      <div class="newsletter-hero">
        <div class="newsletter-hero-copy">
          <span class="newsletter-kicker">OZK TOBACCO</span>
          <h2>مركز نشرة الأسعار</h2>
          <p>حدّث المخزون، راجع الأسعار، عاين النشرات وانشرها للزبائن من مكان واحد.</p>
        </div>
        <div class="newsletter-hero-status">
          <span>حالة النشرة</span>
          <strong>${escapeHtml(publishState)}</strong>
          <small>آخر جرد: ${escapeHtml(formatDateTime(syncedAt))}</small>
        </div>
      </div>

      <div class="newsletter-steps" aria-label="مراحل تجهيز النشرة">
        <div class="newsletter-step is-ready"><span>1</span><strong>تحديث المخزون</strong><small>مزامنة الأمين</small></div>
        <div class="newsletter-step is-current"><span>2</span><strong>مراجعة الأسعار</strong><small>${escapeHtml(waiting)} بحاجة تسعير</small></div>
        <div class="newsletter-step"><span>3</span><strong>معاينة النشرة</strong><small>دولار وسوري</small></div>
        <div class="newsletter-step"><span>4</span><strong>اعتماد ونشر</strong><small>رابط الزبائن</small></div>
      </div>

      <div class="newsletter-metrics">
        ${inventoryMetric("مواد المخزون", allAvailable.length, "من آخر جرد حي")}
        ${inventoryMetric("أسعار معتمدة", approvedCount, "محفوظة للمحاسبة")}
        ${inventoryMetric("بحاجة تسعير", waiting, "تحتاج المراجعة")}
        ${inventoryMetric("مواد النشرة", generalCount, "جاهزة للمعاينة")}
      </div>

      <section class="newsletter-editions" aria-labelledby="newsletter-editions-title">
        <div class="newsletter-section-head">
          <div><span>المعاينة النهائية</span><h3 id="newsletter-editions-title">اختر النشرة</h3></div>
          <a class="newsletter-public-link" href="public/downloads/" target="_blank" rel="noopener">فتح صفحة الزبائن</a>
        </div>
        <div class="newsletter-edition-grid">
          <article class="newsletter-edition-card is-featured">
            <span class="newsletter-edition-type">جملة</span><h4>نشرة الدولار</h4><p>الكرتونة أو الطرد أو الشرحة الكاملة فقط.</p>
            <div><a href="public/downloads/price-list-usd.html">اختيار اللون</a><a href="public/downloads/price-list-usd.pdf">داكن</a><a href="public/downloads/price-list-usd-light.pdf">فاتح</a></div>
          </article>
          <article class="newsletter-edition-card">
            <span class="newsletter-edition-type">مفرق</span><h4>نشرة السوري</h4><p>المواد ذات المخزون الموجب وفق سعر الصرف المعتمد.</p>
            <div><a href="public/downloads/price-list-syp-14050.html">اختيار اللون</a><a href="public/downloads/price-list-syp-14050.pdf">داكن</a><a href="public/downloads/price-list-syp-14050-light.pdf">فاتح</a></div>
          </article>
          <article class="newsletter-edition-card">
            <span class="newsletter-edition-type">وزاري جملة</span><h4>الوزاري بالدولار</h4><p>الأصناف الوزارية والمحزّرة المتوفرة بالجملة.</p>
            <div><a href="public/downloads/price-list-wazari-usd.html">اختيار اللون</a><a href="public/downloads/price-list-wazari-usd.pdf">داكن</a><a href="public/downloads/price-list-wazari-usd-light.pdf">فاتح</a></div>
          </article>
          <article class="newsletter-edition-card">
            <span class="newsletter-edition-type">وزاري مفرق</span><h4>الوزاري بالسوري</h4><p>نسخة المفرق المستقلة للأصناف الوزارية.</p>
            <div><a href="public/downloads/price-list-wazari-syp-14050.html">اختيار اللون</a><a href="public/downloads/price-list-wazari-syp-14050.pdf">داكن</a><a href="public/downloads/price-list-wazari-syp-14050-light.pdf">فاتح</a></div>
          </article>
        </div>
      </section>

      <section class="newsletter-command" aria-labelledby="newsletter-command-title">
        <div class="newsletter-section-head">
          <div><span>العمل اليومي</span><h3 id="newsletter-command-title">تحديث، مراجعة، نشر</h3></div>
          <span class="status-chip">${state.session ? "متصل بالحساب" : "يلزم تسجيل الدخول للنشر"}</span>
        </div>
        <div class="newsletter-primary-actions">
          <button class="button secondary" type="button" data-action="refresh-ameen">تحديث المخزون</button>
          <label style="display:flex;align-items:center;gap:8px;font-weight:700">سعر الصرف اليوم
            <input data-published-exchange-rate type="number" min="1" step="1" value="${escapeHtml(state.syriaExchangeRate)}" style="width:120px;padding:8px;border:1px solid var(--line);border-radius:8px" aria-label="سعر صرف الليرة السورية مقابل الدولار">
          </label>
          <a class="button primary" href="public/downloads/price-list-usd.html">اختيار وطباعة الدولار</a>
          <a class="button primary" href="public/downloads/price-list-syp-14050.html">اختيار وطباعة السوري</a>
          <button class="button success" type="button" data-action="publish-bulletin" ${state.session ? "" : "disabled"}>اعتماد ونشر للزبائن</button>
        </div>
        ${state.bulletinStatus ? `<p class="bulletin-status ${state.bulletinStatus.type}">${escapeHtml(state.bulletinStatus.msg)}</p>` : ""}
      </section>

      <section class="panel wide inventory-browser newsletter-pricing-panel">
      <div class="panel-title-row inventory-browser-head">
        <div>
          <span class="newsletter-section-label">مراجعة المواد</span>
          <h3>أسعار النشرة</h3>
          <p class="muted">تظهر هنا النشرة العامة فقط بعد استبعاد الوزاري ودمج الأصناف المتشابهة. بعد حفظ الأسعار تُحدّث النشرة تلقائياً خلال لحظات.</p>
        </div>
        <span class="status-chip">${escapeHtml(approvedCount)} سعر معتمد</span>
      </div>
      ${authHint}
      ${state.approvedPriceError ? `<p class="muted">تنبيه الأسعار: ${escapeHtml(state.approvedPriceError)}</p>` : ""}
      <div class="currency-toggle" role="group">
        <button type="button" class="ctgl ${state.priceMode === "mufrak" ? "" : "active"}" data-mode="jumla">أسعار الجملة بالدولار</button>
        <button type="button" class="ctgl ${state.priceMode === "mufrak" ? "active" : ""}" data-mode="mufrak">أسعار المفرق بالسوري</button>
      </div>
      <div class="inventory-controls">
        <label>
          البحث ضمن مواد النشرة
          <input data-pricing-search value="${escapeHtml(state.pricingSearch)}" placeholder="اكتب اسم المادة أو المجموعة">
        </label>
      </div>
      <div class="inventory-list inventory-list-dense pricing-list" data-pricing-results>
        ${items.length ? groupedAccordion("pricing", items, { groupOf: (i) => i.groupName, rowOf: pricingRow, query: state.pricingSearch }) : `<p class="muted">${escapeHtml(emptyText)}</p>`}
      </div>
      <details class="newsletter-tools">
        <summary>أدوات وتقارير إضافية</summary>
        <div class="button-row report-actions">
          <button class="button secondary" type="button" data-action="download-daily-pricing" ${items.length ? "" : "disabled"}>قائمة تسعير اليوم</button>
          <button class="button secondary" type="button" data-action="report-inventory">تقرير المخزون PDF</button>
          <button class="button secondary" type="button" data-action="download-price-template" ${allAvailable.length ? "" : "disabled"}>قالب إكسل</button>
          <button class="button secondary" type="button" data-action="download-approved-prices" ${state.approvedPriceItems.length ? "" : "disabled"}>أسعار المحاسبة</button>
        </div>
        <form class="form-card compact" data-form="live-price-import">
          <label>رفع ملف تسعير كامل<input name="livePrice" type="file" accept=".xlsx,.xls,.csv"></label>
          <button class="button primary" type="submit" ${allAvailable.length ? "" : "disabled"}>اعتماد ملف الأسعار</button>
        </form>
      </details>
      </section>
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
.ozk-rpt{font-family:Tahoma,Arial,sans-serif;color:#221808;background:#fff;direction:rtl;padding:6px 10px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ozk-rpt .rhead{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #b8892a;padding-bottom:8px;margin-bottom:12px}
.ozk-rpt .brand{font-weight:900;font-size:19px}.ozk-rpt .brand small{display:block;font-weight:400;font-size:10px;color:#6b5535}
.ozk-rpt .rtitle{flex:1;text-align:right;white-space:nowrap;padding-right:14px}.ozk-rpt .rtitle h2{margin:0;font-size:16px;color:#b8892a;white-space:nowrap}.ozk-rpt .rtitle span{font-size:10px;color:#6b5535;white-space:nowrap}
.ozk-rpt .balbox{background:#f6ead0;border:1px solid #b8892a;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ozk-rpt .balbox .nm{font-weight:900;font-size:15px}.ozk-rpt .balbox .big{font-size:24px;font-weight:900;color:#c0271f}
.ozk-rpt .muted{color:#6b5535;font-size:10.5px}
.ozk-rpt .sec{font-weight:800;font-size:12.5px;margin:12px 0 4px}
.ozk-rpt table{width:100%;border-collapse:collapse;font-size:12px}
.ozk-rpt th{background:#ece6d4;padding:6px 8px;text-align:right;border:1px solid #c8b890;font-size:11px}
.ozk-rpt td{padding:5px 8px;border:1px solid #c8b890}
.ozk-rpt table{page-break-inside:auto}.ozk-rpt thead{display:table-header-group}.ozk-rpt tfoot{display:table-footer-group}.ozk-rpt tr{page-break-inside:avoid}.ozk-rpt .rhead,.ozk-rpt .balbox,.ozk-rpt .cards{page-break-inside:avoid}.ozk-rpt tr.closing td{background:#f6ead0;font-weight:800;border-top:2px solid #b8892a}
.ozk-rpt tr:nth-child(even) td{background:#faf6ec}
.ozk-rpt .deb{color:#c0271f;font-weight:700}.ozk-rpt .cred{color:#16794f;font-weight:700}
.ozk-rpt .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
.ozk-rpt .rcard{background:#ece6d4;border:1px solid #c8b890;border-radius:8px;padding:10px 12px;text-align:center}
.ozk-rpt .rcard .v{font-size:21px;font-weight:900}.ozk-rpt .rcard .l{font-size:10.5px;color:#6b5535}
.ozk-rpt .rcard .v.gold{color:#b8892a}.ozk-rpt .rcard .v.red{color:#c0271f}.ozk-rpt .rcard .v.green{color:#16794f}
.ozk-rpt .rlogo{height:46px;width:auto}
.ozk-rpt tr.open td{background:#ece6d4;font-weight:800}
.ozk-rpt .rfoot{margin-top:16px;border-top:1.5px solid #b8892a;padding-top:7px;font-size:10px;color:#6b5535;display:flex;justify-content:space-between}
.ozk-rpt .stamp-wrap{margin-top:16px;display:flex;justify-content:flex-start;page-break-inside:avoid}
.ozk-rpt .seal{border:2.5px solid #16357a;outline:1.5px solid #16357a;outline-offset:3px;border-radius:12px;color:#16357a;padding:9px 20px;text-align:center;transform:rotate(-5deg);opacity:.9;line-height:1.45}
.ozk-rpt .seal .s-name{font-size:15px;font-weight:900}
.ozk-rpt .seal .s-sub{font-size:12px;font-weight:700}
.ozk-rpt .seal .s-logo{font-size:18px;font-weight:900;letter-spacing:1px;margin:2px 0}
.ozk-rpt .seal .s-info{font-size:10.5px;font-weight:700}
.ozk-rpt .seal .s-addr{font-size:11px;font-weight:700;border-top:1px solid #16357a;margin-top:4px;padding-top:3px}
</style>`;

// نستعمل طباعة المتصفح الأصلية (حفظ بصيغة PDF) بدل html2canvas —
// المحرّك القديم صار يطلّع صفحات بيضا بعد تحديثات كروم. الطباعة الأصلية
// ترسم التقرير مثل الشاشة تماماً (عربي وألوان مظبوطة) ومستحيل تطلع فاضية.
async function exportReportPdf(bodyHtml, filename) {
  const title = String(filename || "تقرير").replace(/\.pdf$/i, "");
  const win = window.open("", "_blank");
  if (!win) {
    setNotice("error", "المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم جرّب مجددًا.");
    render();
    return;
  }
  const doc =
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<base href="' + window.location.href + '">' +
    '<title>' + title + '</title>' +
    '<style>@page{size:A4 portrait;margin:10mm}' +
    'html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'img{max-width:100%}table{page-break-inside:auto}tr{page-break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}' +
    '@media print{.ozk-rpt{padding:0}}</style>' +
    '</head><body>' + bodyHtml +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.focus();window.print();},450);};</scr' + 'ipt>' +
    '</body></html>';
  win.document.open();
  win.document.write(doc);
  win.document.close();
  setNotice("success", "افتح نافذة الطباعة واختر «حفظ بصيغة PDF».");
  render();
}

// يجلب حركات الزبون الكاملة (من تقرير ameen_customer_movements) بمطابقة الاسم
function customerFullMovements(item) {
  const report = state.customerMovementsReport;
  const items = Array.isArray(report?.items) ? report.items : [];
  const name = String(item?.name || "").trim();
  if (!name) return null;
  return items.find((x) => String(x.name || "").trim() === name) || null;
}

// قيد دفتر الأمين المرتبط بفاتورة محددة عبر معرّفها (BiGUID) — مطابقة قطعية بلا تخمين
// بالتاريخ/المبلغ، فتصحّ حتى مع الحسومات وتعدد فواتير اليوم الواحد. null إن لم تصل
// بيانات المزامنة المحدّثة بعد (فيرجع المستدعي للعرض الآمن: الرصيد الحالي فقط).
function movementForBill(custName, billGuid) {
  const g = String(billGuid || "").trim().toLowerCase();
  if (!g) return null;
  const report = state.customerMovementsReport;
  const items = report && Array.isArray(report.items) ? report.items : [];
  const match = smartNameMatch(items, (it) => it.name, custName);
  const movements = match && Array.isArray(match.movements) ? match.movements : [];
  return movements.find((m) =>
    String(m?.billGuid || "").trim().toLowerCase() === g
    && m.balance !== undefined && m.balance !== null
  ) || null;
}

// حركة الفاتورة في تقرير الحركات: نطابق بمعرّف القيد (GUID) إن وُجد وغير صفري، وإلا بالتاريخ
// والمبلغ على جهة المدين. سبب الاحتياط: قيود السنة الجديدة (AmnDb002 بعد التدوير) تأتي أحياناً
// بمعرّف صفري (00000000-...) فيفشل الربط بالمعرّف وحده.
function invoiceMovement(custName, inv) {
  const report = state.customerMovementsReport;
  const items = report && Array.isArray(report.items) ? report.items : [];
  const match = smartNameMatch(items, (it) => it.name, custName);
  const movements = match && Array.isArray(match.movements) ? match.movements : [];
  if (!movements.length) return null;
  const g = String(inv?.guid || "").trim().toLowerCase();
  const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
  if (g && g !== ZERO_GUID) {
    const byGuid = movements.find((m) => String(m?.billGuid || "").trim().toLowerCase() === g);
    if (byGuid) return byGuid;
  }
  const d = String(inv?.date || "").slice(0, 10);
  const total = Number(inv?.total || 0);
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i];
    if (d && String(m?.date || "").slice(0, 10) !== d) continue;
    if (Number(m?.debit || 0) > 0 && Math.abs(Number(m?.debit || 0) - total) <= 0.5) return m;
  }
  return null;
}

// الرصيد الزمني الحقيقي للحركة — يُفضَّل للمستندات المُرسَلة للزبون (فاتورة/سند) على `balance`
// الذي هو بترتيب كشف الأمين (المدين قبل الدائن) فيتضخّم إن جاءت دفعة بين فاتورتَي نفس اليوم.
function movementChronoBalance(m) {
  if (!m) return null;
  const c = m.balanceChrono;
  if (c !== undefined && c !== null && c !== "") return Number(c);
  if (m.balance !== undefined && m.balance !== null && m.balance !== "") return Number(m.balance);
  return null;
}

// رصيدا المستند: بعد/قبل **سند القيد كاملاً** (يشملان قيد الخصم المرافق للفاتورة بنفس السند،
// فلا يتضخّم الرصيد الجديد). يسقطان إلى الرصيد الزمني للسطر إن غابا (تقارير قبل تحديث المزامنة).
function movementDocBalances(m) {
  if (!m) return null;
  const dn = m.docNew, dp = m.docPrev;
  if (dn !== undefined && dn !== null && dn !== "" && dp !== undefined && dp !== null && dp !== "") {
    return { newBalance: Number(dn), prevBalance: Number(dp) };
  }
  const chrono = movementChronoBalance(m);
  if (chrono === null) return null;
  return { newBalance: chrono, prevBalance: chrono - Number(m.debit || 0) + Number(m.credit || 0) };
}

// الرصيد بعد قيد الحركة كما حسبه الأمين وخزّنه (الرصيد المتحرك الدقيق، يشمل القيد الافتتاحي
// وبترتيب الأمين). نطابق الحركة بالتاريخ والقيمة على الجهة الصحيحة (مدين للفاتورة، دائن للدفعة)
// ونُرجع رصيدها المُخزَّن. يُرجع null إن لم يتوفّر الرصيد المُخزَّن بعد (بيانات قبل تحديث المزامنة).
function movementBalanceAfter(custName, dateStr, debit, credit) {
  const report = state.customerMovementsReport;
  const items = report && Array.isArray(report.items) ? report.items : [];
  const match = smartNameMatch(items, (it) => it.name, custName);
  const movements = match && Array.isArray(match.movements) ? match.movements : [];
  const d = String(dateStr || "").slice(0, 10);
  const wantDebit = Number(debit || 0), wantCredit = Number(credit || 0);
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i];
    if (m.balance === undefined || m.balance === null) continue;
    if (d && String(m.date || "").slice(0, 10) !== d) continue;
    const sideOk = wantDebit > 0
      ? Math.abs(Number(m.debit || 0) - wantDebit) <= 0.5
      : Math.abs(Number(m.credit || 0) - wantCredit) <= 0.5;
    if (sideOk) return roundPrice(m.balance);
  }
  return null;
}

// الكشف الرسمي الكامل: رصيد أول المدة + كل حركات الفترة برصيد متحرك + الرصيد النهائي
function customerStatementPdfMarkup(item) {
  const key = customerKey(item);
  const profile = customerProfile(key);
  const phone = profile?.phone ? ` — هاتف: ${escapeHtml(profile.phone)}` : "";
  const lastD = customerLastPaymentDate(item);
  const full = customerFullMovements(item);
  const report = state.customerMovementsReport;
  const stmtNo = docNumber("ST");

  const header = `
    <div class="rhead">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="public/icons/ozk-logo.png" class="rlogo" alt="OZK" onerror="this.style.display='none'">
        <div class="brand">OZK TOBACCO<small>مركز أبو زياد — لتجارة الدخان</small></div>
      </div>
      <div class="rtitle"><h2>كشف حساب</h2><span>رقم: ${escapeHtml(stmtNo)} · ${escapeHtml(todayIsoDate())}</span></div>
    </div>
    <div class="balbox"><div><div class="nm">${escapeHtml(item.name || "")}</div>
      <div class="muted">آخر دفعة: ${lastD ? escapeHtml(String(lastD).slice(0, 10)) : "لا يوجد"}${phone}</div></div>
      <div style="text-align:left"><div class="muted">الرصيد المستحق</div><div class="big">${escapeHtml(formatMoney(customerBalance(item)))}</div></div></div>`;

  const footer = `
    <div class="rfoot">
      <span>هذا الكشف صادر آليًا عن نظام OZK TOBACCO</span>
      <span dir="ltr">0985000771 — 0984000662</span>
    </div>`;

  const stamp = `
    <div class="stamp-wrap"><div class="seal">
      <div class="s-name">مركز أبو زياد</div>
      <div class="s-sub">لتجارة الدخان</div>
      <div class="s-logo">OZK TOBACCO</div>
      <div class="s-info" dir="ltr">0985000771 - 0984000662 · رقم المركز: 0994092038</div>
      <div class="s-addr">دوما - ساحة الغنم</div>
    </div></div>`;

  if (full && Array.isArray(full.movements)) {
    const fromDate = report?.summary?.fromDate || "";
    const rows = [];
    let running = Number(full.openingBalance || 0);
    rows.push(`<tr class="open"><td>${escapeHtml(fromDate || "—")}</td><td colspan="2">رصيد أول المدة</td><td></td><td>${escapeHtml(formatMoney(running))}</td></tr>`);
    full.movements.forEach((m) => {
      const d = Number(m.debit || 0), c = Number(m.credit || 0);
      // نستعمل الرصيد المُخزَّن من الأمين إن توفّر (الأدقّ)، وإلا نحسبه تراكمياً.
      running = (m.balance !== undefined && m.balance !== null) ? Number(m.balance) : roundPrice(running + d - c);
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
        <thead><tr><th>التاريخ</th><th>مدين (بضاعة)</th><th>دائن (دفع)</th><th>البيان</th><th>الرصيد</th></tr></thead>
        <tbody>
        ${rows.join("")}
        <tr class="open closing"><td></td><td colspan="2">الرصيد في نهاية الفترة</td><td></td><td><b>${escapeHtml(formatMoney(closing))}</b></td></tr>
        </tbody>
      </table>
      ${truncNote}${liveNote}
      ${stamp}
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
    <table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr></thead><tbody>${pr}</tbody></table>
    <div class="sec">كشف الحركة (الأحدث)</div>
    <table><thead><tr><th>التاريخ</th><th>مدين (بضاعة)</th><th>دائن (دفع)</th><th>ملاحظات</th></tr></thead><tbody>${mv}</tbody></table>
    ${stamp}
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

// سند رسمي (قبض/صرف) بالتصميم المبرَند مع الختم الأزرق
// صياغة الرصيد للزبون: القيمة المطلقة مع بيان الجهة (عليكم = دين عليه، لكم = رصيد له).
function balanceText(bal, cur) {
  const b = roundPrice(bal);
  if (Math.abs(b) < 0.01) return "مسدّد (صفر)";
  return `${formatMoney(Math.abs(b))} ${cur} ${b > 0 ? "(عليكم)" : "(لكم)"}`;
}

function voucherPdfMarkup(v) {
  const isPay = v.type === "payment";
  const isInv = v.type === "invoice";
  const isRet = v.type === "return";
  const title = isInv ? "فاتورة" : (isRet ? "فاتورة مرتجع" : (isPay ? "سند صرف" : "سند قبض"));
  const cur = v.cur || "ل.س";
  const amtColor = (isPay || isInv) ? "#c0271f" : "#16794f";
  const amtLabel = isInv ? "قيمة الفاتورة" : (isRet ? "قيمة المرتجع" : (isPay ? "المبلغ المصروف" : "المبلغ المستلم"));
  const dstr = String(v.date || todayIsoDate()).slice(0, 10);
  const noteLine = isInv
    ? "هذه فاتورة صادرة عن OZK TOBACCO."
    : (isRet
      ? "هذا سند رسمي بقيمة البضاعة المرتجعة إلى OZK TOBACCO — خُصمت من رصيد حسابكم."
      : (isPay
        ? "هذا سند رسمي بالمبلغ المصروف من صندوق OZK TOBACCO."
        : "شكراً لتعاملكم مع OZK TOBACCO. هذا سند رسمي بالمبلغ المستلم."));
  const balLabel = isInv ? "الرصيد الحالي" : (isRet ? "الرصيد بعد المرتجع" : (isPay ? "الرصيد بعد الصرف" : "الرصيد بعد الدفعة"));
  const rows = [];
  rows.push(`<tr><th style="width:130px">التاريخ</th><td>${escapeHtml(dstr)}</td></tr>`);
  if (v.method) rows.push(`<tr><th>طريقة الدفع</th><td>${escapeHtml(v.method)}</td></tr>`);
  if (v.notes) rows.push(`<tr><th>البيان</th><td>${escapeHtml(v.notes)}</td></tr>`);
  // للفاتورة والمرتجع: نعرض الرصيد السابق ثم القيمة ثم الرصيد الجديد ليعرف الزبون وضعه بوضوح.
  if ((isInv || isRet) && v.newBalance !== undefined && v.newBalance !== null) {
    rows.push(`<tr><th>الرصيد السابق</th><td>${escapeHtml(balanceText(v.prevBalance, cur))}</td></tr>`);
    rows.push(`<tr><th>${isRet ? "قيمة هذا المرتجع" : "قيمة هذه الفاتورة"}</th><td>${escapeHtml(formatMoney(v.amount || 0))} ${escapeHtml(cur)}</td></tr>`);
    // إن سُجّلت الفاتورة على الحساب بمبلغ أقل/أكثر من قيمتها (حسم أو تسوية) نُظهر الفرق
    // ليبقى الحساب شفافاً: السابق + الفاتورة − الحسم = الجديد.
    if (Number(v.adjust || 0) > 0.009) {
      rows.push(`<tr><th>حسم</th><td class="cred">− ${escapeHtml(formatMoney(v.adjust))} ${escapeHtml(cur)}</td></tr>`);
    } else if (Number(v.adjust || 0) < -0.009) {
      rows.push(`<tr><th>إضافة / تسوية</th><td class="deb">+ ${escapeHtml(formatMoney(Math.abs(v.adjust)))} ${escapeHtml(cur)}</td></tr>`);
    }
    rows.push(`<tr><th>الرصيد الجديد</th><td><b>${escapeHtml(balanceText(v.newBalance, cur))}</b></td></tr>`);
  } else if (v.balance !== undefined && v.balance !== null && v.balance !== "") {
    const lbl = v.balanceLabel || balLabel;
    const balTxt = (isInv || isRet || v.type === "receipt") ? balanceText(v.balance, cur) : `${formatMoney(v.balance)} ${cur}`;
    rows.push(`<tr><th>${escapeHtml(lbl)}</th><td>${escapeHtml(balTxt)}</td></tr>`);
  }
  const stamp = `
    <div class="stamp-wrap"><div class="seal">
      <div class="s-name">مركز أبو زياد</div>
      <div class="s-sub">لتجارة الدخان</div>
      <div class="s-logo">OZK TOBACCO</div>
      <div class="s-info" dir="ltr">0985000771 - 0984000662 · رقم المركز: 0994092038</div>
      <div class="s-addr">دوما - ساحة الغنم</div>
    </div></div>`;
  return `${REPORT_STYLE}<div class="ozk-rpt">
    <div class="rhead">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="public/icons/ozk-logo.png" class="rlogo" alt="OZK" onerror="this.style.display='none'">
        <div class="brand">OZK TOBACCO<small>مركز أبو زياد — لتجارة الدخان</small></div>
      </div>
      <div class="rtitle"><h2>${title}</h2><span>رقم: ${escapeHtml(v.no || docNumber(isInv ? "INV" : (isRet ? "RET" : (isPay ? "PV" : "R"))))} · ${escapeHtml(dstr)}</span></div>
    </div>
    <div class="balbox">
      <div><div class="nm">${escapeHtml(v.name || "")}</div>
        <div class="muted">${isPay ? "جهة الصرف / المستفيد" : (v.phone ? "هاتف: " + escapeHtml(v.phone) : "")}</div></div>
      <div style="text-align:left"><div class="muted">${amtLabel}</div>
        <div class="big" style="color:${amtColor}">${escapeHtml(formatMoney(v.amount || 0))} ${escapeHtml(cur)}</div></div>
    </div>
    ${((isInv || isRet) && Array.isArray(v.lines) && v.lines.length) ? `
    <div class="sec">${isRet ? "أصناف المرتجع" : "أصناف الفاتورة"}</div>
    <table>
      <thead><tr><th>المادة</th><th>الكمية</th><th>سعر الوحدة</th></tr></thead>
      <tbody>${v.lines.map((l) => `<tr><td>${escapeHtml(l.material || "")}</td><td>${escapeHtml(invoiceLineQty(l))}</td><td>${escapeHtml(invoiceLinePrice(l, { total: v.amount, lines: v.lines }))}</td></tr>`).join("")}</tbody>
    </table>` : ""}
    <table>${rows.join("")}</table>
    <p class="muted" style="margin:8px 0 0">${noteLine}</p>
    ${stamp}
    <div class="rfoot"><span>صادر آليًا عن نظام OZK TOBACCO · رقم المركز: 0994092038</span><span dir="ltr">0985000771 — 0984000662</span></div>
  </div>`;
}

async function exportVoucherPdf(v) {
  const isPay = v.type === "payment";
  const isInv = v.type === "invoice";
  const isRet = v.type === "return";
  const safe = String(v.name || (isInv ? "فاتورة" : (isRet ? "مرتجع" : (isPay ? "صرف" : "قبض")))).replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  const prefix = isInv ? "فاتورة" : (isRet ? "فاتورة-مرتجع" : (isPay ? "سند-صرف" : "سند-قبض"));
  await exportReportPdf(voucherPdfMarkup(v), `${prefix}-${safe}-${todayIsoDate()}.pdf`);
  setNotice("success", isInv ? "تم تجهيز الفاتورة PDF." : (isRet ? "تم تجهيز فاتورة المرتجع PDF." : (isPay ? "تم تجهيز سند الصرف PDF." : "تم تجهيز سند القبض PDF.")));
  render();
}

function receivablesPdfMarkup() {
  const items = latestCustomerBalanceItems();
  const totals = customerBalanceTotals(items);
  const totalDebit = totals.totalDebitBalance;              // مجموع المدين (موجب)
  const totalCredit = Math.abs(totals.totalCreditBalance);  // مجموع الدائن (نعرضه موجباً)
  const net = totalDebit - totalCredit;                     // صافي الذمم لصالحنا
  // كل الزبائن أصحاب رصيد (مدين موجب أو دائن سالب) — بلا قصّ. المدينون أولاً ثم الدائنون.
  const withBalance = items
    .filter((i) => Math.abs(customerBalance(i)) > 0.009)
    .sort((a, b) => customerBalanceSortValue(b) - customerBalanceSortValue(a));
  const rows = withBalance.length
    ? withBalance.map((it, idx) => {
        const bal = customerBalance(it);
        const isDebit = bal > 0;
        const ld = customerLastPaymentDate(it);
        const la = customerLastPaymentAmount(it);
        return `<tr><td>${idx + 1}</td><td>${escapeHtml(it.name || "")}</td>`
          + `<td class="deb">${isDebit ? escapeHtml(formatMoney(bal)) : "—"}</td>`
          + `<td class="cred">${isDebit ? "—" : escapeHtml(formatMoney(Math.abs(bal)))}</td>`
          + `<td>${ld ? escapeHtml(String(ld).slice(0, 10)) : "—"}</td>`
          + `<td>${la > 0 ? escapeHtml(formatMoney(la)) : "—"}</td></tr>`;
      }).join("")
      + `<tr class="closing"><td></td><td>الإجمالي (${escapeHtml(withBalance.length)} زبون)</td>`
      + `<td class="deb">${escapeHtml(formatMoney(totalDebit))}</td>`
      + `<td class="cred">${escapeHtml(formatMoney(totalCredit))}</td><td></td><td></td></tr>`
    : `<tr><td colspan="6" class="muted">لا يوجد زبائن أصحاب أرصدة</td></tr>`;
  return `${REPORT_STYLE}<div class="ozk-rpt">
    <div class="rhead"><div class="brand">OZK TOBACCO<small>تقرير الذمم الإجمالي</small></div>
      <div class="rtitle"><h2>الذمم</h2><span>بتاريخ ${escapeHtml(todayIsoDate())}</span></div></div>
    <div class="cards">
      <div class="rcard"><div class="v red">${escapeHtml(formatMoney(totalDebit))}</div><div class="l">إجمالي المدين — مستحق لنا (${escapeHtml(totals.debitCustomers)} زبون)</div></div>
      <div class="rcard"><div class="v green">${escapeHtml(formatMoney(totalCredit))}</div><div class="l">إجمالي الدائن — لهم عندنا (${escapeHtml(totals.creditCustomers)} زبون)</div></div>
      <div class="rcard"><div class="v gold">${escapeHtml(formatMoney(net))}</div><div class="l">صافي الذمم لصالحنا</div></div>
    </div>
    <div class="sec">أرصدة الزبائن — المدين والدائن (${escapeHtml(withBalance.length)} زبون)</div>
    <table>
      <thead><tr><th>#</th><th>الزبون</th><th>مدين (عليه)</th><th>دائن (له)</th><th>تاريخ آخر دفعة</th><th>قيمة آخر دفعة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
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

// محرّك تحويل PDF (html2canvas) يسقط المسافات بين الكلمات العربية أحياناً —
// نحوّل المسافات العادية لمسافات ثابتة (nbsp) لتبقى ظاهرة في التقرير.
function pdfAr(s) {
  return String(s == null ? "" : s).replace(/ /g, " ");
}

// كمية الصنف بالوحدة الكبرى (كرتونة/شرحة/طرد): نفضّل stockQtyUnit2 المحسوبة جاهزةً في
// مزامنة الأمين، وإلا نقسم كمية الكروز على معامل الوحدة.
function itemQtyUnit2(it) {
  const direct = Number(it?.stockQtyUnit2);
  const q = itemQty(it);
  if (Number.isFinite(direct) && (direct > 0 || q <= 0)) return direct;
  const f = Number(it?.unit2Factor || 0);
  return roundPrice(f > 0 ? q / f : q);
}

// كمية الصنف بصيغة التاجر: كراتين كاملة + الباقي كروزاً («10 كرتونة و21 كروز») بدل
// الكسور العشرية المربكة («10.42 كرتونة»). الكميات السالبة (جرد بالسالب) تُعرض بإشارتها.
function formatQtyCartons(it) {
  const q = Number(it?.stockQty ?? itemQty(it)) || 0;
  const f = Number(it?.unit2Factor || 0);
  const u1 = String(it?.unit1Name || "").trim();
  const u2 = String(it?.unit2Name || "").trim();
  if (!(f > 1) || !u2) return `${formatMoney(roundPrice(q))} ${u2 || u1}`.trim();
  const sign = q < 0 ? "−" : "";
  const abs = Math.abs(q);
  const whole = Math.floor((abs + 1e-9) / f);
  const rem = roundPrice(abs - whole * f);
  if (whole > 0 && rem > 0) return `${sign}${formatMoney(whole)} ${u2} و${formatMoney(rem)} ${u1 || ""}`.trim();
  if (whole > 0) return `${sign}${formatMoney(whole)} ${u2}`;
  return `${sign}${formatMoney(rem)} ${u1 || u2}`.trim();
}

// حالة الصنف كما تحسبها مزامنة الأمين (بحدود المجموعات، مثل: ماستر < 250 كروز = قارب النفاد)
// — لا نعيد حسابها في الموقع كي لا تخالف الأمين.
const INV_STATUS_BADGE = {
  out: '<span class="deb">نافد</span>',
  low: '<span style="color:#8a5a00;font-weight:700">قارب على النفاد</span>',
  stale: '<span class="muted" style="font-weight:700">راكدة</span>',
  review: '<span class="deb">مراجعة جرد</span>',
  active: '<span style="color:#16794f;font-weight:700">متوفّر</span>'
};

// ترتيب تقرير المخزون يطابق ترتيب مجموعات نشرة الأسعار. لا ندمج المواد هنا:
// كل صنف (وبالأخص أصناف المعسل) يبقى بسطر مستقل لإظهار كميته الحقيقية.
const INVENTORY_GROUP_SEQUENCE = [
  ["غلواز", "جولواز", "gauloises"],
  ["ماستر", "master"],
  ["كابتن بلاك", "captain black"],
  ["اليغانس", "اليجنس", "elegance"],
  ["اوسكار", "oscar"],
  ["تي اس", "ts"],
  ["اختمار"],
  ["اوريس", "auris"],
  ["روز", "rose"],
  ["حمرا", "الحمراء"],
  ["1970"],
  ["يونايتد", "united"],
  ["كينغ دوم", "كينج دوم", "kingdom"],
  ["ولسون", "wilson"],
  ["مانشستر", "manchester"],
  ["نابولي", "napoli"],
  ["مليونير", "millionaire"],
  ["بزنس", "business"],
  ["بارسا", "barca"],
  ["برو", "pro"],
  ["ام تي", "mt"],
  ["اصناف الحره", "حرة", "حره"],
  ["سيغار", "سيناتور", "كلارو"],
  ["فحم"],
  ["ورق"],
  ["معسل", "مزايا", "فاخر", "نخله", "صفوه", "اسطوره"],
  ["فيب", "فيبات"],
  ["قداحات", "قداحه"],
  ["سلفان"]
];

function inventoryGroupInfo(it) {
  const label = String(it?.groupName || "مواد بدون مجموعة").trim() || "مواد بدون مجموعة";
  const haystack = normalizeItemName(`${label} ${it?.name || ""}`);
  const rank = INVENTORY_GROUP_SEQUENCE.findIndex((aliases) =>
    aliases.some((alias) => haystack.includes(normalizeItemName(alias)))
  );
  return { label, rank: rank < 0 ? INVENTORY_GROUP_SEQUENCE.length : rank };
}

function isCriticalFastGroup(it) {
  const text = normalizeItemName(`${it?.groupName || ""} ${it?.name || ""}`);
  return ["ماستر", "master", "غلواز", "جولواز", "gauloises"]
    .some((alias) => text.includes(normalizeItemName(alias)));
}

// التصنيف التشغيلي يعتمد على حركة المبيع لا على رقم ثابت لجميع المواد:
// 30 يوماً أو أقل = قريب من النفاد. الأصناف البطيئة بلا مبيع حديث تبقى «متوفرة»
// ولا تُظلم بتصنيف قريب النفاد. نحتفظ بحد الأمين للماستر والغلواز لأنهما سريعَا الحركة.
function inventoryReportStatus(it, sales, periodDays, hasSalesReport) {
  const rawQty = Number(it?.stockQty || 0);
  const positiveQty = Number(it?.stockQtyPositive || 0);
  if (rawQty <= 0 && positiveQty > 0) return "review";
  if (rawQty <= 0) return "out";
  if (!hasSalesReport) return ["low", "review", "stale"].includes(it?.status) ? it.status : "active";

  const sold = Number(sales.get(normalizeItemName(it?.name || "")) || 0);
  if (sold > 0) {
    const coverageDays = rawQty / (sold / periodDays);
    if (coverageDays <= 30) return "low";
  }
  if (isCriticalFastGroup(it) && it?.status === "low") return "low";
  return "active";
}

const INVENTORY_REPORT_STYLE = `<style>
.ozk-rpt.inventory-rpt{color-scheme:light!important;color:#221808!important;background:#fffdf8!important}
.ozk-rpt.inventory-rpt .inventory-page{background:#fffdf8!important;break-after:page;page-break-after:always}
.ozk-rpt.inventory-rpt .inventory-page:last-child{break-after:auto;page-break-after:auto}
.ozk-rpt.inventory-rpt .rhead{background:#fffdf8!important;margin-bottom:7px;padding-bottom:5px}
.ozk-rpt.inventory-rpt .rhead .brand{font-size:15px}.ozk-rpt.inventory-rpt .rtitle h2{font-size:13px}
.ozk-rpt.inventory-rpt .cards{gap:6px;margin-bottom:7px}.ozk-rpt.inventory-rpt .rcard{background:#f7efd9!important;color:#221808!important;padding:5px 7px}
.ozk-rpt.inventory-rpt .rcard .v{font-size:16px}.ozk-rpt.inventory-rpt .rcard .l{font-size:8.5px}
.ozk-rpt.inventory-rpt .inventory-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;align-items:start;direction:rtl}
.ozk-rpt.inventory-rpt .inventory-column{min-width:0}
.ozk-rpt.inventory-rpt .inventory-group{margin:0 0 5px;break-inside:avoid;page-break-inside:avoid}
.ozk-rpt.inventory-rpt table{font-size:9.2px;table-layout:fixed}
.ozk-rpt.inventory-rpt th{background:#ece1c4!important;color:#221808!important;padding:3px 5px;font-size:8.8px}
.ozk-rpt.inventory-rpt td{background:#fffdf8!important;color:#221808!important;padding:3px 5px;line-height:1.25}
.ozk-rpt.inventory-rpt tr:nth-child(even) td{background:#faf4e6!important}
.ozk-rpt.inventory-rpt .inventory-group-row td{background:#6b4309!important;color:#f4ca62!important;border-color:#b8892a!important;font-weight:900;padding:4px 6px;font-size:10px}
.ozk-rpt.inventory-rpt .inventory-group-row .group-count{float:left;background:#f4ca62;color:#4d2d04;border-radius:999px;padding:1px 7px;font-size:10px}
.ozk-rpt.inventory-rpt .status-low{color:#9a6100!important;font-weight:800}.ozk-rpt.inventory-rpt .status-active{color:#16794f!important;font-weight:800}
@media print{html,body,.ozk-rpt.inventory-rpt,.ozk-rpt.inventory-rpt .inventory-page{background:#fffdf8!important;color:#221808!important}.ozk-rpt.inventory-rpt{padding:0!important}}
</style>`;

// تقسيم فعلي إلى صفحات وعمودين. كل مجموعة تبقى كتلة واحدة، وتذهب المجموعة التالية
// إلى العمود الأقصر؛ لذلك تبدأ الغلواز يميناً والماستر يساراً وتختفي الفراغات الكبيرة.
function inventoryTwoColumnPages(groups, columnCapacity = 48) {
  const pages = [];
  const newPage = () => ({ columns: [[], []], weights: [0, 0] });
  let page = newPage();
  pages.push(page);
  for (const group of groups) {
    const weight = group.items.length + 1;
    let column = page.weights[0] <= page.weights[1] ? 0 : 1;
    const other = column === 0 ? 1 : 0;
    if (page.weights[column] + weight > columnCapacity && page.weights[other] + weight <= columnCapacity) column = other;
    if (page.weights[column] + weight > columnCapacity) {
      page = newPage();
      pages.push(page);
      column = 0;
    }
    page.columns[column].push(group);
    page.weights[column] += weight;
  }
  return pages;
}

function inventoryReportPdfMarkup() {
  // كل كمية موجبة تظهر. الصنف النافد لا يظهر إلا إذا كان عليه مبيع حقيقي حديث؛
  // التسعير القديم وحده ليس دليلاً كافياً (مثل أصناف بلاتينوم القديمة).
  const allRaw = reportItems(latestStockReport());
  const sales = materialSalesUnit1Map();
  const salesReport = state.customerInvoicesReport;
  const hasSalesReport = Boolean(salesReport && Array.isArray(salesReport.items));
  const periodDays = Math.max(1, Number(salesReport?.summary?.periodDays || 60));
  const hasRecentSale = (it) => sales.has(normalizeItemName(it?.name || ""));
  const all = allRaw.filter((it) =>
    Number(it?.stockQty || 0) > 0 || Number(it?.stockQtyPositive || 0) > 0 || hasRecentSale(it)
  );
  const excludedCount = allRaw.length - all.length;
  const classified = all.map((it) => ({
    ...it,
    reportStatus: inventoryReportStatus(it, sales, periodDays, hasSalesReport),
    reportGroup: inventoryGroupInfo(it)
  }));
  const low = classified.filter((i) => i.reportStatus === "low");
  const out = classified.filter((i) => i.reportStatus === "out");
  const review = classified.filter((i) => i.reportStatus === "review");
  const list = classified.slice().sort((a, b) =>
    a.reportGroup.rank - b.reportGroup.rank ||
    String(a.reportGroup.label).localeCompare(String(b.reportGroup.label), "ar") ||
    String(a.name || "").localeCompare(String(b.name || ""), "ar")
  );
  const grouped = [];
  for (const it of list) {
    let group = grouped[grouped.length - 1];
    if (!group || group.label !== it.reportGroup.label) {
      group = { label: it.reportGroup.label, items: [] };
      grouped.push(group);
    }
    group.items.push(it);
  }
  const badgeOf = (it) => it.reportStatus === "low"
    ? '<span class="status-low">قريب من النفاد</span>'
    : (it.reportStatus === "active" ? '<span class="status-active">متوفّر</span>' : (INV_STATUS_BADGE[it.reportStatus] || INV_STATUS_BADGE.active));
  const groupMarkup = (group) => `<div class="inventory-group"><table><tbody>
    <tr class="inventory-group-row"><td colspan="3">${escapeHtml(pdfAr(group.label))}<span class="group-count">${escapeHtml(group.items.length)}</span></td></tr>
    ${group.items.map((it) => `<tr><td style="width:48%">${escapeHtml(pdfAr(it.name || ""))}</td><td style="width:29%">${escapeHtml(pdfAr(formatQtyCartons(it)))}</td><td style="width:23%">${badgeOf(it)}</td></tr>`).join("")}
  </tbody></table></div>`;
  const pages = inventoryTwoColumnPages(grouped);
  const pagesMarkup = pages.map((page, pageIndex) => `<section class="inventory-page">
    <div class="rhead"><div class="brand">OZK TOBACCO<small>تقرير المخزون التشغيلي</small></div>
      <div class="rtitle"><h2>المخزون — حسب ترتيب النشرة</h2><span>بتاريخ ${escapeHtml(todayIsoDate())} · صفحة ${escapeHtml(pageIndex + 1)} من ${escapeHtml(pages.length)}</span></div></div>
    ${pageIndex === 0 ? `<div class="cards">
      <div class="rcard"><div class="v gold">${escapeHtml(classified.length)}</div><div class="l">أصناف فعلية ومتداولة</div></div>
      <div class="rcard"><div class="v red">${escapeHtml(low.length)}</div><div class="l">قريب من النفاد حسب حركة المبيع</div></div>
      <div class="rcard"><div class="v red">${escapeHtml(out.length)}</div><div class="l">نافد وله طلب حديث</div></div>
    </div>` : ""}
    <div class="inventory-columns">
      <div class="inventory-column">${page.columns[0].map(groupMarkup).join("") || '<p class="muted">—</p>'}</div>
      <div class="inventory-column">${page.columns[1].map(groupMarkup).join("") || '<p class="muted">—</p>'}</div>
    </div>
    ${pageIndex === pages.length - 1 ? `<p class="muted" style="margin-top:6px">الحالة محسوبة على تغطية المبيع خلال ${escapeHtml(periodDays)} يوماً${hasSalesReport ? "" : " (لم تصل حركة المبيع؛ استُخدم تصنيف المزامنة مؤقتاً)"}. لا تُدمج أصناف المعسل.${review.length ? ` يوجد ${escapeHtml(review.length)} صنف يحتاج مراجعة جرد.` : ""}${excludedCount > 0 ? ` استُبعد ${escapeHtml(excludedCount)} صنفاً نافداً بلا مبيع حديث.` : ""}</p>` : ""}
  </section>`).join("");
  return `${REPORT_STYLE}${INVENTORY_REPORT_STYLE}<div class="ozk-rpt inventory-rpt">${pagesMarkup}</div>`;
}

async function exportInventoryReportPdf() {
  const items = reportItems(latestStockReport());
  if (!items.length) {
    setNotice("error", "لا توجد مواد لإنشاء تقرير المخزون.");
    render();
    return;
  }
  await exportReportPdf(inventoryReportPdfMarkup(), `تقرير-المخزون-${todayIsoDate()}.pdf`);
  setNotice("success", "تم تجهيز تقرير المخزون PDF.");
  render();
}

// إجمالي المبيع لكل مادة بالوحدة الأساسية (كروز) من فواتير الزبائن خلال فترة التقرير.
function materialSalesUnit1Map() {
  const map = new Map();
  const report = state.customerInvoicesReport;
  const custItems = report && Array.isArray(report.items) ? report.items : [];
  for (const cust of custItems) {
    const invoices = Array.isArray(cust.invoices) ? cust.invoices : [];
    for (const inv of invoices) {
      const lines = Array.isArray(inv.lines) ? inv.lines : [];
      for (const l of lines) {
        const key = normalizeItemName(l.material || "");
        const qty = Number(l.qty || 0); // كروز
        if (key && qty > 0) map.set(key, (map.get(key) || 0) + qty);
      }
    }
  }
  return map;
}

// تقرير المواد الراكدة: يقارن المخزون الحالي بمعدّل البيع (كم شهراً يكفي المخزون)،
// ويرتّب المواد من الأكثر ركوداً (مخزون مرتفع + مبيع قليل) إلى الأقل.
function stagnantMaterialsPdfMarkup() {
  const stock = pricingWorklistItems().filter((it) => itemQty(it) > 0);
  const sales = materialSalesUnit1Map();
  const periodDays = Math.max(1, Number(state.customerInvoicesReport?.summary?.periodDays || 60));

  const rows = stock.map((it) => {
    const factor = itemUnit2Factor(it);
    const stockU1 = itemQty(it);                                     // كروز
    const soldU1 = sales.get(normalizeItemName(it.name || "")) || 0; // كروز خلال الفترة
    const monthlyU1 = (soldU1 / periodDays) * 30;
    const coverage = monthlyU1 > 0 ? stockU1 / monthlyU1 : Infinity; // أشهر التغطية
    return {
      name: it.name || "",
      u2: itemUnit2Name(it),
      stockU2: factor > 0 ? stockU1 / factor : stockU1,
      soldU2: factor > 0 ? soldU1 / factor : soldU1,
      coverage,
      noSale: soldU1 <= 0
    };
  }).sort((a, b) => (b.coverage - a.coverage) || (b.stockU2 - a.stockU2));

  const statusOf = (r) =>
    r.noSale ? '<span class="deb">راكد — لا مبيع</span>'
    : (r.coverage >= 6 ? '<span class="deb">بطيء جداً</span>'
    : (r.coverage >= 3 ? '<span style="color:#8a5a00;font-weight:700">بطيء</span>'
    : '<span style="color:#16794f;font-weight:700">متحرّك</span>'));
  const covText = (r) => r.noSale ? "∞ (لا مبيع)" : `${formatMoney(roundPrice(r.coverage))} شهر`;

  const body = rows.length
    ? rows.map((r) => `<tr><td>${escapeHtml(pdfAr(r.name))}</td>`
        + `<td>${escapeHtml(pdfAr(`${formatMoney(roundPrice(r.stockU2))} ${r.u2}`))}</td>`
        + `<td>${escapeHtml(pdfAr(`${formatMoney(roundPrice(r.soldU2))} ${r.u2}`))}</td>`
        + `<td>${escapeHtml(covText(r))}</td><td>${statusOf(r)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">لا توجد بيانات كافية</td></tr>`;

  const noSale = rows.filter((r) => r.noSale).length;
  const slow = rows.filter((r) => !r.noSale && r.coverage >= 3).length;

  return `${REPORT_STYLE}<div class="ozk-rpt">
    <div class="rhead"><div class="brand">OZK TOBACCO<small>المواد الراكدة</small></div>
      <div class="rtitle"><h2>المواد الراكدة</h2><span>بتاريخ ${escapeHtml(todayIsoDate())}</span></div></div>
    <div class="cards">
      <div class="rcard"><div class="v red">${escapeHtml(noSale)}</div><div class="l">مادة بلا أي مبيع (خلال الفترة)</div></div>
      <div class="rcard"><div class="v red">${escapeHtml(slow)}</div><div class="l">مادة بطيئة (يكفي مخزونها ٣ أشهر فأكثر)</div></div>
      <div class="rcard"><div class="v gold">${escapeHtml(rows.length)}</div><div class="l">إجمالي المواد ذات المخزون</div></div>
    </div>
    <div class="sec">من الأكثر ركوداً (مخزون مرتفع + مبيع قليل) إلى الأقل</div>
    <table>
      <thead><tr><th>المادة</th><th>المخزون</th><th>المبيع (${escapeHtml(periodDays)} يوم)</th><th>يكفي لـ</th><th>الحالة</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="muted" style="margin-top:8px">«يكفي لـ» = كم شهراً يكفي المخزون الحالي بمعدّل البيع. المبيع محسوب من فواتير الزبائن خلال آخر ${escapeHtml(periodDays)} يوم (لا يشمل مبيعات الكاش بدون اسم).</p>
  </div>`;
}

async function exportStagnantMaterialsPdf() {
  const stock = pricingWorklistItems().filter((it) => itemQty(it) > 0);
  if (!stock.length) {
    setNotice("error", "لا توجد مواد بمخزون لإنشاء تقرير المواد الراكدة.");
    render();
    return;
  }
  if (!state.customerInvoicesReport) {
    setNotice("error", "لم تصل بيانات مبيعات الفواتير بعد — انتظر مزامنة الفواتير ثم أعد المحاولة.");
    render();
    return;
  }
  await exportReportPdf(stagnantMaterialsPdfMarkup(), `المواد-الراكدة-${todayIsoDate()}.pdf`);
  setNotice("success", "تم تجهيز تقرير المواد الراكدة PDF.");
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
  const manualPayments = ((state.paymentRecords && state.paymentRecords[key]) || [])
    .map((p) => ({ amount: p.amount, date: p.paymentDate || "", notes: p.notes, source: "manual" }));
  const allPayments = [...ameenPayments, ...manualPayments]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const fullMv = customerFullMovements(item);
  const movements = (fullMv && Array.isArray(fullMv.movements) && fullMv.movements.length)
    ? [...fullMv.movements].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    : (Array.isArray(item.recentMovements)
        ? [...item.recentMovements].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        : []);
  const invoiceMoves = movements.filter((m) => Number(m?.debit || 0) > 0);
  const creditMoves = movements.filter((m) => Number(m?.credit || 0) > 0);
  // مرتجع المبيعات يُقيَّد دائناً على حساب الزبون تماماً كالدفعة — نفرزه هنا بمطابقة
  // فاتورة المرتجع الفعلية (بالتاريخ والمبلغ) ليُصدَّر كفاتورة مرتجع لا كسند قبض.
  const returnMoves = creditMoves.filter((m) => findReturnInvoiceForMovement(item.name || "", m));
  const paymentMoves = creditMoves.filter((m) => !findReturnInvoiceForMovement(item.name || "", m));

  return `
    <section class="customer-detail-panel" data-customer-detail-panel>
      <div class="panel-title-row inventory-browser-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="muted">الرصيد، تسجيل الدفعات، معلومات التواصل.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="button secondary compact-button" type="button" data-action="toggle-currency" title="تبديل عملة الزبون بين الدولار والليرة (يُحفظ)">💱 العملة: ${escapeHtml(customerCurrency(item))}</button>
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
            <h4>🧾 الفواتير</h4>
            <span class="status-chip">${invoiceMoves.length} فاتورة</span>
          </div>
          <div class="detail-list payment-timeline">
            ${invoiceMoves.length
              ? invoiceMoves.map((m) => `
                <div class="payment-entry">
                  <div class="payment-entry-dot movement-dot"></div>
                  <div class="payment-entry-body">
                    <strong class="payment-amount">فاتورة: ${escapeHtml(formatMoney(Number(m?.debit || 0)))}</strong>
                    <span class="payment-date">${escapeHtml(m?.date ? formatDate(m.date) : "بلا تاريخ")}</span>
                    ${m?.notes ? `<small class="payment-note">${escapeHtml(m.notes)}</small>` : ""}
                    <button class="button secondary mini-button" type="button" data-action="gen-movement-doc" data-debit="${escapeHtml(String(m?.debit || 0))}" data-credit="0" data-date="${escapeHtml(m?.date || "")}" data-notes="${escapeHtml(m?.notes || "")}" data-balance="${m?.balance !== undefined && m?.balance !== null ? escapeHtml(String(m.balance)) : ""}" data-balance-chrono="${m?.balanceChrono !== undefined && m?.balanceChrono !== null ? escapeHtml(String(m.balanceChrono)) : ""}" data-doc-new="${m?.docNew !== undefined && m?.docNew !== null ? escapeHtml(String(m.docNew)) : ""}" data-doc-prev="${m?.docPrev !== undefined && m?.docPrev !== null ? escapeHtml(String(m.docPrev)) : ""}" data-bill-guid="${escapeHtml(String(m?.billGuid || ""))}" style="margin-top:6px">📄 فاتورة PDF</button>
                  </div>
                </div>`).join("")
              : '<p class="muted" style="padding:12px 0">لا توجد فواتير مسجلة.</p>'}
          </div>
        </article>
        <article>
          <div class="detail-section-head">
            <h4>🔁 المرتجعات</h4>
            <span class="status-chip">${returnMoves.length} مرتجع</span>
          </div>
          <div class="detail-list payment-timeline">
            ${returnMoves.length
              ? returnMoves.map((m) => `
                <div class="payment-entry">
                  <div class="payment-entry-dot movement-dot"></div>
                  <div class="payment-entry-body">
                    <strong class="payment-amount">مرتجع: ${escapeHtml(formatMoney(Number(m?.credit || 0)))}</strong>
                    <span class="payment-date">${escapeHtml(m?.date ? formatDate(m.date) : "بلا تاريخ")}</span>
                    ${m?.notes ? `<small class="payment-note">${escapeHtml(m.notes)}</small>` : ""}
                    <button class="button secondary mini-button" type="button" data-action="gen-movement-doc" data-debit="0" data-credit="${escapeHtml(String(m?.credit || 0))}" data-date="${escapeHtml(m?.date || "")}" data-notes="${escapeHtml(m?.notes || "")}" data-balance="${m?.balance !== undefined && m?.balance !== null ? escapeHtml(String(m.balance)) : ""}" data-balance-chrono="${m?.balanceChrono !== undefined && m?.balanceChrono !== null ? escapeHtml(String(m.balanceChrono)) : ""}" data-doc-new="${m?.docNew !== undefined && m?.docNew !== null ? escapeHtml(String(m.docNew)) : ""}" data-doc-prev="${m?.docPrev !== undefined && m?.docPrev !== null ? escapeHtml(String(m.docPrev)) : ""}" style="margin-top:6px">📄 فاتورة مرتجع PDF</button>
                  </div>
                </div>`).join("")
              : '<p class="muted" style="padding:12px 0">لا توجد مرتجعات مسجلة.</p>'}
          </div>
        </article>
        <article>
          <div class="detail-section-head">
            <h4>💵 سندات القبض</h4>
            <span class="status-chip">${paymentMoves.length} دفعة</span>
          </div>
          <div class="detail-list payment-timeline">
            ${paymentMoves.length
              ? paymentMoves.map((m) => `
                <div class="payment-entry">
                  <div class="payment-entry-dot"></div>
                  <div class="payment-entry-body">
                    <strong class="payment-amount">دفعة: ${escapeHtml(formatMoney(Number(m?.credit || 0)))}</strong>
                    <span class="payment-date">${escapeHtml(m?.date ? formatDate(m.date) : "بلا تاريخ")}</span>
                    ${m?.notes ? `<small class="payment-note">${escapeHtml(m.notes)}</small>` : ""}
                    <button class="button secondary mini-button" type="button" data-action="gen-movement-doc" data-debit="0" data-credit="${escapeHtml(String(m?.credit || 0))}" data-date="${escapeHtml(m?.date || "")}" data-notes="${escapeHtml(m?.notes || "")}" data-balance="${m?.balance !== undefined && m?.balance !== null ? escapeHtml(String(m.balance)) : ""}" data-balance-chrono="${m?.balanceChrono !== undefined && m?.balanceChrono !== null ? escapeHtml(String(m.balanceChrono)) : ""}" data-doc-new="${m?.docNew !== undefined && m?.docNew !== null ? escapeHtml(String(m.docNew)) : ""}" data-doc-prev="${m?.docPrev !== undefined && m?.docPrev !== null ? escapeHtml(String(m.docPrev)) : ""}" style="margin-top:6px">📄 سند قبض PDF</button>
                  </div>
                </div>`).join("")
              : '<p class="muted" style="padding:12px 0">لا توجد دفعات مسجلة.</p>'}
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
    <details class="panel overdue-panel" open style="margin-bottom:16px">
      <summary class="overdue-summary">
        <span class="overdue-icon">⚠️</span>
        <div style="flex:1">
          <strong>${overdue.length} زبون بدون دفعة منذ أكثر من 3 أيام</strong>
          <p class="muted" style="font-size:.85rem;margin:2px 0 0">هؤلاء الزبائن عليهم رصيد ولم يسجّل لهم أي دفعة خلال الفترة المحددة.</p>
        </div>
        <button class="button secondary compact-button" type="button" data-action="print-overdue" onclick="event.stopPropagation()">🖨️ PDF</button>
      </summary>
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
    </details>
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
      ${whatsappBroadcastPanel()}
      ${customerDetailsPanel(detailItem)}
      <div class="inventory-list inventory-list-dense customer-results" data-customer-results>
        ${filtered.length ? groupedAccordion("balances", filtered, { groupOf: (i) => customerBalance(i) > 0 ? "زبائن مدينون" : (customerBalance(i) < 0 ? "زبائن دائنون (لهم)" : "متوازنون"), rowOf: customerBalanceRow, query: state.customerSearch }) : '<p class="muted">لا توجد زبائن تطابق البحث والفلتر الحالي.</p>'}
      </div>
      
    </section>
  `;
}

function ameen() {
  const latest = latestStockReport();
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
    ${
      latest
        ? `${ameenBrowser(items)}
          <section class="panel wide ameen-movement">
            <h3>حركة المواد والمقارنة</h3>
            <div class="inventory-metrics">
              ${inventoryMetric("تحركت", summary.activeMovement || 0, "انخفضت كميتها عن التقرير السابق")}
              ${inventoryMetric("بلا حركة", summary.staleMovement || 0, "نفس الكمية في تقريرين")}
              ${inventoryMetric("تم تزويدها", summary.restocked || 0, "زادت كميتها عن التقرير السابق")}
              ${inventoryMetric("المقارنة السابقة", summary.previousReportDate || "لا يوجد", "تحتاج تقريرين أو أكثر")}
            </div>
          </section>`
        : `<section class="panel wide"><h3>مخزون الأمين</h3><p class="muted">لم يصل تقرير المخزون بعد. شغّل مزامنة الأمين ثم حدّث الصفحة.</p></section>`
    }
  `);
}

function customerBalancesPage() {
  return shell(customerBalanceSection(state.customerBalanceReports[0]));
}

function remote() {
  return shell(`
    <section class="panel wide">
      <div class="section-head">
        <div>
          <p class="eyebrow">الإدارة عن بعد</p>
          <h2>خدمة الإدارة عن بعد</h2>
        </div>
      </div>
      <div class="service-grid">
        ${remoteServices.map((service) => `<article><strong>${escapeHtml(service)}</strong><p>جاهزة كواجهة تشغيل، وتقرأ من قاعدة البيانات بعد ربط Supabase.</p></article>`).join("")}
      </div>
    </section>
  `);
}

function dailyMovementSection() {
  const date = state.dailyMovementDate || todayIsoDate();
  const head = `
    <div class="dm-controls">
      <label class="report-field">التاريخ
        <input type="date" data-daily-date value="${escapeHtml(date)}" max="${escapeHtml(todayIsoDate())}">
      </label>
      <button class="button secondary" type="button" data-action="daily-refresh">🔄 تحديث</button>
    </div>`;
  if (state.dailyMovementLoading) return head + `<p class="muted">جاري تحميل تقرير اليوم…</p>`;
  if (state.dailyMovementError) return head + `<div class="report-status">تعذّر التحميل: ${escapeHtml(state.dailyMovementError)}</div>`;

  const rep = state.dailyMovement;
  if (!rep || !rep.payload) {
    return head + `<div class="report-status">لا يوجد تقرير لهذا اليوم بعد. يُنشأ تلقائياً من «الأمين»، أو شغّل الوكيل على لابتوب الأمين.</div>`;
}

  const p = rep.payload;
  const sales = Array.isArray(p.sales) ? p.sales : [];
  const UNITS = ["كرتونة", "طرد", "شرحة"];
  const fmt = (n) => (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-US");
  const net = (unit) => sales.reduce((a, r) => a + (r.unit === unit ? (Number(r.billClass) === 3 ? -1 : 1) * Number(r.units || 0) : 0), 0);
  const cards = UNITS.map((u) => `<div class="dm-card"><div class="dm-v">${escapeHtml(fmt(net(u)))}</div><div class="dm-l">${u}</div></div>`).join("");

  const types = [...new Set(sales.map((r) => r.billType))];
  const breakdown = types.length
    ? types.map((t) => {
        const cells = UNITS.map((u) => {
          const v = sales.filter((r) => r.billType === t && r.unit === u).reduce((a, r) => a + Number(r.units || 0), 0);
          return `<td>${v ? escapeHtml(fmt(v)) : "—"}</td>`;
    }).join("");
        return `<tr><td>${escapeHtml(t)}</td>${cells}</tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">لا مبيعات في هذا اليوم</td></tr>`;

  const pays = Array.isArray(p.usdPayments) ? p.usdPayments : [];
  const cash = p.usdCash || { total: 0, bills: 0 };
  const payRows = pays.map((x) => `<tr><td>${escapeHtml(x.customer || "")}</td><td class="dm-cred">$${escapeHtml(fmt(x.paid))}</td></tr>`).join("");
  const cashRow = (Number(cash.total) || Number(cash.bills))
    ? `<tr><td>زبون الكاش (بدون اسم) — ${escapeHtml(cash.bills || 0)} فاتورة</td><td class="dm-cred">$${escapeHtml(fmt(cash.total))}</td></tr>`
    : "";
  const boxTotal = pays.reduce((a, x) => a + Number(x.paid || 0), 0) + Number(cash.total || 0);
  const emptyBox = (!payRows && !cashRow) ? '<tr><td colspan="2" class="muted">لا دفعات دولار في هذا اليوم</td></tr>' : "";

  return head + `
    <div class="dm-cards">${cards}</div>
    <div class="dm-sec">تفصيل المبيعات حسب نوع الفاتورة</div>
    <table class="dm-table"><thead><tr><th>نوع الفاتورة</th><th>كرتونة</th><th>طرد</th><th>شرحة</th></tr></thead><tbody>${breakdown}</tbody></table>
    <div class="dm-sec">حركة صندوق الدولار 💵 — الدفعات الواردة</div>
    <table class="dm-table"><thead><tr><th>الزبون</th><th>المبلغ</th></tr></thead><tbody>${payRows}${cashRow}${emptyBox}<tr class="dm-total"><td>الإجمالي</td><td class="dm-cred">$${escapeHtml(fmt(boxTotal))}</td></tr></tbody></table>
    <p class="muted" style="font-size:.74rem;margin-top:8px">آخر تحديث: ${escapeHtml(String(p.generatedAt || rep.created_at || "").slice(0, 16))} — الكميات = الكمية ÷ معامل الوحدة (مبيعات ناقص مرتجعات).</p>
  `;
  }

function reportsPage() {
  if (!state.session) {
    return shell(`<section class="panel"><p class="muted">سجّل الدخول للوصول إلى التقارير.</p></section>`);
  }
  const balItems = latestCustomerBalanceItems();
  const customerOptions = balItems
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"))
    .map((it) => `<option value="${escapeHtml(it.name || "")}"></option>`)
    .join("");
  const selectedCustomerName = (() => {
    const m = balItems.find((it) => customerKey(it) === state.selectedCustomerKey);
    return m ? (m.name || "") : "";
  })();

  const selInvoices = selectedCustomerName ? customerInvoicesFor(selectedCustomerName) : [];
  const invoicesMarkup = !selectedCustomerName
    ? '<p class="muted" style="margin-top:10px">اختر زبوناً (أو اكتب اسمه) لعرض فواتيره ومحتوياتها.</p>'
    : !selInvoices.length
      ? `<p class="muted" style="margin-top:10px">لا توجد فواتير لهذا الزبون${state.customerInvoicesReport ? " خلال آخر فترة مزامنة" : " — لم تصل مزامنة الفواتير بعد"}.</p>`
      : `<div style="margin-top:12px">
          <div class="sec">📋 فواتير «${escapeHtml(selectedCustomerName)}» (${selInvoices.length}) — اضغط فاتورة لرؤية محتوياتها</div>
          ${selInvoices.map((inv) => `
            <details class="acc-group" style="margin:6px 0">
              <summary class="acc-summary"><span class="acc-title">${inv.isReturn ? "🔁 مرتجع" : "🧾 فاتورة"} ${escapeHtml(inv.number || "")} — ${escapeHtml(inv.date || "")}</span><span class="acc-count" style="${inv.isReturn ? "color:#16794f" : ""}">${escapeHtml(formatMoney(inv.total || 0))} $</span></summary>
              <div class="acc-body">
                <table class="dm-table" style="width:100%">
                  <thead><tr><th>المادة</th><th>الكمية</th><th>سعر الوحدة</th></tr></thead>
                  <tbody>
                    ${(inv.lines || []).map((l) => `<tr><td>${escapeHtml(l.material || "")}</td><td>${escapeHtml(invoiceLineQty(l))}</td><td>${escapeHtml(invoiceLinePrice(l, inv))}</td></tr>`).join("")}
                  </tbody>
                </table>
                <p class="muted" style="margin:6px 2px 0">${inv.isReturn ? "إجمالي المرتجع" : "إجمالي الفاتورة"}: <b>${escapeHtml(formatMoney(inv.total || 0))} $</b></p>
                <button class="button secondary mini-button" type="button" data-action="gen-invoice-doc" data-inv-number="${escapeHtml(String(inv.number || ""))}" data-inv-date="${escapeHtml(String(inv.date || ""))}" data-customer="${escapeHtml(selectedCustomerName)}" style="margin-top:8px">📄 ${inv.isReturn ? "تصدير فاتورة المرتجع PDF" : "تصدير الفاتورة PDF (مع الأصناف)"}</button>
              </div>
            </details>`).join("")}
        </div>`;

  return shell(`
    <section class="panel wide reports-page">
      <p class="muted" style="margin:0 0 16px">كل التقارير في مكان واحد. اضغط على عنوان أي تقرير ليفتح للأسفل.</p>

      <details class="acc-group" open>
        <summary class="acc-summary"><span class="acc-title">📊 ملخص الحركة اليومية</span><span class="acc-count">جديد</span></summary>
        <div class="acc-body report-card">
          <p class="muted">مبيعات اليوم بالكميات (كم كرتونة / طرد / شرحة) + حركة صندوق الدولار: الدفعات الواردة بأسماء الزبائن، والكاش (فواتير بدون اسم) باسم «زبون الكاش».</p>
          ${dailyMovementSection()}
    </div>
      </details>

      <details class="acc-group">
        <summary class="acc-summary"><span class="acc-title">📊 تقرير الذمم (أرصدة الزبائن)</span><span class="acc-count">PDF</span></summary>
        <div class="acc-body report-card">
          <p class="muted">إجمالي المبالغ المستحقة على الزبائن مع أعلى ٤٠ زبوناً مديناً.</p>
          <button class="button primary" type="button" data-action="report-receivables"${balItems.length ? "" : " disabled"}>📊 تنزيل تقرير الذمم PDF</button>
        </div>
      </details>

      <details class="acc-group"${selectedCustomerName ? " open" : ""}>
        <summary class="acc-summary"><span class="acc-title">📄 كشف حساب زبون</span><span class="acc-count">PDF</span></summary>
        <div class="acc-body report-card">
          <p class="muted">كشف حساب رسمي لزبون محدّد: الرصيد الافتتاحي، كل الحركات، والرصيد الختامي.</p>
          <label class="report-field">الزبون
            <input type="text" list="report-customer-list" data-report-customer placeholder="اكتب اسم الزبون أو اختَر من القائمة…" value="${escapeHtml(selectedCustomerName)}" autocomplete="off" dir="auto">
            <datalist id="report-customer-list">${customerOptions}</datalist>
          </label>
          <button class="button primary" type="button" data-action="report-statement"${balItems.length ? "" : " disabled"}>📄 تنزيل كشف الحساب PDF</button>
          ${invoicesMarkup}
    </div>
      </details>

      <details class="acc-group">
        <summary class="acc-summary"><span class="acc-title">📦 تقرير المخزون</span><span class="acc-count">PDF</span></summary>
        <div class="acc-body report-card">
          <p class="muted">تقرير فاتح مرتب مثل النشرة: الغلواز والماستر أولاً، وكل صنف بكمّيته الفعلية من دون دمج. حالة النفاد تُحسب من المخزون وحركة المبيع الحديثة.</p>
          <button class="button primary" type="button" data-action="report-inventory">📦 تنزيل تقرير المخزون PDF</button>
        </div>
      </details>

      <details class="acc-group">
        <summary class="acc-summary"><span class="acc-title">🐢 المواد الراكدة</span><span class="acc-count">PDF</span></summary>
        <div class="acc-body report-card">
          <p class="muted">المواد المكدّسة التي تبيع ببطء: يقارن مخزونك بمعدّل بيعك ويحسب كم شهراً يكفي المخزون — من الأكثر ركوداً للأقل.</p>
          <button class="button primary" type="button" data-action="report-stagnant">🐢 تنزيل تقرير المواد الراكدة PDF</button>
        </div>
      </details>

      <details class="acc-group">
        <summary class="acc-summary"><span class="acc-title">📥 التقرير الشهري للطلبات</span><span class="acc-count">إكسل</span></summary>
        <div class="acc-body report-card">
          <p class="muted">ملف إكسل بكل طلبات الشهر الحالي وملخّص بحالاتها.</p>
          <button class="button secondary" type="button" data-action="export-monthly">📥 تنزيل التقرير الشهري (إكسل)</button>
        </div>
      </details>
    </section>
  `);
}

function exportMonthlyReport() {
  if (!window.XLSX) { setNotice("error", "مكتبة إكسل غير محمّلة."); render(); return; }
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
    { name: "الإدارة", desc: "صلاحيات كاملة لجميع الصفحات", pages: ["الطلبات", "الأمين", "التسعير", "التقارير", "الفواتير", "المراقبة", "الدفع"] },
    { name: "خدمة العملاء", desc: "إدارة الطلبات والتواصل مع العملاء", pages: ["الطلبات", "المراقبة"] },
    { name: "المراقبة", desc: "عرض التقارير فقط", pages: ["التقارير", "المراقبة", "الأمين"] },
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
      <p class="muted" style="margin-bottom:12px">أضف حسابات الموظفين من منصة Supabase ثم شارك بيانات الدخول معهم.</p>
      <ol class="staff-steps">
        <li>افتح لوحة Supabase: <strong><span dir="ltr">Authentication → Users</span></strong></li>
        <li>اضغط <strong><span dir="ltr">Add User</span></strong> ثم أدخل البريد وكلمة المرور</li>
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
  const invItems = reportItems(latestStockReport());
  invItems.forEach((i) => {
    if ((i.name || "").toLowerCase().includes(q)) {
      results.push({ type: "مخزون", label: i.name, sub: `الكمية: ${i.qty ?? "—"}`, route: "ameen" });
    }
  });
  const balItems = Array.isArray(state.customerBalanceReports?.[0]?.items) ? state.customerBalanceReports[0].items : [];
  balItems.forEach((c) => {
    const name = c.customer_name || c.name || "";
    if (name.toLowerCase().includes(q)) {
      results.push({ type: "عميل", label: name, sub: `الرصيد: ${c.balance ?? "—"}`, route: "balances" });
    }
  });
  (state.purchaseInvoices || []).forEach((p) => {
    const supplierMatch = (p.supplierName || "").toLowerCase().includes(q);
    const itemMatch = (p.items || []).some((item) => (item.name || "").toLowerCase().includes(q));
    if (supplierMatch || itemMatch) {
      results.push({ type: "مشتريات", label: `${p.publicId} — ${p.supplierName}`, sub: `${(p.items || []).length} صنف · ${p.orderDate}`, route: "purchases" });
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
          <p class="eyebrow">المراقبة التشغيلية</p>
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
        <p class="eyebrow">المدفوعات</p>
        <h2>الدفع الإلكتروني</h2>
        <p class="muted">واجهة الدفع جاهزة كتصميم، لكن التفعيل الحقيقي يحتاج حساب مزود دفع ومراجعة شروطه لنشاط الشركة وبلد التشغيل.</p>
      </div>
      <div class="payment-box">
        <strong>${escapeHtml(appConfig.paymentStatus)}</strong>
        <p>المرحلة التالية: اختيار مزود دفع مناسب، ثم وضع مفاتيح الاختبار في بيئة آمنة، وليس داخل الواجهة.</p>
        <button class="button primary" type="button" disabled>الدفع غير مفعل بعد</button>
      </div>

      <div class="payment-record-section" style="margin-top:18px">
        <h4>📄 سند صرف / دفع</h4>
        <p class="muted" style="font-size:.85rem;margin:0 0 8px">أنشئ سند صرف رسمي (PDF) بالتصميم المعتمد للمبالغ المدفوعة: مورّد، مصروف، سلفة… إلخ.</p>
        <form class="payment-record-form" data-form="voucher-payment">
          <div class="payment-form-row">
            <label>المستفيد / الجهة<input name="name" maxlength="120" placeholder="اسم المورّد أو الجهة" required></label>
            <label>المبلغ<input name="amount" type="text" inputmode="decimal" dir="ltr" placeholder="0" required></label>
          </div>
          <div class="payment-form-row">
            <label>العملة<input name="cur" value="ل.س" maxlength="10"></label>
            <label>التاريخ<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
          </div>
          <label>طريقة الدفع<input name="method" maxlength="60" placeholder="نقداً / حوالة / شيك…"></label>
          <label>البيان / ملاحظة<input name="notes" maxlength="300" placeholder="سبب الصرف أو بيان الدفعة"></label>
          <button class="button primary mini-button" type="submit">📄 توليد سند صرف PDF</button>
        </form>
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
      content: `⚠️ مفتاح واجهة البرمجة (API) غير مضاف. افتح إعدادات المساعد الذكي وأدخل مفتاح ${state.aiProvider === "claude" ? "Anthropic" : "OpenAI"}.`
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
  if (!state.session) {
    return shell(`
      <section class="panel">
        <h2>غير مصرح</h2>
        <p class="muted">المساعد الذكي متاح للموظفين بعد تسجيل الدخول. سجّل الدخول للوصول.</p>
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
          <button class="ai-tab ${state.aiProvider === "claude" ? "active" : ""}" data-ai-provider="claude">كلود (Claude)</button>
          <button class="ai-tab ${state.aiProvider === "chatgpt" ? "active" : ""}" data-ai-provider="chatgpt">شات جي بي تي (ChatGPT)</button>
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
          <strong>مفتاح واجهة البرمجة (API) مفقود.</strong>
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
      <td><input class="inv-input inv-num" data-inv-field="qty" data-inv-index="${i}" value="${escapeHtml(r.qty)}" placeholder="0" type="text" inputmode="decimal" dir="ltr"></td>
      <td><input class="inv-input inv-num" data-inv-field="price" data-inv-index="${i}" value="${escapeHtml(r.price)}" placeholder="0.00" type="text" inputmode="decimal" dir="ltr"></td>
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

// ============================================================================
// ===== فاتورة مبيعات (route: sales) — نواة MVP =====
// وحدة مستقلة تماماً عن route/دالة invoice. تنشئ فاتورة جملة (دولار) أو مفرق
// (ليرة سورية)، تُحفظ عبر dataStore.createSharedDocument كمستند sales_invoice،
// وتُطبع بإعادة استخدام قالب طباعة الفاتورة.
// TODO (خارج النواة الحالية عمداً): خصم المخزون، تقييد الذمم، صلاحيات المدير/
// المحاسب، المرتجعات، آخر سعر للزبون، رصيد الزبون الحيّ، معلومات المستودعات،
// ومزامنة رقم الفاتورة التسلسلي مع الأمين.
// ============================================================================

function salesEmptyRow() {
  return { q: "", key: "", name: "", num: "", unit: "unit2", qty: "1", price: "", edited: false };
}

function salesToEnglishDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function salesCurrentMode() {
  return state.salesMode === "mufrak" ? "mufrak" : "jumla";
}

function salesCurrencySymbol(mode) {
  return mode === "mufrak" ? "ل.س" : "$";
}

function salesItemByKey(key) {
  if (!key) return null;
  return (state.approvedPriceItems || []).find((item) => item.itemKey === key) || null;
}

function salesUnit2Factor(item) {
  const factor = Number(item?.unit2Factor || 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function salesRetailPrice(item) {
  const retail = item?.pricePayload?.retail;
  return Number((retail && retail.price) || 0);
}

function salesUnitLabel(item, unit) {
  if (!item) return unit === "unit1" ? "كروز" : "كرتونة";
  if (unit === "unit1") return item.unit1Name || "كروز";
  return item.unit2Name || "كرتونة";
}

// حساب الإفرادي التلقائي حسب الوضع والوحدة (المرجع: تعليمات المهمة):
//   جملة  → كرتونة = unit2_price ، كروز = unit1_price (بالدولار)
//   مفرق  → كرتونة = round(retail × rate) ، كروز = round(retail ÷ factor × rate) (بالليرة)
function salesAutoUnitPrice(item, unit, mode) {
  if (!item) return 0;
  if (mode === "mufrak") {
    const retail = salesRetailPrice(item);
    const rate = Number(state.syriaExchangeRate) || 0;
    if (!(retail > 0) || !(rate > 0)) return 0;
    if (unit === "unit1") return Math.round((retail / salesUnit2Factor(item)) * rate);
    return Math.round(retail * rate);
  }
  if (unit === "unit1") return roundPrice(Number(item.unit1Price || 0));
  return roundPrice(Number(item.unit2Price || 0));
}

// تنسيق رقم للعرض: جملة بخانتين عشريتين، مفرق بأرقام صحيحة وفواصل آلاف — إنجليزية دائماً.
function salesFmt(value, mode) {
  const number = Number(value || 0);
  if (mode === "mufrak") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(number));
  }
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}

// رقم خام بلا فواصل آلاف (لحقول الإدخال كي لا يعبث بها مُطبِّع الأرقام).
function salesFmtPlain(value, mode) {
  const number = Number(value || 0);
  if (mode === "mufrak") return String(Math.round(number));
  return (Math.round((number + Number.EPSILON) * 100) / 100).toFixed(2);
}

function salesMoney(value, mode) {
  if (mode === "mufrak") return `${salesFmt(value, "mufrak")} ل.س`;
  return `$${salesFmt(value, "jumla")}`;
}

// بحث/مطابقة جزئية على رقم الصنف (item_number) والاسم (item_name) معاً.
function salesSearchItems(query, limit = 8) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const list = state.approvedPriceItems || [];
  if (!list.length) return [];
  const normalizedQuery = normalizeItemName(raw);
  const digits = normalizeNumericText(raw, { allowNegative: false, allowDecimal: false });
  const scored = [];
  for (const item of list) {
    const number = String(item.itemNumber || "");
    const normalizedName = normalizeItemName(item.itemName || "");
    let score = -1;
    if (digits && number) {
      if (number === digits) score = 100;
      else if (number.startsWith(digits)) score = 92;
      else if (number.includes(digits)) score = 74;
    }
    if (normalizedQuery) {
      if (normalizedName === normalizedQuery) score = Math.max(score, 96);
      else if (normalizedName.startsWith(normalizedQuery)) score = Math.max(score, 86);
      else if (normalizedName.includes(normalizedQuery)) score = Math.max(score, 62);
    }
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.item.itemName || "").localeCompare(String(b.item.itemName || ""), "ar"));
  return scored.slice(0, limit).map((entry) => entry.item);
}

function salesSuggestionsHtml(rowIndex, query) {
  const matches = salesSearchItems(query, 8);
  if (!matches.length) return "";
  const mode = salesCurrentMode();
  return matches
    .map((item) => {
      const number = item.itemNumber
        ? `<span class="sales-suggest-num" dir="ltr">${escapeHtml(item.itemNumber)}</span>`
        : `<span class="sales-suggest-num muted">—</span>`;
      const auto = salesAutoUnitPrice(item, "unit2", mode);
      const priceHint = auto > 0
        ? `<span class="sales-suggest-price" dir="ltr">${escapeHtml(salesMoney(auto, mode))}</span>`
        : `<span class="sales-suggest-price muted">بلا سعر</span>`;
      return `<button type="button" class="sales-suggest-item" data-sales-pick="${escapeHtml(item.itemKey)}" data-sales-row="${rowIndex}">${number}<span class="sales-suggest-name">${escapeHtml(item.itemName)}</span>${priceHint}</button>`;
    })
    .join("");
}

function salesRowComputed(row) {
  const item = row && row.key ? salesItemByKey(row.key) : null;
  const qty = toNumber(row?.qty);
  const price = toNumber(row?.price);
  return { item, qty, price, lineTotal: qty * price };
}

function salesTotals() {
  const grand = (state.salesRows || []).reduce(
    (sum, row) => sum + (row.key ? toNumber(row.qty) * toNumber(row.price) : 0),
    0
  );
  const discount = Math.max(0, toNumber(state.salesDiscount));
  const net = Math.max(0, grand - discount);
  const paid = state.salesPayMethod === "cash" ? net : Math.max(0, toNumber(state.salesPaid));
  const remaining = net - paid;
  return { grand, discount, net, paid, remaining };
}

// حالة المتبقّي بلغة المحاسبة: موجب = على الزبون، سالب = له عندنا، وصفر = مسدّد.
// العتبة تختلف بالعملة: الليرة أرقام صحيحة، والدولار خانتان عشريتان.
function salesRemainingState(remaining, mode) {
  const epsilon = mode === "mufrak" ? 0.5 : 0.005;
  if (Math.abs(remaining) < epsilon) return { status: "settled", label: "مسدّد" };
  if (remaining > 0) return { status: "due", label: "عليه" };
  return { status: "credit", label: "له" };
}

function salesResolvedRows() {
  return (state.salesRows || []).filter((row) => row.key && toNumber(row.qty) > 0 && toNumber(row.price) > 0);
}

// رقم تسلسلي شهري: SAL-YYMM-0001 ثم 0002… ويبدأ من ٠٠٠١ مع كل شهر جديد.
// العدّاد محفوظ محلياً على الجهاز. عند تفعيل خصم المخزون وتقييد الذمم يجب ترقيته
// إلى عدّاد مركزي في Supabase كي لا يتكرّر الرقم إذا فُوتِر من أكثر من جهاز.
function generateSalesInvoiceNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const period = `${yy}${mm}`;
  const saved = readJson("sales-invoice-seq", null);
  const next = saved && saved.period === period ? Number(saved.seq || 0) + 1 : 1;
  writeJson("sales-invoice-seq", { period, seq: next });
  return `SAL-${period}-${String(next).padStart(4, "0")}`;
}

function ensureSalesInvoiceNo() {
  if (!state.salesInvoiceNo) state.salesInvoiceNo = generateSalesInvoiceNumber();
  return state.salesInvoiceNo;
}

function salesEnsureTrailingRow() {
  const rows = state.salesRows;
  if (!rows.length || rows[rows.length - 1].key) rows.push(salesEmptyRow());
}

function salesInvoice() {
  if (!state.session) {
    return shell(`
      <section class="panel">
        <h2>فاتورة مبيعات</h2>
        <p class="muted">سجّل الدخول أولاً للوصول إلى فاتورة المبيعات.</p>
      </section>
    `);
  }

  const mode = salesCurrentMode();
  const symbol = salesCurrencySymbol(mode);
  const invNo = ensureSalesInvoiceNo();
  const totals = salesTotals();
  const rows = state.salesRows;
  const priceLoaded = (state.approvedPriceItems || []).length > 0;

  const rowsHtml = rows
    .map((row, i) => {
      const computed = salesRowComputed(row);
      const resolved = !!computed.item;
      const unitLabel = salesUnitLabel(computed.item, row.unit);
      const otherLabel = salesUnitLabel(computed.item, row.unit === "unit1" ? "unit2" : "unit1");
      return `
    <tr class="inv-row sales-row">
      <td class="sales-cell-search">
        <input class="inv-input sales-search" data-sales-field="q" data-sales-index="${i}" value="${escapeHtml(row.q)}" placeholder="رقم الصنف أو الاسم" dir="auto" autocomplete="off">
        <div class="sales-suggest" data-sales-suggest="${i}"></div>
      </td>
      <td class="sales-cell-name">${resolved ? `<strong>${escapeHtml(computed.item.itemName)}</strong>${computed.item.itemNumber ? `<small class="muted" dir="ltr"> #${escapeHtml(computed.item.itemNumber)}</small>` : ""}` : '<span class="muted">—</span>'}</td>
      <td class="sales-cell-unit">
        <button type="button" class="sales-unit-toggle" data-sales-unit="${i}" ${resolved ? "" : "disabled"} title="${resolved ? `تبديل إلى ${escapeHtml(otherLabel)}` : "اختر صنفاً أولاً"}">${escapeHtml(unitLabel)}</button>
      </td>
      <td><input class="inv-input inv-num sales-qty" data-sales-field="qty" data-sales-num data-sales-index="${i}" value="${escapeHtml(row.qty)}" placeholder="0" type="text" inputmode="decimal" dir="ltr"></td>
      <td><input class="inv-input inv-num sales-price" data-sales-field="price" data-sales-num data-sales-index="${i}" value="${escapeHtml(row.price)}" placeholder="0" type="text" inputmode="decimal" dir="ltr"></td>
      <td class="inv-line-total sales-line-total" data-sales-linetotal="${i}">${resolved ? salesMoney(computed.lineTotal, mode) : "—"}</td>
      <td>${rows.length > 1 && resolved ? `<button class="inv-remove" data-sales-remove="${i}" title="حذف">✕</button>` : ""}</td>
    </tr>`;
    })
    .join("");

  const paidValue = state.salesPayMethod === "cash" ? salesFmtPlain(totals.paid, mode) : state.salesPaid;

  return shell(`
    <section class="panel wide inv-panel sales-panel">
      <div class="inv-form-area">
        <div class="sales-toolbar">
          <div class="sales-mode-switch" role="group" aria-label="وضع التسعير">
            <button type="button" class="sales-mode-btn ${mode === "jumla" ? "active" : ""}" data-sales-mode="jumla">جملة · دولار</button>
            <button type="button" class="sales-mode-btn ${mode === "mufrak" ? "active" : ""}" data-sales-mode="mufrak">مفرق · سوري</button>
          </div>
          ${mode === "mufrak" ? `<span class="sales-rate-chip" dir="ltr">${escapeHtml(formatMoney(state.syriaExchangeRate))} ل.س / $</span>` : ""}
        </div>

        <div class="sales-header-grid">
          <label class="inv-label">رقم الفاتورة
            <input class="inv-input-main" value="${escapeHtml(invNo)}" readonly dir="ltr">
          </label>
          <label class="inv-label">التاريخ
            <input class="inv-input-main" value="${escapeHtml(todayIsoDate())}" readonly dir="ltr">
          </label>
          <label class="inv-label">اسم الزبون (اختياري)
            <input class="inv-input-main" id="sales-customer" value="${escapeHtml(state.salesCustomer)}" placeholder="فارغ = نقدي" maxlength="120" dir="auto">
          </label>
          <label class="inv-label">طريقة الدفع
            <div class="sales-pay-switch">
              <button type="button" class="sales-pay-btn ${state.salesPayMethod === "cash" ? "active" : ""}" data-sales-pay="cash">نقدي</button>
              <button type="button" class="sales-pay-btn ${state.salesPayMethod === "credit" ? "active" : ""}" data-sales-pay="credit">أجل</button>
            </div>
          </label>
        </div>

        ${priceLoaded ? "" : '<p class="muted sales-hint">لم تُحمّل لائحة الأسعار بعد — لن تظهر اقتراحات المواد حتى تُحمّل.</p>'}

        <div class="inv-table-wrap">
          <table class="inv-table sales-table">
            <thead>
              <tr>
                <th style="width:180px">رقم الصنف / الاسم</th>
                <th>الصنف</th>
                <th style="width:92px">الوحدة</th>
                <th style="width:80px">الكمية</th>
                <th style="width:120px">الإفرادي ${escapeHtml(symbol)}</th>
                <th style="width:120px">الإجمالي ${escapeHtml(symbol)}</th>
                <th style="width:34px"></th>
              </tr>
            </thead>
            <tbody id="sales-body">${rowsHtml}</tbody>
          </table>
        </div>

        <div class="sales-summary">
          <div class="sales-summary-row"><span>الإجمالي</span><strong data-sales-total dir="ltr">${salesMoney(totals.grand, mode)}</strong></div>
          <div class="sales-summary-row"><span>حسم (${escapeHtml(symbol)})</span>
            <input class="inv-input-main sales-amount-input" id="sales-discount" data-sales-num value="${escapeHtml(state.salesDiscount)}" placeholder="0" type="text" inputmode="decimal" dir="ltr">
          </div>
          <div class="sales-summary-row sales-summary-net"><span>الصافي</span><strong data-sales-net dir="ltr">${salesMoney(totals.net, mode)}</strong></div>
          <div class="sales-summary-row"><span>المدفوع (${escapeHtml(symbol)})</span>
            <input class="inv-input-main sales-amount-input" id="sales-paid" data-sales-num value="${escapeHtml(paidValue)}" placeholder="0" type="text" inputmode="decimal" dir="ltr" ${state.salesPayMethod === "cash" ? "readonly" : ""}>
          </div>
          <div class="sales-summary-row sales-summary-remaining"><span>المتبقّي <small class="sales-remaining-tag" data-sales-remaining-tag>${escapeHtml(salesRemainingState(totals.remaining, mode).label)}</small></span><strong data-sales-remaining dir="ltr">${salesMoney(Math.abs(totals.remaining), mode)}</strong></div>
        </div>

        <div class="inv-actions sales-actions">
          <button class="button primary" data-action="sales-save">💾 حفظ الفاتورة</button>
          <button class="button secondary" data-action="sales-print">🖨 طباعة / PDF</button>
          <button class="button secondary" data-action="sales-new">＋ فاتورة جديدة</button>
        </div>
      </div>
    </section>
  `);
}

// تحديث جراحي للإجماليات وأسطر المجاميع دون إعادة رسم الصفحة (حفاظاً على تركيز الإدخال).
function refreshSalesTotals() {
  const mode = salesCurrentMode();
  (state.salesRows || []).forEach((row, i) => {
    const cell = document.querySelector(`[data-sales-linetotal="${i}"]`);
    if (!cell) return;
    cell.textContent = row.key ? salesMoney(toNumber(row.qty) * toNumber(row.price), mode) : "—";
  });
  const totals = salesTotals();
  const totalEl = document.querySelector("[data-sales-total]");
  if (totalEl) totalEl.textContent = salesMoney(totals.grand, mode);
  const netEl = document.querySelector("[data-sales-net]");
  if (netEl) netEl.textContent = salesMoney(totals.net, mode);
  const remainingEl = document.querySelector("[data-sales-remaining]");
  if (remainingEl) remainingEl.textContent = salesMoney(Math.abs(totals.remaining), mode);
  const remainingTagEl = document.querySelector("[data-sales-remaining-tag]");
  if (remainingTagEl) remainingTagEl.textContent = salesRemainingState(totals.remaining, mode).label;
  if (state.salesPayMethod === "cash") {
    const paidInput = document.getElementById("sales-paid");
    if (paidInput) paidInput.value = salesFmtPlain(totals.paid, mode);
  }
}

// قائمة الاقتراحات تُعرض position:fixed كي لا يقصّها overflow جدول الأسطر.
function positionSalesSuggest(input, box) {
  const rect = input.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  // visualViewport يعكس المساحة الفعلية عند فتح كيبورد الآيفون (أدق من clientHeight).
  const vh = (window.visualViewport && window.visualViewport.height) || document.documentElement.clientHeight;
  const margin = 8;

  // العرض: لا يتجاوز عرض الشاشة أبداً (كان يفرض 240px فيخرج على الشاشات الضيقة).
  const width = Math.min(Math.max(rect.width, 240), vw - margin * 2);
  box.style.width = `${width}px`;

  // الأفقي: ابدأ من يسار الحقل ثم اضبطه ضمن حدود الشاشة يميناً ويساراً (مهم في RTL).
  let left = rect.left;
  if (left + width > vw - margin) left = vw - margin - width;
  if (left < margin) left = margin;
  box.style.left = `${left}px`;

  // العمودي: تحت الحقل افتراضياً؛ فإن ضاقت المساحة تحته (كيبورد الآيفون) اقلبها فوقه لتبقى مرئية.
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  if (spaceBelow < 160 && spaceAbove > spaceBelow) {
    const h = Math.min(320, spaceAbove - margin);
    box.style.maxHeight = `${Math.max(120, h)}px`;
    box.style.top = `${Math.max(margin, rect.top - h - 2)}px`;
  } else {
    const h = Math.min(320, spaceBelow - margin);
    box.style.maxHeight = `${Math.max(120, h)}px`;
    box.style.top = `${rect.bottom + 2}px`;
  }
}

// إعادة التركيز إلى حقل محدّد بعد إعادة الرسم (render يبني DOM جديداً كلياً).
// أساس العمل بلا ماوس: بعد اختيار الصنف ننتقل للكمية، وEnter ينقل بين الحقول.
function salesFocusField(rowIndex, field) {
  const focusNow = () => {
    const el = document.querySelector(`[data-sales-field="${field}"][data-sales-index="${rowIndex}"]`);
    if (!el) return false;
    el.focus();
    if (typeof el.select === "function") el.select();
    return true;
  };
  // المحاولة الفورية مقصودة: تبقى داخل سياق لمسة المستخدم، وهو شرط iOS لفتح الكيبورد.
  // rAF احتياط فقط لو لم يكن العنصر قد رُسم بعد.
  if (focusNow()) return;
  requestAnimationFrame(focusNow);
}

function salesPickItem(rowIndex, key) {
  const row = state.salesRows[rowIndex];
  const item = salesItemByKey(key);
  if (!row || !item) return;
  const mode = salesCurrentMode();
  row.key = item.itemKey;
  row.name = item.itemName;
  row.num = item.itemNumber || "";
  row.q = item.itemNumber ? String(item.itemNumber) : item.itemName;
  if (row.unit !== "unit1" && row.unit !== "unit2") row.unit = "unit2";
  const auto = salesAutoUnitPrice(item, row.unit, mode);
  row.price = auto > 0 ? String(auto) : "";
  row.edited = false;
  if (!(toNumber(row.qty) > 0)) row.qty = "1";
  salesEnsureTrailingRow();
  render();
  // بعد اختيار الصنف ينتقل التركيز تلقائياً إلى الكمية (متطلب العمل بلا ماوس).
  salesFocusField(rowIndex, "qty");
}

function salesToggleUnit(rowIndex) {
  const row = state.salesRows[rowIndex];
  if (!row || !row.key) return;
  const item = salesItemByKey(row.key);
  const mode = salesCurrentMode();
  row.unit = row.unit === "unit1" ? "unit2" : "unit1";
  // تغيّر الوحدة يغيّر أساس السعر ⇐ نعيد حساب الإفرادي التلقائي ونلغي أي تعديل يدوي سابق.
  const auto = salesAutoUnitPrice(item, row.unit, mode);
  row.price = auto > 0 ? String(auto) : "";
  row.edited = false;
  render();
}

function salesSetMode(mode) {
  const next = mode === "mufrak" ? "mufrak" : "jumla";
  state.salesMode = next;
  writeJson("sales-mode", next);
  // تغيّر الوضع يغيّر العملة والأساس ⇐ نعيد تسعير كل الأسطر تلقائياً ونلغي التعديلات اليدوية.
  (state.salesRows || []).forEach((row) => {
    if (!row.key) return;
    const auto = salesAutoUnitPrice(salesItemByKey(row.key), row.unit, next);
    row.price = auto > 0 ? String(auto) : "";
    row.edited = false;
  });
  render();
}

function salesNewInvoice() {
  state.salesRows = [salesEmptyRow()];
  state.salesCustomer = "";
  state.salesDiscount = "";
  state.salesPaid = "";
  state.salesPayMethod = "cash";
  state.salesInvoiceNo = generateSalesInvoiceNumber();
  state.salesSavedNo = "";
  setNotice("success", "بدأت فاتورة مبيعات جديدة.");
  render();
}

async function salesSaveInvoice() {
  const resolved = salesResolvedRows();
  if (!resolved.length) {
    setNotice("error", "أضف صنفاً واحداً على الأقل بكمية وسعر أكبر من صفر.");
    render();
    return;
  }
  // منع حفظ الفاتورة نفسها مرتين (ضغط مزدوج أو إعادة ضغط بعد نجاح الحفظ).
  if (state.salesSavedNo && state.salesSavedNo === state.salesInvoiceNo) {
    setNotice("error", `الفاتورة ${state.salesSavedNo} محفوظة مسبقاً — اضغط «＋ فاتورة جديدة» لإصدار فاتورة أخرى.`);
    render();
    return;
  }
  const mode = salesCurrentMode();
  const totals = salesTotals();
  const roundValue = (value) => (mode === "mufrak" ? Math.round(Number(value || 0)) : roundPrice(Number(value || 0)));
  const doc = {
    t: "sales_invoice",
    no: ensureSalesInvoiceNo(),
    date: todayIsoDate(),
    name: state.salesCustomer.trim(),
    payMethod: state.salesPayMethod,
    mode,
    cur: salesCurrencySymbol(mode),
    rate: mode === "mufrak" ? Number(state.syriaExchangeRate) || 0 : null,
    items: resolved.map((row) => {
      const item = salesItemByKey(row.key);
      const qty = toNumber(row.qty);
      const price = toNumber(row.price);
      return {
        num: item?.itemNumber || row.num || "",
        name: item?.itemName || row.name || "",
        unit: salesUnitLabel(item, row.unit),
        unitKey: row.unit,
        qty,
        price: roundValue(price),
        total: roundValue(qty * price)
      };
    }),
    total: roundValue(totals.grand),
    discount: roundValue(totals.discount),
    net: roundValue(totals.net),
    paid: roundValue(totals.paid),
    remaining: roundValue(totals.remaining)
  };
  try {
    await dataStore.createSharedDocument(doc);
    state.salesSavedNo = doc.no;
    // TODO: عند تفعيل النواة الكاملة يُخصم المخزون ويُقيَّد على ذمة الزبون هنا.
    setNotice("success", `تم حفظ فاتورة المبيعات ${doc.no} بالنظام والأرشيف ✓`);
  } catch (error) {
    setNotice("error", "تعذّر حفظ الفاتورة: " + safeErrorMessage(error));
  }
  render();
}

// إعادة استخدام قالب طباعة الفاتورة (نفس CSS) مع تكييف بسيط: أعمدة الوحدة/الرقم
// وكتلة مجاميع (إجمالي/حسم/صافي/مدفوع/متبقٍّ) ودعم عملة الليرة في وضع المفرق.
function printSalesInvoice() {
  const resolved = salesResolvedRows();
  if (!resolved.length) {
    setNotice("error", "أضف صنفاً واحداً على الأقل بكمية وسعر قبل الطباعة.");
    render();
    return;
  }
  const mode = salesCurrentMode();
  const invNo = ensureSalesInvoiceNo();
  const totals = salesTotals();
  const today = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "long" }).format(new Date());
  const customer = state.salesCustomer.trim() || "زبون نقدي";
  const payLabel = state.salesPayMethod === "credit" ? "أجل" : "نقدي";
  const curLabel = mode === "mufrak"
    ? `ليرة سورية (SYP) — صرف ${formatMoney(state.syriaExchangeRate)}`
    : "دولار أمريكي (USD)";

  const rowsHtml = resolved
    .map((row, i) => {
      const item = salesItemByKey(row.key);
      const qty = toNumber(row.qty);
      const price = toNumber(row.price);
      return `
    <tr>
      <td class="col-num">${i + 1}</td>
      <td dir="ltr">${escapeHtml(item?.itemNumber || row.num || "")}</td>
      <td>${escapeHtml(item?.itemName || row.name || "")}</td>
      <td>${escapeHtml(salesUnitLabel(item, row.unit))}</td>
      <td>${escapeHtml(formatMoney(qty))}</td>
      <td class="col-price">${escapeHtml(salesMoney(price, mode))}</td>
      <td class="col-total">${escapeHtml(salesMoney(qty * price, mode))}</td>
    </tr>`;
    })
    .join("");

  const summaryHtml = `
    <tr><td>الإجمالي</td><td class="col-total">${escapeHtml(salesMoney(totals.grand, mode))}</td></tr>
    ${totals.discount > 0 ? `<tr><td>حسم</td><td class="col-total">− ${escapeHtml(salesMoney(totals.discount, mode))}</td></tr>` : ""}
    <tr class="sum-strong"><td>الصافي</td><td class="col-total">${escapeHtml(salesMoney(totals.net, mode))}</td></tr>
    <tr><td>المدفوع (${escapeHtml(payLabel)})</td><td class="col-total">${escapeHtml(salesMoney(totals.paid, mode))}</td></tr>
    <tr class="sum-strong"><td>المتبقّي (${escapeHtml(salesRemainingState(totals.remaining, mode).label)})</td><td class="col-total">${escapeHtml(salesMoney(Math.abs(totals.remaining), mode))}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة مبيعات ${invNo}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 40px; direction: rtl; }
  .inv-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 3px solid #b8860b; padding-bottom: 20px; }
  .inv-company { font-size: 22px; font-weight: 700; color: #5c3d00; letter-spacing: 1px; }
  .inv-company small { display: block; font-size: 12px; font-weight: 400; color: #888; margin-top: 4px; }
  .inv-meta { text-align: left; direction: ltr; }
  .inv-meta p { margin: 3px 0; font-size: 12px; color: #555; }
  .inv-meta strong { color: #1a1a1a; }
  .doc-type { font-size: 14px; font-weight: 700; color: #5c3d00; }
  .inv-num { font-size: 16px; font-weight: 700; color: #b8860b; }
  .inv-customer { background: #faf7f0; border: 1px solid #e8dfc8; border-radius: 6px; padding: 14px 18px; margin-bottom: 28px; display: flex; justify-content: space-between; gap: 12px; }
  .inv-customer p { font-size: 12px; color: #888; margin-bottom: 4px; }
  .inv-customer strong { font-size: 15px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #5c3d00; color: #fff; padding: 10px 12px; text-align: right; font-size: 12px; }
  td { padding: 9px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
  tr:nth-child(even) td { background: #fdf9f3; }
  .col-num { width: 36px; text-align: center; color: #aaa; }
  .col-price, .col-total { text-align: left; direction: ltr; font-family: monospace; }
  .summary-wrap { display: flex; justify-content: flex-start; }
  .summary-table { width: 320px; margin-bottom: 24px; }
  .summary-table td { border-bottom: 1px solid #eee; }
  .summary-table tr:nth-child(even) td { background: transparent; }
  .summary-table .sum-strong td { border-top: 2px solid #b8860b; font-weight: 700; font-size: 14px; background: #faf7f0; }
  .notes { font-size: 12px; color: #666; margin-bottom: 28px; padding: 10px 14px; border-right: 3px solid #b8860b; background: #fdfaf5; }
  .inv-foot { text-align: center; font-size: 11px; color: #aaa; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px; }
  @media print { body { padding: 24px; } @page { margin: 1.5cm; } }
</style>
</head>
<body>
<div class="inv-head">
  <div>
    <div class="inv-company">${escapeHtml(appConfig.name)}${appConfig.tagline ? `<small>${escapeHtml(appConfig.tagline)}</small>` : ""}</div>
  </div>
  <div class="inv-meta">
    <p class="doc-type">فاتورة مبيعات</p>
    <p class="inv-num">${escapeHtml(invNo)}</p>
    <p><strong>التاريخ:</strong> ${today}</p>
    <p><strong>طريقة الدفع:</strong> ${escapeHtml(payLabel)}</p>
    <p><strong>العملة:</strong> ${escapeHtml(curLabel)}</p>
  </div>
</div>

<div class="inv-customer">
  <div>
    <p>فاتورة إلى</p>
    <strong>${escapeHtml(customer)}</strong>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th class="col-num">#</th>
      <th style="width:70px">الرقم</th>
      <th>المادة</th>
      <th style="width:70px">الوحدة</th>
      <th style="width:60px">الكمية</th>
      <th style="width:110px" class="col-price">الإفرادي</th>
      <th style="width:120px" class="col-total">الإجمالي</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>

<div class="summary-wrap">
  <table class="summary-table">
    <tbody>${summaryHtml}</tbody>
  </table>
</div>

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

// ===== فواتير المشتريات (طلبات الشراء من الموردين) =====
// تسجيل داخلي فقط: لا طباعة ولا تصدير ولا مزامنة مع الأمين أو أي جهة أخرى.
function purchases() {
  if (!state.session) {
    return shell(`
      <section class="panel">
        <h2>فواتير المشتريات</h2>
        <p class="muted">سجّل الدخول أولاً للوصول إلى فواتير المشتريات.</p>
      </section>
    `);
  }

  const rows = state.poRows;
  const grandTotal = rows.reduce((sum, r) => sum + toNumber(r.qty) * toNumber(r.price), 0);

  const rowsHtml = rows.map((r, i) => `
    <tr class="inv-row">
      <td><input class="inv-input" data-po-field="name" data-po-index="${i}" value="${escapeHtml(r.name)}" placeholder="اسم الصنف المطلوب" dir="auto" list="po-items-list"></td>
      <td><input class="inv-input inv-num" data-po-field="qty" data-po-index="${i}" value="${escapeHtml(r.qty)}" placeholder="0" type="number" min="0" step="any"></td>
      <td><input class="inv-input inv-num" data-po-field="price" data-po-index="${i}" value="${escapeHtml(r.price)}" placeholder="اختياري" type="number" min="0" step="any"></td>
      <td class="inv-line-total">$${(toNumber(r.qty) * toNumber(r.price)).toFixed(2)}</td>
      <td>${rows.length > 1 ? `<button class="inv-remove" data-po-remove="${i}" title="حذف">✕</button>` : ""}</td>
    </tr>
  `).join("");

  const itemNames = [...new Set((state.approvedPriceItems || []).map((p) => p.itemName).filter(Boolean))];
  const datalistHtml = `<datalist id="po-items-list">${itemNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>`;

  const savedList = state.purchaseInvoices.length
    ? state.purchaseInvoices.map(purchaseInvoiceCard).join("")
    : '<p class="muted">لا توجد فواتير مشتريات مسجلة بعد. سجّل أول فاتورة من النموذج أعلاه.</p>';

  return shell(`
    <section class="notice-panel warning" style="margin-bottom:16px">
      <span>🗒 سجل طلبات الشراء: سجّل الفاتورة ثم اطبعها أو انسخ نصها لإرسالها إلى المورد — لا تُنزَّل إلى الأمين ولا تؤثر على المخزون أو الحسابات.</span>
    </section>

    <section class="panel wide inv-panel">
      <div class="inv-form-area">
        <h2 style="margin:0">تسجيل فاتورة مشتريات جديدة</h2>
        <div class="inv-header-fields">
          <label class="inv-label">
            اسم المورد
            <input class="inv-input-main" id="po-supplier" value="${escapeHtml(state.poSupplier)}" placeholder="اسم المورد أو الشركة" maxlength="240">
          </label>
          <label class="inv-label">
            تاريخ الطلب
            <input class="inv-input-main" id="po-date" type="date" value="${escapeHtml(state.poDate || todayIsoDate())}">
          </label>
        </div>
        <label class="inv-label">
          ملاحظات (اختياري)
          <input class="inv-input-main" id="po-notes" value="${escapeHtml(state.poNotes)}" placeholder="شروط التسليم، طريقة الدفع، إلخ…" maxlength="500">
        </label>

        ${datalistHtml}
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>الصنف المطلوب</th>
                <th style="width:90px">الكمية</th>
                <th style="width:130px">سعر تقديري $ (اختياري)</th>
                <th style="width:100px">المجموع $</th>
                <th style="width:36px"></th>
              </tr>
            </thead>
            <tbody id="po-body">${rowsHtml}</tbody>
          </table>
        </div>

        <div class="inv-footer">
          <button class="button secondary" data-action="po-add-row">+ إضافة صنف</button>
          <div class="inv-total-box">
            <span>الإجمالي التقديري</span>
            <strong class="inv-grand-total po-grand-total">$${grandTotal.toFixed(2)}</strong>
          </div>
        </div>

        <div class="inv-actions">
          <button class="button primary" data-action="po-save" ${state.poSaving ? "disabled" : ""}>${state.poSaving ? "جاري الحفظ…" : "💾 تسجيل الفاتورة"}</button>
          <button class="button secondary" data-action="po-reset" ${state.poSaving ? "disabled" : ""}>مسح</button>
        </div>
      </div>
    </section>

    <section class="panel wide" style="margin-top:16px">
      <div class="panel-title-row">
        <h2 style="margin:0">الفواتير المسجلة (${state.purchaseInvoices.length})</h2>
      </div>
      <div class="po-list">${savedList}</div>
    </section>
  `);
}

function purchaseInvoiceCard(po) {
  const expanded = state.poOpenId === po.id;
  const received = po.status === "received";
  const chip = received
    ? '<span class="status-chip chip-ready">مستلمة</span>'
    : '<span class="status-chip chip-progress">قيد الطلب</span>';
  const totalText = po.total > 0 ? `$${po.total.toFixed(2)}` : "بدون أسعار";
  const detailRows = po.items.map((item, idx) => `
    <tr>
      <td style="width:32px;color:var(--muted)">${idx + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="inv-num">${escapeHtml(String(item.qty))}</td>
      <td class="inv-line-total">${item.price > 0 ? `$${item.price.toFixed(2)}` : "—"}</td>
      <td class="inv-line-total">${item.price > 0 ? `$${(item.qty * item.price).toFixed(2)}` : "—"}</td>
    </tr>
  `).join("");

  return `
    <article class="po-card ${received ? "po-received" : ""}">
      <div class="po-card-head">
        <div class="po-card-info">
          <strong>${escapeHtml(po.publicId)} — ${escapeHtml(po.supplierName)}</strong>
          <small class="muted">${escapeHtml(po.orderDate)} · ${po.items.length} صنف · ${escapeHtml(totalText)}</small>
        </div>
        <div class="po-card-actions">
          ${chip}
          <button class="button secondary compact-button" type="button" data-po-toggle="${escapeHtml(po.id)}">${expanded ? "إخفاء التفاصيل" : "التفاصيل"}</button>
          <button class="button secondary compact-button" type="button" data-po-print="${escapeHtml(po.id)}" title="طباعة طلب الشراء أو حفظه PDF لإرساله للمورد">🖨 طباعة / PDF</button>
          <button class="button secondary compact-button" type="button" data-po-copy="${escapeHtml(po.id)}" title="نسخ نص الطلب للصقه في محادثة المورد">📋 نسخ للإرسال</button>
          <button class="button secondary compact-button" type="button" data-po-status="${escapeHtml(po.id)}" data-po-next="${received ? "open" : "received"}">${received ? "إعادة لقيد الطلب" : "✓ استلمتها"}</button>
          <button class="button secondary compact-button po-delete" type="button" data-po-delete="${escapeHtml(po.id)}">حذف</button>
        </div>
      </div>
      ${expanded ? `
        <div class="inv-table-wrap" style="margin-top:12px">
          <table class="inv-table">
            <thead><tr><th style="width:32px">#</th><th>الصنف</th><th style="width:80px">الكمية</th><th style="width:100px">السعر $</th><th style="width:100px">المجموع $</th></tr></thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
        ${po.notes ? `<p class="muted" style="margin:10px 4px 0">📝 ${escapeHtml(po.notes)}</p>` : ""}
      ` : ""}
    </article>
  `;
}

async function savePurchaseInvoice() {
  if (state.poSaving) return;
  const supplier = state.poSupplier.trim();
  const items = state.poRows
    .map((r) => ({ name: r.name.trim(), qty: toNumber(r.qty), price: toNumber(r.price) }))
    .filter((r) => r.name && r.qty > 0);
  if (!supplier) {
    setNotice("error", "اكتب اسم المورد أولاً.");
    render();
    return;
  }
  if (!items.length) {
    setNotice("error", "أضف صنفاً واحداً على الأقل مع كمية أكبر من صفر.");
    render();
    return;
  }
  state.poSaving = true;
  render();
  try {
    await dataStore.createPurchaseInvoice({
      supplierName: supplier,
      orderDate: state.poDate || todayIsoDate(),
      notes: state.poNotes,
      items
    });
    await loadPurchaseInvoices();
    state.poSupplier = "";
    state.poDate = "";
    state.poNotes = "";
    state.poRows = [{ name: "", qty: "1", price: "" }];
    setNotice("success", "تم تسجيل فاتورة المشتريات ✓ — اطبعها أو انسخ نصها من القائمة أدناه لإرسالها إلى المورد.");
  } catch (error) {
    setNotice("error", safeErrorMessage(error));
    if (/سجل الدخول/i.test(error.message || "")) state.route = "login";
  } finally {
    state.poSaving = false;
    render();
  }
}

async function setPurchaseInvoiceStatus(id, status) {
  try {
    await dataStore.updatePurchaseInvoiceStatus(id, status);
    await loadPurchaseInvoices();
    setNotice("success", status === "received" ? "تم تحديد الفاتورة كمستلمة." : "أُعيدت الفاتورة إلى قيد الطلب.");
  } catch (error) {
    setNotice("error", safeErrorMessage(error));
  }
  render();
}

async function removePurchaseInvoice(id) {
  if (!confirm("حذف هذه الفاتورة نهائياً من السجل؟")) return;
  try {
    await dataStore.deletePurchaseInvoice(id);
    await loadPurchaseInvoices();
    setNotice("success", "تم حذف الفاتورة من السجل.");
  } catch (error) {
    setNotice("error", safeErrorMessage(error));
  }
  render();
}

// نص طلب الشراء للإرسال إلى المورد (واتساب أو غيره) — الأسعار تظهر فقط إذا أُدخلت
function buildPurchaseInvoiceText(po) {
  const showPrices = po.total > 0;
  const lines = po.items.map((item, idx) => {
    const base = `${idx + 1}) ${item.name} — الكمية: ${item.qty}`;
    return showPrices && item.price > 0 ? `${base} — السعر المتوقع: $${item.price.toFixed(2)}` : base;
  });
  const parts = [
    `📋 طلب شراء ${po.publicId}`,
    `من: ${appConfig.name}`,
    `التاريخ: ${po.orderDate}`,
    `إلى المورد: ${po.supplierName}`,
    "",
    "الأصناف المطلوبة:",
    ...lines
  ];
  if (showPrices) parts.push("", `الإجمالي التقديري: $${po.total.toFixed(2)}`);
  if (po.notes) parts.push("", `ملاحظات: ${po.notes}`);
  return parts.join("\n");
}

async function copyPurchaseInvoiceText(id) {
  const po = state.purchaseInvoices.find((p) => p.id === id);
  if (!po) return;
  const text = buildPurchaseInvoiceText(po);
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      copied = document.execCommand("copy");
      area.remove();
    } catch {
      copied = false;
    }
  }
  setNotice(copied ? "success" : "error", copied ? "تم نسخ نص طلب الشراء — ألصقه في محادثة المورد (واتساب أو غيره)." : "تعذّر النسخ التلقائي. افتح التفاصيل وانسخ الأصناف يدوياً.");
  render();
}

function printPurchaseInvoice(id) {
  const po = state.purchaseInvoices.find((p) => p.id === id);
  if (!po) return;
  const showPrices = po.total > 0;
  const printDate = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "long" }).format(new Date());

  const rowsHtml = po.items.map((item, i) => `
    <tr>
      <td class="col-num">${i + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(String(item.qty))}</td>
      ${showPrices ? `
        <td class="col-price">${item.price > 0 ? `$${item.price.toFixed(2)}` : "—"}</td>
        <td class="col-total">${item.price > 0 ? `$${(item.qty * item.price).toFixed(2)}` : "—"}</td>
      ` : ""}
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>طلب شراء ${po.publicId}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 40px; direction: rtl; }
  .inv-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 3px solid #b8860b; padding-bottom: 20px; }
  .inv-company { font-size: 22px; font-weight: 700; color: #5c3d00; letter-spacing: 1px; }
  .inv-company small { display: block; font-size: 12px; font-weight: 400; color: #888; margin-top: 4px; }
  .inv-meta { text-align: left; direction: ltr; }
  .inv-meta p { margin: 3px 0; font-size: 12px; color: #555; }
  .inv-meta strong { color: #1a1a1a; }
  .doc-type { font-size: 14px; font-weight: 700; color: #5c3d00; }
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
    <div class="inv-company">${escapeHtml(appConfig.name)}${appConfig.tagline ? `<small>${escapeHtml(appConfig.tagline)}</small>` : ""}</div>
  </div>
  <div class="inv-meta">
    <p class="doc-type">طلب شراء</p>
    <p class="inv-num">${escapeHtml(po.publicId)}</p>
    <p><strong>تاريخ الطلب:</strong> ${escapeHtml(po.orderDate)}</p>
    <p><strong>تاريخ الطباعة:</strong> ${printDate}</p>
    ${showPrices ? "<p><strong>العملة:</strong> دولار أمريكي (USD)</p>" : ""}
  </div>
</div>

<div class="inv-customer">
  <p>طلب شراء إلى المورد</p>
  <strong>${escapeHtml(po.supplierName)}</strong>
</div>

<table>
  <thead>
    <tr>
      <th class="col-num">#</th>
      <th>الصنف المطلوب</th>
      <th style="width:70px">الكمية</th>
      ${showPrices ? '<th style="width:110px" class="col-price">السعر المتوقع</th><th style="width:110px" class="col-total">المجموع</th>' : ""}
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  ${showPrices ? `
  <tfoot>
    <tr class="total-row">
      <td colspan="3"></td>
      <td>الإجمالي</td>
      <td class="col-total">$${po.total.toFixed(2)}</td>
    </tr>
  </tfoot>
  ` : ""}
</table>

${po.notes ? `<div class="notes"><strong>ملاحظة:</strong> ${escapeHtml(po.notes)}</div>` : ""}

<div class="inv-foot">${escapeHtml(appConfig.name)} &mdash; ${escapeHtml(appConfig.supportEmail)}</div>

</body></html>`;

  const win = window.open("", "_blank", "width=850,height=1100");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  } else {
    setNotice("error", "يرجى السماح بالنوافذ المنبثقة لطباعة طلب الشراء.");
    render();
  }
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
    <div class="inv-company">${escapeHtml(appConfig.name)}${appConfig.tagline ? `<small>${escapeHtml(appConfig.tagline)}</small>` : ""}</div>
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
  // حفظ الفاتورة بالنظام (للأرشفة على اللابتوب) + إرسالها واتساب للزبون
  sendInvoiceWhatsapp(customer, rows, notes, grandTotal, invNum);
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
  const latest = latestStockReport();
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
      // البطاقة تُرسم أعلى القائمة — ننزل إليها تلقائياً حتى يراها المستخدم
      requestAnimationFrame(() => {
        app.querySelector("[data-customer-detail-panel]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
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
  const items = generalPricingWorklistItems();
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
    balances: customerBalancesPage,
    pricing,
    remote,
    monitoring,
    payments,
    invoice,
    sales: salesInvoice,
    purchases,
    dashboard: reportsPage,
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
    const printButton = app.querySelector("[data-action='inv-print']");
    if (printButton) {
      const customerMissing = !state.invCustomer.trim();
      printButton.disabled = customerMissing;
      if (customerMissing) printButton.title = "أدخل اسم العميل أولاً";
      else printButton.removeAttribute("title");
    }
  });
  app.querySelector("#inv-notes")?.addEventListener("input", (e) => {
    state.invNotes = e.currentTarget.value;
  });
  app.querySelectorAll("[data-inv-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const i = Number(e.currentTarget.dataset.invIndex);
      const field = e.currentTarget.dataset.invField;
      if (field === "qty" || field === "price") {
        const normalized = normalizeNumericText(e.currentTarget.value, { allowNegative: false, allowDecimal: true });
        if (normalized !== e.currentTarget.value) e.currentTarget.value = normalized;
      }
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
  // Purchase invoices handlers (فواتير المشتريات — تسجيل داخلي فقط)
  app.querySelector("#po-supplier")?.addEventListener("input", (e) => {
    state.poSupplier = e.currentTarget.value;
  });
  app.querySelector("#po-date")?.addEventListener("change", (e) => {
    state.poDate = e.currentTarget.value;
  });
  app.querySelector("#po-notes")?.addEventListener("input", (e) => {
    state.poNotes = e.currentTarget.value;
  });
  app.querySelectorAll("[data-po-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const i = Number(e.currentTarget.dataset.poIndex);
      const field = e.currentTarget.dataset.poField;
      if (!state.poRows[i]) return;
      state.poRows[i][field] = e.currentTarget.value;
      const tbody = document.getElementById("po-body");
      if (tbody) {
        const cells = tbody.querySelectorAll("tr")[i]?.querySelectorAll(".inv-line-total");
        if (cells?.[0]) {
          const qty = toNumber(state.poRows[i].qty);
          const price = toNumber(state.poRows[i].price);
          cells[0].textContent = `$${(qty * price).toFixed(2)}`;
        }
        const grandEl = document.querySelector(".po-grand-total");
        if (grandEl) {
          const total = state.poRows.reduce((s, r) => s + toNumber(r.qty) * toNumber(r.price), 0);
          grandEl.textContent = `$${total.toFixed(2)}`;
        }
      }
    });
  });
  app.querySelectorAll("[data-po-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.poRows.splice(Number(btn.dataset.poRemove), 1);
      render();
    });
  });
  app.querySelector("[data-action='po-add-row']")?.addEventListener("click", () => {
    state.poRows.push({ name: "", qty: "1", price: "" });
    render();
  });
  app.querySelector("[data-action='po-save']")?.addEventListener("click", savePurchaseInvoice);
  app.querySelector("[data-action='po-reset']")?.addEventListener("click", () => {
    state.poSupplier = "";
    state.poDate = "";
    state.poNotes = "";
    state.poRows = [{ name: "", qty: "1", price: "" }];
    render();
  });
  app.querySelectorAll("[data-po-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.poToggle;
      state.poOpenId = state.poOpenId === id ? "" : id;
      render();
    });
  });
  app.querySelectorAll("[data-po-status]").forEach((btn) => {
    btn.addEventListener("click", () => setPurchaseInvoiceStatus(btn.dataset.poStatus, btn.dataset.poNext));
  });
  app.querySelectorAll("[data-po-delete]").forEach((btn) => {
    btn.addEventListener("click", () => removePurchaseInvoice(btn.dataset.poDelete));
  });
  app.querySelectorAll("[data-po-print]").forEach((btn) => {
    btn.addEventListener("click", () => printPurchaseInvoice(btn.dataset.poPrint));
  });
  app.querySelectorAll("[data-po-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copyPurchaseInvoiceText(btn.dataset.poCopy));
  });

  // ===== فاتورة مبيعات (route: sales) =====
  app.querySelector("#sales-customer")?.addEventListener("input", (e) => {
    state.salesCustomer = e.currentTarget.value; // بلا render حفاظاً على التركيز
  });
  app.querySelector("#sales-discount")?.addEventListener("input", (e) => {
    const normalized = normalizeNumericText(e.currentTarget.value, { allowNegative: false, allowDecimal: true });
    if (normalized !== e.currentTarget.value) e.currentTarget.value = normalized;
    state.salesDiscount = e.currentTarget.value;
    refreshSalesTotals();
  });
  app.querySelector("#sales-paid")?.addEventListener("input", (e) => {
    if (state.salesPayMethod === "cash") return; // النقدي تلقائي = الصافي
    const normalized = normalizeNumericText(e.currentTarget.value, { allowNegative: false, allowDecimal: true });
    if (normalized !== e.currentTarget.value) e.currentTarget.value = normalized;
    state.salesPaid = e.currentTarget.value;
    refreshSalesTotals();
  });
  app.querySelectorAll("[data-sales-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const i = Number(e.currentTarget.dataset.salesIndex);
      const field = e.currentTarget.dataset.salesField;
      if (!state.salesRows[i]) return;
      if (field === "qty" || field === "price") {
        const normalized = normalizeNumericText(e.currentTarget.value, { allowNegative: false, allowDecimal: true });
        if (normalized !== e.currentTarget.value) e.currentTarget.value = normalized;
        state.salesRows[i][field] = e.currentTarget.value;
        if (field === "price") state.salesRows[i].edited = true;
        refreshSalesTotals();
      } else if (field === "q") {
        const eng = salesToEnglishDigits(e.currentTarget.value);
        if (eng !== e.currentTarget.value) e.currentTarget.value = eng;
        state.salesRows[i].q = e.currentTarget.value;
        const box = app.querySelector(`[data-sales-suggest="${i}"]`);
        if (box) {
          const html = salesSuggestionsHtml(i, e.currentTarget.value);
          box.innerHTML = html;
          if (html) positionSalesSuggest(e.currentTarget, box);
        }
      }
    });
  });
  // اختصارات كيبورد للعمل بلا ماوس: Enter ينتقل بحث ← كمية ← سعر ← بحث السطر التالي،
  // وفي حقل البحث يعتمد أول اقتراح ظاهر مباشرة بدل النقر عليه.
  app.querySelectorAll("[data-sales-field]").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const i = Number(e.currentTarget.dataset.salesIndex);
      const field = e.currentTarget.dataset.salesField;
      if (field === "q") {
        const first = app.querySelector(`[data-sales-suggest="${i}"] [data-sales-pick]`);
        if (first) {
          salesPickItem(i, first.dataset.salesPick);
          return;
        }
        salesFocusField(i, "qty");
        return;
      }
      if (field === "qty") {
        salesFocusField(i, "price");
        return;
      }
      if (field === "price") salesFocusField(i + 1, "q");
    });
  });
  app.querySelectorAll("[data-sales-field='q']").forEach((input) => {
    input.addEventListener("blur", (e) => {
      const i = Number(e.currentTarget.dataset.salesIndex);
      // تأخير بسيط كي تُسجَّل نقرة الاقتراح قبل إخفاء القائمة.
      setTimeout(() => {
        const box = app.querySelector(`[data-sales-suggest="${i}"]`);
        if (box) box.innerHTML = "";
      }, 180);
    });
  });
  // تفويض حدث للاقتراحات لأنها تُحقن ديناميكياً؛ mousedown+preventDefault يمنع blur المبكر.
  app.querySelector("#sales-body")?.addEventListener("mousedown", (e) => {
    const pick = e.target.closest("[data-sales-pick]");
    if (!pick) return;
    e.preventDefault();
    salesPickItem(Number(pick.dataset.salesRow), pick.dataset.salesPick);
  });
  app.querySelectorAll("[data-sales-unit]").forEach((btn) => {
    btn.addEventListener("click", () => salesToggleUnit(Number(btn.dataset.salesUnit)));
  });
  app.querySelectorAll("[data-sales-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.salesRows.splice(Number(btn.dataset.salesRemove), 1);
      salesEnsureTrailingRow();
      render();
    });
  });
  app.querySelectorAll("[data-sales-mode]").forEach((btn) => {
    btn.addEventListener("click", () => salesSetMode(btn.dataset.salesMode));
  });
  app.querySelectorAll("[data-sales-pay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.salesPayMethod = btn.dataset.salesPay === "credit" ? "credit" : "cash";
      if (state.salesPayMethod === "cash") state.salesPaid = "";
      render();
    });
  });
  app.querySelector("[data-action='sales-save']")?.addEventListener("click", salesSaveInvoice);
  app.querySelector("[data-action='sales-print']")?.addEventListener("click", printSalesInvoice);
  app.querySelector("[data-action='sales-new']")?.addEventListener("click", salesNewInvoice);

  app.querySelector("[data-action='ai-clear']")?.addEventListener("click", () => {
    state.aiMessages = [];
    render();
  });

  app.querySelector("[data-action='ai-settings-toggle']")?.addEventListener("click", () => {
    state.aiSettingsOpen = !state.aiSettingsOpen;
    render();
  });

  app.querySelector("[data-action='ai-keys-clear']")?.addEventListener("click", () => {
    if (confirm("هل تريد حذف جميع مفاتيح واجهة البرمجة (API) المحفوظة؟")) {
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
  app.querySelector("[data-published-exchange-rate]")?.addEventListener("change", (event) => {
    const rate = Number(event.currentTarget.value || 0);
    if (rate > 0) {
      state.syriaExchangeRate = rate;
      writeJson("syria-exchange-rate", rate);
      state.bulletinStatus = { type: "muted", msg: `تم اعتماد صرف ${rate.toLocaleString()} — ستُحدّث نشرة السوري تلقائياً.` };
      scheduleBulletinPublish();
      render();
    }
  });
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
  app.querySelectorAll("[data-action='gen-receipt']").forEach((el) => {
    el.addEventListener("click", () => {
      const item = selectedCustomer(latestCustomerBalanceItems());
      if (!item) { setNotice("error", "اختر زبونًا أولاً."); render(); return; }
      const key = customerKey(item);
      exportVoucherPdf({
        type: "receipt",
        name: item.name || "",
        phone: customerProfile(key)?.phone || "",
        amount: Number(el.dataset.amt || 0),
        date: el.dataset.date || todayIsoDate(),
        notes: el.dataset.notes || "",
        balance: customerBalance(item),
        cur: customerCurrency(item),
        no: docNumber("R")
      });
    });
  });
  app.querySelector("[data-action='toggle-currency']")?.addEventListener("click", () => {
    const item = selectedCustomer(latestCustomerBalanceItems());
    if (!item) { setNotice("error", "اختر زبونًا أولاً."); render(); return; }
    const next = customerCurrency(item) === "$" ? "ل.س" : "$";
    setCustomerCurrencyOverride(item, next);
    setNotice("success", `عملة الزبون الآن: ${next}`);
    render();
  });
  app.querySelectorAll("[data-action='gen-movement-doc']").forEach((el) => {
    el.addEventListener("click", () => {
      const item = selectedCustomer(latestCustomerBalanceItems());
      if (!item) { setNotice("error", "اختر زبونًا أولاً."); render(); return; }
      const debit = Number(el.dataset.debit || 0);
      const credit = Number(el.dataset.credit || 0);
      const key = customerKey(item);
      const base = {
        name: item.name || "",
        phone: customerProfile(key)?.phone || "",
        date: el.dataset.date || todayIsoDate(),
        notes: el.dataset.notes || "",
        cur: customerCurrency(item)
      };
      // الرصيد المُخزَّن من دفتر الأمين لهذا القيد بالذات — ممرَّر مع الزر، بلا أي مطابقة.
      const storedBal = el.dataset.balance !== undefined && el.dataset.balance !== ""
        ? Number(el.dataset.balance) : null;
      // الرصيد الزمني الحقيقي للمستند (لا يتضخّم بدفعة نفس اليوم). يسقط لرصيد الكشف إن غاب.
      const storedBalChrono = el.dataset.balanceChrono !== undefined && el.dataset.balanceChrono !== ""
        ? Number(el.dataset.balanceChrono) : storedBal;
      const docBal = (storedBalChrono !== null && Number.isFinite(storedBalChrono)) ? storedBalChrono : storedBal;
      // رصيدا المستند بعد/قبل سند القيد كاملاً (يشملان الخصم المرافق). يسقطان إلى الرصيد الزمني.
      const storedDocNew = el.dataset.docNew !== undefined && el.dataset.docNew !== ""
        ? Number(el.dataset.docNew) : docBal;
      const storedDocPrev = el.dataset.docPrev !== undefined && el.dataset.docPrev !== ""
        ? Number(el.dataset.docPrev) : null;
      if (debit > 0 && credit <= 0) {
        const invs = customerInvoicesFor(item.name || "").filter((x) => !x.isReturn);
        // نطابق الفاتورة التفصيلية بمعرّف القيد (قطعي) أولاً، ثم بالتاريخ/المبلغ كاحتياط.
        const bg = String(el.dataset.billGuid || "").trim().toLowerCase();
        const dOnly = String(el.dataset.date || "").slice(0, 10);
        const amtMatch = (x) => Math.abs(Number(x.total || 0) - debit) < 1;
        const dateMatch = (x) => String(x.date || "").slice(0, 10) === dOnly;
        const match = (bg ? invs.find((x) => String(x.guid || "").trim().toLowerCase() === bg) : null)
          || invs.find((x) => dateMatch(x) && amtMatch(x)) || invs.find((x) => amtMatch(x)) || invs.find((x) => dateMatch(x));
        if (match) {
          const total = match.total || debit;
          const opts = { ...base, cur: "$", type: "invoice", amount: total, no: match.number ? String(match.number) : docNumber("INV"), lines: match.lines || [] };
          if (storedDocNew !== null && Number.isFinite(storedDocNew)) {
            opts.newBalance = roundPrice(storedDocNew);
            const prev = (storedDocPrev !== null && Number.isFinite(storedDocPrev)) ? storedDocPrev : (storedDocNew - debit);
            opts.prevBalance = roundPrice(prev);
            // (السابق + قيمة الفاتورة) − الجديد = حسم/تسوية بنفس سند الفاتورة (يشمل قيد الخصم المرافق).
            const adjust = roundPrice(opts.prevBalance + total - opts.newBalance);
            if (Math.abs(adjust) > 0.009) opts.adjust = adjust;
          } else {
            opts.balance = customerBalance(item);
          }
          exportVoucherPdf(opts);
        } else {
          setNotice("error", "لم أطابق فاتورة تفصيلية لهذه الحركة. افتح «التقارير» ← فواتير الزبون واضغط «📄 تصدير الفاتورة PDF (مع الأصناف)».");
          render();
        }
      } else if (credit > 0) {
        // مرتجع المبيعات يُقيَّد دائناً كالدفعة تماماً — نطابقه أولاً بفاتورة مرتجع فعلية
        // (بالتاريخ والمبلغ، إذ لا معرّف قيد لقيود المرتجع) لنصدّره كفاتورة مرتجع مع أصنافها.
        const retMatch = findReturnInvoiceForMovement(item.name || "", { date: el.dataset.date, credit });
        if (retMatch) {
          const opts = { ...base, cur: "$", type: "return", amount: retMatch.total || credit, no: retMatch.number ? String(retMatch.number) : docNumber("RET"), lines: retMatch.lines || [] };
          if (storedDocNew !== null && Number.isFinite(storedDocNew)) {
            opts.newBalance = roundPrice(storedDocNew);
            const prev = (storedDocPrev !== null && Number.isFinite(storedDocPrev)) ? storedDocPrev : (storedDocNew + credit);
            opts.prevBalance = roundPrice(prev);
          } else {
            opts.balance = customerBalance(item);
            opts.balanceLabel = "الرصيد بعد المرتجع";
          }
          exportVoucherPdf(opts);
        } else {
          const opts = { ...base, type: "receipt", amount: credit, no: docNumber("R") };
          if (storedDocNew !== null && Number.isFinite(storedDocNew)) {
            opts.balance = roundPrice(storedDocNew);
            opts.balanceLabel = "الرصيد بعد الدفعة";
          } else {
            opts.balance = customerBalance(item);
            opts.balanceLabel = "الرصيد الحالي";
          }
          exportVoucherPdf(opts);
        }
      } else {
        setNotice("error", "لا يمكن تصدير هذا القيد."); render();
      }
    });
  });
  app.querySelectorAll("[data-action='gen-invoice-doc']").forEach((el) => {
    el.addEventListener("click", () => {
      try {
        const cust = el.dataset.customer || "";
        const invs = customerInvoicesFor(cust);
        const inv = invs.find((x) => String(x.number || "") === el.dataset.invNumber && String(x.date || "") === el.dataset.invDate)
          || invs.find((x) => String(x.number || "") === el.dataset.invNumber);
        if (!inv) { setNotice("error", "تعذّر إيجاد الفاتورة."); render(); return; }
        const invoiceTotal = inv.total || 0;
        const custItem = smartNameMatch(latestCustomerBalanceItems(), (it) => it.name, cust);
        const opts = {
          type: inv.isReturn ? "return" : "invoice",
          name: cust,
          amount: invoiceTotal,
          cur: "$",
          date: inv.date || todayIsoDate(),
          no: inv.number ? String(inv.number) : docNumber(inv.isReturn ? "RET" : "INV"),
          lines: inv.lines || []
        };
        // الرصيد قبل/بعد الفاتورة من قيدها في دفتر الأمين. نستعمل الرصيد **الزمني الحقيقي**
        // (balanceChrono) لا رصيد ترتيب-الكشف، كي لا يتضخّم رصيد الفاتورة إن جاءت دفعة بينها
        // وبين فاتورة أخرى في نفس اليوم. المطابقة بالمعرّف أو بالتاريخ/المبلغ (المعرّف قد يكون صفرياً).
        // قيود المرتجع لا تحمل معرّف قيد، فتُستثنى وتعرض الرصيد الحالي فقط.
        // عند أي خطأ في حساب الرصيد نتجاهله ونعرض الرصيد الحالي فقط — دون منع تصدير الفاتورة.
        try {
          const mv = inv.isReturn ? null : invoiceMovement(cust, inv);
          const db = mv ? movementDocBalances(mv) : null;
          if (db && Number.isFinite(db.newBalance) && Number.isFinite(db.prevBalance)) {
            opts.newBalance = roundPrice(db.newBalance);
            opts.prevBalance = roundPrice(db.prevBalance);
            // (السابق + قيمة الفاتورة) − الجديد = حسم/تسوية مُسجَّل بنفس سند الفاتورة.
            const adjust = roundPrice(opts.prevBalance + invoiceTotal - opts.newBalance);
            if (Math.abs(adjust) > 0.009) opts.adjust = adjust;
          } else {
            opts.balance = custItem ? customerBalance(custItem) : null;
            if (inv.isReturn) opts.balanceLabel = "الرصيد بعد المرتجع";
          }
        } catch (_balErr) {
          opts.balance = custItem ? customerBalance(custItem) : null;
        }
        exportVoucherPdf(opts);
      } catch (error) {
        setNotice("error", "تعذّر تصدير الفاتورة: " + (error && error.message ? error.message : String(error)));
        render();
      }
    });
  });
  app.querySelector("[data-form='voucher-payment']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = event.target;
    const g = (n) => (f.querySelector(`[name='${n}']`)?.value || "").trim();
    const amount = toNumber(g("amount"));
    if (!g("name") || !(amount > 0)) { setNotice("error", "أدخل المستفيد والمبلغ."); render(); return; }
    exportVoucherPdf({
      type: "payment",
      name: g("name"),
      amount: amount,
      cur: g("cur") || "ل.س",
      date: g("date") || todayIsoDate(),
      method: g("method"),
      notes: g("notes"),
      no: docNumber("PV")
    });
  });
  app.querySelector("[data-action='report-receivables']")?.addEventListener("click", exportReceivablesPdf);
  app.querySelector("[data-action='report-inventory']")?.addEventListener("click", exportInventoryReportPdf);
  app.querySelector("[data-action='report-stagnant']")?.addEventListener("click", exportStagnantMaterialsPdf);
  app.querySelector("[data-report-customer]")?.addEventListener("change", (event) => {
    const m = findBalanceCustomerByText(event.target.value);
    if (m) { state.selectedCustomerKey = customerKey(m); render(); }
  });
  app.querySelector("[data-action='report-statement']")?.addEventListener("click", () => {
    const sel = app.querySelector("[data-report-customer]");
    const m = sel ? findBalanceCustomerByText(sel.value) : null;
    if (!m) {
      setNotice("error", "اكتب اسم زبون موجود بالقائمة ثم اضغط تنزيل.");
      render();
      return;
    }
    state.selectedCustomerKey = customerKey(m);
    exportCustomerStatementPdf();
  });
  app.querySelector("[data-daily-date]")?.addEventListener("change", (event) => {
    loadDailyMovement(event.target.value || todayIsoDate());
  });
  app.querySelector("[data-action='daily-refresh']")?.addEventListener("click", () => {
    loadDailyMovement(state.dailyMovementDate || todayIsoDate());
  });

  // تحميل تقرير الحركة اليومية تلقائياً عند فتح صفحة التقارير
  if (state.route === "dashboard" && state.session && !state.dailyMovementLoading) {
    const want = state.dailyMovementDate || todayIsoDate();
    if (state.dmFetchedFor !== want) loadDailyMovement(want);
  }

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
        try {
          const custItem = latestCustomerBalanceItems().find((i) => customerKey(i) === key)
            || { name: name, customerGuid: null, balance: 0 };
          await sendReceiptWhatsapp(custItem, amount, date, notes);
        } catch (waErr) {
          setNotice("error", "تم تسجيل الدفعة، لكن تعذّر تجهيز رسالة الواتساب: " + (waErr.message || ""));
        }
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

  // واتساب أُلغي — أُزيلت معالجات الإرسال الجماعي (التحويل إلى Google Drive)

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
  // لا نقاطع المستخدم أثناء الكتابة في نموذج
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
  const autoRefreshRoutes = ["ameen", "balances", "pricing", "dashboard", "payments"];
  if (autoRefreshRoutes.includes(state.route) && (!dataStore.isConfigured() || state.session)) {
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
