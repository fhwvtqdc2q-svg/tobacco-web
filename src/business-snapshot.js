(function () {
  "use strict";

  const SNAPSHOT_VERSION = 1;
  const DEFAULT_STALE_MINUTES = 15;
  const AMEEN_LIVE_MAX_AGE_MINUTES = 15;

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

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function newestIso(values) {
    const valid = values.map(iso).filter(Boolean).sort();
    return valid.length ? valid[valid.length - 1] : null;
  }

  function freshness(asOf, staleMinutes = DEFAULT_STALE_MINUTES) {
    if (!asOf) return { state: "unknown", ageMinutes: null, stale: true };
    const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(asOf).getTime()) / 60000));
    return { state: ageMinutes <= staleMinutes ? "fresh" : "stale", ageMinutes, stale: ageMinutes > staleMinutes };
  }

  function meta(source, asOf, completeness, note = null, staleMinutes = DEFAULT_STALE_MINUTES) {
    return { source, asOf: iso(asOf), completeness, note, freshness: freshness(asOf, staleMinutes) };
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

    const debtors = rows.map((row) => {
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
    }).filter((row) => row.balance > 0).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.balance - a.balance);

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

  function currentAmeenLiveCache() {
    const cache = window.ozkAmeenLiveCache;
    const updatedAt = iso(cache?.updatedAt);
    if (!cache || !updatedAt || Date.now() - new Date(updatedAt).getTime() > AMEEN_LIVE_MAX_AGE_MINUTES * 60000) return null;
    return cache;
  }

  function buildInventory(approvedItems, snapshots, liveStock = null) {
    const snapshotByKey = new Map();
    const snapshotByName = new Map();
    for (const row of snapshots || []) {
      const key = text(row.itemKey || row.item_key || row.itemGuid || row.item_guid);
      const name = text(row.itemName || row.item_name).toLowerCase();
      if (key) snapshotByKey.set(key, row);
      if (name) snapshotByName.set(name, row);
    }

    const liveRows = Array.isArray(liveStock?.rows) ? liveStock.rows : null;
    const sourceItems = liveRows || approvedItems || [];
    const items = sourceItems.map((item) => {
      const key = liveRows ? text(item.item_guid) : text(item.itemKey || item.item_key);
      const number = liveRows ? text(item.item_number) : text(item.itemNumber || item.item_number);
      const name = liveRows ? text(item.item_name) : (text(item.itemName || item.item_name) || "صنف");
      const snap = snapshotByKey.get(key) || snapshotByName.get(name.toLowerCase()) || null;
      const stock = Math.max(0, numberOrZero(liveRows ? item.stock_qty : (snap?.stockUnit1 ?? snap?.stock_unit1 ?? item.stockQty ?? item.stock_qty)));
      const sold30d = numberOrNull(snap?.unitsSold30d ?? snap?.units_sold_30d ?? item.unitsSold30d ?? item.units_sold_30d);
      const daysCover = sold30d !== null && sold30d > 0 ? stock / (sold30d / 30) : null;
      let status = "stable";
      if (stock <= 0) status = "out";
      else if (daysCover !== null && daysCover < 7) status = "urgent";
      else if (daysCover !== null && daysCover < 14) status = "low";
      return { key, number, name, stock, sold30d, daysCover, status, purchaseQty: null };
    });

    const snapshotAsOf = newestIso((snapshots || []).map((row) => row.generatedAt || row.generated_at));
    const approvedAsOf = newestIso((approvedItems || []).map((row) => row.updatedAt || row.updated_at || row.sourceSyncedAt || row.source_synced_at));
    return {
      itemCount: items.length,
      outOfStockCount: items.filter((row) => row.status === "out").length,
      urgentReorderCount: items.filter((row) => row.status === "urgent").length,
      lowCoverCount: items.filter((row) => row.status === "low").length,
      urgentItems: items.filter((row) => ["out", "urgent"].includes(row.status)).sort((a, b) => (a.daysCover ?? -1) - (b.daysCover ?? -1)).slice(0, 12),
      meta: meta(
        liveRows ? "ameen_live.stock" : (snapshots?.length ? "ameen_item_snapshot + approved_price_items" : "approved_price_items"),
        liveRows ? (liveStock.asOf || liveStock.updatedAt) : (snapshotAsOf || approvedAsOf),
        items.length ? (liveRows || snapshots?.length ? "complete" : "partial") : "missing",
        liveRows ? "Stock quantities come from the current read-only Ameen Live response; low-cover status is used only when trusted 30-day velocity is available." : (snapshots?.length ? "Stock and 30-day velocity use the synchronized Ameen item snapshot." : "Ameen item snapshot is unavailable; inventory intelligence is limited."),
        liveRows ? AMEEN_LIVE_MAX_AGE_MINUTES : DEFAULT_STALE_MINUTES
      )
    };
  }

  function buildCustomerReference(liveCustomers) {
    const rows = Array.isArray(liveCustomers?.rows) ? liveCustomers.rows : [];
    return {
      customerCount: numberOrZero(liveCustomers?.rowCount ?? rows.length),
      meta: meta(
        rows.length ? "ameen_live.customers" : "ameen_live.customers.unavailable",
        liveCustomers?.asOf || liveCustomers?.updatedAt,
        rows.length ? "reference_only" : "missing",
        rows.length ? "Live customers are used only as a count/link reference; receivables remain on the accounting balance report." : "No current Ameen Live customer reference is available."
      )
    };
  }

  function buildPurchasing(purchaseInvoices, ameenPurchaseReport) {
    const local = Array.isArray(purchaseInvoices) ? purchaseInvoices : [];
    const open = local.filter((row) => !["synced", "cancelled"].includes(text(row.status).toLowerCase()));
    const ameenGroups = Array.isArray(ameenPurchaseReport?.items) ? ameenPurchaseReport.items : [];
    return {
      draftCount: local.filter((row) => text(row.status).toLowerCase() === "draft").length,
      pendingSyncCount: local.filter((row) => ["approved", "sync_pending", "failed"].includes(text(row.status).toLowerCase())).length,
      openTotalsByCurrency: sumByCurrency(open, (row) => row.remainingTotal ?? row.remaining_total ?? row.total, (row) => row.currency),
      ameenSupplierCount: ameenGroups.length,
      ameenInvoiceCount: ameenGroups.reduce((sum, supplier) => sum + (Array.isArray(supplier?.invoices) ? supplier.invoices.length : 0), 0),
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

  function buildDailyMovement(dailyMovementReport, customerInvoicesReport) {
    const payload = dailyMovementReport?.payload || {};
    const salesRows = Array.isArray(payload.sales) ? payload.sales : [];
    const paymentSummary = payload.paymentSummary || {};
    const payments = Array.isArray(payload.payments) ? payload.payments : [];
    const salesByUnit = {};
    let salesBillSignals = 0;

    for (const row of salesRows) {
      const unit = text(row.unit) || "UNKNOWN";
      const units = numberOrZero(row.units);
      const bills = numberOrZero(row.bills);
      salesBillSignals += bills;
      if (!salesByUnit[unit]) salesByUnit[unit] = { units: 0, bills: 0 };
      salesByUnit[unit].units += units;
      salesByUnit[unit].bills += bills;
    }

    const reportAsOf = dailyMovementReport?.created_at || dailyMovementReport?.report_date || payload.generatedAt || payload.date;
    const reportPresent = Boolean(dailyMovementReport);
    const paymentTotalUsd = numberOrNull(paymentSummary.totalUsd);
    const paymentCount = numberOrNull(paymentSummary.count) ?? payments.length;
    const customerInvoices = Array.isArray(customerInvoicesReport?.items) ? customerInvoicesReport.items : [];

    return {
      sales: {
        todayRevenue: null,
        revenueCurrency: null,
        movementRows: salesRows.length,
        billSignals: salesBillSignals,
        unitsByType: salesByUnit,
        customerInvoiceGroups: customerInvoices.length,
        meta: meta(
          reportPresent ? "daily_movement_reports" : (customerInvoicesReport ? "ameen_customer_invoices" : "none"),
          newestIso([reportAsOf, customerInvoicesReport?.created_at, customerInvoicesReport?.report_date]),
          reportPresent ? "partial" : (customerInvoicesReport ? "partial" : "missing"),
          "Daily movement currently exposes trustworthy bill/unit movement but not a single revenue total, so revenue remains null."
        )
      },
      collections: {
        todayTotal: paymentTotalUsd,
        currency: paymentTotalUsd === null ? null : "USD",
        count: paymentCount,
        topPayments: payments.slice().sort((a, b) => numberOrZero(b.amount) - numberOrZero(a.amount)).slice(0, 10).map((row) => ({
          customer: text(row.customer) || "زبون",
          amount: numberOrZero(row.amount),
          notes: text(row.notes)
        })),
        meta: meta(
          "daily_movement_reports.paymentSummary",
          reportAsOf,
          reportPresent && paymentTotalUsd !== null ? "complete" : (reportPresent ? "partial" : "missing"),
          reportPresent ? "Customer payments use the Ameen daily movement payment summary; accounting basis states USD base." : "No daily movement report is available."
        )
      }
    };
  }

  function buildRequests(requests) {
    const rows = Array.isArray(requests) ? requests : [];
    return {
      recentCount: rows.length,
      openCount: rows.filter((row) => !["مغلق", "closed"].includes(text(row.status))).length,
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
    const today = localDateKey();

    const [balanceReports, creditLimits, approvedItems, itemSnapshots, purchaseInvoices, ameenPurchases, supplierObligations, customerInvoices, dailyMovement, requests] = await Promise.all([
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

    const liveCache = currentAmeenLiveCache();
    const movement = buildDailyMovement(dailyMovement.value, customerInvoices.value);
    const parts = {
      sales: movement.sales,
      receivables: buildReceivables(balanceReports.value, creditLimits.value),
      collections: movement.collections,
      inventory: buildInventory(approvedItems.value, itemSnapshots.value, liveCache?.stock || null),
      customerReference: buildCustomerReference(liveCache?.customers || null),
      purchasing: buildPurchasing(purchaseInvoices.value, ameenPurchases.value),
      supplierObligations: buildSupplierObligations(supplierObligations.value),
      expenses: {
        totalsByCurrency: {},
        meta: meta("ameen_expenses", null, "missing", "No ameen_expenses report is currently present in Supabase production, so expenses remain intentionally unavailable.")
      },
      requests: buildRequests(requests.value)
    };

    const results = [balanceReports, creditLimits, approvedItems, itemSnapshots, purchaseInvoices, ameenPurchases, supplierObligations, customerInvoices, dailyMovement, requests];
    const errors = results.filter((result) => !result.ok).map((result) => result.error);

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

  window.ozkBusinessOS = Object.freeze({ schemaVersion: SNAPSHOT_VERSION, getSnapshot });
})();

