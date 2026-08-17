import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/business-metrics.js", import.meta.url), "utf8");
const context = { console, Date, Math, Number, String, Array, Object, Promise, window: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "business-metrics.js" });

const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  identity: { accountingSourceOfTruth: "Ameen" },
  receivables: { total: 100000, debtorCount: 10, overLimitCount: 3, nearLimitCount: 2, meta: { source: "ameen_customer_balances" } },
  collections: { todayTotal: 1000, currency: "USD", meta: { source: "daily_movement_reports.paymentSummary" } },
  inventory: { itemCount: 100, outOfStockCount: 4, urgentReorderCount: 10, lowCoverCount: 15, meta: { source: "ameen_item_snapshot" } },
  supplierObligations: { supplierCount: 3, totalsByCurrency: { USD: 20000 }, top: [], meta: { source: "supplier_obligations" } },
  purchasing: { pendingSyncCount: 2, draftCount: 1, openTotalsByCurrency: { USD: 5000 }, meta: { source: "purchase_invoices" } },
  syncHealth: { missingCount: 0, staleCount: 0, sources: [{}, {}, {}, {}, {}, {}] },
  dataQuality: { degraded: false }
};

if (!context.window.ozkBusinessMetrics?.calculate) throw new Error("Metrics engine not installed");
const result = context.window.ozkBusinessMetrics.calculate(snapshot);
if (result.schemaVersion !== 1) throw new Error("Unexpected metrics schema version");
if (result.metrics.creditRisk.score <= 0) throw new Error("Credit risk score should be positive");
if (result.metrics.collectionPressure.facts.gap <= 0) throw new Error("Collection gap should be positive");
if (result.metrics.inventoryPressure.score <= 0) throw new Error("Inventory pressure should be positive");
if (!Array.isArray(result.priorities) || result.priorities.length === 0) throw new Error("Priorities should be generated");
if (result.guardrails.autonomousFinancialWrites !== false) throw new Error("Financial write guardrail must remain disabled");
console.log("OZK Business Metrics contract: OK");
