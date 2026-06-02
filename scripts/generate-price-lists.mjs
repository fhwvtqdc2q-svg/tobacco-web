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
const SYP_RATE = Number(get("--rate")     ?? 14050);
const VALIDITY = Number(get("--validity") ?? 30);

// ── تاريخ ─────────────────────────────────────────────────────────────────────
const today     = new Date();
const issueDate = today.toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" });
const isoDate   = today.toISOString().slice(0, 10);

// ── بيانات ────────────────────────────────────────────────────────────────────
const items = JSON.parse(readFileSync(resolve(root, "scripts/price-data.json"), "utf8"));

// ── شعار ─────────────────────────────────────────────────────────────────────
const logoB64 = readFileSync(resolve(root, "public/icons/ozk-logo.png")).toString("base64");
const logoSrc = `data:image/png;base64,${logoB64}`;

// ── ترتيب المجموعات ───────────────────────────────────────────────────────────
const FIRST = ["ماستر", "غلواز"];
const LAST  = ["أردن","برو","كينت","بزنس","MT","سلفان","قداحات","ورق","كورسير"];

const groupMap = new Map();
for (const item of items) {
  const g = item.group ?? item.name.split(" ")[0];
  if (!groupMap.has(g)) groupMap.set(g, []);
  groupMap.get(g).push(item);
}
const all    = [...groupMap.entries()];
const first  = FIRST.map(n => all.find(([g]) => g===n)).filter(Boolean);
const last   = LAST .map(n => all.find(([g]) => g===n)).filter(Boolean);
const middle = all.filter(([g]) => !FIRST.includes(g) && !LAST.includes(g));
const groups = [...first, ...middle, ...last];

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');

  * { margin:0; padding:0; box-sizing:border-box; }

  body {
    font-family: 'Cairo', Tahoma, Arial, sans-serif;
    background: #0c0a07;
    color: #e8d9b0;
    direction: rtl;
  }

  @page { size: A4 portrait; margin: 0; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .header     { background: #0c0a07 !important; }
    .subheader  { background: #191208 !important; border-bottom-color: #5a3e12 !important; }
    .group-header { background: #1a1208 !important; }
    tr.odd  { background: #141009 !important; }
    tr.even { background: #0f0c07 !important; }
  }

  /* ── رأس ─────────────────────────────────── */
  .header {
    background: #0c0a07;
    padding: 10px 14px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 2px solid #5a3e12;
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
    color: #d7a83f;
    letter-spacing: 1px;
  }
  .header-date {
    font-size: 10.5px;
    color: #9a7840;
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
  .badge-usd { background: #d7a83f; color: #0c0a07; }
  .badge-syp { background: #2d6a2d; color: #c8f0c8; }
  .header-right {
    min-width: 62px;
    text-align: left;
  }
  .item-count-num  { font-size: 22px; font-weight: 900; color: #d7a83f; line-height: 1; }
  .item-count-lbl  { font-size: 9px;  color: #6b5535; font-weight: 600; }

  /* ── شريط فرعي ──────────────────────────── */
  .subheader {
    background: #191208;
    border-bottom: 1px solid #3a2808;
    padding: 4px 14px;
    font-size: 9px;
    color: #8a6a35;
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    letter-spacing: .2px;
    margin-bottom: 6px;
  }
  .subheader strong { color: #d7a83f; }

  /* ── عمودان CSS columns ──────────────────── */
  .columns {
    column-count: 2;
    column-gap: 8px;
    column-fill: auto;
    padding: 0 8px 8px;
  }

  /* ── مجموعة مواد ────────────────────────── */
  .group-block {
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    margin-bottom: 5px;
    border: 1px solid #2a2010;
    border-radius: 5px;
    overflow: hidden;
  }
  .group-header {
    background: #1a1208;
    border-bottom: 1px solid #3a2810;
    padding: 5px 9px;
    font-size: 11px;
    font-weight: 900;
    color: #d7a83f;
    display: flex;
    justify-content: space-between;
    align-items: center;
    letter-spacing: .3px;
  }
  .group-count {
    font-size: 8.5px;
    background: rgba(215,168,63,.15);
    color: #c8983a;
    border-radius: 8px;
    padding: 1px 6px;
    font-weight: 700;
  }

  /* ── جدول ───────────────────────────────── */
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3.5px 7px; border-bottom: 1px solid #201808; font-size: 10px; }
  td.name  { font-weight: 700; color: #e0cfa0; width: 54%; }
  td.unit  { color: #7a6040; text-align: center; width: 16%; font-size: 9px; }
  td.price { font-weight: 900; text-align: left; direction: ltr; font-size: 10.5px; color: #d7a83f; width: 30%; }
  tr.odd   { background: #141009; }
  tr.even  { background: #0f0c07; }
  tr:last-child td { border-bottom: none; }

  /* ── زر طباعة ───────────────────────────── */
  .print-btn {
    position: fixed; top: 12px; left: 12px; z-index: 999;
    background: #d7a83f; color: #0c0a07; border: none;
    padding: 8px 18px; border-radius: 8px; font-size: 12px;
    font-weight: 900; cursor: pointer;
    font-family: 'Cairo', Tahoma, sans-serif;
    box-shadow: 0 3px 12px rgba(0,0,0,.5);
  }
`;

// ── مجموعة HTML ───────────────────────────────────────────────────────────────
const renderGroup = ([name, its], priceFormatter) => `
<div class="group-block">
  <div class="group-header">
    <span>${name}</span>
    <span class="group-count">${its.length}</span>
  </div>
  <table><tbody>
    ${its.map((item, i) => `
    <tr class="${i%2===0?"odd":"even"}">
      <td class="name">${item.name}</td>
      <td class="unit">${item.unit}</td>
      <td class="price">${priceFormatter(item)}</td>
    </tr>`).join("")}
  </tbody></table>
</div>`;

// ── بناء HTML ─────────────────────────────────────────────────────────────────
const buildHtml = ({ titleSuffix, badgeClass, badgeLabel, unitLabel, priceFormatter }) => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>نشرة الأسعار ${titleSuffix} — ${isoDate}</title>
<style>${CSS}</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">🖨️ طباعة / PDF</button>

<div class="header">
  <img src="${logoSrc}" alt="OZK TOBACCO" class="header-logo">
  <div class="header-center">
    <div class="header-title">نشرة الأسعار</div>
    <div class="header-date">${issueDate}</div>
    <span class="currency-badge ${badgeClass}">${badgeLabel}</span>
  </div>
  <div class="header-right">
    <div class="item-count-num">${items.length}</div>
    <div class="item-count-lbl">مادة</div>
  </div>
</div>

<div class="subheader">
  <span>السعر المعروض: <strong>${unitLabel}</strong></span>
  <span>ozk.kh@outlook.com</span>
</div>

<div class="columns">
  ${groups.map(g => renderGroup(g, priceFormatter)).join("\n")}
</div>

</body>
</html>`;

// ── نشرة الدولار ──────────────────────────────────────────────────────────────
writeFileSync(
  resolve(root, "public/downloads/price-list-usd.html"),
  buildHtml({
    titleSuffix: "دولار",
    badgeClass: "badge-usd",
    badgeLabel: "💵 دولار أمريكي",
    unitLabel: "سعر الكرتونة",
    priceFormatter: (item) => `${item.usd.toFixed(2)} $`,
  })
);
console.log("✓ price-list-usd.html");

// ── نشرة الليرة ───────────────────────────────────────────────────────────────
writeFileSync(
  resolve(root, `public/downloads/price-list-syp-${SYP_RATE}.html`),
  buildHtml({
    titleSuffix: "سوري",
    badgeClass: "badge-syp",
    badgeLabel: `🇸🇾 ليرة — صرف ${SYP_RATE.toLocaleString()}`,
    unitLabel: "سعر الوحدة",
    priceFormatter: (item) => {
      const p = Math.round((item.usd * SYP_RATE) / (item.unitFactor ?? 10));
      return `${p.toLocaleString("ar-SY")} ل.س`;
    },
  })
);
console.log(`✓ price-list-syp-${SYP_RATE}.html`);

// ── index ─────────────────────────────────────────────────────────────────────
const indexHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>نشرات الأسعار — OZK TOBACCO</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Cairo',Tahoma,sans-serif; background:#0c0a07; color:#e8d9b0;
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
  <a class="card" href="price-list-syp-${SYP_RATE}.html" target="_blank">
    <div class="card-icon">🇸🇾</div>
    <div class="card-title">نشرة السوري</div>
    <div class="card-unit">سعر الوحدة الواحدة</div>
    <div class="card-desc">بالليرة السورية<br>صرف ${SYP_RATE.toLocaleString()} ل.س/دولار</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
  <a class="card" href="price-list-usd.html" target="_blank">
    <div class="card-icon">💵</div>
    <div class="card-title">نشرة الدولار</div>
    <div class="card-unit">سعر الكرتونة الكاملة</div>
    <div class="card-desc">بالدولار الأمريكي</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
</div>
<div class="footer">ozk.kh@outlook.com</div>
</body>
</html>`;
writeFileSync(resolve(root, "public/downloads/index.html"), indexHtml);
console.log("✓ index.html");
console.log(`\nاكتمل — ${items.length} مادة | ${groups.length} مجموعة`);
