import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TZ_OFFSET_HOURS = 3; // Asia/Damascus (UTC+3)
const PROFILE = "public"; // PostgREST default schema here is "api"; our tables live in public

const WELCOME = `أهلاً 👋 أنا مساعدك الشخصي.

🔔 التذكيرات — اكتبلي شو بدك تتذكّر وإيمتى:
• ذكّرني دقّ لأبو أحمد الساعة 5 العصر
• ذكّرني بعد 20 دقيقة احكي مع المورّد
• ذكّرني بكرا الساعة 11

💳 أرصدة الزبائن — اسألني مباشرة:
• رصيد حسن عباس
• كشف حساب حسن عباس

جرّب هلأ 👇`;

const HELP_PARSE = `ما قدرت أعرف الوقت بالضبط 🤔
اكتب الوقت بوضوح، مثلاً:
• ... الساعة 5 العصر
• ... الساعة 9 والنص الصبح
• ... بعد ساعة  /  بعد 20 دقيقة
• ... بكرا الساعة 11

ولو بدك رصيد زبون اكتب: رصيد <اسم الزبون>
أو: كشف حساب <اسم الزبون>

جرّب كمان مرة 🙏`;

let lastDiag: Record<string, unknown> = {};
let cachedSecrets: { token: string; webhook_secret: string } | null = null;
async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;
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
  return res.json();
}
async function restPost(path: string, body: unknown, prefer?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Profile": PROFILE };
  if (prefer) headers["Prefer"] = prefer;
  return fetch(`${SUPA_URL}/rest/v1/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
async function tg(method: string, payload: unknown) {
  const { token } = await getSecrets();
  await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
async function getOwner(): Promise<number | null> {
  const rows = await restGet(`bot_config?key=eq.owner_chat_id&select=value`);
  if (Array.isArray(rows) && rows.length) return Number(rows[0].value);
  return null;
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

function matchCustomers(items: CustomerEntry[], query: string): CustomerEntry[] {
  const q = normalizeArabic(query);
  const qTokens = q.split(" ").filter(Boolean);
  const scored: { score: number; c: CustomerEntry }[] = [];
  for (const c of items) {
    const n = normalizeArabic(`${c.name ?? ""} ${c.key ?? ""}`);
    if (!n) continue;
    let score = 0;
    if (n === q || normalizeArabic(c.name ?? "") === q) score = 4;
    else if (normalizeArabic(c.name ?? "").startsWith(q)) score = 3;
    else if (n.includes(q)) score = 2;
    else if (qTokens.length > 1 && qTokens.every((t) => n.includes(t))) score = 1;
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
function fmtDate(s?: string): string {
  if (!s) return "—";
  return String(s).slice(0, 10);
}
function balanceLine(balance?: number): string {
  const b = Number(balance ?? 0);
  if (b > 0) return `${fmtNum(b)} — عليه (مدين) 🔴`;
  if (b < 0) return `${fmtNum(Math.abs(b))} — له (دائن) 🟢`;
  return "صفر ✅";
}

function buildBalanceReply(c: CustomerEntry, reportDate: string): string {
  let msg = `💳 رصيد: ${c.name ?? c.key}\n`;
  msg += `الرصيد: ${balanceLine(c.balance)}\n`;
  if (Number(c.creditLimit ?? 0) > 0) {
    msg += `حد الائتمان: ${fmtNum(c.creditLimit)}\n`;
    msg += `المتبقي من الحد: ${fmtNum(c.remainingLimit)}\n`;
  }
  const lastPay = c.recentPayments?.[0];
  if (lastPay) msg += `آخر دفعة: ${fmtNum(lastPay.amount)} بتاريخ ${fmtDate(lastPay.date)}\n`;
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
      if (debit > 0) line += `مدين ${fmtNum(debit)}`;
      else if (credit > 0) line += `دائن ${fmtNum(credit)}`;
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
      msg += `• ${fmtDate(p.date)} — ${fmtNum(p.amount)}${p.notes ? ` (${String(p.notes).slice(0, 40)})` : ""}\n`;
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
  if (matches.length === 1 || kind === "balance") {
    if (kind === "balance" && matches.length > 1 && matches.length <= 5) {
      // عدة نتائج للرصيد: اعرضها كلها باختصار
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
    const c = matches[0];
    const text = kind === "balance" ? buildBalanceReply(c, report.reportDate) : buildStatementReply(c, report.reportDate);
    await tg("sendMessage", { chat_id: chatId, text });
    return;
  }
  // كشف حساب مع أكثر من نتيجة: اطلب التحديد
  let msg = `في ${matches.length} زبون مطابق لـ«${name}» — لمين بدك الكشف؟\n`;
  for (const c of matches.slice(0, 5)) msg += `• ${c.name ?? c.key}\n`;
  msg += `\nاكتب: كشف حساب <الاسم الكامل>`;
  await tg("sendMessage", { chat_id: chatId, text: msg });
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
  if (url.searchParams.get("debug") === "1") {
    try { await getSecrets(); return new Response(JSON.stringify({ ok: true, diag: lastDiag }), { headers: { "Content-Type": "application/json" } }); }
    catch (e) { return new Response(JSON.stringify({ ok: false, diag: lastDiag, err: String(e) }), { headers: { "Content-Type": "application/json" } }); }
  }

  let secrets;
  try { secrets = await getSecrets(); } catch { return new Response("err", { status: 500 }); }
  const hdr = req.headers.get("x-telegram-bot-api-secret-token");
  if (hdr !== secrets.webhook_secret) return new Response("forbidden", { status: 401 });

  let update: any;
  try { update = await req.json(); } catch { return new Response("ok"); }
  const msg = update.message ?? update.edited_message;
  if (!msg || !msg.chat) return new Response("ok");
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();

  let owner = await getOwner();
  if (owner === null) { await setOwner(chatId); owner = chatId; }
  if (chatId !== owner) { await tg("sendMessage", { chat_id: chatId, text: "🔒 هذا بوت خاص." }); return new Response("ok"); }

  if (text === "/start" || text === "/help") { await tg("sendMessage", { chat_id: chatId, text: WELCOME }); return new Response("ok"); }
  if (!text) { await tg("sendMessage", { chat_id: chatId, text: "ابعتلي طلبك كرسالة مكتوبة 🙏\nمثال: ذكّرني دقّ لأبو أحمد الساعة 5 العصر\nأو: رصيد حسن عباس" }); return new Response("ok"); }

  // استعلامات الزبائن أولاً (رصيد / كشف حساب) — قبل محلّل التذكيرات
  const q = extractCustomerQuery(text);
  if (q) {
    try { await handleCustomerQuery(chatId, q.kind, q.name); }
    catch (e) { await tg("sendMessage", { chat_id: chatId, text: `صار خطأ وأنا عم جيب البيانات 😕 جرّب كمان مرة.\n(${String(e).slice(0, 100)})` }); }
    return new Response("ok");
  }

  const parsed = parseReminder(text);
  if (!parsed.ok) { await tg("sendMessage", { chat_id: chatId, text: HELP_PARSE }); return new Response("ok"); }

  await restPost("reminders", { chat_id: chatId, body: parsed.body, remind_at: parsed.remindUtc!.toISOString(), raw_message: text });
  const when = formatWhen(parsed.local!, localNow());
  await tg("sendMessage", { chat_id: chatId, text: `تمام ✅ رح ذكّرك ${when}:\n${parsed.body}` });
  return new Response("ok");
});
