import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("src/purchase-recommendation.js", "utf8");
const context = vm.createContext({ window: {}, Date, Number, String, Math, Object, Array });
vm.runInContext(source, context);
const engine = context.window.ozkPurchaseRecommendation;
if (!engine) throw new Error("Purchase recommendation engine is unavailable.");

const now = new Date("2026-08-17T12:00:00.000Z");
const freshAsOf = "2026-08-17T06:00:00.000Z";
const staleAsOf = "2026-08-10T12:00:00.000Z";
const approved = {
  approved: true,
  targetCoverageDays: 30,
  urgentCoverageDays: 7,
  salesVelocityFreshnessDays: 2,
  minimumOrderUnit: null,
  roundingToUnit2: false
};
const item = (overrides = {}) => ({ key: "i1", name: "صنف اختبار", stock: 5, stockAsOf: now.toISOString(), sold30d: 30, velocityAsOf: freshAsOf, unit1Name: "علبة", unit2Name: "كرتونة", unit2Factor: 10, ...overrides });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const outFresh = engine.recommendItem(item({ stock: 0 }), approved, now);
assert(outFresh.priority === "high" && outFresh.status === "out_of_stock", "stock=0 with fresh velocity must be high priority.");
assert(outFresh.proposal.eligible && outFresh.proposal.quantity === 30, "trusted stock=0 case must calculate from approved settings only.");

const lowFresh = engine.recommendItem(item({ stock: 2 }), approved, now);
assert(lowFresh.priority === "high" && lowFresh.coverageDays === 2, "low stock with fresh velocity must use trusted coverage.");
assert(lowFresh.proposal.quantity === 28, "low stock quantity must follow target minus current stock.");

const staleVelocity = engine.recommendItem(item({ velocityAsOf: staleAsOf }), approved, now);
assert(staleVelocity.velocityState === "stale" && !staleVelocity.proposal.eligible && staleVelocity.proposal.quantity === null, "stale velocity must never produce a quantity.");
assert(staleVelocity.reason.includes("حركة المبيعات غير حديثة"), "stale velocity must explain the freshness failure.");

const missingVelocity = engine.recommendItem(item({ sold30d: null, velocityAsOf: null }), approved, now);
assert(missingVelocity.velocityState === "missing" && !missingVelocity.proposal.eligible, "missing velocity must never produce a quantity.");

const roundedUnit2 = engine.recommendItem(item({ stock: 2, unit2Factor: 10 }), { ...approved, roundingToUnit2: true }, now);
assert(roundedUnit2.proposal.quantity === 30 && roundedUnit2.proposal.rawQuantity === 28 && roundedUnit2.proposal.basis === "unit2", "trusted unit2 factor must round only when the explicit setting enables it.");

const unapproved = engine.recommendItem(item({ stock: 0 }), engine.DEFAULT_SETTINGS, now);
assert(!unapproved.proposal.eligible && unapproved.proposal.quantity === null, "unapproved business settings must suppress numeric quantity.");
assert(unapproved.velocityState === "freshness_unapproved", "velocity must not be trusted without an approved freshness duration.");

console.log("Purchase recommendation checks passed.");
