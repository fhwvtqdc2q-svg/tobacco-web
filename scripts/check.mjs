import { existsSync, readFileSync } from "node:fs";

const required = [
  "index.html",
  "src/app.js",
  "src/config.js",
  "src/supabase-client.js",
  "src/number-normalizer.js",
  "src/styles.css",
  "public/manifest.webmanifest",
  "public/service-worker.js",
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

if (failed) {
  process.exit(1);
}

console.log("Project check passed.");
