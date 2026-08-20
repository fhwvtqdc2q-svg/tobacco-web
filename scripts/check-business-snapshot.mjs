import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/business-snapshot.js", import.meta.url), "utf8");
const purchaseSource = fs.readFileSync(new URL("../src/purchase-recommendation.js", import.meta.url), "utf8");
const now = new Date().toISOString();
const itemGuid = "11111111-1111-4111-8111-111111111111";

const context = {
  console,
  Date,
  Map,
  Object,
  Promise,
  Number,
  String,
  Math,
  Array,
  Set,
  window: {
    tobaccoData: {
      async listCustomerBalanceReports() {
        return [{ source: "ameen_customer_balances", created_at: new Date().toISOString(), items: [{ customerKey: "c1", customerName: "عميل 1", balance: 1200 }] }];
      },
      async listCustomerCreditLimits() {
        return [{ customerKey: "c1", customerName: "عميل 1", creditLimit: 1000 }];
      },
      async listApprovedPriceItems() {
        return [{ itemKey: "i1", itemName: "صنف 1", stockQty: 5, updatedAt: new Date().toISOString() }];
      },
      async listItemSnapshots() {
        return [{ itemKey: itemGuid, itemGuid, itemName: "مارلبورو أحمر", stockUnit1: 5, unitsSold30d: 30, generatedAt: now }];
      },
      async listPurchaseInvoices() { return []; },
      async getPurchaseInvoicesAmeenReport() { return null; },
      async getCustomerInvoicesReport() { return null; },
      async getDailyMovementReport() {
        return {
          report_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          payload: {
            sales: [{ unit: "كرتونة", bills: 2, units: 4 }],
            payments: [{ customer: "عميل 1", amount: 250, notes: "دفعة" }],
            paymentSummary: { count: 1, totalUsd: 250 },
            accountingBasis: "customer payments are USD base"
          }
        };
      },
      async listRequests() { return []; }
    },
    supplierObligationsData: {
      async listSupplierObligations() { return []; }
    },
    ozkPurchaseBusinessSettings: { approved: true, targetCoverageDays: 30, urgentCoverageDays: 7, salesVelocityFreshnessDays: 3, minimumOrderUnit: null, roundingToUnit2: true },
    ozkAmeenLiveCache: {
      updatedAt: now,
      stock: { asOf: now, rows: [{ item_guid: itemGuid, item_number: "123", item_name: "مارلبورو أحمر", stock_qty: 5, unit1_name: "علبة", unit2_name: "كرتونة", unit2_factor: 10 }] }
    }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(purchaseSource, context, { filename: "purchase-recommendation.js" });
vm.runInContext(source, context, { filename: "business-snapshot.js" });

if (!context.window.ozkBusinessOS?.getSnapshot) throw new Error("Business OS snapshot service was not installed");
const snapshot = await context.window.ozkBusinessOS.getSnapshot();

if (snapshot.schemaVersion !== 1) throw new Error("Unexpected snapshot schema version");
if (snapshot.receivables.total !== 1200) throw new Error("Receivables total mismatch");
if (snapshot.receivables.overLimitCount !== 1) throw new Error("Credit risk rule mismatch");
if (snapshot.inventory.urgentReorderCount !== 1) throw new Error("Inventory cover rule mismatch");
if (snapshot.sales.todayRevenue !== null) throw new Error("Revenue must remain null without a trusted revenue source");
if (snapshot.sales.unitsByType["كرتونة"]?.units !== 4) throw new Error("Daily sales movement extraction mismatch");
if (snapshot.collections.todayTotal !== 250 || snapshot.collections.currency !== "USD") throw new Error("Daily collections extraction mismatch");
if (snapshot.collections.count !== 1) throw new Error("Daily collections count mismatch");
if (!Array.isArray(snapshot.alerts) || snapshot.alerts.length < 2) throw new Error("Expected business alerts were not generated");
if (!snapshot.receivables.meta?.source || !snapshot.inventory.meta?.completeness || !snapshot.collections.meta?.source) throw new Error("Source-aware metadata missing");
const liveRecommendation = snapshot.inventory.purchaseRecommendations.items[0];
if (liveRecommendation.name !== "مارلبورو أحمر" || liveRecommendation.number !== "123") throw new Error("Arabic Ameen Live item text/number did not survive the stock-to-recommendation path");
if (liveRecommendation.unit1Name !== "علبة" || liveRecommendation.unit2Name !== "كرتونة" || liveRecommendation.unit2Factor !== 10) throw new Error("Ameen Live unit metadata did not survive the stock-to-recommendation path");
if (!liveRecommendation.stockTrusted || liveRecommendation.stockSource !== "ameen_live.stock" || !liveRecommendation.proposal.eligible) throw new Error("Fresh stock-only Ameen Live cache must permit an otherwise valid numeric recommendation");
if (snapshot.inventory.stockAsOf !== now || snapshot.inventory.velocityAsOf !== now) throw new Error("Stock and velocity timestamps must remain explicitly separated");

async function fallbackSnapshot(cache) {
  const fallbackContext = {
    console, Date, Map, Object, Promise, Number, String, Math, Array, Set,
    window: {
      tobaccoData: {
        async listApprovedPriceItems() { return [{ itemKey: itemGuid, itemName: "مارلبورو أحمر", stockQty: 0 }]; },
        async listItemSnapshots() { return [{ itemKey: itemGuid, itemGuid, itemName: "مارلبورو أحمر", stockUnit1: 0, unitsSold30d: 30, generatedAt: now }]; }
      },
      supplierObligationsData: {},
      ozkPurchaseBusinessSettings: { approved: true, targetCoverageDays: 30, urgentCoverageDays: 7, salesVelocityFreshnessDays: 3, minimumOrderUnit: null, roundingToUnit2: true },
      ozkAmeenLiveCache: cache
    }
  };
  fallbackContext.globalThis = fallbackContext;
  vm.createContext(fallbackContext);
  vm.runInContext(purchaseSource, fallbackContext, { filename: "purchase-recommendation.js" });
  vm.runInContext(source, fallbackContext, { filename: "business-snapshot.js" });
  return fallbackContext.window.ozkBusinessOS.getSnapshot();
}

const oldLiveAsOf = new Date(Date.now() - 16 * 60000).toISOString();
const staleStockSnapshot = await fallbackSnapshot({ updatedAt: now, stock: { asOf: oldLiveAsOf, rows: [{ item_guid: itemGuid, item_name: "مارلبورو أحمر", stock_qty: 0 }] } });
const staleStockRecommendation = staleStockSnapshot.inventory.purchaseRecommendations.items[0];
if (staleStockSnapshot.inventory.stockTrusted || staleStockSnapshot.inventory.stockAsOf !== null) throw new Error("Fresh snapshot generated_at must not make stale Ameen Live stock current");
if (staleStockRecommendation.stockAsOf !== null || staleStockRecommendation.proposal.quantity !== null) throw new Error("Stale Ameen Live stock must fall back without a numeric quantity");
if (staleStockRecommendation.velocityAsOf !== now || staleStockRecommendation.velocityState !== "fresh") throw new Error("Fresh velocity must remain available when stock is stale");

const timeoutFallbackSnapshot = await fallbackSnapshot(null);
const timeoutFallbackRecommendation = timeoutFallbackSnapshot.inventory.purchaseRecommendations.items[0];
if (timeoutFallbackRecommendation.stockTrusted || timeoutFallbackRecommendation.proposal.quantity !== null) throw new Error("Ameen Live timeout/fallback must not become trusted through snapshot generated_at");

const failedStockSnapshot = await fallbackSnapshot({ updatedAt: now, health: { ok: true }, stock: null, customers: { asOf: now, rows: [] } });
const failedStockRecommendation = failedStockSnapshot.inventory.purchaseRecommendations.items[0];
if (failedStockSnapshot.inventory.stockTrusted || failedStockSnapshot.inventory.stockAsOf !== null || failedStockRecommendation.proposal.quantity !== null) throw new Error("Failed stock with other successful resources must remain an untrusted fallback");

const invalidRowsSnapshot = await fallbackSnapshot({ updatedAt: now, stock: { asOf: now, rows: { item_guid: itemGuid, stock_qty: 0 } } });
const invalidRowsRecommendation = invalidRowsSnapshot.inventory.purchaseRecommendations.items[0];
if (invalidRowsSnapshot.inventory.stockTrusted || invalidRowsSnapshot.inventory.stockAsOf !== null || invalidRowsRecommendation.proposal.quantity !== null) throw new Error("Invalid Ameen Live stock rows must never become trusted");

console.log("OZK Business Snapshot contract: OK");
