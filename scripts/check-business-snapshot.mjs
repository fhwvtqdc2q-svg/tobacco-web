import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/business-snapshot.js", import.meta.url), "utf8");

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
        return [{ itemKey: "i1", itemName: "صنف 1", stockUnit1: 5, unitsSold30d: 30, generatedAt: new Date().toISOString() }];
      },
      async listPurchaseInvoices() { return []; },
      async getPurchaseInvoicesAmeenReport() { return null; },
      async getCustomerInvoicesReport() { return null; },
      async getDailyMovementReport() { return { report_date: new Date().toISOString(), payload: { sales_total: 500, currency: "USD" } }; },
      async listRequests() { return []; }
    },
    supplierObligationsData: {
      async listSupplierObligations() { return []; }
    }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "business-snapshot.js" });

if (!context.window.ozkBusinessOS?.getSnapshot) throw new Error("Business OS snapshot service was not installed");
const snapshot = await context.window.ozkBusinessOS.getSnapshot();

if (snapshot.schemaVersion !== 1) throw new Error("Unexpected snapshot schema version");
if (snapshot.receivables.total !== 1200) throw new Error("Receivables total mismatch");
if (snapshot.receivables.overLimitCount !== 1) throw new Error("Credit risk rule mismatch");
if (snapshot.inventory.urgentReorderCount !== 1) throw new Error("Inventory cover rule mismatch");
if (snapshot.sales.todayTotal !== 500) throw new Error("Daily sales extraction mismatch");
if (!Array.isArray(snapshot.alerts) || snapshot.alerts.length < 2) throw new Error("Expected business alerts were not generated");
if (!snapshot.receivables.meta?.source || !snapshot.inventory.meta?.completeness) throw new Error("Source-aware metadata missing");

console.log("OZK Business Snapshot contract: OK");
