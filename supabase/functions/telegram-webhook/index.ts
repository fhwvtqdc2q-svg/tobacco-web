import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TZ_OFFSET_HOURS = 3; // Asia/Damascus (UTC+3)
const PROFILE = "public"; // PostgREST default schema here is "api"; our tables live in public

const WELCOME = `أهلاً 👋 أنا مساعدك الشخصي.

💳 أرصدة الزبائن:
• رصيد حسن عباس
• كشف حساب حسن عباس

📦 اللائحة والمخزون:
• سعر <اسم المادة>
• فحص الأسعار
• حالة النظام
• شو ناقص
• الديون
• مبيعات اليوم
• ربح اليوم
• رسم المبيعات

🤖 اسأل أي سؤال عن العمل:
• اسأل مين أكثر زبون مديون؟
• أو اكتب سؤالك مباشرة بدون "اسأل" — أي رسالة ما بتنعرف كأمر أو تذكير بترد عليها بالذكاء الاصطناعي تلقائياً

⚙️ إعدادات:
• حد التنبيه 30

🔔 التذكيرات:
• ذكّرني دقّ لأبو أحمد الساعة 5 العصر
• ذكّرني بعد 20 دقيقة احكي مع المورّد

اكتب "القائمة" أو /menu للأزرار السريعة 👇`;

const MENU_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📊 مبيعات اليوم", callback_data: "sales" }, { text: "🧮 ربح اليوم", callback_data: "profit" }],
    [{ text: "⚠️ شو ناقص", callback_data: "low" }],
    [{ text: "💰 الديون", callback_data: "debts" }, { text: "📈 رسم المبيعات", callback_data: "chart" }],
    [{ text: "🔄 فحص الأسعار", callback_data: "price_sync" }],
    [{ text: "🩺 حالة النظام", callback_data: "system_status" }],
    [{ text: "❓ مساعدة", callback_data: "help" }],
  ],
};

let lastDiag: Record<string, unknown> = {};
let cachedSecrets: { token: string; webhook_secret: string } | null = null;
async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;
  // أولاً: أسرار Edge Function (Deno.env) إن ضُبطت — ثم fallback لجدول app_secrets
  const envTok = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const envSec = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (envTok && envSec) {
    cachedSecrets = { token: envTok, webhook_secret: envSec };
    return cachedSecrets;
  }
  const res = await fetch(`${SUPA_URL}/rest/v1/app_secrets?select=name,value`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": PROFILE },
  });
  const rows = await res.json().catch(() => null) as any;
  const map: Record<string, string> = {};
  if (Array.isArray(rows)) for (const r of rows) map[r.name] = r.value;
  lastDiag = { status: res.status, rows: Array.isArray(rows) ? rows.length : typeof rows };
  if (map.telegram_bot_token && map.telegram_webhook_secret) {
    cachedSecrets = { token: map.telegram_bot_token, webhook_secret: map.telegram_webhook_secret };
    return cachedSecrets;
  }
  throw new Error("secrets_load_failed");
}

async function restGet(path: string) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": PROFILE } });
  if (!res.ok) throw new Error(`rest_get_failed_${res.status}`);
  return res.json();
}
async function restPost(path: string, body: unknown, prefer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Profile": PROFILE };
  if (prefer) headers["Prefer"] = prefer;
  return fetch(`${SUPA_URL}/rest/v1/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
async function restPatch(path: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Profile": PROFILE, Prefer: "return=minimal" };
  return fetch(`${SUPA_URL}/rest/v1/${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
}
async function tg(method: string, payload: unknown) {
  const { token } = await getSecrets();
  await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
async function getOwner(): Promise<number | null> {
  const rows = await restGet(`bot_config?key=eq.owner_chat_id&select=value`);
  // فشل الاستعلام ≠ "لا يوجد مالك" — نرمي خطأ كي لا يُفتح البوت لمرسل عشوائي (fail-closed)
  if (!Array.isArray(rows)) throw new Error("owner_lookup_failed");
  if (rows.length) return Number(rows[0].value);
  return null; // لا يوجد مالك فعلاً — أول محادثة تُسجَّل مالكاً (bootstrap)
}
async function setOwner(chatId: number) {
  await restPost(`bot_config`, { key: "owner_chat_id", value: String(chatId) }, "resolution=merge-duplicates");
}

function normalizeDigits(s: string) {
  const map: Record<string, string> = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
  return s.replace(/[٠-٩۰-۹]/g, (d) => map[d] || d);
}
function localNow() { return new Date(Date.now() + TZ_OFFSET_HOURS * 3600000); }
function localToUtc(d: Date) { return new Date(d.getTime() - TZ_OFFSET_HOURS * 3600000); }

// ============================================================
// استعلامات الزبائن: رصيد / كشف حساب
// ============================================================
function normalizeArabic(s: string): string {
  return normalizeDigits(s)
    .replace(/[ً-ْٰـ]/g, "") // تشكيل + تطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[؟?!.،,:;"'\/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const LEAD_FILLERS = ["الزبون", "الزبونه", "العميل", "العميله", "حساب", "تبع", "عند", "ل", "لل", "الى", "إلى", "عن", "مال"];
const TAIL_FILLERS = ["لي", "الي", "يظهره", "اظهره", "ارسله", "ابعته", "لو", "سمحت", "فضلك", "من", "رجاء", "بليز", "الان", "هلق", "هلا"];
function cleanCustomerName(raw: string): string {
  let words = raw.split(" ").filter(Boolean);
  while (words.length && LEAD_FILLERS.includes(words[0])) words.shift();
  while (words.length && TAIL_FILLERS.includes(words[words.length - 1])) words.pop();
  return words.join(" ").trim();
}
function extractCustomerQuery(text: string): { kind: "balance" | "statement"; name: string } | null {
  const t = normalizeArabic(text);
  // كشف حساب أولاً (أكثر تحديداً)
  let m = t.match(/(?:كشف\s+حساب|كشف|حركه\s+حساب|حركات\s+حساب|حركات)\s+(.+)$/);
  if (m && /كشف|حرك/.test(t)) {
    const name = cleanCustomerName(m[1]);
    if (name.length >= 2) return { kind: "statement", name };
  }
  // رصيد
  m = t.match(/رصيد\s+(.+)$/);
  if (m) {
    const name = cleanCustomerName(m[1]);
    if (name.length >= 2) return { kind: "balance", name };
  }
  return null;
}

type CustomerEntry = {
  key?: string; name?: string; balance?: number; creditLimit?: number; remainingLimit?: number;
  lastPaymentDate?: string;
  recentPayments?: { date?: string; amount?: number; notes?: string }[];
  recentMovements?: { date?: string; debit?: number; credit?: number; notes?: string }[];
};

async function loadBalancesReport(): Promise<{ items: CustomerEntry[]; reportDate: string } | null> {
  const rows = await restGet(`inventory_reports?source=eq.ameen_customer_balances&order=created_at.desc&limit=1&select=items,summary,created_at`);
  if (!Array.isArray(rows) || !rows.length) return null;
  const items = Array.isArray(rows[0].items) ? rows[0].items as CustomerEntry[] : [];
  const reportDate = rows[0].summary?.reportDate ?? String(rows[0].created_at ?? "").slice(0, 10);
  return { items, reportDate };
}

function fuzzyScore(q: string, qTokens: string[], name: string, extra: string): number {
  const nName = normalizeArabic(name);
  const n = normalizeArabic(`${name} ${extra}`);
  if (!n) return 0;
  if (n === q || nName === q) return 4;
  if (nName.startsWith(q)) return 3;
  if (n.includes(q)) return 2;
  if (qTokens.length > 1 && qTokens.every((t) => n.includes(t))) return 1;
  return 0;
}

function matchCustomers(items: CustomerEntry[], query: string): CustomerEntry[] {
  const q = normalizeArabic(query);
  const qTokens = q.split(" ").filter(Boolean);
  const scored: { score: number; c: CustomerEntry }[] = [];
  for (const c of items) {
    const score = fuzzyScore(q, qTokens, c.name ?? "", c.key ?? "");
    if (score > 0) scored.push({ score, c });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.c);
}

function fmtNum(x: unknown): string {
  const n = Number(x);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
// أرقام حسابات الزبائن والمبيعات والمصاريف تصل من الأمين بالدولار أصلاً
// (حسابات الزبائن والصناديق عندهم مُمسوكة بالدولار) — لا تحويل، فقط تنسيق.
function fmtUSD(amount: unknown): string {
  const n = Number(amount);
  if (!isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} $`;
}
function fmtDate(s?: string): string {
  if (!s) return "—";
  return String(s).slice(0, 10);
}
function balanceLine(balance: number | undefined): string {
  const b = Number(balance ?? 0);
  if (b > 0) return `${fmtUSD(b)} — عليه (مدين) 🔴`;
  if (b < 0) return `${fmtUSD(Math.abs(b))} — له (دائن) 🟢`;
  return "صفر ✅";
}

function buildBalanceReply(c: CustomerEntry, reportDate: string): string {
  let msg = `💳 رصيد: ${c.name ?? c.key}\n`;
  msg += `الرصيد: ${balanceLine(c.balance)}\n`;
  if (Number(c.creditLimit ?? 0) > 0) {
    msg += `حد الائتمان: ${fmtUSD(c.creditLimit)}\n`;
    msg += `المتبقي من الحد: ${fmtUSD(c.remainingLimit)}\n`;
  }
  const lastPay = c.recentPayments?.[0];
  if (lastPay) msg += `آخر دفعة: ${fmtUSD(lastPay.amount)} بتاريخ ${fmtDate(lastPay.date)}\n`;
  msg += `\n📅 بيانات الأمين بتاريخ ${reportDate}`;
  return msg;
}

function buildStatementReply(c: CustomerEntry, reportDate: string): string {
  let msg = `📋 كشف حساب: ${c.name ?? c.key}\n`;
  msg += `الرصيد الحالي: ${balanceLine(c.balance)}\n`;
  const movs = (c.recentMovements ?? []).slice(0, 10);
  if (movs.length) {
    msg += `\n🔄 آخر الحركات:\n`;
    for (const m of movs) {
      const debit = Number(m.debit ?? 0);
      const credit = Number(m.credit ?? 0);
      let line = `• ${fmtDate(m.date)} — `;
      if (debit > 0) line += `مدين ${fmtUSD(debit)}`;
      else if (credit > 0) line += `دائن ${fmtUSD(credit)}`;
      else line += `0`;
      if (m.notes) line += ` (${String(m.notes).slice(0, 40)})`;
      msg += line + "\n";
    }
  } else {
    msg += `\nلا توجد حركات حديثة مسجّلة.\n`;
  }
  const pays = (c.recentPayments ?? []).slice(0, 5);
  if (pays.length) {
    msg += `\n💵 آخر الدفعات:\n`;
    for (const p of pays) {
      msg += `• ${fmtDate(p.date)} — ${fmtUSD(p.amount)}${p.notes ? ` (${String(p.notes).slice(0, 40)})` : ""}\n`;
    }
  }
  msg += `\n📅 بيانات الأمين بتاريخ ${reportDate}`;
  return msg;
}

async function handleCustomerQuery(chatId: number, kind: "balance" | "statement", name: string): Promise<void> {
  const report = await loadBalancesReport();
  if (!report || !report.items.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في بيانات أرصدة متزامنة حالياً 😕\nتأكد أن مزامنة الأمين شغّالة على جهاز Windows." });
    return;
  }
  const matches = matchCustomers(report.items, name);
  if (!matches.length) {
    await tg("sendMessage", { chat_id: chatId, text: `ما لقيت زبون باسم «${name}» 🔍\nجرّب جزء من الاسم، مثلاً الاسم الأول أو اسم المنطقة.` });
    return;
  }
  if (matches.length === 1) {
    const c = matches[0];
    const text = kind === "balance" ? buildBalanceReply(c, report.reportDate) : buildStatementReply(c, report.reportDate);
    await tg("sendMessage", { chat_id: chatId, text });
    return;
  }
  if (kind === "balance" && matches.length <= 5) {
    // عدة نتائج للرصيد: اعرضها كلها باختصار + أزرار لكشف الحساب
    let msg = `🔍 لقيت ${matches.length} زبائن مطابقين:\n\n`;
    for (const c of matches) msg += `• ${c.name ?? c.key}: ${balanceLine(c.balance)}\n`;
    msg += `\n📅 بيانات الأمين بتاريخ ${report.reportDate}`;
    await tg("sendMessage", { chat_id: chatId, text: msg });
    return;
  }
  if (matches.length > 5) {
    let msg = `في ${matches.length} زبون مطابق لـ«${name}» — حدّد أكثر 🙏\nأقرب النتائج:\n`;
    for (const c of matches.slice(0, 5)) msg += `• ${c.name ?? c.key}\n`;
    await tg("sendMessage", { chat_id: chatId, text: msg });
    return;
  }
  // كشف حساب مع 2-5 نتائج: أزرار اختيار مباشرة (callback_data محدودة بـ64 بايت)
  const kb = matches.slice(0, 5).map((c) => [{
    text: String(c.name ?? c.key ?? "?").slice(0, 40),
    callback_data: "s|" + String(c.name ?? c.key ?? "").slice(0, 28),
  }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `لقيت ${matches.length} زبائن مطابقين — اختار مين بدك كشفه 👇`,
    reply_markup: { inline_keyboard: kb },
  });
}

// ============================================================
// كشف حساب كملف — «كشف حساب <اسم> PDF» أو «... ملف»
//
// محاولتان سابقتان لتوليد PDF حقيقي بنص عربي فشلتا (تشكيل يدوي بجدول
// Unicode Presentation Forms، ثم الاعتماد على تخطيط fontkit الداخلي)
// — pdf-lib لا يدعم تشكيل الحروف العربية أصلاً، فطلعت النتيجة مشوّشة
// بالحالتين. الحل الحقيقي يحتاج محرك تشكيل كامل (HarfBuzz) وهذا تعقيد
// أكبر بكثير بدون طريقة للمعاينة البصرية هنا. بالاتفاق مع المستخدم:
// نُرسل ملف نصي (.txt) عادي بدلاً من PDF — مضمون 100% لأنه نص خام
// بدون أي رسم حروف يدوي، ونفس محتوى «كشف حساب» النصي العادي بالضبط.
// ============================================================
async function sendTextDocument(chatId: number, content: string, filename: string, caption: string): Promise<void> {
  const { token } = await getSecrets();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/plain; charset=utf-8" }), filename);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
}

async function handleStatementFileCommand(chatId: number, name: string): Promise<void> {
  const report = await loadBalancesReport();
  if (!report || !report.items.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في بيانات أرصدة متزامنة حالياً 😕\nتأكد أن مزامنة الأمين شغّالة على جهاز Windows." });
    return;
  }
  const matches = matchCustomers(report.items, name);
  if (!matches.length) {
    await tg("sendMessage", { chat_id: chatId, text: `ما لقيت زبون باسم «${name}» 🔍\nجرّب جزء من الاسم.` });
    return;
  }
  if (matches.length > 1) {
    let msg = `في ${matches.length} زبون مطابق لـ«${name}» — حدّد أكثر 🙏\nأقرب النتائج:\n`;
    for (const m of matches.slice(0, 5)) msg += `• ${m.name ?? m.key}\n`;
    await tg("sendMessage", { chat_id: chatId, text: msg });
    return;
  }
  try {
    const c = matches[0];
    const content = buildStatementReply(c, report.reportDate);
    await sendTextDocument(
      chatId,
      content,
      `kashf-hisab-${Date.now()}.txt`,
      `كشف حساب: ${c.name ?? c.key}`,
    );
  } catch (e) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `صار خطأ وأنا عم سوّي الملف 😕\n(${String(e).slice(0, 150)})\nجرّب «كشف حساب» بدون ملف لحتى تشوف البيانات نصياً.`,
    });
  }
}

// يفحص وجود كلمة "PDF" أو "ملف" بآخر الرسالة، ويشيلها من النص قبل باقي التحليل
function stripPdfTrigger(raw: string): { wantPdf: boolean; text: string } {
  const m = raw.match(/\s+(pdf|ملف)\s*$/i);
  if (m) return { wantPdf: true, text: raw.slice(0, m.index).trim() };
  return { wantPdf: false, text: raw };
}

// ============================================================
// أوامر الاستعلام: مبيعات / نواقص / ديون / سعر / حد التنبيه
// ============================================================
async function getThreshold(): Promise<number> {
  try {
    const rows = await restGet(`bot_config?key=eq.low_stock_threshold&select=value`);
    if (Array.isArray(rows) && rows.length) {
      const n = Number(rows[0].value);
      if (isFinite(n) && n > 0) return n;
    }
  } catch { /* نستخدم الافتراضي */ }
  return 50;
}

async function sendMenu(chatId: number) {
  await tg("sendMessage", {
    chat_id: chatId,
    text: `شو حابب تشوف؟ 👇

وفيك تكتب مباشرة:
• رصيد <اسم الزبون>
• كشف حساب <اسم الزبون>
• سعر <اسم المادة>
• فحص الأسعار
• حالة النظام
• حد التنبيه <رقم>
• اسأل <أي سؤال عن العمل>`,
    reply_markup: MENU_KEYBOARD,
  });
}

async function handleSales(chatId: number) {
  const rows = await restGet(`daily_sales_summary?order=created_at.desc&limit=1&select=total_sales,total_cash,total_credit,created_at`);
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في ملخص مبيعات متزامن بعد 😕\nملخص المبيعات يوصل من وكيل الأمين على جهاز Windows." });
    return;
  }
  const r = rows[0];
  await tg("sendMessage", {
    chat_id: chatId,
    text: `📊 آخر ملخص مبيعات (${fmtDate(r.created_at)})
المبيعات: ${fmtUSD(r.total_sales)}
النقدي: ${fmtUSD(r.total_cash)}
الآجل: ${fmtUSD(r.total_credit)}`,
  });
}

// يحوّل كمية المخزون (بالوحدة الأولى) إلى نص بالوحدة الثانية (الكرتونة) إن أمكن
function stockInCartons(r: any): string {
  const qty = Number(r.stock_qty ?? 0);
  const factor = Number(r.unit2_factor ?? 0);
  const unit2 = r.unit2_name || "كرتونة";
  if (factor > 0) {
    const cartons = qty / factor;
    return `${fmtNum(cartons)} ${unit2}`;
  }
  // ما في عامل تحويل معروف — نعرض الكمية الأصلية مع اسم وحدتها
  const unit1 = r.unit1_name || "وحدة";
  return `${fmtNum(qty)} ${unit1}`;
}

// بعض المواد مسجّلة بصفّين بـapproved_price_items لنفس الاسم فعلياً، بفرق
// همزة بس («أحمر» مقابل «احمر») — ناتج إدخال مكرّر بالأمين. نجمعهم تلقائياً
// (بالمخزون والسعر) تحت نتيجة وحدة بدل ما نعرضهم كأنهم مادتين مختلفتين.
function mergeDuplicateStockRows(rows: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = normalizeArabic(r.item_name ?? r.item_key ?? "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const merged: any[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const base = group[0];
    const stock_qty = group.reduce((sum, r) => sum + Number(r.stock_qty ?? 0), 0);
    const salePrices = [...new Set(group.map((r) => r.sale_price).filter((p) => p != null))];
    const unit2Prices = [...new Set(group.map((r) => r.unit2_price).filter((p) => p != null))];
    merged.push({
      ...base,
      stock_qty,
      sale_price: salePrices.length === 1 ? salePrices[0] : base.sale_price,
      unit2_price: unit2Prices.length === 1 ? unit2Prices[0] : base.unit2_price,
      _priceVariants: salePrices.length > 1 ? salePrices : undefined,
    });
  }
  return merged;
}

async function handleLowStock(chatId: number) {
  const thr = await getThreshold();
  const rawRows = await restGet(`approved_price_items?select=item_name,item_key,stock_qty,unit1_name,unit2_name,unit2_factor&stock_qty=lte.${thr}&order=stock_qty.asc&limit=1000`);
  const rows = Array.isArray(rawRows) ? mergeDuplicateStockRows(rawRows) : rawRows;
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: `✅ ولا مادة تحت حد التنبيه (${thr}) — المخزون تمام.` });
    return;
  }
  const out = rows.filter((r: any) => Number(r.stock_qty ?? 0) <= 0);
  const low = rows.filter((r: any) => Number(r.stock_qty ?? 0) > 0);

  await tg("sendMessage", {
    chat_id: chatId,
    text: `⚠️ المواد الناقصة (حد التنبيه: ${thr})\nنافد: ${out.length} — تحت الحد: ${low.length}`,
  });

  // نرسل القائمة كاملة، مقسّمة على عدة رسائل لتفادي حد طول رسالة تيليغرام
  const CHUNK = 25;
  const sendChunked = async (label: string, items: any[], lineFn: (r: any) => string) => {
    for (let i = 0; i < items.length; i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      const header = i === 0 ? `${label} (${items.length}):` : `${label} — تابع (${i + 1}-${Math.min(i + CHUNK, items.length)}):`;
      const lines = part.map(lineFn).join("\n");
      await tg("sendMessage", { chat_id: chatId, text: `${header}\n${lines}` });
    }
  };
  if (out.length) await sendChunked("⛔ نافد", out, (r) => `• ${r.item_name ?? r.item_key}`);
  if (low.length) await sendChunked("🔻 تحت الحد", low, (r) => `• ${r.item_name ?? r.item_key} — باقي ${stockInCartons(r)}`);
}

async function handleDebts(chatId: number) {
  const report = await loadBalancesReport();
  if (!report || !report.items.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في بيانات أرصدة متزامنة حالياً 😕" });
    return;
  }
  const debtors = report.items
    .filter((c) => Number(c.balance ?? 0) > 0)
    .sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
  if (!debtors.length) {
    await tg("sendMessage", { chat_id: chatId, text: "✅ ما في ديون — كل الزبائن مسدّدين." });
    return;
  }
  const total = debtors.reduce((s, c) => s + Number(c.balance ?? 0), 0);
  let msg = `💰 الديون — ${debtors.length} زبون مدين\nالإجمالي: ${fmtUSD(total)}\n\nأعلى 10:\n`;
  debtors.slice(0, 10).forEach((c, i) => { msg += `${i + 1}. ${c.name ?? c.key}: ${fmtUSD(c.balance)}\n`; });
  msg += `\n📅 بيانات الأمين بتاريخ ${report.reportDate}`;
  await tg("sendMessage", { chat_id: chatId, text: msg });
}

async function handlePriceQuery(chatId: number, name: string) {
  const rawRows = await restGet(`approved_price_items?select=item_name,item_key,sale_price,unit1_name,unit1_price,unit2_name,unit2_price,stock_qty&limit=1000`);
  if (!Array.isArray(rawRows) || !rawRows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما قدرت جيب لائحة الأسعار حالياً 😕" });
    return;
  }
  const rows = mergeDuplicateStockRows(rawRows);
  const q = normalizeArabic(name);
  const qTokens = q.split(" ").filter(Boolean);
  const scored: { score: number; r: any }[] = [];
  for (const r of rows) {
    const score = fuzzyScore(q, qTokens, r.item_name ?? "", r.item_key ?? "");
    if (score > 0) scored.push({ score, r });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) {
    await tg("sendMessage", { chat_id: chatId, text: `ما لقيت مادة باسم «${name}» 🔍\nجرّب جزء من الاسم.` });
    return;
  }
  if (scored.length > 5) {
    let msg = `في ${scored.length} مادة مطابقة لـ«${name}» — حدّد أكثر 🙏\nأقرب النتائج:\n`;
    for (const s of scored.slice(0, 5)) msg += `• ${s.r.item_name ?? s.r.item_key}\n`;
    await tg("sendMessage", { chat_id: chatId, text: msg });
    return;
  }
  let msg = "";
  for (const s of scored) {
    const r = s.r;
    msg += `💵 ${r.item_name ?? r.item_key}\n`;
    if (r.sale_price != null) msg += `السعر: ${fmtUSD(r.sale_price)}\n`;
    if (r._priceVariants) msg += `⚠️ مسجّلة بسعرين مختلفين بالأمين (نسختين مكرّرتين لنفس المادة): ${r._priceVariants.map(fmtNum).join(" و ")}\n`;
    if (r.unit1_price != null && r.unit1_name) msg += `${r.unit1_name}: ${fmtUSD(r.unit1_price)}\n`;
    if (r.unit2_price != null && r.unit2_name) msg += `${r.unit2_name}: ${fmtUSD(r.unit2_price)}\n`;
    if (r.stock_qty != null) msg += `المخزون: ${fmtNum(r.stock_qty)}\n`;
    msg += "\n";
  }
  await tg("sendMessage", { chat_id: chatId, text: msg.trim() });
}

async function handlePriceSyncStatus(chatId: number) {
  const rows = await restGet(`inventory_reports?source=eq.ameen_price_sync_status&order=created_at.desc&limit=1&select=summary,created_at`);
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما وصل فحص مزامنة الأسعار من جهاز الأمين بعد." });
    return;
  }
  const status: any = rows[0].summary ?? {};
  const checked = status.checked_at ? fmtDate(status.checked_at) : "غير معروف";
  if (status.status === "ok") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `✅ الأسعار متزامنة مع الأمين\nالجملة المطابقة: ${fmtNum(status.wholesale_matched)} مادة\nالمفرق المطابق: ${fmtNum(status.retail_matched)} مادة\nالفروقات: 0\nآخر فحص: ${checked}`,
    });
    return;
  }
  if (status.status === "mismatch") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `⚠️ يوجد خلل بمزامنة الأسعار\nفروقات الأسعار: ${fmtNum(status.mismatch_count)}\nمواد ناقصة: ${fmtNum(status.missing_count)}\nآخر فحص: ${checked}`,
    });
    return;
  }
  await tg("sendMessage", { chat_id: chatId, text: `🚨 تعذر فحص مزامنة الأسعار\nآخر محاولة: ${checked}` });
}

function ageMinutes(value: unknown): number {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : Number.POSITIVE_INFINITY;
}

function ageLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return "لا توجد بيانات";
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

async function handleSystemStatus(chatId: number) {
  const [inventoryRaw, balancesRaw, priceSyncRaw, movementsRaw, invoicesRaw, latestPriceRaw, latestSalesRaw] = await Promise.all([
    restGet(`inventory_reports?source=eq.ameen_sql_agent&order=created_at.desc&select=source,summary,created_at&limit=1`),
    restGet(`inventory_reports?source=eq.ameen_customer_balances&order=created_at.desc&select=source,summary,created_at&limit=1`),
    restGet(`inventory_reports?source=eq.ameen_price_sync_status&order=created_at.desc&select=source,summary,created_at&limit=1`),
    restGet(`inventory_reports?source=eq.ameen_customer_movements&order=created_at.desc&select=source,summary,created_at&limit=1`),
    restGet(`inventory_reports?source=eq.ameen_customer_invoices&order=created_at.desc&select=source,summary,created_at&limit=1`),
    restGet(`approved_price_items?select=updated_at&order=updated_at.desc&limit=1`),
    restGet(`sales_line_items?select=created_at&order=created_at.desc&limit=1`),
  ]);
  const reports = [inventoryRaw, balancesRaw, priceSyncRaw, movementsRaw, invoicesRaw]
    .flatMap((rows) => Array.isArray(rows) ? rows.slice(0, 1) : []);
  const latestBySource = new Map<string, any>();
  for (const row of reports) if (!latestBySource.has(String(row.source))) latestBySource.set(String(row.source), row);
  const lines: string[] = [];
  let warnings = 0;
  const addFreshness = (label: string, source: string, maxMinutes: number) => {
    const row = latestBySource.get(source);
    const age = ageMinutes(row?.created_at);
    const ok = age <= maxMinutes;
    if (!ok) warnings++;
    lines.push(`${ok ? "🟢" : "🔴"} ${label}: ${ageLabel(age)}`);
  };

  addFreshness("الأمين والمخزون", "ameen_sql_agent", 5);
  addFreshness("أرصدة الزبائن", "ameen_customer_balances", 5);
  addFreshness("فواتير الزبائن", "ameen_customer_invoices", 15);
  addFreshness("حركات الحسابات", "ameen_customer_movements", 15);

  const priceRow = latestBySource.get("ameen_price_sync_status");
  const priceStatus = priceRow?.summary ?? {};
  const priceAge = ageMinutes(priceRow?.created_at);
  const priceOk = priceStatus.status === "ok" && Number(priceStatus.mismatch_count ?? 0) === 0 && Number(priceStatus.missing_count ?? 0) === 0 && priceAge <= 10;
  if (!priceOk) warnings++;
  lines.push(`${priceOk ? "🟢" : "🔴"} مزامنة الأسعار: ${priceOk ? "صفر فروق" : "تحتاج فحص"} — ${ageLabel(priceAge)}`);

  const latestEditAge = ageMinutes(Array.isArray(latestPriceRaw) ? latestPriceRaw[0]?.updated_at : null);
  const pricesPending = Number.isFinite(latestEditAge) && Number.isFinite(priceAge) && latestEditAge + 7 < priceAge;
  if (pricesPending) warnings++;
  lines.push(`${pricesPending ? "🟡" : "🟢"} أسعار النشرة: ${pricesPending ? "يوجد تعديل بانتظار المزامنة" : "محدّثة"}`);

  const salesAge = ageMinutes(Array.isArray(latestSalesRaw) ? latestSalesRaw[0]?.created_at : null);
  const salesOk = salesAge <= 15;
  if (!salesOk) warnings++;
  lines.push(`${salesOk ? "🟢" : "🔴"} حركة المبيعات: ${ageLabel(salesAge)}`);

  const headline = warnings === 0 ? "✅ كل الأنظمة تعمل بشكل طبيعي" : `⚠️ يوجد ${warnings} تنبيه يحتاج متابعة`;
  await tg("sendMessage", { chat_id: chatId, text: `🩺 حالة النظام\n${headline}\n\n${lines.join("\n")}\n\nآخر فحص: ${fmtDate(new Date().toISOString())}` });
}

// ============================================================
// حركة مادة وربح اليوم — من جدول sales_line_items
// يتغذّى الجدول من tools/push-sales-line-items.ps1 على جهاز Windows
// (فواتير مبيعات المركز والجملة من الأمين، آخر أيام محدودة)
// ============================================================
async function handleItemMovement(chatId: number, name: string) {
  const rows = await restGet(`sales_line_items?select=sale_date,bill_type,qty,unit_price,line_total,item_name&order=sale_date.desc&limit=500`);
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في بيانات حركة مبيعات متزامنة بعد 😕\nهاي الميزة بتحتاج تشغيل مزامنة حركة المبيعات من جهاز Windows." });
    return;
  }
  const q = normalizeArabic(name);
  const qTokens = q.split(" ").filter(Boolean);
  const scored: { score: number; r: any }[] = [];
  for (const r of rows) {
    const score = fuzzyScore(q, qTokens, r.item_name ?? "", "");
    if (score > 0) scored.push({ score, r });
  }
  if (!scored.length) {
    await tg("sendMessage", { chat_id: chatId, text: `ما لقيت حركة مسجّلة لمادة «${name}» بآخر أيام 🔍` });
    return;
  }
  scored.sort((a, b) => b.score - a.score);
  const matchedName = scored[0].r.item_name;
  const allForItem = scored.filter((s) => s.r.item_name === matchedName);
  const lines = allForItem.slice(0, 15);
  let msg = `📦 حركة: ${matchedName}\n\n`;
  for (const s of lines) {
    const r = s.r;
    msg += `• ${fmtDate(r.sale_date)} (${r.bill_type === "wholesale" ? "جملة" : "تجزئة"}) — ${fmtNum(r.qty)} × ${fmtNum(r.unit_price)} = ${fmtNum(r.line_total)}\n`;
  }
  msg += `\nآخر ${lines.length} حركة مسجّلة (من أصل ${allForItem.length}).`;
  await tg("sendMessage", { chat_id: chatId, text: msg });
}

async function handleProfitToday(chatId: number) {
  const rows = await restGet(`inventory_reports?source=eq.ameen_daily_profit&order=created_at.desc&limit=1&select=summary,created_at`);
  if (!Array.isArray(rows) || !rows.length || !rows[0]?.summary) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في تقرير ربح متزامن من الأمين بعد 😕\nشغّل مزامنة حركة المبيعات من جهاز Windows مرة واحدة." });
    return;
  }
  const s = rows[0].summary;
  const today = localNow().toISOString().slice(0, 10);
  if (String(s.report_date ?? "") !== today) {
    await tg("sendMessage", { chat_id: chatId, text: `⚠️ آخر تقرير ربح من الأمين قديم (بتاريخ ${fmtDate(s.report_date)}).\nما رح أعرضه كربح اليوم حتى ما أعطيك رقم مضلل.` });
    return;
  }
  let msg = `🧮 تقرير ربح اليوم — ${fmtDate(s.report_date)}\n\n`;
  msg += `1️⃣ إجمالي المبيعات: ${fmtUSD(s.sales_gross)}\n`;
  msg += `2️⃣ تكلفة البضاعة المباعة: ${fmtUSD(s.sales_cost)}\n`;
  msg += `3️⃣ ربح البضاعة قبل التعديلات: ${fmtUSD(s.product_margin_before_adjustments)}\n`;
  msg += `4️⃣ الحسومات: ${fmtUSD(s.discounts)}\n`;
  msg += `5️⃣ المرتجعات: ${fmtUSD(s.returns)}`;
  if (Number(s.returns_cost ?? 0) > 0) msg += ` (تكلفتها المرجعة ${fmtUSD(s.returns_cost)})`;
  msg += `\n6️⃣ مصاريف اليوم: ${fmtUSD(s.expenses)}\n`;
  msg += `7️⃣ صافي الربح الحقيقي: ${fmtUSD(s.net_profit)}\n\n`;
  msg += `الفواتير: ${fmtNum(s.sales_bill_count)} بيع`;
  if (Number(s.return_bill_count ?? 0) > 0) msg += ` + ${fmtNum(s.return_bill_count)} مرتجع`;
  msg += ` | المصاريف: ${fmtNum(s.expense_entry_count)} حركة`;
  if (Number(s.sales_extras ?? 0) !== 0) msg += `\n➕ إضافات الفواتير الداخلة بالحساب: ${fmtUSD(s.sales_extras)}`;
  if (Number(s.missing_cost_lines ?? 0) > 0) {
    msg += `\n⚠️ ${fmtNum(s.missing_cost_lines)} سطر بلا تكلفة صحيحة؛ الصافي مؤقت حتى تُستكمل تكلفته بالأمين.`;
  } else {
    msg += `\n✅ كل أسطر اليوم لها تكلفة معروفة بالأمين.`;
  }
  msg += `\n🕒 آخر مزامنة: ${ageLabel(ageMinutes(rows[0].created_at))}`;
  await tg("sendMessage", { chat_id: chatId, text: msg });
}

// مبيعات اليوم بالكرتونة — قائمة واحدة مجمّعة حسب المادة، كل مادة برقم إجمالي
// واحد + تفصيل (مركز / مبيعات) بين قوسين. تسمية القناتين حسب تبويبات الأمين
// الفعلية: تجزئة = «مبيعات المركز»، جملة = «المبيعات» (وليس «الطلبيات»).
async function handleCartonsToday(chatId: number): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const rows = await restGet(`sales_line_items?sale_date=eq.${todayStr}&select=bill_type,item_name,qty,line_total,unit2_name,unit2_factor`);
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في حركة مبيعات مسجّلة اليوم لهلق 😕\n(هاي الميزة بتحتاج تشغيل مزامنة حركة المبيعات من جهاز Windows)." });
    return;
  }
  type Agg = { center: number; sales: number; unit2Name?: string; unit2Factor?: number };
  const items = new Map<string, Agg>();
  let totalRevenue = 0;
  for (const r of rows) {
    const name = String(r.item_name ?? "غير معروف");
    const cur = items.get(name) ?? { center: 0, sales: 0, unit2Name: r.unit2_name, unit2Factor: r.unit2_factor != null ? Number(r.unit2_factor) : undefined };
    const qty = Number(r.qty ?? 0);
    if (r.bill_type === "wholesale") cur.sales += qty; else cur.center += qty;
    items.set(name, cur);
    totalRevenue += Number(r.line_total ?? 0);
  }
  const lineFor = (name: string, v: Agg) => {
    const hasFactor = v.unit2Factor && v.unit2Factor > 0;
    const unit = hasFactor ? (v.unit2Name || "كرتونة") : "وحدة (بدون عامل تحويل معروف)";
    const toUnit = (q: number) => fmtNum(hasFactor ? q / v.unit2Factor! : q);
    const parts: string[] = [];
    if (v.center > 0) parts.push(`مركز ${toUnit(v.center)}`);
    if (v.sales > 0) parts.push(`مبيعات ${toUnit(v.sales)}`);
    const detail = parts.length > 1 ? ` (${parts.join(" + ")})` : "";
    return `• ${name}: ${toUnit(v.center + v.sales)} ${unit}${detail}`;
  };
  const entries = [...items.entries()].sort((a, b) => (b[1].center + b[1].sales) - (a[1].center + a[1].sales));

  // إجمالي الكراتين — بيجمع بس المواد اللي إلها عامل تحويل معروف (نفس وحدة
  // القياس، كرتونة)؛ المواد بدون عامل تحويل بتنعد لحالها وما بتنضاف للمجموع
  // لأنها بوحدات مختلفة (ما في معنى لجمعها مع كراتين).
  let totalCartons = 0, itemsWithoutFactor = 0;
  for (const [, v] of entries) {
    if (v.unit2Factor && v.unit2Factor > 0) totalCartons += (v.center + v.sales) / v.unit2Factor;
    else itemsWithoutFactor++;
  }
  let summary = `📦 إجمالي مبيعات اليوم بالكرتونة\nالكراتين: ${fmtNum(totalCartons)} كرتونة (${entries.length} مادة)\nقيمة المبيعات: ${fmtUSD(totalRevenue)}`;
  if (itemsWithoutFactor > 0) summary += `\n⚠️ ${itemsWithoutFactor} مادة بدون عامل تحويل معروف — مو داخلة بمجموع الكراتين.`;
  await tg("sendMessage", { chat_id: chatId, text: summary });

  const CHUNK = 25;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const part = entries.slice(i, i + CHUNK);
    const header = i === 0 ? `تفصيل المواد (${entries.length}):` : `تفصيل المواد — تابع:`;
    const body = part.map(([name, v]) => lineFor(name, v)).join("\n");
    await tg("sendMessage", { chat_id: chatId, text: `${header}\n${body}` });
  }
}

// ============================================================
// رسم بياني نصي لاتجاه المبيعات — «رسم المبيعات»
// (لا صورة فعلية — عرض نصي بسيط بالخانات + قائمة أرقام، أضمن وأبسط
// من محاولة رسم صورة حقيقية بهذه البيئة)
// ============================================================
function buildSparkline(values: number[]): string {
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  return values.map((v) => {
    const idx = Math.round(((v - min) / range) * (chars.length - 1));
    return chars[Math.max(0, Math.min(chars.length - 1, idx))];
  }).join("");
}

async function handleSalesChart(chatId: number): Promise<void> {
  const rows = await restGet(`daily_sales_summary?order=created_at.asc&limit=30&select=total_sales,created_at`);
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما في بيانات مبيعات كفاية لعرض رسم بياني 😕\nلسه ما وصل ولا ملخص مبيعات من الأمين." });
    return;
  }
  const values = rows.map((r: any) => Number(r.total_sales ?? 0));
  const spark = buildSparkline(values);
  let msg = `📊 اتجاه المبيعات (آخر ${rows.length} تحديث)\n\n${spark}\n\n`;
  rows.slice(-10).forEach((r: any) => { msg += `${fmtDate(r.created_at)}: ${fmtUSD(r.total_sales)}\n`; });
  if (rows.length < 5) msg += `\n⚠️ البيانات لسه قليلة (${rows.length} فقط) — الرسم رح يصير أدق مع تراكم مزامنة أيام أكتر.`;
  await tg("sendMessage", { chat_id: chatId, text: msg.trim() });
}

// ============================================================
// سؤال حر بالذكاء الاصطناعي — «اسأل <سؤال>»
// يستخدم نفس مفتاح ANTHROPIC_API_KEY المضبوط أصلاً بأسرار Supabase
// لدالة claude-assistant (الأسرار مشتركة بين كل دوال المشروع)
// ============================================================
// مسافة Levenshtein بسيطة — تسمح بفرق حرف واحد بين كلمتين (مفيد لأخطاء
// تفريغ الصوت الشائعة، متل "مستر" بدل "ماستر" — حرف ناقص بالنص).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function tokensSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  return Math.min(a.length, b.length) >= 3 && levenshtein(a, b) <= 1;
}

// يدوّر داخل سؤال حر (نص أو مفرّغ من صوت) عن أسماء مواد مذكورة فيه، ويرجع
// أقرب المطابقات — لحتى الذكاء الاصطناعي يقدر يجاوب عن كمية/سعر مادة محدّدة
// بدل ما يقول "ما عندي بيانات تفصيلية" (كانت هاي المشكلة قبل هالإضافة).
function findMentionedItems(question: string, items: any[]): any[] {
  const q = normalizeArabic(question);
  const qTokens = q.split(" ").filter((t) => t.length >= 3);
  if (!qTokens.length) return [];
  const scored: { score: number; r: any }[] = [];
  for (const r of items) {
    const name = normalizeArabic(r.item_name ?? r.item_key ?? "");
    if (!name) continue;
    const nameTokens = name.split(" ").filter((t) => t.length >= 3);
    if (!nameTokens.length) continue;
    const matched = nameTokens.filter((t) => qTokens.some((qt) => tokensSimilar(t, qt)));
    if (!matched.length) continue;
    const score = matched.length / nameTokens.length;
    if (score >= 0.5) scored.push({ score, r });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((s) => s.r);
}

async function buildBusinessContext(question: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`التاريخ: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`كل المبالغ بهالسياق بالدولار مباشرة (حسابات الأمين ممسوكة بالدولار أصلاً) — جاوب دايماً بالدولار، ولا تذكر أرقام بالليرة.`);

  try {
    const sales = await restGet(`daily_sales_summary?order=created_at.desc&limit=1&select=total_sales,total_cash,total_credit,created_at`);
    if (Array.isArray(sales) && sales.length) {
      const s = sales[0];
      lines.push(`آخر ملخص مبيعات (${fmtDate(s.created_at)}): الإجمالي ${fmtUSD(s.total_sales)}، نقدي ${fmtUSD(s.total_cash)}، آجل ${fmtUSD(s.total_credit)}.`);
    } else {
      lines.push("لا يوجد ملخص مبيعات متزامن بعد.");
    }
  } catch { lines.push("تعذّر جلب بيانات المبيعات."); }

  try {
    const profitRows = await restGet(`inventory_reports?source=eq.ameen_daily_profit&order=created_at.desc&limit=1&select=summary,created_at`);
    if (Array.isArray(profitRows) && profitRows.length && profitRows[0]?.summary) {
      const p = profitRows[0].summary;
      lines.push(`ربح اليوم من الأمين (${fmtDate(p.report_date)}): مبيعات ${fmtUSD(p.sales_gross)}، تكلفة بضاعة ${fmtUSD(p.sales_cost)}، حسومات ${fmtUSD(p.discounts)}، مرتجعات ${fmtUSD(p.returns)}، مصاريف ${fmtUSD(p.expenses)}، صافي ربح ${fmtUSD(p.net_profit)}.`);
      if (Number(p.missing_cost_lines ?? 0) > 0) lines.push(`تنبيه: ${fmtNum(p.missing_cost_lines)} سطر مبيع بلا تكلفة مكتملة؛ رقم الربح مؤقت.`);
    } else {
      lines.push("لا يوجد تقرير ربح يومي متزامن من الأمين بعد.");
    }
  } catch { lines.push("تعذّر جلب تقرير الربح اليومي."); }

  try {
    const report = await loadBalancesReport();
    if (report && report.items.length) {
      const debtors = report.items.filter((c) => Number(c.balance ?? 0) > 0).sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0));
      const totalDebt = debtors.reduce((s, c) => s + Number(c.balance ?? 0), 0);
      lines.push(`بيانات الأرصدة (بتاريخ ${report.reportDate}): ${report.items.length} زبون إجمالاً، ${debtors.length} منهم مدين، إجمالي الديون ${fmtUSD(totalDebt)}.`);
      if (debtors.length) {
        lines.push("أعلى المدينين:");
        debtors.slice(0, 15).forEach((c, i) => lines.push(`${i + 1}. ${c.name ?? c.key}: ${fmtUSD(c.balance)}`));
      }
    } else {
      lines.push("لا يوجد بيانات أرصدة زبائن متزامنة بعد.");
    }
  } catch { lines.push("تعذّر جلب بيانات الأرصدة."); }

  let priceItems: any[] = [];
  try {
    const thr = await getThreshold();
    priceItems = await restGet(`approved_price_items?select=item_name,item_key,stock_qty,unit1_name,unit2_name,unit2_factor,sale_price&limit=2000`) as any[];
    if (Array.isArray(priceItems)) {
      priceItems = mergeDuplicateStockRows(priceItems);
      const out = priceItems.filter((r: any) => Number(r.stock_qty ?? 0) <= 0);
      const low = priceItems.filter((r: any) => Number(r.stock_qty ?? 0) > 0 && Number(r.stock_qty ?? 0) <= thr);
      lines.push(`المخزون: ${out.length} مادة نافدة، ${low.length} مادة تحت حد التنبيه (${thr}).`);
      if (out.length) lines.push("نافد: " + out.slice(0, 10).map((r: any) => r.item_name ?? r.item_key).join("، "));
      if (low.length) lines.push("تحت الحد: " + low.slice(0, 10).map((r: any) => r.item_name ?? r.item_key).join("، "));
    } else {
      priceItems = [];
    }
  } catch { lines.push("تعذّر جلب بيانات المخزون."); }

  // بحث دقيق عن مواد قد تكون مذكورة بنص السؤال (خصوصاً مفيد للأسئلة الصوتية
  // يلي بيسأل فيها المالك عن كمية/سعر مادة محدّدة بالاسم)
  if (priceItems.length) {
    const mentioned = findMentionedItems(question, priceItems);
    if (mentioned.length) {
      lines.push("نتائج بحث دقيقة عن مواد وردت بالسؤال (استخدمها إذا كانت مطابقة لقصد السائل):");
      for (const r of mentioned) {
        const priceNote = r._priceVariants
          ? `، أسعار مختلفة مسجّلة (نسختين مكرّرتين لنفس المادة بالأمين): ${r._priceVariants.map(fmtUSD).join(" و ")}`
          : r.sale_price != null ? `، السعر ${fmtUSD(r.sale_price)}` : "";
        lines.push(`- ${r.item_name ?? r.item_key}: المخزون ${stockInCartons(r)}${priceNote}`);
      }
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    const priceChanges = await restGet(`price_change_log?changed_at=gte.${todayStr}&select=item_name`);
    if (Array.isArray(priceChanges)) lines.push(`مواد تغيّر سعرها اليوم: ${priceChanges.length}.`);
  } catch { /* تجاهل */ }
  try {
    const reqs = await restGet(`customer_requests?created_at=gte.${todayStr}&select=id`);
    if (Array.isArray(reqs)) lines.push(`طلبات عملاء اليوم: ${reqs.length}.`);
  } catch { /* تجاهل */ }

  return lines.join("\n");
}

async function askClaude(question: string, context: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY غير مضبوط بأسرار Supabase");

  const system = `أنت مساعد ذكي لصاحب محل دخان (OZK TOBACCO) وبترد بالعربية العامية السورية المختصرة والمباشرة، بدون مقدمات طويلة.
عندك بيانات حقيقية عن حالة العمل الآن — استخدمها فقط للإجابة على سؤال المستخدم، ولا تختلق أي رقم أو اسم مش موجود بالبيانات المعطاة.
كل الأرقام المالية بالسياق بالدولار أصلاً — جاوب دايماً بالدولار (رمز $)، ولا تذكر أي رقم بالليرة السورية إطلاقاً.
إذا بالسياق قسم "نتائج بحث دقيقة عن مواد" وفيه مادة تناسب سؤال المستخدم، استخدم رقمها بالضبط
(الكمية أو السعر) بدل ما تقول "ما عندي بيانات" — هاي بيانات حقيقية من المخزون مباشرة.
إذا السؤال بيحتاج بيانات مش متوفرة عندك بالسياق فعلاً، قول هيك بوضوح بدل ما تخمّن.
خلّي الجواب مختصر (ما يتجاوز 6 أسطر) إلا إذا السؤال بالأصل بيطلب قائمة أطول.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: `بيانات العمل الحالية:\n${context}\n\nسؤال المالك: ${question}` }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`anthropic_${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("رد فارغ من Claude");
  return text.trim();
}

// ============================================================
// تفريغ الرسائل الصوتية (Speech-to-Text) — عبر OpenAI Whisper
// (Anthropic ما بيدعم صوت مباشر عبر الـ Messages API). يحتاج
// OPENAI_API_KEY بأسرار Edge Function — نفس أسلوب ضبط ANTHROPIC_API_KEY.
// ============================================================
async function transcribeVoice(fileId: string): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY غير مضبوط بأسرار Supabase — لازم تضيفه لحتى يفهم البوت الرسائل الصوتية");

  const { token } = await getSecrets();
  const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const fileInfo = await fileInfoRes.json().catch(() => null) as any;
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error("تعذّر جلب الملف الصوتي من تيليغرام");

  const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!audioRes.ok) throw new Error(`تعذّر تحميل الملف الصوتي (${audioRes.status})`);
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append("file", audioBlob, "voice.ogg");
  form.append("model", "whisper-1");
  form.append("language", "ar");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`openai_${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("ما قدرت افهم الرسالة الصوتية");
  return text.trim();
}

async function handleAiQuestion(chatId: number, question: string): Promise<void> {
  await tg("sendMessage", { chat_id: chatId, text: "🤔 عم فكر..." });
  try {
    const context = await buildBusinessContext(question);
    const answer = await askClaude(question, context);
    await tg("sendMessage", { chat_id: chatId, text: `🤖 ${answer}` });
  } catch (e) {
    await tg("sendMessage", { chat_id: chatId, text: `صار خطأ وأنا عم فكر بالسؤال 😕\n(${String(e).slice(0, 150)})` });
  }
}

// ============================================================
// أزرار تجهيز/رفض طلبات واتساب (callback_data: order|accept|<id> أو order|reject|<id>)
// ============================================================
async function handleOrderAction(chatId: number, messageId: number, originalText: string, action: "accept" | "reject", orderId: string): Promise<void> {
  const rows = await restGet(`whatsapp_orders?id=eq.${orderId}&select=status`);
  if (!Array.isArray(rows) || !rows.length) {
    await tg("sendMessage", { chat_id: chatId, text: "ما لقيت هالطلب — يمكن انحذف 🤷" });
    return;
  }
  const current = String(rows[0].status ?? "pending");
  if (current !== "pending") {
    await tg("sendMessage", { chat_id: chatId, text: `هالطلب صار عليه إجراء مسبقاً (الحالة: ${current}) ✋` });
    return;
  }
  const newStatus = action === "accept" ? "processing" : "rejected";
  const res = await restPatch(`whatsapp_orders?id=eq.${orderId}`, {
    status: newStatus,
    processed_at: new Date().toISOString(),
    processed_by: "telegram",
  });
  if (!res.ok) { await tg("sendMessage", { chat_id: chatId, text: "صار خطأ وأنا عم حدّث الطلب 😕" }); return; }

  const label = action === "accept" ? "✅ الحالة: قيد التجهيز" : "❌ الحالة: مرفوض";
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: `${originalText}\n\n${label}`,
    reply_markup: { inline_keyboard: [] },
  });
}

async function handleSetThreshold(chatId: number, n: number) {
  if (!(n >= 1 && n <= 100000)) {
    await tg("sendMessage", { chat_id: chatId, text: "الرقم لازم يكون بين 1 و 100,000 🙏" });
    return;
  }
  await restPost(`bot_config`, { key: "low_stock_threshold", value: String(n) }, "resolution=merge-duplicates");
  await tg("sendMessage", { chat_id: chatId, text: `تمام ✅ صار حد تنبيه المخزون: ${n}\nالتنبيهات التلقائية ورد «شو ناقص» رح يستخدموا هالحد.` });
}

// يعيد true إذا كانت الرسالة أمر استعلام وعُولجت
async function handleCommand(chatId: number, text: string): Promise<boolean> {
  // سؤال حر بالذكاء الاصطناعي — على النص الأصلي (بدون تطبيع) للحفاظ على صياغة السؤال
  const askMatch = text.match(/^(?:اسأل|إسأل|أسأل)\b[:\s]*(.+)$/su);
  if (askMatch && askMatch[1].trim().length >= 2) { await handleAiQuestion(chatId, askMatch[1].trim()); return true; }

  const norm = normalizeArabic(text);
  if (text === "/menu" || ["القائمه", "قائمه", "منيو", "الاوامر"].includes(norm)) { await sendMenu(chatId); return true; }
  if (text === "/sales" || /^(المبيعات|مبيعات)( اليوم)?$/.test(norm)) { await handleSales(chatId); return true; }
  if (["رسم المبيعات", "الرسم البياني", "رسم بياني", "مخطط المبيعات", "شارت المبيعات"].includes(norm)) { await handleSalesChart(chatId); return true; }
  if (text === "/low" || ["شو ناقص", "النواقص", "نواقص", "ناقص", "المخزون الناقص", "المخزون"].includes(norm)) { await handleLowStock(chatId); return true; }
  if (text === "/debts" || ["الديون", "ديون", "المديونيات"].includes(norm)) { await handleDebts(chatId); return true; }
  if (text === "/pricesync" || ["فحص الاسعار", "مزامنه الاسعار", "حاله الاسعار", "تزامن الاسعار"].includes(norm)) { await handlePriceSyncStatus(chatId); return true; }
  if (text === "/status" || ["حاله النظام", "فحص النظام", "وضع النظام", "النظام"].includes(norm)) { await handleSystemStatus(chatId); return true; }
  if (["ربح اليوم", "الربح", "شو ربحنا", "ربحنا اليوم", "صافي الربح", "قديش ربحنا", "كم ربحنا اليوم"].includes(norm)) { await handleProfitToday(chatId); return true; }
  // أي رسالة فيها ذكر "كرتونة/كراتين" — «مبيعات اليوم بالكرتونة»، «الكراتين اليوم»، إلخ
  if (norm.includes("كرتون") || norm.includes("كراتين")) { await handleCartonsToday(chatId); return true; }
  let m = norm.match(/^حد التنبيه\s+(\d+)\s*$/);
  if (m) { await handleSetThreshold(chatId, parseInt(m[1])); return true; }
  m = norm.match(/^سعر\s+(.+)$/);
  if (m) { await handlePriceQuery(chatId, m[1].trim()); return true; }
  // «حركة مادة X» / «حركة X» — لكن مش «حركة حساب X» (هاي محجوزة لكشف حساب الزبون)
  m = norm.match(/^حركه\s+(?!حساب)(?:ماده\s+)?(.+)$/);
  if (m) { await handleItemMovement(chatId, m[1].trim()); return true; }
  return false;
}

// ============================================================
// التذكيرات (المنطق الأصلي كما هو)
// ============================================================
function relativeMinutes(text: string): number | null {
  if (!/بعد/.test(text)) return null;
  if (/بعد\s*(?:نص|نصف)\s*ساع/.test(text)) return 30;
  if (/بعد\s*ربع\s*ساع/.test(text)) return 15;
  let m = text.match(/بعد\s*(\d+)\s*(?:دقيقة|دقايق|دقائق|دقيقه|دقيق|د)\b/);
  if (m) return parseInt(m[1]);
  m = text.match(/بعد\s*(\d+)\s*(?:ساعات|ساعة|ساعه|ساع)/);
  if (m) { let mins = parseInt(m[1]) * 60; if (/ونص|و\s*نص/.test(text)) mins += 30; else if (/وربع|و\s*ربع/.test(text)) mins += 15; return mins; }
  if (/بعد\s*ساع/.test(text)) { let mins = 60; if (/ونص|و\s*نص/.test(text)) mins += 30; else if (/وربع|و\s*ربع/.test(text)) mins += 15; return mins; }
  if (/بعد\s*دقيق/.test(text)) return 1;
  return null;
}
function parseClock(text: string): { hour: number; minute: number } | null {
  let m = text.match(/(\d{1,2}):(\d{2})/);
  if (m) return { hour: parseInt(m[1]), minute: parseInt(m[2]) };
  let hour: number | null = null;
  m = text.match(/(?:الساعة|الساعه|عالساعة|عالساعه|ساعة|ساعه)\s*(\d{1,2})/);
  if (m) hour = parseInt(m[1]);
  if (hour === null) {
    const p = text.match(/(\d{1,2})\s*(?:عصر|العصر|مسا|مساء|المسا|المساء|صبح|صباح|الصبح|الصباح|ظهر|الظهر|ضهر|الضهر|ليل|الليل|عشية|العشية)/)
           || text.match(/(?:عصر|العصر|مسا|مساء|المسا|المساء|صبح|صباح|الصبح|الصباح|ظهر|الظهر|ضهر|الضهر|ليل|الليل|عشية|العشية)\s*(?:الساعة\s*)?(\d{1,2})/);
    if (p) hour = parseInt(p[1]);
  }
  if (hour === null) return null;
  let minute = 0;
  if (/والنص|و\s*نص|ونص/.test(text)) minute = 30;
  else if (/والربع|و\s*ربع|وربع/.test(text)) minute = 15;
  else if (/وثلث|وتلت/.test(text)) minute = 20;
  else if (/إلا\s*ربع|الا\s*ربع/.test(text)) { minute = 45; hour = (hour + 23) % 24; }
  if (hour > 23) return null;
  return { hour, minute };
}
function parseReminder(raw: string): { ok: boolean; body?: string; remindUtc?: Date; local?: Date } {
  const text = normalizeDigits(raw).trim();
  const lnow = localNow();
  let body = text.replace(/^(?:ذكّرني|ذكرني|ذكرنى|فكّرني|فكرني|تذكير)\s*/u, "").replace(/^(?:بالساعة|عالساعة)\s*/u, "").trim();
  if (!body) body = text;

  const rel = relativeMinutes(text);
  if (rel !== null) { const t = new Date(lnow.getTime() + rel * 60000); return { ok: true, body, remindUtc: localToUtc(t), local: t }; }

  let dayShift = 0;
  if (/بعد\s*بكر|بعد\s*غد/.test(text)) dayShift = 2;
  else if (/بكرا|بكره|بكرة|غدا|غداً|الغد/.test(text)) dayShift = 1;
  const hadDay = /بعد\s*بكر|بعد\s*غد|بكرا|بكره|بكرة|غدا|غداً|الغد|اليوم|اليومة|اليومه/.test(text);

  let hour: number, minute: number;
  const hm = parseClock(text);
  if (hm) { hour = hm.hour; minute = hm.minute; }
  else if (/ظهر|الظهر|ضهر|الضهر/.test(text) && !/بعد\s*ال?ظهر|بعد\s*ال?ضهر/.test(text)) { hour = 12; minute = 0; }
  else return { ok: false };

  const pm = /عصر|مسا|مساء|ليل|عشي|بعد\s*ال?ظهر|بعد\s*ال?ضهر/.test(text);
  const am = /صبح|صباح|فجر|بكير/.test(text);
  const noon = /ظهر|الظهر|ضهر|الضهر/.test(text) && !/بعد\s*ال?ظهر|بعد\s*ال?ضهر/.test(text);
  if (am) { if (hour === 12) hour = 0; }
  else if (pm) { if (hour < 12) hour += 12; }
  else if (noon) { if (hour >= 1 && hour <= 5) hour += 12; }
  else if (hour >= 1 && hour <= 7) hour += 12;

  const t = new Date(Date.UTC(lnow.getUTCFullYear(), lnow.getUTCMonth(), lnow.getUTCDate() + dayShift, hour, minute, 0));
  if (!hadDay && t.getTime() <= lnow.getTime()) t.setUTCDate(t.getUTCDate() + 1);
  return { ok: true, body, remindUtc: localToUtc(t), local: t };
}
function formatWhen(local: Date, lnow: Date): string {
  const h = local.getUTCHours();
  const mm = local.getUTCMinutes();
  const ampm = h < 12 ? "ص" : "م";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  const time = `${h12}:${mm.toString().padStart(2, "0")} ${ampm}`;
  const dDay = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const nDay = Date.UTC(lnow.getUTCFullYear(), lnow.getUTCMonth(), lnow.getUTCDate());
  const diff = Math.round((dDay - nDay) / 86400000);
  let day = `${local.getUTCDate()}/${local.getUTCMonth() + 1}`;
  if (diff === 0) day = "اليوم"; else if (diff === 1) day = "بكرا"; else if (diff === 2) day = "بعد بكرا";
  return `${day} الساعة ${time}`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  let secrets;
  try { secrets = await getSecrets(); } catch { return new Response("err", { status: 500 }); }
  const hdr = req.headers.get("x-telegram-bot-api-secret-token");
  if (hdr !== secrets.webhook_secret) return new Response("forbidden", { status: 401 });

  // وضع التشخيص متاح فقط بعد التحقق من سر الـ webhook
  if (url.searchParams.get("debug") === "1") {
    return new Response(JSON.stringify({ ok: true, diag: lastDiag }), { headers: { "Content-Type": "application/json" } });
  }

  let update: any;
  try { update = await req.json(); } catch { return new Response("ok"); }

  // ضغطات الأزرار التفاعلية (callback queries)
  const cq = update.callback_query;
  if (cq) {
    const cqChatId = cq.message?.chat?.id ?? cq.from?.id;
    let owner: number | null;
    try { owner = await getOwner(); } catch { return new Response("ok"); }
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (owner === null || cq.from?.id !== owner || !cqChatId) return new Response("ok");
    const data = String(cq.data ?? "");
    try {
      if (data === "sales") await handleSales(cqChatId);
      else if (data === "profit") await handleProfitToday(cqChatId);
      else if (data === "low") await handleLowStock(cqChatId);
      else if (data === "debts") await handleDebts(cqChatId);
      else if (data === "chart") await handleSalesChart(cqChatId);
      else if (data === "price_sync") await handlePriceSyncStatus(cqChatId);
      else if (data === "system_status") await handleSystemStatus(cqChatId);
      else if (data === "help") await tg("sendMessage", { chat_id: cqChatId, text: WELCOME });
      else if (data.startsWith("b|")) await handleCustomerQuery(cqChatId, "balance", data.slice(2));
      else if (data.startsWith("s|")) await handleCustomerQuery(cqChatId, "statement", data.slice(2));
      else if (data.startsWith("order|")) {
        const parts = data.split("|"); // order|accept|<id> أو order|reject|<id>
        const action = parts[1] === "accept" ? "accept" : parts[1] === "reject" ? "reject" : null;
        const orderId = parts[2];
        if (action && orderId && cq.message?.message_id) {
          await handleOrderAction(cqChatId, cq.message.message_id, String(cq.message.text ?? ""), action, orderId);
        }
      }
    } catch (e) {
      await tg("sendMessage", { chat_id: cqChatId, text: `صار خطأ 😕 جرّب كمان مرة.\n(${String(e).slice(0, 80)})` });
    }
    return new Response("ok");
  }

  const msg = update.message ?? update.edited_message;
  if (!msg || !msg.chat) return new Response("ok");
  const chatId = msg.chat.id;
  let text = (msg.text ?? "").trim();

  let owner: number | null;
  try { owner = await getOwner(); } catch { return new Response("ok"); }
  if (owner === null) { await setOwner(chatId); owner = chatId; }
  if (chatId !== owner) { await tg("sendMessage", { chat_id: chatId, text: "🔒 هذا بوت خاص." }); return new Response("ok"); }

  // رسالة صوتية (voice) أو ملاحظة فيديو دائرية بصوت (video_note بلا صوت مو مدعومة) — نفرّغها لنص أولاً
  const voice = msg.voice;
  if (voice?.file_id && !text) {
    try {
      await tg("sendMessage", { chat_id: chatId, text: "🎙️ عم افهم الرسالة الصوتية..." });
      text = await transcribeVoice(voice.file_id);
      await tg("sendMessage", { chat_id: chatId, text: `📝 سمعتك تقول: "${text}"` });
    } catch (e) {
      await tg("sendMessage", { chat_id: chatId, text: `صار خطأ وأنا عم افهم الصوت 😕\n(${String(e).slice(0, 150)})` });
      return new Response("ok");
    }
  }

  if (text === "/start" || text === "/help") {
    await tg("sendMessage", { chat_id: chatId, text: WELCOME, reply_markup: MENU_KEYBOARD });
    return new Response("ok");
  }
  if (!text) {
    await tg("sendMessage", { chat_id: chatId, text: "ابعتلي طلبك كرسالة مكتوبة 🙏\nمثال: رصيد حسن عباس\nأو اكتب: القائمة" });
    return new Response("ok");
  }

  // أوامر الاستعلام السريعة (قائمة/مبيعات/نواقص/ديون/سعر/حد التنبيه)
  try {
    if (await handleCommand(chatId, text)) return new Response("ok");
  } catch (e) {
    await tg("sendMessage", { chat_id: chatId, text: `صار خطأ وأنا عم جيب البيانات 😕 جرّب كمان مرة.\n(${String(e).slice(0, 100)})` });
    return new Response("ok");
  }

  // استعلامات الزبائن (رصيد / كشف حساب) — قبل محلّل التذكيرات
  const { wantPdf, text: textForQuery } = stripPdfTrigger(text);
  const q = extractCustomerQuery(textForQuery);
  if (q) {
    try {
      if (q.kind === "statement" && wantPdf) await handleStatementFileCommand(chatId, q.name);
      else await handleCustomerQuery(chatId, q.kind, q.name);
    }
    catch (e) { await tg("sendMessage", { chat_id: chatId, text: `صار خطأ وأنا عم جيب البيانات 😕 جرّب كمان مرة.\n(${String(e).slice(0, 100)})` }); }
    return new Response("ok");
  }

  const parsed = parseReminder(text);
  if (!parsed.ok) {
    // ما تعرّفنا عليها كأمر محدد ولا تذكير — نعتبرها سؤال حر ونمرّرها مباشرة للذكاء الاصطناعي
    // (بدون ما يحتاج المستخدم يكتب "اسأل" بالأول)
    await handleAiQuestion(chatId, text);
    return new Response("ok");
  }

  await restPost("reminders", { chat_id: chatId, body: parsed.body, remind_at: parsed.remindUtc!.toISOString(), raw_message: text });
  const when = formatWhen(parsed.local!, localNow());
  await tg("sendMessage", { chat_id: chatId, text: `تمام ✅ رح ذكّرك ${when}:\n${parsed.body}` });
  return new Response("ok");
});
