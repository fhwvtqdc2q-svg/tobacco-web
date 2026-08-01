import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const required = [
  "index.html",
  "src/app.js",
  "src/config.js",
  "src/supabase-client.js",
  "src/number-normalizer.js",
  "src/styles.css",
  "public/manifest.webmanifest",
  "public/service-worker.js",
  "scripts/exchange-rate.json",
  "public/downloads/price-list-usd.html",
  "public/downloads/price-list-usd.pdf",
  "public/downloads/price-list-usd-light.pdf",
  "public/downloads/price-list-syp-14050.html",
  "public/downloads/price-list-syp-14050.pdf",
  "public/downloads/price-list-syp-14050-light.pdf",
  "public/downloads/price-list-wazari-usd.html",
  "public/downloads/price-list-wazari-usd.pdf",
  "public/downloads/price-list-wazari-usd-light.pdf",
  "public/downloads/price-list-wazari-syp-14050.html",
  "public/downloads/price-list-wazari-syp-14050.pdf",
  "public/downloads/price-list-wazari-syp-14050-light.pdf",
  "AI_WORK_SYNC.md",
  "AI_HANDOFF.md",
  "AI_ACTIVE_TASK.json"
];

let failed = false;

for (const file of required) {
  if (!existsSync(file)) {
    console.error(`Missing: ${file}`);
    failed = true;
  }
}

const html = readFileSync("index.html", "utf8");
if (!html.includes('id="app"')) {
  console.error("index.html is missing #app root.");
  failed = true;
}

if (!html.includes("supabase-client.js")) {
  console.error("index.html is missing Supabase client wiring.");
  failed = true;
}

if (!html.includes("number-normalizer.js")) {
  console.error("index.html is missing number-normalizer.js wiring.");
  failed = true;
}

const app = readFileSync("src/app.js", "utf8");
const priceGenerator = readFileSync("scripts/generate-price-lists.mjs", "utf8");
const usdBulletin = readFileSync("public/downloads/price-list-usd.html", "utf8");
const sypBulletin = readFileSync("public/downloads/price-list-syp-14050.html", "utf8");
const ameenSyncAgent = readFileSync("tools/ameen-sync-agent.ps1", "utf8");
const ameenPriceApply = readFileSync("tools/apply-approved-prices-to-ameen.ps1", "utf8");
const ameenPriceVerify = readFileSync("tools/verify-prices.ps1", "utf8");
for (const contract of ["كابتن بلاك كوين ازرق", "كابتن بلاك كور ازرق جديد", "كابتن بلاك كوين اسود", "كابتن بلاك كور اسود جديد"]) {
  for (const [label, source] of [
    ["site normalization", app],
    ["inventory synchronization", ameenSyncAgent],
    ["price application", ameenPriceApply],
    ["price verification", ameenPriceVerify],
    ["bulletin generation", priceGenerator]
  ]) {
    if (!source.includes(contract)) {
      console.error(`Captain Black Core alias contract is missing from ${label}: ${contract}`);
      failed = true;
    }
  }
}
for (const contract of ['["ماستر كوين أبيض", 340]', '["1970 كوين أبيض", 275]', "distinctPrices.size < 2"]) {
  if (!priceGenerator.includes(contract)) {
    console.error(`Corrected bulletin price contract is missing: ${contract}`);
    failed = true;
  }
}
const priceGenerationWorkflow = readFileSync(".github/workflows/generate-price-lists.yml", "utf8");
if (/git commit[^\n]*\[skip ci\]/i.test(priceGenerationWorkflow)) {
  console.error("Generated price-list commits must trigger Pages deployment; remove [skip ci] from the generator commit.");
  failed = true;
}
for (const contract of ["inputs:", "rate:", "SYP_RATE:", "scripts/exchange-rate.json"]) {
  if (!priceGenerationWorkflow.includes(contract)) {
    console.error(`Exchange-rate workflow contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of [
  "cron: '*/15 * * * *'",
  "id: bulletin_changes",
  "steps.bulletin_changes.outputs.changed == 'true'",
  "لا تغييرات في الأسعار اليدوية أو المخزون"
]) {
  if (!priceGenerationWorkflow.includes(contract)) {
    console.error(`Automatic manual-price bulletin contract is missing: ${contract}`);
    failed = true;
  }
}
const newsletterContracts = [
  'navButton("pricing", "نشرة الأسعار")',
  'pricing: "نشرة الأسعار"',
  "مركز نشرة الأسعار",
  "public/downloads/price-list-usd.html",
  "public/downloads/price-list-syp-14050.html",
  "public/downloads/price-list-wazari-usd.html",
  "public/downloads/price-list-wazari-syp-14050.html"
];
for (const contract of newsletterContracts) {
  if (!app.includes(contract)) {
    console.error(`Newsletter center contract is missing: ${contract}`);
    failed = true;
  }
}

for (const contract of [
  "function isWazariPriceItem",
  "function hasFullSecondUnit",
  "function consolidateGeneralPriceItems",
  "function generalPricingWorklistItems",
  "const items = generalPricingWorklistItems();",
  "pricingWorklistItems({ ignoreSearch: true })",
  "data-source-keys=",
  "sourceKeys: [item.key].filter(Boolean)"
]) {
  if (!app.includes(contract)) {
    console.error(`General pricing list contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of ["const merged = new Map();", "counts.set(price", "findLast((candidate)"]) {
  if (!priceGenerator.includes(contract)) {
    console.error(`Merged bulletin price selection contract is missing: ${contract}`);
    failed = true;
  }
}

// أصناف الدمج الإداري يجب أن تظهر مرة واحدة في كل نشرة حتى لو كانت aliases
// القديمة تحمل أسعاراً مختلفة قبل أن يوحّدها الحفظ التالي من الموقع.
for (const [label, bulletin] of [["USD", usdBulletin], ["SYP", sypBulletin]]) {
  for (const name of ["ماستر طويل ورق", "ماستر قصير أزرق"]) {
    const count = bulletin.split(name).length - 1;
    if (count !== 1) {
      console.error(`${label} bulletin must contain one merged row for ${name}; found ${count}.`);
      failed = true;
    }
  }
}
for (const contract of ["sourceKeys: named.map", "const exact = named.find"]) {
  if (!app.includes(contract)) {
    console.error(`Administrative bulletin alias merge contract is missing: ${contract}`);
    failed = true;
  }
}

if (app.includes("سعّر الجملة أولاً")) {
  console.error("Retail-only pricing must not require a wholesale USD price first.");
  failed = true;
}
for (const contract of [
  "data-published-exchange-rate",
  "inputs: { rate: String(rate) }",
  "loadPublishedExchangeRate",
  "writeJson(\"syria-exchange-rate\", rate)",
  "scheduleBulletinPublish({ label:"
]) {
  if (!app.includes(contract)) {
    console.error(`Daily exchange-rate contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of [
  "function refreshBulletinStatusNotice",
  'addEventListener("input"',
  "cloudFallback: false",
  "ستلتقطه السحابة تلقائياً خلال 15 دقيقة"
]) {
  if (!app.includes(contract)) {
    console.error(`Reliable manual rate/price publishing contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of [
  "async function savePendingPricingEdits",
  "async function openFreshPricePreview",
  "data-dirty='true'",
  'form.dataset.dirty = "true"',
  "openFreshPricePreview(false)",
  "openFreshPricePreview(true)",
  "حفظ التعديلات ومعاينة PDF الآن"
]) {
  if (!app.includes(contract)) {
    console.error(`Instant bulletin print/export contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of ["scheduleBulletinPublish", "normalizedTargets", "aliasKeys", "storedTokenOnly: true"]) {
  if (!app.includes(contract)) {
    console.error(`Automatic bulletin synchronization contract is missing: ${contract}`);
    failed = true;
  }
}
if (app.includes("state.inventoryReports[0]")) {
  console.error("Inventory views must select the latest real stock report instead of the newest mixed report row.");
  failed = true;
}
for (const contract of ["function latestStockReport()", "const latest = latestStockReport();", "reportItems(latestStockReport())"]) {
  if (!app.includes(contract)) {
    console.error(`Latest stock-report selection contract is missing: ${contract}`);
    failed = true;
  }
}
if (/function latestStockReport\(\)[\s\S]*?\|\| reports\[0\]/.test(app)) {
  console.error("Latest stock-report selection must not fall back to a non-stock report.");
  failed = true;
}
for (const contract of [
  'name="wholesalePrice"',
  'name="retailPrice"',
  "const sourceUnit2Price = wholesaleProvided ? enteredWholesale : sourceExistingWholesale;",
  "const sourceRetailPrice = retailProvided ? enteredRetail : sourceExistingRetail;",
  'data-action="download-customer-price-pdf"',
  'data-action="download-customer-price-syria"',
  "آخر نسخة منشورة للزبائن"
]) {
  if (!app.includes(contract)) {
    console.error(`Dual-price save/instant preview contract is missing: ${contract}`);
    failed = true;
  }
}

const generatedNewsletterPages = [
  "public/downloads/price-list-usd.html",
  "public/downloads/price-list-syp-14050.html",
  "public/downloads/price-list-wazari-usd.html",
  "public/downloads/price-list-wazari-syp-14050.html"
];
for (const newsletterPage of generatedNewsletterPages) {
  const page = readFileSync(newsletterPage, "utf8");
  if (!page.includes("طباعة مباشرة") || !page.includes("فتح PDF") || !page.includes("تنزيل PDF") || !page.includes("-light.pdf") || page.includes('target="_blank"')) {
    console.error(`Newsletter page is missing theme-aware mobile print controls: ${newsletterPage}`);
    failed = true;
  }
  if (page.includes("item-count-num") || page.includes("item-count-lbl")) {
    console.error(`Newsletter page must not show the item count: ${newsletterPage}`);
    failed = true;
  }
}

// تناسق نسخة الكاش: كل أصل محلي في index.html يجب أن يحمل نفس قيمة ?v=
// يلتقط خطأ "رفعت رقم النسخة لبعض الملفات ونسيت الباقي" قبل النشر.
const versionTags = [...html.matchAll(/(?:src|href)="[^"]*\?v=([^"&]+)"/g)].map((m) => m[1]);
if (versionTags.length === 0) {
  console.error("index.html has no ?v= cache-busting versions on local assets.");
  failed = true;
} else {
  const uniqueVersions = [...new Set(versionTags)];
  if (uniqueVersions.length > 1) {
    console.error(`index.html has mismatched asset versions: ${uniqueVersions.join(", ")}. Bump them all to the same value.`);
    failed = true;
  }
}

// منع بقاء المتصفح على app.js قديم بعد تغييرات تقرير المخزون: يجب رفع نسخة
// أصول index مع نسخة الكاش الجديدة، وإلا تفتح نافذة about:blank من كود قديم.
const tobaccoAssetVersion = Number((versionTags[0] || "").match(/tobacco-(\d+)/)?.[1] || 0);
if (tobaccoAssetVersion < 88) {
  console.error("index.html asset version must be tobacco-88 or newer after the inventory report update.");
  failed = true;
}

// service worker يجب أن يحمل CACHE_NAME غير فارغ (يُرفع رقمه عند كل نشر).
const sw = readFileSync("public/service-worker.js", "utf8");
const cacheMatch = sw.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
if (!cacheMatch || !cacheMatch[1].trim()) {
  console.error("service-worker.js is missing a non-empty CACHE_NAME.");
  failed = true;
}
const cacheVersion = Number(cacheMatch?.[1]?.match(/v(\d+)$/)?.[1] || 0);
if (cacheVersion < 272) {
  console.error("service worker cache must be v272 or newer after the inventory report update.");
  failed = true;
}

// عقد تقرير المخزون: ترتيب النشرة، تصنيف حسب حركة المبيع، مجموعات ظاهرة،
// وتصميم فاتح ثابت في الشاشة والطباعة.
const appJs = readFileSync("src/app.js", "utf8");

// نموذج الفاتورة يجب أن يبقي التركيز أثناء كتابة اسم الزبون، وأن يستخدم
// أرقاماً إنجليزية في حقول الكمية والسعر مهما كانت لغة عرض ويندوز.
if (/state\.invCustomer = e\.currentTarget\.value;\s*render\(\);/.test(appJs)) {
  console.error("Invoice customer input must not rerender and lose focus after every character.");
  failed = true;
}
for (const field of ["qty", "price"]) {
  const invoiceInput = new RegExp(`data-inv-field="${field}"[^>]*type="text"[^>]*inputmode="decimal"[^>]*dir="ltr"`);
  if (!invoiceInput.test(appJs)) {
    console.error(`Invoice ${field} input must use English decimal text entry.`);
    failed = true;
  }
}
const numberNormalizer = readFileSync("src/number-normalizer.js", "utf8");
if (!numberNormalizer.includes("input[data-inv-field='qty']") || !numberNormalizer.includes("input[data-inv-field='price']")) {
  console.error("Invoice numeric fields must be covered by the English-number normalizer.");
  failed = true;
}

for (const contract of [
  "INVENTORY_GROUP_SEQUENCE",
  "inventoryReportStatus",
  "inventory-group-row",
  "inventoryTwoColumnPages",
  "inventory-columns",
  "grid-template-columns:repeat(2",
  "inventory-rpt",
  "color-scheme:light",
  "لا تُدمج أصناف المعسل"
]) {
  if (!appJs.includes(contract)) {
    console.error(`Inventory report contract is missing: ${contract}`);
    failed = true;
  }
}

// تقرير الذمم يجب أن يعرض تاريخ آخر دفعة وقيمتها في عمودين صريحين.
if (!appJs.includes("قيمة آخر دفعة") || !/receivablesPdfMarkup[\s\S]*customerLastPaymentAmount\(it\)/.test(appJs)) {
  console.error("Receivables PDF must include the last payment amount beside its date.");
  failed = true;
}

// أرصدة الذمم تأتي موحّدة بالدولار من ac000 ولا يجوز تحويلها ثانية حسب تصنيف الزبون.
const balanceQuery = readFileSync("tools/ameen-customer-balances-query.sql", "utf8");
if (!/coalesce\(ac\.Debit, 0\) - coalesce\(ac\.Credit, 0\)/i.test(balanceQuery)
  || /as balance[\s\S]{0,120}cu\.Debit/i.test(balanceQuery)
  || !/function customerBalanceSortValue\(item\)\s*\{\s*return customerBalance\(item\);\s*\}/.test(appJs)
  || !/receivablesPdfMarkup[\s\S]*customerBalanceSortValue\(b\) - customerBalanceSortValue\(a\)/.test(appJs)) {
  console.error("Receivables must use and sort the USD base balance from ac000 without a second conversion.");
  failed = true;
}

// أرصدة الزبائن صفحة مستقلة وليست جزءاً من تبويب الأمين.
for (const contract of [
  'navButton("balances", "💳 أرصدة الزبائن")',
  "function customerBalancesPage()",
  "balances: customerBalancesPage",
  '["ameen", "balances", "pricing", "dashboard", "payments"]'
]) {
  if (!appJs.includes(contract)) {
    console.error(`Standalone customer balances contract is missing: ${contract}`);
    failed = true;
  }
}
const ameenFunction = appJs.match(/function ameen\(\) \{[\s\S]*?\n\}\n\nfunction customerBalancesPage\(/)?.[0] || "";
if (ameenFunction.includes("customerBalanceSection(")) {
  console.error("Ameen tab must not render the customer balances section.");
  failed = true;
}

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
if (!manifest.name || !manifest.start_url) {
  console.error("manifest.webmanifest is incomplete.");
  failed = true;
}

const coordination = JSON.parse(readFileSync("AI_ACTIVE_TASK.json", "utf8"));
if (coordination.schemaVersion !== 1 || !["idle", "active"].includes(coordination.status)) {
  console.error("AI_ACTIVE_TASK.json has an invalid schema or status.");
  failed = true;
}
if (coordination.status === "active" && (!coordination.owner || !coordination.task || !coordination.branch)) {
  console.error("Active AI task is missing owner, task, or branch.");
  failed = true;
}
if (!Array.isArray(coordination.files)) {
  console.error("AI_ACTIVE_TASK.json files must be an array.");
  failed = true;
}

// قائمة دمج النشرة يجب أن تكون متطابقة بين المولّد (scripts/bulletin-merge-names.json)
// وقائمة الموقع (BULLETIN_MERGE_NAMES في src/app.js): أي اختلاف يعني أن النشرة
// العامة ستعرض صنفين بينما يعرضهما الموقع مدموجين — وهو ما يربك الزبون والبائع.
const mergeNamesRaw = readFileSync("scripts/bulletin-merge-names.json", "utf8");
let mergeNames = [];
try {
  mergeNames = JSON.parse(mergeNamesRaw);
} catch {
  console.error("scripts/bulletin-merge-names.json is not valid JSON.");
  failed = true;
}
if (!Array.isArray(mergeNames) || mergeNames.some((name) => typeof name !== "string" || !name.trim())) {
  console.error("scripts/bulletin-merge-names.json must be an array of non-empty strings.");
  failed = true;
} else {
  const appSource = readFileSync("src/app.js", "utf8");
  const literal = appSource.match(/const BULLETIN_MERGE_NAMES = \[(.*?)\];/s);
  if (!literal) {
    console.error("BULLETIN_MERGE_NAMES not found in src/app.js.");
    failed = true;
  } else {
    const appNames = [...literal[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (JSON.stringify(appNames) !== JSON.stringify(mergeNames)) {
      console.error("BULLETIN_MERGE_NAMES in src/app.js does not match scripts/bulletin-merge-names.json.");
      console.error(`  app.js: ${JSON.stringify(appNames)}`);
      console.error(`  json:   ${JSON.stringify(mergeNames)}`);
      failed = true;
    }
  }
}

// اختبارات حقيقية (assertions فعلية لا مجرد فحص نصي) لدوال purchase-invoice-calc.js
// النقية: مطابقة الأصناف، حساب الأسطر/الإجمالي/المتبقي، تطبيع الأرقام، التحقق من
// الدفعة، وحارس انتقالات حالة الفاتورة. تشغَّل داخل sandbox معزول عن DOM.
{
  const poCalcSource = readFileSync("src/purchase-invoice-calc.js", "utf8");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(poCalcSource, sandbox, { filename: "purchase-invoice-calc.js" });
  const poCalc = sandbox.window.poCalc;
  if (!poCalc) {
    console.error("src/purchase-invoice-calc.js did not expose window.poCalc.");
    failed = true;
  } else {
    const assertEqual = (label, actual, expected) => {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        console.error(`poCalc test failed: ${label} — got ${a}, expected ${e}`);
        failed = true;
      }
    };

    // تطبيع الأرقام العربية/الفارسية إلى إنجليزية
    assertEqual("poNormalizeNumeric arabic-indic digits", poCalc.poNormalizeNumeric("١٢٣٫٥"), "123.5");
    assertEqual("poToNumber persian digits", poCalc.poToNumber("۴۲"), 42);

    // حساب سطر الفاتورة
    assertEqual("poRowComputed without key", poCalc.poRowComputed({ qty: "5", price: "2" }), { qty: 0, price: 0, lineTotal: 0 });
    assertEqual("poRowComputed with key", poCalc.poRowComputed({ key: "x", qty: "5", price: "2" }), { qty: 5, price: 2, lineTotal: 10 });

    // إجمالي الفاتورة (سطر بلا key لا يُحتسب)
    assertEqual(
      "poTotals sums only rows with key",
      poCalc.poTotals([{ key: "a", qty: "2", price: "3" }, { qty: "9", price: "9" }, { key: "b", qty: "1", price: "1.5" }]),
      { grand: 7.5 }
    );

    // حالة المتبقي: مستحق، مسدد بالكامل، مدفوع زيادة
    assertEqual("poRemainingState due", poCalc.poRemainingState({ total: 100, paidAmount: 40 }).status, "due");
    assertEqual("poRemainingState settled", poCalc.poRemainingState({ total: 100, paidAmount: 100 }).status, "settled");
    assertEqual("poRemainingState over", poCalc.poRemainingState({ total: 100, paidAmount: 150 }).status, "over");

    // التحقق من قيمة الدفعة (رفض السالب وما يتجاوز الإجمالي، قبول القيم الصحيحة)
    assertEqual("poValidatePayment negative rejected", poCalc.poValidatePayment({ total: 100, amount: -1 }).ok, false);
    assertEqual("poValidatePayment over-total rejected", poCalc.poValidatePayment({ total: 100, amount: 150 }).ok, false);
    assertEqual("poValidatePayment valid accepted", poCalc.poValidatePayment({ total: 100, amount: 60 }).ok, true);

    // النص الظاهر لصنف مختار: رقم — اسم دوماً، مع الحفاظ على الأصفار البادئة
    assertEqual("poItemDisplayLabel number and name shown together", poCalc.poItemDisplayLabel("0005", "اسم المادة"), "0005 — اسم المادة");
    assertEqual("poItemDisplayLabel leading zeros preserved", poCalc.poItemDisplayLabel("0005", "اسم المادة").startsWith("0005"), true);
    assertEqual("poItemDisplayLabel name-only search still shows number when known", poCalc.poItemDisplayLabel("0012", "مادة بالاسم"), "0012 — مادة بالاسم");
    assertEqual("poItemDisplayLabel falls back to name without number", poCalc.poItemDisplayLabel("", "اسم بلا رقم"), "اسم بلا رقم");
    assertEqual("poItemDisplayLabel falls back to number without name", poCalc.poItemDisplayLabel("0009", ""), "0009");

    // تعديل حقل البحث بعد اختيار صنف يُبطل الارتباط القديم فوراً
    assertEqual(
      "poNextRowAfterQueryInput clears stale selection when text changes after pick",
      poCalc.poNextRowAfterQueryInput({ key: "k1", name: "صنف قديم", num: "0005", q: "0005 — صنف قديم" }, "0007"),
      { key: "", name: "", num: "", q: "0007" }
    );
    assertEqual(
      "poNextRowAfterQueryInput keeps selection when text unchanged",
      poCalc.poNextRowAfterQueryInput({ key: "k1", name: "صنف قديم", num: "0005", q: "0005 — صنف قديم" }, "0005 — صنف قديم"),
      { key: "k1", name: "صنف قديم", num: "0005", q: "0005 — صنف قديم" }
    );
    assertEqual(
      "poNextRowAfterQueryInput plain typing with no prior selection",
      poCalc.poNextRowAfterQueryInput({ key: "", name: "", num: "", q: "" }, "0005"),
      { key: "", name: "", num: "", q: "0005" }
    );

    // منع حفظ سطر كُتب فيه نص بحث دون اختيار فعلي من الاقتراحات
    assertEqual("poHasUnselectedEntry flags typed-but-unselected row", poCalc.poHasUnselectedEntry([{ key: "", q: "0005" }]), true);
    assertEqual("poHasUnselectedEntry ignores empty rows", poCalc.poHasUnselectedEntry([{ key: "", q: "  " }]), false);
    assertEqual("poHasUnselectedEntry passes when selected", poCalc.poHasUnselectedEntry([{ key: "k1", q: "0005 — صنف" }]), false);

    // عرض فواتير مشتريات الأمين (قراءة فقط): بحث موردين متسامح مع الهمزات/التاء المربوطة
    assertEqual(
      "poAmeenSupplierMatches tolerates hamza/taa marbouta variants",
      poCalc.poAmeenSupplierMatches("الامين", ["شركة الأمين للتجارة", "مورد آخر"]),
      ["شركة الأمين للتجارة"]
    );
    assertEqual("poAmeenSupplierMatches empty query returns no suggestions", poCalc.poAmeenSupplierMatches("", ["مورد"]), []);
    assertEqual(
      "poAmeenSupplierMatches caps at 8 suggestions",
      poCalc.poAmeenSupplierMatches("مورد", Array.from({ length: 12 }, (_, i) => `مورد ${i}`)).length,
      8
    );

    // التنقل بين فاتورة سابقة/تالية لمورد واحد بلا خروج عن حدود القائمة
    assertEqual("poAmeenClampNavIndex moves to next invoice", poCalc.poAmeenClampNavIndex(5, 0, 1), 1);
    assertEqual("poAmeenClampNavIndex moves to previous invoice", poCalc.poAmeenClampNavIndex(5, 2, -1), 1);
    assertEqual("poAmeenClampNavIndex stops at newest (index 0)", poCalc.poAmeenClampNavIndex(5, 0, -1), 0);
    assertEqual("poAmeenClampNavIndex stops at oldest (last index)", poCalc.poAmeenClampNavIndex(5, 4, 1), 4);
    assertEqual("poAmeenClampNavIndex empty list stays at 0", poCalc.poAmeenClampNavIndex(0, 0, 1), 0);

    // بحث بنود فاتورة الأمين برقم المادة أو اسمها، مع الحفاظ على الأصفار البادئة بالرقم
    const ameenSampleItems = [
      { itemNumber: "0005", itemName: "دخان أحمر" },
      { itemNumber: "0012", itemName: "دخان أزرق" }
    ];
    assertEqual(
      "poAmeenItemMatches matches by leading-zero number",
      poCalc.poAmeenItemMatches("0005", ameenSampleItems).map((i) => i.itemNumber),
      ["0005"]
    );
    assertEqual(
      "poAmeenItemMatches matches by name",
      poCalc.poAmeenItemMatches("ازرق", ameenSampleItems).map((i) => i.itemNumber),
      ["0012"]
    );
    assertEqual("poAmeenItemMatches empty query returns all items", poCalc.poAmeenItemMatches("", ameenSampleItems).length, 2);

    // كشف الأصناف المكررة
    assertEqual(
      "poDedupeLines detects duplicate item_key",
      poCalc.poDedupeLines([{ key: "a" }, { key: "b" }, { key: "a" }]).ok,
      false
    );
    assertEqual(
      "poDedupeLines passes distinct keys",
      poCalc.poDedupeLines([{ key: "a" }, { key: "b" }]).ok,
      true
    );

    // حارس انتقالات حالة الفاتورة: التقدم للأمام فقط، لا رجوع من synced أو إلى draft
    assertEqual("poCanTransitionStatus draft->approved", poCalc.poCanTransitionStatus("draft", "approved"), true);
    assertEqual("poCanTransitionStatus draft->synced skip forbidden", poCalc.poCanTransitionStatus("draft", "synced"), false);
    assertEqual("poCanTransitionStatus synced is terminal", poCalc.poCanTransitionStatus("synced", "approved"), false);
    assertEqual("poCanTransitionStatus never back to draft", poCalc.poCanTransitionStatus("approved", "draft"), false);
    assertEqual("poCanTransitionStatus sync_pending<->failed both ways", poCalc.poCanTransitionStatus("sync_pending", "failed"), true);
    assertEqual("poCanTransitionStatus failed->sync_pending", poCalc.poCanTransitionStatus("failed", "sync_pending"), true);
  }
}

// عقد ربط واجهة فواتير المشتريات بملف poCalc ومصدر Supabase الجديد — يمنع رجوع
// الواجهة لاستدعاء أسماء دوال قديمة أُزيلت من supabase-client.js.
for (const contract of [
  "window.poCalc.poRowComputed",
  "window.poCalc.poTotals",
  "poCalc.poValidatePayment",
  "poCalc.poDedupeLines",
  "poCalc.poCanTransitionStatus",
  "dataStore.setPurchaseInvoiceStatus(id, nextStatus)",
  "dataStore.correctPurchaseInvoice(id, note)",
  "dataStore.listItemSnapshots"
]) {
  if (!appJs.includes(contract)) {
    console.error(`Purchase invoice UI/data-layer contract is missing: ${contract}`);
    failed = true;
  }
}
if (appJs.includes("dataStore.updatePurchaseInvoiceStatus")) {
  console.error("src/app.js must not call the removed dataStore.updatePurchaseInvoiceStatus method.");
  failed = true;
}

// عقود SQL فواتير المشتريات: حذف المسودة يقتصر على مالكها، وapproved_by/
// approved_at مقفلان خارج انتقال draft→approved نفسه (مراجعة Codex الثالثة).
const purchaseSql = readFileSync("supabase/purchase-invoices-ameen-sync.sql", "utf8");
for (const contract of [
  "(status = 'draft' and created_by = auth.uid())\n      or purchase_invoices_is_owner()",
  "elsif new.approved_by is distinct from old.approved_by",
  "or new.approved_at is distinct from old.approved_at then"
]) {
  if (!purchaseSql.includes(contract)) {
    console.error(`Purchase invoice SQL contract is missing: ${contract}`);
    failed = true;
  }
}
if (/create policy "purchase_invoices_delete_client"[\s\S]*?using \(\s*status <> 'synced'\s*and \(created_by = auth\.uid\(\) or purchase_invoices_is_owner\(\)\)\s*\);/.test(purchaseSql)) {
  console.error("purchase_invoices_delete_client must not let any authenticated user delete any non-synced invoice — creator must be limited to their own draft.");
  failed = true;
}

// فواتير مشتريات الأمين (موردون/أسعار/تكاليف/إجماليات/دفعات) بيانات حساسة
// ويجب ألا تُكتب في inventory_reports (مقروء لكل موظف مسجّل) — يجب أن تبقى
// حصراً في الجدول المستقل المحمي ameen_purchase_invoice_reports. مراجعة
// Codex السادسة على PR #35.
const pullPurchaseInvoicesScript = readFileSync("tools/pull-purchase-invoices-from-ameen.ps1", "utf8");
if (/rest\/v1\/inventory_reports/.test(pullPurchaseInvoicesScript)) {
  console.error("tools/pull-purchase-invoices-from-ameen.ps1 must write purchase-invoice reports to the protected ameen_purchase_invoice_reports table, not inventory_reports.");
  failed = true;
}
if (!pullPurchaseInvoicesScript.includes("rest/v1/ameen_purchase_invoice_reports")) {
  console.error("tools/pull-purchase-invoices-from-ameen.ps1 is missing its protected-table target ameen_purchase_invoice_reports.");
  failed = true;
}
if (!appJs.includes('.from(purchaseInvoiceReportsTable)') && !readFileSync("src/supabase-client.js", "utf8").includes(".from(purchaseInvoiceReportsTable)")) {
  console.error("src/supabase-client.js must read Ameen purchase-invoice reports from purchaseInvoiceReportsTable, not inventory_reports.");
  failed = true;
}
const supabaseClientJs = readFileSync("src/supabase-client.js", "utf8");
if (/getPurchaseInvoicesAmeenReport[\s\S]{0,400}\.from\(inventoryReportsTable\)/.test(supabaseClientJs)) {
  console.error("getPurchaseInvoicesAmeenReport() must not read from the shared inventoryReportsTable — sensitive supplier/price/cost data would leak to every registered employee.");
  failed = true;
}
const purchaseInvoiceReportsSql = readFileSync("supabase/ameen-purchase-invoice-reports.sql", "utf8");
for (const contract of [
  "alter table ameen_purchase_invoice_reports enable row level security",
  "ameen_purchase_invoice_reports_is_owner()",
  "ameen_purchase_invoice_reports_is_sync_writer()",
  "created_by uuid not null default auth.uid()",
  "created_by = auth.uid()"
]) {
  if (!purchaseInvoiceReportsSql.includes(contract)) {
    console.error(`ameen_purchase_invoice_reports SQL contract is missing: ${contract}`);
    failed = true;
  }
}

// مراجعة Codex السابعة على PR #35: هذا الملف يجب أن يبقى self-contained تماماً —
// لا اعتماد على purchase_invoices_is_owner() ولا على تطبيق
// purchase-invoices-ameen-sync.sql كشرط مسبق، وإلا يتعذّر تطبيقه منفرداً.
if (purchaseInvoiceReportsSql.includes("purchase_invoices_is_owner()")) {
  console.error("supabase/ameen-purchase-invoice-reports.sql must not depend on purchase_invoices_is_owner() — it needs its own self-contained owner function.");
  failed = true;
}
if (purchaseInvoiceReportsSql.includes("purchase-invoices-ameen-sync.sql")) {
  console.error("supabase/ameen-purchase-invoice-reports.sql must not require applying purchase-invoices-ameen-sync.sql first — it must be self-contained.");
  failed = true;
}

// created_by يجب أن يمنع NULL وانتحال الهوية معاً: عمود بقيمة افتراضية auth.uid()،
// وسياسة INSERT تتحقق أن created_by المُرسَل يطابق auth.uid() فعلياً.
if (!/with check \(\s*ameen_purchase_invoice_reports_is_sync_writer\(\)\s*and\s*created_by = auth\.uid\(\)\s*\)/.test(purchaseInvoiceReportsSql)) {
  console.error("ameen_purchase_invoice_reports INSERT policy must require both the sync-writer account and created_by = auth.uid().");
  failed = true;
}

// اختبارات دوال الجرد الشهري المعزولة (src/inventory-recon-calc.js) — نفس نمط poCalc أعلاه.
{
  const invRecCalcSource = readFileSync("src/inventory-recon-calc.js", "utf8");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(invRecCalcSource, sandbox, { filename: "inventory-recon-calc.js" });
  const invRecCalc = sandbox.window.invRecCalc;
  if (!invRecCalc) {
    console.error("src/inventory-recon-calc.js did not expose window.invRecCalc.");
    failed = true;
  } else {
    const assertEqual = (label, actual, expected) => {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        console.error(`invRecCalc test failed: ${label} — got ${a}, expected ${e}`);
        failed = true;
      }
    };

    assertEqual("diffOf increase", invRecCalc.diffOf(10, 12), { diffQty: 2, diffType: "increase" });
    assertEqual("diffOf decrease", invRecCalc.diffOf(10, 7), { diffQty: -3, diffType: "decrease" });
    assertEqual("diffOf match", invRecCalc.diffOf(10, 10), { diffQty: 0, diffType: "none" });
    assertEqual("diffOf empty actual", invRecCalc.diffOf(10, ""), { diffQty: 0, diffType: "none" });
    assertEqual("diffOf missing actual", invRecCalc.diffOf(10, undefined), { diffQty: 0, diffType: "none" });

    assertEqual("settlementValue increase", invRecCalc.settlementValue(2, 5), 10);
    assertEqual("settlementValue decrease", invRecCalc.settlementValue(-3, 5), -15);

    assertEqual(
      "lineComputed reason required and missing",
      invRecCalc.lineComputed({ systemQty: 10, actualQty: 7, unitCost: 5, reason: "" }),
      { diffQty: -3, diffType: "decrease", settlementValue: -15, reasonRequired: true, reasonOk: false }
    );
    assertEqual(
      "lineComputed reason required and provided",
      invRecCalc.lineComputed({ systemQty: 10, actualQty: 7, unitCost: 5, reason: "تلف" }),
      { diffQty: -3, diffType: "decrease", settlementValue: -15, reasonRequired: true, reasonOk: true }
    );
    assertEqual(
      "lineComputed matched line needs no reason",
      invRecCalc.lineComputed({ systemQty: 10, actualQty: 10, unitCost: 5, reason: "" }),
      { diffQty: 0, diffType: "none", settlementValue: 0, reasonRequired: false, reasonOk: true }
    );

    assertEqual(
      "sessionSummary aggregates gain/loss/net",
      invRecCalc.sessionSummary([
        { systemQty: 10, actualQty: 12, unitCost: 5, reason: "زيادة" },
        { systemQty: 10, actualQty: 7, unitCost: 5, reason: "نقص" },
        { systemQty: 10, actualQty: 10, unitCost: 5 }
      ]),
      { totalLines: 3, matchedCount: 1, increaseCount: 1, decreaseCount: 1, gainValue: 10, lossValue: 15, netValue: -5 }
    );

    assertEqual(
      "validateForReview flags missing reasons only",
      invRecCalc.validateForReview([
        { systemQty: 10, actualQty: 7, unitCost: 5, reason: "" },
        { systemQty: 10, actualQty: 10, unitCost: 5, reason: "" }
      ]),
      { ok: false, missingReasonCount: 1 }
    );

    assertEqual("canTransitionStatus draft->reviewed", invRecCalc.canTransitionStatus("draft", "reviewed"), true);
    assertEqual("canTransitionStatus reviewed->approved", invRecCalc.canTransitionStatus("reviewed", "approved"), true);
    assertEqual("canTransitionStatus draft->approved skip forbidden", invRecCalc.canTransitionStatus("draft", "approved"), false);
    assertEqual("canTransitionStatus approved is terminal", invRecCalc.canTransitionStatus("approved", "reviewed"), false);
    assertEqual("canTransitionStatus unknown status rejected", invRecCalc.canTransitionStatus("draft", "synced"), false);

    assertEqual("normalizeSearchText hamza/taa marbuta", invRecCalc.normalizeSearchText("أحمد الشركة"), "احمد الشركه");
    assertEqual(
      "itemMatches tolerant of hamza variants",
      invRecCalc.itemMatches({ itemName: "دخان أبو زياد" }, "ابو زياد"),
      true
    );

    assertEqual(
      "buildIdempotencyKey composes warehouse/month/nonce",
      invRecCalc.buildIdempotencyKey("jumla", "2026-08", "n1"),
      "jumla|2026-08|n1"
    );
  }
}

// عقد ربط واجهة الجرد الشهري بملف invRecCalc ومصدر Supabase الجديد.
for (const contract of [
  "window.invRecCalc.itemMatches",
  "window.invRecCalc.lineComputed",
  "window.invRecCalc.sessionSummary",
  "window.invRecCalc.canTransitionStatus",
  "window.invRecCalc.buildIdempotencyKey",
  "dataStore.createReconSessionWithLines(",
  "dataStore.setReconSessionStatus("
]) {
  if (!appJs.includes(contract)) {
    console.error(`Inventory reconciliation UI/data-layer contract is missing: ${contract}`);
    failed = true;
  }
}

// انحدار: منع الرجوع إلى مخزون النشرة العام عند غياب تقرير مخزون المستودع —
// مراجعة الجولة الثانية على PR الجرد الشهري (نقطة حاسمة). reconAddItem وreconSaveDraft
// يجب أن يعتمدا حصراً على state.reconWarehouseStockItems، لا على أي قائمة أسعار عامة.
{
  const reconAddItemMatch = appJs.match(/function reconAddItem\(key\) \{[\s\S]{0,700}?\n\}/);
  if (!reconAddItemMatch) {
    console.error("reconAddItem() function not found in src/app.js.");
    failed = true;
  } else {
    const body = reconAddItemMatch[0];
    if (!body.includes("state.reconWarehouseStockItems")) {
      console.error("reconAddItem() must build its item list from state.reconWarehouseStockItems only.");
      failed = true;
    }
    if (/state\.(priceItems|reconPriceListItems)\b/.test(body) || /itemCostFor\(.*priceItems/.test(body)) {
      console.error("reconAddItem() must not fall back to the general price-list stock.");
      failed = true;
    }
  }

  const reconSaveDraftMatch = appJs.match(/async function reconSaveDraft\(\) \{[\s\S]{0,300}/);
  if (!reconSaveDraftMatch || !reconSaveDraftMatch[0].includes("reconWarehouseStockItems")) {
    console.error("reconSaveDraft() must guard on state.reconWarehouseStockItems before allowing a save (no warehouse report = no save).");
    failed = true;
  }

  if (!appJs.includes("hasWarehouseStock")) {
    console.error("inventoryRecon() render must gate item-add UI and the save button on a hasWarehouseStock flag.");
    failed = true;
  }
}

// عقد SQL لتصليب RLS/الملكية على الجرد الشهري — مراجعة الجولة الثانية (نقطة حاسمة):
// created_by غير قابل للانتحال، الاعتماد محصور بالمالك، سجل التدقيق trigger-only.
{
  const invReconSql = readFileSync("supabase/inventory-reconciliation-table.sql", "utf8");
  for (const contract of [
    "inventory_recon_is_owner()",
    "created_by     uuid          references auth.users(id)",
    "created_by لا يمكن تعديله بعد الإنشاء",
    "اعتماد الجلسة محصور بحساب المالك",
    "بلا كمية فعلية أو سبب أو تكلفة معروفة لفرق غير صفري",
    "security definer set search_path = public",
    "created_by = auth.uid()"
  ]) {
    if (!invReconSql.includes(contract)) {
      console.error(`inventory-reconciliation-table.sql SQL contract is missing: ${contract}`);
      failed = true;
    }
  }
  if (/create policy "authenticated can insert inventory_recon_audit_log"/.test(invReconSql)) {
    console.error("inventory-reconciliation-table.sql must not allow direct client INSERT into inventory_recon_audit_log — trigger-only.");
    failed = true;
  }
}

// عقد SQL — مراجعة الجولة الثالثة (3 نقاط حاسمة): سجل التدقيق بلا FK (وإلا يفشل
// الحذف ويُمحى التاريخ بالـcascade)، اعتماد جلسة بلا سطور مرفوض، كتابة السطور
// محصورة بحالة draft فقط، GRANT صريحة، سحب EXECUTE من دالة SECURITY DEFINER،
// وRPC ذرية لإنشاء الجلسة مع سطورها.
{
  const invReconSql = readFileSync("supabase/inventory-reconciliation-table.sql", "utf8");
  if (/session_id\s+uuid\s+references inventory_recon_sessions/.test(invReconSql)) {
    console.error("inventory_recon_audit_log.session_id must not carry a foreign key — deleting a session would then either fail (trigger insert after delete) or cascade-erase the audit trail.");
    failed = true;
  }
  if (/line_id\s+uuid\s+references inventory_recon_lines/.test(invReconSql)) {
    console.error("inventory_recon_audit_log.line_id must not carry a foreign key, for the same reason as session_id.");
    failed = true;
  }
  for (const contract of [
    "لا يمكن اعتماد جلسة بلا أي سطر",
    "s.status = 'draft'",
    "grant select, insert, update, delete on inventory_recon_sessions to authenticated",
    "grant select, insert, update, delete on inventory_recon_lines to authenticated",
    "revoke execute on function private.inventory_recon_write_audit_log() from public",
    "create or replace function inventory_recon_create_session_with_lines",
    "raise exception 'inventory_recon: لا يمكن إنشاء جلسة جرد بلا سطور'"
  ]) {
    if (!invReconSql.includes(contract)) {
      console.error(`inventory-reconciliation-table.sql SQL contract (round 3) is missing: ${contract}`);
      failed = true;
    }
  }
  if (/s\.status\s*<>\s*'approved'/.test(invReconSql.split("inventory_recon_lines_write")[1] || "")) {
    console.error("inventory_recon_lines_write policy must gate on status = 'draft', not <> 'approved' — lines must lock as soon as a session leaves draft.");
    failed = true;
  }
}

// انحدار: إنشاء الجلسة وحفظ سطورها يجب أن يمرّا عبر نداء ذرّي واحد (RPC) لا
// طلبين منفصلين — وإلا يترك انقطاع الشبكة بين الطلبين جلسة فارغة بلا سطور.
{
  if (!appJs.includes("createReconSessionWithLines")) {
    console.error("reconSaveDraft() must call dataStore.createReconSessionWithLines(...) — a single atomic call, not separate createReconSession/saveReconLines requests.");
    failed = true;
  }
  if (/dataStore\.createReconSession\(/.test(appJs) || /dataStore\.saveReconLines\(/.test(appJs)) {
    console.error("src/app.js must not call the old separate createReconSession/saveReconLines methods anymore.");
    failed = true;
  }
  const supabaseClientJs = readFileSync("src/supabase-client.js", "utf8");
  if (!/client\.rpc\(\s*["']inventory_recon_create_session_with_lines["']/.test(supabaseClientJs)) {
    console.error("src/supabase-client.js must call the inventory_recon_create_session_with_lines RPC for atomic session+lines creation.");
    failed = true;
  }
}

// عقد SQL — مراجعة الجولة الرابعة (4 نقاط حاسمة): الخادم يشتق system_qty/unit_cost/
// هوية الصنف من تقرير inventory_reports موثوق لا من المتصفح، idempotency محصور
// بـcreated_by مع تحقق تعارض المحتوى، تصليب صلاحيات RPC الرئيسية + نقل دالة التدقيق
// لمخطط private، وقيود CHECK تمنع قيماً سالبة/عملة غير مسموحة/مفتاح أو اسم فارغ.
{
  const invReconSql = readFileSync("supabase/inventory-reconciliation-table.sql", "utf8");
  for (const contract of [
    "source_report_id",
    "source_report_date",
    "unique (created_by, idempotency_key)",
    "and source = 'ameen_warehouse_stock'",
    "تقرير المخزون المحدد لا يطابق المستودع المختار",
    "الأصناف التالية غير موجودة في تقرير المستودع الموثوق",
    "مفتاح idempotency % مستخدم مسبقاً لجلسة مختلفة",
    "مفتاح idempotency % مستخدم مسبقاً بمحتوى سطور مختلف",
    "create schema if not exists private;",
    "create or replace function private.inventory_recon_write_audit_log()",
    "execute function private.inventory_recon_write_audit_log();",
    "revoke execute on function inventory_recon_create_session_with_lines(date, date, text, text, text, text, uuid, jsonb) from public",
    "revoke execute on function inventory_recon_create_session_with_lines(date, date, text, text, text, text, uuid, jsonb) from anon",
    "grant execute on function inventory_recon_create_session_with_lines(date, date, text, text, text, text, uuid, jsonb) to authenticated",
    "check (trim(item_key) <> '')",
    "check (trim(item_name) <> '')",
    "check (actual_qty is null or actual_qty >= 0)",
    "check (unit_cost is null or unit_cost >= 0)"
  ]) {
    if (!invReconSql.includes(contract)) {
      console.error(`inventory-reconciliation-table.sql SQL contract (round 4) is missing: ${contract}`);
      failed = true;
    }
  }
  if (/create (or replace )?function inventory_recon_write_audit_log\(\)/.test(invReconSql)) {
    console.error("inventory_recon_write_audit_log() must be defined inside the private schema, not public — plain function name (unqualified) must not remain.");
    failed = true;
  }
}

// انحدار: العميل لا يرسل system_qty/unit_cost/item_number/item_name/unit_name/currency
// كقيم موثوقة إلى الـRPC — الخادم يشتقّها من تقرير المخزون الموثوق. src/supabase-client.js
// يمرّر source_report_id ويبني سطوراً مختزلة فقط (item_key/actual_qty/reason).
{
  const supabaseClientJs = readFileSync("src/supabase-client.js", "utf8");
  const createReconMatch = supabaseClientJs.match(/async createReconSessionWithLines\(input, lines\) \{[\s\S]*?\n    \},/);
  if (!createReconMatch) {
    console.error("src/supabase-client.js: createReconSessionWithLines(input, lines) not found.");
    failed = true;
  } else {
    const body = createReconMatch[0];
    if (!/p_source_report_id:\s*input\.sourceReportId/.test(body)) {
      console.error("createReconSessionWithLines must pass p_source_report_id: input.sourceReportId to the RPC.");
      failed = true;
    }
    for (const clientTrustedField of ["item_number:", "item_name:", "unit_name:", "system_qty:", "unit_cost:", "currency:"]) {
      if (body.includes(clientTrustedField)) {
        console.error(`createReconSessionWithLines must not send client-supplied "${clientTrustedField}" to the RPC — the server derives it from the trusted inventory_reports row.`);
        failed = true;
      }
    }
  }
  if (!/\.select\(\s*["']id, summary, items, created_at["']\s*\)/.test(supabaseClientJs)) {
    console.error("getLatestWarehouseStockReport must select the report's id (needed as source_report_id) alongside summary/items/created_at.");
    failed = true;
  }
}

// انحدار: src/app.js يلتقط id تقرير مخزون المستودع ويمرره كـsourceReportId، ويرفض
// الحفظ إن لم يتوفر تقرير موثوق (لا يُنشئ جلسة بلا مصدر موثوق).
{
  if (!/state\.reconWarehouseStockReportId\s*=\s*report\.id/.test(appJs)) {
    console.error("loadReconWarehouseStock() must capture the trusted report's id into state.reconWarehouseStockReportId.");
    failed = true;
  }
  if (!/sourceReportId:\s*state\.reconWarehouseStockReportId/.test(appJs)) {
    console.error("reconSaveDraft() must pass sourceReportId: state.reconWarehouseStockReportId to dataStore.createReconSessionWithLines(...).");
    failed = true;
  }
  if (!/if \(!state\.reconWarehouseStockReportId\) \{/.test(appJs)) {
    console.error("reconSaveDraft() must guard on state.reconWarehouseStockReportId before allowing a save.");
    failed = true;
  }
}

// عقد SQL — مراجعة الجولة الخامسة (موانع دمج): unit_cost/currency/settlement_value
// محجوبة عن غير المالك عبر RLS owner-only + RPC مقنَّعة، مطابقة التكلفة بـitem_guid
// لا بالاسم، رفض item_key فارغ، تحقق عدد السطور المُدرجة، وسباق idempotency عبر
// ON CONFLICT ذرّي بدل SELECT ثم INSERT منفصلين.
{
  const invReconSql = readFileSync("supabase/inventory-reconciliation-table.sql", "utf8");
  for (const contract of [
    "using (inventory_recon_is_owner())",
    "create or replace function inventory_recon_lines_for_session(p_session_id uuid)",
    "revoke execute on function inventory_recon_lines_for_session(uuid) from public",
    "revoke execute on function inventory_recon_lines_for_session(uuid) from anon",
    "grant execute on function inventory_recon_lines_for_session(uuid) to authenticated",
    "raise exception 'inventory_recon: % سطر بمفتاح صنف فارغ",
    "on conflict (created_by, idempotency_key) do nothing",
    "raise exception 'inventory_recon: عدد السطور المُدرجة (%) لا يطابق عدد الأصناف المطلوبة"
  ]) {
    if (!invReconSql.includes(contract)) {
      console.error(`inventory-reconciliation-table.sql SQL contract (round 5) is missing: ${contract}`);
      failed = true;
    }
  }
  if (/create policy "inventory_recon_lines_select"[\s\S]{0,80}using \(true\)/.test(invReconSql)) {
    console.error("inventory_recon_lines_select must no longer be using(true) — cost columns (unit_cost/currency/settlement_value) must be owner-only, masked for everyone else via inventory_recon_lines_for_session().");
    failed = true;
  }
  if (!/where ic1\.item_guid = coalesce\(it ->> 'itemGuid', it ->> 'item_guid'\)/.test(invReconSql)) {
    console.error("inventory_recon_create_session_with_lines must match item_costs by item_guid (matching push-item-costs.ps1's GUID/code/name priority), not by item_name alone with LIMIT 1.");
    failed = true;
  }

  const supabaseClientJs = readFileSync("src/supabase-client.js", "utf8");
  if (!/client\.rpc\(\s*["']inventory_recon_lines_for_session["']/.test(supabaseClientJs)) {
    console.error("getReconSession() must fetch lines via the inventory_recon_lines_for_session RPC, not a direct .from(reconLinesTable) select — the owner-only RLS policy would otherwise return an empty line list to non-owner session creators.");
    failed = true;
  }

  // الجولة السادسة: سجل التدقيق يخزّن نسخة كاملة من السطر (unit_cost/currency
  // ضمناً) عبر to_jsonb(NEW) — using(true) على قراءته يسرّب التكلفة لكل
  // authenticated رغم إخفائها في القراءة المقنَّعة. والدالة create_session_with_lines
  // يجب أن تكون SECURITY DEFINER وإلا يفشل موظف غير مالك بقراءة item_costs (تكلفة
  // NULL دائماً) وinventory_recon_lines (فشل تكرار idempotency) بسبب RLS owner-only.
  for (const contract of [
    'create policy "inventory_recon_audit_log_select"',
    "using (inventory_recon_is_owner())"
  ]) {
    if (!invReconSql.includes(contract)) {
      console.error(`inventory-reconciliation-table.sql SQL contract (round 6) is missing: ${contract}`);
      failed = true;
    }
  }
  if (/create policy "inventory_recon_audit_log_select"[\s\S]{0,80}using \(true\)/.test(invReconSql)) {
    console.error("inventory_recon_audit_log_select must no longer be using(true) — audit rows carry full before/after_data including unit_cost/currency, must be owner-only.");
    failed = true;
  }
  if (!/create or replace function inventory_recon_create_session_with_lines[\s\S]{0,400}security definer/.test(invReconSql)) {
    console.error("inventory_recon_create_session_with_lines must be SECURITY DEFINER — as SECURITY INVOKER, a non-owner caller cannot read item_costs or inventory_recon_lines under owner-only RLS, permanently losing cost data and breaking idempotency retries.");
    failed = true;
  }

  // الجولة السابعة: تشديد الدالتين SECURITY DEFINER — search_path فارغ بدل
  // "public" (لا اسم مخطط ثابت قابل للاعتراض)، ورفض صريح لـauth.uid() null
  // بدل الاعتماد الضمني فقط على revoke execute from anon.
  const linesForSessionBlock = (invReconSql.split("create or replace function inventory_recon_lines_for_session")[1] || "").slice(0, 1600);
  if (!/security definer\s*\nset search_path = ''/.test(linesForSessionBlock)) {
    console.error("inventory_recon_lines_for_session must use SET search_path = '' (empty), not a named schema — Supabase best practice for SECURITY DEFINER functions to prevent search_path hijacking.");
    failed = true;
  }
  if (!/auth\.uid\(\) is null/.test(linesForSessionBlock)) {
    console.error("inventory_recon_lines_for_session must explicitly reject auth.uid() is null before touching session/line data.");
    failed = true;
  }

  const createSessionBlock = (invReconSql.split("create or replace function inventory_recon_create_session_with_lines")[1] || "").slice(0, 6000);
  if (!/security definer\s*\nset search_path = ''/.test(createSessionBlock)) {
    console.error("inventory_recon_create_session_with_lines must use SET search_path = '' (empty), not a named schema — Supabase best practice for SECURITY DEFINER functions to prevent search_path hijacking.");
    failed = true;
  }
  if (!/auth\.uid\(\) is null/.test(createSessionBlock)) {
    console.error("inventory_recon_create_session_with_lines must explicitly reject auth.uid() is null before creating a session.");
    failed = true;
  }
  if (/[^.]\bfrom inventory_recon_lines\b|[^.]\bfrom inventory_recon_sessions\b|[^.]\bfrom inventory_reports\b|[^.]\bfrom item_costs\b|[^.]\binsert into inventory_recon_lines\b|[^.]\binsert into inventory_recon_sessions\b/.test(createSessionBlock)) {
    console.error("inventory_recon_create_session_with_lines must fully qualify every relation with the public. prefix (search_path is now empty, so unqualified names would fail to resolve or silently resolve to the wrong schema).");
    failed = true;
  }
}

// اختبار حارس RLS الصامت في setReconSessionStatus (src/supabase-client.js): التحديث
// مشروط بـ.eq("status", expectedStatus) — إن حجبت RLS الصف (0 نتيجة) يجب رمي خطأ
// صريح بدل اعتبارها نجاحاً وهمياً. نبني عميل Supabase وهمياً بدل الاتصال الحقيقي.
{
  const supabaseClientSource = readFileSync("src/supabase-client.js", "utf8");

  function makeMockClient(updateResult) {
    return {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "u1", email: "owner@ozk.test" } } }, error: null }),
        getUser: async () => ({ data: { user: { id: "u1", email: "owner@ozk.test" } }, error: null })
      },
      from() {
        const builder = {
          update() { return builder; },
          eq() { return builder; },
          select: async () => updateResult
        };
        return builder;
      }
    };
  }

  async function runSetReconSessionStatus(updateResult) {
    const sandbox = {
      window: {
        appConfig: { supabase: { url: "https://x.test", publishableKey: "key" } },
        supabase: { createClient: () => makeMockClient(updateResult) },
        invRecCalc: sandbox_invRecCalc
      },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      console
    };
    vm.createContext(sandbox);
    vm.runInContext(supabaseClientSource, sandbox, { filename: "supabase-client.js" });
    return sandbox.window.tobaccoData.setReconSessionStatus("s1", "reviewed", "draft");
  }

  const invRecCalcSourceForGuard = readFileSync("src/inventory-recon-calc.js", "utf8");
  const guardSandbox = { window: {}, console };
  vm.createContext(guardSandbox);
  vm.runInContext(invRecCalcSourceForGuard, guardSandbox, { filename: "inventory-recon-calc.js" });
  const sandbox_invRecCalc = guardSandbox.window.invRecCalc;

  let succeeded = false;
  try {
    await runSetReconSessionStatus({ data: [{ id: "s1" }], error: null });
    succeeded = true;
  } catch (err) {
    console.error(`setReconSessionStatus should succeed when the guarded row matches: ${err.message}`);
    failed = true;
  }
  if (!succeeded) failed = true;

  let blocked = false;
  try {
    await runSetReconSessionStatus({ data: [], error: null });
  } catch {
    blocked = true;
  }
  if (!blocked) {
    console.error("setReconSessionStatus must throw when the status-guarded update matches zero rows (silent RLS block) instead of succeeding silently.");
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("Project check passed.");
