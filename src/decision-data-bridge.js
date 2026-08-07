(function () {
  function text(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function keyOf(row) {
    return String(row?.itemKey || row?.item_key || row?.itemGuid || row?.item_guid || "").trim();
  }

  function nameOf(row) {
    return text(row?.itemName || row?.item_name || row?.name);
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function buildSnapshotIndex(rows) {
    const byKey = new Map();
    const byName = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = keyOf(row);
      const name = nameOf(row);
      if (key && !byKey.has(key)) byKey.set(key, row);
      if (name && !byName.has(name)) byName.set(name, row);
    }
    return { byKey, byName };
  }

  function findSnapshot(index, item) {
    const key = keyOf(item);
    if (key && index.byKey.has(key)) return index.byKey.get(key);
    const name = nameOf(item);
    if (name && index.byName.has(name)) return index.byName.get(name);
    return null;
  }

  function installBridge() {
    const service = window.tobaccoData;
    if (!service || service.__decisionSnapshotBridgeInstalled) return Boolean(service);
    if (typeof service.listItemSnapshots !== "function") return false;

    const originalListItemSnapshots = service.listItemSnapshots.bind(service);
    const originalListApprovedPriceItems =
      typeof service.listApprovedPriceItems === "function"
        ? service.listApprovedPriceItems.bind(service)
        : null;

    // Compatibility name used by the decision engine.
    if (typeof service.listAmeenItemSnapshot !== "function") {
      service.listAmeenItemSnapshot = originalListItemSnapshots;
    }

    // Feed the decision engine the current Ameen stock and 30-day velocity while
    // preserving approved selling-price metadata from approved_price_items.
    if (originalListApprovedPriceItems) {
      service.listApprovedPriceItems = async function listApprovedPriceItemsWithLiveSnapshot() {
        const [approvedResult, snapshotResult] = await Promise.allSettled([
          originalListApprovedPriceItems(),
          originalListItemSnapshots()
        ]);

        if (approvedResult.status !== "fulfilled") throw approvedResult.reason;
        const approved = Array.isArray(approvedResult.value) ? approvedResult.value : [];
        if (snapshotResult.status !== "fulfilled") return approved;

        const snapshots = Array.isArray(snapshotResult.value) ? snapshotResult.value : [];
        const index = buildSnapshotIndex(snapshots);

        return approved.map((item) => {
          const snapshot = findSnapshot(index, item);
          if (!snapshot) return item;

          const stock = finiteOrNull(snapshot.stockUnit1 ?? snapshot.stock_unit1);
          const sold30d = finiteOrNull(snapshot.unitsSold30d ?? snapshot.units_sold_30d);

          return {
            ...item,
            ...(stock !== null ? { stockQty: stock, stock_qty: stock } : {}),
            ...(sold30d !== null ? { unitsSold30d: sold30d, units_sold_30d: sold30d } : {}),
            ameenSnapshotGeneratedAt: snapshot.generatedAt || snapshot.generated_at || "",
            ameenLastPurchaseDate: snapshot.lastPurchaseDate || snapshot.last_purchase_date || "",
            ameenLastPurchasePrice: snapshot.lastPurchasePrice ?? snapshot.last_purchase_price ?? null,
            ameenLastSupplierName: snapshot.lastSupplierName || snapshot.last_supplier_name || ""
          };
        });
      };
    }

    service.__decisionSnapshotBridgeInstalled = true;
    return true;
  }

  if (!installBridge()) {
    window.addEventListener("DOMContentLoaded", installBridge, { once: true });
  }
})();
