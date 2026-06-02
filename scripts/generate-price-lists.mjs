/**
 * توليد نشرات الأسعار HTML
 * الاستخدام: node scripts/generate-price-lists.mjs [--rate 14050] [--validity 30]
 *
 * المخرجات:
 *   public/downloads/price-list-usd.html
 *   public/downloads/price-list-syp-<rate>.html
 *   public/downloads/index.html  (يحدَّث تلقائياً بالتاريخ)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

// ── وسيطات CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const rateArg = args.indexOf("--rate");
const validityArg = args.indexOf("--validity");
const SYP_RATE = rateArg !== -1 ? Number(args[rateArg + 1]) : 14050;
const VALIDITY_DAYS = validityArg !== -1 ? Number(args[validityArg + 1]) : 30;

// ── تواريخ ──────────────────────────────────────────────────────────────────
const today = new Date();
const fmtDate = (d) =>
  d.toLocaleDateString("ar-SY", {
    year: "numeric",
    month: "long",
    day: "numeric",
    calendar: "gregory",
  });
const issueDate = fmtDate(today);
const expiryDate = fmtDate(new Date(today.getTime() + VALIDITY_DAYS * 864e5));
const isoDate = today.toISOString().slice(0, 10);

// ── بيانات الأسعار ──────────────────────────────────────────────────────────
const items = JSON.parse(
  readFileSync(resolve(root, "scripts/price-data.json"), "utf8")
);

// ── CSS المشترك ─────────────────────────────────────────────────────────────
const sharedCSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Tahoma, 'Segoe UI', Arial, sans-serif; background:#fff; color:#1a1a1a; direction:rtl; }

  /* ── الطباعة ─────────────────────────────── */
  @page { size: A4 portrait; margin: 12mm 10mm; }
  @media print {
    body { margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .no-print { display:none !important; }
    .header { background:#f0ead8 !important; border:2px solid #d7a83f !important; }
    thead tr { background:#e8d4b0 !important; }
    tr.odd { background:#f9f7f3 !important; }
    .footer { background:#f0ead8 !important; }
    table { page-break-inside:auto; }
    tr { page-break-inside:avoid; }
  }

  /* ── رأس الصفحة ──────────────────────────── */
  .header {
    background:#f0ead8; border:2px solid #d7a83f; border-radius:8px;
    padding:14px 20px; margin:14px; display:flex;
    justify-content:space-between; align-items:center; gap:12px;
  }
  .brand { display:flex; flex-direction:column; gap:3px; }
  .brand-name { font-size:24px; font-weight:900; color:#221808; letter-spacing:1px; }
  .brand-sub { font-size:13px; color:#6b5535; font-weight:700; }
  .meta-block { text-align:center; }
  .meta-block .label { font-size:9px; font-weight:700; color:#6b5535; text-transform:uppercase; letter-spacing:.5px; }
  .meta-block .value { font-size:13px; font-weight:900; color:#221808; margin:2px 0; }
  .meta-block .sub { font-size:10px; color:#8a6a35; }
  .meta-sep { width:1px; background:#c8a673; align-self:stretch; opacity:.6; }

  /* ── الجدول ──────────────────────────────── */
  .container { margin:0 14px 14px; }
  table { width:100%; border-collapse:collapse; border:1px solid #d8c899; border-radius:8px; overflow:hidden; }
  thead tr { background:#e8d4b0; }
  thead th { padding:9px 8px; font-size:12px; color:#3a2a0a; border-bottom:2px solid #c8a673; }
  td { padding:5px 8px; border-bottom:1px solid #e0d8c8; font-size:11px; }
  td.name  { font-weight:700; color:#1a1a1a; }
  td.unit  { color:#5a4010; text-align:center; }
  td.price { font-weight:900; color:#1a1a1a; text-align:left; direction:ltr; font-size:12px; }
  tr.odd  { background:#f9f7f3; }
  tr.even { background:#ffffff; }
  tr:last-child td { border-bottom:none; }

  /* ── الذيل ───────────────────────────────── */
  .footer {
    margin:12px 14px; padding:10px 16px; background:#f0ead8;
    border:1px solid #c8a673; border-radius:6px;
    font-size:10px; color:#3a2a0a;
    display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;
  }
  .footer .validity { font-weight:700; color:#221808; }
  .footer .contact { color:#6b5535; }

  /* ── زر الطباعة ───────────────────────────── */
  .print-btn {
    position:fixed; top:16px; left:16px; z-index:999;
    background:#d7a83f; color:#1a1208; border:none;
    padding:10px 20px; border-radius:8px; font-size:14px;
    font-weight:700; cursor:pointer; font-family:Tahoma;
    box-shadow:0 2px 8px rgba(0,0,0,.2);
  }
  .print-btn:hover { background:#c49535; }
  .count-badge {
    display:inline-block; background:#d7a83f; color:#1a1208;
    border-radius:12px; padding:2px 8px; font-size:10px; font-weight:700; margin-right:6px;
  }
`;

// ── بناء الجدول ─────────────────────────────────────────────────────────────
function buildRows(priceFormatter) {
  return items
    .map(
      ({ name, unit, usd }, i) => `
      <tr class="${i % 2 === 0 ? "odd" : "even"}">
        <td class="name">${name}</td>
        <td class="unit">${unit}</td>
        <td class="price">${priceFormatter(usd)}</td>
      </tr>`
    )
    .join("\n");
}

// ── قالب HTML ────────────────────────────────────────────────────────────────
function buildHtml({ title, currencyLabel, currencySymbol, priceFormatter }) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${sharedCSS}</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">🖨️ طباعة / PDF</button>

<div class="header">
  <div class="brand">
    <div class="brand-name">OZK TOBACCO</div>
    <div class="brand-sub">${currencyLabel} <span class="count-badge">${items.length} مادة</span></div>
  </div>

  <div class="meta-sep"></div>

  <div class="meta-block">
    <div class="label">تاريخ الإصدار</div>
    <div class="value">${issueDate}</div>
    <div class="sub">${isoDate}</div>
  </div>

  <div class="meta-sep"></div>

  <div class="meta-block">
    <div class="label">صالحة حتى</div>
    <div class="value">${expiryDate}</div>
    <div class="sub">مدة الصلاحية ${VALIDITY_DAYS} يوماً</div>
  </div>
</div>

<div class="container">
  <table>
    <thead>
      <tr>
        <th style="text-align:right; width:60%">اسم المادة</th>
        <th style="text-align:center; width:20%">الوحدة</th>
        <th style="text-align:left; width:20%">السعر (${currencySymbol})</th>
      </tr>
    </thead>
    <tbody>
${buildRows(priceFormatter)}
    </tbody>
  </table>
</div>

<div class="footer">
  <div>
    <span class="validity">⚠️ الأسعار سارية حتى: ${expiryDate}</span>
    &nbsp;—&nbsp; الأسعار خاضعة للتغيير بدون إشعار مسبق
  </div>
  <div class="contact">للاستفسار: ozk.kh@outlook.com</div>
</div>

</body>
</html>`;
}

// ── توليد ملف الدولار ────────────────────────────────────────────────────────
const usdHtml = buildHtml({
  title: "نشرة الدولار — OZK TOBACCO",
  currencyLabel: "نشرة الدولار الأمريكي",
  currencySymbol: "$",
  priceFormatter: (usd) => `${usd.toFixed(2)} $`,
});
writeFileSync(
  resolve(root, "public/downloads/price-list-usd.html"),
  usdHtml
);
console.log("✓ price-list-usd.html");

// ── توليد ملف الليرة ─────────────────────────────────────────────────────────
const sypHtml = buildHtml({
  title: `نشرة الليرة السورية (${SYP_RATE.toLocaleString()}) — OZK TOBACCO`,
  currencyLabel: `نشرة الليرة السورية — صرف ${SYP_RATE.toLocaleString()} ل.س`,
  currencySymbol: "ل.س",
  priceFormatter: (usd) =>
    `${(usd * SYP_RATE).toLocaleString("ar-SY")} ل.س`,
});
writeFileSync(
  resolve(root, `public/downloads/price-list-syp-${SYP_RATE}.html`),
  sypHtml
);
console.log(`✓ price-list-syp-${SYP_RATE}.html`);

// ── تحديث index.html لصفحة الاختيار ─────────────────────────────────────────
const indexHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>نشرات الأسعار — OZK TOBACCO</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, sans-serif;
    background: #0d0b08; color: #e8d9b0;
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; padding: 40px 20px;
  }
  .logo { font-size: 2rem; font-weight: 900; color: #d7a83f; letter-spacing: 2px; margin-bottom: 4px; }
  .subtitle { color: #a08850; font-size: 0.9rem; margin-bottom: 6px; }
  .issue-date { color: #6b5535; font-size: 0.82rem; margin-bottom: 44px; }
  h1 { font-size: 1.3rem; color: #e8d9b0; margin-bottom: 28px; text-align: center; }
  .cards { display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; width: 100%; max-width: 680px; }
  .card {
    background: #1a160f; border: 1px solid #5a4524; border-radius: 12px;
    padding: 30px 24px; flex: 1; min-width: 260px; max-width: 300px;
    text-align: center; text-decoration: none; color: inherit;
    transition: border-color 0.2s, transform 0.15s; display: block;
  }
  .card:hover { border-color: #d7a83f; transform: translateY(-3px); }
  .card-icon { font-size: 2.8rem; margin-bottom: 14px; }
  .card-title { font-size: 1.15rem; font-weight: 700; color: #d7a83f; margin-bottom: 6px; }
  .card-desc { font-size: 0.85rem; color: #a08850; line-height: 1.6; }
  .card-validity { font-size: 0.78rem; color: #6b5535; margin-top: 8px; }
  .card-btn { display: inline-block; margin-top: 18px; background: #d7a83f; color: #1a1208; font-weight: 700; padding: 9px 22px; border-radius: 6px; font-size: 0.88rem; }
  .footer { margin-top: 56px; color: #5a4524; font-size: 0.78rem; text-align: center; line-height: 1.8; }
</style>
</head>
<body>

<div class="logo">OZK TOBACCO</div>
<div class="subtitle">نشرات الأسعار الرسمية</div>
<div class="issue-date">تاريخ الإصدار: ${issueDate} &nbsp;|&nbsp; صالحة لـ ${VALIDITY_DAYS} يوماً</div>

<h1>اختر نشرة الأسعار</h1>

<div class="cards">

  <a class="card" href="price-list-usd.html" target="_blank">
    <div class="card-icon">💵</div>
    <div class="card-title">نشرة الدولار</div>
    <div class="card-desc">أسعار جميع المواد بالدولار الأمريكي</div>
    <div class="card-validity">صالحة حتى: ${expiryDate}</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>

  <a class="card" href="price-list-syp-${SYP_RATE}.html" target="_blank">
    <div class="card-icon">🇸🇾</div>
    <div class="card-title">نشرة الليرة السورية</div>
    <div class="card-desc">أسعار جميع المواد بالليرة السورية<br>سعر الصرف: ${SYP_RATE.toLocaleString()} ل.س/دولار</div>
    <div class="card-validity">صالحة حتى: ${expiryDate}</div>
    <div class="card-btn">عرض وطباعة</div>
  </a>

</div>

<div class="footer">
  لفتح النشرة اضغط "عرض وطباعة" ← ثم Ctrl+P أو زر الطباعة لحفظها PDF<br>
  للاستفسار: ozk.kh@outlook.com
</div>

</body>
</html>`;
writeFileSync(resolve(root, "public/downloads/index.html"), indexHtml);
console.log("✓ index.html (landing page)");

console.log(`\nاكتمل — ${items.length} مادة | صرف ${SYP_RATE.toLocaleString()} ل.س | صلاحية ${VALIDITY_DAYS} يوماً`);
