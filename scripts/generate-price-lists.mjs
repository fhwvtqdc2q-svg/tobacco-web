/**
 * توليد نشرات الأسعار HTML
 * node scripts/generate-price-lists.mjs [--rate 14050] [--validity 30]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, "..");

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : null; };
const SYP_RATE = Number(get("--rate")     ?? 14050);
const VALIDITY = Number(get("--validity") ?? 30);

// ── تاريخ بالإنجليزية ─────────────────────────────────────────────────────────
const today = new Date();
const issueDate = today.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
const isoDate   = today.toISOString().slice(0, 10);

// ── بيانات ───────────────────────────────────────────────────────────────────
const items = JSON.parse(readFileSync(resolve(root, "scripts/price-data.json"), "utf8"));

// ── شعار base64 ───────────────────────────────────────────────────────────────
const logoB64 = readFileSync(resolve(root, "public/icons/ozk-logo.png")).toString("base64");
const logoSrc = `data:image/png;base64,${logoB64}`;

// ── ترتيب المجموعات ───────────────────────────────────────────────────────────
const FIRST = ["ماستر", "غلواز"];
const LAST  = ["أردن", "برو", "كينت", "بزنس", "MT", "سلفان", "قداحات", "ورق", "كورسير"];

const groupMap = new Map();
for (const item of items) {
  const g = item.group ?? item.name.split(" ")[0];
  if (!groupMap.has(g)) groupMap.set(g, []);
  groupMap.get(g).push(item);
}

const allGroups = [...groupMap.entries()];
const first  = FIRST.map(n => allGroups.find(([g]) => g === n)).filter(Boolean);
const last   = LAST .map(n => allGroups.find(([g]) => g === n)).filter(Boolean);
const middle = allGroups.filter(([g]) => !FIRST.includes(g) && !LAST.includes(g));
const groups = [...first, ...middle, ...last];

// ── توزيع على عمودين ──────────────────────────────────────────────────────────
function splitColumns(groups) {
  const sizes = groups.map(([, its]) => 1 + its.length);
  const half  = sizes.reduce((a, b) => a + b, 0) / 2;
  let colA = [], colB = [], sumA = 0, done = false;
  for (let i = 0; i < groups.length; i++) {
    if (!done && sumA + sizes[i] / 2 >= half) done = true;
    if (!done) { colA.push(groups[i]); sumA += sizes[i]; }
    else        { colB.push(groups[i]); }
  }
  return [colA, colB];
}
const [colA, colB] = splitColumns(groups);

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');

  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Cairo', Tahoma, 'Segoe UI', Arial, sans-serif;
    background: #fff; color: #111; direction: rtl;
  }

  @page { size: A4 portrait; margin: 8mm 7mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .header        { background: #0d0b08 !important; }
    .group-header  { background: #2a2010 !important; }
    .subheader     { background: #f5f0e8 !important; }
    tr.odd  { background: #faf7f2 !important; }
  }

  /* ── رأس الصفحة ─────────────────────────── */
  .header {
    background: #0d0b08;
    padding: 10px 16px 8px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .header-logo {
    height: 52px;
    width: auto;
    object-fit: contain;
  }
  .header-info {
    text-align: center;
    flex: 1;
  }
  .header-title {
    font-size: 19px;
    font-weight: 900;
    color: #d7a83f;
    letter-spacing: .5px;
    line-height: 1.2;
  }
  .header-date {
    font-size: 11px;
    color: #a08850;
    margin-top: 3px;
    font-weight: 600;
    direction: ltr;
    text-align: center;
  }
  .currency-badge {
    display: inline-block;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    margin-top: 5px;
  }
  .badge-usd { background: #d7a83f; color: #0d0b08; }
  .badge-syp { background: #2d6a2d; color: #fff; }
  .header-right {
    text-align: left;
    min-width: 80px;
  }
  .item-count {
    font-size: 10px;
    color: #6b5535;
    font-weight: 700;
  }
  .item-count span {
    display: block;
    font-size: 20px;
    color: #d7a83f;
    font-weight: 900;
    line-height: 1.1;
  }

  /* ── شريط فرعي ──────────────────────────── */
  .subheader {
    background: #f5f0e8;
    border-bottom: 2px solid #d7a83f;
    padding: 4px 14px;
    font-size: 9.5px;
    color: #5a4010;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 7px;
    font-weight: 600;
  }

  /* ── شبكة العمودين ──────────────────────── */
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    padding: 0 5px;
  }
  .col { min-width: 0; }

  /* ── مجموعة مواد ────────────────────────── */
  .group-block {
    margin-bottom: 5px;
    break-inside: avoid;
    border-radius: 5px;
    overflow: hidden;
    border: 1px solid #ddd6c4;
  }
  .group-header {
    background: #2a2010;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 900;
    color: #d7a83f;
    display: flex;
    justify-content: space-between;
    align-items: center;
    letter-spacing: .3px;
  }
  .group-count {
    font-size: 9px;
    color: #a08030;
    background: rgba(255,255,255,.1);
    border-radius: 8px;
    padding: 1px 6px;
    font-weight: 700;
  }

  /* ── جدول المواد ────────────────────────── */
  table { width: 100%; border-collapse: collapse; }
  td {
    padding: 4px 8px;
    border-bottom: 1px solid #ede8dc;
    font-size: 10.5px;
    font-family: 'Cairo', Tahoma, sans-serif;
  }
  td.name  { font-weight: 700; color: #1a1208; width: 54%; }
  td.unit  { color: #7a5a30; text-align: center; width: 16%; font-size: 9.5px; }
  td.price {
    font-weight: 900; text-align: left; direction: ltr;
    font-size: 11px; width: 30%; color: #1a1208;
  }
  tr.odd  { background: #faf7f2; }
  tr.even { background: #ffffff; }
  tr:last-child td { border-bottom: none; }

  /* ── زر الطباعة ─────────────────────────── */
  .print-btn {
    position: fixed; top: 14px; left: 14px; z-index: 999;
    background: #d7a83f; color: #0d0b08; border: none;
    padding: 9px 20px; border-radius: 8px; font-size: 13px;
    font-weight: 700; cursor: pointer;
    box-shadow: 0 3px 12px rgba(0,0,0,.25);
    font-family: 'Cairo', Tahoma, sans-serif;
  }
  .print-btn:hover { background: #c49535; }
`;

// ── مجموعة HTML ───────────────────────────────────────────────────────────────
function renderGroup([name, its], priceFormatter) {
  const rows = its.map((item, i) => `
    <tr class="${i % 2 === 0 ? "odd" : "even"}">
      <td class="name">${item.name}</td>
      <td class="unit">${item.unit}</td>
      <td class="price">${priceFormatter(item)}</td>
    </tr>`).join("");
  return `
  <div class="group-block">
    <div class="group-header">
      <span>${name}</span>
      <span class="group-count">${its.length}</span>
    </div>
    <table><tbody>${rows}</tbody></table>
  </div>`;
}

// ── بناء HTML ─────────────────────────────────────────────────────────────────
function buildHtml({ titleSuffix, badgeClass, badgeLabel, unitLabel, priceFormatter }) {
  const [colAHtml, colBHtml] = [colA, colB].map(col =>
    col.map(g => renderGroup(g, priceFormatter)).join("")
  );
  const totalItems = items.length;
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>نشرة الأسعار ${titleSuffix} — ${isoDate}</title>
<style>${CSS}</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">🖨️ طباعة / PDF</button>

<div class="header">
  <img src="${logoSrc}" alt="OZK TOBACCO" class="header-logo">
  <div class="header-info">
    <div class="header-title">نشرة الأسعار</div>
    <div class="header-date">${issueDate}</div>
    <div><span class="currency-badge ${badgeClass}">${badgeLabel}</span></div>
  </div>
  <div class="header-right">
    <div class="item-count">
      <span>${totalItems}</span>
      مادة
    </div>
  </div>
</div>

<div class="subheader">
  <span>السعر المعروض: <strong>${unitLabel}</strong></span>
  <span>ozk.kh@outlook.com</span>
</div>

<div class="columns">
  <div class="col">${colAHtml}</div>
  <div class="col">${colBHtml}</div>
</div>

</body>
</html>`;
}

// ── نشرة الدولار ──────────────────────────────────────────────────────────────
writeFileSync(
  resolve(root, "public/downloads/price-list-usd.html"),
  buildHtml({
    titleSuffix: "دولار",
    badgeClass:  "badge-usd",
    badgeLabel:  "💵 دولار أمريكي",
    unitLabel:   "سعر الكرتونة",
    priceFormatter: (item) => `${item.usd.toFixed(2)} $`,
  })
);
console.log("✓ price-list-usd.html");

// ── نشرة الليرة ───────────────────────────────────────────────────────────────
writeFileSync(
  resolve(root, `public/downloads/price-list-syp-${SYP_RATE}.html`),
  buildHtml({
    titleSuffix: "سوري",
    badgeClass:  "badge-syp",
    badgeLabel:  `🇸🇾 ليرة — صرف ${SYP_RATE.toLocaleString()}`,
    unitLabel:   "سعر الوحدة",
    priceFormatter: (item) => {
      const p = Math.round((item.usd * SYP_RATE) / (item.unitFactor ?? 10));
      return `${p.toLocaleString("ar-SY")} ل.س`;
    },
  })
);
console.log(`✓ price-list-syp-${SYP_RATE}.html`);

// ── index.html ────────────────────────────────────────────────────────────────
const indexHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>نشرات الأسعار — OZK TOBACCO</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Cairo',Tahoma,sans-serif; background:#0d0b08; color:#e8d9b0;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:40px 20px; }
  .logo-img { height:80px; margin-bottom:8px; }
  .sub    { color:#a08850; font-size:.88rem; margin-bottom:4px; font-weight:600; }
  .date   { color:#6b5535; font-size:.8rem; margin-bottom:44px; direction:ltr; }
  h1 { font-size:1.25rem; color:#e8d9b0; margin-bottom:26px; text-align:center; font-weight:700; }
  .cards  { display:flex; gap:22px; flex-wrap:wrap; justify-content:center; width:100%; max-width:660px; }
  .card   { background:#1a160f; border:1px solid #5a4524; border-radius:12px;
            padding:26px 20px; flex:1; min-width:250px; max-width:290px;
            text-align:center; text-decoration:none; color:inherit;
            transition:border-color .2s,transform .15s; display:block; }
  .card:hover { border-color:#d7a83f; transform:translateY(-3px); }
  .card-icon  { font-size:2.5rem; margin-bottom:12px; }
  .card-title { font-size:1.1rem; font-weight:900; color:#d7a83f; margin-bottom:4px; }
  .card-unit  { font-size:.82rem; color:#c8a663; margin-bottom:5px; font-weight:700; }
  .card-desc  { font-size:.82rem; color:#a08850; line-height:1.6; }
  .card-btn   { display:inline-block; margin-top:16px; background:#d7a83f; color:#0d0b08;
                font-weight:700; padding:8px 20px; border-radius:6px; font-size:.85rem; }
  .footer { margin-top:50px; color:#5a4524; font-size:.76rem; text-align:center; line-height:1.9; }
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
<div class="footer">
  اضغط "عرض وطباعة" ← ثم Ctrl+P لحفظها PDF<br>
  ozk.kh@outlook.com
</div>
</body>
</html>`;
writeFileSync(resolve(root, "public/downloads/index.html"), indexHtml);
console.log("✓ index.html");
console.log(`\nاكتمل — ${items.length} مادة | ${groups.length} مجموعة`);
