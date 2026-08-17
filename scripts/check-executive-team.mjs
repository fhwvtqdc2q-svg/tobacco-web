import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('src/executive-team.js', 'utf8');
const context = { window: {}, console, Date, Object, Number, Math, String, Array };
vm.createContext(context);
vm.runInContext(code, context);

const team = context.window.ozkExecutiveTeam;
if (!team || typeof team.buildBrief !== 'function') throw new Error('Executive Team API missing');

const snapshot = {
  schemaVersion: 1,
  identity: { accountingSourceOfTruth: 'Ameen' },
  receivables: { total: 100000, debtorCount: 10, overLimitCount: 2, nearLimitCount: 2 },
  collections: { todayTotal: 1000, currency: 'USD' },
  inventory: { itemCount: 100, outOfStockCount: 4, urgentReorderCount: 6, lowCoverCount: 10 },
  supplierObligations: { supplierCount: 3, top: [] },
  purchasing: { pendingSyncCount: 2, draftCount: 1 },
  syncHealth: { staleCount: 0, missingCount: 0, sources: [] },
  dataQuality: { degraded: false }
};
const metrics = {
  overall: { riskScore: 55, confidenceScore: 90, level: 'high' },
  metrics: {
    collectionPressure: { score: 80, facts: { collectedToday: 1000, gap: 2500 } },
    creditRisk: { score: 70, facts: { overLimitCount: 2, nearLimitCount: 2 } },
    inventoryPressure: { score: 60, facts: { outOfStockCount: 4, urgentReorderCount: 6, lowCoverCount: 10 } },
    supplierPressure: { score: 0, facts: { overdueCount: 0, dueWithin7DaysCount: 0, totalsByCurrency: {} } },
    purchasingWorkflow: { score: 42, facts: { pendingSyncCount: 2, draftCount: 1, openTotalsByCurrency: {} } },
    dataConfidence: { score: 90, facts: { missingCount: 0, staleCount: 0 } }
  },
  guardrails: { accountingSourceOfTruth: 'Ameen' }
};

const brief = team.buildBrief(snapshot, metrics);
if (!Array.isArray(brief.executiveOrder) || brief.executiveOrder.length < 2) throw new Error('Executive priorities not produced');
if (brief.guardrails.autonomousPayments !== false || brief.guardrails.autonomousPurchases !== false) throw new Error('Financial guardrails missing');
if (brief.guardrails.accountingSourceOfTruth !== 'Ameen') throw new Error('Accounting source of truth changed');
if (!brief.agents.ceo || !brief.agents.controller) throw new Error('Executive agents missing');
console.log('Executive Team contract OK');
