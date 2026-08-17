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
  "AI_ACTIVE_TASK.json",
  "supabase/functions/financial-assistant/index.ts",
  "supabase/ameen-account-balance-reports.sql",
  "tools/push-ameen-account-balances.ps1",
  "tools/register-account-balances-task.ps1"
];

let failed = false;

for (const file of required) {
  if (!existsSync(file)) {
    console.error(`Missing: ${file}`);
    failed = true;
  }
}

// Ameen Live must remain a browser-triggered, read-only inventory overlay.
{
  const snapshotSource = readFileSync("src/business-snapshot.js", "utf8");
  const commandSource = readFileSync("src/command-center.js", "utf8");
  const gatewaySource = readFileSync("tools/ameen-read-gateway.ps1", "utf8");
  const now = new Date().toISOString();
  const context = vm.createContext({
    window: {
      ozkAmeenLiveCache: {
        updatedAt: now,
        stock: { asOf: now, rowCount: 2, rows: [
          { item_number: "1", item_guid: "g-1", item_name: "نفد فعلي", stock_qty: 0, stock_qty_net: 0, stock_qty_positive: 0, group_name: null, unit1_name: "علبة", unit2_name: "كرتونة", unit2_factor: 10 },
          { item_number: "2", item_guid: "g-2", item_name: "متوفر", stock_qty: 7, stock_qty_net: 7, stock_qty_positive: 7, group_name: null, unit1_name: "علبة", unit2_name: "كرتونة", unit2_factor: 10 }
        ] },
        customers: { asOf: now, rowCount: 293, rows: [{ customer_name: "مرجع" }] }
      }
    },
    console,
    Date,
    Number,
    String,
    Math,
    Object,
    Array,
    Map,
    Promise,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(snapshotSource, context);
  const liveSnapshot = await context.window.ozkBusinessOS.getSnapshot();
  if (liveSnapshot.inventory.meta.source !== "ameen_live.stock" || liveSnapshot.inventory.itemCount !== 2 || liveSnapshot.inventory.outOfStockCount !== 1) {
    console.error("Business Snapshot must prefer a fresh Ameen Live stock response and calculate counts from its actual rows.");
    failed = true;
  }
  if (liveSnapshot.customerReference.customerCount !== 293 || liveSnapshot.receivables.meta.source === "ameen_live.customers") {
    console.error("Ameen Live customers must remain reference-only and must not replace the trusted receivables source.");
    failed = true;
  }
  for (const contract of ["بحاجة مراجعة شراء", "friendlyAmeenError", "Promise.all([window.ozkAmeenLive.health()", "آخر قراءة حية", "الأمين مباشر: متصل"]) {
    if (!commandSource.includes(contract)) {
      console.error(`Command Center Ameen Live contract is missing: ${contract}`);
      failed = true;
    }
  }
  if (!gatewaySource.includes('Assert-ReadOnlySql') || !gatewaySource.includes('ValidateSet("health","stock","customers")')) {
    console.error("Ameen Live gateway must retain its SELECT-only guard and fixed resource allow-list.");
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
const customerInvoicesPush = readFileSync("tools/push-customer-invoices.ps1", "utf8");
const purchaseInvoicesPull = readFileSync("tools/pull-purchase-invoices-from-ameen.ps1", "utf8");
const purchaseInvoicesTask = readFileSync("tools/register-purchase-invoices-pull-task.ps1", "utf8");
const customerInvoicesVerify = readFileSync("tools/verify-customer-invoice-sync.ps1", "utf8");
const financialAssistant = readFileSync("supabase/functions/financial-assistant/index.ts", "utf8");
const accountBalancesSql = readFileSync("supabase/ameen-account-balance-reports.sql", "utf8");
const accountBalancesPush = readFileSync("tools/push-ameen-account-balances.ps1", "utf8");

for (const contract of [
  "askFinancialAssistant",
  "/functions/v1/financial-assistant",
  "قراءة فقط من الأمين"
]) {
  if (!app.includes(contract) && !readFileSync("src/supabase-client.js", "utf8").includes(contract)) {
    console.error(`Financial assistant client contract is missing: ${contract}`);
    failed = true;
  }
}
for (const forbidden of ["sessionStorage", "anthropic-dangerous-direct-browser-access", "api.openai.com/v1/chat/completions"]) {
  if (app.includes(forbidden)) {
    console.error(`Browser-side AI secret contract must be removed: ${forbidden}`);
    failed = true;
  }
}
for (const contract of ["requireStaff", "SUPABASE_SERVICE_ROLE_KEY", "ameen_account_balance_reports", "externalDataShared: false"]) {
  if (!financialAssistant.includes(contract)) {
    console.error(`Financial assistant server contract is missing: ${contract}`);
    failed = true;
  }
}
for (const forbidden of ["api.openai.com", "api.anthropic.com", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  if (financialAssistant.includes(forbidden)) {
    console.error(`Financial data must not leave Supabase without explicit approval: ${forbidden}`);
    failed = true;
  }
}
for (const contract of ["enable row level security", "public.is_staff()", "ameen_account_balance_reports_is_sync_writer", "revoke all"]) {
  if (!accountBalancesSql.includes(contract)) {
    console.error(`Account-balance RLS contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of ["AMEEN_SQL_CONNECTION_STRING", "FROM dbo.ac000", "Debit, 0) - COALESCE(a.Credit", "ameen_account_balance_reports"]) {
  if (!accountBalancesPush.includes(contract)) {
    console.error(`Read-only Ameen account synchronization contract is missing: ${contract}`);
    failed = true;
  }
}
if (/\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?)\b/i.test(accountBalancesPush.split('$sql = @"')[1]?.split('"@')[0] || "")) {
  console.error("Ameen account synchronization SQL must remain SELECT-only.");
  failed = true;
}

// فواتير المبيعات والمشتريات لها مسارات قائمة يقرأها التطبيق فعلياً. منع إعادة
// إدخال سكربتات snapshot جزئية أو جدول مبيعات ثالث غير مستخدم.
for (const obsolete of [
  "tools/sync-sales-invoices-enhanced.ps1",
  "tools/sync-purchase-invoices-enhanced.ps1"
]) {
  if (existsSync(obsolete)) {
    console.error(`Obsolete invoice sync script must not be restored: ${obsolete}`);
    failed = true;
  }
}
for (const contract of [
  'source      = "ameen_customer_invoices"',
  'rest/v1/inventory_reports',
  'bt.BillType IN (1, 3)'
]) {
  if (!customerInvoicesPush.includes(contract)) {
    console.error(`Customer-invoice synchronization contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of [
  'rest/v1/ameen_purchase_invoice_reports',
  '91377a56-ebfc-48c0-b79e-72063e1d7e3a',
  'c9aca8fe-f50e-46eb-91ac-29ee32acbb3e'
]) {
  if (!purchaseInvoicesPull.includes(contract)) {
    console.error(`Purchase-invoice synchronization contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of [
  '"TOBACCO Purchase Invoices Pull"',
  'pull-purchase-invoices-from-ameen.ps1',
  '-MultipleInstances IgnoreNew',
  '-PeriodDays $PeriodDays'
]) {
  if (!purchaseInvoicesTask.includes(contract)) {
    console.error(`Purchase-invoice scheduled-task contract is missing: ${contract}`);
    failed = true;
  }
}
for (const contract of [
  "missingInSupabase",
  "extraInSupabase",
  "duplicateGuidsInReport",
  "source=eq.ameen_customer_invoices",
  "exit 2"
]) {
  if (!customerInvoicesVerify.includes(contract)) {
    console.error(`Customer-invoice reconciliation contract is missing: ${contract}`);
    failed = true;
  }
}
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

// أصناف الدمج الإداري يجب ألا تظهر أكثر من سطر واحد في كل نشرة حتى لو كانت
// aliases القديمة تحمل أسعاراً مختلفة قبل أن يوحّدها الحفظ التالي من الموقع.
// غياب السطر تماماً (صفر) حالة مشروعة: يعني عدم توفر أي alias مؤهل بسعر صالح
// في هذا الوضع حالياً (مثلاً نفاد كرتونة كاملة من الجملة) وليس خللاً بالدمج —
// الخلل الذي يحرسه هذا الفحص هو تكرار السطر (٢+) لا غيابه.
for (const [label, bulletin] of [["USD", usdBulletin], ["SYP", sypBulletin]]) {
  for (const name of ["ماستر طويل ورق", "ماستر قصير أزرق"]) {
    const count = bulletin.split(name).length - 1;
    if (count > 1) {
      console.error(`${label} bulletin must contain at most one merged row for ${name}; found ${count}.`);
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
if (/state\.invCustomer = e\.currentTarget\.value;\s*render\(\);/.test(appJ…16473 tokens truncated…  let blockedOtherUserDelete = false;
  try {
    simulateDeleteDraft({ callerUid: "other-uid", callerEmail: "other@ozk.test", session: draftSession });
  } catch {
    blockedOtherUserDelete = true;
  }
  if (!blockedOtherUserDelete) {
    console.error("Behavioral: a user who is neither the draft's creator nor the owner must not be able to delete someone else's draft.");
    failed = true;
  }

  let blockedReviewedDelete = false;
  try {
    simulateDeleteDraft({ callerUid: "owner-uid", callerEmail: OWNER_EMAIL, session: reviewedSession });
  } catch {
    blockedReviewedDelete = true;
  }
  if (!blockedReviewedDelete) {
    console.error("Behavioral: a reviewed session must never be deletable, even by the owner.");
    failed = true;
  }

  const approvedSession = { id: "s1", status: "approved", created_by: "creator-uid" };
  let blockedApprovedDelete = false;
  try {
    simulateDeleteDraft({ callerUid: "owner-uid", callerEmail: OWNER_EMAIL, session: approvedSession });
  } catch {
    blockedApprovedDelete = true;
  }
  if (!blockedApprovedDelete) {
    console.error("Behavioral: an approved session must never be deletable, even by the owner.");
    failed = true;
  }

  // نتأكد أن الملف SQL فعلاً ينفّذ نفس شروط التفويض التي حاكيناها أعلاه — لا
  // تعتمد على RLS وحدها بما أن الدوال SECURITY DEFINER.
  const deleteDraftBlock = (invReconSql.split("create or replace function inventory_recon_delete_draft")[1] || "").slice(0, 2500);
  if (!deleteDraftBlock) {
    console.error("supabase/inventory-reconciliation-table.sql is missing inventory_recon_delete_draft RPC.");
    failed = true;
  } else {
    if (!/for update/.test(deleteDraftBlock)) {
      console.error("inventory_recon_delete_draft must lock the session row with FOR UPDATE before deleting.");
      failed = true;
    }
    if (!/status\s*<>\s*'draft'|status\s*!=\s*'draft'/.test(deleteDraftBlock) && !/if\s+v_status\s*<>\s*'draft'/i.test(deleteDraftBlock)) {
      console.error("inventory_recon_delete_draft must reject deletion unless the session status is 'draft'.");
      failed = true;
    }
    if (!/security definer\s*\nset search_path = ''/.test(deleteDraftBlock)) {
      console.error("inventory_recon_delete_draft must use SECURITY DEFINER with SET search_path = '' (empty).");
      failed = true;
    }
  }
  if (!/revoke execute on function inventory_recon_delete_draft\(uuid\) from public/.test(invReconSql)
      || !/revoke execute on function inventory_recon_delete_draft\(uuid\) from anon/.test(invReconSql)
      || !/grant execute on function inventory_recon_delete_draft\(uuid\) to authenticated/.test(invReconSql)) {
    console.error("inventory_recon_delete_draft must be revoked from public/anon and granted only to authenticated.");
    failed = true;
  }

  const supabaseClientSourceForDelete = readFileSync("src/supabase-client.js", "utf8");
  if (!/client\.rpc\(\s*["']inventory_recon_delete_draft["']/.test(supabaseClientSourceForDelete)) {
    console.error("src/supabase-client.js must expose a deleteReconDraft(...) wrapper calling the inventory_recon_delete_draft RPC.");
    failed = true;
  }

  if (!/data-action="recon-delete"/.test(appJs)) {
    console.error("src/app.js must render a delete button (data-action=\"recon-delete\") for draft sessions.");
    failed = true;
  }
  if (!/async function reconDeleteDraft\(session\) \{[\s\S]{0,200}confirm\(/.test(appJs)) {
    console.error("reconDeleteDraft() must ask for user confirmation via confirm(...) before deleting.");
    failed = true;
  }
}

// ── الجرد الشهري: مستودعات ديناميكية من الأمين (لا "جملة"/"مركز" ثابتة) ────────
{
  const appJsForWarehouses = readFileSync("src/app.js", "utf8");

  // (a) امنع رجوع خياري "جملة"/"مركز" الثابتين داخل منطقة اختيار مستودع الجرد
  // تحديداً — لا نمنع النص بكامل الملف لأن "jumla" تُستخدم بمعنى مختلف تماماً
  // بميزات أخرى (وضع البيع jumla/mufrak، وسلسلة فواتير المبيعات بالأمين).
  const warehouseUiMatch = appJsForWarehouses.match(
    /const warehouseButtonsHtml[\s\S]{0,700}/
  );
  if (!warehouseUiMatch) {
    console.error("Could not locate the recon warehouse-buttons render block in src/app.js.");
    failed = true;
  } else {
    const warehouseUiRegion = warehouseUiMatch[0];
    if (/["'`](جملة|مركز|jumla|markaz)["'`]/i.test(warehouseUiRegion)) {
      console.error("Recon warehouse selector must not contain hardcoded جملة/مركز (jumla/markaz) options — warehouses must come from state.reconWarehouses only.");
      failed = true;
    }
    if (!/state\.reconWarehouses\.map/.test(warehouseUiRegion)) {
      console.error("Recon warehouse selector must render from state.reconWarehouses (dynamic list), not a static list.");
      failed = true;
    }
  }

  // (b) المفتاح الموثوق لاختيار المستودع هو GUID، وليس اسماً مخترَعاً
  if (!/data-recon-warehouse="\$\{escapeHtml\(w\.warehouseKey\)\}"/.test(appJsForWarehouses)) {
    console.error("Recon warehouse buttons must key off w.warehouseKey (Ameen st000 GUID), not an invented sale-type label.");
    failed = true;
  }
  if (!/async function loadReconWarehouses\(\)/.test(appJsForWarehouses)
      || !/dataStore\.listReconWarehouses/.test(appJsForWarehouses)) {
    console.error("src/app.js must load real warehouses via dataStore.listReconWarehouses() (Ameen-derived), not a hardcoded array.");
    failed = true;
  }

  const supabaseClientForWarehouses = readFileSync("src/supabase-client.js", "utf8");
  if (!/async listReconWarehouses\(\)/.test(supabaseClientForWarehouses)
      || !/\.from\(warehouseStockReportsTable\)/.test(supabaseClientForWarehouses)) {
    console.error("supabase-client.js listReconWarehouses() must derive warehouses from the dedicated ameen_warehouse_stock_reports table, not a static list.");
    failed = true;
  }
  if (!/warehouseKey:\s*key,\s*warehouseName:\s*name/.test(supabaseClientForWarehouses.replace(/\s+/g, " "))) {
    console.error("listReconWarehouses() must expose {warehouseKey, warehouseName} pairs sourced from each report's summary (GUID + display name).");
    failed = true;
  }

  // (c) تقرير مستقل لكل مستودع فعلي — لا دمج كل المستودعات بتقرير واحد
  const warehouseStockScript = readFileSync("tools/push-ameen-warehouse-stock.ps1", "utf8");
  if (!/foreach\s*\(\$s in \$stores\)\s*\{[\s\S]{0,600}ameen_warehouse_stock_reports/.test(warehouseStockScript)) {
    console.error("push-ameen-warehouse-stock.ps1 must POST one ameen_warehouse_stock_reports row per warehouse inside its foreach($s in $stores) loop.");
    failed = true;
  }
  if (!/warehouseKey\s*=\s*\$s\.guid/.test(warehouseStockScript)
      || !/warehouseName\s*=\s*\$s\.name/.test(warehouseStockScript)) {
    console.error("push-ameen-warehouse-stock.ps1 must tag each report's summary with warehouseKey (GUID) and warehouseName.");
    failed = true;
  }
  const warehouseStockCodeLines = warehouseStockScript
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  if (/["'](جملة|مركز عام|jumla|markaz)["']/i.test(warehouseStockCodeLines)) {
    console.error("push-ameen-warehouse-stock.ps1 must not invent a جملة/مركز warehouse — only real dbo.st000 rows.");
    failed = true;
  }

  // (c2) مراجعة Codex على PR #40: مادتان مختلفتان بالأمين قد تتطابقان بعد
  // Normalize-ItemName (فرق علامات ترقيم فقط) فتنتجان itemKey واحداً — الواجهة تُخفي
  // إحداهما (تصفية "already" على itemKey)، وقيد unique(session_id, item_key) بالجرد
  // الفعلي يمنع حفظ كليهما بجلسة واحدة. يجب تمييز أي مجموعة متصادمة بمفتاح فريد
  // مشتق من itemGuid (لا يتصادم أبداً) قبل الرفع.
  if (!/Group-Object\s+-Property\s+itemKey/.test(warehouseStockScript)) {
    console.error("push-ameen-warehouse-stock.ps1 must detect itemKey collisions per store (Group-Object -Property itemKey) before uploading.");
    failed = true;
  }
  if (!/\$it\.itemKey\s*=\s*"\$\(\$it\.itemKey\)_\$guidSuffix"/.test(warehouseStockScript)) {
    console.error("push-ameen-warehouse-stock.ps1 must namespace colliding itemKey values with a suffix derived from itemGuid.");
    failed = true;
  }

  // (d) قراءة فقط من الأمين — بلا أي تعديل على المخزون أو الأسعار أو الحسابات
  const sqlBlockMatch = warehouseStockScript.match(/\$sql = @'([\s\S]*?)'@/);
  const ameenSqlBody = sqlBlockMatch ? sqlBlockMatch[1] : warehouseStockScript;
  if (/\b(insert\s+into|update\s+dbo|delete\s+from|merge\s+into|exec\s)/i.test(ameenSqlBody)) {
    console.error("push-ameen-warehouse-stock.ps1's Ameen SQL must be strictly read-only (SELECT only) — no INSERT/UPDATE/DELETE/MERGE/EXEC.");
    failed = true;
  }
  if (!/^\s*with per_store as/i.test(ameenSqlBody.trim()) && !/^\s*select/i.test(ameenSqlBody.trim())) {
    console.error("push-ameen-warehouse-stock.ps1's Ameen SQL must start with a read-only SELECT/CTE.");
    failed = true;
  }

  // ملف push-inventory-reconciliation-to-ameen.ps1 يجب أن يبقى مقفلاً — لا كتابة فعلية على الأمين
  const pushToAmeenPath = "tools/push-inventory-reconciliation-to-ameen.ps1";
  if (existsSync(pushToAmeenPath)) {
    const pushToAmeenScript = readFileSync(pushToAmeenPath, "utf8");
    if (!/exit\s+1/.test(pushToAmeenScript)) {
      console.error(`${pushToAmeenPath} must remain a locked/disabled stub (exit 1) — inventory reconciliation must never write back to Ameen.`);
      failed = true;
    }
  }

  // (e) مراجعة Codex على PR #40، مانع 1: source='ameen_warehouse_stock' وحده
  // لا يكفي — يجب التحقق من created_by المخزَّن فعلياً بالصف، عبر auth.users،
  // وليس عبر أي قيمة يرسلها العميل.
  const invReconSqlForTrust = readFileSync("supabase/inventory-reconciliation-table.sql", "utf8");
  if (!/create or replace function inventory_recon_warehouse_stock_report_is_trusted\(p_created_by uuid\)/.test(invReconSqlForTrust)) {
    console.error("inventory-reconciliation-table.sql is missing inventory_recon_warehouse_stock_report_is_trusted(uuid) — the source report's created_by must be verified against the trusted sync account, not trusted from source= alone.");
    failed = true;
  }
  if (!/p_created_by\s*=\s*'9724dbe4-ecb0-49f7-a6b4-12f7f73c68f3'::uuid/.test(invReconSqlForTrust)
      || invReconSqlForTrust.includes("REPLACE_WITH_SYNC_ACCOUNT_EMAIL")) {
    console.error("inventory_recon_warehouse_stock_report_is_trusted() must compare created_by with the committed sync-account UUID and contain no placeholder.");
    failed = true;
  }
  const createSessionBodyForTrust = (invReconSqlForTrust.split("create or replace function inventory_recon_create_session_with_lines")[1] || "").slice(0, 6000);
  if (!/into v_report_date, v_report_summary, v_report_items, v_report_created_by, v_report_created_at/.test(createSessionBodyForTrust)) {
    console.error("inventory_recon_create_session_with_lines must select created_by/created_at from inventory_reports, not just report_date/summary/items.");
    failed = true;
  }
  if (!/if not public\.inventory_recon_warehouse_stock_report_is_trusted\(v_report_created_by\) then/.test(createSessionBodyForTrust)) {
    console.error("inventory_recon_create_session_with_lines must reject any source report whose created_by is not the trusted sync account — source='ameen_warehouse_stock' alone is spoofable by any authenticated employee.");
    failed = true;
  }

  // (f) مراجعة Codex على PR #40، مانع 2: فحص حداثة التقرير (24 ساعة) يجب أن
  // يُطبَّق داخل RPC على الخادم — فحص الواجهة إضافي فقط وليس كافياً وحده.
  if (!/v_report_freshness_at\s*:=\s*coalesce\(v_report_generated_at, v_report_created_at\)/.test(createSessionBodyForTrust)) {
    console.error("inventory_recon_create_session_with_lines must derive report freshness server-side from summary.generated_at or created_at — not trust a client-sent freshness flag.");
    failed = true;
  }
  if (!/v_report_freshness_at is null or v_report_freshness_at < now\(\) - interval '24 hours'/.test(createSessionBodyForTrust)) {
    console.error("inventory_recon_create_session_with_lines must reject a source report older than 24 hours server-side, inside the RPC.");
    failed = true;
  }

  // (g) مراجعة Codex على PR #40، commit 84b74de، مانع P1: source_report_id
  // يجب أن يشير بالمفتاح الأجنبي إلى ameen_warehouse_stock_reports (مصدر RPC
  // الفعلي) وليس إلى inventory_reports القديم — وإلا يفشل حفظ كل جلسة جرد
  // جديدة بخطأ foreign-key-violation لأن معرّف التقرير الجديد لن يوجد أصلاً
  // بالجدول القديم. كما يجب أن تتوفر migration آمنة لإعادة التطبيق (idempotent)
  // على قاعدة سبق تطبيقها بالصيغة القديمة، بلا اعتماد على تطابق UUID مصادفةً.
  if (/references inventory_reports\(id\)/.test(invReconSqlForTrust)) {
    console.error("inventory-reconciliation-table.sql must not reference inventory_reports(id) anywhere for source_report_id — the RPC now sources warehouse-stock reports from ameen_warehouse_stock_reports.");
    failed = true;
  }
  if (!/source_report_id\s+uuid\s+references ameen_warehouse_stock_reports\(id\) on delete set null/.test(invReconSqlForTrust)) {
    console.error("inventory_recon_sessions.source_report_id must reference ameen_warehouse_stock_reports(id) on delete set null.");
    failed = true;
  }
  if (!/for fk_name in[\s\S]{0,600}alter table inventory_recon_sessions drop constraint %I/.test(invReconSqlForTrust)) {
    console.error("inventory-reconciliation-table.sql must include an idempotent migration that dynamically drops any pre-existing foreign key on source_report_id (by looking it up in information_schema, not a hardcoded constraint name) before adding the new one — needed for databases where this table was already created against the old inventory_reports table.");
    failed = true;
  }
  if (!/update inventory_recon_sessions\s+set source_report_id = null\s+where source_report_id is not null\s+and not exists \(\s*select 1 from ameen_warehouse_stock_reports r where r\.id = inventory_recon_sessions\.source_report_id\s*\)/.test(invReconSqlForTrust)) {
    console.error("inventory-reconciliation-table.sql must defensively null out any source_report_id that no longer exists in ameen_warehouse_stock_reports before attaching the new foreign key — must not rely on a coincidental UUID match with the old inventory_reports table.");
    failed = true;
  }
  if (!/add constraint inventory_recon_sessions_source_report_id_fkey\s*\n\s*foreign key \(source_report_id\) references ameen_warehouse_stock_reports\(id\) on delete set null/.test(invReconSqlForTrust)) {
    console.error("inventory-reconciliation-table.sql must add an explicit named foreign key constraint on source_report_id referencing ameen_warehouse_stock_reports(id).");
    failed = true;
  }
}

// ── المستودعات والمناقلات وفواتير الشراء حسب المستودع ──────────────────────
{
  const transferScript = readFileSync("tools/push-ameen-warehouse-transfers.ps1", "utf8");
  const requiredTransferTypes = [
    "ad2521dc-0981-4751-8542-fb52cad97b05",
    "6caa0de4-faa9-4027-ad83-4562c8f81211",
    "43b6cb6a-fd40-473f-8846-4b1064f5318a",
    "881cb610-3763-4976-9d7f-2f563da2b299"
  ];
  for (const guid of requiredTransferTypes) {
    if (!transferScript.toLowerCase().includes(guid)) {
      console.error(`Warehouse transfer sync is missing confirmed Ameen TypeGUID ${guid}.`);
      failed = true;
    }
  }
  const transferSql = transferScript.match(/\$sql = @'([\s\S]*?)'@/)?.[1] || "";
  if (!/^\s*select/i.test(transferSql) || /\b(insert\s+into|update\s+dbo|delete\s+from|merge\s+into|exec\s)/i.test(transferSql)) {
    console.error("Warehouse transfer Ameen query must remain SELECT-only.");
    failed = true;
  }
  for (const contract of [
    '$key = "$family|$date|$number"',
    "[math]::Abs($outQty - $inQty)",
    "$qty = [decimal]",
    "فشل تحقق المناقلات؛ لن يُرفع تقرير ناقص أو غير متوازن",
    "rest/v1/ameen_warehouse_transfer_reports"
  ]) {
    if (!transferScript.includes(contract)) {
      console.error(`Warehouse transfer sync contract is missing: ${contract}`);
      failed = true;
    }
  }

  if (!/LEFT JOIN st000 st ON st\.GUID = COALESCE\(bi\.StoreGUID, u\.StoreGUID\)/.test(purchaseInvoicesPull)) {
    console.error("Purchase invoice pull must resolve the real warehouse from st000 using the line/header StoreGUID.");
    failed = true;
  }
  for (const contract of ["warehouseGuid", "warehouseName", "warehouseCount"]) {
    if (!purchaseInvoicesPull.includes(contract)) {
      console.error(`Purchase invoice output is missing ${contract}.`);
      failed = true;
    }
  }

  const transferSqlMigration = readFileSync("supabase/ameen-warehouse-transfer-reports.sql", "utf8");
  for (const contract of [
    "alter table public.ameen_warehouse_transfer_reports enable row level security",
    "to_regprocedure('public.is_staff()')",
    "using (public.is_staff())",
    "revoke all on table public.ameen_warehouse_transfer_reports from public, anon, authenticated",
    "grant select, insert, delete on table public.ameen_warehouse_transfer_reports to authenticated",
    "public.ameen_warehouse_transfer_reports_is_sync_writer()",
    "and created_by = auth.uid()",
    "sync writer can delete old ameen warehouse transfers"
  ]) {
    if (!transferSqlMigration.includes(contract)) {
      console.error(`Warehouse transfer SQL contract is missing: ${contract}`);
      failed = true;
    }
  }

  const warehouseStockSql = readFileSync("supabase/ameen-warehouse-stock-reports.sql", "utf8");
  if (!warehouseStockSql.includes("using (public.is_staff())") || warehouseStockSql.includes("using (true);")) {
    console.error("Warehouse stock SELECT must require public.is_staff(); authenticated-only access is too broad.");
    failed = true;
  }

  const clientSource = readFileSync("src/supabase-client.js", "utf8");
  for (const contract of [
    "warehouseTransferReportsTable",
    "async listLatestWarehouseStockReports()",
    "async getLatestWarehouseTransferReport()",
    ".from(warehouseTransferReportsTable)"
  ]) {
    if (!clientSource.includes(contract)) {
      console.error(`Warehouse transfer client contract is missing: ${contract}`);
      failed = true;
    }
  }
  for (const contract of [
    'navButton("warehouses", "🏭 المستودعات والمناقلات")',
    "function warehouses()",
    "data-warehouse-pick",
    "invoice.warehouseName"
  ]) {
    if (!appJs.includes(contract)) {
      console.error(`Warehouse UI contract is missing: ${contract}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log("Project check passed.");

