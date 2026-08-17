(function () {
  "use strict";

  const SNAPSHOT_VERSION = 1;
  const DEFAULT_STALE_MINUTES = 15;

  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const numberOrZero = (value) => numberOrNull(value) ?? 0;
  const text = (value) => String(value ?? "").trim();

  function iso(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function newestIso(values) {
    const valid = values.map(iso).filter(Boolean).sort();
    return valid.length ? valid[valid.length - 1] : null;
  }

  function freshness(asOf, staleMinutes = DEFAULT_STALE_MINUTES) {
    if (!asOf) return { state: "unknown", ageMinutes: null, stale: true };
    const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(asOf).getTime()) / 60000));
    return {
      state: ageMinutes <= staleMinutes ? "fresh" : "stale",
      ageMinutes,
      stale: ageMinutes > staleMinutes
    };
  }

  function meta(source, asOf, completeness, note = null, staleMinutes = DEFAULT_STALE_MINUTES) {
    return {
      source,
      asOf: iso(asOf),
      completeness,
      note,
      freshness: freshness(asOf, staleMinutes)
    };
  }

  function sumByCurrency(rows, amountGetter, currencyGetter) {
    const totals = {};
    for (const row of rows || []) {
      const amount = numberOrNull(amountGetter(row));
      if (amount === null) continue;
      const currency = text(currencyGetter(row)) || "UNKNOWN";
      totals[currency] = (totals[currency] || 0) + amount;
    }
    return totals;
  }

  async function safe(name, fn, fallback) {
    try {
      if (typeof fn !== "function") return { ok: false, value: fallback, error: `${name}: unavailable` };
      return { ok: true, value: await fn(), error: null };
    } catch (error) {
      return { ok: false, value: fallback, error: `${name}: ${String(error?.message || error)}` };
    }
  }

  function customerKey(row) {
    return text(row?.customerKey || row?.customer_key || row?.key || row?.guid || row?.customerGuid || row?.customer_guid || row?.name);
  }

  function customerName(row) {
    return text(row?.customerName || row?.customer_name || row?.name || row?.customer) || "زبون";
  }

  function customerBalance(row) {
    return numberOrZero(row?.balance ?? row?.debit ?? row?.amount ?? row?.remaining ?? 0);
  }

  function buildReceivables(balanceReports, creditLimits) {
    const report = Array.isArray(balanceReports) ? balanceReports[0] : null;
    const rows = Array.isArray(report?.items) ? report.items : [];
    const limitByKey = new Map();
    const limitByName = new Map();

    for (const limit of creditLimits || []) {
      const key = text(limit.customerKey || limit.customer_key);
      const name = customerName(limit).toLowerCase();
      if (key) limitByKey.set(key, numberOrZero(limit.creditLimit || limit.credit_limit));
      if (name) limitByName.set(name, numberOrZero(limit.creditLimit || limit.credit_limit));
    }

    const debtors = rows
      .map((row) => {
        const balance = Math.max(0, customerBalance(row));
        const key = customerKey(row);
        const name = customerName(row);
        const creditLimit = limitByKey.get(key) ?? limitByName.get(name.toLowerCase()) ?? 0;
        const ratio = creditLimit > 0 ? balance / creditLimit : null;
        let level = "normal";
        if (ratio !== null && ratio >= 1) level = "critical";
        else if (ratio !== null && ratio >= 0.9) level = "high";
        else if (balance > 0 && creditLimit === 0) level = "unbounded";
        return { key, name, balance, creditLimit, ratio, level };
      })
      .filter((row) => row.balance > 0)
      .sort((a, b) => {
        const ar = a.ratio ?? -1;
        const br = b.ratio ?? -1;
        return br - ar || b.balance - a.balance;
      });

    return {
      total: debtors.reduce((sum, row) => sum + row.balance, 0),
      debtorCount: debtors.length,
      overLimitCount: debtors.filter((row) => row.ratio !== null && row.ratio >= 1).length,
      nearLimitCount: debtors.filter((row) => row.ratio !== null && row.ratio >= 0.9 && row.ratio < 1).length,
      topRisks: debtors.slice(0, 10),
      meta: meta(
        report?.source || "ameen_customer_balances",
        report?.created_at || report?.createdAt || report?.report_date,
        report ? "complete" : "missing",
        report ? "Receivables are derived from the latest Ameen customer balance report." : "No customer balance report is available."
      )
    };
  }

  function buildInventory(approvedItems, snapshots) {
    const snapshotByKey = new Map();
    const snapshotByName = new Map();
    for (const row of snapshots || []) {
      const key = text(row.itemKey || row.item_key || row.itemGuid || row.item_guid);
      const name = text(row.itemName || row.item_name).toLowerCase();
      if (key) snapshotByKey.set(key, row);
      if (name) snapshotByName.set(name, row);
    }

    const items = (approvedItems || []).map((item) => {
      const key = text(item.itemKey || item.item_key);
      const name = text(item.itemName || item.item_name) || "صنف";
      const snap = snapshotByKey.get(key) || snapshotByName.get(name.toLowerCase()) || null;
      const stock = Math.max(0, numberOrZero(snap?.stockUnit1 ?? snap?.stock_unit1 ?? item.stockQty ?? item.stock_qty));
      const sold30d = numberOrNull(snap?.unitsSold30d ?? snap?.units_sold_30d ?? item.unitsSold30d ?? item.units_sold_30d);
      const daysCover = sold30d !== null && sold30d > 0 ? stock / (sold30d / 30) : null;
      let status = "stable";
      if (stock <= 0) status = "out";
      else if (daysCover !== null && daysCover < 7) status = "urgent";
      else if (daysCover !== null && daysCover < 14) status = "low";
      return { key, name, stock, sold30d, daysCover, status };
    });

    const snapshotAsOf = newestIso((snapshots || []).map((row) => row.generatedAt || row.generated_at));
    const approvedAsOf = newestIso((approvedItems || []).map((row) => row.updatedAt || row.updated_at || row.sourceSyncedAt || row.source_synced_at));
    return {
      itemCount: items.length,
      outOfStockCount: items.filter((row) => row.status === "out").length,
      urgentReorderCount: items.filter((row) => row.status === "urgent").length,
      lowCoverCount: items.filter((row) => row.status === "low").length,
      urgentItems: items.filter((row) => row.status === "out" || row.status === "urgent").sort((a, b) => (a.daysCover ?? -1) - (b.daysCover ?? -1)).slice(0, 12),
      meta: meta(
        snapshots?.length ? "ameen_item_snapshot + approved_price_items" : "approved_price_items",
        snapshotAsOf || approvedAsOf,
        items.length ? (snapshots?.length ? "complete" : "partial") : "missing",
        snapshots?.length ? "Stock and 30-day velocity use the synchronized Ameen item snapshot." : "Ameen item snapshot is unavailable; inventory intelligence is limited."
      )
    };
  }

  function buildPurchasing(purchaseInvoices, ameenPurchaseReport) {
    const local = Array.isArray(purchaseInvoices) ? purchaseInvoices : [];
    const open = local.filter((row) => !["synced", "cancelled"].includes(text(row.status).toLowerCase()));
    const openTotals = sumByCurrency(open, (row) => row.remainingTotal ?? row.remaining_total ?? row.total, (row) => row.currency);
    const ameenGroups = Array.isArray(ameenPurchaseReport?.items) ? ameenPurchaseReport.items : [];
    const ameenInvoiceCount = ameenGroups.reduce((sum, supplier) => sum + (Array.isArray(supplier?.invoices) ? supplier.invoices.length : 0), 0);

    return {
      draftCount: local.filter((row) => text(row.status).toLowerCase() === "draft").length,
      pendingSyncCount: local.filter((row) => ["approved", "sync_pending", "failed"].includes(text(row.status).toLowerCase())).length,
      openTotalsByCurrency: openTotals,
      ameenSupplierCount: ameenGroups.length,
      ameenInvoiceCount,
      meta: meta(
        ameenPurchaseReport ? "ameen_purchase_invoice_reports + purchase_invoices" : "purchase_invoices",
        newestIso([ameenPurchaseReport?.created_at, ameenPurchaseReport?.report_date, ...local.map((row) => row.updatedAt || row.updated_at || row.createdAt || row.created_at)]),
        ameenPurchaseReport ? "complete" : (local.length ? "partial" : "missing"),
        ameenPurchaseReport ? "Includes read-only purchase invoices synchronized from Ameen plus local workflow invoices." : "Ameen purchase report is unavailable."
      )
    };
  }

  function buildSupplierObligations(rows) {
    const obligations = Array.isArray(rows) ? rows : [];
    return {
      supplierCount: obligations.length,
      totalsByCurrency: sumByCurrency(obligations, (row) => row.amount_due ?? row.amountDue, (row) => row.currency),
      top: obligations.slice(0, 10).map((row) => ({
        key: text(row.supplier_key || row.supplierKey),
        name: text(row.supplier_name || row.supplierName) || "مورد",
        amountDue: numberOrNull(row.amount_due ?? row.amountDue),
        currency: text(row.currency) || "UNKNOWN",
        dueDate: row.due_date || row.dueDate || null,
        supplyRisk: text(row.supply_risk || row.supplyRisk) || "normal",
        source: text(row.source) || "ameen"
      })),
      meta: meta(
        "supplier_obligations",
        newestIso(obligations.map((row) => row.updated_at || row.updatedAt)),
        obligations.length ? "complete" : "unknown",
        obligations.length ? null : "No positive supplier obligations are currently available, or access is unavailable."
      )
    };
  }

  function buildSales(customerInvoicesReport, dailyMovementReport) {
    const payload = dailyMovementReport?.payload || null;
    const candidates = [
      payload?.sales_total,
      payload?.salesTotal,
      payload?.total_sales,
      payload?.totalSales,
      dailyMovementReport?.sales_total,
      dailyMovementReport?.salesTotal
    ];
    const todayTotal = candidates.map(numberOrNull).find((value) => value !== null) ?? null;
    const invoices = Array.isArray(customerInvoicesReport?.items) ? customerInvoicesReport.items : [];

    return {
      todayTotal,
      currency: text(payload?.currency || dailyMovementReport?.currency) || null,
      customerInvoiceGroups: invoices.length,
      meta: meta(
        dailyMovementReport ? "daily_movement_reports" : (customerInvoicesReport ? "ameen_customer_invoices" : "none"),
        newestIso([dailyMovementReport?.created_at, dailyMovementReport?.report_date, customerInvoicesReport?.created_at, customerInvoicesReport?.report_date]),
        todayTotal !== null ? "complete" : (customerInvoicesReport ? "partial" : "missing"),
        todayTotal !== null ? null : "A trustworthy daily sales total was not found in the available payload, so the value is intentionally null."
      )
    };
  }

  function buildRequests(requests) {
    const rows = Array.isArray(requests) ? requests : [];
    const open = rows.filter((row) => !["مغلق", "closed"].includes(text(row.status)));
    return {
      recentCount: rows.length,
      openCount: open.length,
      meta: meta("customer_requests", newestIso(rows.map((row) => row.createdAt || row.created_at)), rows.length ? "complete" : "unknown")
    };
  }

  function buildSyncHealth(parts) {
    const sources = Object.entries(parts).map(([name, section]) => ({
      name,
      source: section?.meta?.source || "unknown",
      asOf: section?.meta?.asOf || null,
      completeness: section?.meta?.completeness || "unknown",
      freshness: section?.meta?.freshness || freshness(null)
    }));
    return {
      staleCount: sources.filter((row) => row.freshness?.stale).length,
      missingCount: sources.filter((row) => row.completeness === "missing").length,
      sources
    };
  }

  function buildAlerts(parts) {
    const alerts = [];
    if (parts.receivables.overLimitCount > 0) alerts.push({ severity: "critical", domain: "receivables", code: "CUSTOMERS_OVER_LIMIT", count: parts.receivables.overLimitCount });
    if (parts.inventory.outOfStockCount > 0) alerts.push({ severity: "critical", domain: "inventory", code: "OUT_OF_STOCK", count: parts.inventory.outOfStockCount });
    if (parts.inventory.urgentReorderCount > 0) alerts.push({ severity: "high", domain: "inventory", code: "URGENT_REORDER", count: parts.inventory.urgentReorderCount });
    if (parts.purchasing.pendingSyncCount > 0) alerts.push({ severity: "medium", domain: "purchasing", code: "PURCHASES_PENDING_SYNC", count: parts.purchasing.pendingSyncCount });
    return alerts;
  }

  async function getSnapshot() {
    const data = window.tobaccoData || {};
    const suppliers = window.supplierObligationsData || {};
    const today = new Date().toISOString().slice(0, 10);

    const [
      balanceReports,
      creditLimits,
      approvedItems,
      itemSnapshots,
      purchaseInvoices,
      ameenPurchases,
      supplierObligations,
      customerInvoices,
      dailyMovement,
      requests
    ] = await Promise.all([
      safe("customer balances", data.listCustomerBalanceReports?.bind(data), []),
      safe("credit limits", data.listCustomerCreditLimits?.bind(data), []),
      safe("approved prices", data.listApprovedPriceItems?.bind(data), []),
      safe("item snapshots", data.listItemSnapshots?.bind(data), []),
      safe("purchase invoices", data.listPurchaseInvoices?.bind(data), []),
      safe("Ameen purchase invoices", data.getPurchaseInvoicesAmeenReport?.bind(data), null),
      safe("supplier obligations", suppliers.listSupplierObligations?.bind(suppliers), []),
      safe("customer invoices", data.getCustomerInvoicesReport?.bind(data), null),
      safe("daily movement", typeof data.getDailyMovementReport === "function" ? () => data.getDailyMovementReport(today) : null, null),
      safe("customer requests", data.listRequests?.bind(data), [])
    ]);

    const parts = {
      sales: buildSales(customerInvoices.value, dailyMovement.value),
      receivables: buildReceivables(balanceReports.value, creditLimits.value),
      inventory: buildInventory(approvedItems.value, itemSnapshots.value),
      purchasing: buildPurchasing(purchaseInvoices.value, ameenPurchases.value),
      supplierObligations: buildSupplierObligations(supplierObligations.value),
      requests: buildRequests(requests.value),
      collections: {
        todayTotal: null,
        currency: null,
        meta: meta("payment_records", null, "missing", "A single trusted aggregate for all payment records is not exposed by the current data client yet; this is intentionally null until a dedicated source is added.")
      },
      expenses: {
        totalsByCurrency: {},
        meta: meta("ameen_expenses", null, "missing", "Expense data exists in the platform but is not yet exposed through a dedicated authenticated data method for the snapshot.")
      }
    };

    const errors = [balanceReports, creditLimits, approvedItems, itemSnapshots, purchaseInvoices, ameenPurchases, supplierObligations, customerInvoices, dailyMovement, requests]
      .filter((result) => !result.ok)
      .map((result) => result.error);

    return {
      schemaVersion: SNAPSHOT_VERSION,
      generatedAt: new Date().toISOString(),
      identity: { business: "OZK TOBACCO", accountingSourceOfTruth: "Ameen" },
      ...parts,
      syncHealth: buildSyncHealth(parts),
      alerts: buildAlerts(parts),
      dataQuality: {
        degraded: errors.length > 0 || Object.values(parts).some((part) => part?.meta?.completeness === "missing"),
        errors
      }
    };
  }

  window.ozkBusinessOS = Object.freeze({
    schemaVersion: SNAPSHOT_VERSION,
    getSnapshot
  });
})();
