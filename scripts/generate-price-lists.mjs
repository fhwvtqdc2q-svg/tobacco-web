/**
 * generate-price-lists.mjs
 * node scripts/generate-price-lists.mjs [--rate 14050] [--validity 30]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

const args = process.argv.slice(2);
const get  = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : null; };
const rateFile = resolve(root, "scripts/exchange-rate.json");
const storedRate = JSON.parse(readFileSync(rateFile, "utf8"));
const requestedRate = get("--rate") ?? (String(process.env.SYP_RATE || "").trim() || null);
const SYP_RATE = Number(requestedRate ?? storedRate.sypPerUsd ?? 14050);
if (!Number.isFinite(SYP_RATE) || SYP_RATE <= 0) throw new Error("سعر الصرف غير صالح.");
if (requestedRate !== null) {
  writeFileSync(rateFile, `${JSON.stringify({ sypPerUsd: SYP_RATE, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
}
const SYP_FILE_TAG = "14050"; // اسم رابط ثابت؛ السعر الفعلي داخل الملف يأتي من exchange-rate.json
const VALIDITY = Number(get("--validity") ?? 30);

// ── تاريخ ─────────────────────────────────────────────────────────────────────
const today     = new Date();
const issueDate = today.toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" });
const isoDate   = today.toISOString().slice(0, 10);

// ── بيانات ────────────────────────────────────────────────────────────────────
// المصدر الأساسي: أسعار الموقع الحية من Supabase (جملة + مفرق يدوي).
// price-data.json يبقى مرجعًا لأسماء المجموعات وكاحتياط إذا تعذّر الاتصال.
const jsonItems = JSON.parse(readFileSync(resolve(root, "scripts/price-data.json"), "utf8"));
const groupByName = new Map(jsonItems.map(i => [String(i.name).trim(), i.group]));

const SUPABASE_URL = "https://dyxbirfpxeocqffnfdeb.supabase.co";
const SUPABASE_KEY = "sb_publishable_RkM_QDWxk8Yekqz9KBKXBw_Yl14zhSH";
let feed = [];
let feedError = "";
try {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/available_price_sync_feed?select=item_key,item_name,unit1_name,unit2_name,unit2_factor,unit2_price,retail_carton_usd,stock_qty,stock_status,source_synced_at,updated_at&order=item_name.asc&limit=5000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Accept-Profile": "public" } }
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  feed = await res.json();
} catch (error) {
  feedError = error instanceof Error ? error.message : String(error);
}

if (!feed.length) {
  throw new Error(`تعذّر توليد النشرة: لا يوجد جرد أمين متاح بكمية موجبة في available_price_sync_feed. ${feedError}`);
}

let usdItems, sypItems;
if (feed.length) {
  // قد تعيد النافذة مفتاحين قديم/جديد للاسم المعروض نفسه بسبب اختلافات إملائية
  // في item_key. نفصل الاختيار بين الجملة والمفرق كي لا يلغي تحديث أحدهما الآخر.
  const latestEligibleRows = (isEligible) => {
    const latest = new Map();
    for (const row of feed) {
      const displayName = String(row.item_name || "").trim();
      if (!displayName || !isEligible(row)) continue;
      const previous = latest.get(displayName);
      const rowTime = Date.parse(row.updated_at || "") || 0;
      const previousTime = Date.parse(previous?.updated_at || "") || 0;
      if (!previous || rowTime >= previousTime) latest.set(displayName, row);
    }
    return [...latest.values()];
  };

  const mapRow = (r) => {
    const name = String(r.item_name || "").trim();
    return {
      name,
      group: groupByName.get(name) ?? name.split(" ")[0],
      unit: r.unit2_name || "كرتونة",
      unit1: r.unit1_name || "",
      unitFactor: Number(r.unit2_factor) > 0 ? Number(r.unit2_factor) : 10,
      usd: Number(r.unit2_price || 0),
      retailCarton: Number(r.retail_carton_usd || 0),
      stockQty: Number(r.stock_qty || 0),
    };
  };
  // الجملة: سعر دولار صالح + كرتونة/طرد/شرحة كاملة واحدة على الأقل.
  usdItems = latestEligibleRows((row) => {
    const stockQty = Number(row.stock_qty || 0);
    const unit2Factor = Number(row.unit2_factor || 0);
    return Number(row.unit2_price || 0) > 0 && unit2Factor > 0 && stockQty / unit2Factor >= 1;
  }).map(mapRow);

  // المفرق: سعر سوري صالح + أي كمية موجبة، حتى لو كانت أقل من وحدة ثانية كاملة.
  sypItems = latestEligibleRows((row) =>
    Number(row.retail_carton_usd || 0) > 0 && Number(row.stock_qty || 0) > 0
  ).map(mapRow);
  console.log(`أسعار حية من Supabase: ${usdItems.length} جملة، ${sypItems.length} مفرق`);
}

// ── فصل الوزاري وتجميع أصناف المعسل المتشابهة ────────────────────────────────
const includes = (name, text) => name.includes(text);
const isWazari = (item) => {
  const name = item.name;
  if (includes(name, "نخلة") && (includes(name, "محزر") || includes(name, "وزاري"))) return true;
  if (includes(name, "كينت") && !includes(name, "حرة")) return true;
  if (includes(name, "وينستون") && !includes(name, "حرة")) return true;
  if (includes(name, "فاخر") && includes(name, "اسود") && includes(name, "محزر")) return true;
  if (includes(name, "مالبورو") && (
    includes(name, "محزر") ||
    (includes(name, "ورق") && (includes(name, "ابيض") || includes(name, "أبيض") || includes(name, "احمر") || includes(name, "أحمر"))) ||
    (includes(name, "كوين") && (includes(name, "ازرق") || includes(name, "أزرق")))
  )) return true;
  return false;
};

const shishaLabel = (item) => {
  const name = item.name;
  if (includes(name, "مزايا")) return includes(name, "كف") ? "مزايا كف" : "مزايا مشكل";
  if (includes(name, "الاسطورة")) return "أسطورة مشكل";
  if (includes(name, "معسل روز")) return "روز مشكل";
  if (includes(name, "الصفوة")) return "صفوة جميع النكهات";
  if (includes(name, "فاخر")) {
    const black = includes(name, "اسود") || includes(name, "أسود");
    const red = includes(name, "احمر") || includes(name, "أحمر");
    if (black && includes(name, "كف")) return "فاخر أسود كف";
    if (black) return "فاخر أسود كروز";
    if (red) return "فاخر أحمر كروز";
    return "فاخر نكهات";
  }
  // نخلة تبقى باسم الصنف الكامل كي يعرف الزبون النوع بوضوح.
  if (includes(name, "نخلة")) return name;
  return name;
};

const consolidateGeneral = (items, mode) => {
  const result = [];
  const seen = new Set();
  for (const item of items.filter(item => !isWazari(item))) {
    const isShisha = ["معسل", "مزايا", "نخلة"].includes(item.group);
    if (!isShisha) { result.push(item); continue; }
    // عبوات 100غ لا تدخل أي نشرة معسل عامة مهما كانت العلامة.
    if (/100\s*غ/.test(item.name)) continue;
    const name = shishaLabel(item);
    // كل تسمية مجمعة تظهر مرة واحدة فقط؛ الأسعار ستعدّل من لوحة الأسعار لاحقاً.
    const key = name;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, name, group: "معسل" });
  }
  return result;
};

const toWazari = (items) => items.filter(isWazari).map(item => {
  let group = "وزاري متنوع";
  if (includes(item.name, "نخلة")) group = "نخلة وزاري";
  else if (includes(item.name, "كينت")) group = "كينت وزاري";
  else if (includes(item.name, "وينستون")) group = "وينستون وزاري";
  else if (includes(item.name, "مالبورو")) group = "مالبورو وزاري";
  else if (includes(item.name, "فاخر")) group = "فاخر وزاري";
  return { ...item, group };
});

const usdWazariItems = toWazari(usdItems);
const sypWazariItems = toWazari(sypItems);
usdItems = consolidateGeneral(usdItems, "usd");
sypItems = consolidateGeneral(sypItems, "syp");

// ── شعار ─────────────────────────────────────────────────────────────────────
const logoB64 = readFileSync(resolve(root, "public/icons/ozk-logo.png")).toString("base64");
const logoSrc = `data:image/png;base64,${logoB64}`;

const buildGroups = (list) => {
  const groupMap = new Map();
  for (const item of list) {
    const original = item.group ?? item.name.split(" ")[0];
    const cigarItem = item.name.includes("سيغار") || ["سيغار", "كلارو", "سيناتور"].includes(original);
    const g = cigarItem ? "السيغار" : ({
      "جيتان": "غلواز",
      "ريد": "حمرا",
      "شرق": "حمرا",
      "أوريس": "أوريس",
      "اوريس": "أوريس",
      "تي": "تي اس",
      "دخان": "ام تي",
      "وينستون": "أصناف الحرة",
      "مالبورو": "أصناف الحرة",
      "كينغ": "كينغ دوم",
      "كابتن": "كابتن بلاك",
    })[original] ?? original;
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g).push(item);
  }
  return [...groupMap.entries()];
};

const buildColumnLayout = (list) => {
  const groups = buildGroups(list);
  const byName = new Map(groups);
  const take = (names) => names.map(name => byName.get(name) ? [name, byName.get(name)] : null).filter(Boolean);

  // التسلسل المتفق عليه، وكل عمود مستقل عن ارتفاع العمود المقابل.
  const right = take(["ماستر", "كابتن بلاك", "اوسكار", "اختمار", "روز", "1970", "كينغ دوم", "مانشستر"]);
  const left = take(["غلواز", "اليغانس", "تي اس", "أوريس", "حمرا", "يونايتد", "ولسون", "نابولي"]);
  const reserved = new Set([...right, ...left].map(([name]) => name));
  const specialNames = new Set(["معسل", "مزايا", "نخلة", "فحم", "فيبات", "ورق", "قداحات", "سلفان"]);
  const remaining = groups.filter(([name]) => !reserved.has(name) && !specialNames.has(name));

  // توزيع بقية دخان وسيغار حسب عدد الأسطر لإكمال العمودين بأقرب ارتفاع ممكن.
  const height = (stack) => stack.reduce((sum, [, items]) => sum + items.length + 1, 0);
  for (const group of remaining) {
    (height(right) <= height(left) ? right : left).push(group);
  }

  const specialMap = new Map(groups.filter(([name]) => specialNames.has(name)));
  // المعسل عمود مستقل، وفي مقابله الفحم ثم الورق فالفيب والقداحات.
  const specialRight = take(["فحم", "ورق", "فيبات", "قداحات", "سلفان"]).filter(([name]) => specialMap.has(name));
  const specialLeft = take(["معسل"]).filter(([name]) => specialMap.has(name));
  return { right, left, specialRight, specialLeft };
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Almarai:wght@300;400;700;800&display=swap');

  * { margin:0; padding:0; box-sizing:border-box; }

  body {
    font-family: 'Almarai', Tahoma, Arial, sans-serif;
    --page: #0c0a07;
    --surface: #141009;
    --surface-alt: #0f0c07;
    --surface-strong: #1a1208;
    --text: #f3ead2;
    --muted: #a88d61;
    --line: #33240d;
    --gold: #d7a83f;
    --gold-strong: #efc45d;
    --button-text: #0c0a07;
    background: var(--page);
    color: var(--text);
    direction: rtl;
    transition: background .2s ease, color .2s ease;
  }

  body[data-theme="light"] {
    --page: #fffdf8;
    --surface: #ffffff;
    --surface-alt: #f8f3e8;
    --surface-strong: #5b3a09;
    --text: #211b12;
    --muted: #796a54;
    --line: #e4d8c1;
    --gold: #a56f09;
    --gold-strong: #7a4f00;
    --button-text: #ffffff;
  }

  @page { size: A4 portrait; margin: 0; }

  @media print {
    html, body, .columns, .column-stack {
      background: var(--page) !important;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background: var(--page) !important;
      z-index: -1;
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .theme-switch { display: none !important; }
    .secondary-page {
      break-before: page;
      page-break-before: always;
      break-inside: avoid-page;
      page-break-inside: avoid;
      margin-top: 0;
    }
  }

  /* ── رأس ─────────────────────────────────── */
  .header {
    background: var(--page);
    padding: 10px 14px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 2px solid var(--gold);
  }
  .header-logo {
    height: 48px;
    width: auto;
  }
  .header-center {
    flex: 1;
    text-align: center;
  }
  .header-title {
    font-size: 20px;
    font-weight: 900;
    color: var(--gold-strong);
    letter-spacing: 1px;
  }
  .header-date {
    font-size: 10.5px;
    color: var(--muted);
    margin-top: 2px;
    font-weight: 600;
    direction: ltr;
  }
  .currency-badge {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 20px;
    font-size: 10.5px;
    font-weight: 700;
    margin-top: 4px;
    letter-spacing: .3px;
  }
  .badge-usd { background: var(--gold); color: var(--button-text); }
  .badge-syp { background: #2d6a2d; color: #c8f0c8; }
  .new-syria-flag {
    display:inline-grid; grid-template-rows:repeat(3, 3px); width:16px; height:9px;
    overflow:hidden; border:1px solid rgba(255,255,255,.45); border-radius:1px;
    vertical-align:middle; direction:ltr; margin-inline-end:4px;
  }
  .new-syria-flag .green { background:#16813b; }
  .new-syria-flag .white { background:#fff; color:#d71920; font-size:4px; line-height:3px; letter-spacing:1px; text-align:center; }
  .new-syria-flag .black { background:#111; }
  .header-right {
    min-width: 62px;
    text-align: left;
  }

  /* ── شريط فرعي ──────────────────────────── */
  .subheader {
    background: var(--surface-alt);
    border-bottom: 1px solid var(--line);
    padding: 4px 14px;
    font-size: 9px;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    letter-spacing: .2px;
    margin-bottom: 6px;
  }
  .subheader strong { color: var(--gold-strong); }

  /* ── عمودان مستقلان بلا فراغات بين المجموعات ── */
  .columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    align-items: start;
    padding: 0 8px 8px;
    background: var(--page);
    position: relative;
  }
  .columns::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 8px;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: var(--gold);
    border-radius: 2px;
  }
  .column-stack { min-width: 0; background: var(--page); position: relative; z-index: 1; }
  .secondary-page { break-before: page; page-break-before: always; margin-top: 8px; }

  @media screen and (max-width: 720px) {
    .columns { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 0 4px 6px; }
    .header { padding-top: 102px; }
    .document-tools { right: 10px; left: 10px; justify-content: center; }
    .group-block { margin-bottom: 3px; }
    .group-header { padding: 4px 5px; font-size: 9px; }
    td { padding: 3px 4px; font-size: 8px; }
    td.name { width: 55%; }
    td.unit { width: 15%; font-size: 7px; }
    td.price { width: 30%; font-size: 8px; }
  }

  /* ── مجموعة مواد ────────────────────────── */
  .group-block {
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    margin-bottom: 5px;
    border: 1px solid var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .group-header {
    background: var(--surface-strong);
    border-bottom: 1px solid var(--line);
    padding: 5px 9px;
    font-size: 11px;
    font-weight: 900;
    color: #f2c55c;
    display: flex;
    justify-content: space-between;
    align-items: center;
    letter-spacing: .3px;
  }
  .group-count {
    font-size: 8.5px;
    background: rgba(255,255,255,.12);
    color: #f4d184;
    border-radius: 8px;
    padding: 1px 6px;
    font-weight: 700;
  }

  /* ── جدول ───────────────────────────────── */
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: 10px; }
  td.name  { font-weight: 700; color: var(--text); width: 54%; }
  td.unit  { color: var(--muted); text-align: center; width: 16%; font-size: 9px; }
  td.price { font-weight: 900; text-align: left; direction: ltr; font-size: 10.5px; color: var(--gold-strong); width: 30%; }
  tr.odd   { background: var(--surface); }
  tr.even  { background: var(--surface-alt); }
  tr:last-child td { border-bottom: none; }

  /* ── أرقام الهاتف في الشريط الفرعي ─────── */
  .phones { display: flex; flex-direction: column; align-items: flex-end; gap: 0px; }
  .phones span { font-size: 11px; color: var(--muted); font-weight: 800; direction: ltr; line-height: 1.35; }
  .phones .location { color: var(--gold-strong); direction: rtl; }

  /* ── زر طباعة ───────────────────────────── */
  .document-tools {
    position: fixed; top: 12px; left: 12px; z-index: 999;
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .document-tools button,
  .document-tools a {
    background: var(--gold); color: var(--button-text); border: 1px solid var(--gold);
    padding: 8px 12px; border-radius: 6px; font-size: 11px;
    font-weight: 900; cursor: pointer;
    font-family: 'Almarai', Tahoma, sans-serif;
    text-decoration: none;
  }
  .document-tools .theme-switch {
    background: var(--surface); color: var(--text); border-color: var(--line);
  }
`;

// ── مجموعة HTML ───────────────────────────────────────────────────────────────
const renderGroup = ([name, its], priceFormatter, unitFormatter = (item) => item.unit) => `
<div class="group-block">
  <div class="group-header">
    <span>${name}</span>
    <span class="group-count">${its.length}</span>
  </div>
  <table><tbody>${its.map((item, i) => `
    <tr class="${i%2===0?"odd":"even"}">
      <td class="name">${item.name}</td>
      <td class="unit">${unitFormatter(item)}</td>
      <td class="price">${priceFormatter(item)}</td>
    </tr>`).join("")}
  </tbody></table>
</div>`;

// ── بناء HTML ─────────────────────────────────────────────────────────────────
const buildHtml = ({ pageItems, titleSuffix, badgeClass, badgeLabel, unitLabel, pdfFile, priceFormatter, unitFormatter = (item) => item.unit }) => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>نشرة الأسعار ${titleSuffix} — ${isoDate}</title>
<style>${CSS}</style>
</head>
<body>

<div class="document-tools no-print">
  <button type="button" onclick="window.print()">طباعة مباشرة</button>
  <a data-pdf-open href="${pdfFile}">فتح PDF</a>
  <a data-pdf-download href="${pdfFile}" download>تنزيل PDF</a>
  <button class="theme-switch" type="button" onclick="toggleTheme()">فاتح / داكن</button>
</div>

<div class="header">
  <img src="${logoSrc}" alt="OZK TOBACCO" class="header-logo">
  <div class="header-center">
    <div class="header-title">نشرة الأسعار</div>
    <div class="header-date">${issueDate}</div>
    <span class="currency-badge ${badgeClass}">${badgeLabel}</span>
  </div>
  <div class="header-right" aria-hidden="true"></div>
</div>

<div class="subheader">
  <span>السعر المعروض: <strong>${unitLabel}</strong></span>
  <div class="phones">
    <span>0985000771</span>
    <span>0984000662</span>
    <span>مركز: 0994092038</span>
    <span class="location">دوما – ساحة الغنم</span>
  </div>
</div>

<div class="columns">
  ${(() => {
    const { right, left } = buildColumnLayout(pageItems);
    const renderStack = (stack) => stack.map(g => renderGroup(g, priceFormatter, unitFormatter)).join("\n");
    return `<div class="column-stack">${renderStack(right)}</div>\n<div class="column-stack">${renderStack(left)}</div>`;
  })()}
</div>

${(() => {
    const { specialRight, specialLeft } = buildColumnLayout(pageItems);
    if (specialRight.length === 0 && specialLeft.length === 0) return "";
    const renderStack = (stack) => stack.map(g => renderGroup(g, priceFormatter, unitFormatter)).join("\n");
    return `<div class="columns secondary-page">\n<div class="column-stack">${renderStack(specialRight)}</div>\n<div class="column-stack">${renderStack(specialLeft)}</div>\n</div>`;
  })()}

<script>
  const savedTheme = localStorage.getItem('ozk-price-theme');
  document.body.dataset.theme = savedTheme || 'dark';
  function selectedPdfFile() {
    return document.body.dataset.theme === 'light' ? '${pdfFile.replace(".pdf", "-light.pdf")}' : '${pdfFile}';
  }
  function syncPdfLinks() {
    const pdfFile = selectedPdfFile();
    document.querySelector('[data-pdf-open]').href = pdfFile;
    document.querySelector('[data-pdf-download]').href = pdfFile;
  }
  function toggleTheme() {
    const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = next;
    localStorage.setItem('ozk-price-theme', next);
    syncPdfLinks();
  }
  syncPdfLinks();
</script>

</body>
</html>`;

const newSyriaFlag = '<span class="new-syria-flag" role="img" aria-label="علم سوريا الجديد"><span class="green"></span><span class="white">★★★</span><span class="black"></span></span>';

// ── نشرة الدولار (جملة — سعر الكرتونة) ───────────────────────────────────────
writeFileSync(
  resolve(root, "public/downloads/price-list-usd.html"),
  buildHtml({
    pageItems: usdItems,
    titleSuffix: "دولار",
    badgeClass: "badge-usd",
    badgeLabel: "💵 دولار أمريكي — جملة",
    unitLabel: "سعر الكرتونة (جملة)",
    pdfFile: "price-list-usd.pdf",
    priceFormatter: (item) => `${item.usd.toFixed(2)} $`,
  })
);
console.log("✓ price-list-usd.html");

// ── نشرة الليرة (مفرق — سعر المفرق اليدوي للكرتونة ÷ عدد الكروز × الصرف) ─────
writeFileSync(
  resolve(root, `public/downloads/price-list-syp-${SYP_FILE_TAG}.html`),
  buildHtml({
    pageItems: sypItems,
    titleSuffix: "سوري",
    badgeClass: "badge-syp",
    badgeLabel: `${newSyriaFlag} ليرة — مفرق — صرف ${SYP_RATE.toLocaleString()}`,
    unitLabel: "سعر المفرق للوحدة",
    pdfFile: `price-list-syp-${SYP_FILE_TAG}.pdf`,
    priceFormatter: (item) => {
      const cartonUsd = item.retailCarton > 0 ? item.retailCarton : item.usd;
      const p = Math.round((cartonUsd * SYP_RATE) / (item.unitFactor ?? 10));
      return `${p.toLocaleString("ar-SY")} ل.س`;
    },
    unitFormatter: (item) => item.unit1 || (item.unit === 'كرتونة' ? 'علبة' : item.unit),
  })
);
console.log(`✓ price-list-syp-${SYP_FILE_TAG}.html — صرف ${SYP_RATE}`);

// ── نشرات الوزاري المنفصلة ───────────────────────────────────────────────────
writeFileSync(
  resolve(root, "public/downloads/price-list-wazari-usd.html"),
  buildHtml({
    pageItems: usdWazariItems,
    titleSuffix: "الوزاري — دولار",
    badgeClass: "badge-usd",
    badgeLabel: "💵 نشرة الوزاري — جملة",
    unitLabel: "سعر الكرتونة (جملة)",
    pdfFile: "price-list-wazari-usd.pdf",
    priceFormatter: (item) => `${item.usd.toFixed(2)} $`,
  })
);
console.log("✓ price-list-wazari-usd.html");

writeFileSync(
  resolve(root, `public/downloads/price-list-wazari-syp-${SYP_FILE_TAG}.html`),
  buildHtml({
    pageItems: sypWazariItems,
    titleSuffix: "الوزاري — سوري",
    badgeClass: "badge-syp",
    badgeLabel: `${newSyriaFlag} نشرة الوزاري — مفرق`,
    unitLabel: "سعر المفرق للوحدة",
    pdfFile: `price-list-wazari-syp-${SYP_FILE_TAG}.pdf`,
    priceFormatter: (item) => `${Math.round((item.retailCarton * SYP_RATE) / item.unitFactor).toLocaleString("ar-SY")} ل.س`,
    unitFormatter: (item) => item.unit1 || (item.unit === "كرتونة" ? "علبة" : item.unit),
  })
);
console.log(`✓ price-list-wazari-syp-${SYP_FILE_TAG}.html — صرف ${SYP_RATE}`);

// ── index ─────────────────────────────────────────────────────────────────────
const indexHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>نشرات الأسعار — OZK TOBACCO</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Almarai',Tahoma,sans-serif; background:#0c0a07; color:#e8d9b0;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:40px 20px; }
  .logo-img { height:80px; margin-bottom:6px; }
  .sub  { color:#a08850; font-size:.88rem; margin-bottom:2px; font-weight:600; }
  .date { color:#6b5535; font-size:.78rem; margin-bottom:44px; direction:ltr; }
  h1 { font-size:1.2rem; color:#d7a83f; margin-bottom:24px; font-weight:700; }
  .cards { display:flex; gap:20px; flex-wrap:wrap; justify-content:center; max-width:640px; }
  .card { background:#1a1208; border:1px solid #3a2810; border-radius:12px;
          padding:26px 20px; flex:1; min-width:240px; max-width:280px;
          text-align:center; text-decoration:none; color:inherit;
          transition:border-color .2s,transform .15s; display:block; }
  .card:hover { border-color:#d7a83f; transform:translateY(-3px); }
  .card-icon  { font-size:2.4rem; margin-bottom:10px; }
  .card-title { font-size:1.05rem; font-weight:900; color:#d7a83f; margin-bottom:4px; }
  .card-unit  { font-size:.8rem; color:#a08030; margin-bottom:5px; font-weight:700; }
  .card-desc  { font-size:.8rem; color:#8a7050; line-height:1.6; }
  .card-btn   { display:inline-block; margin-top:14px; background:#d7a83f; color:#0c0a07;
                font-weight:900; padding:8px 20px; border-radius:6px; font-size:.84rem; }
  .footer { margin-top:50px; color:#3a2810; font-size:.75rem; text-align:center; line-height:1.9; }
</style>
</head>
<body>
<img src="../icons/ozk-logo.png" alt="OZK TOBACCO" class="logo-img">
<div class="sub">نشرات الأسعار الرسمية</div>
<div class="date">${issueDate}</div>
<h1>اختر نشرة الأسعار</h1>
<div class="cards">
  <a class="card" href="price-list-wazari-syp-${SYP_FILE_TAG}.html" target="_blank">
    <div class="card-icon">🏛️</div>
    <div class="card-title">نشرة الوزاري — سوري</div>
    <div class="card-unit">الأصناف الوزارية والمحزّرة</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
  <a class="card" href="price-list-wazari-usd.html" target="_blank">
    <div class="card-icon">🏛️</div>
    <div class="card-title">نشرة الوزاري — دولار</div>
    <div class="card-unit">جملة بالكرتونة الكاملة</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
  <a class="card" href="price-list-syp-${SYP_FILE_TAG}.html" target="_blank">
    <div class="card-icon">🇸🇾</div>
    <div class="card-title">نشرة السوري — مفرق</div>
    <div class="card-unit">سعر المفرق للوحدة الواحدة</div>
    <div class="card-desc">بالليرة السورية<br>صرف ${SYP_RATE.toLocaleString()} ل.س/دولار</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
  <a class="card" href="price-list-usd.html" target="_blank">
    <div class="card-icon">💵</div>
    <div class="card-title">نشرة الدولار — جملة</div>
    <div class="card-unit">سعر الكرتونة الكاملة</div>
    <div class="card-desc">بالدولار الأمريكي</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
</div>
<div class="footer">0985000771 &nbsp;|&nbsp; 0984000662 &nbsp;|&nbsp; مركز: 0994092038</div>
</body>
</html>`;
writeFileSync(resolve(root, "public/downloads/index.html"), indexHtml);
console.log("✓ index.html");
console.log(`\nاكتمل — عام جملة: ${usdItems.length} | عام مفرق: ${sypItems.length} | وزاري جملة: ${usdWazariItems.length} | وزاري مفرق: ${sypWazariItems.length}`);
