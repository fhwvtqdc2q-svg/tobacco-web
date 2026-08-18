import fs from "node:fs";
import vm from "node:vm";

const businessSource = fs.readFileSync(new URL("../src/business-snapshot.js", import.meta.url), "utf8");
const purchaseSource = fs.readFileSync(new URL("../src/purchase-recommendation.js", import.meta.url), "utf8");
const now = new Date().toISOString();
const settings = { approved: true, targetCoverageDays: 30, urgentCoverageDays: 7, salesVelocityFreshnessDays: 3, minimumOrderUnit: null, roundingToUnit2: true };

const known = {
  item429: "3F0786C5-ACC2-4FBF-8232-13FDE92B517C",
  item430: "BFEE3702-3A1C-427F-B0B6-CE26F0440E0B",
  old273: "8772CDCC-DDFD-4588-B6FB-2FA5B328760A",
  current273: "197736EF-4FE0-455F-A912-6AEE96AE7E28",
  old398: "97DEAB72-26FC-4654-8E1B-E332FD126C3D",
  current398: "FA606491-CEA3-4EFA-827F-ED5B7BE65C88"
};

function generatedGuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function snapshotFor({ liveRows = null, snapshots = [], approved = [] }) {
  const context = {
    console, Date, Map, Object, Promise, Number, String, Math, Array, Set, JSON,
    window: {
      tobaccoData: {
        async listApprovedPriceItems() { return approved; },
        async listItemSnapshots() { return snapshots; }
      },
      supplierObligationsData: {},
      ozkPurchaseBusinessSettings: settings,
      ozkAmeenLiveCache: liveRows ? { updatedAt: now, stock: { asOf: now, rows: liveRows } } : null
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(purchaseSource, context, { filename: "purchase-recommendation.js" });
  vm.runInContext(businessSource, context, { filename: "business-snapshot.js" });
  return context.window.ozkBusinessOS.getSnapshot();
}

const fixedRows = [
  { item_guid: known.item429, item_number: "429", item_name: "دفيدوف سليم غولد", stock_qty: 2 },
  { item_guid: known.item430, item_number: "430", item_name: "فحم الزعيم كيلو 72", stock_qty: 2 },
  { item_guid: known.current273, item_number: "273", item_name: "غلواز كوين اصفر اس سبعة", stock_qty: 2 },
  { item_guid: known.current398, item_number: "398", item_name: "مانشستر كوين طقة توت", stock_qty: 2 }
];
const liveRows = [...fixedRows];
for (let index = 1; liveRows.length < 423; index += 1) {
  const item_guid = generatedGuid(index);
  if (!liveRows.some((row) => row.item_guid === item_guid)) liveRows.push({ item_guid, item_number: String(1000 + index), item_name: `صنف ${index}`, stock_qty: 2 });
}
const snapshots = liveRows.map((row) => ({ itemGuid: row.item_guid, itemKey: row.item_guid, itemNumber: row.item_number, itemName: row.item_name, stockUnit1: 2, unitsSold30d: 30, generatedAt: now }));
snapshots.push(
  { itemGuid: known.old273, itemKey: known.old273, itemName: "غلواز كوين اصفر اس سبعة", stockUnit1: 2, unitsSold30d: 30, generatedAt: now },
  { itemGuid: known.old398, itemKey: known.old398, itemName: "مانشستر كوين طقة توت", stockUnit1: 2, unitsSold30d: 30, generatedAt: now }
);

const partialApproved = liveRows.slice(1, 253).map((row, index) => ({
  itemKey: index % 2 ? row.item_name : row.item_guid,
  itemNumber: row.item_number,
  itemName: row.item_name,
  unit1Price: 10,
  approvedAtExplicit: "2026-08-01T00:00:00.000Z"
}));
partialApproved.push(
  { itemKey: "نسخة أزرق", itemNumber: "429", itemName: "دفيدوف سليم أزرق", unit1Price: 9, approvedAtExplicit: "2026-07-01T00:00:00.000Z" },
  { itemKey: "نسخة ازرق", itemNumber: "429", itemName: "دفيدوف سليم ازرق", unit1Price: 11, approvedAtExplicit: "2026-08-02T00:00:00.000Z" }
);

const live = await snapshotFor({ liveRows, snapshots, approved: partialApproved });
const recommendations = live.inventory.purchaseRecommendations.items;
if (live.inventory.itemCount !== 423 || recommendations.length !== 423) throw new Error("CASE A/H: partial approved prices must not reduce 423-item current master coverage");
if (new Set(recommendations.map((row) => row.itemGuid)).size !== 423) throw new Error("CASE A/K: output must contain 423 unique canonical GUIDs");
if (recommendations.filter((row) => row.priceOverlayState === "missing").length !== 170) throw new Error("CASE A/H: all 170 current items without an approved price must remain in coverage");
if (live.inventory.approvedDuplicateCount !== 1) throw new Error("CASE B: duplicate approved rows were not collapsed to one overlay");
const item429 = recommendations.find((row) => row.itemGuid === known.item429);
const item430 = recommendations.find((row) => row.itemGuid === known.item430);
if (item429?.number !== "429" || item429?.priceOverlay?.unit1Price !== 11) throw new Error("CASE C/D: item 429 must reconcile and select its latest explicit decision by GUID/number, not Arabic name");
if (item430?.number !== "430") throw new Error("CASE E: item 430 must reconcile deterministically through GUID");
if (recommendations.some((row) => row.itemGuid === known.old273 || row.itemGuid === known.old398)) throw new Error("CASE F/G: historical GUIDs must not enter the current live master");
const missingApproved = recommendations.find((row) => row.itemGuid === liveRows.at(-1).item_guid);
if (!missingApproved || missingApproved.priceOverlayState !== "missing") throw new Error("CASE H: an item without approved price must remain in coverage");
if (recommendations.some((row) => row.proposal.quantity !== null && !row.stockTrusted)) throw new Error("CASE I: numeric recommendations require trusted stock");
const formulaRow = recommendations.find((row) => row.itemGuid === known.item430);
if (!formulaRow.proposal.eligible || formulaRow.proposal.rawQuantity !== 28) throw new Error("CASE J: fresh trusted stock + velocity must retain the existing purchase formula");

const fallback = await snapshotFor({ snapshots, approved: partialApproved });
if (fallback.inventory.itemCount !== 423 || fallback.inventory.historicalIdentityCount !== 2) throw new Error("CASE F/G: snapshot fallback must exclude exactly the two known historical identities");
if (fallback.inventory.purchaseRecommendations.items.some((row) => row.stockTrusted || row.proposal.quantity !== null)) throw new Error("CASE I: fallback snapshot stock must remain untrusted and block numeric quantities");

const historicalApproved = await snapshotFor({
  liveRows: fixedRows.filter((row) => ["273", "398"].includes(row.item_number)),
  snapshots: snapshots.filter((row) => ["273", "398"].includes(row.itemNumber)),
  approved: [
    { itemKey: known.old273, itemNumber: "273", itemName: "هوية 273 تاريخية", unit1Price: 273, approvedAtExplicit: now },
    { itemKey: known.old398, itemNumber: "398", itemName: "هوية 398 تاريخية", unit1Price: 398, approvedAtExplicit: now }
  ]
});
const historicalRecommendations = historicalApproved.inventory.purchaseRecommendations.items;
if (historicalApproved.inventory.itemCount !== 2 || historicalRecommendations.length !== 2 || new Set(historicalRecommendations.map((row) => row.itemGuid)).size !== 2) throw new Error("CASE F/G: current 273/398 master coverage must remain complete and duplicate-free");
for (const identity of [{ oldGuid: known.old273, currentGuid: known.current273, number: "273" }, { oldGuid: known.old398, currentGuid: known.current398, number: "398" }]) {
  const current = historicalRecommendations.find((row) => row.itemGuid === identity.currentGuid);
  if (!current || current.priceOverlay || current.priceOverlayState === "resolved") throw new Error(`CASE ${identity.number}: an explicit historical GUID must not fall back by item_number to the current GUID`);
  if (!historicalApproved.inventory.priceOverlayAnomalies.some((row) => row.itemGuid === identity.oldGuid && row.code === "APPROVED_GUID_NOT_IN_CURRENT_MASTER")) throw new Error(`CASE ${identity.number}: unmatched explicit historical GUID must remain a review anomaly`);
}
if (historicalRecommendations.some((row) => row.itemGuid === known.old273 || row.itemGuid === known.old398)) throw new Error("CASE F/G: historical GUIDs must not enter current recommendation identities");

const numberFallbackGuid = generatedGuid(9100);
const numberFallback = await snapshotFor({
  liveRows: [{ item_guid: numberFallbackGuid, item_number: "9100", item_name: "fallback by number", stock_qty: 2 }],
  snapshots: [{ itemGuid: numberFallbackGuid, itemNumber: "9100", itemName: "fallback by number", stockUnit1: 2, unitsSold30d: 30, generatedAt: now }],
  approved: [{ itemKey: "not-a-valid-guid", itemNumber: "9100", itemName: "fallback by number", unit1Price: 91, approvedAtExplicit: now }]
});
const numberFallbackRow = numberFallback.inventory.purchaseRecommendations.items[0];
if (numberFallbackRow?.itemGuid !== numberFallbackGuid || numberFallbackRow?.priceOverlayState !== "resolved" || numberFallbackRow?.priceOverlay?.unit1Price !== 91) throw new Error("CASE L: a row without a valid explicit GUID must still use a unique trusted item_number fallback");

const directWinnerGuid = generatedGuid(9201);
const mismatchedNumberGuid = generatedGuid(9202);
const directGuidWins = await snapshotFor({
  liveRows: [
    { item_guid: directWinnerGuid, item_number: "9201", item_name: "direct GUID winner", stock_qty: 2 },
    { item_guid: mismatchedNumberGuid, item_number: "9202", item_name: "number must lose", stock_qty: 2 }
  ],
  snapshots: [
    { itemGuid: directWinnerGuid, itemNumber: "9201", itemName: "direct GUID winner", stockUnit1: 2, unitsSold30d: 30, generatedAt: now },
    { itemGuid: mismatchedNumberGuid, itemNumber: "9202", itemName: "number must lose", stockUnit1: 2, unitsSold30d: 30, generatedAt: now }
  ],
  approved: [{ itemKey: directWinnerGuid, itemNumber: "9202", itemName: "direct GUID winner", unit1Price: 92, approvedAtExplicit: now }]
});
const directWinner = directGuidWins.inventory.purchaseRecommendations.items.find((row) => row.itemGuid === directWinnerGuid);
const numberLoser = directGuidWins.inventory.purchaseRecommendations.items.find((row) => row.itemGuid === mismatchedNumberGuid);
if (directWinner?.priceOverlayState !== "resolved" || directWinner?.priceOverlay?.unit1Price !== 92 || numberLoser?.priceOverlay) throw new Error("CASE M: a valid current direct GUID must win over a conflicting item_number");

const sameNameDifferentGuids = await snapshotFor({
  liveRows: [
    { item_guid: generatedGuid(9001), item_number: "9001", item_name: "أبيض طبعة" },
    { item_guid: generatedGuid(9002), item_number: "9002", item_name: "ابيض طبعه" }
  ],
  snapshots: [
    { itemGuid: generatedGuid(9001), itemNumber: "9001", itemName: "أبيض طبعة", stockUnit1: 1, unitsSold30d: 1, generatedAt: now },
    { itemGuid: generatedGuid(9002), itemNumber: "9002", itemName: "ابيض طبعه", stockUnit1: 1, unitsSold30d: 1, generatedAt: now }
  ],
  approved: [{ itemKey: "اسم فقط", itemName: "أبيض طبعة", unit1Price: 99, approvedAtExplicit: now }]
});
if (sameNameDifferentGuids.inventory.itemCount !== 2 || sameNameDifferentGuids.inventory.purchaseRecommendations.items.some((row) => row.priceOverlay)) throw new Error("CASE C: similar Arabic names alone must neither merge identities nor attach an overlay");

const conflictNumbers = ["31", "114", "123", "279", "325", "358", "378"];
const conflictLive = conflictNumbers.map((number, index) => ({ item_guid: generatedGuid(9500 + index), item_number: number, item_name: `تعارض ${number}` }));
const conflictSnapshots = conflictLive.map((row) => ({ itemGuid: row.item_guid, itemNumber: row.item_number, itemName: row.item_name, stockUnit1: 1, unitsSold30d: 1, generatedAt: now }));
const conflictApproved = conflictLive.flatMap((row) => [
  { itemKey: `${row.item_name} أ`, itemNumber: row.item_number, unit1Price: 10, approvedAtExplicit: "2026-08-10T00:00:00.000Z" },
  { itemKey: `${row.item_name} ا`, itemNumber: row.item_number, unit1Price: 11, approvedAtExplicit: "2026-08-10T00:00:00.000Z" }
]);
const conflicts = await snapshotFor({ liveRows: conflictLive, snapshots: conflictSnapshots, approved: conflictApproved });
if (conflicts.inventory.priceOverlayAnomalies.length !== 7) throw new Error("Commercial conflicts 31/114/123/279/325/358/378 must remain review-only anomalies");
if (conflicts.inventory.purchaseRecommendations.items.some((row) => row.priceOverlay || row.priceOverlayState !== "review_only")) throw new Error("Commercial conflicts must not choose or merge an arbitrary price overlay");

console.log("MASTER ITEM COVERAGE + TRUSTED IDENTITY DEDUP contract: OK");
