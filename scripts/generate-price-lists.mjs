/**
 * توليد نشرات الأسعار HTML
 *
 * الاستخدام:
 *   node scripts/generate-price-lists.mjs [--rate 14050] [--validity 30]
 *
 * المخرجات:
 *   public/downloads/price-list-usd.html        ← سعر الكرتونة بالدولار
 *   public/downloads/price-list-syp-<rate>.html ← سعر الوحدة بالليرة
 *   public/downloads/index.html
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const idx = (flag) => args.indexOf(flag);
const SYP_RATE    = idx("--rate")     !== -1 ? Number(args[idx("--rate")     + 1]) : 14050;
const VALIDITY    = idx("--validity") !== -1 ? Number(args[idx("--validity") + 1]) : 30;

// ── تواريخ ───────────────────────────────────────────────────────────────────
const today = new Date();
const isoDate   = today.toISOString().slice(0, 10);
const fmtLong   = (d) => d.toLocaleDateString("ar-SY", { year: "numeric", month: "long", day: "numeric" });
const issueDate = fmtLong(today);
const expiryDate = fmtLong(new Date(today.getTime() + VALIDITY * 864e5));

// ── بيانات الأسعار ───────────────────────────────────────────────────────────
const items = JSON.parse(readFileSync(resolve(root, "scripts/price-data.json"), "utf8"));

// ── تجميع المواد حسب group ───────────────────────────────────────────────────
const groupMap = new Map();
for (const item of items) {
  const g = item.group ?? item.name.split(" ")[0];
  if (!groupMap.has(g)) groupMap.set(g, []);
  groupMap.get(g).push(item);
}
const groups = [...groupMap.entries()]; // [[name, items[]], ...]

// ── توزيع المجموعات على عمودين (حسب عدد الصفوف) ────────────────────────────
function splitColumns(groups) {
  // row count per group = header (1) + items
  const sizes = groups.map(([, its]) => 1 + its.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  const half  = total / 2;

  let colA = [], colB = [];
  let sumA = 0;
  let switched = false;
  for (let i = 0; i < groups.length; i++) {
    if (!switched && sumA + sizes[i] / 2 >= half) switched = true;
    if (!switched) { colA.push(groups[i]); sumA += sizes[i]; }
    else            { colB.push(groups[i]); }
  }
  return [colA, colB];
}

const [colA, colB] = splitColumns(groups);

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Tahoma, 'Segoe UI', Arial, sans-serif; background:#fff; color:#111; direction:rtl; }

  @page  { size: A4 portrait; margin: 10mm 8mm; }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .no-print { display:none !important; }
    .col { break-inside: avoid-column; }
    .group-block { break-inside: avoid; }
    .header, .footer { background:#f0ead8 !important; }
    .group-header { background:#e8d4b0 !important; }
    tr.odd  { background:#f9f7f3 !important; }
  }

  /* ── رأس الصفحة ─────────────────────────── */
  .header {
    background: #f0ead8; border: 2px solid #d7a83f; border-radius: 8px;
    padding: 12px 18px; margin: 10px 10px 8px;
    display: flex; justify-content: space-between; align-items: center; gap: 10px;
  }
  .brand-name  { font-size: 22px; font-weight: 900; color: #221808; letter-spacing: 1px; }
  .bulletin-title { font-size: 16px; font-weight: 700; color: #6b5535; margin-top: 2px; }
  .currency-badge {
    display: inline-block; padding: 3px 10px; border-radius: 12px;
    font-size: 12px; font-weight: 700; margin-top: 4px;
  }
  .badge-usd { background: #d7a83f; color: #1a1208; }
  .badge-syp { background: #3a7a3a; color: #fff; }

  .meta-sep { width: 1px; background: #c8a673; align-self: stretch; opacity: .5; }
  .meta-block { text-align: center; min-width: 90px; }
  .meta-label { font-size: 9px; font-weight: 700; color: #6b5535; letter-spacing: .4px; }
  .meta-value { font-size: 13px; font-weight: 900; color: #221808; margin: 2px 0; }
  .meta-sub   { font-size: 9.5px; color: #8a6a35; }

  /* ── شبكة العمودين ──────────────────────── */
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0 10px;
  }
  .col { min-width: 0; }

  /* ── مجموعة مواد ────────────────────────── */
  .group-block { margin-bottom: 6px; break-inside: avoid; }
  .group-header {
    background: #e8d4b0; padding: 5px 8px;
    font-size: 11px; font-weight: 900; color: #3a2a0a;
    border: 1px solid #c8a673; border-radius: 4px 4px 0 0;
    display: flex; justify-content: space-between; align-items: center;
  }
  .group-count { font-size: 9px; color: #7a5a25; background: #fff; border-radius: 8px; padding: 1px 6px; }

  /* ── جدول المواد ────────────────────────── */
  table { width: 100%; border-collapse: collapse; border: 1px solid #d8c899; border-top: none; border-radius: 0 0 4px 4px; overflow: hidden; }
  td { padding: 4px 6px; border-bottom: 1px solid #e8e0d0; font-size: 10.5px; }
  td.name  { font-weight: 700; color: #111; width: 55%; }
  td.unit  { color: #5a4010; text-align: center; width: 18%; font-size: 9.5px; }
  td.price { font-weight: 900; text-align: left; direction: ltr; font-size: 11px; width: 27%; }
  tr.odd  { background: #f9f7f3; }
  tr.even { background: #fff; }
  tr:last-child td { border-bottom: none; }

  /* ── ذيل الصفحة ─────────────────────────── */
  .footer {
    margin: 6px 10px 10px; padding: 8px 14px;
    background: #f0ead8; border: 1px solid #c8a673; border-radius: 6px;
    font-size: 9.5px; color: #3a2a0a;
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;
  }

  /* ── زر الطباعة ─────────────────────────── */
  .print-btn {
    position: fixed; top: 14px; left: 14px; z-index: 999;
    background: #d7a83f; color: #1a1208; border: none;
    padding: 9px 18px; border-radius: 8px; font-size: 13px;
    font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
  .print-btn:hover { background: #c49535; }
`;

// ── بناء مجموعة HTML ──────────────────────────────────────────────────────────
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

// ── بناء HTML كامل ────────────────────────────────────────────────────────────
function buildHtml({ titleSuffix, badgeClass, badgeLabel, priceFormatter, unitLabel }) {
  const colAHtml = colA.map(g => renderGroup(g, priceFormatter)).join("");
  const colBHtml = colB.map(g => renderGroup(g, priceFormatter)).join("");

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
  <div>
    <div class="brand-name">OZK TOBACCO</div>
    <div class="bulletin-title">نشرة الأسعار — ${isoDate}</div>
    <span class="currency-badge ${badgeClass}">${badgeLabel}</span>
  </div>
  <div class="meta-sep"></div>
  <div class="meta-block">
    <div class="meta-label">السعر المعروض</div>
    <div class="meta-value">${unitLabel}</div>
    <div class="meta-sub">${items.length} مادة</div>
  </div>
  <div class="meta-sep"></div>
  <div class="meta-block">
    <div class="meta-label">تاريخ الإصدار</div>
    <div class="meta-value">${issueDate}</div>
  </div>
  <div class="meta-sep"></div>
  <div class="meta-block">
    <div class="meta-label">صالحة حتى</div>
    <div class="meta-value">${expiryDate}</div>
    <div class="meta-sub">${VALIDITY} يوماً</div>
  </div>
</div>

<div class="columns">
  <div class="col">${colAHtml}</div>
  <div class="col">${colBHtml}</div>
</div>

<div class="footer">
  <span>⚠️ الأسعار سارية حتى <strong>${expiryDate}</strong> — خاضعة للتغيير بدون إشعار</span>
  <span>ozk.kh@outlook.com</span>
</div>

</body>
</html>`;
}

// ── نشرة الدولار (سعر الكرتونة) ──────────────────────────────────────────────
const usdHtml = buildHtml({
  titleSuffix: "دولار",
  badgeClass:  "badge-usd",
  badgeLabel:  "💵 دولار أمريكي",
  unitLabel:   "الكرتونة",
  priceFormatter: (item) => `${item.usd.toFixed(2)} $`,
});
writeFileSync(resolve(root, "public/downloads/price-list-usd.html"), usdHtml);
console.log("✓ price-list-usd.html  (كرتونة — دولار)");

// ── نشرة الليرة (سعر الوحدة) ────────────────────────────────────────────────
const sypHtml = buildHtml({
  titleSuffix: "سوري",
  badgeClass:  "badge-syp",
  badgeLabel:  `🇸🇾 ليرة سورية — صرف ${SYP_RATE.toLocaleString()}`,
  unitLabel:   "الوحدة",
  priceFormatter: (item) => {
    const unitPrice = (item.usd * SYP_RATE) / (item.unitFactor ?? 10);
    return `${Math.round(unitPrice).toLocaleString("ar-SY")} ل.س`;
  },
});
writeFileSync(resolve(root, `public/downloads/price-list-syp-${SYP_RATE}.html`), sypHtml);
console.log(`✓ price-list-syp-${SYP_RATE}.html  (وحدة — ليرة، صرف ${SYP_RATE.toLocaleString()})`);

// ── index.html ────────────────────────────────────────────────────────────────
const indexHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>نشرات الأسعار — OZK TOBACCO</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Tahoma,sans-serif; background:#0d0b08; color:#e8d9b0;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:40px 20px; }
  .logo   { font-size:2rem; font-weight:900; color:#d7a83f; letter-spacing:2px; margin-bottom:4px; }
  .sub    { color:#a08850; font-size:.9rem; margin-bottom:4px; }
  .date   { color:#6b5535; font-size:.8rem; margin-bottom:44px; }
  h1 { font-size:1.3rem; color:#e8d9b0; margin-bottom:28px; text-align:center; }
  .cards  { display:flex; gap:24px; flex-wrap:wrap; justify-content:center; width:100%; max-width:680px; }
  .card   { background:#1a160f; border:1px solid #5a4524; border-radius:12px;
            padding:28px 22px; flex:1; min-width:255px; max-width:295px;
            text-align:center; text-decoration:none; color:inherit;
            transition:border-color .2s,transform .15s; display:block; }
  .card:hover { border-color:#d7a83f; transform:translateY(-3px); }
  .card-icon     { font-size:2.6rem; margin-bottom:12px; }
  .card-title    { font-size:1.1rem; font-weight:700; color:#d7a83f; margin-bottom:5px; }
  .card-unit     { font-size:.82rem; color:#c8a663; margin-bottom:5px; font-weight:700; }
  .card-desc     { font-size:.83rem; color:#a08850; line-height:1.6; }
  .card-validity { font-size:.76rem; color:#6b5535; margin-top:7px; }
  .card-btn      { display:inline-block; margin-top:16px; background:#d7a83f; color:#1a1208;
                   font-weight:700; padding:8px 20px; border-radius:6px; font-size:.86rem; }
  .footer { margin-top:52px; color:#5a4524; font-size:.77rem; text-align:center; line-height:1.9; }
</style>
</head>
<body>
<div class="logo">OZK TOBACCO</div>
<div class="sub">نشرات الأسعار الرسمية</div>
<div class="date">تاريخ الإصدار: ${issueDate} &nbsp;|&nbsp; صالحة لـ ${VALIDITY} يوماً</div>

<h1>اختر نشرة الأسعار</h1>

<div class="cards">
  <a class="card" href="price-list-syp-${SYP_RATE}.html" target="_blank">
    <div class="card-icon">🇸🇾</div>
    <div class="card-title">نشرة السوري</div>
    <div class="card-unit">سعر الوحدة الواحدة</div>
    <div class="card-desc">بالليرة السورية<br>صرف ${SYP_RATE.toLocaleString()} ل.س/دولار</div>
    <div class="card-validity">صالحة حتى: ${expiryDate}</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
  <a class="card" href="price-list-usd.html" target="_blank">
    <div class="card-icon">💵</div>
    <div class="card-title">نشرة الدولار</div>
    <div class="card-unit">سعر الكرتونة الكاملة</div>
    <div class="card-desc">بالدولار الأمريكي</div>
    <div class="card-validity">صالحة حتى: ${expiryDate}</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>
</div>

<div class="footer">
  اضغط "عرض وطباعة" ← ثم Ctrl+P أو زر الطباعة لحفظها PDF<br>
  للاستفسار: ozk.kh@outlook.com
</div>
</body>
</html>`;
writeFileSync(resolve(root, "public/downloads/index.html"), indexHtml);
console.log("✓ index.html");

console.log(`\nاكتمل — ${items.length} مادة | ${groups.length} مجموعة | صرف ${SYP_RATE.toLocaleString()} | صلاحية ${VALIDITY} يوماً`);
